//! 轨迹覆盖层 —— 原生分层窗口(ADR-0006),复刻 WGestures CanvasWindow 行为:
//! - 自注册窗口类,WS_EX_LAYERED | TOPMOST | TOOLWINDOW | NOACTIVATE | TRANSPARENT,
//!   点击穿透、不抢焦点、不出现在 Alt-Tab;
//! - 覆盖手势起点所在显示器;
//! - tiny-skia 画轨迹(白色描边打底 + 按触发键配色的主线,圆头圆角),
//!   识别/未识别以颜色区分;
//! - 淡出:UpdateLayeredWindow 只改 SourceConstantAlpha,零重绘成本;
//! - 独立线程 + 消息泵,外部经 channel + WM_APP 唤醒。
//!
//! 命令提示标签(文字)在 M1 后段接入(需字形栅格化)。

use crate::engine::types::Point;
use crossbeam_channel::{unbounded, Receiver, Sender, TryRecvError};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;
use tiny_skia::{LineCap, LineJoin, Paint, PathBuilder, Pixmap, Stroke, Transform};
use windows::core::{w, PCWSTR};
use windows::Win32::Foundation::{COLORREF, HWND, LPARAM, LRESULT, POINT, SIZE, WPARAM};
use windows::Win32::Graphics::Gdi::BLENDFUNCTION;
use windows::Win32::Graphics::Gdi::{
    BeginPaint, CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, EndPaint,
    GetMonitorInfoW, MonitorFromPoint, SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB,
    DIB_RGB_COLORS, HBITMAP, HDC, HGDIOBJ, MONITORINFO, MONITOR_DEFAULTTONEAREST, PAINTSTRUCT,
};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DispatchMessageW, GetMessageW, KillTimer, PostThreadMessageW,
    RegisterClassExW, SetTimer, SetWindowPos, ShowWindow, TranslateMessage, UpdateLayeredWindow,
    HWND_TOPMOST, MSG, SWP_NOACTIVATE, SW_HIDE, SW_SHOWNOACTIVATE, ULW_ALPHA, WM_APP, WM_PAINT,
    WM_TIMER, WNDCLASSEXW, WS_EX_LAYERED, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_EX_TOPMOST,
    WS_EX_TRANSPARENT, WS_POPUP,
};

const WM_APP_WAKE: u32 = WM_APP + 1;
const MAX_COMMANDS_PER_FRAME: usize = 64;
const FADE_TIMER_ID: usize = 1;
const FADE_STEP: u16 = 48;
const FADE_INTERVAL_MS: u32 = 30;

/// 覆盖层配色(#AARRGGBB 解析后的 premultiplied 前的原始 ARGB)
#[derive(Debug, Clone, Copy)]
pub struct TrailColors {
    pub main: u32,
    pub unrecognized: u32,
}

#[derive(Debug)]
pub enum OverlayCmd {
    Begin {
        origin: Point,
        colors: TrailColors,
        show_path: bool,
        show_label: bool,
        fade_out: bool,
    },
    Grow(Point),
    /// 当前笔画命中的意图名(None = 无匹配;轨迹变色 + 提示标签)
    Recognized(Option<String>),
    /// 手势正常结束(fade_out 则淡出,否则立即消失)
    End,
    /// 取消/超时:立即消失
    Cancel,
}

pub struct Overlay {
    tx: Sender<OverlayCmd>,
    thread_id: Arc<AtomicU32>,
}

impl Overlay {
    pub fn spawn(_app: &tauri::AppHandle) -> Self {
        let (tx, rx) = unbounded();
        let thread_id = Arc::new(AtomicU32::new(0));
        let tid_slot = Arc::clone(&thread_id);
        std::thread::Builder::new()
            .name("gg-overlay".into())
            .spawn(move || overlay_thread_main(rx, tid_slot))
            .expect("failed to spawn overlay thread");
        Self { tx, thread_id }
    }

    pub fn send(&self, cmd: OverlayCmd) {
        let _ = self.tx.send(cmd);
        let tid = self.thread_id.load(Ordering::SeqCst);
        if tid != 0 {
            unsafe {
                let _ = PostThreadMessageW(tid, WM_APP_WAKE, WPARAM(0), LPARAM(0));
            }
        }
    }
}

struct OverlayState {
    hwnd: HWND,
    mem_dc: HDC,
    dib: HBITMAP,
    old_bmp: HGDIOBJ,
    bits: *mut u8,
    width: i32,
    height: i32,
    monitor_origin: (i32, i32),
    points: Vec<Point>,
    colors: TrailColors,
    recognized: bool,
    label: Option<String>,
    show_path: bool,
    show_label: bool,
    fade_out: bool,
    visible: bool,
    alpha: u16,
    dpi_factor: f32,
    font: Option<ab_glyph::FontVec>,
}

