// Main-thread AppKit overlay backed by a CALayer and tiny-skia frames.

use crate::engine::corners::{BoundaryGuideFrame, CornerEdgeHit, ScreenCorner, ScreenEdge};
use crate::engine::types::Point;
pub use crate::platform::overlay::OverlayCommand as OverlayCmd;
use crate::platform::overlay::OverlaySink;
pub use crate::platform::overlay::{OverlayCommand, TrailColors};
use objc2::rc::Retained;
use objc2::{MainThreadMarker, MainThreadOnly};
use objc2_app_kit::{
    NSBackingStoreType, NSColor, NSStatusWindowLevel, NSWindow, NSWindowCollectionBehavior,
    NSWindowStyleMask,
};
use objc2_core_foundation::{CFData, CGPoint, CGRect, CGSize};
use objc2_core_graphics::{
    CGBitmapInfo, CGColorRenderingIntent, CGColorSpace, CGDataProvider, CGDirectDisplayID,
    CGDisplayBounds, CGDisplayPixelsWide, CGError, CGGetActiveDisplayList, CGImage,
    CGImageAlphaInfo, CGImageByteOrderInfo, CGImageComponentInfo, CGImagePixelFormatInfo,
    CGMainDisplayID,
};
use objc2_quartz_core::{CALayer, CATransaction};
use parking_lot::Mutex;
use std::cell::RefCell;
use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tiny_skia::{LineCap, LineJoin, Paint, PathBuilder, Pixmap, PixmapMut, Stroke, Transform};

#[derive(Clone, Copy)]
struct TrailRenderStyle {
    screen_origin: Point,
    scale: f32,
    recognized: bool,
    colors: TrailColors,
}

#[derive(Clone)]
pub struct Overlay {
    app: tauri::AppHandle,
    generation: Arc<AtomicU64>,
    pending: Arc<Mutex<VecDeque<QueuedCommand>>>,
    drain_scheduled: Arc<AtomicBool>,
}

#[derive(Debug)]
struct QueuedCommand {
    command: OverlayCommand,
    generation: u64,
}

const MAX_COMMANDS_PER_DRAIN: usize = 4096;
const MAX_TRAIL_POINTS_BASE: usize = 512;
const DEFAULT_FADE_FRAMES: u32 = 10;
const FADE_FRAME_INTERVAL_MS: u128 = 16;

thread_local! {
    static STATE: RefCell<Option<OverlayState>> = const { RefCell::new(None) };
}

