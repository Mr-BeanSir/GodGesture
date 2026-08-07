use super::capture::{
    CaptureLedger, CaptureReplay, OrderedMatchError, OrderedMatcher, ReleaseDisposition,
};
use super::config::{BoundaryIntent, BoundaryToken, ConfigDocument, GestureInput};
use super::corners::CornerEdgeHit;
use super::tracker::MouseButton;
use super::types::Point;
use std::time::{Duration, Instant};

const BOUNDARY_SEQUENCE_TIMEOUT: Duration = Duration::from_millis(1200);
/// Keep an immediate action responsive while leaving enough time for the
/// common next wheel/button event to select a longer sequence.
const BOUNDARY_IMMEDIATE_FALLBACK_TIMEOUT: Duration = Duration::from_millis(180);

pub type BoundaryReplay = CaptureReplay;

#[derive(Debug, Clone, PartialEq)]
pub enum BoundaryResult {
    Idle,
    Pending,
    Complete {
        intent: Box<BoundaryIntent>,
        hit: CornerEdgeHit,
        origin: Point,
        consumed: Vec<BoundaryReplay>,
        /// The button release that completes this boundary sequence. When the
        /// sequence starts with a button, this is the primary boundary key;
        /// otherwise it is the final button fallback.
        released_button: Option<MouseButton>,
        /// Button-up events already received while the matcher waited for the
        /// primary release. They must not be replayed or masked again.
        released_buttons: Vec<MouseButton>,
    },
    Cancelled {
        replay: Vec<BoundaryReplay>,
    },
}

#[derive(Debug)]
struct ActiveBoundary {
    sequence: OrderedMatcher<BoundaryIntent>,
    origin: Point,
    hit: CornerEdgeHit,
    last_input_at: Instant,
    capture: CaptureLedger,
    waiting_intent: Option<BoundaryIntent>,
}

