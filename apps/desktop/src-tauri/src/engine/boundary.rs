use super::config::{BoundaryIntent, BoundaryToken, ConfigDocument};
use super::corners::CornerEdgeHit;
use super::tracker::MouseButton;
use super::types::Point;
use std::time::{Duration, Instant};

const BOUNDARY_SEQUENCE_TIMEOUT: Duration = Duration::from_millis(1200);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BoundaryReplay {
    Click { button: MouseButton, pos: Point },
    Wheel { forward: bool },
}

#[derive(Debug, Clone, PartialEq)]
pub enum BoundaryResult {
    Idle,
    Pending,
    Complete {
        intent: Box<BoundaryIntent>,
        hit: CornerEdgeHit,
        origin: Point,
        consumed: Vec<BoundaryReplay>,
    },
    Cancelled {
        replay: Vec<BoundaryReplay>,
    },
}

#[derive(Debug)]
struct ActiveBoundary {
    candidates: Vec<BoundaryIntent>,
    next_index: usize,
    origin: Point,
    hit: CornerEdgeHit,
    last_input_at: Instant,
    consumed: Vec<BoundaryReplay>,
}

#[derive(Debug, Default)]
pub struct BoundaryMatcher {
    active: Option<ActiveBoundary>,
}

impl BoundaryMatcher {
    pub fn activate(
        &mut self,
        config: &ConfigDocument,
        hit: CornerEdgeHit,
        origin: Point,
        now: Instant,
    ) -> BoundaryResult {
        self.active = None;
        let (kind, key, enabled) = match hit {
            CornerEdgeHit::Corner(corner) => {
                ("hotCorner", corner.key(), config.hot_corners.enabled)
            }
            CornerEdgeHit::Edge(edge) => ("rubEdge", edge.key(), config.rub_edges.enabled),
        };
        if !enabled {
            return BoundaryResult::Idle;
        }

        let mut candidates: Vec<_> = config
            .boundary_intents
            .iter()
            .filter(|intent| intent.origin.matches(kind, key))
            .cloned()
            .collect();
        candidates.sort_by_key(|intent| intent.order);
        if candidates.is_empty() {
            return BoundaryResult::Idle;
        }
        if let Some(intent) = candidates.iter().find(|intent| intent.sequence.is_empty()) {
            return BoundaryResult::Complete {
                intent: Box::new(intent.clone()),
                hit,
                origin,
                consumed: Vec::new(),
            };
        }

        self.active = Some(ActiveBoundary {
            candidates,
            next_index: 0,
            origin,
            hit,
            last_input_at: now,
            consumed: Vec::new(),
        });
        BoundaryResult::Pending
    }

    pub fn is_active(&self) -> bool {
        self.active.is_some()
    }

    pub fn feed(
        &mut self,
        token: BoundaryToken,
        replay: Option<BoundaryReplay>,
        now: Instant,
    ) -> BoundaryResult {
        let Some(active) = self.active.as_mut() else {
            return BoundaryResult::Idle;
        };
        if now.duration_since(active.last_input_at) > BOUNDARY_SEQUENCE_TIMEOUT {
            return self.cancel();
        }

        active
            .candidates
            .retain(|intent| intent.sequence.get(active.next_index) == Some(&token));
        if active.candidates.is_empty() {
            return self.cancel();
        }
        if let Some(replay) = replay {
            active.consumed.push(replay);
        }
        active.next_index += 1;
        active.last_input_at = now;

        if let Some(intent) = active
            .candidates
            .iter()
            .find(|intent| intent.sequence.len() == active.next_index)
            .cloned()
        {
            let active = self.active.take().expect("active boundary must exist");
            return BoundaryResult::Complete {
                intent: Box::new(intent),
                hit: active.hit,
                origin: active.origin,
                consumed: active.consumed,
            };
        }
        BoundaryResult::Pending
    }

    pub fn tick(&mut self, now: Instant) -> BoundaryResult {
        match self.active.as_ref() {
            Some(active)
                if now.duration_since(active.last_input_at) > BOUNDARY_SEQUENCE_TIMEOUT =>
            {
                self.cancel()
            }
            Some(_) => BoundaryResult::Pending,
            None => BoundaryResult::Idle,
        }
    }

