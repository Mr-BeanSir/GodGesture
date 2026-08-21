//! 轨迹覆盖层 —— 原生分层窗口(ADR-0006):
//! - 自注册窗口类,WS_EX_LAYERED | TOPMOST | TOOLWINDOW | NOACTIVATE | TRANSPARENT,
//!   点击穿透、不抢焦点、不出现在 Alt-Tab;
//! - 两个顶置透明窗口切片共同覆盖手势起点所在显示器,避免单个窗口被 Explorer
//!   判定为全屏窗口,同时允许轨迹显示在任务栏之上;
//! - tiny-skia 画轨迹(白色描边打底 + 按触发键配色的主线,圆头圆角),
//!   识别/未识别以颜色区分;
//! - 淡出:UpdateLayeredWindow 只改 SourceConstantAlpha,零重绘成本;
//! - 独立线程 + 消息泵,外部经 channel + WM_APP 唤醒。
//!
//! 命令提示标签(文字)在 M1 后段接入(需字形栅格化)。

use crate::engine::types::Point;
pub use crate::platform::overlay::OverlayCommand as OverlayCmd;
use crate::platform::overlay::OverlaySink;
pub use crate::platform::overlay::{OverlayCommand, TrailColors};
use crossbeam_channel::{unbounded, Receiver, Sender, TryRecvError};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tiny_skia::{LineCap, LineJoin, Paint, PathBuilder, PixmapMut, Stroke, Transform};
use windows::core::{w, BOOL, PCWSTR};
use windows::Win32::Foundation::{
    GetLastError, COLORREF, HWND, LPARAM, LRESULT, POINT, RECT, SIZE, WPARAM,
};
use windows::Win32::Graphics::Gdi::BLENDFUNCTION;
use windows::Win32::Graphics::Gdi::{
    BeginPaint, CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, EndPaint,
    EnumDisplayMonitors, GetMonitorInfoW, MonitorFromPoint, SelectObject, BITMAPINFO,
    BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HBITMAP, HDC, HGDIOBJ, HMONITOR, MONITORINFO,
    MONITOR_DEFAULTTONEAREST, PAINTSTRUCT,
};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GetMessageW, KillTimer,
    PostThreadMessageW, RegisterClassExW, SetTimer, SetWindowPos, ShowWindow, TranslateMessage,
    UpdateLayeredWindow, UpdateLayeredWindowIndirect, MSG, SWP_NOACTIVATE, SWP_NOZORDER, SW_HIDE,
    SW_SHOWNOACTIVATE, ULW_ALPHA, UPDATELAYEREDWINDOWINFO, WINDOW_STYLE, WM_APP, WM_PAINT,
    WM_TIMER, WNDCLASSEXW, WS_EX_LAYERED, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_EX_TOPMOST,
    WS_EX_TRANSPARENT, WS_POPUP,
};

const WM_APP_WAKE: u32 = WM_APP + 1;
const MAX_COMMANDS_PER_FRAME: usize = 4096;
const MAX_TRAIL_POINTS_BASE: usize = 512;
// Extended styles provide all required overlay behavior; WS_POPUP supplies the borderless
// top-level window semantics required by UpdateLayeredWindow.
const OVERLAY_WINDOW_STYLE: WINDOW_STYLE = WS_POPUP;
const FADE_STEP: u16 = 48;
const FADE_INTERVAL_MS: u32 = 30;

#[derive(Clone, Copy)]
struct TrailRenderStyle {
    monitor_origin: (i32, i32),
    dpi: f32,
    recognized: bool,
    colors: TrailColors,
}

#[derive(Clone)]
pub struct Overlay {
    tx: Sender<OverlayCommand>,
    thread_id: Arc<AtomicU32>,
    wake_pending: Arc<AtomicBool>,
}

impl Overlay {
    pub fn spawn(_app: &tauri::AppHandle) -> Self {
        let (tx, rx) = unbounded();
        let thread_id = Arc::new(AtomicU32::new(0));
        let tid_slot = Arc::clone(&thread_id);
        let wake_pending = Arc::new(AtomicBool::new(false));
        let wake_slot = Arc::clone(&wake_pending);
        std::thread::Builder::new()
            .name("gg-overlay".into())
            .spawn(move || overlay_thread_main(rx, tid_slot, wake_slot))
            .expect("failed to spawn overlay thread");
        Self {
            tx,
            thread_id,
            wake_pending,
        }
    }

    pub fn send(&self, cmd: OverlayCommand) {
        let _ = self.tx.send(cmd);
        let tid = self.thread_id.load(Ordering::SeqCst);
        if tid != 0 && !self.wake_pending.swap(true, Ordering::AcqRel) && !post_overlay_wake(tid) {
            self.wake_pending.store(false, Ordering::Release);
        }
    }
}

impl OverlaySink for Overlay {
    fn send(&self, command: OverlayCommand) {
        Overlay::send(self, command);
    }
}

fn post_overlay_wake(thread_id: u32) -> bool {
    unsafe { PostThreadMessageW(thread_id, WM_APP_WAKE, WPARAM(0), LPARAM(0)).is_ok() }
}

fn create_overlay_tile_window() -> Result<HWND, String> {
    unsafe {
        let hinstance = GetModuleHandleW(None).unwrap_or_default();
        CreateWindowExW(
            WS_EX_LAYERED | WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE | WS_EX_TRANSPARENT,
            w!("GodGestureCanvas"),
            PCWSTR::null(),
            OVERLAY_WINDOW_STYLE,
            0,
            0,
            0,
            0,
            None,
            None,
            Some(hinstance.into()),
            None,
        )
        .map_err(|error| error.to_string())
    }
}

struct OverlayState {
    tiles: Vec<OverlayTile>,
    mem_dc: HDC,
    dib: HBITMAP,
    old_bmp: HGDIOBJ,
    bits: *mut u8,
    width: i32,
    height: i32,
    monitor_origin: (i32, i32),
    label_bounds: PixelRect,
    points: Vec<Point>,
    visual_point_limit: usize,
    scratch: Vec<u8>,
    rendered_points: usize,
    needs_full_redraw: bool,
    needs_full_present: bool,
    dirty_updates_supported: bool,
    colors: TrailColors,
    recognized: bool,
    label: Option<String>,
    show_path: bool,
    show_label: bool,
    fade_out: bool,
    display_duration: Option<Duration>,
    fade_duration: Option<Duration>,
    visible: bool,
    alpha: u16,
    fade_started_at: Option<Instant>,
    fade_delay_until: Option<Instant>,
    fade_timer_id: usize,
    next_fade_timer_id: usize,
    dpi_factor: f32,
    font: Option<ab_glyph::FontVec>,
    stats: OverlayStats,
}

#[derive(Debug, Clone, Copy)]
struct OverlayTile {
    hwnd: HWND,
    source: PixelRect,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct PixelRect {
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
}

impl PixelRect {
    fn full(width: i32, height: i32) -> Self {
        Self {
            left: 0,
            top: 0,
            right: width.max(0),
            bottom: height.max(0),
        }
    }

