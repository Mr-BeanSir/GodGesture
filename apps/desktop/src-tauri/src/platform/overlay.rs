use crate::engine::corners::BoundaryGuideFrame;
use crate::engine::types::Point;
use std::time::Duration;

#[cfg(test)]
use std::sync::Mutex;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TrailColors {
    pub main: u32,
    pub unrecognized: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OverlayCommand {
    SetBoundaryGuide(BoundaryGuideFrame),
    ClearBoundaryGuide,
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
    ShowLabelFeedback {
        origin: Point,
        text: String,
        fade_out: bool,
        display_duration: Option<Duration>,
        fade_duration: Option<Duration>,
    },
}

impl OverlayCommand {
    pub fn debug_kind(&self) -> &'static str {
        match self {
            Self::SetBoundaryGuide(_) => "set_boundary_guide",
            Self::ClearBoundaryGuide => "clear_boundary_guide",
            Self::Begin { .. } => "begin",
            Self::Grow(_) => "grow",
            Self::Recognized(_) => "recognized",
            Self::End => "end",
            Self::Cancel => "cancel",
            Self::ShowLabelFeedback { .. } => "show_label_feedback",
        }
    }
}

pub trait OverlaySink {
    fn send(&self, command: OverlayCommand);
}

pub fn show_label_feedback(
    sink: &impl OverlaySink,
    origin: Point,
    text: impl Into<String>,
    fade_out: bool,
    display_duration: Option<Duration>,
    fade_duration: Option<Duration>,
) {
    sink.send(OverlayCommand::ShowLabelFeedback {
        origin,
        text: text.into(),
        fade_out,
        display_duration,
        fade_duration,
    });
}

#[cfg(test)]
#[derive(Default)]
struct RecordingSink {
    commands: Mutex<Vec<OverlayCommand>>,
}

#[cfg(test)]
impl RecordingSink {
    fn commands(&self) -> Vec<OverlayCommand> {
        self.commands.lock().unwrap().clone()
    }
}

#[cfg(test)]
impl OverlaySink for RecordingSink {
    fn send(&self, command: OverlayCommand) {
        self.commands.lock().unwrap().push(command);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::corners::{BoundaryGuideFrame, CornerEdgeHit, ScreenCorner, ScreenRect};

    fn test_boundary_guide_frame() -> BoundaryGuideFrame {
        BoundaryGuideFrame {
            screen: ScreenRect {
                left: 0,
                top: 0,
                right: 1919,
                bottom: 1079,
            },
            area: ScreenRect {
                left: 0,
                top: 0,
                right: 100,
                bottom: 100,
            },
            region: CornerEdgeHit::Corner(ScreenCorner::LeftTop),
            dpi_scale_milli: 1000,
            alpha: 128,
        }
    }

    #[test]
    fn label_feedback_helper_sends_one_independent_command() {
        let sink = RecordingSink::default();
        show_label_feedback(
            &sink,
            Point { x: 10, y: 20 },
            "42%",
            true,
            Some(Duration::from_millis(500)),
            Some(Duration::from_millis(800)),
        );

        assert_eq!(
            sink.commands(),
            vec![OverlayCommand::ShowLabelFeedback {
                origin: Point { x: 10, y: 20 },
                text: "42%".into(),
                fade_out: true,
                display_duration: Some(Duration::from_millis(500)),
                fade_duration: Some(Duration::from_millis(800)),
            }]
        );
    }

    #[test]
    fn boundary_guide_commands_are_recordable_and_distinct() {
        let sink = RecordingSink::default();
        let frame = test_boundary_guide_frame();

        sink.send(OverlayCommand::SetBoundaryGuide(frame));
        sink.send(OverlayCommand::ClearBoundaryGuide);

        assert_eq!(
            sink.commands(),
            vec![
                OverlayCommand::SetBoundaryGuide(frame),
                OverlayCommand::ClearBoundaryGuide,
            ]
        );
    }

    #[test]
    fn overlay_command_debug_kind_is_stable() {
        let frame = test_boundary_guide_frame();
        let commands = [
            OverlayCommand::SetBoundaryGuide(frame),
            OverlayCommand::ClearBoundaryGuide,
            OverlayCommand::Begin {
                origin: Point { x: 1, y: 2 },
                colors: TrailColors {
                    main: 0xff00ff00,
                    unrecognized: 0xffff0000,
                },
                show_path: true,
                show_label: true,
                fade_out: true,
            },
            OverlayCommand::Grow(Point { x: 3, y: 4 }),
            OverlayCommand::Recognized(Some("match".into())),
            OverlayCommand::End,
            OverlayCommand::Cancel,
            OverlayCommand::ShowLabelFeedback {
                origin: Point { x: 5, y: 6 },
                text: "label".into(),
                fade_out: true,
                display_duration: None,
                fade_duration: None,
            },
        ];

        let kinds = commands
            .iter()
            .map(OverlayCommand::debug_kind)
            .collect::<Vec<_>>();

        assert_eq!(
            kinds,
            vec![
                "set_boundary_guide",
                "clear_boundary_guide",
                "begin",
                "grow",
                "recognized",
                "end",
                "cancel",
                "show_label_feedback",
            ]
        );
    }
}
