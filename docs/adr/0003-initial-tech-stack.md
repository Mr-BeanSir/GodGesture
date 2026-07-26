# 初始技术栈选型

这些选择都带有可观的更换成本(约一个季度级别),故记录一次拍板结果与理由:

- **桌面壳:Tauri 2**(需求给定)—— Rust 核心承载手势引擎与平台交互,WebView 只做设置界面。
- **设置界面:Vue 3 + TypeScript + Vite**——表单密集型界面,取开发效率与中文社区生态;状态管理 Pinia。
- **后端:NestJS(TypeScript)**——模块/DI/Guard 体系满足认证与权限的结构化需要,官方 OpenAPI 集成成熟。
- **数据访问:Prisma + PostgreSQL**——Schema 声明式建模与迁移工具链最省心;复杂查询可用 $queryRaw 逃生。
- **API 风格:REST + OpenAPI**——由 @nestjs/swagger 生成文档,再生成类型安全 TS 客户端进 packages/shared;实时推送另配 WebSocket/SSE 通道,不改变主协议风格。

放弃项:React/Svelte(无决定性优势)、Fastify/Hono/Express 裸框架(结构自建成本)、TypeORM(维护势头弱)、tRPC(与 NestJS 不合、非 TS 客户端接入难)、GraphQL(实体少、形状固定,复杂度不划算)。
