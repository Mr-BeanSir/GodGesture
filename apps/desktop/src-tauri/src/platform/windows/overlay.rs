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

use crate::engine::corners::{BoundaryGuideFrame, CornerEdgeHit, ScreenCorner};
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
        if cmd.debug_kind() != "grow" {
            log::debug!(
                target: "platform.windows",
                "event=overlay_command_enqueued command={} queue_depth_before={}",
                cmd.debug_kind(),
                self.tx.len()
            );
        }
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
    boundary_guide: Option<BoundaryGuideFrame>,
    boundary_guide_dirty: Option<PixelRect>,
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
    mode: OverlayMode,
    dpi_factor: f32,
    font: Option<ab_glyph::FontVec>,
    stats: OverlayStats,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum OverlayMode {
    Trail,
    LabelFeedback,
}

#[derive(Debug, Clone, Copy, Default)]
struct BitmapAlphaSummary {
    nontransparent_pixels: usize,
    bounds: Option<PixelRect>,
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

    fn union(self, other: Self) -> Self {
        Self {
            left: self.left.min(other.left),
            top: self.top.min(other.top),
            right: self.right.max(other.right),
            bottom: self.bottom.max(other.bottom),
        }
    }
}

fn log_overlay_state(event: &str, command: &str, phase: &str, state: &OverlayState) {
    log::debug!(
        target: "platform.windows",
        "event={} command={} phase={} points={} rendered_points={} show_path={} show_label={} needs_full_redraw={} needs_full_present={} visible={} boundary_guide={} boundary_guide_dirty={:?} mode={:?}",
        event,
        command,
        phase,
        state.points.len(),
        state.rendered_points,
        state.show_path,
        state.show_label,
        state.needs_full_redraw,
        state.needs_full_present,
        state.visible,
        state.boundary_guide.is_some(),
        state.boundary_guide_dirty,
        state.mode,
    );
}

