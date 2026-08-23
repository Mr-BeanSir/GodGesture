//! 触发角(hot corner)/ 摩擦边(rub edge)检测 —— 平台无关状态机。
//!
//! 语义与常量对齐 WGestures 1.8.5(参考克隆 `WGestures/`,不属于本仓库):
//! - 角:`WGestures.Core/Impl/Windows/Win32MousePathTracker2.cs` 的 `HotCornerHitTest()`;
//! - 边:`WGestures.Core/Impl/Windows/ScreenEdgeInteractDetector.cs` 的 `DetectRub()`。
//!
//! 检测只观察光标移动,**永不吞事件**(与参考一致:鼠标移动消息从不拦截)。
//!
//! 与参考实现的**有意出入**(勿"改回去"):
//!
//! 1. 屏幕矩形用**闭区间**(`right`/`bottom` = 最后一个可达像素)。参考直接拿 C#
//!    `Rectangle` 的开区间边界当角点,角点其实落在屏幕外 1px。当前立即动作只在
//!    闭区间的精确角点触发,角序列另有独立近角区域,不会因为贴近角点就抢占立即动作。
//!    - 边:参考左/上带宽 17px、右/下带宽 16px;本实现一律 17px。
//!    - `dist_to_edge` 的右侧复位距离比参考短 1px(无实际影响)。
//!
//! 2. `dist_to_edge` 的**下边缘**没有照抄参考。参考 `GetDistToEdge`
//!    (`ScreenEdgeInteractDetector.cs:345`)用**绝对**的 `_screenBounds.Bottom` 去减
//!    **显示器局部**的 y(局部化发生在同文件 :88),而同函数的右侧用的是局部的 `Width`
//!    —— 是个复制粘贴失误,不是约定。后果在主屏之外双向翻车:副屏在主屏下方时下边缘
//!    一触发就立刻复位(可连发),副屏在主屏上方时下边缘永远无法按距离复位、只能靠
//!    1500ms 静止兜底。本实现用局部高度,不复现该 bug —— 这是多显示器下与 WGestures
//!    行为可见不同的唯一一处。
//!
//! 3. 抑制条件统一成"暂停 / 录制 / 任意鼠标键按下 / 手势捕获中"。参考里检测侧只看 L/R、
//!    分发侧只看 L/M/R、两侧都不看 X1/X2,且录制手势时完全不抑制 —— 那是历史遗留的
//!    不一致,不是设计。录制期间放行会让录制器里的一次误触真的执行命令。
//!    **但按键抑制的位置与参考一致地放在"执行命令之前"而非"喂状态机之前"**
//!    (见 `runtime.rs::detect_corner_edge`):命中要照常消耗掉武装,否则按住左键把窗口
//!    拖到角落(Aero Snap)会把武装完整留到松手,松手一动就误触发。
//!
//! 4. 边带厚度按 DPI 缩放这点与参考一致(`MIN_MOVE`、复位距离、角的两个距离仍是未缩放
//!    像素,参考如此,没有实测数据支持改动);但**取 DPI 的来源不同**:参考取进程级的
//!    桌面 DC DPI(全屏幕一个值),本实现取光标所在显示器的 `GetDpiForMonitor`。
//!    混合 DPI 多显示器下参考两块屏都用 16px 带,本实现分别是 16px 与 24px。
//!    该正确性依赖进程是 Per-Monitor-V2 感知:若退回系统级 DPI 感知,
//!    `GetMonitorInfoW` 返回的是虚拟化坐标而 `GetDpiForMonitor` 仍返回真实 DPI,
//!    带宽会按缩放比例失真。

use super::types::Point;
use std::time::{Duration, Instant};

// --- 触发角常量(参考:HotCornerHitTest 的 TRIGGER_DIST / REST_DIST)---------
/// 到角点的距离 ≤ 此值即触发(未按 DPI 缩放)。立即动作只允许精确角点。
const CORNER_TRIGGER_DIST: i32 = 0;
/// 触发后光标须离开该角点超过此距离才重新武装
const CORNER_REARM_DIST: i32 = 40;
/// 角序列的独立判定区域。边缘带在同一距离内排除,为角序列留出空间。
const CORNER_SEQUENCE_DIST: i32 = EDGE_CORNER_EXCLUDE;
/// 角显示引导的独立半径,不改变角序列或真实命中区域。
const CORNER_GUIDE_RADIUS: i32 = 10;
const CORNER_GUIDE_APPROACH: i32 = 10;

const GUIDE_ALPHA_LEVELS: [u8; 6] = [24, 64, 104, 144, 184, 255];

// --- 摩擦边常量(参考:DetectRub 的同名局部常量)-----------------------------
/// 边带厚度基数,实际厚度 = 此值 × DPI 缩放
const EDGE_THICK_BASE: f64 = 16.0;
/// 距边两端此距离内不算"在边上"(把角点让给触发角,两者互不打架)
const EDGE_CORNER_EXCLUDE: i32 = 100;
/// 一次有效往返所需的最小位移
const EDGE_MIN_MOVE: i32 = 80;
/// 触发后垂直离开边超过此距离即复位
const EDGE_REARM_DIST: i32 = 50;
/// 触发所需的有效位移次数(4 次 = 首次划出 + 3 次折返)
const EDGE_MOVES_REQUIRED: u32 = 4;
/// 相邻两次有效位移的最大间隔,超时则整段作废重来
const EDGE_MOVE_INTERVAL: Duration = Duration::from_millis(600);
/// 触发后静止超过此时长也复位(与"离开边"二选一)
const EDGE_REARM_TIMEOUT: Duration = Duration::from_millis(1500);

/// 显示器信息的缓存时长。光标停在同一显示器内时不重复查询系统,
/// 但仍定期失效,以便分辨率/显示器变化后自愈。
const SCREEN_CACHE_TTL: Duration = Duration::from_secs(2);

/// 屏幕矩形(物理像素,**闭区间**:right/bottom 是最后一个可达像素)
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ScreenRect {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
}

impl ScreenRect {
    pub fn contains(&self, p: Point) -> bool {
        p.x >= self.left && p.x <= self.right && p.y >= self.top && p.y <= self.bottom
    }

    /// 可达像素数(闭区间,故 +1)
    pub fn width(&self) -> i32 {
        self.right - self.left + 1
    }

    pub fn height(&self) -> i32 {
        self.bottom - self.top + 1
    }
}

/// 光标所在显示器的信息(由平台层查询)
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ScreenInfo {
    /// 显示器完整边界(**含任务栏**,与参考一致:用 Bounds 而非 WorkingArea)
    pub bounds: ScreenRect,
    /// DPI 缩放(96 DPI = 1.0)
    pub dpi_scale: f64,
}