fn overlay_thread_main(rx: Receiver<OverlayCmd>, tid_slot: Arc<AtomicU32>) {
    unsafe {
        tid_slot.store(
            windows::Win32::System::Threading::GetCurrentThreadId(),
            Ordering::SeqCst,
        );

        let hinstance = GetModuleHandleW(None).unwrap_or_default();
        let class_name = w!("GodGestureCanvas");
        let wc = WNDCLASSEXW {
            cbSize: std::mem::size_of::<WNDCLASSEXW>() as u32,
            lpfnWndProc: Some(wnd_proc),
            hInstance: hinstance.into(),
            lpszClassName: class_name,
            ..Default::default()
        };
        RegisterClassExW(&wc);

        let hwnd = match CreateWindowExW(
            WS_EX_LAYERED | WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE | WS_EX_TRANSPARENT,
            class_name,
            PCWSTR::null(),
            WS_POPUP,
            0,
            0,
            0,
            0,
            None,
            None,
            Some(hinstance.into()),
            None,
        ) {
            Ok(h) => h,
            Err(e) => {
                log::error!("覆盖层窗口创建失败: {e}");
                return;
            }
        };

        let mut state = OverlayState {
            hwnd,
            mem_dc: HDC::default(),
            dib: HBITMAP::default(),
            old_bmp: HGDIOBJ::default(),
            bits: std::ptr::null_mut(),
            width: 0,
            height: 0,
            monitor_origin: (0, 0),
            points: Vec::with_capacity(1024),
            colors: TrailColors {
                main: 0xFF27E518,
                unrecognized: 0xFFFF8040,
            },
            recognized: false,
            label: None,
            show_path: true,
            show_label: true,
            fade_out: true,
            visible: false,
            alpha: 255,
            dpi_factor: 1.0,
            font: load_label_font(),
        };

        let mut msg = MSG::default();
        while GetMessageW(&mut msg, None, 0, 0).as_bool() {
            match msg.message {
                WM_APP_WAKE => {
                    if drain_commands(&rx, &mut state) {
                        let _ = PostThreadMessageW(
                            windows::Win32::System::Threading::GetCurrentThreadId(),
                            WM_APP_WAKE,
                            WPARAM(0),
                            LPARAM(0),
                        );
                    }
                }
                WM_TIMER if msg.wParam.0 == FADE_TIMER_ID => {
                    fade_step(&mut state);
                }
                _ => {
                    let _ = TranslateMessage(&msg);
                    DispatchMessageW(&msg);
                }
            }
        }

        release_surface(&mut state);
    }
}

struct CommandBatch {
    commands: Vec<OverlayCmd>,
    has_more: bool,
}

fn take_command_batch(rx: &Receiver<OverlayCmd>, limit: usize) -> CommandBatch {
    let mut commands = Vec::with_capacity(limit);
    while commands.len() < limit {
        match rx.try_recv() {
            Ok(command) => commands.push(command),
            Err(TryRecvError::Empty) | Err(TryRecvError::Disconnected) => break,
        }
    }
    CommandBatch {
        commands,
        has_more: !rx.is_empty(),
    }
}

/// Applies at most one frame's worth of commands and reports whether another wake is required.
/// Rendering before returning prevents a continuously growing queue from starving the overlay.
fn drain_commands(rx: &Receiver<OverlayCmd>, state: &mut OverlayState) -> bool {
    let batch = take_command_batch(rx, MAX_COMMANDS_PER_FRAME);
    let mut dirty = false;
    for cmd in batch.commands {
        match cmd {
            OverlayCmd::Begin {
                origin,
                colors,
                show_path,
                show_label,
                fade_out,
            } => {
                stop_fade(state);
                state.points.clear();
                state.points.push(origin);
                state.colors = colors;
                state.recognized = false;
                state.label = None;
                state.show_path = show_path;
                state.show_label = show_label;
                state.fade_out = fade_out;
                state.alpha = 255;
                ensure_surface_for(state, origin);
                dirty = true;
            }
            OverlayCmd::Grow(p) => {
                // 距上个渲染点至少 3px 才记点(StepSize,降密)
                let step_ok = state
                    .points
                    .last()
                    .map(|last| last.dist_sq(p) >= 9)
                    .unwrap_or(true);
                if step_ok {
                    state.points.push(p);
                    dirty = true;
                }
            }
            OverlayCmd::Recognized(name) => {
                let recognized = name.is_some();
                if state.recognized != recognized || state.label != name {
                    state.recognized = recognized;
                    state.label = name;
                    dirty = true;
                }
            }
            OverlayCmd::End => {
                if state.visible {
                    if state.fade_out {
                        start_fade(state);
                    } else {
                        hide(state);
                    }
                }
                dirty = false;
                state.points.clear();
            }
            OverlayCmd::Cancel => {
                hide(state);
                dirty = false;
                state.points.clear();
            }
        }
    }
    let has_trail = state.show_path && state.points.len() >= 2;
    let has_label = state.show_label && state.label.is_some();
    if dirty && (has_trail || has_label) {
        render(state);
    }
    batch.has_more
}

