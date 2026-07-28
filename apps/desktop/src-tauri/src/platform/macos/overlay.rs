// Main-thread AppKit overlay backed by a CALayer and tiny-skia frames.

use crate::engine::types::Point;
use objc2::rc::Retained;
use objc2::{MainThreadMarker, MainThreadOnly};
use objc2_app_kit::{
    NSBackingStoreType, NSColor, NSStatusWindowLevel, NSWindow, NSWindowCollectionBehavior,
    NSWindowStyleMask,
};
use objc2_core_foundation::{CFData, CGPoint, CGRect, CGSize};
use objc2_core_graphics::{
    CGBitmapInfo, CGColorRenderingIntent, CGColorSpace, CGDataProvider, CGDisplayBounds, CGImage,
    CGImageAlphaInfo, CGImageByteOrderInfo, CGImageComponentInfo, CGImagePixelFormatInfo,
    CGMainDisplayID,
};
use objc2_quartz_core::{CALayer, CATransaction};
use std::cell::RefCell;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tiny_skia::{LineCap, LineJoin, Paint, PathBuilder, Pixmap, Stroke, Transform};

#[derive(Debug, Clone, Copy)]
pub struct TrailColors {
    pub main: u32,
    pub unrecognized: u32,
}

#[derive(Debug, Clone)]
pub enum OverlayCmd {
    Begin {
        origin: Point,
        colors: TrailColors,
        show_path: bool,
        show_label: bool,
        fade_out: bool,
    },
    Grow(Point),
    Recognized(Option<String>),
    End,
    Cancel,
}

#[derive(Clone)]
pub struct Overlay {
    app: tauri::AppHandle,
    generation: Arc<AtomicU64>,
}

thread_local! {
    static STATE: RefCell<Option<OverlayState>> = const { RefCell::new(None) };
}

impl Overlay {
    pub fn spawn(app: &tauri::AppHandle) -> Self {
        Self {
            app: app.clone(),
            generation: Arc::new(AtomicU64::new(0)),
        }
    }

    pub fn send(&self, command: OverlayCmd) {
        let generation = match command {
            OverlayCmd::Begin { .. } | OverlayCmd::Cancel => {
                self.generation.fetch_add(1, Ordering::AcqRel) + 1
            }
            _ => self.generation.load(Ordering::Acquire),
        };
        let app = self.app.clone();
        let fade_generation = Arc::clone(&self.generation);
        if let Err(error) = self.app.run_on_main_thread(move || {
            let should_fade = STATE.with(|slot| {
                let mut slot = slot.borrow_mut();
                let state = slot.get_or_insert_with(OverlayState::default);
                state.apply(command)
            });
            if should_fade {
                spawn_fade(app, fade_generation, generation);
            }
        }) {
            log::error!("schedule macOS overlay command failed: {error}");
        }
    }
}

fn spawn_fade(app: tauri::AppHandle, generation: Arc<AtomicU64>, expected: u64) {
    std::thread::spawn(move || {
        for step in (0..=10).rev() {
            if generation.load(Ordering::Acquire) != expected {
                return;
            }
            let alpha = step as f64 / 10.0;
            let finish = step == 0;
            let scheduled_generation = Arc::clone(&generation);
            if app
                .run_on_main_thread(move || {
                    if scheduled_generation.load(Ordering::Acquire) != expected {
                        return;
                    }
                    STATE.with(|slot| {
                        if let Some(state) = slot.borrow_mut().as_mut() {
                            state.set_alpha(alpha);
                            if finish {
                                state.hide();
                            }
                        }
                    });
                })
                .is_err()
            {
                return;
            }
            std::thread::sleep(std::time::Duration::from_millis(16));
        }
    });
}

struct OverlayState {
    window: Option<Retained<NSWindow>>,
    layer: Option<Retained<CALayer>>,
    screen_origin: Point,
    width_points: i32,
    height_points: i32,
    scale: f32,
    points: Vec<Point>,
    colors: TrailColors,
    recognized: bool,
    label: Option<String>,
    show_path: bool,
    show_label: bool,
    fade_out: bool,
    font: Option<ab_glyph::FontVec>,
}

impl Default for OverlayState {
    fn default() -> Self {
        Self {
            window: None,
            layer: None,
            screen_origin: Point::default(),
            width_points: 0,
            height_points: 0,
            scale: 1.0,
            points: Vec::new(),
            colors: TrailColors {
                main: 0xff27e518,
                unrecognized: 0xffff2424,
            },
            recognized: false,
            label: None,
            show_path: true,
            show_label: true,
            fade_out: true,
            font: load_label_font(),
        }
    }
}