fn timeout_for(active: &ActiveBoundary) -> Duration {
    if active.capture.waiting_for_release().is_some() {
        Duration::MAX
    } else if active.sequence.next_index() == 0 && active.sequence.has_fallback() {
        BOUNDARY_IMMEDIATE_FALLBACK_TIMEOUT
    } else {
        BOUNDARY_SEQUENCE_TIMEOUT
    }
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
            .filter(|intent| intent.enabled && intent.origin.matches(kind, key))
            .cloned()
            .collect();
        candidates.sort_by_key(|intent| intent.order);
        if candidates.is_empty() {
            return BoundaryResult::Idle;
        }

        let fallback = candidates
            .iter()
            .find(|intent| intent.sequence.is_empty())
            .cloned();
        candidates.retain(|intent| !intent.sequence.is_empty());

        if candidates.is_empty() {
            let Some(intent) = fallback else {
                return BoundaryResult::Idle;
            };
            return BoundaryResult::Complete {
                intent: Box::new(intent),
                hit,
                origin,
                consumed: Vec::new(),
                released_button: None,
                released_buttons: Vec::new(),
            };
        }

        self.active = Some(ActiveBoundary {
            sequence: OrderedMatcher::new(candidates, fallback),
            origin,
            hit,
            last_input_at: now,
            capture: CaptureLedger::default(),
            waiting_intent: None,
        });
        BoundaryResult::Pending
    }

    /// Complete an empty-sequence action from a movement-triggered corner or
    /// a completed rub edge without arming any following-input candidates.
    pub fn activate_immediate(
        &mut self,
        config: &ConfigDocument,
        hit: CornerEdgeHit,
        origin: Point,
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
        let Some(intent) = config
            .boundary_intents
            .iter()
            .filter(|intent| {
                intent.enabled && intent.sequence.is_empty() && intent.origin.matches(kind, key)
            })
            .min_by_key(|intent| intent.order)
            .cloned()
        else {
            return BoundaryResult::Idle;
        };
        BoundaryResult::Complete {
            intent: Box::new(intent),
            hit,
            origin,
            consumed: Vec::new(),
            released_button: None,
            released_buttons: Vec::new(),
        }
    }

    pub fn has_prefix(config: &ConfigDocument, hit: CornerEdgeHit, token: &BoundaryToken) -> bool {
        let (kind, key, enabled) = match hit {
            CornerEdgeHit::Corner(corner) => {
                ("hotCorner", corner.key(), config.hot_corners.enabled)
            }
            CornerEdgeHit::Edge(edge) => ("rubEdge", edge.key(), config.rub_edges.enabled),
        };
        enabled
            && config.boundary_intents.iter().any(|intent| {
                intent.enabled
                    && !intent.sequence.is_empty()
                    && intent.origin.matches(kind, key)
                    && intent.sequence.first() == Some(token)
            })
    }

    pub fn is_active(&self) -> bool {
        self.active.is_some()
    }

    pub fn is_waiting_for_button_up(&self) -> bool {
        self.active
            .as_ref()
            .is_some_and(|active| active.capture.waiting_for_release().is_some())
    }

    /// Returns the name once an active sequence has fully matched and is only
    /// waiting for its primary button to be released.
    pub fn recognized_name(&self) -> Option<String> {
        self.active
            .as_ref()
            .and_then(|active| active.waiting_intent.as_ref())
            .map(|intent| intent.name.clone())
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
        if active.capture.waiting_for_release().is_some() {
            return BoundaryResult::Pending;
        }
        if now.duration_since(active.last_input_at) > timeout_for(active) {
            return self.cancel();
        }

        let button_token = match &token {
            BoundaryToken::Button { button } => Some(boundary_mouse_button(*button)),
            _ => None,
        };
        let completed = match active.sequence.feed(
            &token,
            |intent, index, token| intent.sequence.get(index) == Some(token),
            |intent, index| intent.sequence.len() == index,
        ) {
            Ok(completed) => completed,
            Err(OrderedMatchError::NoCandidate) => return self.cancel(),
        };
        active
            .capture
            .push_ordered(boundary_token_to_input(&token), replay, button_token);
        active.last_input_at = now;

        if let Some(intent) = completed {
            if let Some(button) = active.capture.release_anchor().or(button_token) {
                active.capture.arm_release(Some(button));
                active.waiting_intent = Some(intent);
                return BoundaryResult::Pending;
            }
            let mut active = self.active.take().expect("active boundary must exist");
            return BoundaryResult::Complete {
                intent: Box::new(intent),
                hit: active.hit,
                origin: active.origin,
                consumed: active.capture.take_consumed(),
                released_button: None,
                released_buttons: active.capture.take_released_buttons(),
            };
        }
        BoundaryResult::Pending
    }

    pub fn release(&mut self, button: MouseButton) -> BoundaryResult {
        if !self
            .active
            .as_ref()
            .is_some_and(|active| active.capture.waiting_for_release().is_some())
        {
            return BoundaryResult::Idle;
        }
        let disposition = self
            .active
            .as_mut()
            .expect("waiting boundary must exist")
            .capture
            .release_button(button);
        if disposition == ReleaseDisposition::Anchor {
            let mut active = self.active.take().expect("waiting boundary must exist");
            let intent = active
                .waiting_intent
                .take()
                .expect("waiting intent must exist");
            return BoundaryResult::Complete {
                intent: Box::new(intent),
                hit: active.hit,
                origin: active.origin,
                consumed: active.capture.take_consumed(),
                released_button: Some(button),
                released_buttons: active.capture.take_released_buttons(),
            };
        }
        BoundaryResult::Pending
    }

    pub fn is_consumed_button_up(&self, button: MouseButton) -> bool {
        self.active
            .as_ref()
            .is_some_and(|active| active.capture.has_consumed_button(button))
    }

    pub fn tick(&mut self, now: Instant) -> BoundaryResult {
        let expired = self
            .active
            .as_ref()
            .is_some_and(|active| now.duration_since(active.last_input_at) > timeout_for(active));
        if !expired {
            return if self.active.is_some() {
                BoundaryResult::Pending
            } else {
                BoundaryResult::Idle
            };
        }

        let mut active = self
            .active
            .take()
            .expect("expired boundary must still be active");
        if active.sequence.next_index() == 0 {
            if let Some(intent) = active.sequence.take_fallback() {
                return BoundaryResult::Complete {
                    intent: Box::new(intent),
                    hit: active.hit,
                    origin: active.origin,
                    consumed: active.capture.take_consumed(),
                    released_button: None,
                    released_buttons: active.capture.take_released_buttons(),
                };
            }
        }
        BoundaryResult::Cancelled {
            replay: active.capture.take_consumed(),
        }
    }

    pub fn cancel(&mut self) -> BoundaryResult {
        self.active
            .take()
            .map_or(BoundaryResult::Idle, |mut active| {
                BoundaryResult::Cancelled {
                    replay: active.capture.take_consumed(),
                }
            })
    }
}