/// 屏幕四角。顺序沿用参考的槽位次序(0-3),影响的仅是同一次判定内的遍历先后。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ScreenCorner {
    LeftBottom,
    LeftTop,
    RightTop,
    RightBottom,
}

impl ScreenCorner {
    pub const ALL: [ScreenCorner; 4] = [
        ScreenCorner::LeftBottom,
        ScreenCorner::LeftTop,
        ScreenCorner::RightTop,
        ScreenCorner::RightBottom,
    ];

    /// 配置键,须与 packages/shared 的 `ScreenCorner` zod 枚举字面量一致
    pub fn key(self) -> &'static str {
        match self {
            ScreenCorner::LeftBottom => "leftBottom",
            ScreenCorner::LeftTop => "leftTop",
            ScreenCorner::RightTop => "rightTop",
            ScreenCorner::RightBottom => "rightBottom",
        }
    }

    fn point(self, r: ScreenRect) -> Point {
        match self {
            ScreenCorner::LeftBottom => Point {
                x: r.left,
                y: r.bottom,
            },
            ScreenCorner::LeftTop => Point {
                x: r.left,
                y: r.top,
            },
            ScreenCorner::RightTop => Point {
                x: r.right,
                y: r.top,
            },
            ScreenCorner::RightBottom => Point {
                x: r.right,
                y: r.bottom,
            },
        }
    }
}

/// 屏幕四边
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ScreenEdge {
    Left,
    Top,
    Right,
    Bottom,
}

impl ScreenEdge {
    /// 配置键,须与 packages/shared 的 `ScreenEdge` zod 枚举字面量一致
    pub fn key(self) -> &'static str {
        match self {
            ScreenEdge::Left => "left",
            ScreenEdge::Top => "top",
            ScreenEdge::Right => "right",
            ScreenEdge::Bottom => "bottom",
        }
    }
}

/// 一次命中(角或边)
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CornerEdgeHit {
    Corner(ScreenCorner),
    Edge(ScreenEdge),
}

impl CornerEdgeHit {
    pub fn key(self) -> &'static str {
        match self {
            CornerEdgeHit::Corner(c) => c.key(),
            CornerEdgeHit::Edge(e) => e.key(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BoundaryGuideFrame {
    pub screen: ScreenRect,
    pub area: ScreenRect,
    pub region: CornerEdgeHit,
    pub dpi_scale_milli: u32,
    pub alpha: u8,
}

impl std::fmt::Display for CornerEdgeHit {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CornerEdgeHit::Corner(c) => write!(f, "触发角 {}", c.key()),
            CornerEdgeHit::Edge(e) => write!(f, "摩擦边 {}", e.key()),
        }
    }
}

/// 摩擦边的进行中状态
#[derive(Debug)]
struct RubState {
    edge: ScreenEdge,
    /// 沿边轴向的"峰值"位置:同向继续移动时不断外推,折返时以它为基准量距离
    peak: i32,
    /// 已计数的有效位移次数
    times: u32,
    /// 上一次有效位移的方向(+1/-1;0 = 尚未有过)
    last_dir: i32,
    /// 上一次有效位移的时刻(进入边带时先以进入时刻起算)
    last_move_at: Instant,
}

/// 触发角 / 摩擦边检测器。由 runtime 在钩子线程上按每条移动事件驱动。
#[derive(Debug)]
pub struct CornerEdgeDetector {
    /// 触发角是否处于"已武装"(参考的 `_isHotCornerReset`)。
    /// 初值取 true —— 参考靠 C# 字段默认值 false + 枚举默认值 LeftBottom
    /// 在第一次远离左下角时自动武装,等价但绕。
    corner_armed: bool,
    last_corner: Option<ScreenCorner>,
    rub: Option<RubState>,
    cached_screen: Option<(ScreenInfo, Instant)>,
}

impl Default for CornerEdgeDetector {
    fn default() -> Self {
        Self::new()
    }
}

impl CornerEdgeDetector {
    pub fn new() -> Self {
        Self {
            corner_armed: true,
            last_corner: None,
            rub: None,
            cached_screen: None,
        }
    }

    /// 喂入一条光标移动。`screen_lookup` 仅在显示器缓存未命中时调用。
    pub fn on_move<F>(
        &mut self,
        pos: Point,
        now: Instant,
        screen_lookup: F,
    ) -> Option<CornerEdgeHit>
    where
        F: FnOnce() -> Option<ScreenInfo>,
    {
        let screen = self.screen_for(pos, now, screen_lookup)?;
        // 两个状态机都要推进(角与边的判定区互斥,不会同时命中);
        // 万一同时命中,角优先。
        let corner = self.detect_corner(pos, screen.bounds);
        let edge = self.detect_rub(pos, now, screen);
        corner
            .map(CornerEdgeHit::Corner)
            .or(edge.map(CornerEdgeHit::Edge))
    }

    /// 返回光标当前所在的非角落边缘带。
    pub fn edge_at<F>(&mut self, pos: Point, now: Instant, screen_lookup: F) -> Option<ScreenEdge>
    where
        F: FnOnce() -> Option<ScreenInfo>,
    {
        let screen = self.screen_for(pos, now, screen_lookup)?;
        let local = Point {
            x: pos.x - screen.bounds.left,
            y: pos.y - screen.bounds.top,
        };
        let thick = (EDGE_THICK_BASE * screen.dpi_scale) as i32;
        active_edge(local, screen.bounds.width(), screen.bounds.height(), thick)
    }

    /// 返回可用于边角后续序列的区域。这个查询只读几何位置,不推进立即角或摩擦边状态。
    /// 精确角点保留给空序列立即动作;其余近角区域交给按键/滚轮入口匹配。
    pub fn sequence_at<F>(
        &mut self,
        pos: Point,
        now: Instant,
        screen_lookup: F,
    ) -> Option<CornerEdgeHit>
    where
        F: FnOnce() -> Option<ScreenInfo>,
    {
        let screen = self.screen_for(pos, now, screen_lookup)?;
        let local = Point {
            x: pos.x - screen.bounds.left,
            y: pos.y - screen.bounds.top,
        };
        if let Some(corner) = sequence_corner(local, screen.bounds) {
            return Some(CornerEdgeHit::Corner(corner));
        }
        let thick = (EDGE_THICK_BASE * screen.dpi_scale) as i32;
        active_edge(local, screen.bounds.width(), screen.bounds.height(), thick)
            .map(CornerEdgeHit::Edge)
    }

