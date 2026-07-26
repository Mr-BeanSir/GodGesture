//! 剪贴板读写(Unicode 文本)与"取选中文本"。
//!
//! WebSearch / Cmd 需要当前选中文本:WGestures 的做法是合成 Ctrl+C 让目标程序
//! 把选区写入剪贴板,再读回。为不打扰用户,这里**先保存原剪贴板,取完再恢复**。
//!
//! CF_UNICODETEXT 直接用字面量 13u32(避免常量在不同 features 下的路径不确定)。

use std::time::Duration;
use windows::Win32::Foundation::{GlobalFree, HANDLE, HGLOBAL};
use windows::Win32::System::DataExchange::{
    CloseClipboard, EmptyClipboard, GetClipboardData, OpenClipboard, SetClipboardData,
};
use windows::Win32::System::Memory::{
    GlobalAlloc, GlobalLock, GlobalSize, GlobalUnlock, GMEM_MOVEABLE,
};

const CF_UNICODETEXT: u32 = 13;

/// 打开剪贴板(带重试;其它程序可能短暂占用)
fn open_clipboard() -> bool {
    for _ in 0..10 {
        if unsafe { OpenClipboard(None) }.is_ok() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(5));
    }
    false
}

/// 读取剪贴板中的 Unicode 文本(无文本/失败返回 None)
pub fn get_text() -> Option<String> {
    if !open_clipboard() {
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
                    // 用 GlobalSize 封住扫描范围:若某个程序放上来的 CF_UNICODETEXT
                    // 没有以 NUL 结尾(有 bug 的程序就会这样),无界扫描会读出分配区
                    // 之外并直接把进程读崩。
                    let max_chars = GlobalSize(hglobal) / std::mem::size_of::<u16>();
                    let mut len = 0usize;
                    while len < max_chars && *ptr.add(len) != 0 {
                        len += 1;
                    }
                    let s = String::from_utf16_lossy(std::slice::from_raw_parts(ptr, len));
                    let _ = GlobalUnlock(hglobal);
                    Some(s)
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

/// 写入 Unicode 文本到剪贴板;成功返回 true。
pub fn set_text(text: &str) -> bool {
    let utf16: Vec<u16> = text.encode_utf16().chain(std::iter::once(0)).collect();
    let bytes = utf16.len() * std::mem::size_of::<u16>();

    unsafe {
        let Ok(hmem) = GlobalAlloc(GMEM_MOVEABLE, bytes) else {
            return false;
        };
        let dst = GlobalLock(hmem) as *mut u16;
        if dst.is_null() {
            let _ = GlobalFree(Some(hmem));
            return false;
        }
        std::ptr::copy_nonoverlapping(utf16.as_ptr(), dst, utf16.len());
        let _ = GlobalUnlock(hmem);

        if !open_clipboard() {
            let _ = GlobalFree(Some(hmem));
            return false;
        }
        let _ = EmptyClipboard();
        // SetClipboardData 成功后系统接管该内存(不可再 GlobalFree);失败时由我们释放。
        let set = SetClipboardData(CF_UNICODETEXT, Some(HANDLE(hmem.0)));
        let _ = CloseClipboard();
        if set.is_err() {
            let _ = GlobalFree(Some(hmem));
            return false;
        }
    }
    true
}

/// 清空剪贴板
fn clear() {
    if open_clipboard() {
        unsafe {
            let _ = EmptyClipboard();
            let _ = CloseClipboard();
        }
    }
}

/// 取当前选中文本:保存原剪贴板 → 清空 → 合成 Ctrl+C → 轮询读回 → 恢复原剪贴板。
/// 返回本次复制到的非空文本;目标程序无选区时返回 None。
pub fn get_selected_text() -> Option<String> {
    let saved = get_text();
    clear();

    let _ = super::input::synthesize_key_combo(&["ctrl".to_string()], &["c".to_string()]);

    // 目标程序响应 Ctrl+C 需要时间,轮询至多 ~200ms
    let mut result = None;
    for _ in 0..20 {
        std::thread::sleep(Duration::from_millis(10));
        if let Some(t) = get_text() {
            if !t.is_empty() {
                result = Some(t);
                break;
            }
        }
    }

    // 恢复用户原本的剪贴板内容
    match saved {
        Some(s) => {
            if !set_text(&s) {
                log::warn!("原剪贴板内容恢复失败");
            }
        }
        None => clear(),
    }
    result
}
