# pnpm monorepo 承载桌面端、后端与共享协议包

云同步的配置 Schema 与 API 请求/响应类型在 Vue 前端与 NestJS 后端两侧都要使用。采用单仓库结构,使协议改动能在一次提交内原子式地同步两端:

```
GodGesture/
├─ apps/desktop    (Tauri: Rust + Vue 3)
├─ apps/server     (NestJS + PostgreSQL)
└─ packages/shared (同步协议、配置 Schema:TS 类型 + zod 校验)
```

放弃分仓方案(职责隔离更清晰、权限可独立管理),因为跨仓发布共享类型包的流程成本与版本漂移风险,对单人/小团队项目而言远大于收益。
