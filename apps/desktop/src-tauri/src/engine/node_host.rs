//! Framed client for the persistent Node plugin supervisor (ADR-0012).

use super::config::WindowOperation;
use super::script_host::{ScriptHost, ScriptInvocation, ScriptMouseButton, ScriptSlot};
use super::types::{Modifier, TriggerButton};
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, Receiver};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

const MAX_FRAME_BYTES: usize = 1024 * 1024;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_STATUS_CHARS: usize = 200;
const MAX_DIAGNOSTIC_FIELD_CHARS: usize = 64;
const MAX_DIAGNOSTIC_LINE_CHARS: usize = 512;

fn write_frame(mut writer: impl Write, message: &Value) -> Result<(), String> {
    let payload = serde_json::to_vec(message).map_err(|error| error.to_string())?;
    if payload.len() > MAX_FRAME_BYTES {
        return Err(format!("Node host frame exceeds {MAX_FRAME_BYTES} bytes"));
    }
    let length = u32::try_from(payload.len()).map_err(|error| error.to_string())?;
    writer
        .write_all(&length.to_be_bytes())
        .and_then(|_| writer.write_all(&payload))
        .and_then(|_| writer.flush())
        .map_err(|error| error.to_string())
}

fn read_frame(mut reader: impl Read) -> Result<Value, String> {
    let mut header = [0_u8; 4];
    reader
        .read_exact(&mut header)
        .map_err(|error| error.to_string())?;
    let length = u32::from_be_bytes(header) as usize;
    if length > MAX_FRAME_BYTES {
        return Err(format!("Node host frame exceeds {MAX_FRAME_BYTES} bytes"));
    }
    let mut payload = vec![0_u8; length];
    reader
        .read_exact(&mut payload)
        .map_err(|error| error.to_string())?;
    serde_json::from_slice(&payload).map_err(|error| error.to_string())
}

pub(crate) fn default_supervisor_path() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("node-host")
        .join("supervisor.mjs")
}

pub struct NodeHost {
    child: Child,
    stdin: ChildStdin,
    receiver: Receiver<Result<Value, String>>,
    next_request_id: u64,
    request_timeout: Duration,
    host: Arc<dyn ScriptHost>,
}

#[derive(Debug)]
pub struct InvocationResult {
    pub value: Value,
    pub host_calls: Vec<Value>,
    pub status: Option<String>,
}

impl NodeHost {
    pub fn start(node: impl AsRef<Path>, host: Arc<dyn ScriptHost>) -> Result<Self, String> {
        Self::start_with_timeout(node, REQUEST_TIMEOUT, host)
    }

    fn start_with_timeout(
        node: impl AsRef<Path>,
        request_timeout: Duration,
        host: Arc<dyn ScriptHost>,
    ) -> Result<Self, String> {
        Self::start_with_supervisor(
            node.as_ref(),
            &default_supervisor_path(),
            request_timeout,
            host,
        )
    }