    /// Returns the active guide geometry without advancing corner or rub state.
    pub fn guide_at<F>(
        &mut self,
        pos: Point,
        now: Instant,
        screen_lookup: F,
        corners_enabled: bool,
        edges_enabled: bool,
    ) -> Option<BoundaryGuideFrame>
    where
        F: FnOnce() -> Option<ScreenInfo>,
    {
        if !corners_enabled && !edges_enabled {
            return None;
        }

        let screen = self.screen_for(pos, now, screen_lookup)?;
        let local = Point {
            x: pos.x - screen.bounds.left,
            y: pos.y - screen.bounds.top,
        };

        if corners_enabled {
            if let Some(corner) = guide_corner_proximity(local, screen.bounds) {
                let distance = corner_guide_distance(local, corner, screen.bounds);
                return Some(BoundaryGuideFrame {
                    screen: screen.bounds,
                    area: corner_guide_area(corner, screen.bounds),
                    region: CornerEdgeHit::Corner(corner),
                    dpi_scale_milli: dpi_scale_milli(screen.dpi_scale),
                    alpha: guide_alpha(
                        distance.saturating_sub(CORNER_GUIDE_RADIUS),
                        CORNER_GUIDE_APPROACH,
                    ),
                });
            }
        }

        if edges_enabled {
            let thick = edge_thickness(screen.dpi_scale);
            if let Some(edge) = guide_edge(local, screen.bounds, thick) {
                let distance =
                    dist_to_edge(edge, local, screen.bounds.width(), screen.bounds.height());
                return Some(BoundaryGuideFrame {
                    screen: screen.bounds,
                    area: edge_guide_area(edge, screen.bounds, thick),
                    region: CornerEdgeHit::Edge(edge),
                    dpi_scale_milli: dpi_scale_milli(screen.dpi_scale),
                    alpha: guide_alpha(distance.saturating_sub(thick), thick),
                });
            }
        }

        None
    }

    pub fn reset_rub(&mut self) {
        self.rub = None;
    }

    fn screen_for<F>(&mut self, pos: Point, now: Instant, lookup: F) -> Option<ScreenInfo>
    where
        F: FnOnce() -> Option<ScreenInfo>,
    {
        if let Some((info, at)) = self.cached_screen {
            if info.bounds.contains(pos) && now.duration_since(at) < SCREEN_CACHE_TTL {
                return Some(info);
            }
        }
        let info = lookup()?;
        self.cached_screen = Some((info, now));
        Some(info)
    }

    /// 触发角:光标到达精确角点时触发,离开 `CORNER_REARM_DIST` 外重新武装。
    ///
    /// 遍历四个角、且不提前退出 —— 与参考一致:同一次移动里可能先在某个角完成重新武装,
    /// 再在后一个角完成触发(例如从左下角直奔右下角)。触发后 `corner_armed` 置假,
    /// 因此单次最多触发一个角。
    fn detect_corner(&mut self, pos: Point, bounds: ScreenRect) -> Option<ScreenCorner> {
        let mut hit = None;
        for corner in ScreenCorner::ALL {
            let dist = int_distance(corner.point(bounds), pos);
            if !self.corner_armed && self.last_corner == Some(corner) && dist > CORNER_REARM_DIST {
                self.corner_armed = true;
            } else if dist <= CORNER_TRIGGER_DIST && self.corner_armed {
                self.corner_armed = false;
                self.last_corner = Some(corner);
                hit = Some(corner);
            }
        }
        hit
    }

