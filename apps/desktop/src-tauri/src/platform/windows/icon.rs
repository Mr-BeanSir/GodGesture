//! exe 图标提取:exe 名 → 完整路径 → HICON → 32bpp 位图 → PNG(base64)。
//!
//! 设置界面的"按应用"条目只记 exe 名(如 chrome.exe),所以得先把名字还原成路径:
//! 1. 正在运行的进程 —— 枚举顶层窗口,交给 `window::window_info` 解析 exe
//!    (和手势侧走同一套 OpenProcess + QueryFullProcessImageNameW,不另起炉灶);
//! 2. 注册表 `App Paths` —— HKCU / HKLM 64 位视图 / HKLM 32 位视图的默认值。
//! 3. 系统目录与 PATH —— notepad.exe 这类系统自带程序两者都不占,只能按名字找。
//!
//! 三步都落空、或 exe 里没有图标资源时返回 None:前端契约允许 null。
//!
//! 图标位图有两种形态:32bpp 自带 alpha 通道,和老式"XOR 颜色位图 + 1bpp AND 掩码"。
//! 后者的 alpha 字节整片是 0,直接当 RGBA 用会全透明(或被当成全黑),所以要按掩码补 alpha。
//!
//! 返回的是**裸 base64**(不含 `data:image/png;base64,` 前缀),与 backend.ts 的契约一致。

use super::window;
use parking_lot::Mutex;
use std::collections::{HashMap, HashSet};
use std::path::Path;
use tiny_skia::{IntSize, Pixmap};
use windows::core::{BOOL, PCWSTR};
use windows::Win32::Foundation::{ERROR_SUCCESS, FALSE, HWND, LPARAM, TRUE};
use windows::Win32::Graphics::Gdi::{
    CreateCompatibleDC, DeleteDC, DeleteObject, GetDIBits, GetObjectW, BITMAP, BITMAPINFO,
    BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HBITMAP,
};
use windows::Win32::System::Registry::{
    RegGetValueW, HKEY, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, REG_ROUTINE_FLAGS,
    RRF_RT_REG_EXPAND_SZ, RRF_RT_REG_SZ, RRF_SUBKEY_WOW6432KEY, RRF_SUBKEY_WOW6464KEY,
};
use windows::Win32::UI::Shell::ExtractIconExW;
use windows::Win32::UI::WindowsAndMessaging::{
    DestroyIcon, EnumWindows, GetIconInfo, PrivateExtractIconsW, HICON, ICONINFO,
};

/// 目标边长:设置界面列表用 32px 足够,也是 exe 图标资源里最常见的尺寸。
const ICON_SIZE: i32 = 32;

/// 位图边长上限:超过这个尺寸的一律放弃,避免异常图标撑爆内存。
const MAX_BITMAP_SIZE: i32 = 512;

/// PrivateExtractIconsW 的路径缓冲区是定长 260(见 windows 0.62 的绑定签名)。
const PATH_BUF_LEN: usize = 260;

/// exe 名(小写)→ base64 PNG。只缓存成功结果:失败往往只是"程序还没启动",
/// 把 null 钉死会让用户启动程序后依然看不到图标。
static ICON_CACHE: Mutex<Option<HashMap<String, String>>> = Mutex::new(None);

/// 缓存条目上限(单个图标 PNG 约几 KB)
const CACHE_LIMIT: usize = 64;

/// exe 名 → 图标 PNG 的 base64;任一步失败返回 None。
pub fn app_icon_base64(exe_name: &str) -> Option<String> {
    let name = normalize_exe_name(exe_name)?;
    if let Some(hit) = ICON_CACHE
        .lock()
        .as_ref()
        .and_then(|map| map.get(&name).cloned())
    {
        return Some(hit);
    }

    let path = resolve_exe_path(&name)?;
    let png = icon_png(&path)?;
    let encoded = base64_encode(&png);

    let mut cache = ICON_CACHE.lock();
    let map = cache.get_or_insert_with(HashMap::new);
    if map.len() >= CACHE_LIMIT {
        map.clear();
    }
    map.insert(name, encoded.clone());
    Some(encoded)
}

