//! GodGesture 手势引擎 —— 平台无关核心。
//! 平台层(hook/输入合成/窗口查询/覆盖层)在 crate::platform。

pub mod config;
pub mod corners;
pub mod intents;
pub mod parser;
pub mod runtime;
pub mod script;
pub mod tracker;
pub mod types;