impl OverlayState {
    fn apply(&mut self, command: OverlayCmd) -> bool {
        match command {
            OverlayCmd::Begin {
                origin,
                colors,
                show_path,
                show_label,
                fade_out,
            } => {
                if let Err(error) = self.ensure_surface(origin) {
                    log::error!("create macOS overlay surface failed: {error}");
                    return false;
                }
                self.points.clear();
                self.points.push(origin);
                self.colors = colors;
                self.recognized = false;
                self.label = None;
                self.show_path = show_path;
                self.show_label = show_label;
                self.fade_out = fade_out;
                self.set_alpha(1.0);
                self.render();
                false
            }
            OverlayCmd::Grow(point) => {
                self.points.push(point);
                self.render();
                false
            }
            OverlayCmd::Recognized(label) => {
                self.recognized = label.is_some();
                self.label = label;
                self.render();
                false
            }
            OverlayCmd::End => {
                if self.fade_out {
                    true
                } else {
                    self.hide();
                    false
                }
            }
            OverlayCmd::Cancel => {
                self.hide();
                false
            }
        }
    }

    fn ensure_surface(&mut self, origin: Point) -> Result<(), String> {
        let screen = super::window::screen_at(origin)
            .ok_or_else(|| "gesture display is unavailable".to_string())?;
        let width_points = screen.bounds.width();
        let height_points = screen.bounds.height();
        let screen_origin = Point {
            x: screen.bounds.left,
            y: screen.bounds.top,
        };
        let scale = screen.dpi_scale.max(1.0) as f32;
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
        }
        if let Some(window) = &self.window {
            window.orderFrontRegardless();
        }
        Ok(())
    }

    fn render(&mut self) {
        let width = (self.width_points as f32 * self.scale).round().max(1.0) as u32;
        let height = (self.height_points as f32 * self.scale).round().max(1.0) as u32;
        let Some(mut pixmap) = Pixmap::new(width, height) else {
            return;
        };

        if self.show_path && self.points.len() >= 2 {
            let mut builder = PathBuilder::new();
            let local = |point: Point| {
                (
                    (point.x - self.screen_origin.x) as f32 * self.scale,
                    (point.y - self.screen_origin.y) as f32 * self.scale,
                )
            };
            let (x, y) = local(self.points[0]);
            builder.move_to(x, y);
            for point in &self.points[1..] {
                let (x, y) = local(*point);
                builder.line_to(x, y);
            }
            if let Some(path) = builder.finish() {
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
                    &stroke(4.0 * self.scale),
                    Transform::identity(),
                    None,
                );
                let mut main = Paint::default();
                main.set_color(skia_color(if self.recognized {
                    self.colors.main
                } else {
                    self.colors.unrecognized
                }));
                main.anti_alias = true;
                pixmap.stroke_path(
                    &path,
                    &main,
                    &stroke(2.0 * self.scale),
                    Transform::identity(),
                    None,
                );
            }
        }

        if self.show_label {
            if let Some(label) = self.label.clone() {
                draw_label(self, &mut pixmap, &label);
            }
        }
        if let Err(error) = self.present(pixmap) {
            log::error!("present macOS overlay frame failed: {error}");
            self.hide();
        }
    }

    fn present(&self, pixmap: Pixmap) -> Result<(), String> {
        let layer = self
            .layer
            .as_ref()
            .ok_or_else(|| "overlay layer is unavailable".to_string())?;
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

    fn set_alpha(&self, alpha: f64) {
        if let Some(window) = &self.window {
            window.setAlphaValue(alpha.clamp(0.0, 1.0));
        }
    }

    fn hide(&mut self) {
        if let Some(window) = &self.window {
            window.orderOut(None);
        }
        self.points.clear();
        self.label = None;
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

fn draw_label(state: &OverlayState, pixmap: &mut Pixmap, text: &str) {
    use ab_glyph::{Font, ScaleFont};
    let Some(font) = &state.font else {
        return;
    };
    let px = 32.0 * state.scale;
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
    let padding_x = 24.0 * state.scale;
    let padding_y = 10.0 * state.scale;
    let box_width = cursor + padding_x * 2.0;
    let box_height = text_height + padding_y * 2.0;
    let box_x = (pixmap.width() as f32 - box_width) / 2.0;
    let box_y = pixmap.height() as f32 / 2.0 + pixmap.width() as f32 / 8.0 - box_height / 2.0;
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