/// 规整 exe 名:去空白与引号、只取最后一段文件名、统一小写。
/// 空串、超长、或带盘符的残缺输入返回 None(拿去比进程名/查注册表都没意义)。
fn normalize_exe_name(input: &str) -> Option<String> {
    let name = input
        .trim()
        .trim_matches('"')
        .rsplit(['\\', '/'])
        .next()
        .unwrap_or_default()
        .trim();
    if name.is_empty() || name.len() > 128 || name.contains(':') {
        return None;
    }
    Some(name.to_lowercase())
}

/// exe 名 → 完整路径:先看正在运行的进程,再查注册表 App Paths,最后按名字找系统目录/PATH。
fn resolve_exe_path(name: &str) -> Option<String> {
    path_from_running_process(name)
        .or_else(|| path_from_app_paths(name))
        .or_else(|| path_from_search_dirs(name))
}

/// 枚举顶层窗口找同名进程,命中即停止枚举。
/// 只覆盖有窗口的进程 —— 图标是给设置界面看的,没窗口的后台进程本来也不会出现在列表里。
fn path_from_running_process(name: &str) -> Option<String> {
    let mut probe = ExeProbe {
        target: name.to_string(),
        seen: HashSet::new(),
        found: None,
    };
    unsafe {
        // 回调返回 FALSE 提前结束枚举时 EnumWindows 也报错,这里不区分成功/中止。
        let _ = EnumWindows(
            Some(collect_exe_path),
            LPARAM(&mut probe as *mut ExeProbe as isize),
        );
    }
    probe.found
}

struct ExeProbe {
    target: String,
    seen: HashSet<u32>,
    found: Option<String>,
}

unsafe extern "system" fn collect_exe_path(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let probe = unsafe { &mut *(lparam.0 as *mut ExeProbe) };
    let pid = window::window_pid(hwnd);
    // 一个进程通常有多个顶层窗口,按 pid 去重,免得反复 OpenProcess
    if pid == 0 || !probe.seen.insert(pid) {
        return TRUE;
    }
    match window::window_info(hwnd) {
        // window_info 返回的 exe 名已经是小写
        Some(info) if info.exe_name == probe.target => {
            probe.found = Some(info.exe_path);
            FALSE
        }
        _ => TRUE,
    }
}

/// `App Paths\<exe 名>` 的默认值即 exe 全路径(常带引号)。
const APP_PATHS_KEY: &str = r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\";

fn path_from_app_paths(name: &str) -> Option<String> {
    // 32 位程序注册在 WOW6432Node 下,三个视图都试一遍
    let views = [
        (HKEY_CURRENT_USER, RRF_SUBKEY_WOW6464KEY),
        (HKEY_LOCAL_MACHINE, RRF_SUBKEY_WOW6464KEY),
        (HKEY_LOCAL_MACHINE, RRF_SUBKEY_WOW6432KEY),
    ];
    let subkey = format!("{APP_PATHS_KEY}{name}");
    for (root, view) in views {
        let Some(value) = reg_read_default(root, &subkey, view) else {
            continue;
        };
        let path = value.trim().trim_matches('"').trim();
        if !path.is_empty() && Path::new(path).is_file() {
            return Some(path.to_string());
        }
    }
    None
}

/// 系统目录与 PATH 里的同名 exe:notepad.exe 这类既不常驻、也没有 App Paths 项的
/// 系统自带程序只能靠这一步。名字已经过 normalize_exe_name(不含分隔符),拼不出上跳路径。
fn path_from_search_dirs(name: &str) -> Option<String> {
    let mut dirs: Vec<std::path::PathBuf> = Vec::new();
    if let Some(root) = std::env::var_os("SystemRoot") {
        let root = std::path::PathBuf::from(root);
        dirs.push(root.join("System32"));
        dirs.push(root);
    }
    if let Some(path) = std::env::var_os("PATH") {
        dirs.extend(std::env::split_paths(&path));
    }
    dirs.into_iter()
        .map(|dir| dir.join(name))
        .find(|exe| exe.is_file())
        .map(|exe| exe.to_string_lossy().into_owned())
}

