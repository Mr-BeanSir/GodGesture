# Template Moderation Detail Design

## Goal

修复 Web Console 模板审核页的两个遗漏：把审核动作放进指定的 bordered header 区域，并把版本详情中的模板目标从 JSON 原文改为接近 `/config` 的按目标分组手势明细。明细中只展示审核需要的类型、名称、助记符和命令类型，不展示“已启用”状态。

同时统一模板族版本语义：更新已有模板必须继续使用同一个 `templateId`；公共目录每个模板族只展示最高版本号的已发布版本；新版本审核期间继续展示旧的已发布版本；新版本审核通过后自动切换到新版本。暂停发布属于父模板族，不修改任何版本状态，也不回退旧版本；恢复后重新展示该模板族最高的已发布版本。更新版本的 `title`、`tags` 和 `summary` 均由该版本自己的元数据决定。

## Scope

### In scope

- `GET /api/v1/admin/templates/versions/:id` 在保留 `targetSummaries` 的同时返回从不可变模板包解析出的 `targetDetails`。
- Server 通过 RustFS 服务端对象存储读取已保存的模板包，校验对象大小和 SHA-256 后再解析 `GestureTemplatePackage`。
- Web Console 审核操作区统一使用 `border-b border-[var(--gg-border)] px-5 py-3` header 布局，保留当前状态下合法的通过、驳回、下架和恢复操作及确认对话框。
- Web Console 版本详情按全局目标和应用目标分组，使用现有 `GestureMnemonic` 组件展示每条手势。
- 移除目标 JSON `<pre>` 和手势状态列；不把 `enabled`、`gesturingEnabled` 或 `inheritGlobalGestures` 渲染为“已启用”标签。
- 为 RustFS 读取、Server 详情映射和 Web Console 展示补充局部回归测试。

### Out of scope

- 不改变模板包协议、公共目录的 `targetSummaries`、模板审核状态机或审核权限。
- 为父模板族增加发布暂停时间字段和迁移；RustFS 中的不可变模板包仍是详情明细的唯一内容来源。
- 不在管理员页面提供模板内容编辑、上传、删除或下载行为变更。
- 不修改 Desktop、同步端点、模板投稿流程或其他 Web Console 页面。

## Architecture

### Server data flow

1. `TemplatesService.moderationDetail` 查询当前版本的不可变元数据和审核记录。
2. `RustFsService.readPackage` 读取 `objectKey` 指向的对象，并验证读取到的字节长度等于数据库记录的 `sizeBytes`、SHA-256 等于 `packageHash`。
3. `TemplatesService` 将校验后的 UTF-8 JSON 解析并通过 `GestureTemplatePackage` 校验；解析失败或对象完整性不一致时让详情请求进入现有错误态，不返回不可信明细。
4. 详情响应继续返回现有 `targetSummaries`，另返回原始模板目标组成的 `targetDetails`。`targetDetails` 使用现有 shared `GestureTemplateTarget` 协议类型，保留每条 intent 的 `name`、`gesture` 和 `command` 数据，前端只按需要读取其中的展示字段。

公共目录继续使用数据库中的 `targetSummaries`，因此不会因为审核详情变更而增大匿名目录响应或改变目录校验逻辑。目录查询以父 `templateId` 分组，每族只选最高 `versionNumber` 的 `published` 版本，并排除父模板族处于暂停状态的记录。详情、下载和举报读取遵循相同的父模板暂停边界。

审核队列查询父模板族而不是平铺版本，每族返回一行并默认指向最高版本；详情响应保留版本历史摘要供顶部版本选择器切换。暂停/恢复操作作用于父模板族，版本审核 `approve`/`reject` 仍然只作用于当前选中的不可变版本。

### Web Console layout

审核工作区继续保持 queue/detail/action rail 三个区域。在 action rail 内：

- 标题、不可编辑说明和当前合法动作放入一个 `header`。
- header 使用 `border-b border-[var(--gg-border)] px-5 py-3`，动作按钮使用现有 `AppButton` 和状态变体。
- 空选择状态保留标题和说明，未选择版本时不显示审核按钮。
- 窄屏仍按 queue、detail、action rail 顺序堆叠，按钮保持可触达尺寸。