impl Overlay {
    pub fn spawn(app: &tauri::AppHandle) -> Self {
        Self {
            app: app.clone(),
            generation: Arc::new(AtomicU64::new(0)),
            pending: Arc::new(Mutex::new(VecDeque::new())),
            drain_scheduled: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn send(&self, command: OverlayCommand) {
        let generation = if starts_new_generation(&command) {
            self.generation.fetch_add(1, Ordering::AcqRel) + 1
        } else {
            self.generation.load(Ordering::Acquire)
        };
        self.pending.lock().push_back(QueuedCommand {
            command,
            generation,
        });
        schedule_drain(
            self.app.clone(),
            Arc::clone(&self.generation),
            Arc::clone(&self.pending),
            Arc::clone(&self.drain_scheduled),
        );
    }
}

fn starts_new_generation(command: &OverlayCommand) -> bool {
    matches!(
        command,
        OverlayCommand::Begin { .. }
            | OverlayCommand::Cancel
            | OverlayCommand::ShowLabelFeedback { .. }
    )
}

impl OverlaySink for Overlay {
    fn send(&self, command: OverlayCommand) {
        Overlay::send(self, command);
    }
}

fn take_pending_batch(
    pending: &Mutex<VecDeque<QueuedCommand>>,
    limit: usize,
) -> (Vec<QueuedCommand>, bool) {
    let mut pending = pending.lock();
    let count = pending.len().min(limit);
    let commands = pending.drain(..count).collect();
    (commands, !pending.is_empty())
}

fn schedule_drain(
    app: tauri::AppHandle,
    generation: Arc<AtomicU64>,
    pending: Arc<Mutex<VecDeque<QueuedCommand>>>,
    scheduled: Arc<AtomicBool>,
) {
    if scheduled.swap(true, Ordering::AcqRel) {
        return;
    }
    let callback_app = app.clone();
    let callback_generation = Arc::clone(&generation);
    let callback_pending = Arc::clone(&pending);
    let callback_scheduled = Arc::clone(&scheduled);
    if let Err(error) = app.run_on_main_thread(move || {
        let (batch, has_more) = take_pending_batch(&callback_pending, MAX_COMMANDS_PER_DRAIN);
        let mut fade_requests = Vec::new();
        STATE.with(|slot| {
            let mut slot = slot.borrow_mut();
            let state = slot.get_or_insert_with(OverlayState::default);
            let mut dirty = false;
            for queued in batch {
                let effect = state.apply(queued.command);
                dirty = (dirty || effect.dirty) && !effect.suppress_render;
                if effect.fade {
                    state.fade_active = true;
                    fade_requests.push((
                        queued.generation,
                        effect.display_duration,
                        effect.fade_duration,
                    ));
                }
            }
            if dirty {
                state.render();
            }
        });
        callback_scheduled.store(false, Ordering::Release);
        for (expected, display_duration, fade_duration) in fade_requests {
            spawn_fade(
                callback_app.clone(),
                Arc::clone(&callback_generation),
                expected,
                display_duration,
                fade_duration,
            );
        }
        if has_more || !callback_pending.lock().is_empty() {
            schedule_drain(
                callback_app,
                callback_generation,
                callback_pending,
                callback_scheduled,
            );
        }
    }) {
        scheduled.store(false, Ordering::Release);
        log::error!("schedule macOS overlay command failed: {error}");
    }
}

fn spawn_fade(
    app: tauri::AppHandle,
    generation: Arc<AtomicU64>,
    expected: u64,
    display_duration: Option<Duration>,
    fade_duration: Option<Duration>,
) {
    std::thread::spawn(move || {
        if let Some(display_duration) = display_duration {
            std::thread::sleep(display_duration);
            if generation.load(Ordering::Acquire) != expected {
                return;
            }
        }
        let (frames, interval) = fade_plan(fade_duration);
        for step in (0..=frames).rev() {
            if generation.load(Ordering::Acquire) != expected {
                return;
            }
            let alpha = step as f64 / frames as f64;
            let finish = step == 0;
            let scheduled_generation = Arc::clone(&generation);
            if app
                .run_on_main_thread(move || {
                    if scheduled_generation.load(Ordering::Acquire) != expected {
                        return;
                    }
                    STATE.with(|slot| {
                        if let Some(state) = slot.borrow_mut().as_mut() {
                            state.apply_fade_alpha(alpha);
                            state.render();
                            if finish {
                                state.finish_fade();
                            }
                        }
                    });
                })
                .is_err()
            {
                return;
            }
            std::thread::sleep(interval);
        }
    });
}

fn fade_plan(fade_duration: Option<Duration>) -> (u32, Duration) {
    let Some(duration) = fade_duration else {
        return (
            DEFAULT_FADE_FRAMES,
            Duration::from_millis(FADE_FRAME_INTERVAL_MS as u64),
        );
    };
    let duration_ms =
        (duration.as_millis() + FADE_FRAME_INTERVAL_MS - 1).max(FADE_FRAME_INTERVAL_MS);
    let frames = ((duration_ms + FADE_FRAME_INTERVAL_MS - 1) / FADE_FRAME_INTERVAL_MS)
        .min(u32::MAX as u128)
        .max(1) as u32;
    let interval_ms = (duration_ms / frames as u128).max(1).min(u64::MAX as u128) as u64;
    (frames, Duration::from_millis(interval_ms))
}

struct OverlayState {
    window: Option<Retained<NSWindow>>,
    layer: Option<Retained<CALayer>>,
    screen_origin: Point,
    label_bounds: PixelRect,
    width_points: i32,
    height_points: i32,
    scale: f32,
    pixmap: Option<Pixmap>,
    scratch: Vec<u8>,
    points: Vec<Point>,
    rendered_points: usize,
    needs_full_redraw: bool,
    boundary_guide: Option<BoundaryGuideFrame>,
    boundary_guide_dirty: Option<PixelRect>,
    colors: TrailColors,
    recognized: bool,
    label: Option<String>,
    show_path: bool,
    show_label: bool,
    fade_out: bool,
    active: bool,
    visible: bool,
    alpha: f64,
    fade_active: bool,
    mode: OverlayMode,
    font: Option<ab_glyph::FontVec>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum OverlayMode {
    Trail,
    LabelFeedback,
}

fn union_display_bounds(displays: &[CGRect]) -> Option<CGRect> {
    let first = *displays.first()?;
    let mut left = first.origin.x;
    let mut top = first.origin.y;
    let mut right = first.origin.x + first.size.width;
    let mut bottom = first.origin.y + first.size.height;
    for display in &displays[1..] {
        left = left.min(display.origin.x);
        top = top.min(display.origin.y);
        right = right.max(display.origin.x + display.size.width);
        bottom = bottom.max(display.origin.y + display.size.height);
    }
    Some(CGRect::new(
        CGPoint::new(left, top),
        CGSize::new(right - left, bottom - top),
    ))
}

fn active_display_bounds() -> Option<(CGRect, f32)> {
    let mut count = 0u32;
    let error = unsafe { CGGetActiveDisplayList(0, std::ptr::null_mut(), &mut count) };
    if error != CGError::Success || count == 0 {
        return None;
    }
    let mut displays = vec![CGDirectDisplayID::default(); count as usize];
    let error = unsafe { CGGetActiveDisplayList(count, displays.as_mut_ptr(), &mut count) };
    if error != CGError::Success {
        return None;
    }
    displays.truncate(count as usize);
    let bounds = displays
        .iter()
        .map(|display| CGDisplayBounds(*display))
        .collect::<Vec<_>>();
    let union = union_display_bounds(&bounds)?;
    let scale = displays
        .iter()
        .zip(bounds.iter())
        .map(|(display, bounds)| {
            CGDisplayPixelsWide(*display) as f32 / bounds.size.width.max(1.0) as f32
        })
        .fold(1.0, f32::max);
    Some((union, scale))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct PixelRect {
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
}

impl PixelRect {
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

    fn union(self, other: Self) -> Self {
        Self {
            left: self.left.min(other.left),
            top: self.top.min(other.top),
            right: self.right.max(other.right),
            bottom: self.bottom.max(other.bottom),
        }
    }
}

fn max_trail_points(scale: f32) -> usize {
    let scale = if scale.is_finite() {
        scale.max(1.0)
    } else {
        1.0
    };
    (MAX_TRAIL_POINTS_BASE as f32 * scale).round() as usize
}

fn visual_point_limit(width: i32, height: i32, scale: f32) -> usize {
    let traversal_points = (width.max(0) as usize + height.max(0) as usize).div_ceil(3) + 1;
    max_trail_points(scale).max(traversal_points)
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

fn boundary_guide_rect(
    frame: BoundaryGuideFrame,
    screen_origin: Point,
    scale: f32,
    width: i32,
    height: i32,
) -> Option<PixelRect> {
    let scale = if scale.is_finite() && scale > 0.0 {
        scale as f64
    } else {
        1.0
    };
    let local_pixel = |coordinate: i32, origin: i32, closed_end: bool| {
        let coordinate = coordinate as i64 + if closed_end { 1 } else { 0 };
        (((coordinate - origin as i64) as f64) * scale).round() as i32
    };
    PixelRect {
        left: local_pixel(frame.area.left, screen_origin.x, false),
        top: local_pixel(frame.area.top, screen_origin.y, false),
        right: local_pixel(frame.area.right, screen_origin.x, true),
        bottom: local_pixel(frame.area.bottom, screen_origin.y, true),
    }
    .clamp(width, height)
}

fn mark_boundary_guide_dirty(state: &mut OverlayState, frame: BoundaryGuideFrame) {
    let Some(pixmap) = state.pixmap.as_ref() else {
        return;
    };
    let Some(rect) = boundary_guide_rect(
        frame,
        state.screen_origin,
        state.scale,
        pixmap.width() as i32,
        pixmap.height() as i32,
    ) else {
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

fn has_trail_or_label_content(state: &OverlayState) -> bool {
    (state.show_path && !state.points.is_empty()) || (state.show_label && state.label.is_some())
}

impl Default for OverlayState {
    fn default() -> Self {
        Self {
            window: None,
            layer: None,
            screen_origin: Point::default(),
            label_bounds: PixelRect {
                left: 0,
                top: 0,
                right: 0,
                bottom: 0,
            },
            width_points: 0,
            height_points: 0,
            scale: 1.0,
            pixmap: None,
            scratch: Vec::new(),
            points: Vec::new(),
            rendered_points: 0,
            needs_full_redraw: true,
            boundary_guide: None,
            boundary_guide_dirty: None,
            colors: TrailColors {
                main: 0xff27e518,
                unrecognized: 0xffff2424,
            },
            recognized: false,
            label: None,
            show_path: true,
            show_label: true,
            fade_out: true,
            active: false,
            visible: false,
            alpha: 1.0,
            fade_active: false,
            mode: OverlayMode::Trail,
            font: load_label_font(),
        }
    }
}

impl OverlayState {
    fn apply(&mut self, command: OverlayCommand) -> ApplyEffect {
        self.apply_with_surface(command, Self::ensure_surface)
    }

    fn apply_with_surface<F>(
        &mut self,
        command: OverlayCommand,
        mut ensure_surface: F,
    ) -> ApplyEffect
    where
        F: FnMut(&mut Self, Point) -> Result<(), String>,
    {
        match command {
            OverlayCommand::SetBoundaryGuide(frame) => {
                let previous = self.boundary_guide;
                if let Err(error) = ensure_surface(
                    self,
                    Point {
                        x: frame.screen.left,
                        y: frame.screen.top,
                    },
                ) {
                    log::error!("create macOS boundary guide surface failed: {error}");
                    return ApplyEffect::default();
                }
                self.boundary_guide = Some(frame);
                if let Some(previous) = previous {
                    mark_boundary_guide_dirty(self, previous);
                }
                mark_boundary_guide_dirty(self, frame);
                self.visible = true;
                ApplyEffect::dirty()
            }
            OverlayCommand::ClearBoundaryGuide => {
                if !clear_boundary_guide(self) {
                    return ApplyEffect::default();
                }
                let has_content = has_trail_or_label_content(self);
                if !has_content {
                    self.hide();
                }
                ApplyEffect {
                    dirty: true,
                    fade: false,
                    display_duration: None,
                    fade_duration: None,
                    suppress_render: !has_content,
                }
            }
            OverlayCommand::Begin {
                origin,
                colors,
                show_path,
                show_label,
                fade_out,
            } => {
                clear_boundary_guide(self);
                self.fade_active = false;
                if let Err(error) = ensure_surface(self, origin) {
                    log::error!("create macOS overlay surface failed: {error}");
                    return ApplyEffect::default();
                }
                self.points.clear();
                self.points.push(origin);
                self.rendered_points = 0;
                self.needs_full_redraw = true;
                self.colors = colors;
                self.recognized = false;
                self.label = None;
                self.show_path = show_path;
                self.show_label = show_label;
                self.fade_out = fade_out;
                self.active = true;
                self.mode = OverlayMode::Trail;
                self.set_alpha(1.0);
                ApplyEffect::dirty()
            }
            OverlayCommand::Grow(point) => {
                if !self.active {
                    return ApplyEffect::default();
                }
                let limit = visual_point_limit(self.width_points, self.height_points, self.scale);
                let changed = append_visual_point(&mut self.points, point, limit);
                ApplyEffect {
                    dirty: changed && self.show_path,
                    fade: false,
                    display_duration: None,
                    fade_duration: None,
                    suppress_render: false,
                }
            }
            OverlayCommand::Recognized(label) => {
                if !self.active {
                    return ApplyEffect::default();
                }
                let recognized = label.is_some();
                let changed = self.recognized != recognized || self.label != label;
                self.recognized = recognized;
                self.label = label;
                self.needs_full_redraw |= changed;
                ApplyEffect {
                    dirty: changed,
                    fade: false,
                    display_duration: None,
                    fade_duration: None,
                    suppress_render: false,
                }
            }
            OverlayCommand::End => {
                let guide_cleared = clear_boundary_guide(self);
                if self.mode == OverlayMode::LabelFeedback {
                    return ApplyEffect {
                        dirty: guide_cleared,
                        fade: false,
                        display_duration: None,
                        fade_duration: None,
                        suppress_render: false,
                    };
                }
                self.active = false;
                self.points.clear();
                self.rendered_points = 0;
                self.show_path = false;
                self.fade_active = false;
                self.needs_full_redraw = true;
                if !has_trail_or_label_content(self) {
                    self.hide();
                    return ApplyEffect {
                        dirty: guide_cleared,
                        fade: false,
                        display_duration: None,
                        fade_duration: None,
                        suppress_render: true,
                    };
                }
                ApplyEffect {
                    dirty: guide_cleared || self.show_label,
                    fade: false,
                    display_duration: None,
                    fade_duration: None,
                    suppress_render: false,
                }
            }
            OverlayCommand::Cancel => {
                clear_boundary_guide(self);
                self.fade_active = false;
                self.active = false;
                self.mode = OverlayMode::Trail;
                self.hide();
                self.show_path = false;
                ApplyEffect {
                    dirty: false,
                    fade: false,
                    display_duration: None,
                    fade_duration: None,
                    suppress_render: true,
                }
            }
            OverlayCommand::ShowLabelFeedback {
                origin,
                text,
                fade_out,
                display_duration,
                fade_duration,
            } => {
                clear_boundary_guide(self);
                self.fade_active = false;
                self.hide();
                self.active = false;
                self.mode = OverlayMode::LabelFeedback;
                if let Err(error) = ensure_surface(self, origin) {
                    log::error!("create macOS overlay surface failed: {error}");
                    return ApplyEffect::default();
                }
                self.points.clear();
                self.rendered_points = 0;
                self.needs_full_redraw = true;
                self.recognized = true;
                self.label = Some(text);
                self.show_path = false;
                self.show_label = true;
                self.fade_out = fade_out;
                self.active = false;
                self.set_alpha(1.0);
                if fade_out {
                    ApplyEffect {
                        dirty: true,
                        fade: true,
                        display_duration,
                        fade_duration,
                        suppress_render: false,
                    }
                } else {
                    self.hide();
                    ApplyEffect {
                        dirty: false,
                        fade: false,
                        display_duration: None,
                        fade_duration: None,
                        suppress_render: true,
                    }
                }
            }
        }
    }

    fn ensure_surface(&mut self, origin: Point) -> Result<(), String> {
        let screen = super::window::screen_at(origin)
            .ok_or_else(|| "gesture display is unavailable".to_string())?;
        let (desktop_bounds, desktop_scale) = active_display_bounds()
            .ok_or_else(|| "active display bounds are unavailable".to_string())?;
        let width_points = desktop_bounds.size.width.round() as i32;
        let height_points = desktop_bounds.size.height.round() as i32;
        let screen_origin = Point {
            x: desktop_bounds.origin.x.round() as i32,
            y: desktop_bounds.origin.y.round() as i32,
        };
        let scale = desktop_scale.max(screen.dpi_scale as f32).max(1.0);
        let next_label_bounds = PixelRect {
            left: ((screen.bounds.left - screen_origin.x) as f32 * scale).round() as i32,
            top: ((screen.bounds.top - screen_origin.y) as f32 * scale).round() as i32,
            right: ((screen.bounds.right - screen_origin.x) as f32 * scale).round() as i32,
            bottom: ((screen.bounds.bottom - screen_origin.y) as f32 * scale).round() as i32,
        };
        let changed = self.window.is_none()
            || self.screen_origin != screen_origin
            || self.width_points != width_points
            || self.height_points != height_points
            || (self.scale - scale).abs() > f32::EPSILON;
        if changed {
            if let Some(window) = self.window.take() {
                window.orderOut(None);
            }
            let (window, layer) = create_window(screen_origin, width_points, height_points, scale)?;
            self.window = Some(window);
            self.layer = Some(layer);
            self.screen_origin = screen_origin;
            self.width_points = width_points;
            self.height_points = height_points;
            self.scale = scale;
            self.label_bounds = next_label_bounds;
            let width = (width_points as f32 * scale).round().max(1.0) as u32;
            let height = (height_points as f32 * scale).round().max(1.0) as u32;
            self.pixmap = Pixmap::new(width, height);
            self.rendered_points = 0;
            self.needs_full_redraw = true;
        } else if self.label_bounds != next_label_bounds {
            self.label_bounds = next_label_bounds;
            self.needs_full_redraw = true;
        }
        if let Some(window) = &self.window {
            window.orderFrontRegardless();
        }
        self.visible = true;
        Ok(())
    }

    fn render(&mut self) {
        let Some((surface_width, surface_height)) = self
            .pixmap
            .as_ref()
            .map(|pixmap| (pixmap.width() as i32, pixmap.height() as i32))
        else {
            return;
        };
        let first_unrendered = self.rendered_points.min(self.points.len());
        let incremental_start = first_unrendered.saturating_sub(1);
        let label_rect = self
            .label
            .as_deref()
            .filter(|_| self.show_label)
            .and_then(|label| measure_label_rect(self, label));
        let trail_rect = pixel_rect_for_points(
            &self.points[incremental_start..],
            self.screen_origin,
            self.scale,
            (2.0 * self.scale).ceil() as i32 + 2,
        )
        .and_then(|rect| rect.clamp(surface_width, surface_height));
        let full_redraw = self.needs_full_redraw
            || self.boundary_guide_dirty.is_some()
            || trail_rect
                .zip(label_rect)
                .is_some_and(|(trail, label)| trail.intersects(label));
        let trail_style = TrailRenderStyle {
            screen_origin: self.screen_origin,
            scale: self.scale,
            recognized: self.recognized,
            colors: self.colors,
        };
        let boundary_guide = self.boundary_guide;
        let Some(pixmap) = self.pixmap.as_mut() else {
            return;
        };
        if full_redraw {
            pixmap.fill(tiny_skia::Color::from_rgba8(0, 0, 0, 0));
            if self.show_path {
                draw_trail(&mut pixmap.as_mut(), &self.points, trail_style, (0.0, 0.0));
            }
            if self.show_label {
                if let (Some(label), Some(font)) = (self.label.as_deref(), self.font.as_ref()) {
                    draw_label(pixmap, font, self.scale, self.label_bounds, label);
                }
            }
            if let Some(frame) = boundary_guide {
                draw_boundary_guide(&mut pixmap.as_mut(), &frame, self.screen_origin, self.scale);
            }
        } else if self.show_path {
            let Some(dirty) = trail_rect else {
                return;
            };
            if !redraw_trail_region(pixmap, &mut self.scratch, dirty, &self.points, trail_style) {
                self.needs_full_redraw = true;
                return;
            }
        }
        self.rendered_points = self.points.len();
        self.needs_full_redraw = false;
        self.boundary_guide_dirty = None;
        if let Err(error) = self.present() {
            log::error!("present macOS overlay frame failed: {error}");
            self.hide();
        }
    }

    fn present(&self) -> Result<(), String> {
        let layer = self
            .layer
            .as_ref()
            .ok_or_else(|| "overlay layer is unavailable".to_string())?;
        let pixmap = self
            .pixmap
            .as_ref()
            .ok_or_else(|| "overlay pixmap is unavailable".to_string())?;
        let data = CFData::from_bytes(pixmap.data());
        let provider = CGDataProvider::with_cf_data(Some(&data))
            .ok_or_else(|| "create overlay data provider".to_string())?;
        let color_space = CGColorSpace::new_device_rgb()
            .ok_or_else(|| "create overlay RGB color space".to_string())?;
        let bitmap_info = CGBitmapInfo(
            CGImageAlphaInfo::PremultipliedLast.0
                | CGImageComponentInfo::Integer.0
                | CGImageByteOrderInfo::Order32Big.0
                | CGImagePixelFormatInfo::Packed.0,
        );
        let image = unsafe {
            CGImage::new(
                pixmap.width() as usize,
                pixmap.height() as usize,
                8,
                32,
                pixmap.width() as usize * 4,
                Some(&color_space),
                bitmap_info,
                Some(&provider),
                std::ptr::null(),
                true,
                CGColorRenderingIntent::RenderingIntentDefault,
            )
        }
        .ok_or_else(|| "create overlay CGImage".to_string())?;
        CATransaction::begin();
        CATransaction::setDisableActions(true);
        unsafe { layer.setContents(Some(image.as_ref())) };
        CATransaction::commit();
        Ok(())
    }

    fn set_alpha(&mut self, alpha: f64) {
        let alpha = alpha.clamp(0.0, 1.0);
        self.alpha = alpha;
        if let Some(window) = &self.window {
            window.setAlphaValue(alpha);
        }
    }

    fn apply_fade_alpha(&mut self, alpha: f64) {
        self.alpha = alpha.clamp(0.0, 1.0);
        if let Some(window) = &self.window {
            window.setAlphaValue(self.alpha);
        }
    }

    fn finish_fade(&mut self) {
        self.fade_active = false;
        if self.boundary_guide.is_some() {
            self.points.clear();
            self.rendered_points = 0;
            self.label = None;
            self.active = false;
            self.needs_full_redraw = true;
            self.apply_fade_alpha(1.0);
            self.visible = true;
        } else {
            self.hide();
        }
    }

    fn hide(&mut self) {
        if let Some(window) = &self.window {
            window.orderOut(None);
        }
        self.points.clear();
        self.rendered_points = 0;
        self.fade_active = false;
        self.needs_full_redraw = true;
        self.label = None;
        self.visible = false;
    }
}

#[derive(Default)]
struct ApplyEffect {
    dirty: bool,
    fade: bool,
    display_duration: Option<Duration>,
    fade_duration: Option<Duration>,
    suppress_render: bool,
}

impl ApplyEffect {
    fn dirty() -> Self {
        Self {
            dirty: true,
            fade: false,
            display_duration: None,
            fade_duration: None,
            suppress_render: false,
        }
    }
}

fn create_window(
    origin: Point,
    width: i32,
    height: i32,
    scale: f32,
) -> Result<(Retained<NSWindow>, Retained<CALayer>), String> {
    let marker =
        MainThreadMarker::new().ok_or_else(|| "not on the AppKit main thread".to_string())?;
    let main_bounds = CGDisplayBounds(CGMainDisplayID());
    let frame = CGRect::new(
        CGPoint::new(
            origin.x as f64,
            main_bounds.size.height - origin.y as f64 - height as f64,
        ),
        CGSize::new(width as f64, height as f64),
    );
    let window = unsafe {
        NSWindow::initWithContentRect_styleMask_backing_defer(
            NSWindow::alloc(marker),
            frame,
            NSWindowStyleMask::Borderless,
            NSBackingStoreType::Buffered,
            false,
        )
    };
    unsafe { window.setReleasedWhenClosed(false) };
    window.setOpaque(false);
    window.setBackgroundColor(Some(&NSColor::clearColor()));
    window.setHasShadow(false);
    window.setIgnoresMouseEvents(true);
    window.setLevel(NSStatusWindowLevel);
    window.setCollectionBehavior(
        NSWindowCollectionBehavior::CanJoinAllSpaces
            | NSWindowCollectionBehavior::Stationary
            | NSWindowCollectionBehavior::IgnoresCycle
            | NSWindowCollectionBehavior::FullScreenAuxiliary,
    );
    let view = window
        .contentView()
        .ok_or_else(|| "overlay window has no content view".to_string())?;
    view.setWantsLayer(true);
    let layer = view
        .layer()
        .ok_or_else(|| "create layer-backed overlay view".to_string())?;
    layer.setFrame(CGRect::new(
        CGPoint::new(0.0, 0.0),
        CGSize::new(width as f64, height as f64),
    ));
    layer.setContentsScale(scale as f64);
    layer.setGeometryFlipped(true);
    Ok((window, layer))
}

fn skia_color(argb: u32) -> tiny_skia::Color {
    tiny_skia::Color::from_rgba8(
        ((argb >> 16) & 0xff) as u8,
        ((argb >> 8) & 0xff) as u8,
        (argb & 0xff) as u8,
        ((argb >> 24) & 0xff) as u8,
    )
}

fn pixel_rect_for_points(
    points: &[Point],
    screen_origin: Point,
    scale: f32,
    padding: i32,
) -> Option<PixelRect> {
    let local = |point: Point| {
        (
            ((point.x - screen_origin.x) as f32 * scale).round() as i32,
            ((point.y - screen_origin.y) as f32 * scale).round() as i32,
        )
    };
    let (mut left, mut top) = local(*points.first()?);
    let mut right = left;
    let mut bottom = top;
    for point in &points[1..] {
        let (x, y) = local(*point);
        left = left.min(x);
        right = right.max(x);
        top = top.min(y);
        bottom = bottom.max(y);
    }
    Some(PixelRect {
        left: left - padding,
        top: top - padding,
        right: right + padding + 1,
        bottom: bottom + padding + 1,
    })
}

fn draw_boundary_guide(
    pixmap: &mut PixmapMut<'_>,
    frame: &BoundaryGuideFrame,
    screen_origin: Point,
    surface_scale: f32,
) {
    let Some(rect) = boundary_guide_rect(
        *frame,
        screen_origin,
        surface_scale,
        pixmap.width() as i32,
        pixmap.height() as i32,
    ) else {
        return;
    };
    let frame_scale = frame.dpi_scale_milli as f32 / 1000.0;
    let scale = if frame_scale.is_finite() && frame_scale > 0.0 {
        frame_scale
    } else if surface_scale.is_finite() {
        surface_scale.max(1.0)
    } else {
        1.0
    };
    let fill = guide_paint([112, 118, 126], compose_guide_alpha(128, frame.alpha));
    let border = guide_paint([255, 255, 255], frame.alpha);
    let stroke_width = scale.max(1.0);
    let path = match frame.region {
        CornerEdgeHit::Corner(corner) => {
            let width = (rect.right - rect.left) as f32;
            let height = (rect.bottom - rect.top) as f32;
            let logical_width = frame.area.right.saturating_sub(frame.area.left) as f32 * scale;
            let logical_height = frame.area.bottom.saturating_sub(frame.area.top) as f32 * scale;
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
            let radius = (4.0 * scale).min(width / 2.0).min(height / 2.0);
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
    let mut paint = Paint::default();
    paint.set_color(tiny_skia::Color::from_rgba8(rgb[0], rgb[1], rgb[2], alpha));
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
    let local = |point: Point| {
        (
            (point.x - style.screen_origin.x) as f32 * style.scale - raster_offset.0,
            (point.y - style.screen_origin.y) as f32 * style.scale - raster_offset.1,
        )
    };
    let mut builder = PathBuilder::new();
    let (x, y) = local(points[0]);
    builder.move_to(x, y);
    for point in &points[1..] {
        let (x, y) = local(*point);
        builder.line_to(x, y);
    }
    let Some(path) = builder.finish() else {
        return;
    };
    let stroke = |width| Stroke {
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
        &stroke(4.0 * style.scale),
        Transform::identity(),
        None,
    );
    let mut main = Paint::default();
    main.set_color(skia_color(if style.recognized {
        style.colors.main
    } else {
        style.colors.unrecognized
    }));
    main.anti_alias = true;
    pixmap.stroke_path(
        &path,
        &main,
        &stroke(2.0 * style.scale),
        Transform::identity(),
        None,
    );
}

fn redraw_trail_region(
    pixmap: &mut Pixmap,
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

fn load_label_font() -> Option<ab_glyph::FontVec> {
    for path in [
        "/System/Library/Fonts/SFNS.ttf",
        "/System/Library/Fonts/PingFang.ttc",
        "/System/Library/Fonts/Helvetica.ttc",
    ] {
        if let Ok(bytes) = std::fs::read(path) {
            if let Ok(font) = ab_glyph::FontVec::try_from_vec_and_index(bytes, 0) {
                return Some(font);
            }
        }
    }
    log::warn!("macOS overlay label font is unavailable");
    None
}

fn measure_label_rect(state: &OverlayState, text: &str) -> Option<PixelRect> {
    use ab_glyph::{Font, ScaleFont};
    let font = state.font.as_ref()?;
    let px = 32.0 * state.scale;
    let scaled = font.as_scaled(ab_glyph::PxScale::from(px));
    let text_width = text
        .chars()
        .map(|character| scaled.h_advance(scaled.glyph_id(character)))
        .sum::<f32>();
    let text_height = scaled.ascent() - scaled.descent();
    let padding_x = 24.0 * state.scale;
    let padding_y = 10.0 * state.scale;
    let width = (state.label_bounds.right - state.label_bounds.left) as f32;
    let height = (state.label_bounds.bottom - state.label_bounds.top) as f32;
    let box_width = text_width + padding_x * 2.0;
    let box_height = text_height + padding_y * 2.0;
    let box_x = state.label_bounds.left as f32 + (width - box_width) / 2.0;
    let box_y = state.label_bounds.top as f32 + height / 2.0 + width / 8.0 - box_height / 2.0;
    Some(PixelRect {
        left: box_x.floor() as i32 - 1,
        top: box_y.floor() as i32 - 1,
        right: (box_x + box_width).ceil() as i32 + 1,
        bottom: (box_y + box_height).ceil() as i32 + 1,
    })
}

fn draw_label(
    pixmap: &mut Pixmap,
    font: &ab_glyph::FontVec,
    scale: f32,
    label_bounds: PixelRect,
    text: &str,
) {
    use ab_glyph::{Font, ScaleFont};
    let px = 32.0 * scale;
    let scaled = font.as_scaled(ab_glyph::PxScale::from(px));
    let mut glyphs = Vec::new();
    let mut cursor = 0.0_f32;
    for character in text.chars() {
        let id = scaled.glyph_id(character);
        glyphs.push(id.with_scale_and_position(px, ab_glyph::point(cursor, 0.0)));
        cursor += scaled.h_advance(id);
    }
    let ascent = scaled.ascent();
    let text_height = ascent - scaled.descent();
    let padding_x = 24.0 * scale;
    let padding_y = 10.0 * scale;
    let box_width = cursor + padding_x * 2.0;
    let box_height = text_height + padding_y * 2.0;
    let display_width = (label_bounds.right - label_bounds.left) as f32;
    let display_height = (label_bounds.bottom - label_bounds.top) as f32;
    let box_x = label_bounds.left as f32 + (display_width - box_width) / 2.0;
    let box_y =
        label_bounds.top as f32 + display_height / 2.0 + display_width / 8.0 - box_height / 2.0;
    if let Some(rect) = tiny_skia::Rect::from_xywh(box_x, box_y, box_width, box_height) {
        let mut background = Paint::default();
        background.set_color(tiny_skia::Color::from_rgba8(0, 0, 0, 140));
        pixmap.fill_rect(rect, &background, Transform::identity(), None);
    }

    let width = pixmap.width() as i32;
    let height = pixmap.height() as i32;
    let origin_x = box_x + padding_x;
    let origin_y = box_y + padding_y + ascent;
    let data = pixmap.data_mut();
    for mut glyph in glyphs {
        glyph.position = ab_glyph::point(glyph.position.x + origin_x, origin_y);
        if let Some(outlined) = font.outline_glyph(glyph) {
            let bounds = outlined.px_bounds();
            outlined.draw(|glyph_x, glyph_y, coverage| {
                let x = bounds.min.x as i32 + glyph_x as i32;
                let y = bounds.min.y as i32 + glyph_y as i32;
                if x < 0 || y < 0 || x >= width || y >= height {
                    return;
                }
                let alpha = (coverage * 255.0) as u16;
                let inverse = 255 - alpha;
                let offset = ((y * width + x) * 4) as usize;
                for channel in 0..4 {
                    let destination = data[offset + channel] as u16;
                    data[offset + channel] = (alpha + destination * inverse / 255).min(255) as u8;
                }
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::corners::{BoundaryGuideFrame, CornerEdgeHit, ScreenCorner, ScreenRect};

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
            dpi_scale_milli: 2000,
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

    fn guide_test_state() -> OverlayState {
        OverlayState {
            screen_origin: Point { x: 0, y: 0 },
            width_points: 256,
            height_points: 256,
            scale: 2.0,
            pixmap: Pixmap::new(512, 512),
            ..OverlayState::default()
        }
    }

    fn pixel_at(pixmap: &Pixmap, x: usize, y: usize) -> [u8; 4] {
        let offset = (y * pixmap.width() as usize + x) * 4;
        pixmap.data()[offset..offset + 4].try_into().unwrap()
    }

    #[test]
    fn boundary_guide_lifecycle_keeps_empty_overlay_visible_until_clear() {
        let mut state = guide_test_state();
        let frame = boundary_guide_frame(
            ScreenRect {
                left: 0,
                top: 0,
                right: 31,
                bottom: 31,
            },
            CornerEdgeHit::Corner(ScreenCorner::LeftTop),
        );

        let mut selected_origin = None;
        let set = state.apply_with_surface(OverlayCommand::SetBoundaryGuide(frame), |_, origin| {
            selected_origin = Some(origin);
            Ok(())
        });
        assert!(set.dirty);
        assert_eq!(selected_origin, Some(Point { x: 0, y: 0 }));
        assert_eq!(state.boundary_guide, Some(frame));
        assert!(state.visible);

        let clear =
            state.apply_with_surface(OverlayCommand::ClearBoundaryGuide, |_state, _origin| Ok(()));
        assert!(clear.dirty);
        assert!(state.boundary_guide.is_none());
        assert!(!state.visible);
    }

    #[test]
    fn boundary_guide_dirty_bounds_cover_previous_and_next_areas() {
        let mut state = guide_test_state();
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

        state.apply_with_surface(
            OverlayCommand::SetBoundaryGuide(first),
            |_state, _origin| Ok(()),
        );
        state.boundary_guide_dirty = None;
        state.apply_with_surface(OverlayCommand::SetBoundaryGuide(next), |_state, _origin| {
            Ok(())
        });

        assert_eq!(state.boundary_guide, Some(next));
        assert_eq!(
            state.boundary_guide_dirty,
            Some(PixelRect {
                left: 0,
                top: 0,
                right: 224,
                bottom: 224,
            })
        );
    }

    #[test]
    fn boundary_guide_raster_has_nontransparent_pixels_in_expected_retina_area() {
        let frame = boundary_guide_frame(
            ScreenRect {
                left: 0,
                top: 0,
                right: 31,
                bottom: 31,
            },
            CornerEdgeHit::Corner(ScreenCorner::LeftTop),
        );
        let mut pixmap = Pixmap::new(128, 128).unwrap();
        draw_boundary_guide(&mut pixmap.as_mut(), &frame, Point { x: 0, y: 0 }, 2.0);

        let inside = ((16 * 128 + 16) * 4) as usize;
        let outside = ((96 * 128 + 96) * 4) as usize;
        assert!(pixmap.data()[inside + 3] > 0);
        assert_eq!(pixmap.data()[outside + 3], 0);
    }

    #[test]
    fn boundary_guide_fill_is_gray_and_translucent() {
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
        draw_boundary_guide(&mut pixmap.as_mut(), &frame, Point { x: 0, y: 0 }, 1.0);

        let pixel = pixel_at(&pixmap, 8, 8);
        assert_eq!(pixel, [28, 30, 32, 64]);
        assert!(pixel[3] > 0);
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
            draw_boundary_guide(&mut pixmap.as_mut(), &frame, Point { x: 0, y: 0 }, 1.0);

            let interior = pixel_at(&pixmap, interior.0, interior.1);
            let outside_disk = pixel_at(&pixmap, outside_disk.0, outside_disk.1);
            let border = pixel_at(&pixmap, border.0, border.1);

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
    fn boundary_guide_rect_converts_closed_screen_area_from_offset_retina_origin() {
        let frame = boundary_guide_frame(
            ScreenRect {
                left: -48,
                top: 24,
                right: -17,
                bottom: 55,
            },
            CornerEdgeHit::Edge(ScreenEdge::Left),
        );

        assert_eq!(
            boundary_guide_rect(frame, Point { x: -64, y: 16 }, 2.0, 256, 256),
            Some(PixelRect {
                left: 32,
                top: 16,
                right: 96,
                bottom: 80,
            })
        );
    }

    #[test]
    fn setting_boundary_guide_only_updates_guide_state() {
        let mut state = guide_test_state();
        state.points = vec![Point { x: 8, y: 8 }, Point { x: 24, y: 24 }];
        state.show_path = true;
        state.fade_active = true;
        state.set_alpha(0.4);
        let frame = boundary_guide_frame(
            ScreenRect {
                left: 0,
                top: 0,
                right: 31,
                bottom: 31,
            },
            CornerEdgeHit::Edge(ScreenEdge::Top),
        );

        state.apply_with_surface(
            OverlayCommand::SetBoundaryGuide(frame),
            |_state, _origin| Ok(()),
        );

        assert_eq!(state.alpha, 0.4);
        assert!(state.fade_active);
        assert_eq!(state.points.len(), 2);
        assert!(state.show_path);
        assert_eq!(state.boundary_guide, Some(frame));
        assert!(state.visible);
    }

    #[test]
    fn setting_boundary_guide_keeps_existing_fade_generation() {
        let frame = boundary_guide_frame(
            ScreenRect {
                left: 0,
                top: 0,
                right: 31,
                bottom: 31,
            },
            CornerEdgeHit::Edge(ScreenEdge::Top),
        );

        assert!(!starts_new_generation(&OverlayCommand::SetBoundaryGuide(
            frame
        )));
        assert!(!starts_new_generation(&OverlayCommand::ClearBoundaryGuide));
    }

    #[test]
    fn clearing_boundary_guide_keeps_existing_trail_visible() {
        let mut state = guide_test_state();
        state.boundary_guide = Some(boundary_guide_frame(
            ScreenRect {
                left: 0,
                top: 0,
                right: 31,
                bottom: 31,
            },
            CornerEdgeHit::Corner(ScreenCorner::LeftTop),
        ));
        state.points = vec![Point { x: 8, y: 8 }, Point { x: 24, y: 24 }];
        state.show_path = true;
        state.visible = true;

        let effect = state.apply_with_surface(OverlayCommand::ClearBoundaryGuide, |_, _| Ok(()));

        assert!(effect.dirty);
        assert!(!effect.suppress_render);
        assert!(state.boundary_guide.is_none());
        assert!(state.visible);
        assert_eq!(state.points.len(), 2);
    }

    #[test]
    fn end_clears_trail_immediately_without_starting_trail_fade() {
        let frame = boundary_guide_frame(
            ScreenRect {
                left: 0,
                top: 0,
                right: 31,
                bottom: 31,
            },
            CornerEdgeHit::Corner(ScreenCorner::LeftTop),
        );
        let mut begun = guide_test_state();
        begun.boundary_guide = Some(frame);
        begun.apply_with_surface(
            OverlayCommand::Begin {
                origin: Point { x: 40, y: 50 },
                colors: TrailColors {
                    main: 0xff27e518,
                    unrecognized: 0xffff2424,
                },
                show_path: true,
                show_label: true,
                fade_out: true,
            },
            |_, _| Ok(()),
        );
        assert!(begun.boundary_guide.is_none());
        assert!(begun.active);

        let mut cancelled = guide_test_state();
        cancelled.boundary_guide = Some(frame);
        cancelled.visible = true;
        let cancel = cancelled.apply_with_surface(OverlayCommand::Cancel, |_, _| Ok(()));
        assert!(cancel.suppress_render);
        assert!(cancelled.boundary_guide.is_none());
        assert!(!cancelled.visible);

        let mut ended = guide_test_state();
        ended.boundary_guide = Some(frame);
        ended.points = vec![Point { x: 8, y: 8 }, Point { x: 24, y: 24 }];
        ended.show_path = true;
        ended.show_label = true;
        ended.label = Some("match".into());
        ended.fade_out = true;
        ended.active = true;
        ended.visible = true;
        ended.fade_active = true;
        let end = ended.apply_with_surface(OverlayCommand::End, |_, _| Ok(()));
        assert!(!end.fade);
        assert!(ended.boundary_guide.is_none());
        assert!(ended.points.is_empty());
        assert!(!ended.show_path);
        assert!(!ended.fade_active);
        assert!(ended.label.is_some());
    }

    #[test]
    fn cancel_clears_trail_immediately_without_starting_trail_fade() {
        let mut state = guide_test_state();
        state.points = vec![Point { x: 8, y: 8 }, Point { x: 24, y: 24 }];
        state.show_path = true;
        state.visible = true;
        state.fade_out = true;
        state.fade_active = true;

        let effect = state.apply_with_surface(OverlayCommand::Cancel, |_state, _origin| Ok(()));

        assert!(!effect.fade);
        assert!(state.points.is_empty());
        assert!(!state.show_path);
        assert!(!state.fade_active);
        assert!(!state.visible);
    }

    #[test]
    fn label_feedback_clears_boundary_guide_before_rendering() {
        let mut state = guide_test_state();
        state.boundary_guide = Some(boundary_guide_frame(
            ScreenRect {
                left: 0,
                top: 0,
                right: 31,
                bottom: 31,
            },
            CornerEdgeHit::Corner(ScreenCorner::LeftTop),
        ));
        state.visible = true;

        let effect = state.apply_with_surface(
            OverlayCommand::ShowLabelFeedback {
                origin: Point { x: 40, y: 50 },
                text: "Ready".into(),
                fade_out: true,
                display_duration: None,
                fade_duration: None,
            },
            |state, _| {
                state.visible = true;
                Ok(())
            },
        );

        assert!(effect.dirty);
        assert!(effect.fade);
        assert!(state.boundary_guide.is_none());
        assert_eq!(state.label.as_deref(), Some("Ready"));
        assert!(state.visible);
    }

    #[test]
    fn custom_fade_plan_uses_requested_duration() {
        assert_eq!(
            fade_plan(Some(Duration::from_millis(800))),
            (50, Duration::from_millis(16))
        );
        assert_eq!(
            fade_plan(None),
            (DEFAULT_FADE_FRAMES, Duration::from_millis(16))
        );
    }

    #[test]
    fn independent_label_feedback_does_not_require_active_trail() {
        let mut state = OverlayState {
            points: vec![Point { x: 10, y: 10 }, Point { x: 20, y: 20 }],
            label: Some("old label".into()),
            show_path: true,
            show_label: true,
            active: false,
            ..OverlayState::default()
        };

        let command = OverlayCommand::ShowLabelFeedback {
            origin: Point { x: 100, y: 200 },
            text: "42%".into(),
            fade_out: true,
            display_duration: Some(Duration::from_millis(500)),
            fade_duration: Some(Duration::from_millis(800)),
        };
        let mut selected_origin = None;
        let effect = state.apply_with_surface(command, |_state, origin| {
            selected_origin = Some(origin);
            Ok(())
        });

        assert!(effect.dirty);
        assert!(effect.fade);
        assert_eq!(selected_origin, Some(Point { x: 100, y: 200 }));
        assert_eq!(state.label.as_deref(), Some("42%"));
        assert!(state.points.is_empty());
        assert!(!state.show_path);
        assert!(state.show_label);
        assert!(state.recognized);
        assert!(state.fade_out);
        assert_eq!(effect.display_duration, Some(Duration::from_millis(500)));
        assert_eq!(effect.fade_duration, Some(Duration::from_millis(800)));
    }

    #[test]
    fn modifier_feedback_followed_by_path_end_does_not_start_second_fade() {
        let mut state = OverlayState {
            active: true,
            fade_out: true,
            ..OverlayState::default()
        };

        // The runtime's ModifierFired branch sends ShowLabelFeedback, then the
        // ordinary PathEnded branch may still send End for the same capture.
        let feedback = state.apply_with_surface(
            OverlayCommand::ShowLabelFeedback {
                origin: Point { x: 100, y: 200 },
                text: "42%".into(),
                fade_out: true,
                display_duration: Some(Duration::from_millis(500)),
                fade_duration: Some(Duration::from_millis(800)),
            },
            |_state, _origin| Ok(()),
        );
        let end = state.apply_with_surface(OverlayCommand::End, |_state, _origin| Ok(()));

        assert!(feedback.fade);
        assert_eq!(feedback.display_duration, Some(Duration::from_millis(500)));
        assert_eq!(feedback.fade_duration, Some(Duration::from_millis(800)));
        assert!(!end.fade);
        assert_eq!(state.mode, OverlayMode::LabelFeedback);
    }

    #[test]
    fn independent_label_feedback_without_fade_hides_immediately() {
        let mut state = OverlayState {
            points: vec![Point { x: 10, y: 10 }, Point { x: 20, y: 20 }],
            label: Some("old label".into()),
            show_path: true,
            show_label: true,
            active: false,
            ..OverlayState::default()
        };

        let effect = state.apply_with_surface(
            OverlayCommand::ShowLabelFeedback {
                origin: Point { x: 100, y: 200 },
                text: "0%".into(),
                fade_out: false,
                display_duration: None,
                fade_duration: None,
            },
            |_state, _origin| Ok(()),
        );

        assert!(effect.suppress_render);
        assert!(!effect.fade);
        assert!(state.label.is_none());
        assert!(state.points.is_empty());
        assert!(!state.active);
    }

    #[test]
    fn active_display_union_keeps_negative_and_offset_screen_origins() {
        let union = union_display_bounds(&[
            CGRect::new(CGPoint::new(0.0, 0.0), CGSize::new(2560.0, 1080.0)),
            CGRect::new(CGPoint::new(0.0, 1080.0), CGSize::new(2560.0, 1440.0)),
            CGRect::new(CGPoint::new(-1920.0, 240.0), CGSize::new(1920.0, 1080.0)),
        ])
        .unwrap();

        assert_eq!(union.origin.x, -1920.0);
        assert_eq!(union.origin.y, 0.0);
        assert_eq!(union.size.width, 4480.0);
        assert_eq!(union.size.height, 2520.0);
    }

    fn queued(value: i32) -> QueuedCommand {
        QueuedCommand {
            command: OverlayCommand::Grow(Point { x: value, y: value }),
            generation: 0,
        }
    }

    #[test]
    fn pending_batch_is_bounded_and_fifo() {
        let pending = Mutex::new(VecDeque::from([queued(1), queued(2), queued(3)]));
        let (batch, has_more) = take_pending_batch(&pending, 2);
        assert_eq!(batch.len(), 2);
        assert!(matches!(
            batch[0].command,
            OverlayCommand::Grow(Point { x: 1, .. })
        ));
        assert!(matches!(
            batch[1].command,
            OverlayCommand::Grow(Point { x: 2, .. })
        ));
        assert!(has_more);

        let (rest, has_more) = take_pending_batch(&pending, 2);
        assert_eq!(rest.len(), 1);
        assert!(!has_more);
    }

    #[test]
    fn mouse_rate_backlog_is_consumed_in_one_latest_frame() {
        let pending = Mutex::new((0..1000).map(queued).collect::<VecDeque<_>>());
        let (batch, has_more) = take_pending_batch(&pending, MAX_COMMANDS_PER_DRAIN);

        assert_eq!(batch.len(), 1000);
        assert!(!has_more);
        assert!(matches!(
            batch.last().map(|queued| &queued.command),
            Some(OverlayCommand::Grow(Point { x: 999, y: 999 }))
        ));
    }

    #[test]
    fn incremental_trail_bounds_include_stroke_padding() {
        let bounds = pixel_rect_for_points(
            &[Point { x: 10, y: 20 }, Point { x: 30, y: 40 }],
            Point { x: 5, y: 10 },
            2.0,
            6,
        )
        .unwrap();

        assert_eq!(bounds.left, 4);
        assert_eq!(bounds.top, 14);
        assert_eq!(bounds.right, 57);
        assert_eq!(bounds.bottom, 67);
    }

    #[test]
    fn visual_point_limit_scales_with_dpi_and_stops_only_visual_growth() {
        assert_eq!(max_trail_points(1.0), 512);
        assert_eq!(max_trail_points(1.25), 640);
        assert_eq!(max_trail_points(2.0), 1024);
        assert_eq!(visual_point_limit(4480, 1440, 1.0), 1975);

        let mut state = OverlayState {
            active: true,
            show_path: false,
            show_label: false,
            points: vec![Point { x: 0, y: 0 }],
            ..OverlayState::default()
        };
        for value in 1..700 {
            state.apply(OverlayCommand::Grow(Point { x: value * 3, y: 0 }));
        }
        assert_eq!(state.points.len(), 512);

        state.apply(OverlayCommand::Recognized(Some("match".into())));
        let end = state.apply(OverlayCommand::End);
        assert!(state.recognized);
        assert_eq!(state.label.as_deref(), Some("match"));
        assert!(!state.active);
        assert!(!end.fade);
        assert!(state.points.is_empty());
        assert!(!state.show_path);
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
            screen_origin: Point { x: 0, y: 0 },
            scale: 1.0,
            recognized: true,
            colors,
        };
        let mut expected = Pixmap::new(128, 128).unwrap();
        draw_trail(&mut expected.as_mut(), &points, style, (0.0, 0.0));

        let mut actual = Pixmap::new(128, 128).unwrap();
        let mut scratch = Vec::new();
        draw_trail(&mut actual.as_mut(), &points[..2], style, (0.0, 0.0));
        for end in 3..=points.len() {
            let dirty = pixel_rect_for_points(&points[end - 2..end], Point { x: 0, y: 0 }, 1.0, 4)
                .and_then(|rect| rect.clamp(128, 128))
                .unwrap();
            assert!(redraw_trail_region(
                &mut actual,
                &mut scratch,
                dirty,
                &points[..end],
                style,
            ));
        }

        assert_eq!(actual.data(), expected.data());
        assert!(!scratch.is_empty());
    }
}
