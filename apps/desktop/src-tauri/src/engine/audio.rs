use super::types::Modifier;

const MAX_VOLUME_STEPS: u32 = 20;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AudioVolumeAction {
    Mute,
    Up(u32),
    Down(u32),
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn signed_delta_controls_direction_without_a_wheel_modifier() {
        assert_eq!(audio_volume_action(Modifier::None, 7), AudioVolumeAction::Up(7));
        assert_eq!(audio_volume_action(Modifier::None, -7), AudioVolumeAction::Down(7));
    }

    #[test]
    fn zero_toggles_mute() {
        assert_eq!(audio_volume_action(Modifier::MiddleButtonDown, 0), AudioVolumeAction::Mute);
    }

    #[test]
    fn wheel_modifier_controls_direction_and_uses_magnitude() {
        assert_eq!(audio_volume_action(Modifier::WheelForward, -7), AudioVolumeAction::Up(7));
        assert_eq!(audio_volume_action(Modifier::WheelBackward, 7), AudioVolumeAction::Down(7));
    }

    #[test]
    fn step_count_is_bounded_for_untrusted_config() {
        assert_eq!(audio_volume_action(Modifier::None, i32::MAX), AudioVolumeAction::Up(20));
        assert_eq!(audio_volume_action(Modifier::None, i32::MIN), AudioVolumeAction::Down(20));
    }
}