    pub(crate) fn start_with_supervisor(
        node: &Path,
        supervisor: &Path,
        request_timeout: Duration,
        host: Arc<dyn ScriptHost>,
    ) -> Result<Self, String> {
        let started = Instant::now();
        log::info!(target: "node.supervisor", "event=host_start_started");
        let mut child = match Command::new(node)
            .arg(supervisor)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
        {
            Ok(child) => child,
            Err(error) => {
                log::error!(
                    target: "node.supervisor",
                    "event=host_start_failed code=spawn_failed"
                );
                return Err(format!("start Node host: {error}"));
            }
        };
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "Node host stdin was not piped".to_string())?;
        let mut stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Node host stdout was not piped".to_string())?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| "Node host stderr was not piped".to_string())?;
        let (sender, receiver) = mpsc::channel();
        thread::Builder::new()
            .name("godgesture-node-host-diagnostics".into())
            .spawn(move || {
                for line in BufReader::new(stderr).lines() {
                    match line {
                        Ok(line) => log_node_diagnostic_line(&line),
                        Err(_) => break,
                    }
                }
            })
            .map_err(|error| {
                log::error!(
                    target: "node.supervisor",
                    "event=host_start_failed code=diagnostics_thread_failed"
                );
                format!("start Node host diagnostics: {error}")
            })?;
        thread::Builder::new()
            .name("godgesture-node-host-reader".into())
            .spawn(move || loop {
                let message = read_frame(&mut stdout);
                let disconnected = message.is_err();
                if sender.send(message).is_err() || disconnected {
                    break;
                }
            })
            .map_err(|error| {
                log::error!(
                    target: "node.supervisor",
                    "event=host_start_failed code=reader_thread_failed"
                );
                format!("start Node host reader: {error}")
            })?;
        log::info!(
            target: "node.supervisor",
            "event=host_start_completed durationMs={}",
            started.elapsed().as_millis()
        );
        Ok(Self {
            child,
            stdin,
            receiver,
            next_request_id: 1,
            request_timeout,
            host,
        })
    }

    fn request(
        &mut self,
        mut message: Value,
        invocation: Option<ScriptInvocation>,
    ) -> Result<InvocationResult, String> {
        let id = self.next_request_id;
        self.next_request_id += 1;
        message["id"] = json!(id);
        let plugin_id = diagnostic_identifier(message.get("pluginId"));
        let action_id = diagnostic_identifier(message.get("handler"));
        let lifecycle = diagnostic_identifier(message.get("handler"));
        let started = Instant::now();
        if write_frame(&mut self.stdin, &message).is_err() {
            log::warn!(
                target: "node.supervisor",
                "event=ipc_failed code=write_failed pluginId={plugin_id} actionId={action_id} lifecycle={lifecycle}"
            );
            return Err("Node host IPC write failed".into());
        }

        let mut host_calls = Vec::new();
        let mut status = None;
        let deadline = Instant::now() + self.request_timeout;
        loop {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                log::warn!(
                    target: "node.supervisor",
                    "event=ipc_failed code=timeout pluginId={plugin_id} actionId={action_id} lifecycle={lifecycle} durationMs={}",
                    started.elapsed().as_millis()
                );
                return Err("Node host response timeout".into());
            }
            let incoming = match self.receiver.recv_timeout(remaining) {
                Ok(Ok(message)) => message,
                Ok(Err(_)) => {
                    log::warn!(
                        target: "node.supervisor",
                        "event=ipc_failed code=read_failed pluginId={plugin_id} actionId={action_id} lifecycle={lifecycle} durationMs={}",
                        started.elapsed().as_millis()
                    );
                    return Err("Node host IPC frame read failed".into());
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    log::warn!(
                        target: "node.supervisor",
                        "event=ipc_failed code=timeout pluginId={plugin_id} actionId={action_id} lifecycle={lifecycle} durationMs={}",
                        started.elapsed().as_millis()
                    );
                    return Err("Node host response timeout".into());
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    log::warn!(
                        target: "node.supervisor",
                        "event=ipc_failed code=disconnected pluginId={plugin_id} actionId={action_id} lifecycle={lifecycle} durationMs={}",
                        started.elapsed().as_millis()
                    );
                    return Err("Node host IPC disconnected".into());
                }
            };
            match incoming.get("type").and_then(Value::as_str) {
                Some("hostCall") => {
                    host_calls.push(incoming.clone());
                    log::debug!(
                        target: "node.worker",
                        "event=host_call pluginId={} actionId={action_id} method={}",
                        diagnostic_identifier(incoming.get("pluginId")),
                        diagnostic_identifier(incoming.get("method")),
                    );
                    let result = invocation
                        .ok_or_else(|| "Node host call has no invocation context".to_string())
                        .and_then(|invocation| {
                            execute_host_call(&*self.host, invocation, &incoming, &mut status)
                        });
                    let response = match result {
                        Ok(result) => json!({
                            "type": "hostResult",
                            "pluginId": incoming["pluginId"],
                            "callId": incoming["callId"],
                            "ok": true,
                            "result": result,
                        }),
                        Err(error) => json!({
                            "type": "hostResult",
                            "pluginId": incoming["pluginId"],
                            "callId": incoming["callId"],
                            "ok": false,
                            "error": error,
                        }),
                    };
                    write_frame(&mut self.stdin, &response)?;
                }
                Some("response") if incoming.get("id").and_then(Value::as_u64) == Some(id) => {
                    if incoming.get("ok").and_then(Value::as_bool) == Some(true) {
                        log::debug!(
                            target: "node.supervisor",
                            "event=ipc_complete code=ok pluginId={plugin_id} actionId={action_id} lifecycle={lifecycle} durationMs={}",
                            started.elapsed().as_millis()
                        );
                        return Ok(InvocationResult {
                            value: incoming.get("result").cloned().unwrap_or(Value::Null),
                            host_calls,
                            status,
                        });
                    }
                    let error = incoming
                        .get("error")
                        .and_then(Value::as_str)
                        .map(stable_node_error)
                        .unwrap_or("request_failed");
                    log::warn!(
                        target: "node.supervisor",
                        "event=ipc_failed code={error} pluginId={plugin_id} actionId={action_id} lifecycle={lifecycle} durationMs={}",
                        started.elapsed().as_millis()
                    );
                    return Err(error.into());
                }
                _ => {
                    log::warn!(
                        target: "node.supervisor",
                        "event=ipc_failed code=unexpected_message pluginId={plugin_id} actionId={action_id} lifecycle={lifecycle} durationMs={}",
                        started.elapsed().as_millis()
                    );
                    return Err("Node host sent an unexpected message".into());
                }
            }
        }
    }

    pub fn load_plugin(&mut self, plugin_id: &str, entry_path: &Path) -> Result<(), String> {
        log::info!(
            target: "node.supervisor",
            "event=plugin_load_started pluginId={}",
            diagnostic_identifier(Some(&Value::String(plugin_id.into())))
        );
        self.request(
            json!({
                "type": "load",
                "pluginId": plugin_id,
                "entryPath": entry_path,
            }),
            None,
        )?;
        log::info!(
            target: "node.supervisor",
            "event=plugin_load_completed pluginId={}",
            diagnostic_identifier(Some(&Value::String(plugin_id.into())))
        );
        Ok(())
    }

    pub fn unload_plugin(&mut self, plugin_id: &str) -> Result<(), String> {
        self.request(
            json!({
                "type": "unload",
                "pluginId": plugin_id,
            }),
            None,
        )?;
        log::info!(
            target: "node.supervisor",
            "event=plugin_unload_completed pluginId={}",
            diagnostic_identifier(Some(&Value::String(plugin_id.into())))
        );
        Ok(())
    }

    pub fn is_running(&mut self) -> bool {
        matches!(self.child.try_wait(), Ok(None))
    }

    pub fn invoke(
        &mut self,
        plugin_id: &str,
        handler: &str,
        optional: bool,
        slot: ScriptSlot,
        invocation: ScriptInvocation,
    ) -> Result<InvocationResult, String> {
        self.request(
            json!({
                "type": "invoke",
                "pluginId": plugin_id,
                "handler": handler,
                "optional": optional,
                "timeoutMs": REQUEST_TIMEOUT.as_millis(),
                "context": invocation_context(invocation, slot),
            }),
            Some(invocation),
        )
    }
}

