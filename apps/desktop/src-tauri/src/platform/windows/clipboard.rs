//! 剪贴板读取与“取选中文本”。
//!
//! Ctrl+C 会让目标程序替换系统剪贴板。为了不破坏用户原有的图片、文件、HTML、
//! RTF 和延迟渲染格式，完整的 OLE `IDataObject` 必须在同一个 STA 线程中保存和
//! 恢复。调用方仍使用同步接口；所有 OLE 工作都串行投递到独立 worker。

use std::sync::{mpsc, OnceLock};
use std::time::{Duration, Instant};
use windows::Win32::Foundation::HGLOBAL;
use windows::Win32::System::Com::IDataObject;
use windows::Win32::System::DataExchange::{
    CloseClipboard, GetClipboardData, GetClipboardSequenceNumber, OpenClipboard,
};
use windows::Win32::System::Memory::{GlobalLock, GlobalSize, GlobalUnlock};
use windows::Win32::System::Ole::{
    OleFlushClipboard, OleGetClipboard, OleInitialize, OleSetClipboard, OleUninitialize,
};
use windows::Win32::UI::WindowsAndMessaging::{
    DispatchMessageW, PeekMessageW, TranslateMessage, MSG, PM_REMOVE, WM_QUIT,
};

const CF_UNICODETEXT: u32 = 13;
const OPEN_RETRIES: usize = 10;
const OPEN_RETRY_DELAY: Duration = Duration::from_millis(5);
const COPY_POLL_ATTEMPTS: usize = 50;
const COPY_POLL_DELAY: Duration = Duration::from_millis(10);
const WORKER_REPLY_TIMEOUT: Duration = Duration::from_secs(3);
const STA_PUMP_INTERVAL: Duration = Duration::from_millis(10);

struct ClipboardRequest {
    reply: mpsc::SyncSender<Option<String>>,
    deadline: Instant,
}

static CLIPBOARD_WORKER: OnceLock<Result<mpsc::SyncSender<ClipboardRequest>, String>> =
    OnceLock::new();

/// 打开剪贴板用于只读访问(带重试；其它程序可能短暂占用)。
fn open_clipboard_for_read() -> bool {
    for _ in 0..OPEN_RETRIES {
        // OpenClipboard(NULL) 可以安全读取；禁止在这个打开方式下 EmptyClipboard 后
        // SetClipboardData。恢复工作全部交给 OleSetClipboard，不走该危险路径。
        if unsafe { OpenClipboard(None) }.is_ok() {
            return true;
        }
        std::thread::sleep(OPEN_RETRY_DELAY);
    }
    false
}

/// 读取剪贴板中的 Unicode 文本(无文本/失败返回 None)。
fn get_text() -> Option<String> {
    if !open_clipboard_for_read() {
        return None;
    }
    let result = unsafe {
        match GetClipboardData(CF_UNICODETEXT) {
            Ok(handle) if !handle.is_invalid() => {
                let hglobal = HGLOBAL(handle.0);
                let ptr = GlobalLock(hglobal) as *const u16;
                if ptr.is_null() {
                    None
                } else {
                    // 用 GlobalSize 封住扫描范围，避免无 NUL 的损坏数据越界读取。
                    let max_chars = GlobalSize(hglobal) / std::mem::size_of::<u16>();
                    let mut len = 0usize;
                    while len < max_chars && *ptr.add(len) != 0 {
                        len += 1;
                    }
                    let text = String::from_utf16_lossy(std::slice::from_raw_parts(ptr, len));
                    let _ = GlobalUnlock(hglobal);
                    Some(text)
                }
            }
            _ => None,
        }
    };
    unsafe {
        let _ = CloseClipboard();
    }
    result
}

