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
}