fn bitmap_alpha_summary(data: &[u8], width: i32, height: i32) -> BitmapAlphaSummary {
    if width <= 0 || height <= 0 {
        return BitmapAlphaSummary::default();
    }
    let width = width as usize;
    let height = height as usize;
    let mut nontransparent_pixels = 0;
    let mut bounds: Option<PixelRect> = None;
    for y in 0..height {
        for x in 0..width {
            let offset = (y * width + x) * 4;
            if data.get(offset + 3).copied().unwrap_or(0) == 0 {
                continue;
            }
            nontransparent_pixels += 1;
            bounds = Some(match bounds {
                Some(existing) => PixelRect {
                    left: existing.left.min(x as i32),
                    top: existing.top.min(y as i32),
                    right: existing.right.max(x as i32 + 1),
                    bottom: existing.bottom.max(y as i32 + 1),
                },
                None => PixelRect {
                    left: x as i32,
                    top: y as i32,
                    right: x as i32 + 1,
                    bottom: y as i32 + 1,
                },
            });
        }
    }
    BitmapAlphaSummary {
        nontransparent_pixels,
        bounds,
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
            boundary_guide: None,
            boundary_guide_dirty: None,
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
            mode: OverlayMode::Trail,
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

fn boundary_guide_origin(frame: BoundaryGuideFrame) -> Point {
    Point {
        x: frame.screen.left,
        y: frame.screen.top,
    }
}

fn boundary_guide_rect(
    frame: BoundaryGuideFrame,
    monitor_origin: (i32, i32),
    width: i32,
    height: i32,
) -> Option<PixelRect> {
    let area = frame.area;
    PixelRect {
        left: area.left.saturating_sub(monitor_origin.0),
        top: area.top.saturating_sub(monitor_origin.1),
        right: area
            .right
            .saturating_sub(monitor_origin.0)
            .saturating_add(1),
        bottom: area
            .bottom
            .saturating_sub(monitor_origin.1)
            .saturating_add(1),
    }
    .clamp(width, height)
}

fn mark_boundary_guide_dirty(state: &mut OverlayState, frame: BoundaryGuideFrame) {
    let Some(rect) = boundary_guide_rect(frame, state.monitor_origin, state.width, state.height)
    else {
        return;
    };
    state.boundary_guide_dirty = Some(
        state
            .boundary_guide_dirty
            .map_or(rect, |dirty| dirty.union(rect)),
    );
}

fn clear_boundary_guide(state: &mut OverlayState) -> bool {
    let Some(previous) = state.boundary_guide.take() else {
        return false;
    };
    mark_boundary_guide_dirty(state, previous);
    true
}

fn clear_pixmap_region(pixmap: &mut PixmapMut<'_>, dirty: PixelRect) {
    let Some(dirty) = dirty.clamp(pixmap.width() as i32, pixmap.height() as i32) else {
        return;
    };
    let width = pixmap.width() as usize;
    let data = pixmap.data_mut();
    for row in dirty.top as usize..dirty.bottom as usize {
        let start = (row * width + dirty.left as usize) * 4;
        let end = (row * width + dirty.right as usize) * 4;
        data[start..end].fill(0);
    }
}

fn clear_boundary_guide_surface(state: &mut OverlayState) {
    let Some(dirty) = state.boundary_guide_dirty else {
        return;
    };
    if !state.bits.is_null() && state.width > 0 && state.height > 0 {
        let byte_len = (state.width * state.height * 4) as usize;
        let data = unsafe { std::slice::from_raw_parts_mut(state.bits, byte_len) };
        if let Some(mut pixmap) =
            PixmapMut::from_bytes(data, state.width as u32, state.height as u32)
        {
            clear_pixmap_region(&mut pixmap, dirty);
            present(state, Some(dirty));
        }
    }
    state.boundary_guide_dirty = None;
}

fn present_source_alpha(state: &OverlayState) -> u8 {
    if state.boundary_guide.is_some() {
        255
    } else {
        state.alpha.min(255) as u8
    }
}

fn has_trail_or_label_content(state: &OverlayState) -> bool {
    (state.show_path && !state.points.is_empty()) || (state.show_label && state.label.is_some())
}

fn has_visual_content(state: &OverlayState) -> bool {
    state.boundary_guide.is_some() || has_trail_or_label_content(state)
}

/// Applies at most one frame's worth of commands and reports whether another wake is required.
/// Rendering before returning prevents a continuously growing queue from starving the overlay.
fn drain_commands(rx: &Receiver<OverlayCommand>, state: &mut OverlayState) -> bool {
    drain_commands_with_surface(rx, state, ensure_surface_for)
}

fn drain_commands_with_surface<F>(
    rx: &Receiver<OverlayCommand>,
    state: &mut OverlayState,
    ensure_surface: F,
) -> bool
where
    F: FnMut(&mut OverlayState, Point),
{
    drain_commands_with_render(rx, state, ensure_surface, render)
}

fn drain_commands_with_render<F, R>(
    rx: &Receiver<OverlayCommand>,
    state: &mut OverlayState,
    mut ensure_surface: F,
    mut render_frame: R,
) -> bool
where
    F: FnMut(&mut OverlayState, Point),
    R: FnMut(&mut OverlayState),
{
    let batch = take_command_batch(rx, MAX_COMMANDS_PER_FRAME);
    let queue_depth = batch.commands.len() + rx.len();
    let mut grow_count = 0;
    let mut visual_dirty = false;
    let mut fade_after_render = false;
    for (batch_index, cmd) in batch.commands.into_iter().enumerate() {
        let command_kind = cmd.debug_kind();
        if command_kind == "grow" {
            if state.points.is_empty() || !state.show_path || !state.visible {
                log_overlay_state("overlay_late_grow", command_kind, "before", state);
            }
        } else {
            log_overlay_state("overlay_command_state", command_kind, "before", state);
            log::debug!(
                target: "platform.windows",
                "event=overlay_command_processing command={} batch_index={} queue_depth={}",
                command_kind,
                batch_index,
                queue_depth,
            );
        }
        match cmd {
            OverlayCommand::SetBoundaryGuide(frame) => {
                let previous = state.boundary_guide;
                state.boundary_guide = Some(frame);
                ensure_surface(state, boundary_guide_origin(frame));
                if let Some(previous) = previous {
                    mark_boundary_guide_dirty(state, previous);
                }
                mark_boundary_guide_dirty(state, frame);
                visual_dirty = true;
            }
            OverlayCommand::ClearBoundaryGuide => {
                let cleared = clear_boundary_guide(state);
                if cleared {
                    clear_boundary_guide_surface(state);
                }
                visual_dirty |= cleared;
            }
            OverlayCommand::Begin {
                origin,
                colors,
                show_path,
                show_label,
                fade_out,
            } => {
                if clear_boundary_guide(state) {
                    clear_boundary_guide_surface(state);
                }
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
                state.mode = OverlayMode::Trail;
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
                let label_feedback_active = state.mode == OverlayMode::LabelFeedback;
                let should_fade_label = !label_feedback_active
                    && state.show_label
                    && state.label.is_some()
                    && state.fade_out
                    && (state.visible || visual_dirty);
                if clear_boundary_guide(state) {
                    clear_boundary_guide_surface(state);
                }
                if !label_feedback_active {
                    fade_after_render = should_fade_label;
                    stop_fade(state);
                }
                visual_dirty = false;
                state.points.clear();
                state.rendered_points = 0;
                state.show_path = false;
                state.needs_full_redraw = true;
                let preserve_visual = (label_feedback_active && has_trail_or_label_content(state))
                    || should_fade_label;
                if preserve_visual {
                    visual_dirty = true;
                } else {
                    hide(state);
                }
            }
            OverlayCommand::Cancel => {
                if clear_boundary_guide(state) {
                    clear_boundary_guide_surface(state);
                }
                fade_after_render = false;
                stop_fade(state);
                hide(state);
                visual_dirty = false;
                state.points.clear();
                state.rendered_points = 0;
                state.show_path = false;
                state.mode = OverlayMode::Trail;
                state.needs_full_redraw = true;
            }
            OverlayCommand::ShowLabelFeedback {
                origin,
                text,
                fade_out,
                display_duration,
                fade_duration,
            } => {
                if clear_boundary_guide(state) {
                    clear_boundary_guide_surface(state);
                }
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
                state.mode = OverlayMode::LabelFeedback;
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
        if command_kind != "grow" {
            log_overlay_state("overlay_command_state", command_kind, "after", state);
        }
    }
    state.stats.record_batch(grow_count, queue_depth);
    if visual_dirty {
        if state.boundary_guide.is_some() || !state.show_path || state.points.is_empty() {
            log_overlay_state("overlay_render_requested", "batch", "before", state);
        }
        if has_visual_content(state) {
            render_frame(state);
        } else {
            state.boundary_guide_dirty = None;
            hide(state);
        }
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
    log::debug!(
        target: "platform.windows",
        "event=overlay_visibility_changed from={} to={} points={} rendered_points={} show_path={} needs_full_redraw={} boundary_guide={} transition_context=state_update",
        state.visible,
        visible,
        state.points.len(),
        state.rendered_points,
        state.show_path,
        state.needs_full_redraw,
        state.boundary_guide.is_some(),
    );
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
    let guide_dirty = state.boundary_guide_dirty;
    let guide_requires_full_redraw = guide_dirty.is_some();
    let requested_full_redraw = state.needs_full_redraw;
    let bitmap_diagnostic_enabled = log::log_enabled!(
        target: "platform.windows",
        log::Level::Debug
    ) && requested_full_redraw;
    let bitmap_before =
        bitmap_diagnostic_enabled.then(|| bitmap_alpha_summary(pixmap.data_mut(), width, height));
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
    let full_redraw = requested_full_redraw
        || guide_requires_full_redraw
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
        if let Some(frame) = state.boundary_guide {
            draw_boundary_guide(&mut pixmap, &frame, state.monitor_origin, state.dpi_factor);
        }
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

    let present_dirty = if state.needs_full_present || requested_full_redraw {
        None
    } else if guide_requires_full_redraw {
        let mut guide_present_dirty = guide_dirty.expect("guide dirty bounds are present");
        if let Some(trail) = incremental_dirty {
            guide_present_dirty = guide_present_dirty.union(trail);
        }
        if let Some(label) = label_rect {
            guide_present_dirty = guide_present_dirty.union(label);
        }
        Some(guide_present_dirty)
    } else {
        Some(dirty)
    };
    let bitmap_after =
        bitmap_diagnostic_enabled.then(|| bitmap_alpha_summary(pixmap.data_mut(), width, height));
    let present_mode = if present_dirty.is_some() {
        "dirty"
    } else {
        "full"
    };
    if guide_requires_full_redraw || !state.show_path || state.points.is_empty() {
        log::debug!(
            target: "platform.windows",
            "event=overlay_render full_redraw={} requested_full_redraw={} guide_requires_full_redraw={} points={} rendered_points={} show_path={} visible={} guide_dirty={:?} incremental_dirty={:?} present_mode={} present_dirty={:?} bitmap_alpha_before_pixels={:?} bitmap_alpha_before_bounds={:?} bitmap_alpha_after_pixels={:?} bitmap_alpha_after_bounds={:?}",
            full_redraw,
            requested_full_redraw,
            guide_requires_full_redraw,
            state.points.len(),
            state.rendered_points,
            state.show_path,
            state.visible,
            guide_dirty,
            incremental_dirty,
            present_mode,
            present_dirty,
            bitmap_before.map(|summary| summary.nontransparent_pixels),
            bitmap_before.and_then(|summary| summary.bounds),
            bitmap_after.map(|summary| summary.nontransparent_pixels),
            bitmap_after.and_then(|summary| summary.bounds),
        );
    }
    let present_started = Instant::now();
    present(state, present_dirty);
    let present_elapsed = present_started.elapsed();
    state.needs_full_present = false;
    state.boundary_guide_dirty = None;
    set_overlay_visible(state, true);
    state.stats.record_render(raster_elapsed, present_elapsed);
}

fn draw_boundary_guide(
    pixmap: &mut PixmapMut<'_>,
    frame: &BoundaryGuideFrame,
    monitor_origin: (i32, i32),
    surface_dpi: f32,
) {
    let Some(rect) = boundary_guide_rect(
        *frame,
        monitor_origin,
        pixmap.width() as i32,
        pixmap.height() as i32,
    ) else {
        return;
    };

    let frame_dpi = frame.dpi_scale_milli as f32 / 1000.0;
    let dpi = if frame_dpi.is_finite() && frame_dpi > 0.0 {
        frame_dpi
    } else {
        surface_dpi.max(1.0)
    };
    let fill = guide_paint([112, 118, 126], compose_guide_alpha(128, frame.alpha));
    let border = guide_paint([255, 255, 255], frame.alpha);
    let stroke_width = dpi.max(1.0);
    let path = match frame.region {
        CornerEdgeHit::Corner(corner) => {
            let width = (rect.right - rect.left) as f32;
            let height = (rect.bottom - rect.top) as f32;
            let logical_width = frame.area.right.saturating_sub(frame.area.left) as f32 * dpi;
            let logical_height = frame.area.bottom.saturating_sub(frame.area.top) as f32 * dpi;
            let radius = logical_width
                .min(logical_height)
                .min(width)
                .min(height)
                .max(0.0);
            guide_corner_path(rect, corner, radius)
        }
        CornerEdgeHit::Edge(_) => {
            let width = (rect.right - rect.left) as f32;
            let height = (rect.bottom - rect.top) as f32;
            let radius = (4.0 * dpi).min(width / 2.0).min(height / 2.0);
            guide_rounded_rect_path(rect, radius)
        }
    };
    let Some(path) = path else {
        return;
    };
    pixmap.fill_path(
        &path,
        &fill,
        tiny_skia::FillRule::Winding,
        Transform::identity(),
        None,
    );
    pixmap.stroke_path(
        &path,
        &border,
        &Stroke {
            width: stroke_width,
            line_cap: LineCap::Round,
            line_join: LineJoin::Round,
            ..Default::default()
        },
        Transform::identity(),
        None,
    );
}

fn compose_guide_alpha(base: u8, frame: u8) -> u8 {
    (u16::from(base) * u16::from(frame) / 255) as u8
}

fn guide_paint(rgb: [u8; 3], alpha: u8) -> Paint<'static> {
    let argb = (u32::from(alpha) << 24)
        | (u32::from(rgb[0]) << 16)
        | (u32::from(rgb[1]) << 8)
        | u32::from(rgb[2]);
    let mut paint = Paint::default();
    paint.set_color(skia_dib_color(argb));
    paint.anti_alias = true;
    paint
}

fn guide_corner_path(
    rect: PixelRect,
    corner: ScreenCorner,
    radius: f32,
) -> Option<tiny_skia::Path> {
    const KAPPA: f32 = 0.5522848;
    let left = rect.left as f32;
    let top = rect.top as f32;
    let right = rect.right as f32;
    let bottom = rect.bottom as f32;
    let (center_x, center_y, x_sign, y_sign) = match corner {
        ScreenCorner::LeftTop => (left, top, 1.0, 1.0),
        ScreenCorner::LeftBottom => (left, bottom, 1.0, -1.0),
        ScreenCorner::RightTop => (right, top, -1.0, 1.0),
        ScreenCorner::RightBottom => (right, bottom, -1.0, -1.0),
    };
    let mut builder = PathBuilder::new();
    builder.move_to(center_x, center_y);
    builder.line_to(center_x + x_sign * radius, center_y);
    builder.cubic_to(
        center_x + x_sign * radius,
        center_y + y_sign * radius * KAPPA,
        center_x + x_sign * radius * KAPPA,
        center_y + y_sign * radius,
        center_x,
        center_y + y_sign * radius,
    );
    builder.close();
    builder.finish()
}

fn guide_rounded_rect_path(rect: PixelRect, radius: f32) -> Option<tiny_skia::Path> {
    const KAPPA: f32 = 0.5522848;
    let left = rect.left as f32;
    let top = rect.top as f32;
    let right = rect.right as f32;
    let bottom = rect.bottom as f32;
    let mut builder = PathBuilder::new();
    builder.move_to(left + radius, top);
    builder.line_to(right - radius, top);
    builder.cubic_to(
        right - radius + radius * KAPPA,
        top,
        right,
        top + radius - radius * KAPPA,
        right,
        top + radius,
    );
    builder.line_to(right, bottom - radius);
    builder.cubic_to(
        right,
        bottom - radius + radius * KAPPA,
        right - radius + radius * KAPPA,
        bottom,
        right - radius,
        bottom,
    );
    builder.line_to(left + radius, bottom);
    builder.cubic_to(
        left + radius - radius * KAPPA,
        bottom,
        left,
        bottom - radius + radius * KAPPA,
        left,
        bottom - radius,
    );
    builder.line_to(left, top + radius);
    builder.cubic_to(
        left,
        top + radius - radius * KAPPA,
        left + radius - radius * KAPPA,
        top,
        left + radius,
        top,
    );
    builder.close();
    builder.finish()
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
            SourceConstantAlpha: present_source_alpha(state),
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

fn render_fade_step(state: &mut OverlayState) {
    present(state, None);
}

fn finish_fade(state: &mut OverlayState) {
    stop_fade(state);
    state.points.clear();
    state.rendered_points = 0;
    state.label = None;
    if state.boundary_guide.is_some() {
        state.needs_full_redraw = true;
        render(state);
    } else {
        hide(state);
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
            finish_fade(state);
            return;
        }
        let remaining = duration.saturating_sub(elapsed);
        state.alpha = ((remaining.as_secs_f64() / duration.as_secs_f64()) * 255.0)
            .round()
            .clamp(1.0, 255.0) as u16;
        render_fade_step(state);
        return;
    }
    if state.alpha <= FADE_STEP {
        finish_fade(state);
        return;
    }
    state.alpha -= FADE_STEP;
    render_fade_step(state);
}

fn hide(state: &mut OverlayState) {
    stop_fade_timer(state);
    set_overlay_visible(state, false);
    state.alpha = 255;
    state.label = None;
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
    use crate::engine::corners::{
        BoundaryGuideFrame, CornerEdgeHit, ScreenCorner, ScreenEdge, ScreenRect,
    };
    use tiny_skia::Pixmap;
    use windows::Win32::UI::WindowsAndMessaging::WS_POPUP;

    fn point(value: i32) -> Point {
        Point { x: value, y: value }
    }

    fn boundary_guide_frame(area: ScreenRect, region: CornerEdgeHit) -> BoundaryGuideFrame {
        BoundaryGuideFrame {
            screen: ScreenRect {
                left: 0,
                top: 0,
                right: 127,
                bottom: 127,
            },
            area,
            region,
            dpi_scale_milli: 1000,
            alpha: 128,
        }
    }

    fn corner_boundary_guide_frame(corner: ScreenCorner) -> BoundaryGuideFrame {
        let area = match corner {
            ScreenCorner::LeftTop => ScreenRect {
                left: 0,
                top: 0,
                right: 10,
                bottom: 10,
            },
            ScreenCorner::RightTop => ScreenRect {
                left: 6,
                top: 0,
                right: 16,
                bottom: 10,
            },
            ScreenCorner::LeftBottom => ScreenRect {
                left: 0,
                top: 6,
                right: 10,
                bottom: 16,
            },
            ScreenCorner::RightBottom => ScreenRect {
                left: 6,
                top: 6,
                right: 16,
                bottom: 16,
            },
        };
        boundary_guide_frame(area, CornerEdgeHit::Corner(corner))
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
            boundary_guide: None,
            boundary_guide_dirty: None,
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
            mode: OverlayMode::Trail,
            dpi_factor: 1.0,
            font: None,
            stats: OverlayStats::new(),
        }
    }

    fn test_state_with_surface(width: i32, height: i32) -> (OverlayState, Vec<u8>) {
        let mut pixels = vec![0; (width * height * 4) as usize];
        let mut state = test_state();
        state.tiles.clear();
        state.bits = pixels.as_mut_ptr();
        state.width = width;
        state.height = height;
        (state, pixels)
    }

    fn pixel_at(pixels: &[u8], width: i32, x: i32, y: i32) -> [u8; 4] {
        let offset = ((y * width + x) * 4) as usize;
        pixels[offset..offset + 4].try_into().unwrap()
    }

    #[test]
    fn boundary_guide_lifecycle_keeps_empty_overlay_visible_until_clear() {
        let (tx, rx) = unbounded();
        let (mut state, _pixels) = test_state_with_surface(64, 64);
        let frame = boundary_guide_frame(
            ScreenRect {
                left: 0,
                top: 0,
                right: 31,
                bottom: 31,
            },
            CornerEdgeHit::Corner(ScreenCorner::LeftTop),
        );

        tx.send(OverlayCommand::SetBoundaryGuide(frame)).unwrap();
        assert!(!drain_commands_with_surface(
            &rx,
            &mut state,
            |_state, _origin| {}
        ));
        assert_eq!(state.boundary_guide, Some(frame));
        assert!(state.visible);

        tx.send(OverlayCommand::ClearBoundaryGuide).unwrap();
        assert!(!drain_commands_with_surface(
            &rx,
            &mut state,
            |_state, _origin| {}
        ));
        assert!(state.boundary_guide.is_none());
        assert!(!state.visible);
    }

    #[test]
    fn boundary_guide_stays_hidden_until_render_completes() {
        let (tx, rx) = unbounded();
        let mut state = test_state();
        state.tiles.clear();
        let frame = boundary_guide_frame(
            ScreenRect {
                left: 0,
                top: 0,
                right: 31,
                bottom: 31,
            },
            CornerEdgeHit::Corner(ScreenCorner::LeftTop),
        );
        tx.send(OverlayCommand::SetBoundaryGuide(frame)).unwrap();

        let mut visible_during_render = None;
        assert!(!drain_commands_with_render(
            &rx,
            &mut state,
            |_state, _origin| {},
            |state| {
                visible_during_render = Some(state.visible);
                state.visible = true;
            },
        ));

        assert_eq!(visible_during_render, Some(false));
        assert!(state.visible);
    }

    #[test]
    fn boundary_guide_dirty_bounds_cover_previous_and_next_areas() {
        let (tx, rx) = unbounded();
        let mut state = test_state();
        state.tiles.clear();
        state.monitor_origin = (0, 0);
        state.width = 128;
        state.height = 128;
        let first = boundary_guide_frame(
            ScreenRect {
                left: 0,
                top: 0,
                right: 31,
                bottom: 31,
            },
            CornerEdgeHit::Corner(ScreenCorner::LeftTop),
        );
        let next = boundary_guide_frame(
            ScreenRect {
                left: 80,
                top: 80,
                right: 111,
                bottom: 111,
            },
            CornerEdgeHit::Corner(ScreenCorner::RightBottom),
        );

        tx.send(OverlayCommand::SetBoundaryGuide(first)).unwrap();
        tx.send(OverlayCommand::SetBoundaryGuide(next)).unwrap();
        assert!(!drain_commands_with_surface(
            &rx,
            &mut state,
            |_state, _origin| {}
        ));
        assert_eq!(state.boundary_guide, Some(next));
        assert_eq!(
            state.boundary_guide_dirty,
            Some(PixelRect {
                left: 0,
                top: 0,
                right: 112,
                bottom: 112,
            })
        );
    }

    #[test]
    fn boundary_guide_raster_has_nontransparent_pixels_in_expected_area() {
        let frame = boundary_guide_frame(
            ScreenRect {
                left: 0,
                top: 0,
                right: 31,
                bottom: 31,
            },
            CornerEdgeHit::Corner(ScreenCorner::LeftTop),
        );
        let mut pixmap = Pixmap::new(64, 64).unwrap();
        draw_boundary_guide(&mut pixmap.as_mut(), &frame, (0, 0), 1.0);

        let inside = ((8 * 64 + 8) * 4) as usize;
        let outside = ((48 * 64 + 48) * 4) as usize;
        assert!(pixmap.data()[inside + 3] > 0);
        assert_eq!(pixmap.data()[outside + 3], 0);
    }

    #[test]
    fn boundary_guide_fill_uses_windows_dib_channel_semantics() {
        let frame = boundary_guide_frame(
            ScreenRect {
                left: 0,
                top: 0,
                right: 31,
                bottom: 31,
            },
            CornerEdgeHit::Edge(ScreenEdge::Top),
        );
        let mut pixmap = Pixmap::new(64, 64).unwrap();
        draw_boundary_guide(&mut pixmap.as_mut(), &frame, (0, 0), 1.0);

        let pixel = ((8 * 64 + 8) * 4) as usize;
        assert_eq!(&pixmap.data()[pixel..pixel + 4], &[32, 30, 28, 64]);
    }

    #[test]
    fn boundary_guide_corner_raster_is_a_quarter_disk_with_white_border() {
        for (corner, interior, outside_disk, border) in [
            (ScreenCorner::LeftTop, (4, 4), (9, 9), (0, 0)),
            (ScreenCorner::RightTop, (12, 4), (7, 9), (15, 0)),
            (ScreenCorner::LeftBottom, (4, 12), (9, 7), (0, 15)),
            (ScreenCorner::RightBottom, (12, 12), (7, 7), (15, 15)),
        ] {
            let mut frame = corner_boundary_guide_frame(corner);
            frame.alpha = 255;
            let mut pixmap = Pixmap::new(16, 16).unwrap();
            draw_boundary_guide(&mut pixmap.as_mut(), &frame, (0, 0), 1.0);

            let interior = pixel_at(pixmap.data(), 16, interior.0, interior.1);
            let outside_disk = pixel_at(pixmap.data(), 16, outside_disk.0, outside_disk.1);
            let border = pixel_at(pixmap.data(), 16, border.0, border.1);

            assert!(interior[3] > 0, "{corner:?} interior should be visible");
            assert_eq!(
                outside_disk[3], 0,
                "{corner:?} wrong quadrant should be clear"
            );
            assert!(
                u16::from(border[0]) + u16::from(border[1]) + u16::from(border[2])
                    > u16::from(interior[0]) + u16::from(interior[1]) + u16::from(interior[2]),
                "{corner:?} border should be brighter than fill"
            );
        }
    }

    #[test]
    fn clear_boundary_guide_erases_previous_bitmap_pixels() {
        let dirty = PixelRect {
            left: 4,
            top: 5,
            right: 12,
            bottom: 13,
        };
        let mut pixmap = Pixmap::new(32, 32).unwrap();
        pixmap.fill(tiny_skia::Color::from_rgba8(12, 34, 56, 255));

        clear_pixmap_region(&mut pixmap.as_mut(), dirty);

        for y in dirty.top..dirty.bottom {
            for x in dirty.left..dirty.right {
                let offset = ((y * 32 + x) * 4) as usize;
                assert_eq!(&pixmap.data()[offset..offset + 4], &[0, 0, 0, 0]);
            }
        }
        let outside = ((0 * 32 + 0) * 4) as usize;
        assert_eq!(&pixmap.data()[outside..outside + 4], &[12, 34, 56, 255]);
    }

    #[test]
    fn end_clears_trail_and_fades_normal_label() {
        let (tx, rx) = unbounded();
        let mut state = test_state();
        state.tiles.clear();
        state.boundary_guide = Some(boundary_guide_frame(
            ScreenRect {
                left: 0,
                top: 0,
                right: 31,
                bottom: 31,
            },
            CornerEdgeHit::Corner(ScreenCorner::LeftTop),
        ));
        state.points = vec![point(10), point(20)];
        state.show_path = true;
        state.show_label = true;
        state.label = Some("match".into());
        state.visible = true;
        state.fade_out = true;

        tx.send(OverlayCommand::End).unwrap();
        drain_commands_with_surface(&rx, &mut state, |_state, _origin| {});

        assert!(state.boundary_guide.is_none());
        assert!(state.points.is_empty());
        assert!(!state.show_path);
        assert_eq!(state.label.as_deref(), Some("match"));
        assert!(state.visible);
        assert_ne!(state.fade_timer_id, 0);

        for _ in 0..32 {
            fade_step(&mut state);
        }

        assert!(state.label.is_none());
        assert!(!state.visible);
    }

    #[test]
    fn normal_trail_end_requests_label_fade_and_finishes_hidden() {
        let (tx, rx) = unbounded();
        let (mut state, _pixels) = test_state_with_surface(64, 64);
        let colors = TrailColors {
            main: 0xff27e518,
            unrecognized: 0xffff2424,
        };

        tx.send(OverlayCommand::Begin {
            origin: point(10),
            colors,
            show_path: true,
            show_label: true,
            fade_out: true,
        })
        .unwrap();
        tx.send(OverlayCommand::Recognized(Some("match".into())))
            .unwrap();
        tx.send(OverlayCommand::End).unwrap();

        assert!(!drain_commands_with_surface(
            &rx,
            &mut state,
            |_state, _origin| {},
        ));

        assert!(state.points.is_empty());
        assert!(!state.show_path);
        assert_eq!(state.label.as_deref(), Some("match"));
        assert!(state.visible);
        assert_ne!(state.fade_timer_id, 0);

        for _ in 0..32 {
            fade_step(&mut state);
        }

        assert!(state.label.is_none());
        assert!(!state.visible);
    }

    #[test]
    fn normal_trail_end_without_fade_clears_label_and_hides() {
        let (tx, rx) = unbounded();
        let (mut state, _pixels) = test_state_with_surface(64, 64);
        let colors = TrailColors {
            main: 0xff27e518,
            unrecognized: 0xffff2424,
        };

        tx.send(OverlayCommand::Begin {
            origin: point(10),
            colors,
            show_path: true,
            show_label: true,
            fade_out: false,
        })
        .unwrap();
        tx.send(OverlayCommand::Recognized(Some("match".into())))
            .unwrap();
        tx.send(OverlayCommand::End).unwrap();

        assert!(!drain_commands_with_surface(
            &rx,
            &mut state,
            |_state, _origin| {},
        ));

        assert!(state.points.is_empty());
        assert!(!state.show_path);
        assert!(state.label.is_none());
        assert!(!state.visible);
        assert_eq!(state.fade_timer_id, 0);
    }

    #[test]
    fn cancel_clears_trail_immediately_without_starting_trail_fade() {
        let (tx, rx) = unbounded();
        let mut state = test_state();
        state.tiles.clear();
        state.points = vec![point(10), point(20)];
        state.show_path = true;
        state.visible = true;
        state.fade_out = true;
        state.fade_duration = Some(Duration::from_millis(500));
        state.fade_timer_id = 17;
        state.fade_started_at = Some(Instant::now());
        state.mode = OverlayMode::LabelFeedback;

        tx.send(OverlayCommand::Cancel).unwrap();
        drain_commands_with_surface(&rx, &mut state, |_state, _origin| {});

        assert!(state.points.is_empty());
        assert!(!state.show_path);
        assert!(!state.visible);
        assert_eq!(state.fade_timer_id, 0);
        assert!(state.fade_started_at.is_none());
        assert!(state.fade_delay_until.is_none());
        assert_eq!(state.mode, OverlayMode::Trail);
    }

    #[test]
    fn set_boundary_guide_uses_independent_present_alpha_during_trail_fade() {
        let (tx, rx) = unbounded();
        let mut state = test_state();
        state.tiles.clear();
        state.visible = true;
        state.alpha = 48;
        state.fade_timer_id = 17;
        state.fade_started_at = Some(Instant::now());

        tx.send(OverlayCommand::SetBoundaryGuide(boundary_guide_frame(
            ScreenRect {
                left: 0,
                top: 0,
                right: 31,
                bottom: 31,
            },
            CornerEdgeHit::Corner(ScreenCorner::LeftTop),
        )))
        .unwrap();
        drain_commands_with_surface(&rx, &mut state, |_state, _origin| {});

        assert_eq!(present_source_alpha(&state), 255);
        assert_eq!(state.alpha, 48);
        assert_eq!(state.fade_timer_id, 17);
        assert!(state.fade_started_at.is_some());
    }

    #[test]
    fn guide_redraw_after_end_does_not_restore_previous_trail_pixels() {
        let (tx, rx) = unbounded();
        let (mut state, pixels) = test_state_with_surface(128, 128);
        let frame = boundary_guide_frame(
            ScreenRect {
                left: 0,
                top: 0,
                right: 31,
                bottom: 31,
            },
            CornerEdgeHit::Corner(ScreenCorner::LeftTop),
        );
        state.points = vec![point(80), point(96)];
        state.show_path = true;
        state.visible = true;
        state.fade_out = true;

        render(&mut state);
        assert!(pixel_at(&pixels, state.width, 80, 80)[3] > 0);

        tx.send(OverlayCommand::End).unwrap();
        tx.send(OverlayCommand::SetBoundaryGuide(frame)).unwrap();
        drain_commands_with_surface(&rx, &mut state, |_state, _origin| {});

        assert_eq!(pixel_at(&pixels, state.width, 80, 80), [0, 0, 0, 0]);
        assert!(pixel_at(&pixels, state.width, 8, 8)[3] > 0);
        assert_eq!(state.boundary_guide, Some(frame));
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
    fn end_in_the_same_batch_starts_the_pending_label_feedback_fade_once() {
        let (tx, rx) = unbounded();
        let mut state = test_state();
        state.tiles.clear();
        state.points = vec![point(10), point(20)];
        state.rendered_points = 2;
        state.show_path = true;

        tx.send(OverlayCommand::ShowLabelFeedback {
            origin: Point { x: 100, y: 200 },
            text: "42%".into(),
            fade_out: true,
            display_duration: Some(Duration::from_millis(500)),
            fade_duration: Some(Duration::from_millis(800)),
        })
        .unwrap();
        tx.send(OverlayCommand::End).unwrap();

        assert!(!drain_commands_with_surface(
            &rx,
            &mut state,
            |state, _origin| {
                state.visible = true;
            }
        ));

        assert!(state.points.is_empty());
        assert_eq!(state.rendered_points, 0);
        assert!(!state.show_path);
        assert_eq!(state.label.as_deref(), Some("42%"));
        assert_eq!(state.fade_timer_id, 1);
        assert_eq!(state.next_fade_timer_id, 1);
        assert!(state.fade_started_at.is_none());
        assert!(state.fade_delay_until.is_some());
    }

    #[test]
    fn end_in_a_later_batch_preserves_the_existing_label_feedback_fade() {
        let (tx, rx) = unbounded();
        let mut state = test_state();
        state.tiles.clear();

        tx.send(OverlayCommand::ShowLabelFeedback {
            origin: Point { x: 100, y: 200 },
            text: "42%".into(),
            fade_out: true,
            display_duration: Some(Duration::from_millis(500)),
            fade_duration: Some(Duration::from_millis(800)),
        })
        .unwrap();
        drain_commands_with_surface(&rx, &mut state, |state, _origin| {
            state.visible = true;
        });

        let feedback_timer_id = state.fade_timer_id;
        let feedback_next_timer_id = state.next_fade_timer_id;
        let feedback_fade_started_at = state.fade_started_at;
        let feedback_fade_delay_until = state.fade_delay_until;
        assert_ne!(feedback_timer_id, 0);
        assert!(feedback_fade_started_at.is_some() || feedback_fade_delay_until.is_some());

        tx.send(OverlayCommand::End).unwrap();
        drain_commands_with_surface(&rx, &mut state, |_state, _origin| {});

        assert!(state.points.is_empty());
        assert_eq!(state.rendered_points, 0);
        assert!(!state.show_path);
        assert_eq!(state.label.as_deref(), Some("42%"));
        assert_eq!(state.fade_timer_id, feedback_timer_id);
        assert_eq!(state.next_fade_timer_id, feedback_next_timer_id);
        assert_eq!(state.fade_started_at, feedback_fade_started_at);
        assert_eq!(state.fade_delay_until, feedback_fade_delay_until);
    }

    #[test]
    fn independent_label_feedback_without_fade_clears_label() {
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
        assert!(state.label.is_none());
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
    fn reaching_visual_point_limit_preserves_recognition_when_label_hidden() {
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
        assert!(!state.show_label);
        assert!(state.recognized);
        assert!(state.label.is_none());
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