impl Drop for NodeHost {
    fn drop(&mut self) {
        log::debug!(target: "node.supervisor", "event=host_shutdown");
        let id = self.next_request_id;
        let _ = write_frame(&mut self.stdin, &json!({ "type": "shutdown", "id": id }));
        for _ in 0..20 {
            match self.child.try_wait() {
                Ok(Some(_)) => return,
                Ok(None) => thread::sleep(Duration::from_millis(5)),
                Err(_) => break,
            }
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn diagnostic_identifier(value: Option<&Value>) -> String {
    let Some(value) = value else {
        return "-".into();
    };
    let Some(value) = value.as_str() else {
        return "-".into();
    };
    let mut result = value
        .chars()
        .take(MAX_DIAGNOSTIC_FIELD_CHARS)
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | ':' | '-') {
                character
            } else {
                '_'
            }
        })
        .collect::<String>();
    if result.is_empty() {
        result.push('-');
    }
    result
}

fn stable_node_error(error: &str) -> &str {
    if error.contains("exited with code") {
        return error;
    }
    let lower = error.to_ascii_lowercase();
    if lower.contains("timeout") || lower.contains("timed out") {
        "node_invocation_timeout"
    } else if lower.contains("unknown message type") {
        "node unknown message type"
    } else if lower.contains("does not export") {
        "node_handler_missing"
    } else if lower.contains("import") {
        "node_plugin_import_failed"
    } else {
        "node_request_failed"
    }
}

