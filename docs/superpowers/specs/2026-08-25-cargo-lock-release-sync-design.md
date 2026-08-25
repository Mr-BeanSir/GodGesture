# Cargo.lock 发布同步设计

## 目标

修复 Desktop 发布流程，使 release-it 更新 `Cargo.toml` 后立即由一次不带
`--locked` 的 Cargo 命令同步 `Cargo.lock`，并让 Windows/macOS CI 使用
`--locked` 构建和验证，从而保证版本一致和构建可复现。

## 范围与约束

- 不改写已经发布的 `v0.2.6` commit 或 tag。
- 在本次普通修复提交中把当前 `Cargo.lock` 的根包版本从 `0.2.5` 同步到
  当前 `Cargo.toml` 的 `0.2.6`，使主线立即满足新的 locked CI 契约。
- Server 子模块、共享协议、数据库 schema 和 migration 不在范围内。
- Windows 与 macOS 的发布工作流保持同一版本和同一 Cargo 锁定策略。

## 设计

### 发布顺序

`.release-it.json` 在 bumper 完成版本文件更新后执行 `after:bump` hook：

```text
release-it bumper 更新 package.json、Desktop package.json、tauri.conf.json、Cargo.toml
    -> cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml --lib
    -> Cargo 更新 apps/desktop/src-tauri/Cargo.lock
    -> release-it git release 提交所有发布变更并创建 tag
```

该 Cargo 命令刻意不带 `--locked`，因为它的职责是允许锁文件同步；发布 commit
因此会同时包含 `Cargo.toml` 和 `Cargo.lock`。Server 与其他独立 package 版本仍不参与
Desktop release。

### CI 锁定

所有 workflow 中显式调用的 `cargo test`、`cargo check` 和 `cargo clippy` 增加
`--locked`。Tauri CLI 没有独立的 lockfile 开关，但其额外参数会转发给 Cargo runner，
所以两个发布构建命令使用：

```text
tauri build ... -- --locked
```

这样构建过程中任意需要更新锁文件的依赖解析都会失败，而不会在 CI 中静默改写锁文件。

### 验证与文档

- 发布契约测试检查 `after:bump` hook 的精确 Cargo 命令。
- 发布契约测试检查 Windows 发布 Rust 测试、Windows/macOS CI 的 Cargo 命令和 Tauri
  构建命令均包含正确的 `--locked` 位置。
- `docs/DESKTOP_RELEASE.md` 记录新的五项版本/锁文件同步流程和 CI 约束。
- `docs/PROJECT_STATUS.md` 记录当前锁文件基线和验证结果；不新增术语，因此不修改
  `CONTEXT.md`。

## 错误处理

- 如果 `Cargo.toml` 或依赖发生需要锁文件更新的变化，发布 hook 的不带 `--locked`
  Cargo 命令负责生成更新后的锁文件；命令失败则 release-it 不进入 commit/tag 阶段。
- 后续 CI 的 `--locked` 命令在锁文件缺失、版本不一致或依赖未锁定时失败，阻止发布构建。
- 当前 `v0.2.6` 锁文件同步作为独立工作区变更验证，不触碰历史 tag。

## 验收

- 发布配置契约测试先在旧配置上失败，再在新配置上通过。
- `Cargo.lock` 根 `godgesture` package 版本为 `0.2.6`。
- 发布契约测试、`pnpm validate:release`、`cargo check --lib --locked` 和
  `git diff --check` 通过。
- 变更后请求代码审查，并只在新鲜验证通过后报告完成。