/// 加载标签字体:微软雅黑(TTC 首字体),备选黑体/宋体
fn load_label_font() -> Option<ab_glyph::FontVec> {
    let candidates = [
        "C:\\Windows\\Fonts\\msyh.ttc",
        "C:\\Windows\\Fonts\\msyhbd.ttc",
        "C:\\Windows\\Fonts\\simhei.ttf",
        "C:\\Windows\\Fonts\\simsun.ttc",
    ];
    for path in candidates {
        if let Ok(bytes) = std::fs::read(path) {
            if let Ok(font) = ab_glyph::FontVec::try_from_vec_and_index(bytes, 0) {
                return Some(font);
            }
        }
    }
    log::warn!("命令提示标签字体加载失败,标签将不渲染");
    None
}

/// 为起点所在显示器准备绘制表面(尺寸变化时重建 DIB)
fn ensure_surface_for(state: &mut OverlayState, origin: Point) {
    unsafe {
        let monitor = MonitorFromPoint(
            POINT {
                x: origin.x,
                y: origin.y,
            },
            MONITOR_DEFAULTTONEAREST,
        );
        let mut mi = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        if !GetMonitorInfoW(monitor, &mut mi).as_bool() {
            return;
        }
        let r = mi.rcMonitor;
        let (w, h) = (r.right - r.left, r.bottom - r.top);
        state.monitor_origin = (r.left, r.top);

        let mut dpi_x = 96u32;
        let mut dpi_y = 96u32;
        if windows::Win32::UI::HiDpi::GetDpiForMonitor(
            monitor,
            windows::Win32::UI::HiDpi::MDT_EFFECTIVE_DPI,
            &mut dpi_x,
            &mut dpi_y,
        )
        .is_ok()
        {
            state.dpi_factor = dpi_x as f32 / 96.0;
        }

        if w == state.width && h == state.height && !state.mem_dc.is_invalid() {
            return;
        }
        release_surface(state);

        let bi = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: w,
                biHeight: -h, // top-down
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };
        let mut bits: *mut core::ffi::c_void = std::ptr::null_mut();
        let Ok(dib) = CreateDIBSection(None, &bi, DIB_RGB_COLORS, &mut bits, None, 0) else {
            log::error!("CreateDIBSection 失败");
            return;
        };
        let mem_dc = CreateCompatibleDC(None);
        let old = SelectObject(mem_dc, dib.into());

        state.mem_dc = mem_dc;
        state.dib = dib;
        state.old_bmp = old;
        state.bits = bits as *mut u8;
        state.width = w;
        state.height = h;

        let _ = SetWindowPos(
            state.hwnd,
            Some(HWND_TOPMOST),
            r.left,
            r.top,
            w,
            h,
            SWP_NOACTIVATE,
        );
    }
}

fn release_surface(state: &mut OverlayState) {
    unsafe {
        if !state.mem_dc.is_invalid() {
            SelectObject(state.mem_dc, state.old_bmp);
            let _ = DeleteObject(state.dib.into());
            let _ = DeleteDC(state.mem_dc);
            state.mem_dc = HDC::default();
            state.dib = HBITMAP::default();
            state.bits = std::ptr::null_mut();
            state.width = 0;
            state.height = 0;
        }
    }
}

/// #AARRGGBB u32 → tiny_skia Color
fn skia_color(argb: u32) -> tiny_skia::Color {
    tiny_skia::Color::from_rgba8(
        ((argb >> 16) & 0xFF) as u8,
        ((argb >> 8) & 0xFF) as u8,
        (argb & 0xFF) as u8,
        ((argb >> 24) & 0xFF) as u8,
    )
}

