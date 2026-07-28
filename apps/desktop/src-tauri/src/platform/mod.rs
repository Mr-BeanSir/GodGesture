//! 平台层 —— 每个平台实现 PlatformServices + 原生输入钩子。

#[cfg(windows)]
pub mod windows;

#[cfg(target_os = "macos")]
pub mod macos;

#[cfg(windows)]
pub use windows as current;
#[cfg(windows)]
pub use windows::WindowsPlatform as CurrentPlatform;

#[cfg(target_os = "macos")]
pub use macos as current;
#[cfg(target_os = "macos")]
pub use macos::MacPlatform as CurrentPlatform;
