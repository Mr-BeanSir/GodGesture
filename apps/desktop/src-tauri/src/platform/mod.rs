//! 平台层 —— 每个平台实现 PlatformServices + 钩子安装。
//! macOS 实现(CGEventTap)在 M4 落地。

#[cfg(windows)]
pub mod windows;

#[cfg(windows)]
pub use windows::WindowsPlatform as CurrentPlatform;