fn render(state: &mut OverlayState) {
    if state.bits.is_null() || state.width <= 0 || state.height <= 0 {
        return;
    }
    let Some(mut pixmap) = Pixmap::new(state.width as u32, state.height as u32) else {
        return;
    };

    // 轨迹(转为覆盖层本地坐标)
    if state.show_path && state.points.len() >= 2 {
        let (ox, oy) = state.monitor_origin;
        let mut pb = PathBuilder::new();
        let first = state.points[0];
        pb.move_to((first.x - ox) as f32, (first.y - oy) as f32);
        for p in &state.points[1..] {
            pb.line_to((p.x - ox) as f32, (p.y - oy) as f32);
        }
        if let Some(path) = pb.finish() {
            let dpi = state.dpi_factor.max(1.0);
            let main_width = 2.0 * dpi;
            let stroke = |width: f32| Stroke {
                width,
                line_cap: LineCap::Round,
                line_join: LineJoin::Round,
                ..Default::default()
            };

            // 白色描边打底
            let mut border_paint = Paint::default();
            border_paint.set_color(tiny_skia::Color::from_rgba8(255, 255, 255, 255));
            border_paint.anti_alias = true;
            pixmap.stroke_path(
                &path,
                &border_paint,
                &stroke(main_width + 2.0 * dpi),
                Transform::identity(),
                None,
            );

            // 主线(识别状态决定颜色)
            let color = if state.recognized {
                state.colors.main
            } else {
                state.colors.unrecognized
            };
            let mut main_paint = Paint::default();
            main_paint.set_color(skia_color(color));
            main_paint.anti_alias = true;
            pixmap.stroke_path(
                &path,
                &main_paint,
                &stroke(main_width),
                Transform::identity(),
                None,
            );
        }
    }

    if state.show_label {
        if let Some(text) = state.label.clone() {
            draw_label(state, &mut pixmap, &text);
        }
    }

    // premultiplied RGBA → BGRA 拷入 DIB
    unsafe {
        let src = pixmap.data();
        let dst =
            std::slice::from_raw_parts_mut(state.bits, (state.width * state.height * 4) as usize);
        for (d, s) in dst.chunks_exact_mut(4).zip(src.chunks_exact(4)) {
            d[0] = s[2]; // B
            d[1] = s[1]; // G
            d[2] = s[0]; // R
            d[3] = s[3]; // A
        }
    }

    present(state);
    if !state.visible {
        unsafe {
            let _ = ShowWindow(state.hwnd, SW_SHOWNOACTIVATE);
        }
        state.visible = true;
    }
}

/// 命令提示标签:半透明黑底 + 白字,水平居中,
/// 纵向位置 = 屏高/2 + 屏宽/8(对齐 WGestures)
fn draw_label(state: &OverlayState, pixmap: &mut Pixmap, text: &str) {
    use ab_glyph::{Font, ScaleFont};
    let Some(font) = &state.font else { return };

    let px = 32.0 * state.dpi_factor.max(1.0);
    let scaled = font.as_scaled(ab_glyph::PxScale::from(px));

    // 布局:一行,累计 advance
    let mut glyphs = Vec::new();
    let mut cursor = 0.0f32;
    for ch in text.chars() {
        let id = scaled.glyph_id(ch);
        let glyph = id.with_scale_and_position(px, ab_glyph::point(cursor, 0.0));
        cursor += scaled.h_advance(id);
        glyphs.push(glyph);
    }
    let text_w = cursor;
    let ascent = scaled.ascent();
    let text_h = ascent - scaled.descent();

    let pad_x = 24.0 * state.dpi_factor;
    let pad_y = 10.0 * state.dpi_factor;
    let box_w = text_w + pad_x * 2.0;
    let box_h = text_h + pad_y * 2.0;
    let box_x = (state.width as f32 - box_w) / 2.0;
    let box_y = state.height as f32 / 2.0 + state.width as f32 / 8.0 - box_h / 2.0;

    // 背景(识别态半透明黑)
    if let Some(rect) = tiny_skia::Rect::from_xywh(box_x, box_y, box_w, box_h) {
        let mut bg = Paint::default();
        bg.set_color(tiny_skia::Color::from_rgba8(0, 0, 0, 140));
        bg.anti_alias = true;
        pixmap.fill_rect(rect, &bg, Transform::identity(), None);
    }

    // 白字(premultiplied source-over 手工合成)
    let (pw, ph) = (pixmap.width() as i32, pixmap.height() as i32);
    let data = pixmap.data_mut();
    let origin_x = box_x + pad_x;
    let origin_y = box_y + pad_y + ascent;
    for glyph in glyphs {
        let mut g = glyph;
        g.position = ab_glyph::point(g.position.x + origin_x, origin_y);
        if let Some(outlined) = font.outline_glyph(g) {
            let bounds = outlined.px_bounds();
            outlined.draw(|gx, gy, coverage| {
                let x = bounds.min.x as i32 + gx as i32;
                let y = bounds.min.y as i32 + gy as i32;
                if x < 0 || y < 0 || x >= pw || y >= ph {
                    return;
                }
                let a = (coverage * 255.0) as u16;
                if a == 0 {
                    return;
                }
                let idx = ((y * pw + x) * 4) as usize;
                let inv = 255 - a;
                // 白色 premultiplied = (a, a, a, a)
                for ch in 0..4 {
                    let dst = data[idx + ch] as u16;
                    data[idx + ch] = (a + dst * inv / 255).min(255) as u8;
                }
            });
        }
    }
}

