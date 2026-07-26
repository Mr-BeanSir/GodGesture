# GodGesture

跨平台(Windows + macOS)全局鼠标手势工具,[WGestures](https://github.com/yingDev/WGestures) 的精神续作:保留其全部功能,新增账户体系与多设备云同步。

- 桌面端:Tauri 2(Rust 手势引擎 + Vue 3 设置界面)
- 后端:NestJS + Prisma + PostgreSQL(自托管,1Panel 部署)
- 更新与手势模板:GitHub Releases / 独立模板仓库分发

## 仓库结构

```
apps/desktop     Tauri 桌面端(Rust 核心 + Vue 3 + TS 设置界面)
apps/server      同步后端(NestJS + Prisma + PostgreSQL)
packages/shared  共享协议:配置 Schema、同步/认证 API 类型(zod)
docs/adr         架构决策记录(ADR)
docs/ROADMAP.md  里程碑路线图
CONTEXT.md       领域术语表(唯一词汇表,先读它)
```

## 开发

前置:Node ≥ 22、pnpm ≥ 10、Rust stable、(Windows)WebView2 运行时。

```bash
pnpm install
pnpm build:shared      # 构建共享协议包
pnpm dev:desktop       # 桌面端开发(tauri dev)
pnpm dev:server        # 后端开发(nest --watch)
```

后端本地依赖(PostgreSQL)用 Docker 启动(见 apps/server 里的 compose 文件,M5 起提供)。

## 文档约定

- 领域词汇以 `CONTEXT.md` 为准;代码、UI 文案、文档中的命名不得与术语表冲突。
- 硬决策(平台范围、技术栈、同步模型等)记录在 `docs/adr/`,新增决策按序号递增。