fn diagnostic_target(value: &Value) -> &'static str {
    if value.get("source").and_then(Value::as_str) == Some("worker") {
        "node.worker"
    } else {
        "node.supervisor"
    }
}

fn emit_node_diagnostic(target: &str, level: Option<&str>, message: &str) {
    match target {
        "node.worker" => match level {
            Some("debug") => log::debug!(target: "node.worker", "{message}"),
            Some("info") => log::info!(target: "node.worker", "{message}"),
            Some("error") => log::error!(target: "node.worker", "{message}"),
            _ => log::warn!(target: "node.worker", "{message}"),
        },
        _ => match level {
            Some("debug") => log::debug!(target: "node.supervisor", "{message}"),
            Some("info") => log::info!(target: "node.supervisor", "{message}"),
            Some("error") => log::error!(target: "node.supervisor", "{message}"),
            _ => log::warn!(target: "node.supervisor", "{message}"),
        },
    }
}

fn log_node_diagnostic_line(line: &str) {
    let Ok(value) = serde_json::from_str::<Value>(line) else {
        log::warn!(
            target: "node.supervisor",
            "event=diagnostic code=unstructured_stderr lineLength={}",
            line.chars().count().min(MAX_DIAGNOSTIC_LINE_CHARS)
        );
        return;
    };
    let code = diagnostic_identifier(value.get("code"));
    let plugin_id = diagnostic_identifier(value.get("pluginId"));
    let action_id = diagnostic_identifier(value.get("actionId"));
    let lifecycle = diagnostic_identifier(value.get("lifecycle"));
    let duration = value
        .get("durationMs")
        .and_then(Value::as_u64)
        .map_or_else(|| "-".into(), |value| value.to_string());
    let line_length = value.get("lineLength").and_then(Value::as_u64).map_or_else(
        || "-".into(),
        |value| value.min(MAX_DIAGNOSTIC_LINE_CHARS as u64).to_string(),
    );
    let message = format!(
        "event=diagnostic code={code} pluginId={plugin_id} actionId={action_id} lifecycle={lifecycle} durationMs={duration} lineLength={line_length}"
    );
    emit_node_diagnostic(
        diagnostic_target(&value),
        value.get("level").and_then(Value::as_str),
        &message,
    );
}

fn invocation_context(invocation: ScriptInvocation, slot: ScriptSlot) -> Value {
    json!({
        "origin": { "x": invocation.gesture.origin.x, "y": invocation.gesture.origin.y },
        "endpoint": { "x": invocation.gesture.endpoint.x, "y": invocation.gesture.endpoint.y },
        "triggerButton": invocation.trigger.map(trigger_button_name),
        "modifier": modifier_name(invocation.modifier),
        "phase": slot.name(),
        "targetWindowAvailable": invocation.gesture.native_window != 0,
    })
}