/// 读子键的默认值(REG_SZ / REG_EXPAND_SZ,后者由 RegGetValueW 展开)。
fn reg_read_default(root: HKEY, subkey: &str, view: REG_ROUTINE_FLAGS) -> Option<String> {
    let subkey_w = wide(subkey);
    let mut buf = [0u16; 1024];
    let mut bytes = std::mem::size_of_val(&buf) as u32;
    let status = unsafe {
        RegGetValueW(
            root,
            PCWSTR(subkey_w.as_ptr()),
            PCWSTR::null(), // 默认值
            RRF_RT_REG_SZ | RRF_RT_REG_EXPAND_SZ | view,
            None,
            Some(buf.as_mut_ptr().cast()),
            Some(&mut bytes),
        )
    };
    if status != ERROR_SUCCESS {
        return None;
    }
    // 返回长度含结尾的 NUL;缓冲区放不下时上面已经是 ERROR_MORE_DATA
    let len = (bytes as usize / std::mem::size_of::<u16>()).min(buf.len());
    let value = String::from_utf16_lossy(&buf[..len]);
    let value = value.trim_end_matches('\0').to_string();
    if value.is_empty() {
        None
    } else {
        Some(value)
    }
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

/// HICON 的所有权守卫:任何返回路径上都会 DestroyIcon。
struct OwnedIcon(HICON);

impl Drop for OwnedIcon {
    fn drop(&mut self) {
        if !self.0.is_invalid() {
            unsafe {
                let _ = DestroyIcon(self.0);
            }
        }
    }
}

/// GetIconInfo 交出来的位图副本同样归调用方,用守卫保证每条路径都 DeleteObject。
struct OwnedBitmap(HBITMAP);

impl Drop for OwnedBitmap {
    fn drop(&mut self) {
        if !self.0.is_invalid() {
            unsafe {
                let _ = DeleteObject(self.0.into());
            }
        }
    }
}

/// exe 路径 → 图标 PNG 字节
fn icon_png(exe_path: &str) -> Option<Vec<u8>> {
    let icon = extract_icon(exe_path)?;
    let (width, height, bgra) = icon_bgra(icon.0)?;
    bgra_to_png(&bgra, width, height)
}

/// 取 exe 的第一个图标:先按目标尺寸取(PrivateExtractIconsW 会挑最接近的资源并缩放),
/// 失败再退回 ExtractIconExW 的大图标。
fn extract_icon(exe_path: &str) -> Option<OwnedIcon> {
    private_extract(exe_path, ICON_SIZE).or_else(|| extract_icon_ex(exe_path))
}

fn private_extract(exe_path: &str, size: i32) -> Option<OwnedIcon> {
    let path: Vec<u16> = exe_path.encode_utf16().collect();
    if path.len() >= PATH_BUF_LEN {
        return None; // 超长路径塞不进定长缓冲区,交给 ExtractIconExW
    }
    let mut buf = [0u16; PATH_BUF_LEN];
    buf[..path.len()].copy_from_slice(&path);

    let mut icons = [HICON::default(); 1];
    let count = unsafe { PrivateExtractIconsW(&buf, 0, size, size, Some(&mut icons), None, 0) };
    // 句柄先交给守卫再判成败,免得异常返回值下漏掉 DestroyIcon(失败时返回 0 或 u32::MAX)
    let icon = OwnedIcon(icons[0]);
    if count == 0 || count == u32::MAX || icon.0.is_invalid() {
        return None;
    }
    Some(icon)
}

fn extract_icon_ex(exe_path: &str) -> Option<OwnedIcon> {
    let path = wide(exe_path);
    let mut large = HICON::default();
    let count = unsafe { ExtractIconExW(PCWSTR(path.as_ptr()), 0, Some(&mut large), None, 1) };
    let icon = OwnedIcon(large);
    if count == 0 || count == u32::MAX || icon.0.is_invalid() {
        return None;
    }
    Some(icon)
}

/// HICON → (宽, 高, 自上而下的 32bpp BGRA)。alpha 缺失时按 AND 掩码补。
fn icon_bgra(icon: HICON) -> Option<(u32, u32, Vec<u8>)> {
    let mut info = ICONINFO::default();
    unsafe { GetIconInfo(icon, &mut info) }.ok()?;
    let color = OwnedBitmap(info.hbmColor);
    let mask = OwnedBitmap(info.hbmMask);

    if color.0.is_invalid() {
        // 单色图标(只有掩码,高度是宽度的两倍):现代 exe 基本不会出现,直接放弃
        log::debug!("图标没有颜色位图,跳过");
        return None;
    }
    let (width, height) = bitmap_size(color.0)?;
    let mut bgra = read_bgra(color.0, width, height)?;

    if !has_alpha_channel(&bgra) {
        // 老式图标:alpha 来自 1bpp AND 掩码。掩码读不到就整块按不透明处理,
        // 宁可多一圈底色,也好过整块透明。
        let mask_bgra = read_bgra(mask.0, width, height);
        apply_mask_alpha(&mut bgra, mask_bgra.as_deref());
    }
    Some((width as u32, height as u32, bgra))
}

fn bitmap_size(bmp: HBITMAP) -> Option<(i32, i32)> {
    let mut bm = BITMAP::default();
    let written = unsafe {
        GetObjectW(
            bmp.into(),
            std::mem::size_of::<BITMAP>() as i32,
            Some((&mut bm as *mut BITMAP).cast()),
        )
    };
    if written == 0
        || bm.bmWidth <= 0
        || bm.bmHeight <= 0
        || bm.bmWidth > MAX_BITMAP_SIZE
        || bm.bmHeight > MAX_BITMAP_SIZE
    {
        return None;
    }
    Some((bm.bmWidth, bm.bmHeight))
}

/// 用 GetDIBits 把位图读成自上而下的 32bpp BGRA。
/// 1bpp 掩码位图也走这里:置位像素被转成白色,清零像素是黑色。
fn read_bgra(bmp: HBITMAP, width: i32, height: i32) -> Option<Vec<u8>> {
    if bmp.is_invalid() {
        return None;
    }
    let mut info = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: width,
            biHeight: -height, // 负高度 = 自上而下
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            ..Default::default()
        },
        ..Default::default()
    };
    let mut buf = vec![0u8; width as usize * height as usize * 4];

    let dc = unsafe { CreateCompatibleDC(None) };
    if dc.is_invalid() {
        return None;
    }
    let lines = unsafe {
        GetDIBits(
            dc,
            bmp,
            0,
            height as u32,
            Some(buf.as_mut_ptr().cast()),
            &mut info,
            DIB_RGB_COLORS,
        )
    };
    unsafe {
        let _ = DeleteDC(dc);
    }
    if lines != height {
        return None;
    }
    Some(buf)
}

