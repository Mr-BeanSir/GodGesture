# GodGesture Desktop

GodGesture Desktop 是 Tauri 2 应用：Rust 负责全局输入、手势引擎、原生覆盖层、
命令执行、凭据和更新；Vue 3 设置界面只通过 `src/api/backend.ts` 访问原生能力。

## 开发

从仓库根目录安装依赖并启动：

```powershell
pnpm install --frozen-lockfile
pnpm build:shared
pnpm dev:desktop
```

Vite/HMR 首选 `127.0.0.1:14200/14201`。`pnpm dev:desktop` 会在任一端口被占用
时自动选择下一组连续端口,并将同一地址传给 Tauri `devUrl`;它不会终止现有
Node/Cargo 或其他占用进程。完整 GodGesture 实例已存在时,新实例会退出并唤起
既有设置窗口。

只启动浏览器界面时：

```powershell
pnpm --filter @godgesture/desktop dev
```

浏览器模式使用内存后端，不会运行全局手势或写入原生配置。URL 添加
`?guide=1` 可强制打开快速入门，供确定性视觉验收使用。

## 配置

复制并按需填写 `.env.example` 中的环境变量。生产账户服务必须使用部署后的
HTTPS API 地址；Updater 和手势模板默认使用 `Mr-BeanSir` 名下的 GitHub
仓库，只有明确迁移仓库时才覆盖这些地址。

原生 Updater endpoint 可在编译时通过 `GODGESTURE_UPDATE_ENDPOINT` 覆盖，
但仍只接受不含凭据的 HTTPS URL。

## 验证

```powershell
pnpm --filter @godgesture/desktop test
pnpm --filter @godgesture/desktop typecheck
pnpm --filter @godgesture/desktop build
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets
```

不要对全仓运行 `cargo fmt`；只格式化实际修改的 Rust 文件。发布与安装说明见
`docs/DESKTOP_RELEASE.md`、`docs/MACOS_RELEASE.md` 和 `docs/USER_GUIDE.md`。
