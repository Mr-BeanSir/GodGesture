# 后台应用分组与快照分页设计

日期: 2026-08-06

## 范围

本次处理两个跨端一致性问题:

1. Web Console 的只读配置页按同步文档中的应用分组展示应用，全局条目继续固定在最上方。
2. `GET /sync/snapshots` 改为有上限的页码分页，并同步 Web Console 与 Desktop 的快照调用和分页界面。

不在范围内:修改配置文档格式、改变快照留存策略、增加数据库表或索引、允许 Web Console 编辑配置、改变快照回滚语义。

## 配置分组展示

`ConfigDocument.groups` 与 `AppEntry.groupId` 已是配置 v7 的同步字段，Server 不需要新增存储结构。Web Console 从同一份 `PullConfigResponse.document` 派生只读分组树:

- 全局条目始终位于列表顶部，不属于任何分组。
- 分组按 `order` 升序排列；相同 `order` 时保留文档中的原始顺序。
- 组内应用按 `order` 升序排列；点击应用继续使用现有详情区。
- 应用引用不存在的 `groupId` 时不丢弃，在页面末尾的本地“未指派”分组中显示，便于诊断异常云端数据。
- 分组标题显示名称和应用数量；空分组仍显示。
- 页面保持只读，不增加折叠、拖拽、重命名或删除入口。

可见文案写入 Web Console 的 `zh-CN` 与 `en` locale。布局沿用现有 Element Plus 主题变量、边框和紧凑列表样式，不创建新的共享组件。

## 快照分页契约

shared 新增以下协议定义:

- `DEFAULT_SNAPSHOT_PAGE_SIZE = 10`
- `MAX_SNAPSHOT_PAGE_SIZE = 50`
- `ListSnapshotsQuery`: `page` 为正整数且默认 1；`pageSize` 为正整数、默认 10 且最大 50。查询字符串通过 Zod coercion 转换为数字。
- `ListSnapshotsResponse`: 保留 `snapshots`，增加 `page`、`pageSize`、`total`、`totalPages`。

请求超过最大 `pageSize` 时按现有 `validation_failed` 形式返回 400，不静默截断。响应页码由服务端规范化:总页数至少为 1；请求页超过末页时返回最后一页，空列表返回第 1 页。

## Server 查询

`SyncController.listSnapshots` 使用共享 `ListSnapshotsQuery` 校验完整查询对象。`SyncService.listSnapshots` 先统计当前用户快照总数，再计算规范化页码，并以版本倒序执行带 `skip`/`take` 的元数据查询。查询仍只返回快照元数据和设备名，不读取或返回配置正文。

分页不改变 ADR-0009 的留存边界:每用户最多保留最新 100 个快照且历史正文最多 64 MiB。分页最大 50 是单次响应边界，独立于留存数量。

OpenAPI 为 `GET /sync/snapshots` 声明查询参数并继续引用 shared 响应 schema；生成后的 `openapi.json` 和 `packages/shared/src/api/generated.ts` 一并更新。

## Web Console

快照 API 构造 `page` 和 `pageSize` 查询字符串并用 shared schema 校验响应。快照页维护当前页、每页数量和服务端总数:

- 初始加载第 1 页，每页 10 条。
- 页码改变时请求对应页；每页数量改变时回到第 1 页。
- 手动刷新回到第 1 页并同时刷新当前配置版本。
- 回滚成功或版本冲突后回到第 1 页，避免新快照插入后仍停留在旧页。
- 分页控件使用服务端 `total`，可选每页数量为 10、20、50。

## Desktop

Desktop 使用生成的 OpenAPI 客户端传递 query 参数。`CloudApi` 和 `CloudSyncEngine` 返回完整 `ListSnapshotsResponse`，账户 store 保存当前页快照、页码、页大小、总数和总页数。

账户页不再使用本地数组切片。页码或每页数量变化时调用 store 请求服务端；自动加载使用共享默认页大小。同步或回滚后刷新当前页，服务端会在页码越界时规范化到最后一页。退出登录或停止同步时清空快照及分页状态。

并发请求继续使用现有 generation 防止过期响应覆盖新状态。加载中触发的重复请求保持现有忽略策略。

## 错误处理

- 非法分页参数由 controller 的 Zod pipe 返回 400。
- Server 查询失败沿用现有异常过滤和认证行为。
- 客户端响应缺少分页元数据或字段非法时报告 `invalid_server_response`。
- Web Console 与 Desktop 请求失败时保留明确错误状态，不把空响应误判为成功页。
- 配置分组中的异常 `groupId` 仅影响只读归类，不修改云端文档。

## 测试与验收

### Shared 与 OpenAPI

- 查询 schema 应用默认值、接受合法字符串参数并拒绝非整数、非正数和超过 50 的 `pageSize`。
- 响应 schema 校验分页元数据。
- OpenAPI 的快照列表操作包含 `page`、`pageSize` 查询参数和 shared 响应引用。

### Server

- 服务按版本倒序使用正确 `skip`/`take`，返回设备名和分页元数据。
- 请求页超过末页时查询并返回最后一页；空列表返回第 1 页。
- controller 使用共享 query schema，最大页大小无法绕过。

### Web Console 与 Desktop

- Web Console build/typecheck 验证分组树和服务端分页调用。
- Desktop 同步引擎测试分页参数透传及完整响应。
- Desktop store 测试分页状态更新、重置和过期请求保护。
- Desktop typecheck/build 验证账户页不再本地切片。

### 基线

- 运行 shared、Server、Web Console、Desktop 受影响测试和 typecheck/build。
- 运行 `pnpm check:api` 与 `git diff --check`。
- `docs/PROJECT_STATUS.md` 记录后台分组展示、分页契约和验证结果。

## 架构影响

本设计不新增或修订 ADR。应用分组继续属于整库配置，快照分页只限制元数据列表读取，不改变 ADR-0009 的整库版本、乐观并发、后写胜出、快照留存和回滚模型，也不改变 ADR-0010 的本地优先与账户可选边界。