fn execute_host_call(
    host: &dyn ScriptHost,
    invocation: ScriptInvocation,
    message: &Value,
    status: &mut Option<String>,
) -> Result<Value, String> {
    let method = message
        .get("method")
        .and_then(Value::as_str)
        .ok_or_else(|| "Node host call is missing method".to_string())?;
    let args = message
        .get("args")
        .and_then(Value::as_array)
        .ok_or_else(|| format!("Node host call '{method}' has invalid args"))?;
    match method {
        "input.keyCombo" => {
            host.key_combo(string_array(args, 0)?, string_array(args, 1)?)?;
            Ok(Value::Null)
        }
        "input.sendText" => {
            host.send_text(string_arg(args, 0)?.to_string())?;
            Ok(Value::Null)
        }
        "input.mouseClick" => {
            host.mouse_click(mouse_button_arg(args, 0)?)?;
            Ok(Value::Null)
        }
        "input.mouseDown" | "input.mouseUp" => {
            host.mouse_button(mouse_button_arg(args, 0)?, method.ends_with("Down"))?;
            Ok(Value::Null)
        }
        "input.movePointer" => {
            host.move_pointer(i32_arg(args, 0)?, i32_arg(args, 1)?)?;
            Ok(Value::Null)
        }
        "input.wheel" => {
            host.wheel(i32_arg(args, 0)?)?;
            Ok(Value::Null)
        }
        "window.activateTarget" => {
            host.activate_target(invocation.gesture)?;
            Ok(Value::Null)
        }
        "window.perform" => {
            host.window_operation(window_operation_arg(args, 0)?, invocation.gesture)?;
            Ok(Value::Null)
        }
        "clipboard.readText" => Ok(json!(host.clipboard_read_text()?)),
        "clipboard.writeText" => {
            host.clipboard_write_text(string_arg(args, 0)?.to_string())?;
            Ok(Value::Null)
        }
        "clipboard.selectedText" => Ok(json!(host.clipboard_selected_text()?)),
        "status.report" => {
            *status = Some(
                string_arg(args, 0)?
                    .chars()
                    .take(MAX_STATUS_CHARS)
                    .collect(),
            );
            Ok(Value::Null)
        }
        _ => Err(format!("unknown Node host method '{method}'")),
    }
}

fn string_arg(args: &[Value], index: usize) -> Result<&str, String> {
    args.get(index)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("argument {index} must be a string"))
}

fn string_array(args: &[Value], index: usize) -> Result<Vec<String>, String> {
    args.get(index)
        .and_then(Value::as_array)
        .ok_or_else(|| format!("argument {index} must be a string array"))?
        .iter()
        .map(|value| {
            value
                .as_str()
                .map(str::to_string)
                .ok_or_else(|| format!("argument {index} must contain only strings"))
        })
        .collect()
}

fn i32_arg(args: &[Value], index: usize) -> Result<i32, String> {
    let value = args
        .get(index)
        .and_then(Value::as_i64)
        .ok_or_else(|| format!("argument {index} must be an integer"))?;
    i32::try_from(value).map_err(|_| format!("argument {index} is outside the i32 range"))
}

fn mouse_button_arg(args: &[Value], index: usize) -> Result<ScriptMouseButton, String> {
    match string_arg(args, index)?.to_ascii_lowercase().as_str() {
        "left" => Ok(ScriptMouseButton::Left),
        "right" => Ok(ScriptMouseButton::Right),
        "middle" => Ok(ScriptMouseButton::Middle),
        "x1" => Ok(ScriptMouseButton::X1),
        "x2" => Ok(ScriptMouseButton::X2),
        value => Err(format!("unknown mouse button '{value}'")),
    }
}

