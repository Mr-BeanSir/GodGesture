#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    struct TempDir(PathBuf);

    static TEST_COUNTER: AtomicU64 = AtomicU64::new(0);

    impl TempDir {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "godgesture-logging-test-{}-{}",
                std::process::id(),
                TEST_COUNTER.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }

        fn logs(&self) -> PathBuf {
            self.0.join("logs")
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn level_threshold_matches_the_desktop_contract() {
        assert!(LogLevel::Error.accepts(LogEntryLevel::Error));
        assert!(!LogLevel::Error.accepts(LogEntryLevel::Warn));
        assert!(LogLevel::Warn.accepts(LogEntryLevel::Error));
        assert!(LogLevel::Warn.accepts(LogEntryLevel::Warn));
        assert!(!LogLevel::Warn.accepts(LogEntryLevel::Info));
        assert!(LogLevel::Info.accepts(LogEntryLevel::Info));
        assert!(!LogLevel::Info.accepts(LogEntryLevel::Debug));
        assert!(LogLevel::Debug.accepts(LogEntryLevel::Debug));
        assert!(!LogLevel::Off.accepts(LogEntryLevel::Error));
    }

    #[test]
    fn rust_redaction_removes_secrets_and_jsonl_control_breaks() {
        let value = sanitize_message(
            "password=secret Bearer abcdefghijklmnopqrstuvwxyz123456\r\nclipboard=private",
        );
        assert!(!value.contains("secret"));
        assert!(!value.contains("abcdefghijklmnopqrstuvwxyz123456"));
        assert!(value.contains('\n'));
        assert!(!value.contains('\r'));
        assert!(value.contains("[redacted]"));
    }

    #[test]
    fn queries_newest_entries_first_and_limits_from_the_newest_end() {
        let dir = TempDir::new();
        let service = LoggingService::for_test(dir.logs()).unwrap();
        service.set_level(LogLevel::Info).unwrap();
        service
            .write_user(LogEntryLevel::Info, "logs", "first")
            .unwrap();
        service
            .write_user(LogEntryLevel::Info, "logs", "second")
            .unwrap();
        service.flush_for_test();

        let response = service
            .query(&LogsQueryRequest {
                limit: Some(1),
                ..LogsQueryRequest::default()
            })
            .unwrap();
        assert_eq!(response.total, 2);
        assert_eq!(response.entries.len(), 1);
        assert_eq!(response.entries[0].message, "second");
    }

    #[test]
    fn rust_redaction_handles_json_keys_and_keeps_length_bounds() {
        let value = sanitize_message(
            r#"{"accessToken":"access-secret","refreshToken": "refresh-secret","token":"token-secret","clipboard":"selected text"}"#,
        );
        assert!(!value.contains("access-secret"));
        assert!(!value.contains("refresh-secret"));
        assert!(!value.contains("token-secret"));
        assert!(!value.contains("selected text"));
        assert!(value.chars().count() <= MAX_MESSAGE_CHARS);

        let long_value = sanitize_message(&"x".repeat(MAX_MESSAGE_CHARS + 100));
        assert!(long_value.chars().count() <= MAX_MESSAGE_CHARS);
    }

    #[cfg(test)]
    #[test]
    fn writes_jsonl_and_queries_filtered_entries() {
        let dir = TempDir::new();
        let service = LoggingService::for_test(dir.logs()).unwrap();
        assert_eq!(service.level(), LogLevel::Off);
        service.set_level(LogLevel::Info).unwrap();
        service
            .write_user(LogEntryLevel::Error, "node.supervisor", "load failed")
            .unwrap();
        service
            .write_user(LogEntryLevel::Warn, "gesture.runtime", "slow path")
            .unwrap();
        service
            .write_user(LogEntryLevel::Debug, "gesture.runtime", "ignored")
            .unwrap();
        service.flush_for_test();

        let raw = fs::read_to_string(dir.logs().join(ACTIVE_FILE_NAME)).unwrap();
        let first = raw.lines().next().unwrap();
        let json: serde_json::Value = serde_json::from_str(first).unwrap();
        assert!(json["timestamp"].as_str().unwrap().ends_with('Z'));
        assert_eq!(json["level"], "error");
        assert_eq!(json["target"], "node.supervisor");
        assert_eq!(json["message"], "load failed");

        let response = service
            .query(&LogsQueryRequest {
                level: Some(LogLevel::Warn),
                target: Some("gesture".into()),
                keyword: Some("slow".into()),
                limit: Some(10),
            })
            .unwrap();
        assert_eq!(response.total, 1);
        assert_eq!(response.entries.len(), 1);
        assert_eq!(response.entries[0].level, LogEntryLevel::Warn);
        assert_eq!(response.level, LogLevel::Info);

        drop(service);
        let reopened = LoggingService::for_test(dir.logs()).unwrap();
        assert_eq!(reopened.level(), LogLevel::Info);
    }

    #[cfg(test)]
    #[test]
    fn rotates_within_file_history_and_total_size_limits() {
        let dir = TempDir::new();
        let service = LoggingService::for_test(dir.logs()).unwrap();
        service.set_level(LogLevel::Debug).unwrap();
        let message = "x".repeat(MAX_MESSAGE_CHARS);
        for _ in 0..14_000 {
            loop {
                match service.write_user(LogEntryLevel::Debug, "gesture.runtime", &message) {
                    Ok(()) => break,
                    Err(_) => service.flush_for_test(),
                }
            }
        }
        service.flush_for_test();

        let files = service.log_files_for_test();
        let history = files
            .iter()
            .filter(|path| path.file_name().unwrap().to_string_lossy() != "godgesture.log")
            .count();
        let total = files
            .iter()
            .map(|path| fs::metadata(path).unwrap().len())
            .sum::<u64>();
        assert!(history <= MAX_ROTATED_FILES);
        assert!(total <= MAX_TOTAL_BYTES);
        assert!(
            fs::metadata(dir.logs().join("godgesture.log"))
                .unwrap()
                .len()
                <= MAX_FILE_BYTES
        );
    }

    #[cfg(test)]
    #[test]
    fn exports_and_clears_only_managed_log_files() {
        let dir = TempDir::new();
        let service = LoggingService::for_test(dir.logs()).unwrap();
        service.set_level(LogLevel::Debug).unwrap();
        service
            .write_user(LogEntryLevel::Info, "logs", "export me")
            .unwrap();
        service.flush_for_test();

        let export_path = service
            .export(&LogsQueryRequest::default())
            .expect("export should succeed");
        let export_path = PathBuf::from(export_path);
        assert!(export_path.starts_with(dir.logs()));
        assert_eq!(fs::read_to_string(&export_path).unwrap().lines().count(), 1);

        service.clear().unwrap();
        service.flush_for_test();
        assert_eq!(
            service.query(&LogsQueryRequest::default()).unwrap().total,
            0
        );
        assert!(export_path.is_file());
        assert_eq!(
            fs::metadata(dir.logs().join(ACTIVE_FILE_NAME))
                .unwrap()
                .len(),
            0
        );
    }
}
use crossbeam_channel::{bounded, select, unbounded, Receiver, Sender, TrySendError};
use log::{Level, LevelFilter, Log, Metadata, Record};
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, AtomicU8, Ordering};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const ACTIVE_FILE_NAME: &str = "godgesture.log";
const MAX_FILE_BYTES: u64 = 10 * 1024 * 1024;
const MAX_ROTATED_FILES: usize = 5;
const MAX_TOTAL_BYTES: u64 = 50 * 1024 * 1024;
const MAX_HISTORY_BYTES: u64 = MAX_TOTAL_BYTES - MAX_FILE_BYTES;
const MAX_QUERY_LIMIT: usize = 5_000;
const MAX_TARGET_CHARS: usize = 96;
const MAX_MESSAGE_CHARS: usize = 4_096;
const WRITE_QUEUE_CAPACITY: usize = 4_096;
const CONTROL_TIMEOUT: Duration = Duration::from_secs(5);
static EXPORT_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone, Copy, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum LogLevel {
    #[default]
    Off,
    Error,
    Warn,
    Info,
    Debug,
}