/// 位图里是否存在非零 alpha(全 0 视为"没有 alpha 通道")
fn has_alpha_channel(bgra: &[u8]) -> bool {
    bgra.chunks_exact(4).any(|px| px[3] != 0)
}

/// 按 AND 掩码补 alpha:掩码置位(读出来是白色)= 透明,清零(黑色)= 不透明。
/// 掩码缺失时整块按不透明处理。
fn apply_mask_alpha(bgra: &mut [u8], mask: Option<&[u8]>) {
    for (i, px) in bgra.chunks_exact_mut(4).enumerate() {
        let transparent = match mask {
            Some(m) => {
                let start = i * 4;
                m.get(start..start + 3)
                    .is_some_and(|c| c.iter().any(|v| *v != 0))
            }
            None => false,
        };
        px[3] = if transparent { 0 } else { 255 };
    }
}

/// 32bpp BGRA(直通 alpha)→ PNG 字节。与 Win32 无关,便于单测。
fn bgra_to_png(bgra: &[u8], width: u32, height: u32) -> Option<Vec<u8>> {
    let size = IntSize::from_wh(width, height)?;
    let pixmap = Pixmap::from_vec(bgra_to_rgba_premultiplied(bgra), size)?;
    pixmap.encode_png().ok()
}

/// BGRA(直通 alpha)→ RGBA(预乘)—— tiny-skia 的 Pixmap 存的是预乘值,
/// encode_png 写出前会自己反乘回直通 alpha。
fn bgra_to_rgba_premultiplied(bgra: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(bgra.len());
    for px in bgra.chunks_exact(4) {
        let (b, g, r, a) = (px[0] as u32, px[1] as u32, px[2] as u32, px[3] as u32);
        let premultiply = |c: u32| ((c * a + 127) / 255) as u8;
        out.push(premultiply(r));
        out.push(premultiply(g));
        out.push(premultiply(b));
        out.push(a as u8);
    }
    out
}

