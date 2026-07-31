//! Persistent Node host prototype and performance gate for ADR-0012.

use serde_json::{json, Value};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, Receiver};
use std::thread;
use std::time::Duration;

const MAX_FRAME_BYTES: usize = 1024 * 1024;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(5);

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

fn default_supervisor_path() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("node-host")
        .join("supervisor.mjs")
}

pub struct NodeHostPrototype {
    child: Child,
    stdin: ChildStdin,
    receiver: Receiver<Result<Value, String>>,
    next_request_id: u64,
    request_timeout: Duration,
}

#[derive(Debug)]
pub struct InvocationResult {
    pub value: Value,
    pub host_calls: Vec<Value>,
}

impl NodeHostPrototype {
    pub fn start(node: impl AsRef<Path>) -> Result<Self, String> {
        Self::start_with_timeout(node, REQUEST_TIMEOUT)
    }

    fn start_with_timeout(
        node: impl AsRef<Path>,
        request_timeout: Duration,
    ) -> Result<Self, String> {
        Self::start_with_supervisor(node.as_ref(), &default_supervisor_path(), request_timeout)
    }

    fn start_with_supervisor(
        node: &Path,
        supervisor: &Path,
        request_timeout: Duration,
    ) -> Result<Self, String> {
        let mut child = Command::new(node)
            .arg(supervisor)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .map_err(|error| format!("start Node host: {error}"))?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "Node host stdin was not piped".to_string())?;
        let mut stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Node host stdout was not piped".to_string())?;
        let (sender, receiver) = mpsc::channel();
        thread::Builder::new()
            .name("godgesture-node-host-reader".into())
            .spawn(move || loop {
                let message = read_frame(&mut stdout);
                let disconnected = message.is_err();
                if sender.send(message).is_err() || disconnected {
                    break;
                }
            })
            .map_err(|error| format!("start Node host reader: {error}"))?;
        Ok(Self {
            child,
            stdin,
            receiver,
            next_request_id: 1,
            request_timeout,
        })
    }

    fn request(&mut self, mut message: Value) -> Result<InvocationResult, String> {
        let id = self.next_request_id;
        self.next_request_id += 1;
        message["id"] = json!(id);
        write_frame(&mut self.stdin, &message)?;

        let mut host_calls = Vec::new();
        loop {
            let incoming = self
                .receiver
                .recv_timeout(self.request_timeout)
                .map_err(|error| format!("Node host response timeout: {error}"))??;
            match incoming.get("type").and_then(Value::as_str) {
                Some("hostCall") => {
                    host_calls.push(incoming.clone());
                    write_frame(
                        &mut self.stdin,
                        &json!({
                            "type": "hostResult",
                            "pluginId": incoming["pluginId"],
                            "callId": incoming["callId"],
                            "ok": true,
                            "result": null,
                        }),
                    )?;
                }
                Some("response") if incoming.get("id").and_then(Value::as_u64) == Some(id) => {
                    if incoming.get("ok").and_then(Value::as_bool) == Some(true) {
                        return Ok(InvocationResult {
                            value: incoming.get("result").cloned().unwrap_or(Value::Null),
                            host_calls,
                        });
                    }
                    return Err(incoming
                        .get("error")
                        .and_then(Value::as_str)
                        .unwrap_or("Node host request failed")
                        .to_string());
                }
                _ => return Err(format!("unexpected Node host message: {incoming}")),
            }
        }
    }

    pub fn load_plugin(&mut self, plugin_id: &str, source: &str) -> Result<(), String> {
        self.request(json!({
            "type": "load",
            "pluginId": plugin_id,
            "source": source,
        }))?;
        Ok(())
    }

    pub fn invoke(
        &mut self,
        plugin_id: &str,
        handler: &str,
        context: Value,
    ) -> Result<InvocationResult, String> {
        self.request(json!({
            "type": "invoke",
            "pluginId": plugin_id,
            "handler": handler,
            "context": context,
        }))
    }
}

impl Drop for NodeHostPrototype {
    fn drop(&mut self) {
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{self, Cursor};
    use std::time::Instant;

    const PROBE_SOURCE: &str = r#"
import { basename } from "node:path";
let count = 0;
export function noop() { return ++count; }
export async function hostCall(context) {
  await context.input.sendText(basename("one/two"));
  return { node: process.versions.node, fetch: typeof fetch, count: ++count };
}
"#;

    fn node_host() -> NodeHostPrototype {
        NodeHostPrototype::start("node").expect("Node.js must be available for Desktop development")
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
    fn persistent_worker_runs_real_node_and_host_calls() {
        let mut host = node_host();
        host.load_plugin("probe", PROBE_SOURCE).unwrap();
        assert_eq!(host.invoke("probe", "noop", json!({})).unwrap().value, 1);
        let result = host.invoke("probe", "hostCall", json!({})).unwrap();
        assert_eq!(result.value["fetch"], "function");
        assert!(result.value["node"].as_str().is_some());
        assert_eq!(result.value["count"], 2);
        assert_eq!(result.host_calls.len(), 1);
        assert_eq!(result.host_calls[0]["method"], "input.sendText");
        assert_eq!(result.host_calls[0]["args"], json!(["two"]));
    }

    #[test]
    fn requests_are_ordered_and_protocol_errors_are_stable() {
        let mut host = node_host();
        host.load_plugin("probe", PROBE_SOURCE).unwrap();
        for expected in 1..=100 {
            assert_eq!(
                host.invoke("probe", "noop", json!({})).unwrap().value,
                expected
            );
        }
        assert!(host
            .request(json!({ "type": "unknown" }))
            .unwrap_err()
            .contains("unknown message type"));
    }

    #[test]
    fn timeout_and_worker_crash_do_not_poison_a_new_host_or_worker() {
        let mut timed =
            NodeHostPrototype::start_with_timeout("node", Duration::from_millis(200)).unwrap();
        timed
            .load_plugin(
                "hung",
                "export async function execute() { await new Promise(() => {}); }",
            )
            .unwrap();
        assert!(timed
            .invoke("hung", "execute", json!({}))
            .unwrap_err()
            .contains("timeout"));
        drop(timed);

        let mut host = node_host();
        host.load_plugin("probe", "export function crash() { process.exit(17); }")
            .unwrap();
        assert!(host
            .invoke("probe", "crash", json!({}))
            .unwrap_err()
            .contains("exited with code 17"));
        host.load_plugin("probe", PROBE_SOURCE).unwrap();
        assert_eq!(host.invoke("probe", "noop", json!({})).unwrap().value, 1);
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
        let cold_started = Instant::now();
        let mut host = node_host();
        host.load_plugin("probe", PROBE_SOURCE).unwrap();
        let cold = cold_started.elapsed();

        let mut no_op = Vec::with_capacity(ITERATIONS);
        let mut last = Value::Null;
        for _ in 0..ITERATIONS {
            let started = Instant::now();
            last = host.invoke("probe", "noop", json!({})).unwrap().value;
            no_op.push(started.elapsed());
        }
        assert_eq!(last, ITERATIONS);
        let mut host_call = Vec::with_capacity(ITERATIONS);
        for _ in 0..ITERATIONS {
            let started = Instant::now();
            last = host.invoke("probe", "hostCall", json!({})).unwrap().value;
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