版本详情新增一个可复用的本地组件 `TemplateTargetDetails.vue`：

- 每个 target 是一个按目标名称分组的无装饰区域；全局目标显示翻译后的“全局”，应用目标显示模板中的应用名称。
- 每个 target 内使用与 `ConfigView.vue` 相同的紧凑字段顺序：类型、名称、助记符、命令类型。
- 手势类型使用 `config.gestureKind`，助记符使用 `GestureMnemonic`，命令名称继续通过 `command.<type>` 的 i18n key 翻译。
- 不渲染 `enabled`、`gesturingEnabled`、`inheritGlobalGestures` 或状态 badge；这些字段可以留在服务端返回的协议对象中，但不会出现在审核详情 UI。
- 目标和手势列表保留完整数据；超长助记符和名称允许换行或在局部区域滚动，不使用 JSON 原文代替展示。

## API contract

`ModerationDetailSchema` 增加必填字段：

```ts
targetDetails: GestureTemplateTarget[]
```

字段结构与 `@godgesture/shared` 的 `GestureTemplateTarget` 完全一致，`targetSummaries` 保持原字段和语义不变。API 解析失败时沿用现有 `invalid_server_response` 错误处理；RustFS 对象读取或完整性校验失败时由详情请求的错误态提示管理员重试。

审核队列和审核详情响应增加 `templateSuspended` 与 `hasPublishedVersion`，用于区分父模板族暂停状态和当前版本状态。公共目录响应的 `id` 是父 `templateId`，版本号和元数据来自该族当前最高已发布版本。

## Error handling and security

- RustFS 对象读取必须在服务端完成，浏览器不直接请求 RustFS 签名 URL 来生成明细。
- 读取前后的对象大小和 hash 都校验；任何校验失败都不能静默使用数据库摘要拼出手势列表。
- 模板包 JSON 通过现有 `GestureTemplatePackage` 解析，禁止把任意未校验对象直接发送到 Web Console。
- 详情加载失败继续复用页面已有的错误提示和重试按钮；下载包链接仍使用现有签名 URL，不与明细读取路径混用。
- 不改变管理员鉴权和审核动作确认流程。

## Testing strategy

只运行受影响领域的局部验证：

- RustFS 单元测试：读取对象时成功返回已校验字节，大小、hash 或对象缺失时失败。
- Server 模板服务测试：审核详情读取并返回 `targetDetails`，同时保留 `targetSummaries` 和现有历史/审核记录。
- Web Console API schema 测试：合法 `targetDetails` 通过，缺失该字段或结构不合法时拒绝。
- `TemplateModerationView` 测试：审核动作挂在指定 header、目标名称和每条手势明细可见、命令类型和助记符可见、不再渲染 JSON `<pre>` 或“已启用”。
- `TemplatesService` 测试：模板族目录只返回最高已发布版本，审核队列按父模板族分组，暂停不改变任何版本状态，恢复后重新投影最高已发布版本。
- Web Console 类型检查和该视图测试；若 Server API DTO/OpenAPI 明确变更，再运行对应 API 合同检查，不运行无关全仓测试。

## Acceptance criteria

- 在 `http://127.0.0.1:5181/admin/templates` 选择待审核版本后，合法审核按钮位于带 `border-b border-[var(--gg-border)] px-5 py-3` 的操作 header 中。
- 版本详情按全局/App 目标显示每条模板手势的名称、助记符和命令类型。
- 页面不显示目标 JSON `<pre>`，不显示“已启用”列或状态 badge。
- RustFS 读取失败、包损坏或 API 数据缺失时显示可重试错误，而不是渲染半截数据。
- 更新版本审核期间公共目录仍可读取旧版本；更新版本通过后目录切换到新版本元数据；父模板族暂停时目录、详情、下载和举报均不可用，恢复后回到最高已发布版本。
- 既有审核确认、审核状态限制、举报处理和包下载行为不回归。