fn window_operation_arg(args: &[Value], index: usize) -> Result<WindowOperation, String> {
    match string_arg(args, index)? {
        "maximizeRestore" => Ok(WindowOperation::MaximizeRestore),
        "minimize" => Ok(WindowOperation::Minimize),
        "close" => Ok(WindowOperation::Close),
        "toggleTopmost" => Ok(WindowOperation::ToggleTopmost),
        "dockLeft" => Ok(WindowOperation::DockLeft),
        "dockRight" => Ok(WindowOperation::DockRight),
        value => Err(format!("unknown window operation '{value}'")),
    }
}

fn trigger_button_name(trigger: TriggerButton) -> &'static str {
    match trigger {
        TriggerButton::Right => "right",
        TriggerButton::Middle => "middle",
        TriggerButton::X1 => "x1",
        TriggerButton::X2 => "x2",
    }
}

fn modifier_name(modifier: Modifier) -> &'static str {
    match modifier {
        Modifier::None => "none",
        Modifier::WheelForward => "wheelForward",
        Modifier::WheelBackward => "wheelBackward",
        Modifier::LeftButtonDown => "leftButtonDown",
        Modifier::MiddleButtonDown => "middleButtonDown",
        Modifier::RightButtonDown => "rightButtonDown",
        Modifier::X1Down => "x1Down",
        Modifier::X2Down => "x2Down",
    }
}

#[cfg(test)]
mod tests {
    use super::super::runtime::GestureContext;
    use super::*;
    use parking_lot::Mutex;
    use std::fs;
    use std::io::{self, Cursor};
    use std::time::Instant;

    const PROBE_SOURCE: &str = r#"
import { basename } from "node:path";
import { suffix } from "./helper.mjs";
let count = 0;
export function noop() { return ++count; }
export async function hostCall(context) {
  await context.input.sendText(`${basename("one/two")}${suffix}`);
  await context.status.report(`${context.phase}:${await context.clipboard.readText()}`);
  return { node: process.versions.node, fetch: typeof fetch, count: ++count };
}
"#;

    #[derive(Default)]
    struct FakeHost {
        text: Mutex<Vec<String>>,
    }

    impl ScriptHost for FakeHost {
        fn key_combo(&self, _: Vec<String>, _: Vec<String>) -> Result<(), String> {
            Ok(())
        }
        fn send_text(&self, text: String) -> Result<(), String> {
            self.text.lock().push(text);
            Ok(())
        }
        fn mouse_click(&self, _: ScriptMouseButton) -> Result<(), String> {
            Ok(())
        }
        fn mouse_button(&self, _: ScriptMouseButton, _: bool) -> Result<(), String> {
            Ok(())
        }
        fn move_pointer(&self, _: i32, _: i32) -> Result<(), String> {
            Ok(())
        }
        fn wheel(&self, _: i32) -> Result<(), String> {
            Ok(())
        }
        fn activate_target(&self, _: GestureContext) -> Result<(), String> {
            Ok(())
        }
        fn window_operation(&self, _: WindowOperation, _: GestureContext) -> Result<(), String> {
            Ok(())
        }
        fn clipboard_read_text(&self) -> Result<Option<String>, String> {
            Ok(Some("clipboard".into()))
        }
        fn clipboard_write_text(&self, _: String) -> Result<(), String> {
            Ok(())
        }
        fn clipboard_selected_text(&self) -> Result<Option<String>, String> {
            Ok(None)
        }
    }

    struct TestProject(PathBuf);

    impl TestProject {
        fn new(source: &str) -> Self {
            let path = std::env::temp_dir()
                .join(format!("godgesture-node-project-{}", uuid::Uuid::new_v4()));
            fs::create_dir_all(&path).unwrap();
            fs::write(
                path.join("package.json"),
                r#"{"private":true,"type":"module"}"#,
            )
            .unwrap();
            fs::write(path.join("index.mjs"), source).unwrap();
            fs::write(path.join("helper.mjs"), "export const suffix = '!';").unwrap();
            Self(path)
        }

        fn entry(&self) -> PathBuf {
            self.0.join("index.mjs")
        }
    }