    /// 摩擦边:贴边来回蹭。首次划出 `EDGE_MIN_MOVE` 起算,其后每次折返再满
    /// `EDGE_MIN_MOVE` 计一次,累计 `EDGE_MOVES_REQUIRED` 次即触发。
    fn detect_rub(&mut self, pos: Point, now: Instant, screen: ScreenInfo) -> Option<ScreenEdge> {
        let bounds = screen.bounds;
        let thick = (EDGE_THICK_BASE * screen.dpi_scale) as i32;
        // 转显示器局部坐标(与参考一致,便于按宽高做角落排除)
        let local = Point {
            x: pos.x - bounds.left,
            y: pos.y - bounds.top,
        };
        let w = bounds.width();
        let h = bounds.height();

        let Some(state) = self.rub.as_mut() else {
            // 尚未贴边:进入边带即开始一段新的计数
            if let Some(edge) = active_edge(local, w, h, thick) {
                self.rub = Some(RubState {
                    edge,
                    peak: pos_on_edge(edge, local),
                    times: 0,
                    last_dir: 0,
                    last_move_at: now,
                });
            }
            return None;
        };

        // 已触发:等"垂直离开边"或"静止超时"其一,再复位重新计数
        if state.times >= EDGE_MOVES_REQUIRED {
            let left_edge = dist_to_edge(state.edge, local, w, h) >= EDGE_REARM_DIST;
            let idled = now.duration_since(state.last_move_at) > EDGE_REARM_TIMEOUT;
            if left_edge || idled {
                self.rub = None;
            }
            return None;
        }

        // 离开边带 / 换了一条边 / 进入角落排除区 → 整段作废
        if active_edge(local, w, h, thick) != Some(state.edge) {
            self.rub = None;
            return None;
        }

        let pos_on = pos_on_edge(state.edge, local);
        let delta = pos_on - state.peak;
        // 与上次同向:只外推峰值,不计数
        if state.last_dir != 0 && delta.signum() == state.last_dir {
            state.peak = pos_on;
            return None;
        }
        if delta.abs() < EDGE_MIN_MOVE {
            return None;
        }
        // 两次有效位移间隔过长 → 作废(下一条移动事件会重新进入边带起算)
        if now.duration_since(state.last_move_at) > EDGE_MOVE_INTERVAL {
            self.rub = None;
            return None;
        }
        state.last_move_at = now;
        state.times += 1;
        state.peak = pos_on;
        state.last_dir = delta.signum();
        if state.times >= EDGE_MOVES_REQUIRED {
            return Some(state.edge);
        }
        None
    }
}

/// 欧氏距离并截断为整数(与参考的 `(int)Math.Sqrt(...)` 一致)
fn int_distance(a: Point, b: Point) -> i32 {
    let dx = (a.x - b.x) as f64;
    let dy = (a.y - b.y) as f64;
    (dx * dx + dy * dy).sqrt() as i32
}

/// 光标所贴的边(显示器局部坐标);距两端 `EDGE_CORNER_EXCLUDE` 内不算
fn active_edge(local: Point, w: i32, h: i32, thick: i32) -> Option<ScreenEdge> {
    let ex = EDGE_CORNER_EXCLUDE;
    let y_ok = local.y > ex && local.y < h - ex;
    let x_ok = local.x > ex && local.x < w - ex;
    if local.x <= thick && y_ok {
        return Some(ScreenEdge::Left);
    }
    if local.x >= w - 1 - thick && y_ok {
        return Some(ScreenEdge::Right);
    }
    if local.y <= thick && x_ok {
        return Some(ScreenEdge::Top);
    }
    if local.y >= h - 1 - thick && x_ok {
        return Some(ScreenEdge::Bottom);
    }
    None
}

fn sequence_corner(local: Point, bounds: ScreenRect) -> Option<ScreenCorner> {
    let local_bounds = ScreenRect {
        left: 0,
        top: 0,
        right: bounds.width() - 1,
        bottom: bounds.height() - 1,
    };
    for corner in ScreenCorner::ALL {
        let point = corner.point(local_bounds);
        let dx = (local.x - point.x).abs();
        let dy = (local.y - point.y).abs();
        if dx <= CORNER_SEQUENCE_DIST
            && dy <= CORNER_SEQUENCE_DIST
            && int_distance(local, point) > CORNER_TRIGGER_DIST
        {
            return Some(corner);
        }
    }
    None
}

fn guide_corner(local: Point, bounds: ScreenRect) -> Option<ScreenCorner> {
    ScreenCorner::ALL
        .into_iter()
        .find(|corner| corner_guide_distance(local, *corner, bounds) <= CORNER_GUIDE_RADIUS)
}

fn guide_corner_proximity(local: Point, bounds: ScreenRect) -> Option<ScreenCorner> {
    if let Some(corner) = guide_corner(local, bounds) {
        return Some(corner);
    }
    ScreenCorner::ALL.into_iter().find(|corner| {
        corner_guide_distance(local, *corner, bounds) <= CORNER_GUIDE_RADIUS + CORNER_GUIDE_APPROACH
    })
}

fn guide_edge(local: Point, bounds: ScreenRect, thick: i32) -> Option<ScreenEdge> {
    active_edge(
        local,
        bounds.width(),
        bounds.height(),
        thick.saturating_mul(2),
    )
}

fn edge_thickness(dpi_scale: f64) -> i32 {
    (EDGE_THICK_BASE * dpi_scale) as i32
}

fn dpi_scale_milli(dpi_scale: f64) -> u32 {
    if !dpi_scale.is_finite() || dpi_scale <= 0.0 {
        return 0;
    }
    (dpi_scale * 1000.0).round().min(u32::MAX as f64) as u32
}

fn corner_guide_area(corner: ScreenCorner, bounds: ScreenRect) -> ScreenRect {
    let dist = CORNER_GUIDE_RADIUS;
    match corner {
        ScreenCorner::LeftBottom => ScreenRect {
            left: bounds.left,
            top: bounds.bottom.saturating_sub(dist).max(bounds.top),
            right: bounds.left.saturating_add(dist).min(bounds.right),
            bottom: bounds.bottom,
        },
        ScreenCorner::LeftTop => ScreenRect {
            left: bounds.left,
            top: bounds.top,
            right: bounds.left.saturating_add(dist).min(bounds.right),
            bottom: bounds.top.saturating_add(dist).min(bounds.bottom),
        },
        ScreenCorner::RightTop => ScreenRect {
            left: bounds.right.saturating_sub(dist).max(bounds.left),
            top: bounds.top,
            right: bounds.right,
            bottom: bounds.top.saturating_add(dist).min(bounds.bottom),
        },
        ScreenCorner::RightBottom => ScreenRect {
            left: bounds.right.saturating_sub(dist).max(bounds.left),
            top: bounds.bottom.saturating_sub(dist).max(bounds.top),
            right: bounds.right,
            bottom: bounds.bottom,
        },
    }
}

fn edge_guide_area(edge: ScreenEdge, bounds: ScreenRect, thick: i32) -> ScreenRect {
    let thick = thick.max(0);
    let inner_top = bounds.top.saturating_add(EDGE_CORNER_EXCLUDE + 1);
    let inner_bottom = bounds.bottom.saturating_sub(EDGE_CORNER_EXCLUDE);
    let inner_left = bounds.left.saturating_add(EDGE_CORNER_EXCLUDE + 1);
    let inner_right = bounds.right.saturating_sub(EDGE_CORNER_EXCLUDE);

    match edge {
        ScreenEdge::Left => ScreenRect {
            left: bounds.left,
            top: inner_top,
            right: bounds.left.saturating_add(thick).min(bounds.right),
            bottom: inner_bottom,
        },
        ScreenEdge::Top => ScreenRect {
            left: inner_left,
            top: bounds.top,
            right: inner_right,
            bottom: bounds.top.saturating_add(thick).min(bounds.bottom),
        },
        ScreenEdge::Right => ScreenRect {
            left: bounds.right.saturating_sub(thick).max(bounds.left),
            top: inner_top,
            right: bounds.right,
            bottom: inner_bottom,
        },
        ScreenEdge::Bottom => ScreenRect {
            left: inner_left,
            top: bounds.bottom.saturating_sub(thick).max(bounds.top),
            right: inner_right,
            bottom: bounds.bottom,
        },
    }
}

fn corner_guide_distance(local: Point, corner: ScreenCorner, bounds: ScreenRect) -> i32 {
    let point = corner.point(ScreenRect {
        left: 0,
        top: 0,
        right: bounds.width() - 1,
        bottom: bounds.height() - 1,
    });
    int_distance(local, point)
}

fn guide_alpha(distance: i32, max_distance: i32) -> u8 {
    let max_distance = max_distance.max(1);
    if distance <= 0 {
        return *GUIDE_ALPHA_LEVELS.last().unwrap_or(&255);
    }
    let distance = distance.clamp(0, max_distance) as usize;
    let max_distance = max_distance as usize;
    let max_index = GUIDE_ALPHA_LEVELS.len() - 2;
    let index = ((max_distance - distance) * max_index + max_distance / 2) / max_distance;
    GUIDE_ALPHA_LEVELS[index]
}

/// 沿边轴向的位置(左右边取 y,上下边取 x)
fn pos_on_edge(edge: ScreenEdge, local: Point) -> i32 {
    match edge {
        ScreenEdge::Left | ScreenEdge::Right => local.y,
        ScreenEdge::Top | ScreenEdge::Bottom => local.x,
    }
}

/// 到该边的垂直距离
fn dist_to_edge(edge: ScreenEdge, local: Point, w: i32, h: i32) -> i32 {
    match edge {
        ScreenEdge::Left => local.x,
        ScreenEdge::Right => (w - 1) - local.x,
        ScreenEdge::Top => local.y,
        ScreenEdge::Bottom => (h - 1) - local.y,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const W: i32 = 1920;
    const H: i32 = 1080;

    fn screen() -> ScreenInfo {
        ScreenInfo {
            bounds: ScreenRect {
                left: 0,
                top: 0,
                right: W - 1,
                bottom: H - 1,
            },
            dpi_scale: 1.0,
        }
    }

    fn screen_with_dpi(dpi_scale: f64) -> ScreenInfo {
        ScreenInfo {
            dpi_scale,
            ..screen()
        }
    }

    fn p(x: i32, y: i32) -> Point {
        Point { x, y }
    }

    /// 测试夹具:固定单显示器 + 可控时钟
    struct Sim {
        det: CornerEdgeDetector,
        t: Instant,
    }

    impl Sim {
        fn new() -> Self {
            Self {
                det: CornerEdgeDetector::new(),
                t: Instant::now(),
            }
        }

        fn mv(&mut self, x: i32, y: i32) -> Option<CornerEdgeHit> {
            self.det.on_move(p(x, y), self.t, || Some(screen()))
        }

        fn advance(&mut self, ms: u64) {
            self.t += Duration::from_millis(ms);
        }
    }

    #[test]
    fn hot_corner_fires_and_needs_rearm() {
        let mut s = Sim::new();
        assert_eq!(
            s.mv(0, 0),
            Some(CornerEdgeHit::Corner(ScreenCorner::LeftTop))
        );
        // 未离开重新武装距离:原地抖动不再触发
        assert_eq!(s.mv(1, 1), None);
        assert_eq!(s.mv(0, 0), None);
        assert_eq!(s.mv(20, 20), None);
        // 离开 >40px 后重新武装,再回来才触发
        assert_eq!(s.mv(200, 200), None);
        assert_eq!(
            s.mv(0, 0),
            Some(CornerEdgeHit::Corner(ScreenCorner::LeftTop))
        );
    }

    #[test]
    fn hot_corner_all_four_corners_hit_their_key() {
        let cases = [
            (0, 0, ScreenCorner::LeftTop),
            (W - 1, 0, ScreenCorner::RightTop),
            (0, H - 1, ScreenCorner::LeftBottom),
            (W - 1, H - 1, ScreenCorner::RightBottom),
        ];
        for (x, y, want) in cases {
            let mut s = Sim::new();
            assert_eq!(
                s.mv(x, y),
                Some(CornerEdgeHit::Corner(want)),
                "corner {want:?}"
            );
        }
    }

    #[test]
    fn hot_corner_ignores_near_miss() {
        let mut s = Sim::new();
        // 立即动作只允许精确角点,离开 1px 也不触发。
        assert_eq!(s.mv(1, 0), None);
        assert_eq!(s.mv(0, 1), None);
        assert_eq!(s.mv(3, 0), None);
        assert_eq!(s.mv(0, 3), None);
    }

    #[test]
    fn corner_keys_match_shared_schema() {
        assert_eq!(ScreenCorner::LeftTop.key(), "leftTop");
        assert_eq!(ScreenCorner::RightTop.key(), "rightTop");
        assert_eq!(ScreenCorner::LeftBottom.key(), "leftBottom");
        assert_eq!(ScreenCorner::RightBottom.key(), "rightBottom");
        assert_eq!(ScreenEdge::Left.key(), "left");
        assert_eq!(ScreenEdge::Top.key(), "top");
        assert_eq!(ScreenEdge::Right.key(), "right");
        assert_eq!(ScreenEdge::Bottom.key(), "bottom");
    }

    /// 沿左边来回蹭:4 次有效位移后触发
    #[test]
    fn rub_edge_fires_after_four_moves() {
        let mut s = Sim::new();
        assert_eq!(s.mv(5, 500), None); // 进入边带
        s.advance(100);
        assert_eq!(s.mv(5, 600), None); // 1
        s.advance(100);
        assert_eq!(s.mv(5, 500), None); // 2
        s.advance(100);
        assert_eq!(s.mv(5, 600), None); // 3
        s.advance(100);
        assert_eq!(s.mv(5, 500), Some(CornerEdgeHit::Edge(ScreenEdge::Left))); // 4
    }

    #[test]
    fn rub_edge_ignores_short_swings() {
        let mut s = Sim::new();
        assert_eq!(s.mv(5, 500), None);
        for _ in 0..8 {
            s.advance(100);
            // 79px < MIN_MOVE
            assert_eq!(s.mv(5, 579), None);
            s.advance(100);
            assert_eq!(s.mv(5, 500), None);
        }
    }

    #[test]
    fn rub_edge_resets_when_leaving_band() {
        let mut s = Sim::new();
        assert_eq!(s.mv(5, 500), None);
        s.advance(100);
        assert_eq!(s.mv(5, 600), None); // 1
        s.advance(100);
        assert_eq!(s.mv(300, 600), None); // 离开边带 → 作废
        s.advance(100);
        assert_eq!(s.mv(5, 600), None); // 重新起算
        s.advance(100);
        assert_eq!(s.mv(5, 500), None); // 1(不是 3)
        s.advance(100);
        assert_eq!(s.mv(5, 600), None); // 2
        s.advance(100);
        assert_eq!(s.mv(5, 500), None); // 3
        s.advance(100);
        assert_eq!(s.mv(5, 600), Some(CornerEdgeHit::Edge(ScreenEdge::Left))); // 4
    }

    #[test]
    fn rub_edge_resets_when_too_slow() {
        let mut s = Sim::new();
        assert_eq!(s.mv(5, 500), None);
        s.advance(100);
        assert_eq!(s.mv(5, 600), None); // 1
        s.advance(700); // > EDGE_MOVE_INTERVAL
        assert_eq!(s.mv(5, 500), None); // 作废
        s.advance(100);
        assert_eq!(s.mv(5, 600), None); // 重新起算(进入边带)
        s.advance(100);
        assert_eq!(s.mv(5, 500), None); // 1
        s.advance(100);
        assert_eq!(s.mv(5, 600), None); // 2
        s.advance(100);
        assert_eq!(s.mv(5, 500), None); // 3
        s.advance(100);
        assert_eq!(s.mv(5, 600), Some(CornerEdgeHit::Edge(ScreenEdge::Left))); // 4
    }

    #[test]
    fn rub_edge_does_not_refire_until_rearmed() {
        let mut s = Sim::new();
        assert_eq!(s.mv(5, 500), None);
        s.advance(100);
        assert_eq!(s.mv(5, 600), None);
        s.advance(100);
        assert_eq!(s.mv(5, 500), None);
        s.advance(100);
        assert_eq!(s.mv(5, 600), None);
        s.advance(100);
        assert_eq!(s.mv(5, 500), Some(CornerEdgeHit::Edge(ScreenEdge::Left)));
        // 继续贴边蹭不会再次触发
        for _ in 0..4 {
            s.advance(100);
            assert_eq!(s.mv(5, 600), None);
            s.advance(100);
            assert_eq!(s.mv(5, 500), None);
        }
        // 垂直离开 >=50px 才复位
        s.advance(100);
        assert_eq!(s.mv(60, 500), None);
        s.advance(100);
        assert_eq!(s.mv(5, 500), None);
        s.advance(100);
        assert_eq!(s.mv(5, 600), None); // 1
        s.advance(100);
        assert_eq!(s.mv(5, 500), None); // 2
        s.advance(100);
        assert_eq!(s.mv(5, 600), None); // 3
        s.advance(100);
        assert_eq!(s.mv(5, 500), Some(CornerEdgeHit::Edge(ScreenEdge::Left))); // 4
    }

    #[test]
    fn rub_edge_rearms_after_idle_timeout() {
        let mut s = Sim::new();
        assert_eq!(s.mv(5, 500), None);
        s.advance(100);
        assert_eq!(s.mv(5, 600), None);
        s.advance(100);
        assert_eq!(s.mv(5, 500), None);
        s.advance(100);
        assert_eq!(s.mv(5, 600), None);
        s.advance(100);
        assert_eq!(s.mv(5, 500), Some(CornerEdgeHit::Edge(ScreenEdge::Left)));
        // 贴边静止超过 1500ms 后,下一条移动事件即复位
        s.advance(1600);
        assert_eq!(s.mv(5, 505), None);
        s.advance(100);
        assert_eq!(s.mv(5, 500), None); // 复位后的下一条事件 = 重新进入边带,不计数
        s.advance(100);
        assert_eq!(s.mv(5, 600), None); // 1
        s.advance(100);
        assert_eq!(s.mv(5, 500), None); // 2
        s.advance(100);
        assert_eq!(s.mv(5, 600), None); // 3
        s.advance(100);
        assert_eq!(s.mv(5, 500), Some(CornerEdgeHit::Edge(ScreenEdge::Left))); // 4
    }

    /// 角落排除区:离角 100px 内不算贴边,免得和触发角抢
    #[test]
    fn rub_edge_excludes_corner_zone() {
        assert_eq!(active_edge(p(5, 50), W, H, 16), None);
        assert_eq!(active_edge(p(5, H - 50), W, H, 16), None);
        assert_eq!(active_edge(p(5, 500), W, H, 16), Some(ScreenEdge::Left));
        assert_eq!(active_edge(p(50, 5), W, H, 16), None);
        assert_eq!(active_edge(p(500, 5), W, H, 16), Some(ScreenEdge::Top));
    }

    #[test]
    fn rub_edge_detects_all_four_edges() {
        assert_eq!(active_edge(p(0, 500), W, H, 16), Some(ScreenEdge::Left));
        assert_eq!(
            active_edge(p(W - 1, 500), W, H, 16),
            Some(ScreenEdge::Right)
        );
        assert_eq!(active_edge(p(500, 0), W, H, 16), Some(ScreenEdge::Top));
        assert_eq!(
            active_edge(p(500, H - 1), W, H, 16),
            Some(ScreenEdge::Bottom)
        );
        // 带外
        assert_eq!(active_edge(p(17, 500), W, H, 16), None);
    }

    /// 边带厚度随 DPI 缩放(参考如此);其余阈值不缩放
    #[test]
    fn edge_band_scales_with_dpi() {
        let hidpi = ScreenInfo {
            dpi_scale: 1.5,
            ..screen()
        };
        let mut det = CornerEdgeDetector::new();
        let t = Instant::now();
        // 100% 下 20px 已出带,150% 下(24px 带)仍在带内
        assert!(det.detect_rub(p(20, 500), t, hidpi).is_none());
        assert!(det.rub.is_some(), "150% 缩放下 20px 应仍在边带内");

        let mut det = CornerEdgeDetector::new();
        assert!(det.detect_rub(p(20, 500), t, screen()).is_none());
        assert!(det.rub.is_none(), "100% 缩放下 20px 应已出带");
    }

    /// 非主显示器:坐标带偏移时角点仍按该显示器算
    #[test]
    fn corner_uses_offset_monitor_bounds() {
        let second = ScreenInfo {
            bounds: ScreenRect {
                left: 1920,
                top: 0,
                right: 1920 + 1279,
                bottom: 1023,
            },
            dpi_scale: 1.0,
        };
        let mut det = CornerEdgeDetector::new();
        let t = Instant::now();
        assert_eq!(
            det.on_move(p(1920, 0), t, || Some(second)),
            Some(CornerEdgeHit::Corner(ScreenCorner::LeftTop))
        );
        // 该显示器的右下角
        let t = t + Duration::from_millis(100);
        assert_eq!(det.on_move(p(2000, 500), t, || Some(second)), None);
        let t = t + Duration::from_millis(100);
        assert_eq!(
            det.on_move(p(3199, 1023), t, || Some(second)),
            Some(CornerEdgeHit::Corner(ScreenCorner::RightBottom))
        );

        let mut sequence = CornerEdgeDetector::new();
        assert_eq!(
            sequence.sequence_at(p(1921, 1), t, || Some(second)),
            Some(CornerEdgeHit::Corner(ScreenCorner::LeftTop))
        );
    }

    /// 显示器缓存:同屏内不重复查询,超时后失效
    #[test]
    fn screen_lookup_is_cached_until_ttl() {
        let mut det = CornerEdgeDetector::new();
        let t = Instant::now();
        let mut lookups = 0;
        for _ in 0..5 {
            det.on_move(p(500, 500), t, || {
                lookups += 1;
                Some(screen())
            });
        }
        assert_eq!(lookups, 1, "同一显示器内应只查询一次");

        let later = t + SCREEN_CACHE_TTL + Duration::from_millis(1);
        det.on_move(p(500, 500), later, || {
            lookups += 1;
            Some(screen())
        });
        assert_eq!(lookups, 2, "超过 TTL 后应重新查询");
    }

    /// 光标落在任何已知显示器之外(例如显示器刚被拔掉)→ 不判定、不 panic
    #[test]
    fn no_screen_means_no_hit() {
        let mut det = CornerEdgeDetector::new();
        assert_eq!(det.on_move(p(0, 0), Instant::now(), || None), None);
    }

    /// 同向继续移动只外推"峰值"、不计数,折返时以峰值为基准量距离。
    /// 这是移植里最微妙的一条:少了它,一次快速划动被拆成多条中间事件时会被多计。
    #[test]
    fn rub_edge_slides_peak_on_same_direction() {
        let mut s = Sim::new();
        assert_eq!(s.mv(5, 500), None); // 进入边带,峰值 500
        s.advance(100);
        assert_eq!(s.mv(5, 600), None); // 1(方向 +,峰值 600)
        s.advance(100);
        assert_eq!(s.mv(5, 650), None); // 同向:只把峰值推到 650,不计数
        s.advance(100);
        // 从峰值 650 折返 80px 才算数;若上一步误计或没推峰值,这里只有 30px,不会计数
        assert_eq!(s.mv(5, 570), None); // 2
        s.advance(100);
        assert_eq!(s.mv(5, 660), None); // 3
        s.advance(100);
        assert_eq!(s.mv(5, 580), Some(CornerEdgeHit::Edge(ScreenEdge::Left))); // 4
    }

    /// 闭区间换算只在 `screen_at` 做一次,右/下边界不能多减也不能少减一。
    /// 这两处正是与参考实现差 1px 的地方,必须钉住,别被"顺手对齐参考"改回去。
    #[test]
    fn closed_interval_right_and_bottom_boundaries() {
        // 边带:右侧最外 17px 在带内,再往里一格就出带
        assert_eq!(
            active_edge(p(W - 1 - 16, 500), W, H, 16),
            Some(ScreenEdge::Right)
        );
        assert_eq!(active_edge(p(W - 1 - 17, 500), W, H, 16), None);
        assert_eq!(
            active_edge(p(500, H - 1 - 16), W, H, 16),
            Some(ScreenEdge::Bottom)
        );
        assert_eq!(active_edge(p(500, H - 1 - 17), W, H, 16), None);

        // 角:只有精确角点触发,近角位置保留给后续序列。
        let mut s = Sim::new();
        assert_eq!(s.mv(W - 2, H - 1), None);
        let mut s = Sim::new();
        assert_eq!(
            s.mv(W - 1, H - 1),
            Some(CornerEdgeHit::Corner(ScreenCorner::RightBottom))
        );
    }

    #[test]
    fn boundary_sequence_zone_separates_corners_from_edges() {
        let mut det = CornerEdgeDetector::new();
        let t = Instant::now();
        assert_eq!(
            det.sequence_at(p(0, 0), t, || Some(screen())),
            None,
            "exact corner belongs to the immediate action"
        );
        assert_eq!(
            det.sequence_at(p(1, 1), t, || Some(screen())),
            Some(CornerEdgeHit::Corner(ScreenCorner::LeftTop))
        );
        assert_eq!(
            det.sequence_at(p(0, 100), t, || Some(screen())),
            Some(CornerEdgeHit::Corner(ScreenCorner::LeftTop))
        );
        assert_eq!(
            det.sequence_at(p(0, 101), t, || Some(screen())),
            Some(CornerEdgeHit::Edge(ScreenEdge::Left))
        );
    }

    #[test]
    fn guide_at_uses_closed_ten_pixel_corner_geometry_and_alpha() {
        let mut detector = CornerEdgeDetector::new();
        let exact = detector
            .guide_at(p(0, 0), Instant::now(), || Some(screen()), true, true)
            .expect("exact corner should produce a guide");

        assert_eq!(exact.region, CornerEdgeHit::Corner(ScreenCorner::LeftTop));
        assert_eq!(
            exact.area,
            ScreenRect {
                left: 0,
                top: 0,
                right: 10,
                bottom: 10,
            }
        );
        assert_eq!(exact.alpha, 255);

        let weaker = detector
            .guide_at(p(15, 0), Instant::now(), || Some(screen()), true, true)
            .expect("corner approach should produce a guide");

        assert_eq!(weaker.region, CornerEdgeHit::Corner(ScreenCorner::LeftTop));
        assert!(weaker.alpha < exact.alpha);
        assert_eq!(weaker.alpha, 104);
        assert!(!weaker.area.contains(p(15, 0)));

        assert!(detector
            .guide_at(p(21, 0), Instant::now(), || Some(screen()), true, true)
            .is_none());
        assert!(detector
            .guide_at(p(50, 50), Instant::now(), || Some(screen()), true, true)
            .is_none());

        let edge = detector
            .guide_at(p(0, 500), Instant::now(), || Some(screen()), true, true)
            .expect("left edge should produce a guide");
        assert_eq!(edge.region, CornerEdgeHit::Edge(ScreenEdge::Left));
        assert_eq!(edge.alpha, 255);
    }

    #[test]
    fn guide_at_keeps_corner_opaque_until_the_real_radius_then_fades_inward() {
        let mut detector = CornerEdgeDetector::default();
        let center = detector
            .guide_at(p(0, 0), Instant::now(), || Some(screen()), true, true)
            .unwrap();
        let real_edge = detector
            .guide_at(p(10, 0), Instant::now(), || Some(screen()), true, true)
            .unwrap();
        let inward = detector
            .guide_at(p(15, 0), Instant::now(), || Some(screen()), true, true)
            .unwrap();

        assert_eq!(center.alpha, 255);
        assert_eq!(real_edge.alpha, 255);
        assert!(inward.alpha < 255);
        assert!(inward.alpha > 0);
    }

    #[test]
    fn guide_at_stops_corner_proximity_after_twenty_pixels_without_changing_area() {
        let mut detector = CornerEdgeDetector::default();
        let frame = detector
            .guide_at(p(19, 0), Instant::now(), || Some(screen()), true, true)
            .unwrap();
        assert_eq!(
            frame.area,
            corner_guide_area(ScreenCorner::LeftTop, screen().bounds)
        );
        assert!(detector
            .guide_at(p(21, 0), Instant::now(), || Some(screen()), true, true)
            .is_none());
    }

    #[test]
    fn guide_at_keeps_edges_opaque_through_the_band_then_fades_toward_the_interior() {
        let mut detector = CornerEdgeDetector::default();
        let edge = detector
            .guide_at(p(0, 500), Instant::now(), || Some(screen()), true, true)
            .unwrap();
        let inner_border = detector
            .guide_at(p(16, 500), Instant::now(), || Some(screen()), true, true)
            .unwrap();
        let fade = detector
            .guide_at(p(24, 500), Instant::now(), || Some(screen()), true, true)
            .unwrap();

        assert_eq!(edge.alpha, 255);
        assert_eq!(inner_border.alpha, 255);
        assert!(fade.alpha < 255);
        assert!(fade.alpha > 0);
        assert!(detector
            .guide_at(p(33, 500), Instant::now(), || Some(screen()), true, true)
            .is_none());
    }

    #[test]
    fn guide_at_hides_disabled_sides_and_corner_exclusion_area() {
        let mut detector = CornerEdgeDetector::new();
        assert!(detector
            .guide_at(p(10, 500), Instant::now(), || Some(screen()), true, false)
            .is_none());
        assert!(detector
            .guide_at(p(7, 7), Instant::now(), || Some(screen()), false, true)
            .is_none());
        assert!(detector
            .guide_at(p(100, 500), Instant::now(), || Some(screen()), true, true)
            .is_none());
    }

    #[test]
    fn guide_alpha_stays_opaque_through_the_boundary_and_uses_monitor_dpi() {
        let mut detector = CornerEdgeDetector::new();
        let far = detector
            .guide_at(p(24, 500), Instant::now(), || Some(screen()), true, true)
            .expect("edge approach should be visible");
        let near = detector
            .guide_at(p(0, 500), Instant::now(), || Some(screen()), true, true)
            .expect("edge boundary should be visible");

        assert!(near.alpha > far.alpha);
        assert_eq!(near.dpi_scale_milli, 1000);
    }

    #[test]
    fn guide_at_uses_local_coordinates_for_offset_monitor() {
        let offset_screen = ScreenInfo {
            bounds: ScreenRect {
                left: 1920,
                top: 1080,
                right: 1920 + W - 1,
                bottom: 1080 + H - 1,
            },
            dpi_scale: 1.0,
        };
        let mut detector = CornerEdgeDetector::new();
        let frame = detector
            .guide_at(
                p(offset_screen.bounds.left + 7, offset_screen.bounds.top + 7),
                Instant::now(),
                || Some(offset_screen),
                true,
                true,
            )
            .expect("near corner on an offset monitor should produce a guide");

        assert_eq!(frame.region, CornerEdgeHit::Corner(ScreenCorner::LeftTop));
        assert!(frame.area.contains(p(
            offset_screen.bounds.left + 7,
            offset_screen.bounds.top + 7
        )));
    }

    #[test]
    fn guide_edge_area_scales_with_monitor_dpi() {
        let mut detector = CornerEdgeDetector::new();
        let frame = detector
            .guide_at(
                p(32, 500),
                Instant::now(),
                || Some(screen_with_dpi(2.0)),
                true,
                true,
            )
            .expect("high-DPI edge entry should be visible");

        assert_eq!(frame.region, CornerEdgeHit::Edge(ScreenEdge::Left));
        assert_eq!(frame.dpi_scale_milli, 2000);
        assert!(frame.area.contains(p(32, 500)));
        assert!(!frame.area.contains(p(33, 500)));
        assert_eq!(frame.alpha, 255);
    }

    #[test]
    fn guide_at_does_not_change_the_next_on_move_hit() {
        let now = Instant::now();
        let mut guided_corner = CornerEdgeDetector::new();
        let mut plain_corner = CornerEdgeDetector::new();
        let _ = guided_corner.guide_at(p(0, 0), now, || Some(screen()), true, true);
        assert_eq!(
            guided_corner.on_move(p(0, 0), now, || Some(screen())),
            plain_corner.on_move(p(0, 0), now, || Some(screen()))
        );

        let mut sequence = CornerEdgeDetector::new();
        assert_eq!(
            sequence.sequence_at(p(50, 50), now, || Some(screen())),
            Some(CornerEdgeHit::Corner(ScreenCorner::LeftTop))
        );

        let mut guided_edge = CornerEdgeDetector::new();
        let mut plain_edge = CornerEdgeDetector::new();
        let _ = guided_edge.guide_at(p(5, 500), now, || Some(screen()), true, true);
        for (x, expected) in [(600, None), (500, None), (600, None), (500, None)] {
            assert_eq!(
                guided_edge.on_move(p(5, x), now, || Some(screen())),
                expected
            );
            assert_eq!(
                plain_edge.on_move(p(5, x), now, || Some(screen())),
                expected
            );
        }
        assert_eq!(
            guided_edge.on_move(p(5, 600), now, || Some(screen())),
            plain_edge.on_move(p(5, 600), now, || Some(screen()))
        );
        assert_eq!(
            guided_edge.on_move(p(5, 500), now, || Some(screen())),
            plain_edge.on_move(p(5, 500), now, || Some(screen()))
        );
    }

    /// 下边缘 + 非零 top 偏移的显示器:参考实现在这里是坏的(见文件头出入说明 2),
    /// 本实现必须能正常触发,且按"垂直离开 50px"复位。
    #[test]
    fn rub_bottom_edge_on_monitor_below_primary() {
        // 主屏下方的第二块屏:y ∈ [1080, 2159]
        let below = ScreenInfo {
            bounds: ScreenRect {
                left: 0,
                top: 1080,
                right: W - 1,
                bottom: 1080 + H - 1,
            },
            dpi_scale: 1.0,
        };
        let mut det = CornerEdgeDetector::new();
        let mut t = Instant::now();
        let mv = |det: &mut CornerEdgeDetector, t: &mut Instant, x: i32, y: i32| {
            *t += Duration::from_millis(100);
            det.on_move(p(x, y), *t, || Some(below))
        };

        // 局部 y = 2150 - 1080 = 1070 ≥ 1080-1-16,在下边带内
        assert_eq!(mv(&mut det, &mut t, 500, 2150), None); // 进入边带
        assert_eq!(mv(&mut det, &mut t, 600, 2150), None); // 1
        assert_eq!(mv(&mut det, &mut t, 500, 2150), None); // 2
        assert_eq!(mv(&mut det, &mut t, 600, 2150), None); // 3
        assert_eq!(
            mv(&mut det, &mut t, 500, 2150),
            Some(CornerEdgeHit::Edge(ScreenEdge::Bottom))
        );

        // 仍贴着边:不复位(参考实现在这里会立刻复位,可连发)
        assert_eq!(mv(&mut det, &mut t, 600, 2150), None);
        assert!(det.rub.is_some(), "贴边未离开,不应复位");

        // 垂直离开 ≥50px(局部 y = 1020,到下边距离 59)→ 复位
        assert_eq!(mv(&mut det, &mut t, 600, 2100), None);
        assert!(det.rub.is_none(), "离开 50px 后应复位");
    }
}