fn start_clipboard_worker() -> Result<mpsc::SyncSender<ClipboardRequest>, String> {
    let (request_tx, request_rx) = mpsc::sync_channel::<ClipboardRequest>(1);
    let (ready_tx, ready_rx) = mpsc::sync_channel::<Result<(), String>>(0);

    std::thread::Builder::new()
        .name("gg-clipboard-sta".into())
        .spawn(move || {
            let initialized =
                unsafe { OleInitialize(None) }.map_err(|e| format!("OleInitialize 失败: {e}"));
            let ready = initialized.is_ok();
            let _ = ready_tx.send(initialized);
            if !ready {
                return;
            }

            loop {
                match request_rx.recv_timeout(STA_PUMP_INTERVAL) {
                    Ok(request) => {
                        // 调用方已经超时的排队请求不能在很久以后突然发送 Ctrl+C。
                        if Instant::now() < request.deadline {
                            let result = capture_selected_text();
                            let _ = request.reply.send(result);
                        }
                    }
                    Err(mpsc::RecvTimeoutError::Timeout) => {}
                    Err(mpsc::RecvTimeoutError::Disconnected) => break,
                }
                // OLE STA 必须泵消息。通常 OleFlushClipboard 会把格式全部实体化；若某个
                // clipboard owner 不支持 flush，消息泵仍能让恢复后的代理 IDataObject 工作。
                if !pump_sta_messages() {
                    break;
                }
            }

            unsafe { OleUninitialize() };
        })
        .map_err(|e| format!("创建 clipboard STA worker 失败: {e}"))?;

    match ready_rx.recv_timeout(WORKER_REPLY_TIMEOUT) {
        Ok(Ok(())) => Ok(request_tx),
        Ok(Err(e)) => Err(e),
        Err(e) => Err(format!("clipboard STA worker 初始化超时: {e}")),
    }
}

fn pump_sta_messages() -> bool {
    let mut message = MSG::default();
    unsafe {
        while PeekMessageW(&mut message, None, 0, 0, PM_REMOVE).as_bool() {
            if message.message == WM_QUIT {
                return false;
            }
            let _ = TranslateMessage(&message);
            DispatchMessageW(&message);
        }
    }
    true
}

fn clipboard_worker() -> Option<&'static mpsc::SyncSender<ClipboardRequest>> {
    match CLIPBOARD_WORKER.get_or_init(start_clipboard_worker) {
        Ok(worker) => Some(worker),
        Err(e) => {
            log::error!("剪贴板 worker 不可用: {e}");
            None
        }
    }
}

/// 保存一个序列号稳定的完整 OLE clipboard 对象。
fn snapshot_clipboard() -> Result<(IDataObject, u32), String> {
    let mut last_error = None;
    for _ in 0..OPEN_RETRIES {
        let before = unsafe { GetClipboardSequenceNumber() };
        match unsafe { OleGetClipboard() } {
            Ok(snapshot) => {
                let after = unsafe { GetClipboardSequenceNumber() };
                if before == after {
                    return Ok((snapshot, after));
                }
                last_error = Some("快照期间 clipboard sequence 发生变化".to_string());
            }
            Err(e) => last_error = Some(format!("OleGetClipboard 失败: {e}")),
        }
        std::thread::sleep(OPEN_RETRY_DELAY);
    }
    Err(last_error.unwrap_or_else(|| "无法取得 clipboard 快照".to_string()))
}

fn restore_clipboard(snapshot: &IDataObject) -> Result<(), String> {
    let mut last_error = None;
    for _ in 0..OPEN_RETRIES {
        match unsafe { OleSetClipboard(snapshot) } {
            Ok(()) => {
                // 把延迟渲染格式实体化并解除对原 clipboard owner 生命周期的依赖。
                // 即使 flush 失败，OleSetClipboard 已经恢复了 IDataObject，仍保留它。
                if let Err(e) = unsafe { OleFlushClipboard() } {
                    log::warn!("剪贴板已恢复，但 OleFlushClipboard 失败: {e}");
                }
                return Ok(());
            }
            Err(e) => last_error = Some(e),
        }
        std::thread::sleep(OPEN_RETRY_DELAY);
    }
    Err(format!(
        "OleSetClipboard 失败: {}",
        last_error
            .map(|e| e.to_string())
            .unwrap_or_else(|| "unknown error".to_string())
    ))
}