    impl Drop for TestProject {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn invocation() -> ScriptInvocation {
        ScriptInvocation {
            gesture: GestureContext::default(),
            trigger: Some(TriggerButton::Right),
            modifier: Modifier::None,
        }
    }

    fn node_host(host: Arc<dyn ScriptHost>) -> NodeHost {
        NodeHost::start("node", host).expect("Node.js must be available for Desktop development")
    }

    #[test]
    fn framed_json_round_trips_and_rejects_oversized_input() {
        let message = json!({ "type": "probe", "text": "你好" });
        let mut bytes = Vec::new();
        write_frame(&mut bytes, &message).unwrap();
        assert_eq!(read_frame(Cursor::new(bytes)).unwrap(), message);

        let oversized = ((MAX_FRAME_BYTES as u32) + 1).to_be_bytes();
        assert!(read_frame(Cursor::new(oversized))
            .unwrap_err()
            .contains("exceeds"));
    }

    struct OneByteReader<R>(R);

    impl<R: Read> Read for OneByteReader<R> {
        fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
            let length = buffer.len().min(1);
            self.0.read(&mut buffer[..length])
        }
    }

    #[test]
    fn framed_json_accepts_partial_reads() {
        let message = json!({ "type": "partial", "value": 42 });
        let mut bytes = Vec::new();
        write_frame(&mut bytes, &message).unwrap();
        assert_eq!(
            read_frame(OneByteReader(Cursor::new(bytes))).unwrap(),
            message
        );
    }

    #[test]
    fn node_diagnostic_source_routes_to_stable_targets() {
        assert_eq!(
            diagnostic_target(&json!({ "source": "worker" })),
            "node.worker"
        );
        assert_eq!(
            diagnostic_target(&json!({ "source": "supervisor" })),
            "node.supervisor"
        );
        assert_eq!(diagnostic_target(&json!({})), "node.supervisor");
    }

    #[test]
    fn persistent_worker_runs_real_esm_node_and_host_calls() {
        let project = TestProject::new(PROBE_SOURCE);
        let fake = Arc::new(FakeHost::default());
        let mut host = node_host(fake.clone());
        host.load_plugin("probe", &project.entry()).unwrap();
        assert_eq!(
            host.invoke("probe", "noop", false, ScriptSlot::OnExecute, invocation())
                .unwrap()
                .value,
            1
        );
        let result = host
            .invoke(
                "probe",
                "hostCall",
                false,
                ScriptSlot::OnGestureRecognized,
                invocation(),
            )
            .unwrap();
        assert_eq!(result.value["fetch"], "function");
        assert!(result.value["node"].as_str().is_some());
        assert_eq!(result.value["count"], 2);
        assert_eq!(result.host_calls.len(), 3);
        assert_eq!(fake.text.lock().as_slice(), &["two!".to_string()]);
        assert_eq!(
            result.status.as_deref(),
            Some("onGestureRecognized:clipboard")
        );
    }

    #[test]
    fn requests_are_ordered_and_optional_handlers_are_noops() {
        let project = TestProject::new(PROBE_SOURCE);
        let mut host = node_host(Arc::new(FakeHost::default()));
        host.load_plugin("probe", &project.entry()).unwrap();
        for expected in 1..=100 {
            assert_eq!(
                host.invoke("probe", "noop", false, ScriptSlot::OnExecute, invocation())
                    .unwrap()
                    .value,
                expected
            );
        }
        assert_eq!(
            host.invoke("probe", "onInit", true, ScriptSlot::OnInit, invocation())
                .unwrap()
                .value,
            Value::Null
        );
        let initialized = TestProject::new(
            "let value = 0; export function onInit() { value = 41; } export function read() { return ++value; }",
        );
        host.load_plugin("initialized", &initialized.entry())
            .unwrap();
        assert_eq!(
            host.invoke(
                "initialized",
                "read",
                false,
                ScriptSlot::OnExecute,
                invocation(),
            )
            .unwrap()
            .value,
            42
        );
        assert!(host
            .request(json!({ "type": "unknown" }), None)
            .unwrap_err()
            .contains("unknown message type"));
    }