    fn from_points(points: &[Point], origin: (i32, i32), padding: i32) -> Option<Self> {
        let first = points.first()?;
        let mut left = first.x - origin.0;
        let mut right = left;
        let mut top = first.y - origin.1;
        let mut bottom = top;
        for point in &points[1..] {
            let x = point.x - origin.0;
            let y = point.y - origin.1;
            left = left.min(x);
            right = right.max(x);
            top = top.min(y);
            bottom = bottom.max(y);
        }
        Some(Self {
            left: left - padding,
            top: top - padding,
            right: right + padding + 1,
            bottom: bottom + padding + 1,
        })
    }

    fn clamp(self, width: i32, height: i32) -> Option<Self> {
        let rect = Self {
            left: self.left.clamp(0, width),
            top: self.top.clamp(0, height),
            right: self.right.clamp(0, width),
            bottom: self.bottom.clamp(0, height),
        };
        (rect.left < rect.right && rect.top < rect.bottom).then_some(rect)
    }

    fn intersects(self, other: Self) -> bool {
        self.left < other.right
            && self.right > other.left
            && self.top < other.bottom
            && self.bottom > other.top
    }

    fn intersection(self, other: Self) -> Option<Self> {
        let rect = Self {
            left: self.left.max(other.left),
            top: self.top.max(other.top),
            right: self.right.min(other.right),
            bottom: self.bottom.min(other.bottom),
        };
        (rect.left < rect.right && rect.top < rect.bottom).then_some(rect)
    }