fn boundary_token_to_input(token: &BoundaryToken) -> GestureInput {
    match token {
        BoundaryToken::Wheel { direction } => GestureInput::Wheel {
            direction: *direction,
        },
        BoundaryToken::Button { button } => GestureInput::Button {
            button: match button {
                super::config::BoundaryMouseButton::Left => super::config::GestureInputButton::Left,
                super::config::BoundaryMouseButton::Middle => {
                    super::config::GestureInputButton::Middle
                }
                super::config::BoundaryMouseButton::Right => {
                    super::config::GestureInputButton::Right
                }
                super::config::BoundaryMouseButton::X1 => super::config::GestureInputButton::X1,
                super::config::BoundaryMouseButton::X2 => super::config::GestureInputButton::X2,
            },
        },
        BoundaryToken::Stroke { direction } => GestureInput::Stroke {
            direction: *direction,
        },
    }
}

fn boundary_mouse_button(button: super::config::BoundaryMouseButton) -> MouseButton {
    match button {
        super::config::BoundaryMouseButton::Left => MouseButton::Left,
        super::config::BoundaryMouseButton::Middle => MouseButton::Middle,
        super::config::BoundaryMouseButton::Right => MouseButton::Right,
        super::config::BoundaryMouseButton::X1 => MouseButton::X1,
        super::config::BoundaryMouseButton::X2 => MouseButton::X2,
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
            enabled: true,
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

    fn config_with(intents: Vec<BoundaryIntent>) -> ConfigDocument {
        ConfigDocument {
            boundary_intents: intents,
            ..Default::default()
        }
    }

    #[test]
    fn empty_sequence_completes_on_activation() {
        let config = config_with(vec![intent("empty", vec![], 0)]);
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
    fn empty_sequence_is_a_timeout_fallback_for_a_longer_sequence() {
        let config = config_with(vec![
            intent("empty", vec![], 0),
            intent(
                "wheel",
                vec![BoundaryToken::Wheel {
                    direction: BoundaryWheelDirection::Forward,
                }],
                1,
            ),
        ]);
        let mut matcher = BoundaryMatcher::default();
        let t = Instant::now();

        assert_eq!(
            matcher.activate(
                &config,
                CornerEdgeHit::Corner(ScreenCorner::LeftTop),
                pt(),
                t,
            ),
            BoundaryResult::Pending
        );
        assert!(matches!(
            matcher.feed(
                BoundaryToken::Wheel {
                    direction: BoundaryWheelDirection::Forward,
                },
                Some(BoundaryReplay::Wheel { forward: true }),
                t,
            ),
            BoundaryResult::Complete { intent, .. } if intent.id == "wheel"
        ));

        assert_eq!(
            matcher.activate(
                &config,
                CornerEdgeHit::Corner(ScreenCorner::LeftTop),
                pt(),
                t,
            ),
            BoundaryResult::Pending
        );
        assert!(matches!(
            matcher.tick(
                t + BOUNDARY_IMMEDIATE_FALLBACK_TIMEOUT + Duration::from_millis(1)
            ),
            BoundaryResult::Complete { intent, .. } if intent.id == "empty"
        ));
    }

    #[test]
    fn matches_button_wheel_and_stroke_in_order() {
        let config = config_with(vec![intent(
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
        )]);
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
        assert_eq!(
            matcher.feed(
                BoundaryToken::Stroke {
                    direction: Direction::Down
                },
                None,
                t,
            ),
            BoundaryResult::Pending
        );
        assert!(matches!(
            matcher.release(MouseButton::Right),
            BoundaryResult::Complete { intent, consumed, .. }
                if intent.id == "sequence" && consumed.len() == 2
        ));
    }

    #[test]
    fn final_button_waits_for_release_before_completing() {
        let config = config_with(vec![intent(
            "button",
            vec![BoundaryToken::Button {
                button: BoundaryMouseButton::Right,
            }],
            0,
        )]);
        let mut matcher = BoundaryMatcher::default();
        let t = Instant::now();
        assert_eq!(
            matcher.activate(
                &config,
                CornerEdgeHit::Corner(ScreenCorner::LeftTop),
                pt(),
                t,
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
        assert!(matcher.is_waiting_for_button_up());
        assert_eq!(matcher.release(MouseButton::Left), BoundaryResult::Pending);
        assert!(matches!(
            matcher.release(MouseButton::Right),
            BoundaryResult::Complete {
                intent,
                released_button: Some(MouseButton::Right),
                consumed,
                ..
            } if intent.id == "button" && consumed.len() == 1
        ));
        assert!(!matcher.is_active());
    }

    #[test]
    fn boundary_sequence_waits_for_primary_button_after_secondary_release() {
        let config = config_with(vec![intent(
            "primary",
            vec![
                BoundaryToken::Button {
                    button: BoundaryMouseButton::Right,
                },
                BoundaryToken::Stroke {
                    direction: Direction::Down,
                },
                BoundaryToken::Button {
                    button: BoundaryMouseButton::Left,
                },
            ],
            0,
        )]);
        let mut matcher = BoundaryMatcher::default();
        let t = Instant::now();
        assert_eq!(
            matcher.activate(
                &config,
                CornerEdgeHit::Corner(ScreenCorner::LeftTop),
                pt(),
                t,
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
                BoundaryToken::Stroke {
                    direction: Direction::Down,
                },
                None,
                t,
            ),
            BoundaryResult::Pending
        );
        assert_eq!(
            matcher.feed(
                BoundaryToken::Button {
                    button: BoundaryMouseButton::Left,
                },
                Some(BoundaryReplay::Click {
                    button: MouseButton::Left,
                    pos: pt(),
                }),
                t,
            ),
            BoundaryResult::Pending
        );
        assert!(matcher.is_consumed_button_up(MouseButton::Left));
        assert_eq!(matcher.release(MouseButton::Left), BoundaryResult::Pending);
        assert!(matches!(
            matcher.release(MouseButton::Right),
            BoundaryResult::Complete {
                intent,
                released_button: Some(MouseButton::Right),
                released_buttons,
                ..
            } if intent.id == "primary" && released_buttons == vec![MouseButton::Left]
        ));
    }

    #[test]
    fn mismatch_and_timeout_return_only_previously_consumed_input() {
        let config = config_with(vec![intent(
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
        )]);
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
        let mut config = config_with(vec![intent("x", vec![], 0)]);
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

    #[test]
    fn disabled_boundary_intent_does_not_arm() {
        let mut disabled = intent(
            "disabled",
            vec![BoundaryToken::Wheel {
                direction: BoundaryWheelDirection::Forward,
            }],
            0,
        );
        disabled.enabled = false;
        let config = config_with(vec![disabled]);
        let mut matcher = BoundaryMatcher::default();

        assert_eq!(
            matcher.activate(
                &config,
                CornerEdgeHit::Corner(ScreenCorner::LeftTop),
                pt(),
                Instant::now(),
            ),
            BoundaryResult::Idle
        );
    }
}