fn present(state: &OverlayState) {
    unsafe {
        let blend = BLENDFUNCTION {
            BlendOp: 0, // AC_SRC_OVER
            BlendFlags: 0,
            SourceConstantAlpha: state.alpha.min(255) as u8,
            AlphaFormat: 1, // AC_SRC_ALPHA
        };
        let pos = POINT {
            x: state.monitor_origin.0,
            y: state.monitor_origin.1,
        };
        let size = SIZE {
            cx: state.width,
            cy: state.height,
        };
        let src_pos = POINT { x: 0, y: 0 };
        let _ = UpdateLayeredWindow(
            state.hwnd,
            None,
            Some(&pos),
            Some(&size),
            Some(state.mem_dc),
            Some(&src_pos),
            COLORREF(0),
            Some(&blend),
            ULW_ALPHA,
        );
    }
}

fn start_fade(state: &mut OverlayState) {
    unsafe {
        SetTimer(Some(state.hwnd), FADE_TIMER_ID, FADE_INTERVAL_MS, None);
    }
}

fn stop_fade(state: &mut OverlayState) {
    unsafe {
        let _ = KillTimer(Some(state.hwnd), FADE_TIMER_ID);
    }
    state.alpha = 255;
}

fn fade_step(state: &mut OverlayState) {
    if !state.visible {
        stop_fade(state);
        return;
    }
    if state.alpha <= FADE_STEP {
        stop_fade(state);
        hide(state);
        return;
    }
    state.alpha -= FADE_STEP;
    present(state);
}

fn hide(state: &mut OverlayState) {
    unsafe {
        let _ = KillTimer(Some(state.hwnd), FADE_TIMER_ID);
        let _ = ShowWindow(state.hwnd, SW_HIDE);
    }
    state.visible = false;
    state.alpha = 255;
}

unsafe extern "system" fn wnd_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    match msg {
        WM_PAINT => {
            // 分层窗口内容经 ULW 提交,这里只需清空验证区
            let mut ps = PAINTSTRUCT::default();
            unsafe {
                let _ = BeginPaint(hwnd, &mut ps);
                let _ = EndPaint(hwnd, &ps);
            }
            LRESULT(0)
        }
        _ => unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn point(value: i32) -> Point {
        Point { x: value, y: value }
    }

    #[test]
    fn command_batch_is_bounded_and_reports_remaining_work() {
        let (tx, rx) = unbounded();
        for value in 0..5 {
            tx.send(OverlayCmd::Grow(point(value))).unwrap();
        }

        let first = take_command_batch(&rx, 2);
        assert_eq!(first.commands.len(), 2);
        assert!(first.has_more);

        let second = take_command_batch(&rx, 8);
        assert_eq!(second.commands.len(), 3);
        assert!(!second.has_more);
    }

    #[test]
    fn command_batch_preserves_control_command_order() {
        let (tx, rx) = unbounded();
        tx.send(OverlayCmd::Grow(point(1))).unwrap();
        tx.send(OverlayCmd::Recognized(Some("match".into())))
            .unwrap();
        tx.send(OverlayCmd::End).unwrap();

        let batch = take_command_batch(&rx, MAX_COMMANDS_PER_FRAME);
        assert!(matches!(batch.commands[0], OverlayCmd::Grow(_)));
        assert!(matches!(
            &batch.commands[1],
            OverlayCmd::Recognized(Some(label)) if label == "match"
        ));
        assert!(matches!(batch.commands[2], OverlayCmd::End));
    }

    #[test]
    fn command_batch_handles_empty_and_disconnected_receivers() {
        let (tx, rx) = unbounded::<OverlayCmd>();
        drop(tx);

        let batch = take_command_batch(&rx, MAX_COMMANDS_PER_FRAME);
        assert!(batch.commands.is_empty());
        assert!(!batch.has_more);
    }
}
