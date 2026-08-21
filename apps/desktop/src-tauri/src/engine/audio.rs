use super::config::Locale;
use super::types::Modifier;

const MAX_VOLUME_STEPS: u32 = 20;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AudioVolumeAction {
    Mute,
    Up(u32),
    Down(u32),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AudioVolumeState {
    Muted,
    Percent(u8),
}

impl AudioVolumeState {
    pub fn from_scalar(muted: bool, scalar: f32) -> Self {
        if muted {
            return Self::Muted;
        }

        let scalar = if scalar.is_nan() {
            0.0
        } else {
            scalar.clamp(0.0, 1.0)
        };
        Self::Percent((scalar * 100.0).round() as u8)
    }
}

pub fn resolve_feedback_locale(configured: Locale, system: Locale) -> Locale {
    match configured {
        Locale::Auto => system,
        locale => locale,
    }
}

pub fn format_volume_feedback(state: AudioVolumeState, locale: Locale) -> String {
    let locale = match locale {
        Locale::Auto => Locale::En,
        locale => locale,
    };

    match state {
        AudioVolumeState::Muted => match locale {
            Locale::ZhCn => "静音".to_string(),
            Locale::En | Locale::Auto => "Muted".to_string(),
        },
        AudioVolumeState::Percent(percent) => format!("{percent}%"),
    }
}

pub fn audio_volume_action(modifier: Modifier, delta: i32) -> AudioVolumeAction {
    if delta == 0 {
        return AudioVolumeAction::Mute;
    }
    let steps = delta.unsigned_abs().min(MAX_VOLUME_STEPS);
    match modifier {
        Modifier::WheelForward => AudioVolumeAction::Up(steps),
        Modifier::WheelBackward => AudioVolumeAction::Down(steps),
        _ if delta > 0 => AudioVolumeAction::Up(steps),
        _ => AudioVolumeAction::Down(steps),
    }
}

/// Convert a percentage-point action into the exact endpoint scalar. Round the current
/// scalar first so values such as 0.49999997 behave like the 50% shown by the system UI.
pub fn target_volume_scalar(current: f32, action: AudioVolumeAction) -> Option<f32> {
    let delta = match action {
        AudioVolumeAction::Mute => return None,
        AudioVolumeAction::Up(points) => points as f32,
        AudioVolumeAction::Down(points) => -(points as f32),
    };
    let current_percent = (current.clamp(0.0, 1.0) * 100.0).round();
    Some((current_percent + delta).clamp(0.0, 100.0) / 100.0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::config::Locale;

    #[test]
    fn signed_delta_controls_direction_without_a_wheel_modifier() {
        assert_eq!(
            audio_volume_action(Modifier::None, 7),
            AudioVolumeAction::Up(7)
        );
        assert_eq!(
            audio_volume_action(Modifier::None, -7),
            AudioVolumeAction::Down(7)
        );
    }

    #[test]
    fn zero_toggles_mute() {
        assert_eq!(
            audio_volume_action(Modifier::MiddleButtonDown, 0),
            AudioVolumeAction::Mute
        );
    }

    #[test]
    fn wheel_modifier_controls_direction_and_uses_magnitude() {
        assert_eq!(
            audio_volume_action(Modifier::WheelForward, -7),
            AudioVolumeAction::Up(7)
        );
        assert_eq!(
            audio_volume_action(Modifier::WheelBackward, 7),
            AudioVolumeAction::Down(7)
        );
    }

    #[test]
    fn step_count_is_bounded_for_untrusted_config() {
        assert_eq!(
            audio_volume_action(Modifier::None, i32::MAX),
            AudioVolumeAction::Up(20)
        );
        assert_eq!(
            audio_volume_action(Modifier::None, i32::MIN),
            AudioVolumeAction::Down(20)
        );
    }

    #[test]
    fn endpoint_scalar_changes_by_exact_percentage_points() {
        assert_eq!(
            target_volume_scalar(0.5, AudioVolumeAction::Up(1)),
            Some(0.51)
        );
        assert_eq!(
            target_volume_scalar(0.5, AudioVolumeAction::Down(1)),
            Some(0.49)
        );
        assert_eq!(
            target_volume_scalar(0.995, AudioVolumeAction::Up(20)),
            Some(1.0)
        );
        assert_eq!(
            target_volume_scalar(0.004, AudioVolumeAction::Down(20)),
            Some(0.0)
        );
        assert_eq!(target_volume_scalar(0.5, AudioVolumeAction::Mute), None);
    }

    #[test]
    fn final_audio_state_clamps_and_rounds_percent() {
        assert_eq!(
            AudioVolumeState::from_scalar(false, -0.2),
            AudioVolumeState::Percent(0)
        );
        assert_eq!(
            AudioVolumeState::from_scalar(false, 0.424),
            AudioVolumeState::Percent(42)
        );
        assert_eq!(
            AudioVolumeState::from_scalar(false, 1.4),
            AudioVolumeState::Percent(100)
        );
        assert_eq!(
            AudioVolumeState::from_scalar(true, 0.75),
            AudioVolumeState::Muted
        );
    }

    #[test]
    fn final_audio_state_formats_for_each_locale() {
        assert_eq!(
            format_volume_feedback(AudioVolumeState::Muted, Locale::ZhCn),
            "静音"
        );
        assert_eq!(
            format_volume_feedback(AudioVolumeState::Muted, Locale::En),
            "Muted"
        );
        assert_eq!(
            format_volume_feedback(AudioVolumeState::Percent(42), Locale::En),
            "42%"
        );
        assert_eq!(
            resolve_feedback_locale(Locale::Auto, Locale::ZhCn),
            Locale::ZhCn
        );
    }
}