    pub fn cancel(&mut self) -> BoundaryResult {
        self.active
            .take()
            .map_or(BoundaryResult::Idle, |active| BoundaryResult::Cancelled {
                replay: active.consumed,
            })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::config::{
        BoundaryMouseButton, BoundaryOrigin, BoundaryWheelDirection, Command,
    };
    use crate::engine::corners::ScreenCorner;
    use crate::engine::types::Direction;

    fn intent(id: &str, sequence: Vec<BoundaryToken>, order: i32) -> BoundaryIntent {
        BoundaryIntent {
            id: id.into(),
            name: id.into(),
            origin: BoundaryOrigin::HotCorner {
                corner: "leftTop".into(),
            },
            sequence,
            command: Command::DoNothing,
            order,
        }
    }

    fn pt() -> Point {
        Point { x: 0, y: 0 }
    }

    #[test]
    fn empty_sequence_completes_on_activation() {
        let mut config = ConfigDocument::default();
        config.boundary_intents = vec![intent("empty", vec![], 0)];
        let mut matcher = BoundaryMatcher::default();
        assert!(matches!(
            matcher.activate(
                &config,
                CornerEdgeHit::Corner(ScreenCorner::LeftTop),
                pt(),
                Instant::now()
            ),
            BoundaryResult::Complete { intent, .. } if intent.id == "empty"
        ));
        assert!(!matcher.is_active());
    }

    #[test]
    fn matches_button_wheel_and_stroke_in_order() {
        let mut config = ConfigDocument::default();
        config.boundary_intents = vec![intent(
            "sequence",
            vec![
                BoundaryToken::Button {
                    button: BoundaryMouseButton::Right,
                },
                BoundaryToken::Wheel {
                    direction: BoundaryWheelDirection::Forward,
                },
                BoundaryToken::Stroke {
                    direction: Direction::Down,
                },
            ],
            0,
        )];
        let mut matcher = BoundaryMatcher::default();
        let t = Instant::now();
        assert_eq!(
            matcher.activate(
                &config,
                CornerEdgeHit::Corner(ScreenCorner::LeftTop),
                pt(),
                t
            ),
            BoundaryResult::Pending
        );
        assert_eq!(
            matcher.feed(
                BoundaryToken::Button {
                    button: BoundaryMouseButton::Right,
                },
                Some(BoundaryReplay::Click {
                    button: MouseButton::Right,
                    pos: pt(),
                }),
                t,
            ),
            BoundaryResult::Pending
        );
        assert_eq!(
            matcher.feed(
                BoundaryToken::Wheel {
                    direction: BoundaryWheelDirection::Forward,
                },
                Some(BoundaryReplay::Wheel { forward: true }),
                t,
            ),
            BoundaryResult::Pending
        );
        assert!(matches!(
            matcher.feed(
                BoundaryToken::Stroke { direction: Direction::Down },
                None,
                t,
            ),
            BoundaryResult::Complete { intent, consumed, .. }
                if intent.id == "sequence" && consumed.len() == 2
        ));
    }

    #[test]
    fn mismatch_and_timeout_return_only_previously_consumed_input() {
        let mut config = ConfigDocument::default();
        config.boundary_intents = vec![intent(
            "wheel",
            vec![
                BoundaryToken::Wheel {
                    direction: BoundaryWheelDirection::Forward,
                },
                BoundaryToken::Wheel {
                    direction: BoundaryWheelDirection::Backward,
                },
            ],
            0,
        )];
        let mut matcher = BoundaryMatcher::default();
        let t = Instant::now();
        matcher.activate(
            &config,
            CornerEdgeHit::Corner(ScreenCorner::LeftTop),
            pt(),
            t,
        );
        matcher.feed(
            BoundaryToken::Wheel {
                direction: BoundaryWheelDirection::Forward,
            },
            Some(BoundaryReplay::Wheel { forward: true }),
            t,
        );
        assert_eq!(
            matcher.feed(
                BoundaryToken::Wheel {
                    direction: BoundaryWheelDirection::Forward,
                },
                Some(BoundaryReplay::Wheel { forward: true }),
                t,
            ),
            BoundaryResult::Cancelled {
                replay: vec![BoundaryReplay::Wheel { forward: true }]
            }
        );

        matcher.activate(
            &config,
            CornerEdgeHit::Corner(ScreenCorner::LeftTop),
            pt(),
            t,
        );
        assert_eq!(
            matcher.tick(t + BOUNDARY_SEQUENCE_TIMEOUT + Duration::from_millis(1)),
            BoundaryResult::Cancelled { replay: vec![] }
        );
    }

    #[test]
    fn disabled_or_different_origins_do_not_arm() {
        let mut config = ConfigDocument::default();
        config.boundary_intents = vec![intent("x", vec![], 0)];
        config.hot_corners.enabled = false;
        let mut matcher = BoundaryMatcher::default();
        assert_eq!(
            matcher.activate(
                &config,
                CornerEdgeHit::Corner(ScreenCorner::LeftTop),
                pt(),
                Instant::now()
            ),
            BoundaryResult::Idle
        );
        config.hot_corners.enabled = true;
        assert_eq!(
            matcher.activate(
                &config,
                CornerEdgeHit::Corner(ScreenCorner::RightTop),
                pt(),
                Instant::now()
            ),
            BoundaryResult::Idle
        );
    }
}