fn wait_for_sequence_change(initial: u32) -> Option<u32> {
    wait_for_sequence_change_with(
        initial,
        COPY_POLL_ATTEMPTS,
        || unsafe { GetClipboardSequenceNumber() },
        || std::thread::sleep(COPY_POLL_DELAY),
    )
}

fn wait_for_sequence_change_with(
    initial: u32,
    attempts: usize,
    mut current_sequence: impl FnMut() -> u32,
    mut wait: impl FnMut(),
) -> Option<u32> {
    for _ in 0..attempts {
        wait();
        let current = current_sequence();
        if current != initial {
            return Some(current);
        }
    }
    None
}

fn capture_selected_text() -> Option<String> {
    let (snapshot, initial_sequence) = match snapshot_clipboard() {
        Ok(snapshot) => snapshot,
        Err(e) => {
            // 没有可靠快照就不发送 Ctrl+C，宁可本次取词失败也不破坏用户数据。
            log::warn!("无法保护原剪贴板，已取消取选中文本: {e}");
            return None;
        }
    };

    if let Err(e) = super::input::synthesize_key_combo(&["ctrl".to_string()], &["c".to_string()]) {
        log::warn!("发送 Ctrl+C 失败: {e}");
    }

    let Some(copied_sequence) = wait_for_sequence_change(initial_sequence) else {
        // 未发生写入，原 IDataObject 仍在 clipboard，无需重复设置或改变 sequence。
        return None;
    };

    let selected = get_text().filter(|text| !text.is_empty());

    // 读取后若 clipboard 又被其它程序改过，不覆盖更新的数据。检查与 OleSetClipboard
    // 之间仍有极窄竞态，但比无条件恢复安全；Win32/OLE 没有跨进程 CAS 原语。
    let current_sequence = unsafe { GetClipboardSequenceNumber() };
    if current_sequence == copied_sequence {
        if let Err(e) = restore_clipboard(&snapshot) {
            log::error!("原剪贴板完整格式恢复失败: {e}");
        }
    } else {
        log::warn!(
            "取选中文本期间剪贴板再次变化(sequence {copied_sequence} -> {current_sequence})，跳过恢复以免覆盖新内容"
        );
    }

    selected
}

/// 取得当前选中文本。工作在独立 OLE STA worker，调用方同步等待有限时间。
pub fn get_selected_text() -> Option<String> {
    let worker = clipboard_worker()?;
    let (reply_tx, reply_rx) = mpsc::sync_channel(1);
    let request = ClipboardRequest {
        reply: reply_tx,
        deadline: Instant::now() + WORKER_REPLY_TIMEOUT,
    };
    match worker.try_send(request) {
        Ok(()) => {}
        Err(mpsc::TrySendError::Full(_)) => {
            log::warn!("剪贴板 worker 正忙，已跳过本次取选中文本");
            return None;
        }
        Err(mpsc::TrySendError::Disconnected(_)) => {
            log::error!("剪贴板 worker 已断开");
            return None;
        }
    }
    match reply_rx.recv_timeout(WORKER_REPLY_TIMEOUT) {
        Ok(result) => result,
        Err(e) => {
            log::warn!("等待剪贴板 worker 超时: {e}");
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    #[test]
    fn sequence_poll_returns_the_first_change() {
        let samples = [41, 41, 42, 43];
        let index = Cell::new(0usize);
        let waits = Cell::new(0usize);
        let changed = wait_for_sequence_change_with(
            41,
            samples.len(),
            || {
                let i = index.get();
                index.set(i + 1);
                samples[i]
            },
            || waits.set(waits.get() + 1),
        );
        assert_eq!(changed, Some(42));
        assert_eq!(waits.get(), 3);
    }

    #[test]
    fn sequence_poll_times_out_without_treating_old_clipboard_as_selection() {
        let waits = Cell::new(0usize);
        let changed = wait_for_sequence_change_with(9, 4, || 9, || waits.set(waits.get() + 1));
        assert_eq!(changed, None);
        assert_eq!(waits.get(), 4);
    }

    #[test]
    fn sequence_wraparound_is_still_a_change() {
        let changed = wait_for_sequence_change_with(u32::MAX, 1, || 0, || {});
        assert_eq!(changed, Some(0));
    }
}