const BASE64_ALPHABET: &[u8; 64] =
    b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/// 标准字母表 + '=' 补齐的 base64(前端直接拼到 `data:image/png;base64,` 后面)
fn base64_encode(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = *chunk.get(1).unwrap_or(&0) as u32;
        let b2 = *chunk.get(2).unwrap_or(&0) as u32;
        let n = (b0 << 16) | (b1 << 8) | b2;
        let sym = |shift: u32| BASE64_ALPHABET[(n >> shift) as usize & 0x3f] as char;
        out.push(sym(18));
        out.push(sym(12));
        out.push(if chunk.len() > 1 { sym(6) } else { '=' });
        out.push(if chunk.len() > 2 { sym(0) } else { '=' });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_exe_name_takes_file_name_and_lowercases() {
        assert_eq!(normalize_exe_name("Chrome.exe").unwrap(), "chrome.exe");
        assert_eq!(normalize_exe_name("  notepad.exe  ").unwrap(), "notepad.exe");
        assert_eq!(
            normalize_exe_name(r#""C:\Program Files\App\App.exe""#).unwrap(),
            "app.exe"
        );
        assert_eq!(normalize_exe_name("C:/tools/x/Y.exe").unwrap(), "y.exe");
    }

    #[test]
    fn normalize_exe_name_rejects_garbage() {
        assert!(normalize_exe_name("").is_none());
        assert!(normalize_exe_name("   ").is_none());
        assert!(normalize_exe_name(r"C:\").is_none());
        assert!(normalize_exe_name("C:relative.exe").is_none());
        assert!(normalize_exe_name(&"a".repeat(129)).is_none());
    }

    #[test]
    fn base64_matches_rfc4648_vectors() {
        assert_eq!(base64_encode(b""), "");
        assert_eq!(base64_encode(b"f"), "Zg==");
        assert_eq!(base64_encode(b"fo"), "Zm8=");
        assert_eq!(base64_encode(b"foo"), "Zm9v");
        assert_eq!(base64_encode(b"foob"), "Zm9vYg==");
        assert_eq!(base64_encode(b"fooba"), "Zm9vYmE=");
        assert_eq!(base64_encode(b"foobar"), "Zm9vYmFy");
    }

    #[test]
    fn base64_covers_alphabet_tail() {
        // 0xFB 0xFF 0xFE 切成 62/63/63/62,正好落在 '+' 与 '/'
        assert_eq!(base64_encode(&[0xfb, 0xff, 0xfe]), "+//+");
        assert_eq!(base64_encode(&[0x00, 0x00, 0x00]), "AAAA");
    }

    #[test]
    fn alpha_channel_detection() {
        // 全 0 alpha = 老式图标(无 alpha 通道)
        assert!(!has_alpha_channel(&[1, 2, 3, 0, 4, 5, 6, 0]));
        assert!(has_alpha_channel(&[1, 2, 3, 0, 4, 5, 6, 200]));
    }

    #[test]
    fn mask_alpha_marks_set_bits_transparent() {
        let mut bgra = vec![10, 20, 30, 0, 40, 50, 60, 0];
        // 掩码按 32bpp 读出来:白色 = 置位 = 透明,黑色 = 不透明
        let mask = [255, 255, 255, 0, 0, 0, 0, 0];
        apply_mask_alpha(&mut bgra, Some(&mask));
        assert_eq!(bgra[3], 0);
        assert_eq!(bgra[7], 255);
        // 颜色不动,只改 alpha
        assert_eq!(&bgra[4..7], &[40, 50, 60]);
    }

    #[test]
    fn mask_alpha_defaults_to_opaque_without_mask() {
        let mut bgra = vec![10, 20, 30, 0];
        apply_mask_alpha(&mut bgra, None);
        assert_eq!(bgra[3], 255);
    }

    #[test]
    fn premultiply_scales_color_by_alpha() {
        // 不透明像素原样搬(顺序 BGRA → RGBA)
        assert_eq!(
            bgra_to_rgba_premultiplied(&[10, 20, 30, 255]),
            vec![30, 20, 10, 255]
        );
        // 全透明像素预乘后是 0,不会留下黑边
        assert_eq!(bgra_to_rgba_premultiplied(&[10, 20, 30, 0]), vec![0, 0, 0, 0]);
        // 半透明:颜色按 alpha 缩放,且不超过 alpha(Pixmap 的预乘不变式)
        let half = bgra_to_rgba_premultiplied(&[0, 0, 200, 128]);
        assert_eq!(half[3], 128);
        assert!(half[0] <= half[3]);
        assert_eq!(half[0], ((200 * 128 + 127) / 255) as u8);
    }

    #[test]
    fn png_round_trip_keeps_colors_and_alpha() {
        // 2x1:不透明红 + 全透明像素
        let bgra = [0, 0, 255, 255, 9, 9, 9, 0];
        let png = bgra_to_png(&bgra, 2, 1).expect("PNG 编码失败");
        assert_eq!(&png[..8], b"\x89PNG\r\n\x1a\n");

        let decoded = Pixmap::decode_png(&png).expect("PNG 解码失败");
        assert_eq!((decoded.width(), decoded.height()), (2, 1));
        let px = decoded.pixels();
        assert_eq!(
            (px[0].red(), px[0].green(), px[0].blue(), px[0].alpha()),
            (255, 0, 0, 255)
        );
        assert_eq!(px[1].alpha(), 0);
    }

    #[test]
    fn png_size_must_match_pixel_count() {
        assert!(bgra_to_png(&[0, 0, 0, 255], 2, 2).is_none());
        assert!(bgra_to_png(&[], 0, 0).is_none());
    }

    /// 老式图标(24bpp 颜色位图 + 1bpp AND 掩码,没有 alpha 通道)现造一个,
    /// 跑完整条 HICON → BGRA → 掩码补 alpha → PNG 的链路。不依赖任何已安装程序。
    #[test]
    fn legacy_masked_icon_keeps_colors_and_transparency() {
        use windows::Win32::UI::WindowsAndMessaging::CreateIcon;

        const W: usize = 8;
        const H: usize = 8;
        // AND 掩码:1bpp,每行按 WORD 对齐补到 2 字节。上半透明(置位),下半不透明。
        let mut and_bits = [0u8; H * 2];
        for row in and_bits.chunks_exact_mut(2).take(H / 2) {
            row[0] = 0xff;
        }
        // XOR 颜色位:每像素 BGRA,整片红色且 alpha 全 0 —— 正是"有颜色没 alpha 通道"的老图标
        let mut xor_bits = [0u8; W * H * 4];
        for px in xor_bits.chunks_exact_mut(4) {
            px[2] = 255;
        }

        let icon = unsafe {
            CreateIcon(
                None,
                W as i32,
                H as i32,
                1,
                32,
                and_bits.as_ptr(),
                xor_bits.as_ptr(),
            )
        }
        .map(OwnedIcon)
        .expect("CreateIcon 失败");

        let (width, height, bgra) = icon_bgra(icon.0).expect("图标位图读取失败");
        assert_eq!((width, height), (W as u32, H as u32));

        let png = bgra_to_png(&bgra, width, height).expect("PNG 编码失败");
        let decoded = Pixmap::decode_png(&png).expect("PNG 解码失败");
        let pixels = decoded.pixels();

        // 上半:掩码置位 → 透明;下半:不透明的红色。整块透明或整块黑都算回归。
        assert_eq!(pixels[0].alpha(), 0, "掩码置位处应透明");
        let bottom = pixels[W * (H - 1)];
        assert_eq!(
            (bottom.red(), bottom.green(), bottom.blue(), bottom.alpha()),
            (255, 0, 0, 255),
            "掩码清零处应是不透明原色"
        );
        assert_eq!(pixels.iter().filter(|p| p.alpha() == 255).count(), W * H / 2);
    }

    #[test]
    fn unresolvable_exe_name_returns_none() {
        // 既没这个进程也没这条注册表项 —— 契约允许返回 null
        assert!(app_icon_base64("godgesture-does-not-exist.exe").is_none());
        assert!(app_icon_base64("").is_none());
    }
}