    fn translated(self, dx: i32, dy: i32) -> Self {
        Self {
            left: self.left + dx,
            top: self.top + dy,
            right: self.right + dx,
            bottom: self.bottom + dy,
        }
    }
}

fn split_overlay_tiles(width: i32, height: i32) -> [PixelRect; 2] {
    if width >= 2 {
        let middle = width / 2;
        [
            PixelRect {
                left: 0,
                top: 0,
                right: middle,
                bottom: height.max(0),
            },
            PixelRect {
                left: middle,
                top: 0,
                right: width,
                bottom: height.max(0),
            },
        ]
    } else {
        let middle = height.max(0) / 2;
        [
            PixelRect {
                left: 0,
                top: 0,
                right: width.max(0),
                bottom: middle,
            },
            PixelRect {
                left: 0,
                top: middle,
                right: width.max(0),
                bottom: height.max(0),
            },
        ]
    }
}

fn tile_local_dirty(tile: PixelRect, dirty: PixelRect) -> Option<PixelRect> {
    tile.intersection(dirty).map(|intersection| PixelRect {
        left: intersection.left - tile.left,
        top: intersection.top - tile.top,
        right: intersection.right - tile.left,
        bottom: intersection.bottom - tile.top,
    })
}

fn tiled_virtual_desktop(monitors: &[PixelRect]) -> Option<(PixelRect, Vec<PixelRect>)> {
    let first = *monitors.first()?;
    let bounds = monitors
        .iter()
        .skip(1)
        .fold(first, |bounds, monitor| PixelRect {
            left: bounds.left.min(monitor.left),
            top: bounds.top.min(monitor.top),
            right: bounds.right.max(monitor.right),
            bottom: bounds.bottom.max(monitor.bottom),
        });
    if bounds.left >= bounds.right || bounds.top >= bounds.bottom {
        return None;
    }
    let mut sources = Vec::with_capacity(monitors.len() * 2);
    for monitor in monitors {
        let width = monitor.right - monitor.left;
        let height = monitor.bottom - monitor.top;
        if width <= 0 || height <= 0 {
            continue;
        }
        let offset_x = monitor.left - bounds.left;
        let offset_y = monitor.top - bounds.top;
        sources.extend(
            split_overlay_tiles(width, height).map(|tile| tile.translated(offset_x, offset_y)),
        );
    }
    (!sources.is_empty()).then_some((bounds, sources))
}

unsafe extern "system" fn collect_monitor_rect(
    _monitor: HMONITOR,
    _dc: HDC,
    rect: *mut RECT,
    data: LPARAM,
) -> BOOL {
    let Some(rect) = (unsafe { rect.as_ref() }) else {
        return true.into();
    };
    let monitors = unsafe { &mut *(data.0 as *mut Vec<PixelRect>) };
    monitors.push(PixelRect {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
    });
    true.into()
}

fn virtual_desktop_layout() -> Option<(PixelRect, Vec<PixelRect>)> {
    let mut monitors: Vec<PixelRect> = Vec::new();
    unsafe {
        if !EnumDisplayMonitors(
            None,
            None,
            Some(collect_monitor_rect),
            LPARAM((&mut monitors as *mut Vec<PixelRect>) as isize),
        )
        .as_bool()
        {
            return None;
        }
    }
    monitors.sort_by_key(|monitor| (monitor.top, monitor.left, monitor.bottom, monitor.right));
    tiled_virtual_desktop(&monitors)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct SurfaceChange {
    rebuild: bool,
    reposition: bool,
    dpi_changed: bool,
}

fn classify_surface_change(
    has_surface: bool,
    current_origin: (i32, i32),
    current_size: (i32, i32),
    current_dpi: f32,
    next_origin: (i32, i32),
    next_size: (i32, i32),
    next_dpi: f32,
) -> SurfaceChange {
    let rebuild = !has_surface || current_size != next_size;
    SurfaceChange {
        rebuild,
        reposition: rebuild || current_origin != next_origin,
        dpi_changed: (current_dpi - next_dpi).abs() > f32::EPSILON,
    }
}

struct OverlayStats {
    window_started: Instant,
    grow_count: usize,
    render_samples: Vec<Duration>,
    raster_total: Duration,
    present_total: Duration,
    queue_peak: usize,
}

impl OverlayStats {
    fn new() -> Self {
        Self {
            window_started: Instant::now(),
            grow_count: 0,
            render_samples: Vec::with_capacity(256),
            raster_total: Duration::ZERO,
            present_total: Duration::ZERO,
            queue_peak: 0,
        }
    }

    fn record_batch(&mut self, grow_count: usize, queue_depth: usize) {
        self.grow_count += grow_count;
        self.queue_peak = self.queue_peak.max(queue_depth);
    }

    fn record_render(&mut self, raster: Duration, present: Duration) {
        self.raster_total += raster;
        self.present_total += present;
        self.render_samples.push(raster + present);
        self.flush_if_due();
    }

    fn flush_if_due(&mut self) {
        if !cfg!(debug_assertions)
            || self.grow_count == 0
            || self.window_started.elapsed() < Duration::from_secs(1)
        {
            return;
        }
        self.render_samples.sort_unstable();
        let renders = self.render_samples.len().max(1);
        let p95_index = ((renders as f32 * 0.95).ceil() as usize)
            .saturating_sub(1)
            .min(renders - 1);
        let p95 = self
            .render_samples
            .get(p95_index)
            .copied()
            .unwrap_or_default();
        let max = self.render_samples.last().copied().unwrap_or_default();
        log::info!(
            "轨迹覆盖层性能: grow={} render={} queue_peak={} avg={:.2}ms p95={:.2}ms max={:.2}ms raster_avg={:.2}ms present_avg={:.2}ms",
            self.grow_count,
            self.render_samples.len(),
            self.queue_peak,
            (self.raster_total + self.present_total).as_secs_f64() * 1000.0 / renders as f64,
            p95.as_secs_f64() * 1000.0,
            max.as_secs_f64() * 1000.0,
            self.raster_total.as_secs_f64() * 1000.0 / renders as f64,
            self.present_total.as_secs_f64() * 1000.0 / renders as f64,
        );
        self.window_started = Instant::now();
        self.grow_count = 0;
        self.render_samples.clear();
        self.raster_total = Duration::ZERO;
        self.present_total = Duration::ZERO;
        self.queue_peak = 0;
    }
}

fn overlay_thread_main(
    rx: Receiver<OverlayCommand>,
    tid_slot: Arc<AtomicU32>,
    wake_pending: Arc<AtomicBool>,
) {
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

        let mut state = OverlayState {
            tiles: Vec::new(),
            mem_dc: HDC::default(),
            dib: HBITMAP::default(),
            old_bmp: HGDIOBJ::default(),
            bits: std::ptr::null_mut(),
            width: 0,
            height: 0,
            monitor_origin: (0, 0),
            label_bounds: PixelRect::full(0, 0),
            points: Vec::with_capacity(1024),
            visual_point_limit: MAX_TRAIL_POINTS_BASE,
            scratch: Vec::new(),
            rendered_points: 0,
            needs_full_redraw: true,
            needs_full_present: true,
            dirty_updates_supported: true,
            colors: TrailColors {
                main: 0xFF27E518,
                unrecognized: 0xFFFF8040,
            },
            recognized: false,
            label: None,
            show_path: true,
            show_label: true,
            fade_out: true,
            display_duration: None,
            fade_duration: None,
            visible: false,
            alpha: 255,
            fade_started_at: None,
            fade_delay_until: None,
            fade_timer_id: 0,
            next_fade_timer_id: 0,
            dpi_factor: 1.0,
            font: load_label_font(),
            stats: OverlayStats::new(),
        };

        if !rx.is_empty()
            && !wake_pending.swap(true, Ordering::AcqRel)
            && !post_overlay_wake(windows::Win32::System::Threading::GetCurrentThreadId())
        {
            wake_pending.store(false, Ordering::Release);
        }

        let mut msg = MSG::default();
        while GetMessageW(&mut msg, None, 0, 0).as_bool() {
            match msg.message {
                WM_APP_WAKE => {
                    if drain_commands(&rx, &mut state) {
                        if !post_overlay_wake(
                            windows::Win32::System::Threading::GetCurrentThreadId(),
                        ) {
                            wake_pending.store(false, Ordering::Release);
                        }
                    } else {
                        wake_pending.store(false, Ordering::Release);
                        if !rx.is_empty()
                            && !wake_pending.swap(true, Ordering::AcqRel)
                            && !post_overlay_wake(
                                windows::Win32::System::Threading::GetCurrentThreadId(),
                            )
                        {
                            wake_pending.store(false, Ordering::Release);
                        }
                    }
                }
                WM_TIMER if fade_timer_matches(&state, msg.wParam.0) => {
                    fade_step(&mut state);
                }
                _ => {
                    let _ = TranslateMessage(&msg);
                    DispatchMessageW(&msg);
                }
            }
        }

        release_surface(&mut state);
        for tile in state.tiles.drain(..) {
            let _ = DestroyWindow(tile.hwnd);
        }
    }
}

struct CommandBatch {
    commands: Vec<OverlayCommand>,
    has_more: bool,
}

fn take_command_batch(rx: &Receiver<OverlayCommand>, limit: usize) -> CommandBatch {
    let mut commands = Vec::with_capacity(rx.len().min(limit).max(1));
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

fn max_trail_points(dpi_factor: f32) -> usize {
    let dpi_factor = if dpi_factor.is_finite() {
        dpi_factor.max(1.0)
    } else {
        1.0
    };
    (MAX_TRAIL_POINTS_BASE as f32 * dpi_factor).round() as usize
}

fn visual_point_limit(width: i32, height: i32, dpi_factor: f32) -> usize {
    let traversal_points = (width.max(0) as usize + height.max(0) as usize).div_ceil(3) + 1;
    max_trail_points(dpi_factor).max(traversal_points)
}

fn append_visual_point(points: &mut Vec<Point>, point: Point, limit: usize) -> bool {
    if points.len() >= limit {
        return false;
    }
    let step_ok = points
        .last()
        .map(|last| last.dist_sq(point) >= 9)
        .unwrap_or(true);
    if step_ok {
        points.push(point);
    }
    step_ok
}

/// Applies at most one frame's worth of commands and reports whether another wake is required.
/// Rendering before returning prevents a continuously growing queue from starving the overlay.
fn drain_commands(rx: &Receiver<OverlayCommand>, state: &mut OverlayState) -> bool {
    drain_commands_with_surface(rx, state, ensure_surface_for)
}

fn drain_commands_with_surface<F>(
    rx: &Receiver<OverlayCommand>,
    state: &mut OverlayState,
    mut ensure_surface: F,
) -> bool
where
    F: FnMut(&mut OverlayState, Point),
{
    let batch = take_command_batch(rx, MAX_COMMANDS_PER_FRAME);
    let queue_depth = batch.commands.len() + rx.len();
    let mut grow_count = 0;
    let mut visual_dirty = false;
    let mut fade_after_render = false;
    for cmd in batch.commands {
        match cmd {
            OverlayCommand::Begin {
                origin,
                colors,
                show_path,
                show_label,
                fade_out,
            } => {
                fade_after_render = false;
                stop_fade(state);
                hide(state);
                state.points.clear();
                state.points.push(origin);
                state.rendered_points = 0;
                state.needs_full_redraw = true;
                state.needs_full_present = true;
                state.colors = colors;
                state.recognized = false;
                state.label = None;
                state.show_path = show_path;
                state.show_label = show_label;
                state.fade_out = fade_out;
                state.display_duration = None;
                state.fade_duration = None;
                state.alpha = 255;
                ensure_surface(state, origin);
            }
            OverlayCommand::Grow(p) => {
                // 距上个渲染点至少 3px 才记点(StepSize,降密)
                if append_visual_point(&mut state.points, p, state.visual_point_limit) {
                    grow_count += 1;
                    visual_dirty |= state.show_path;
                }
            }
            OverlayCommand::Recognized(name) => {
                let recognized = name.is_some();
                if state.recognized != recognized || state.label != name {
                    state.recognized = recognized;
                    state.label = name;
                    state.needs_full_redraw = true;
                    visual_dirty = state.show_path || (state.show_label && state.label.is_some());
                }
            }
            OverlayCommand::End => {
                fade_after_render = false;
                if state.visible {
                    if state.fade_out {
                        start_fade(state);
                    } else {
                        hide(state);
                    }
                }
                visual_dirty = false;
                state.points.clear();
                state.rendered_points = 0;
            }
            OverlayCommand::Cancel => {
                fade_after_render = false;
                hide(state);
                visual_dirty = false;
                state.points.clear();
                state.rendered_points = 0;
            }
            OverlayCommand::ShowLabelFeedback {
                origin,
                text,
                fade_out,
                display_duration,
                fade_duration,
            } => {
                stop_fade(state);
                hide(state);
                state.label = None;
                state.points.clear();
                state.rendered_points = 0;
                state.needs_full_redraw = true;
                state.needs_full_present = true;
                ensure_surface(state, origin);
                state.recognized = true;
                state.label = Some(text);
                state.show_path = false;
                state.show_label = true;
                state.fade_out = fade_out;
                state.display_duration = display_duration;
                state.fade_duration = fade_duration;
                state.alpha = 255;
                fade_after_render = false;
                if fade_out {
                    visual_dirty = true;
                    fade_after_render = true;
                } else {
                    hide(state);
                    visual_dirty = false;
                }
            }
        }
    }
    state.stats.record_batch(grow_count, queue_depth);
    if visual_dirty {
        render(state);
    }
    if fade_after_render && state.visible {
        start_fade(state);
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

/// 为完整虚拟桌面准备绘制表面(尺寸变化时重建 DIB)。
///
/// 每台显示器分别由两个非全屏顶置窗口切片显示。轨迹可以跨屏并覆盖任务栏,但任一
/// HWND 都不覆盖整台显示器,不会触发 Explorer 对全屏应用的任务栏 Z-order 调整。
fn ensure_surface_for(state: &mut OverlayState, origin: Point) {
    unsafe {
        let Some((desktop, next_sources)) = virtual_desktop_layout() else {
            log::error!("无法获取虚拟桌面显示器布局");
            return;
        };
        let monitor = MonitorFromPoint(
            POINT {
                x: origin.x,
                y: origin.y,
            },
            MONITOR_DEFAULTTONEAREST,
        );
        let (w, h) = (desktop.right - desktop.left, desktop.bottom - desktop.top);
        let next_origin = (desktop.left, desktop.top);
        let mut monitor_info = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        let next_label_bounds = if GetMonitorInfoW(monitor, &mut monitor_info).as_bool() {
            PixelRect {
                left: monitor_info.rcMonitor.left - desktop.left,
                top: monitor_info.rcMonitor.top - desktop.top,
                right: monitor_info.rcMonitor.right - desktop.left,
                bottom: monitor_info.rcMonitor.bottom - desktop.top,
            }
        } else {
            PixelRect::full(w, h)
        };

        let mut dpi_x = 96u32;
        let mut dpi_y = 96u32;
        let mut next_dpi_factor = 1.0;
        if windows::Win32::UI::HiDpi::GetDpiForMonitor(
            monitor,
            windows::Win32::UI::HiDpi::MDT_EFFECTIVE_DPI,
            &mut dpi_x,
            &mut dpi_y,
        )
        .is_ok()
        {
            next_dpi_factor = dpi_x as f32 / 96.0;
        }

        let change = classify_surface_change(
            !state.mem_dc.is_invalid(),
            state.monitor_origin,
            (state.width, state.height),
            state.dpi_factor,
            next_origin,
            (w, h),
            next_dpi_factor,
        );
        let tile_layout_changed = state
            .tiles
            .iter()
            .map(|tile| tile.source)
            .ne(next_sources.iter().copied());
        state.monitor_origin = next_origin;
        state.dpi_factor = next_dpi_factor;
        state.visual_point_limit = visual_point_limit(w, h, next_dpi_factor);
        state.needs_full_redraw |= change.dpi_changed || state.label_bounds != next_label_bounds;
        state.label_bounds = next_label_bounds;
        state.needs_full_present |= tile_layout_changed;

        if change.rebuild {
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
            state.rendered_points = 0;
            state.needs_full_redraw = true;
            state.needs_full_present = true;
        }

        if change.reposition || tile_layout_changed {
            while state.tiles.len() < next_sources.len() {
                let hwnd = match create_overlay_tile_window() {
                    Ok(hwnd) => hwnd,
                    Err(error) => {
                        log::error!("覆盖层窗口创建失败: {error}");
                        return;
                    }
                };
                state.tiles.push(OverlayTile {
                    hwnd,
                    source: PixelRect::full(0, 0),
                });
            }
            while state.tiles.len() > next_sources.len() {
                if let Some(tile) = state.tiles.pop() {
                    let _ = DestroyWindow(tile.hwnd);
                }
            }
            for (tile, source) in state.tiles.iter_mut().zip(next_sources) {
                tile.source = source;
                let _ = SetWindowPos(
                    tile.hwnd,
                    None,
                    desktop.left + source.left,
                    desktop.top + source.top,
                    source.right - source.left,
                    source.bottom - source.top,
                    SWP_NOACTIVATE | SWP_NOZORDER,
                );
            }
        }
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
            state.scratch.clear();
        }
    }
}

/// #AARRGGBB u32 → tiny-skia color whose RGBA bytes are a Windows BGRA pixel.
/// Drawing directly into the DIB avoids a full-screen channel-swap copy per frame.
fn skia_dib_color(argb: u32) -> tiny_skia::Color {
    tiny_skia::Color::from_rgba8(
        (argb & 0xFF) as u8,
        ((argb >> 8) & 0xFF) as u8,
        ((argb >> 16) & 0xFF) as u8,
        ((argb >> 24) & 0xFF) as u8,
    )
}

fn set_overlay_visible(state: &mut OverlayState, visible: bool) {
    if state.visible == visible {
        return;
    }
    unsafe {
        for tile in &state.tiles {
            if visible {
                let _ = ShowWindow(tile.hwnd, SW_SHOWNOACTIVATE);
            } else {
                let _ = ShowWindow(tile.hwnd, SW_HIDE);
            }
        }
        state.visible = visible;
    }
}

fn render(state: &mut OverlayState) {
    if state.bits.is_null() || state.width <= 0 || state.height <= 0 {
        return;
    }
    let width = state.width;
    let height = state.height;
    let byte_len = (width * height * 4) as usize;
    let data = unsafe { std::slice::from_raw_parts_mut(state.bits, byte_len) };
    let Some(mut pixmap) = PixmapMut::from_bytes(data, width as u32, height as u32) else {
        return;
    };
    let raster_started = Instant::now();
    let first_unrendered = state.rendered_points.min(state.points.len());
    let incremental_start = first_unrendered.saturating_sub(1);
    let dpi = state.dpi_factor.max(1.0);
    let padding = (2.0 * dpi).ceil() as i32 + 2;
    let incremental_dirty = PixelRect::from_points(
        &state.points[incremental_start..],
        state.monitor_origin,
        padding,
    )
    .and_then(|rect| rect.clamp(width, height));
    let label_rect = state
        .label
        .as_deref()
        .filter(|_| state.show_label)
        .and_then(|text| measure_label_rect(state, text));
    let full_redraw = state.needs_full_redraw
        || incremental_dirty
            .zip(label_rect)
            .is_some_and(|(trail, label)| trail.intersects(label));
    let trail_style = TrailRenderStyle {
        monitor_origin: state.monitor_origin,
        dpi,
        recognized: state.recognized,
        colors: state.colors,
    };

    let dirty = if full_redraw {
        pixmap.fill(tiny_skia::Color::from_rgba8(0, 0, 0, 0));
        if state.show_path {
            draw_trail(&mut pixmap, &state.points, trail_style, (0.0, 0.0));
        }
        if let Some(text) = state.label.as_deref().filter(|_| state.show_label) {
            draw_label(state, &mut pixmap, text);
        }
        PixelRect::full(width, height)
    } else {
        let Some(dirty) = incremental_dirty else {
            return;
        };
        if state.show_path
            && !redraw_trail_region(
                &mut pixmap,
                &mut state.scratch,
                dirty,
                &state.points,
                trail_style,
            )
        {
            state.needs_full_redraw = true;
            return render(state);
        }
        dirty
    };
    state.rendered_points = state.points.len();
    state.needs_full_redraw = false;
    let raster_elapsed = raster_started.elapsed();

    let present_dirty = (!state.needs_full_present).then_some(dirty);
    let present_started = Instant::now();
    present(state, present_dirty);
    let present_elapsed = present_started.elapsed();
    state.needs_full_present = false;
    set_overlay_visible(state, true);
    state.stats.record_render(raster_elapsed, present_elapsed);
}

fn draw_trail(
    pixmap: &mut PixmapMut<'_>,
    points: &[Point],
    style: TrailRenderStyle,
    raster_offset: (f32, f32),
) {
    if points.len() < 2 {
        return;
    }
    let mut builder = PathBuilder::new();
    let first = points[0];
    builder.move_to(
        (first.x - style.monitor_origin.0) as f32 - raster_offset.0,
        (first.y - style.monitor_origin.1) as f32 - raster_offset.1,
    );
    for point in &points[1..] {
        builder.line_to(
            (point.x - style.monitor_origin.0) as f32 - raster_offset.0,
            (point.y - style.monitor_origin.1) as f32 - raster_offset.1,
        );
    }
    let Some(path) = builder.finish() else {
        return;
    };
    let main_width = 2.0 * style.dpi;
    let stroke = |width: f32| Stroke {
        width,
        line_cap: LineCap::Round,
        line_join: LineJoin::Round,
        ..Default::default()
    };
    let mut border = Paint::default();
    border.set_color(tiny_skia::Color::from_rgba8(255, 255, 255, 255));
    border.anti_alias = true;
    pixmap.stroke_path(
        &path,
        &border,
        &stroke(main_width + 2.0 * style.dpi),
        Transform::identity(),
        None,
    );
    let mut main = Paint::default();
    main.set_color(skia_dib_color(if style.recognized {
        style.colors.main
    } else {
        style.colors.unrecognized
    }));
    main.anti_alias = true;
    pixmap.stroke_path(
        &path,
        &main,
        &stroke(main_width),
        Transform::identity(),
        None,
    );
}

fn redraw_trail_region(
    pixmap: &mut PixmapMut<'_>,
    scratch: &mut Vec<u8>,
    dirty: PixelRect,
    points: &[Point],
    style: TrailRenderStyle,
) -> bool {
    let dirty_width = (dirty.right - dirty.left) as u32;
    let dirty_height = (dirty.bottom - dirty.top) as u32;
    let byte_len = dirty_width as usize * dirty_height as usize * 4;
    scratch.resize(byte_len, 0);
    scratch.fill(0);
    let Some(mut dirty_pixmap) = PixmapMut::from_bytes(scratch, dirty_width, dirty_height) else {
        return false;
    };
    draw_trail(
        &mut dirty_pixmap,
        points,
        style,
        (dirty.left as f32, dirty.top as f32),
    );

    let destination_width = pixmap.width() as usize;
    let source_width = dirty_width as usize;
    let destination = pixmap.data_mut();
    let source = dirty_pixmap.data_mut();
    for row in 0..dirty_height as usize {
        let destination_start =
            ((dirty.top as usize + row) * destination_width + dirty.left as usize) * 4;
        let source_start = row * source_width * 4;
        destination[destination_start..destination_start + source_width * 4]
            .copy_from_slice(&source[source_start..source_start + source_width * 4]);
    }
    true
}

/// 命令提示标签:半透明黑底 + 白字,水平居中,
/// 纵向位置 = 屏高/2 + 屏宽/8。
fn measure_label_rect(state: &OverlayState, text: &str) -> Option<PixelRect> {
    use ab_glyph::{Font, ScaleFont};
    let font = state.font.as_ref()?;
    let px = 32.0 * state.dpi_factor.max(1.0);
    let scaled = font.as_scaled(ab_glyph::PxScale::from(px));
    let text_width = text
        .chars()
        .map(|ch| scaled.h_advance(scaled.glyph_id(ch)))
        .sum::<f32>();
    let text_height = scaled.ascent() - scaled.descent();
    let pad_x = 24.0 * state.dpi_factor;
    let pad_y = 10.0 * state.dpi_factor;
    let box_width = text_width + pad_x * 2.0;
    let box_height = text_height + pad_y * 2.0;
    let display_width = (state.label_bounds.right - state.label_bounds.left) as f32;
    let display_height = (state.label_bounds.bottom - state.label_bounds.top) as f32;
    let box_x = state.label_bounds.left as f32 + (display_width - box_width) / 2.0;
    let box_y = state.label_bounds.top as f32 + display_height / 2.0 + display_width / 8.0
        - box_height / 2.0;
    PixelRect {
        left: box_x.floor() as i32 - 1,
        top: box_y.floor() as i32 - 1,
        right: (box_x + box_width).ceil() as i32 + 1,
        bottom: (box_y + box_height).ceil() as i32 + 1,
    }
    .clamp(state.width, state.height)
}

fn draw_label(state: &OverlayState, pixmap: &mut PixmapMut<'_>, text: &str) {
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
    let display_width = (state.label_bounds.right - state.label_bounds.left) as f32;
    let display_height = (state.label_bounds.bottom - state.label_bounds.top) as f32;
    let box_x = state.label_bounds.left as f32 + (display_width - box_w) / 2.0;
    let box_y =
        state.label_bounds.top as f32 + display_height / 2.0 + display_width / 8.0 - box_h / 2.0;

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

fn present(state: &mut OverlayState, dirty: Option<PixelRect>) {
    unsafe {
        let blend = BLENDFUNCTION {
            BlendOp: 0, // AC_SRC_OVER
            BlendFlags: 0,
            SourceConstantAlpha: state.alpha.min(255) as u8,
            AlphaFormat: 1, // AC_SRC_ALPHA
        };
        if state.dirty_updates_supported {
            if let Some(dirty) = dirty {
                let mut failed = false;
                for tile in &state.tiles {
                    let Some(local_dirty) = tile_local_dirty(tile.source, dirty) else {
                        continue;
                    };
                    let pos = POINT {
                        x: state.monitor_origin.0 + tile.source.left,
                        y: state.monitor_origin.1 + tile.source.top,
                    };
                    let size = SIZE {
                        cx: tile.source.right - tile.source.left,
                        cy: tile.source.bottom - tile.source.top,
                    };
                    let src_pos = POINT {
                        x: tile.source.left,
                        y: tile.source.top,
                    };
                    let local_dirty = RECT {
                        left: local_dirty.left,
                        top: local_dirty.top,
                        right: local_dirty.right,
                        bottom: local_dirty.bottom,
                    };
                    let info = UPDATELAYEREDWINDOWINFO {
                        cbSize: std::mem::size_of::<UPDATELAYEREDWINDOWINFO>() as u32,
                        hdcDst: HDC::default(),
                        pptDst: &pos,
                        psize: &size,
                        hdcSrc: state.mem_dc,
                        pptSrc: &src_pos,
                        crKey: COLORREF(0),
                        pblend: &blend,
                        dwFlags: ULW_ALPHA,
                        prcDirty: &local_dirty,
                    };
                    if !UpdateLayeredWindowIndirect(tile.hwnd, &info).as_bool() {
                        let error = GetLastError().0;
                        log::warn!(
                            "覆盖层局部提交失败: hwnd={:?} pos=({}, {}) size={}x{} src=({}, {}) dirty=({}, {}, {}, {}) error={error}",
                            tile.hwnd,
                            pos.x,
                            pos.y,
                            size.cx,
                            size.cy,
                            src_pos.x,
                            src_pos.y,
                            local_dirty.left,
                            local_dirty.top,
                            local_dirty.right,
                            local_dirty.bottom,
                        );
                        failed = true;
                        break;
                    }
                }
                if !failed {
                    return;
                }
                state.dirty_updates_supported = false;
                log::warn!("分层窗口局部更新不可用,已回退到整窗提交");
            }
        }
        for tile in &state.tiles {
            let pos = POINT {
                x: state.monitor_origin.0 + tile.source.left,
                y: state.monitor_origin.1 + tile.source.top,
            };
            let size = SIZE {
                cx: tile.source.right - tile.source.left,
                cy: tile.source.bottom - tile.source.top,
            };
            let src_pos = POINT {
                x: tile.source.left,
                y: tile.source.top,
            };
            if let Err(error) = UpdateLayeredWindow(
                tile.hwnd,
                None,
                Some(&pos),
                Some(&size),
                Some(state.mem_dc),
                Some(&src_pos),
                COLORREF(0),
                Some(&blend),
                ULW_ALPHA,
            ) {
                log::warn!(
                    "覆盖层完整提交失败: hwnd={:?} pos=({}, {}) size={}x{} src=({}, {}) error=0x{:08X} message={}",
                    tile.hwnd,
                    pos.x,
                    pos.y,
                    size.cx,
                    size.cy,
                    src_pos.x,
                    src_pos.y,
                    error.code().0 as u32,
                    error.message(),
                );
            }
        }
    }
}

fn start_fade(state: &mut OverlayState) {
    stop_fade_timer(state);
    let now = Instant::now();
    state.fade_delay_until = state.display_duration.map(|duration| now + duration);
    state.fade_started_at = if state.display_duration.is_none() && state.fade_duration.is_some() {
        Some(now)
    } else {
        None
    };
    let timer_id = allocate_fade_timer_id(state);
    if let Some(tile) = state.tiles.first() {
        unsafe {
            SetTimer(Some(tile.hwnd), timer_id, FADE_INTERVAL_MS, None);
        }
    }
}

fn stop_fade(state: &mut OverlayState) {
    stop_fade_timer(state);
    state.fade_started_at = None;
    state.fade_delay_until = None;
    state.alpha = 255;
}

fn allocate_fade_timer_id(state: &mut OverlayState) -> usize {
    let next = state.next_fade_timer_id.wrapping_add(1);
    state.next_fade_timer_id = if next == 0 { 1 } else { next };
    state.fade_timer_id = state.next_fade_timer_id;
    state.fade_timer_id
}

fn fade_timer_matches(state: &OverlayState, timer_id: usize) -> bool {
    timer_id != 0 && state.fade_timer_id == timer_id
}

fn stop_fade_timer(state: &mut OverlayState) {
    let timer_id = state.fade_timer_id;
    if timer_id != 0 {
        if let Some(tile) = state.tiles.first() {
            unsafe {
                let _ = KillTimer(Some(tile.hwnd), timer_id);
            }
        }
        state.fade_timer_id = 0;
    }
}

fn fade_step(state: &mut OverlayState) {
    if !state.visible {
        stop_fade(state);
        return;
    }
    if let Some(delay_until) = state.fade_delay_until {
        if Instant::now() < delay_until {
            return;
        }
        state.fade_delay_until = None;
        state.fade_started_at = Some(Instant::now());
    } else if state.fade_duration.is_some() && state.fade_started_at.is_none() {
        state.fade_started_at = Some(Instant::now());
    }
    if let Some(duration) = state.fade_duration {
        let elapsed = state
            .fade_started_at
            .map(|started_at| started_at.elapsed())
            .unwrap_or(duration);
        if duration.is_zero() || elapsed >= duration {
            stop_fade(state);
            hide(state);
            return;
        }
        let remaining = duration.saturating_sub(elapsed);
        state.alpha = ((remaining.as_secs_f64() / duration.as_secs_f64()) * 255.0)
            .round()
            .clamp(1.0, 255.0) as u16;
        present(state, None);
        return;
    }
    if state.alpha <= FADE_STEP {
        stop_fade(state);
        hide(state);
        return;
    }
    state.alpha -= FADE_STEP;
    present(state, None);
}

fn hide(state: &mut OverlayState) {
    stop_fade_timer(state);
    set_overlay_visible(state, false);
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
    use tiny_skia::Pixmap;
    use windows::Win32::UI::WindowsAndMessaging::WS_POPUP;

    fn point(value: i32) -> Point {
        Point { x: value, y: value }
    }

    fn test_state() -> OverlayState {
        OverlayState {
            tiles: vec![
                OverlayTile {
                    hwnd: HWND::default(),
                    source: PixelRect::full(0, 0),
                },
                OverlayTile {
                    hwnd: HWND::default(),
                    source: PixelRect::full(0, 0),
                },
            ],
            mem_dc: HDC::default(),
            dib: HBITMAP::default(),
            old_bmp: HGDIOBJ::default(),
            bits: std::ptr::null_mut(),
            width: 0,
            height: 0,
            monitor_origin: (0, 0),
            label_bounds: PixelRect::full(0, 0),
            points: vec![Point { x: 0, y: 0 }],
            visual_point_limit: MAX_TRAIL_POINTS_BASE,
            scratch: Vec::new(),
            rendered_points: 0,
            needs_full_redraw: true,
            needs_full_present: true,
            dirty_updates_supported: true,
            colors: TrailColors {
                main: 0xff27e518,
                unrecognized: 0xffff2424,
            },
            recognized: false,
            label: None,
            show_path: false,
            show_label: false,
            fade_out: false,
            display_duration: None,
            fade_duration: None,
            visible: false,
            alpha: 255,
            fade_started_at: None,
            fade_delay_until: None,
            fade_timer_id: 0,
            next_fade_timer_id: 0,
            dpi_factor: 1.0,
            font: None,
            stats: OverlayStats::new(),
        }
    }

    #[test]
    fn independent_label_feedback_does_not_require_active_trail() {
        let (tx, rx) = unbounded();
        let mut state = test_state();
        state.points = vec![point(10), point(20)];
        state.label = Some("old label".into());
        state.show_path = true;
        state.show_label = true;
        state.visible = true;
        state.alpha = 96;
        state.tiles.clear();

        let command = OverlayCommand::ShowLabelFeedback {
            origin: Point { x: 100, y: 200 },
            text: "42%".into(),
            fade_out: true,
            display_duration: Some(Duration::from_millis(500)),
            fade_duration: Some(Duration::from_millis(800)),
        };
        tx.send(command).unwrap();

        let mut selected_origin = None;
        assert!(!drain_commands_with_surface(
            &rx,
            &mut state,
            |_state, origin| selected_origin = Some(origin),
        ));
        assert_eq!(selected_origin, Some(Point { x: 100, y: 200 }));
        assert_eq!(state.label.as_deref(), Some("42%"));
        assert!(state.points.is_empty());
        assert!(!state.show_path);
        assert!(state.show_label);
        assert!(state.recognized);
        assert_eq!(state.alpha, 255);
        assert!(state.fade_out);
        assert_eq!(state.display_duration, Some(Duration::from_millis(500)));
        assert_eq!(state.fade_duration, Some(Duration::from_millis(800)));
    }

    #[test]
    fn independent_label_feedback_without_fade_hides_immediately() {
        let (tx, rx) = unbounded();
        let mut state = test_state();
        state.tiles.clear();
        state.points = vec![point(10), point(20)];
        state.label = Some("old label".into());
        state.visible = true;
        state.alpha = 64;
        tx.send(OverlayCommand::ShowLabelFeedback {
            origin: Point { x: 100, y: 200 },
            text: "0%".into(),
            fade_out: false,
            display_duration: None,
            fade_duration: None,
        })
        .unwrap();

        assert!(!drain_commands_with_surface(
            &rx,
            &mut state,
            |_state, _origin| {},
        ));
        assert_eq!(state.label.as_deref(), Some("0%"));
        assert!(state.points.is_empty());
        assert!(!state.visible);
        assert_eq!(state.alpha, 255);
        assert!(!state.fade_out);
    }

    #[test]
    fn stale_fade_timer_is_ignored_but_current_timer_is_handled() {
        let mut state = test_state();
        let old_timer_id = allocate_fade_timer_id(&mut state);
        let current_timer_id = allocate_fade_timer_id(&mut state);

        assert_ne!(old_timer_id, current_timer_id);
        assert!(!fade_timer_matches(&state, old_timer_id));
        assert!(fade_timer_matches(&state, current_timer_id));
    }

    #[test]
    fn custom_display_duration_delays_fade_start() {
        let mut state = test_state();
        state.visible = true;
        state.display_duration = Some(Duration::from_millis(500));
        state.fade_duration = Some(Duration::from_millis(300));
        state.tiles.clear();

        start_fade(&mut state);

        assert!(state.fade_delay_until.is_some());
        assert!(state.fade_started_at.is_none());
    }

    #[test]
    fn command_batch_is_bounded_and_reports_remaining_work() {
        let (tx, rx) = unbounded();
        for value in 0..5 {
            tx.send(OverlayCommand::Grow(point(value))).unwrap();
        }

        let first = take_command_batch(&rx, 2);
        assert_eq!(first.commands.len(), 2);
        assert!(first.has_more);

        let second = take_command_batch(&rx, 8);
        assert_eq!(second.commands.len(), 3);
        assert!(!second.has_more);
    }

    #[test]
    fn overlay_uses_popup_window_semantics() {
        assert_eq!(OVERLAY_WINDOW_STYLE, WS_POPUP);
    }

    fn rect_tuple(rect: PixelRect) -> (i32, i32, i32, i32) {
        (rect.left, rect.top, rect.right, rect.bottom)
    }

    #[test]
    fn overlay_tiles_cover_the_full_monitor_without_a_fullscreen_hwnd() {
        let full = PixelRect::full(2560, 1440);
        let tiles = split_overlay_tiles(2560, 1440);

        assert_eq!(rect_tuple(tiles[0]), (0, 0, 1280, 1440));
        assert_eq!(rect_tuple(tiles[1]), (1280, 0, 2560, 1440));
        assert_ne!(tiles[0], full);
        assert_ne!(tiles[1], full);
        assert_eq!(tiles[0].right, tiles[1].left);
        let area = |rect: PixelRect| (rect.right - rect.left) * (rect.bottom - rect.top);
        assert_eq!(area(tiles[0]) + area(tiles[1]), area(full));
    }

    #[test]
    fn dirty_region_crossing_the_tile_seam_maps_to_both_windows() {
        let tiles = split_overlay_tiles(2560, 1440);
        let dirty = PixelRect {
            left: 1276,
            top: 1408,
            right: 1284,
            bottom: 1435,
        };

        assert_eq!(
            tile_local_dirty(tiles[0], dirty).map(rect_tuple),
            Some((1276, 1408, 1280, 1435))
        );
        assert_eq!(
            tile_local_dirty(tiles[1], dirty).map(rect_tuple),
            Some((0, 1408, 4, 1435))
        );
    }

    #[test]
    fn taskbar_band_remains_inside_the_tiled_overlay_surface() {
        let tiles = split_overlay_tiles(2560, 1440);
        let taskbar_band = PixelRect {
            left: 0,
            top: 1410,
            right: 2560,
            bottom: 1440,
        };

        assert!(tiles[0].intersects(taskbar_band));
        assert!(tiles[1].intersects(taskbar_band));
    }

    #[test]
    fn virtual_desktop_tiles_cover_vertically_stacked_monitors() {
        let monitors = [
            PixelRect {
                left: 0,
                top: -1440,
                right: 2560,
                bottom: 0,
            },
            PixelRect {
                left: 0,
                top: 0,
                right: 2560,
                bottom: 1080,
            },
        ];
        let (bounds, tiles) = tiled_virtual_desktop(&monitors).unwrap();

        assert_eq!(rect_tuple(bounds), (0, -1440, 2560, 1080));
        assert_eq!(tiles.len(), 4);
        assert_eq!(rect_tuple(tiles[0]), (0, 0, 1280, 1440));
        assert_eq!(rect_tuple(tiles[1]), (1280, 0, 2560, 1440));
        assert_eq!(rect_tuple(tiles[2]), (0, 1440, 1280, 2520));
        assert_eq!(rect_tuple(tiles[3]), (1280, 1440, 2560, 2520));
    }

    #[test]
    fn virtual_desktop_tiles_cover_offset_side_by_side_monitors() {
        let monitors = [
            PixelRect {
                left: -1920,
                top: 240,
                right: 0,
                bottom: 1320,
            },
            PixelRect {
                left: 0,
                top: 0,
                right: 2560,
                bottom: 1440,
            },
        ];
        let (bounds, tiles) = tiled_virtual_desktop(&monitors).unwrap();

        assert_eq!(rect_tuple(bounds), (-1920, 0, 2560, 1440));
        assert_eq!(rect_tuple(tiles[0]), (0, 240, 960, 1320));
        assert_eq!(rect_tuple(tiles[1]), (960, 240, 1920, 1320));
        assert_eq!(rect_tuple(tiles[2]), (1920, 0, 3200, 1440));
        assert_eq!(rect_tuple(tiles[3]), (3200, 0, 4480, 1440));
    }

    #[test]
    fn command_batch_preserves_control_command_order() {
        let (tx, rx) = unbounded();
        tx.send(OverlayCommand::Grow(point(1))).unwrap();
        tx.send(OverlayCommand::Recognized(Some("match".into())))
            .unwrap();
        tx.send(OverlayCommand::End).unwrap();

        let batch = take_command_batch(&rx, MAX_COMMANDS_PER_FRAME);
        assert!(matches!(batch.commands[0], OverlayCommand::Grow(_)));
        assert!(matches!(
            &batch.commands[1],
            OverlayCommand::Recognized(Some(label)) if label == "match"
        ));
        assert!(matches!(batch.commands[2], OverlayCommand::End));
    }

    #[test]
    fn command_batch_handles_empty_and_disconnected_receivers() {
        let (tx, rx) = unbounded::<OverlayCommand>();
        drop(tx);

        let batch = take_command_batch(&rx, MAX_COMMANDS_PER_FRAME);
        assert!(batch.commands.is_empty());
        assert!(!batch.has_more);
    }

    #[test]
    fn mouse_rate_backlog_is_presented_as_one_latest_frame() {
        let (tx, rx) = unbounded();
        for value in 0..1000 {
            tx.send(OverlayCommand::Grow(point(value))).unwrap();
        }

        let batch = take_command_batch(&rx, MAX_COMMANDS_PER_FRAME);
        assert_eq!(batch.commands.len(), 1000);
        assert!(!batch.has_more);
        assert!(matches!(
            batch.commands.last(),
            Some(OverlayCommand::Grow(Point { x: 999, y: 999 }))
        ));
    }

    #[test]
    fn trail_dirty_rect_includes_stroke_padding_and_clamps_to_surface() {
        let points = [Point { x: 98, y: 99 }, Point { x: 110, y: 112 }];
        let rect = PixelRect::from_points(&points, (100, 100), 4)
            .and_then(|rect| rect.clamp(20, 20))
            .unwrap();

        assert_eq!(
            rect,
            PixelRect {
                left: 0,
                top: 0,
                right: 15,
                bottom: 17,
            }
        );
    }

    #[test]
    fn trail_dirty_rect_detects_label_overlap() {
        let trail = PixelRect {
            left: 40,
            top: 40,
            right: 80,
            bottom: 80,
        };
        let label = PixelRect {
            left: 70,
            top: 60,
            right: 120,
            bottom: 90,
        };
        assert!(trail.intersects(label));
    }

    #[test]
    fn surface_changes_separate_geometry_from_bitmap_rebuilds() {
        assert_eq!(
            classify_surface_change(
                true,
                (0, 0),
                (1920, 1080),
                1.0,
                (1920, 0),
                (1920, 1080),
                1.0,
            ),
            SurfaceChange {
                rebuild: false,
                reposition: true,
                dpi_changed: false,
            }
        );
        assert_eq!(
            classify_surface_change(true, (0, 0), (1920, 1080), 1.0, (0, 0), (1920, 1080), 1.5,),
            SurfaceChange {
                rebuild: false,
                reposition: false,
                dpi_changed: true,
            }
        );
        assert_eq!(
            classify_surface_change(true, (0, 0), (1920, 1080), 1.0, (0, 0), (2560, 1440), 1.0,),
            SurfaceChange {
                rebuild: true,
                reposition: true,
                dpi_changed: false,
            }
        );
    }

    #[test]
    fn visual_point_limit_scales_with_dpi_and_resets_with_a_new_path() {
        assert_eq!(max_trail_points(1.0), 512);
        assert_eq!(max_trail_points(1.25), 640);
        assert_eq!(max_trail_points(2.0), 1024);
        assert_eq!(visual_point_limit(2560, 1440, 1.0), 1335);

        let mut points = Vec::new();
        for value in 0..max_trail_points(1.0) {
            assert!(append_visual_point(
                &mut points,
                Point {
                    x: value as i32 * 3,
                    y: 0,
                },
                max_trail_points(1.0),
            ));
        }
        assert!(!append_visual_point(
            &mut points,
            Point { x: 4096, y: 0 },
            max_trail_points(1.0),
        ));
        assert_eq!(points.len(), 512);

        points.clear();
        assert!(append_visual_point(
            &mut points,
            Point { x: 3, y: 0 },
            max_trail_points(1.0),
        ));
        assert_eq!(points.len(), 1);
    }

    #[test]
    fn reaching_visual_point_limit_does_not_delay_recognized_or_end() {
        let (tx, rx) = unbounded();
        for value in 1..700 {
            tx.send(OverlayCommand::Grow(Point { x: value * 3, y: 0 }))
                .unwrap();
        }
        tx.send(OverlayCommand::Recognized(Some("match".into())))
            .unwrap();
        tx.send(OverlayCommand::End).unwrap();

        let mut state = test_state();
        assert!(!drain_commands(&rx, &mut state));
        assert!(state.recognized);
        assert_eq!(state.label.as_deref(), Some("match"));
        assert!(state.points.is_empty());
    }

    #[test]
    fn point_by_point_dirty_redraw_matches_one_full_continuous_path() {
        let points = [
            Point { x: 16, y: 48 },
            Point { x: 96, y: 48 },
            Point { x: 96, y: 96 },
            Point { x: 48, y: 96 },
            Point { x: 48, y: 16 },
            Point { x: 80, y: 16 },
        ];
        let colors = TrailColors {
            main: 0xff27e518,
            unrecognized: 0xffff2424,
        };
        let style = TrailRenderStyle {
            monitor_origin: (0, 0),
            dpi: 1.0,
            recognized: true,
            colors,
        };
        let mut expected = Pixmap::new(128, 128).unwrap();
        draw_trail(&mut expected.as_mut(), &points, style, (0.0, 0.0));

        let mut actual = Pixmap::new(128, 128).unwrap();
        let mut scratch = Vec::new();
        draw_trail(&mut actual.as_mut(), &points[..2], style, (0.0, 0.0));
        for end in 3..=points.len() {
            let dirty = PixelRect::from_points(&points[end - 2..end], (0, 0), 4)
                .and_then(|rect| rect.clamp(128, 128))
                .unwrap();
            assert!(redraw_trail_region(
                &mut actual.as_mut(),
                &mut scratch,
                dirty,
                &points[..end],
                style,
            ));
        }

        let different_pixels = actual
            .data()
            .chunks_exact(4)
            .zip(expected.data().chunks_exact(4))
            .enumerate()
            .filter_map(|(index, (actual, expected))| (actual != expected).then_some(index))
            .collect::<Vec<_>>();
        let bounds = different_pixels.iter().fold(
            None,
            |bounds: Option<(usize, usize, usize, usize)>, index| {
                let x = index % 128;
                let y = index / 128;
                Some(match bounds {
                    Some((left, top, right, bottom)) => {
                        (left.min(x), top.min(y), right.max(x), bottom.max(y))
                    }
                    None => (x, y, x, y),
                })
            },
        );
        assert!(
            different_pixels.is_empty(),
            "{} pixels differ within {bounds:?}: {:?}",
            different_pixels.len(),
            different_pixels
                .iter()
                .map(|index| {
                    let offset = index * 4;
                    (
                        index % 128,
                        index / 128,
                        &actual.data()[offset..offset + 4],
                        &expected.data()[offset..offset + 4],
                    )
                })
                .collect::<Vec<_>>()
        );
        assert!(!scratch.is_empty());
    }
}