    #[test]
    fn timeout_and_worker_crash_allow_a_clean_reload() {
        let hung =
            TestProject::new("export async function onExecute() { await new Promise(() => {}); }");
        let fake: Arc<dyn ScriptHost> = Arc::new(FakeHost::default());
        let mut timed = node_host(fake.clone());
        timed.load_plugin("hung", &hung.entry()).unwrap();
        timed.request_timeout = Duration::from_millis(200);
        assert!(timed
            .invoke(
                "hung",
                "onExecute",
                false,
                ScriptSlot::OnExecute,
                invocation()
            )
            .unwrap_err()
            .contains("timeout"));
        drop(timed);

        let crash = TestProject::new("export function crash() { process.exit(17); }");
        let probe = TestProject::new(PROBE_SOURCE);
        let mut host = node_host(fake);
        host.load_plugin("probe", &crash.entry()).unwrap();
        assert!(host
            .invoke("probe", "crash", false, ScriptSlot::OnExecute, invocation())
            .unwrap_err()
            .contains("exited with code 17"));
        host.load_plugin("probe", &probe.entry()).unwrap();
        assert_eq!(
            host.invoke("probe", "noop", false, ScriptSlot::OnExecute, invocation())
                .unwrap()
                .value,
            1
        );
    }

    fn percentile(samples: &mut [Duration], percentile: f64) -> Duration {
        samples.sort_unstable();
        let index = ((samples.len() - 1) as f64 * percentile).ceil() as usize;
        samples[index]
    }

    #[test]
    #[ignore = "release-mode performance gate; run explicitly with --release --ignored --nocapture"]
    fn node_host_performance_gate() {
        const ITERATIONS: usize = 10_000;
        let project = TestProject::new(PROBE_SOURCE);
        let cold_started = Instant::now();
        let mut host = node_host(Arc::new(FakeHost::default()));
        host.load_plugin("probe", &project.entry()).unwrap();
        let cold = cold_started.elapsed();

        let mut no_op = Vec::with_capacity(ITERATIONS);
        let mut last = Value::Null;
        for _ in 0..ITERATIONS {
            let started = Instant::now();
            last = host
                .invoke("probe", "noop", false, ScriptSlot::OnExecute, invocation())
                .unwrap()
                .value;
            no_op.push(started.elapsed());
        }
        assert_eq!(last, ITERATIONS);
        let mut host_call = Vec::with_capacity(ITERATIONS);
        for _ in 0..ITERATIONS {
            let started = Instant::now();
            last = host
                .invoke(
                    "probe",
                    "hostCall",
                    false,
                    ScriptSlot::OnExecute,
                    invocation(),
                )
                .unwrap()
                .value;
            host_call.push(started.elapsed());
        }
        assert_eq!(last["count"], ITERATIONS * 2);

        let no_op_p95 = percentile(&mut no_op, 0.95);
        let no_op_p99 = percentile(&mut no_op, 0.99);
        let host_call_p95 = percentile(&mut host_call, 0.95);
        let host_call_p99 = percentile(&mut host_call, 0.99);
        eprintln!(
            "node host gate: cold={cold:?}, noop p95={no_op_p95:?} p99={no_op_p99:?}, host-call p95={host_call_p95:?} p99={host_call_p99:?}"
        );
        assert!(no_op_p95 <= Duration::from_millis(5), "{no_op_p95:?}");
        assert!(
            host_call_p95 <= Duration::from_millis(8),
            "{host_call_p95:?}"
        );
        assert!(no_op_p99 <= Duration::from_millis(16), "{no_op_p99:?}");
        assert!(
            host_call_p99 <= Duration::from_millis(16),
            "{host_call_p99:?}"
        );
    }
}