impl LogLevel {
    fn rank(self) -> u8 {
        match self {
            Self::Off => 0,
            Self::Error => 1,
            Self::Warn => 2,
            Self::Info => 3,
            Self::Debug => 4,
        }
    }

    fn accepts(self, level: LogEntryLevel) -> bool {
        self.rank() >= level.rank()
    }

    fn from_code(code: u8) -> Self {
        match code {
            1 => Self::Error,
            2 => Self::Warn,
            3 => Self::Info,
            4 => Self::Debug,
            _ => Self::Off,
        }
    }

    fn code(self) -> u8 {
        self.rank()
    }
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum LogEntryLevel {
    Error,
    Warn,
    Info,
    Debug,
}

impl LogEntryLevel {
    fn rank(self) -> u8 {
        match self {
            Self::Error => 1,
            Self::Warn => 2,
            Self::Info => 3,
            Self::Debug => 4,
        }
    }
}

impl TryFrom<Level> for LogEntryLevel {
    type Error = ();

    fn try_from(level: Level) -> Result<Self, ()> {
        match level {
            Level::Error => Ok(Self::Error),
            Level::Warn => Ok(Self::Warn),
            Level::Info => Ok(Self::Info),
            Level::Debug => Ok(Self::Debug),
            Level::Trace => Err(()),
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct LogEntry {
    pub timestamp: String,
    pub level: LogEntryLevel,
    pub target: String,
    pub message: String,
}

pub type LogEventSink = Arc<dyn Fn(LogEntry) + Send + Sync>;

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogsQueryRequest {
    pub level: Option<LogLevel>,
    pub target: Option<String>,
    pub keyword: Option<String>,
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogsQueryResponse {
    pub entries: Vec<LogEntry>,
    pub total: usize,
    pub files: Vec<String>,
    pub log_path: Option<String>,
    pub level: LogLevel,
}

enum WriteCommand {
    Entry(LogEntry),
}

enum ControlCommand {
    Query {
        request: LogsQueryRequest,
        reply: Sender<Result<LogsQueryResponse, String>>,
    },
    Export {
        request: LogsQueryRequest,
        reply: Sender<Result<String, String>>,
    },
    Clear {
        reply: Sender<Result<(), String>>,
    },
    #[cfg(test)]
    Flush {
        reply: Sender<Result<(), String>>,
    },
    Shutdown,
}

struct WorkerHandle {
    writes: Sender<WriteCommand>,
    controls: Sender<ControlCommand>,
    join: Option<JoinHandle<()>>,
}

impl WorkerHandle {
    fn shutdown(mut self) {
        let _ = self.controls.send(ControlCommand::Shutdown);
        if let Some(join) = self.join.take() {
            let _ = join.join();
        }
    }
}

struct WriterState {
    log_dir: PathBuf,
    file: Option<File>,
    file_size: u64,
    event_sink: Option<LogEventSink>,
}

impl WriterState {
    fn new(log_dir: PathBuf, event_sink: Option<LogEventSink>) -> Result<Self, String> {
        fs::create_dir_all(&log_dir)
            .map_err(|error| format!("create app log directory: {error}"))?;
        let (file, file_size) = open_active_file(&log_dir)?;
        enforce_total_limit(&log_dir);
        Ok(Self {
            log_dir,
            file: Some(file),
            file_size,
            event_sink,
        })
    }

    fn run(mut self, writes: Receiver<WriteCommand>, controls: Receiver<ControlCommand>) {
        loop {
            select! {
                recv(controls) -> message => {
                    self.drain_writes(&writes);
                    match message {
                        Ok(ControlCommand::Query { request, reply }) => {
                            let _ = reply.send(self.query(request));
                        }
                        Ok(ControlCommand::Export { request, reply }) => {
                            let _ = reply.send(self.export(request));
                        }
                        Ok(ControlCommand::Clear { reply }) => {
                            let _ = reply.send(self.clear());
                        }
                        #[cfg(test)]
                        Ok(ControlCommand::Flush { reply }) => {
                            let _ = reply.send(self.flush());
                        }
                        Ok(ControlCommand::Shutdown) | Err(_) => break,
                    }
                }
                recv(writes) -> message => {
                    match message {
                        Ok(WriteCommand::Entry(entry)) => {
                            let _ = self.write_entry(entry);
                        }
                        Err(_) => break,
                    }
                }
            }
        }
        let _ = self.flush();
    }

    fn drain_writes(&mut self, writes: &Receiver<WriteCommand>) {
        while let Ok(WriteCommand::Entry(entry)) = writes.try_recv() {
            let _ = self.write_entry(entry);
        }
    }

    fn write_entry(&mut self, entry: LogEntry) -> Result<(), String> {
        let mut entry = entry;
        entry.target = normalize_target(&entry.target);
        entry.message = sanitize_message(&entry.message);
        let mut line = serde_json::to_vec(&entry).map_err(|error| error.to_string())?;
        line.push(b'\n');
        if self.file_size > 0 && self.file_size + line.len() as u64 > MAX_FILE_BYTES {
            self.rotate()?;
        }
        let file = self
            .file
            .as_mut()
            .ok_or_else(|| "log file is unavailable".to_string())?;
        file.write_all(&line)
            .map_err(|error| format!("write local log: {error}"))?;
        self.file_size += line.len() as u64;
        if let Some(event_sink) = &self.event_sink {
            event_sink(entry.clone());
        }
        Ok(())
    }

    fn rotate(&mut self) -> Result<(), String> {
        if let Some(mut file) = self.file.take() {
            let _ = file.flush();
        }
        for index in (1..=MAX_ROTATED_FILES).rev() {
            let source = history_path(&self.log_dir, index);
            if index == MAX_ROTATED_FILES {
                let _ = fs::remove_file(&source);
                continue;
            }
            if source.exists() {
                fs::rename(&source, history_path(&self.log_dir, index + 1))
                    .map_err(|error| format!("rotate local log: {error}"))?;
            }
        }
        let active = active_path(&self.log_dir);
        if active.exists() {
            fs::rename(&active, history_path(&self.log_dir, 1))
                .map_err(|error| format!("rotate local log: {error}"))?;
        }
        let (file, size) = open_active_file(&self.log_dir)?;
        self.file = Some(file);
        self.file_size = size;
        enforce_total_limit(&self.log_dir);
        Ok(())
    }

    fn query(&mut self, request: LogsQueryRequest) -> Result<LogsQueryResponse, String> {
        let mut entries = Vec::new();
        for path in ordered_log_files(&self.log_dir) {
            let file = match File::open(&path) {
                Ok(file) => file,
                Err(_) => continue,
            };
            for line in BufReader::new(file).lines().map_while(Result::ok) {
                if let Ok(entry) = serde_json::from_str::<LogEntry>(&line) {
                    if matches_query(&entry, &request) {
                        entries.push(entry);
                    }
                }
            }
        }
        let total = entries.len();
        let limit = request.limit.unwrap_or(1_000).clamp(1, MAX_QUERY_LIMIT);
        entries.reverse();
        entries.truncate(limit);
        Ok(LogsQueryResponse {
            entries,
            total,
            files: managed_log_files(&self.log_dir)
                .into_iter()
                .map(|path| path.to_string_lossy().into_owned())
                .collect(),
            log_path: Some(active_path(&self.log_dir).to_string_lossy().into_owned()),
            level: LogLevel::Off,
        })
    }

    fn export(&mut self, request: LogsQueryRequest) -> Result<String, String> {
        let result = self.query(request)?;
        let path = self.log_dir.join(format!(
            "godgesture-export-{}-{}.jsonl",
            timestamp_now().replace([':', '.'], ""),
            EXPORT_COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        let mut file =
            File::create(&path).map_err(|error| format!("create log export: {error}"))?;
        for entry in result.entries {
            serde_json::to_writer(&mut file, &entry).map_err(|error| error.to_string())?;
            file.write_all(b"\n")
                .map_err(|error| format!("write log export: {error}"))?;
        }
        file.flush()
            .map_err(|error| format!("flush log export: {error}"))?;
        Ok(path.to_string_lossy().into_owned())
    }

    fn clear(&mut self) -> Result<(), String> {
        if let Some(mut file) = self.file.take() {
            let _ = file.flush();
        }
        let mut failure = None;
        for path in managed_log_files(&self.log_dir) {
            if let Err(error) = fs::remove_file(&path) {
                if error.kind() != std::io::ErrorKind::NotFound && failure.is_none() {
                    failure = Some(format!("clear local logs: {error}"));
                }
            }
        }
        let (file, size) = open_active_file(&self.log_dir)?;
        self.file = Some(file);
        self.file_size = size;
        failure.map_or(Ok(()), Err)
    }

    fn flush(&mut self) -> Result<(), String> {
        self.file
            .as_mut()
            .ok_or_else(|| "log file is unavailable".to_string())?
            .flush()
            .map_err(|error| format!("flush local log: {error}"))
    }
}

pub struct LoggingService {
    level: AtomicU8,
    worker: RwLock<Option<WorkerHandle>>,
    settings_path: RwLock<Option<PathBuf>>,
}

impl LoggingService {
    pub fn new() -> Self {
        Self {
            level: AtomicU8::new(LogLevel::Off.code()),
            worker: RwLock::new(None),
            settings_path: RwLock::new(None),
        }
    }

    pub fn install_global(service: Arc<Self>) -> Result<(), log::SetLoggerError> {
        let logger = GlobalLogger(service);
        log::set_boxed_logger(Box::new(logger))?;
        log::set_max_level(LevelFilter::Debug);
        Ok(())
    }

    pub fn configure(
        &self,
        log_dir: PathBuf,
        settings_path: PathBuf,
        event_sink: Option<LogEventSink>,
    ) -> Result<(), String> {
        let level = load_level(&settings_path);
        let state = WriterState::new(log_dir, event_sink)?;
        let (writes_tx, writes_rx) = bounded(WRITE_QUEUE_CAPACITY);
        let (controls_tx, controls_rx) = unbounded();
        let join = thread::Builder::new()
            .name("godgesture-log-writer".into())
            .spawn(move || state.run(writes_rx, controls_rx))
            .map_err(|error| format!("start local log writer: {error}"))?;
        let worker = WorkerHandle {
            writes: writes_tx,
            controls: controls_tx,
            join: Some(join),
        };
        if let Some(previous) = self.worker.write().replace(worker) {
            previous.shutdown();
        }
        *self.settings_path.write() = Some(settings_path);
        self.level.store(level.code(), Ordering::Release);
        Ok(())
    }

    pub fn level(&self) -> LogLevel {
        LogLevel::from_code(self.level.load(Ordering::Acquire))
    }

    pub fn set_level(&self, next: LogLevel) -> Result<LogLevel, String> {
        let previous = self.level();
        self.level.store(next.code(), Ordering::Release);
        if let Some(path) = self.settings_path.read().clone() {
            if let Err(error) = persist_level(&path, next) {
                self.level.store(previous.code(), Ordering::Release);
                return Err(error);
            }
        }
        Ok(next)
    }

    pub fn write_user(
        &self,
        level: LogEntryLevel,
        target: &str,
        message: &str,
    ) -> Result<(), String> {
        if !self.level().accepts(level) {
            return Ok(());
        }
        self.enqueue(LogEntry {
            timestamp: timestamp_now(),
            level,
            target: normalize_target(target),
            message: sanitize_message(message),
        })
    }

    pub fn query(&self, request: &LogsQueryRequest) -> Result<LogsQueryResponse, String> {
        let (reply_tx, reply_rx) = bounded(1);
        self.send_control(ControlCommand::Query {
            request: request.clone(),
            reply: reply_tx,
        })?;
        let mut result = reply_rx
            .recv_timeout(CONTROL_TIMEOUT)
            .map_err(|error| format!("query local logs: {error}"))??;
        result.level = self.level();
        Ok(result)
    }

    pub fn export(&self, request: &LogsQueryRequest) -> Result<String, String> {
        let (reply_tx, reply_rx) = bounded(1);
        self.send_control(ControlCommand::Export {
            request: request.clone(),
            reply: reply_tx,
        })?;
        reply_rx
            .recv_timeout(CONTROL_TIMEOUT)
            .map_err(|error| format!("export local logs: {error}"))?
    }

    pub fn clear(&self) -> Result<(), String> {
        let (reply_tx, reply_rx) = bounded(1);
        self.send_control(ControlCommand::Clear { reply: reply_tx })?;
        reply_rx
            .recv_timeout(CONTROL_TIMEOUT)
            .map_err(|error| format!("clear local logs: {error}"))?
    }

    fn enqueue(&self, entry: LogEntry) -> Result<(), String> {
        let worker = self.worker.read();
        let Some(worker) = worker.as_ref() else {
            return Err("local log service is not configured".into());
        };
        match worker.writes.try_send(WriteCommand::Entry(entry)) {
            Ok(()) => Ok(()),
            Err(TrySendError::Full(_)) => Err("local log queue is full".into()),
            Err(TrySendError::Disconnected(_)) => Err("local log writer is unavailable".into()),
        }
    }

    fn send_control(&self, command: ControlCommand) -> Result<(), String> {
        let worker = self.worker.read();
        let Some(worker) = worker.as_ref() else {
            return Err("local log service is not configured".into());
        };
        worker
            .controls
            .send(command)
            .map_err(|error| format!("send local log command: {error}"))
    }

    #[cfg(test)]
    fn for_test(log_dir: PathBuf) -> Result<Self, String> {
        let service = Self::new();
        service.configure(log_dir.clone(), log_dir.join("level.json"), None)?;
        Ok(service)
    }

    #[cfg(test)]
    fn flush_for_test(&self) {
        let (reply_tx, reply_rx) = bounded(1);
        if self
            .send_control(ControlCommand::Flush { reply: reply_tx })
            .is_ok()
        {
            let _ = reply_rx.recv_timeout(CONTROL_TIMEOUT);
        }
    }

    #[cfg(test)]
    fn log_files_for_test(&self) -> Vec<PathBuf> {
        let worker = self.worker.read();
        let Some(worker) = worker.as_ref() else {
            return Vec::new();
        };
        let (reply_tx, reply_rx) = bounded(1);
        if worker
            .controls
            .send(ControlCommand::Query {
                request: LogsQueryRequest::default(),
                reply: reply_tx,
            })
            .is_err()
        {
            return Vec::new();
        }
        reply_rx
            .recv_timeout(CONTROL_TIMEOUT)
            .ok()
            .and_then(Result::ok)
            .map(|response| response.files.into_iter().map(PathBuf::from).collect())
            .unwrap_or_default()
    }
}

impl Drop for LoggingService {
    fn drop(&mut self) {
        if let Some(worker) = self.worker.get_mut().take() {
            worker.shutdown();
        }
    }
}

struct GlobalLogger(Arc<LoggingService>);

impl Log for GlobalLogger {
    fn enabled(&self, metadata: &Metadata<'_>) -> bool {
        self.0.enabled_level(metadata.level())
    }

    fn log(&self, record: &Record<'_>) {
        let Some(level) = LogEntryLevel::try_from(record.level()).ok() else {
            return;
        };
        if !self.0.level().accepts(level) {
            return;
        }
        let _ = self.0.enqueue(LogEntry {
            timestamp: timestamp_now(),
            level,
            target: normalize_target(record.target()),
            message: sanitize_message(&record.args().to_string()),
        });
    }

    fn flush(&self) {}
}

impl LoggingService {
    fn enabled_level(&self, level: Level) -> bool {
        LogEntryLevel::try_from(level)
            .map(|entry_level| self.level().accepts(entry_level))
            .unwrap_or(false)
    }
}

fn active_path(log_dir: &Path) -> PathBuf {
    log_dir.join(ACTIVE_FILE_NAME)
}

fn history_path(log_dir: &Path, index: usize) -> PathBuf {
    log_dir.join(format!("{ACTIVE_FILE_NAME}.{index}"))
}

fn managed_log_files(log_dir: &Path) -> Vec<PathBuf> {
    let mut files = vec![active_path(log_dir)];
    files.extend((1..=MAX_ROTATED_FILES).filter_map(|index| {
        let path = history_path(log_dir, index);
        path.is_file().then_some(path)
    }));
    files
}

fn ordered_log_files(log_dir: &Path) -> Vec<PathBuf> {
    let mut files = (1..=MAX_ROTATED_FILES)
        .rev()
        .filter_map(|index| {
            let path = history_path(log_dir, index);
            path.is_file().then_some(path)
        })
        .collect::<Vec<_>>();
    let active = active_path(log_dir);
    if active.is_file() {
        files.push(active);
    }
    files
}

fn open_active_file(log_dir: &Path) -> Result<(File, u64), String> {
    fs::create_dir_all(log_dir).map_err(|error| format!("create app log directory: {error}"))?;
    let path = active_path(log_dir);
    let file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|error| format!("open local log: {error}"))?;
    let size = file
        .metadata()
        .map_err(|error| format!("stat local log: {error}"))?
        .len();
    Ok((file, size))
}

fn enforce_total_limit(log_dir: &Path) {
    let mut files = managed_log_files(log_dir);
    let mut history_total = files
        .iter()
        .skip(1)
        .filter_map(|path| fs::metadata(path).ok().map(|metadata| metadata.len()))
        .sum::<u64>();
    for path in files.drain(1..).rev() {
        if history_total <= MAX_HISTORY_BYTES {
            break;
        }
        if let Ok(size) = fs::metadata(&path).map(|metadata| metadata.len()) {
            let _ = fs::remove_file(&path);
            history_total = history_total.saturating_sub(size);
        }
    }
}

fn matches_query(entry: &LogEntry, request: &LogsQueryRequest) -> bool {
    if let Some(level) = request.level {
        if level != LogLevel::Off && entry.level != level.into() {
            return false;
        }
    }
    if let Some(target) = request
        .target
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
    {
        if !entry
            .target
            .to_ascii_lowercase()
            .contains(&target.to_ascii_lowercase())
        {
            return false;
        }
    }
    if let Some(keyword) = request
        .keyword
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
    {
        let text = format!("{} {}", entry.target, entry.message).to_ascii_lowercase();
        if !text.contains(&keyword.to_ascii_lowercase()) {
            return false;
        }
    }
    true
}

impl From<LogLevel> for LogEntryLevel {
    fn from(level: LogLevel) -> Self {
        match level {
            LogLevel::Error => Self::Error,
            LogLevel::Warn => Self::Warn,
            LogLevel::Info => Self::Info,
            LogLevel::Debug | LogLevel::Off => Self::Debug,
        }
    }
}

fn load_level(path: &Path) -> LogLevel {
    fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str::<PersistedLevel>(&text).ok())
        .map(|value| value.level)
        .unwrap_or_default()
}

fn persist_level(path: &Path, level: LogLevel) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("create log settings directory: {error}"))?;
    }
    let content =
        serde_json::to_vec(&PersistedLevel { level }).map_err(|error| error.to_string())?;
    fs::write(path, content).map_err(|error| format!("save log level: {error}"))
}

#[derive(Deserialize, Serialize)]
struct PersistedLevel {
    level: LogLevel,
}

fn normalize_target(target: &str) -> String {
    let target = match target {
        "capture" | "hotkey" => "gesture.capture",
        "window" => "app.lifecycle",
        value if value.contains("node_host") => "node.supervisor",
        value if value.contains("node_service") || value.contains("node_packages") => {
            "node.supervisor"
        }
        value if value.contains("plugin_workspace") => "plugin.workspace",
        value if value.contains("platform::windows") => "platform.windows",
        value if value.contains("platform::macos") => "platform.macos",
        value if value.contains("engine::config") => "config",
        value
            if value.contains("engine::runtime")
                || value.contains("engine::parser")
                || value.contains("engine::tracker")
                || value.contains("engine::boundary") =>
        {
            "gesture.runtime"
        }
        value if value.contains("account") || value.contains("cloud") => "cloud",
        value if value.contains("lib") => "app.lifecycle",
        value => value,
    };
    sanitize_target(target)
}

fn sanitize_target(target: &str) -> String {
    truncate_chars(
        &target
            .chars()
            .map(|character| {
                if character.is_control() || character.is_whitespace() {
                    '_'
                } else {
                    character
                }
            })
            .collect::<String>(),
        MAX_TARGET_CHARS,
    )
}

fn sanitize_message(message: &str) -> String {
    let normalized = message.replace("\r\n", "\n").replace('\r', "\n");
    let clean = normalized
        .chars()
        .map(|character| {
            if character == '\t' || character == '\n' {
                character
            } else if character.is_control() {
                ' '
            } else {
                character
            }
        })
        .collect::<String>();
    truncate_chars(&redact_sensitive(&clean), MAX_MESSAGE_CHARS)
}

fn redact_sensitive(input: &str) -> String {
    let mut value = redact_bearer(input);
    for key in [
        "password",
        "passwd",
        "secret",
        "access_token",
        "access-token",
        "accesstoken",
        "refresh_token",
        "refresh-token",
        "refreshtoken",
        "auth_token",
        "auth-token",
        "authtoken",
        "token",
        "authorization",
        "cookie",
        "verification_code",
        "verification-code",
        "verificationcode",
        "clipboard",
    ] {
        value = redact_key_value(&value, key);
    }
    value
}

fn redact_bearer(input: &str) -> String {
    let lower = input.to_ascii_lowercase();
    let mut cursor = 0;
    let mut output = String::new();
    while let Some(relative) = lower[cursor..].find("bearer ") {
        let start = cursor + relative;
        if start > 0
            && input[..start]
                .chars()
                .next_back()
                .is_some_and(|c| c.is_alphanumeric())
        {
            let character = input[cursor..].chars().next().unwrap();
            output.push(character);
            cursor += character.len_utf8();
            continue;
        }
        let token_start = start + "bearer ".len();
        let token_end = input[token_start..]
            .char_indices()
            .find(|(_, character)| character.is_whitespace())
            .map(|(index, _)| token_start + index)
            .unwrap_or(input.len());
        output.push_str(&input[cursor..start]);
        output.push_str("Bearer [redacted]");
        cursor = token_end;
    }
    output.push_str(&input[cursor..]);
    output
}

fn redact_key_value(input: &str, key: &str) -> String {
    let lower = input.to_ascii_lowercase();
    let mut cursor = 0;
    let mut output = String::new();
    while cursor < input.len() {
        let Some(relative) = lower[cursor..].find(key) else {
            output.push_str(&input[cursor..]);
            break;
        };
        let start = cursor + relative;
        let before_ok = start == 0
            || !input[..start]
                .chars()
                .next_back()
                .is_some_and(|c| c.is_alphanumeric() || c == '_');
        let key_end = start + key.len();
        let after_ok = key_end >= input.len()
            || !input[key_end..]
                .chars()
                .next()
                .is_some_and(|c| c.is_alphanumeric() || c == '_');
        if !before_ok || !after_ok {
            let character = input[cursor..].chars().next().unwrap();
            output.push(character);
            cursor += character.len_utf8();
            continue;
        }
        let mut separator = key_end;
        while separator < input.len()
            && input[separator..]
                .chars()
                .next()
                .is_some_and(|c| c.is_ascii_whitespace())
        {
            separator += input[separator..].chars().next().unwrap().len_utf8();
        }
        if input[separator..].starts_with('"') {
            separator += 1;
            while separator < input.len()
                && input[separator..]
                    .chars()
                    .next()
                    .is_some_and(|c| c.is_ascii_whitespace())
            {
                separator += input[separator..].chars().next().unwrap().len_utf8();
            }
        }
        let Some(separator_char) = input[separator..].chars().next() else {
            let character = input[cursor..].chars().next().unwrap();
            output.push(character);
            cursor += character.len_utf8();
            continue;
        };
        if !matches!(separator_char, '=' | ':') {
            let character = input[cursor..].chars().next().unwrap();
            output.push(character);
            cursor += character.len_utf8();
            continue;
        }
        separator += separator_char.len_utf8();
        while separator < input.len()
            && input[separator..]
                .chars()
                .next()
                .is_some_and(|c| c.is_ascii_whitespace())
        {
            separator += input[separator..].chars().next().unwrap().len_utf8();
        }
        let quoted = input[separator..].starts_with('"');
        let value_start = if quoted { separator + 1 } else { separator };
        let value_end = if quoted {
            let mut escaped = false;
            input[value_start..]
                .char_indices()
                .find(|(_, character)| {
                    if escaped {
                        escaped = false;
                        return false;
                    }
                    if *character == '\\' {
                        escaped = true;
                        return false;
                    }
                    *character == '"'
                })
                .map(|(index, _)| value_start + index)
                .unwrap_or(input.len())
        } else {
            input[value_start..]
                .char_indices()
                .find(|(_, character)| {
                    character.is_whitespace() || matches!(character, ',' | ';' | '}' | ']' | '&')
                })
                .map(|(index, _)| value_start + index)
                .unwrap_or(input.len())
        };
        output.push_str(&input[cursor..value_start]);
        output.push_str("[redacted]");
        cursor = value_end;
    }
    output
}

fn truncate_chars(value: &str, max: usize) -> String {
    if value.chars().count() <= max {
        return value.to_string();
    }
    let suffix = "...[truncated]";
    if max <= suffix.chars().count() {
        return suffix.chars().take(max).collect();
    }
    value
        .chars()
        .take(max - suffix.chars().count())
        .collect::<String>()
        + suffix
}

fn timestamp_now() -> String {
    let elapsed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let seconds = elapsed.as_secs();
    let days = (seconds / 86_400) as i64;
    let day_seconds = seconds % 86_400;
    let (year, month, day) = civil_from_days(days);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{:03}Z",
        day_seconds / 3_600,
        (day_seconds / 60) % 60,
        day_seconds % 60,
        elapsed.subsec_millis()
    )
}

fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let month_part = (5 * doy + 2) / 153;
    let day = doy - (153 * month_part + 2) / 5 + 1;
    let month = month_part + if month_part < 10 { 3 } else { -9 };
    let year = year + i64::from(month <= 2);
    (year, month, day)
}
