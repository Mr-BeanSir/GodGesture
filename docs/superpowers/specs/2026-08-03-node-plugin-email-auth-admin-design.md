# Node 插件编辑器与邮箱认证/管理员端设计草案

状态：**历史设计草案，非现役实现合同。**其中 Desktop 插件编辑器、Monaco 和旧生命周期
内容已被 `docs/superpowers/specs/2026-08-04-filesystem-plugin-workspace-design.md` 与
ADR-0012 的文件系统工作区修订取代；邮箱认证和管理员端的当前实现状态以
`docs/PROJECT_STATUS.md` 及现行代码为准。本文保留历史方案和验收背景，不作为当前插件开发入口。

## 1. 目标与范围

本任务拆成两个并行子任务：

1. **Desktop app 子任务**：优化 Node.js 插件命令编辑体验，补齐插件模板和生命周期示例，修复当前 TypeScript 诊断中的 `index.mjs:1:31 Parameter 'context' implicitly has an 'any' type`。
2. **后台子任务**：注册增加邮箱验证码校验，增加邮箱找回密码流程，并补齐管理员端。管理员端与认证改动共享用户角色、权限守卫和 Web Console，因此暂不另开第三个子任务；实现中若后台工作量超过一个可审查变更，再拆分独立提交。

不在范围内：更换 OAuth 提供商、长连接通知、服务端保存插件源码、修改原生覆盖层或 Node 宿主安全边界、依赖 WGestures 行为推导新需求。

## 2. 当前实现依据

- `apps/desktop/src/components/NodePluginEditor.vue` 当前把插件下拉框、新建按钮、插件名称和导出名都放在同一编辑区域；新建按钮高度未与选择框固定对齐。
- `packages/shared/src/config/plugins.ts` 只有最小 `execute(context)` 默认源码；`docs/SCRIPTING.md` 已定义五个生命周期：`init`、`execute`、`gestureRecognized`、`modifierTriggered`、`gestureEnded`。
- Node 类型检查链路已经存在，但默认源码未显式引入 `PluginContext`/类型辅助，因此裸参数会触发隐式 `any` 诊断。
- `apps/server/src/auth/auth.service.ts` 当前注册直接创建用户，不验证邮箱；登录、OAuth 和设备令牌已经存在。
- Prisma `User` 当前没有角色、邮箱验证状态或密码重置凭据模型；Web Console 目前只有普通用户控制台路由。

相关约束：ADR-0001（Windows/macOS 同版本交付）、ADR-0002/0003（pnpm monorepo 与现有技术栈）、ADR-0008（Server 只存用户数据）、ADR-0012（Node.js 是唯一脚本运行时）。

## 3. 推荐设计

### 3.1 Desktop 插件选择栏与编辑窗口

在 `CommandEditor`/`NodePluginEditor` 的 Node.js 插件分支中保留下拉选择作为轻量选择器：

- “新建插件”按钮与 `el-select` 使用相同的 `size`、`height` 和垂直对齐规则；窄宽度下允许换行，不产生横向溢出。
- 增加“编辑插件”按钮。按钮只负责打开一个独立的插件编辑窗口（推荐使用现有 Element Plus Dialog/Drawer 组合，保持工作台内上下文，不新开原生 WebView）。
- 插件名称、入口文件、导出名、源文件、`package.json`、lockfile、依赖准备、类型检查、测试、Problems/Output 和生命周期脚本开关全部移动到编辑窗口；主命令编辑区仅显示当前插件选择、编辑入口和导出函数摘要。
- 编辑窗口关闭时保留草稿；只有显式保存/确认才提交到配置 store。取消应恢复打开前快照，避免半编辑状态进入同步文档。
- 复用现有 `NodePluginEditor` 的 Monaco model 保留、依赖缓存状态、结构化 diff 和 typecheck IPC，不改变 Node 宿主协议。

### 3.2 插件模板与类型诊断

新增一个共享的默认模板常量，供“新建插件”和空配置迁移共同使用。模板至少包含：

- `index.mjs`：导入 `defineHandler` 与 `PluginContext` 类型，给 `context` 明确标注类型；导出五个生命周期函数。
- `init(context)`：报告初始化状态。
- `execute(context)`：执行无副作用的示例（状态输出或 dry-run 可观察动作）。
- `gestureRecognized(context)`：展示识别阶段信息。
- `modifierTriggered(context)`：展示修饰符信息。
- `gestureEnded(context)`：展示生命周期结束信息。

每个函数上方写简短中英双语可翻译注释或使用英文代码注释，解释触发时机和可安全调用的 API；界面文案仍全部走 `vue-i18n`。模板应避免真实副作用，点击“测试处理函数”能在 Output 中看到稳定结果。

类型方案优先复用随包 SDK 声明：`PluginContext` 作为 `import type`，`defineHandler<PluginContext>` 作为处理函数包装器；若当前 SDK 类型导出不支持泛型，则在共享类型声明中补充最小导出并同步所有消费者。必须新增回归测试，确保模板通过 typecheck 且不再产生隐式 `any`。

### 3.3 邮箱验证码注册

采用一次性验证码记录模型，不把验证码明文落库：

- `POST /auth/email-verification/request`：输入邮箱和用途（`register`/`reset_password`），生成 6 位数字验证码，保存哈希、过期时间、尝试次数、发送冷却时间和用途；响应不泄露邮箱是否已存在。
- 邮件发送采用通用 SMTP 适配器。SMTP 主机、端口、用户名、密码、TLS、发件人和验证码有效期/冷却/每日上限只作为环境变量，在 `.env.example` 说明；开发/测试使用内存或日志适配器，不发送真实邮件。外部凭证不得进入代码或文档。
- `POST /auth/register` 新增 `verificationToken`/`verificationCode` 语义（推荐提交服务端签发的一次性 verification ticket，而不是再次传递明文验证码）；只有验证码校验成功且未过期才创建密码账户并标记 `emailVerifiedAt`。
- 验证码校验失败、过期、重放、超过尝试次数返回稳定错误码；请求和校验均受独立速率限制，响应使用统一错误结构。
- OAuth 账户继续沿用提供商已验证邮箱语义；密码账户注册必须完成邮箱验证，不改变 OAuth 登录流程。

### 3.4 找回密码

- `POST /auth/password-reset/request`：无论邮箱是否存在都返回相同成功响应；对存在的密码账户发送一次性重置链接/票据，使用哈希落库、短时过期、单次消费和速率限制。
- `POST /auth/password-reset/confirm`：提交重置票据和新密码，验证成功后更新 Argon2id 哈希，撤销该用户全部刷新令牌/设备会话，并使票据立即失效。
- Web Console 登录页新增“忘记密码”视图；注册视图增加“发送验证码”和验证码输入，发送按钮显示冷却倒计时；所有中英文文案走 locale。
- Desktop 账户页继续通过同步端点打开 Web Console 的认证入口，不在桌面端复制密码重置逻辑。

### 3.5 管理员端

采用最小 RBAC：

- `User.role` 枚举至少包含 `user`、`admin`；首个管理员通过部署环境提供的一次性 bootstrap 邮箱或受保护 CLI/迁移脚本设置，禁止公开注册成为管理员。
- Server 增加管理员守卫和 `/admin/*` API：分页查看用户、查看邮箱验证/最近登录状态、禁用/启用账户、撤销账户全部会话、重置邮箱验证状态。默认不提供读取密码哈希、插件源码或配置正文的 API，符合 ADR-0008。
- Web Console 增加管理员导航和页面，普通用户路由守卫不能访问；管理员操作写入最小审计日志（操作者、目标、动作、时间、结果），日志只存用户数据和操作元信息。
- 管理员 API 使用独立速率限制、显式权限测试和前端错误态；不新增独立前端应用，复用现有 ConsoleLayout/Element Plus 设计系统。

## 4. 协议与数据模型影响

需要同步修改 `packages/shared`、Server OpenAPI/generated client、Web Console API 客户端及所有消费方：

- 新增邮箱验证码请求/响应、注册请求字段、密码重置请求/响应、稳定错误码。
- `MeResponse` 增加 `role` 与 `emailVerified`（或等价显式字段）。
- Prisma 新增 `EmailVerificationCode`、`PasswordResetToken`、`User.role`、`User.emailVerifiedAt` 及必要索引/唯一约束；迁移必须可回滚并补种子/测试 fixture。
- OpenAPI 文档和生成文件必须与 Zod 协议同提交，运行 `pnpm check:api`。

## 5. 错误处理与安全要求

- 邮件请求接口防枚举：注册/重置请求不暴露账户存在性；实际发送失败记录脱敏结构化日志并返回稳定通用错误。
- 验证码和重置票据使用随机值哈希、过期、单次消费、尝试次数上限、IP/邮箱双维度限流；日志禁止邮箱验证码、重置 token、密码和 refresh token。
- 管理员端所有写操作要求 JWT + `role=admin`，并记录审计事件；账户禁用后登录、刷新和 OAuth 账户交换均拒绝。
- 遵循 Windows/macOS 同版本交付：插件 UI 在桌面两平台共享实现；邮箱/管理员功能属于 Server/Web Console，Desktop 只验证入口跳转。

## 6. 验收与测试门槛

### app 子任务

- Desktop Vue 单测覆盖：选择栏/按钮等高、打开/取消/保存编辑窗口、创建模板文件集合、五个生命周期导出、模板 typecheck 无 `implicit any`。
- 浏览器预览至少检查 `980x700`、`800x560` 中英文和浅/深色，确认无横向溢出、按钮可达、编辑窗口滚动责任唯一。
- `pnpm --filter @godgesture/desktop test`、typecheck、build、`git diff --check`；若触及 shared，补 shared test/typecheck/build。

### 后台子任务

- Server 单测覆盖验证码生成/哈希/过期/重放/限流、注册门槛、密码重置后会话撤销、管理员守卫和审计日志。
- API/OpenAPI 合同测试与 `pnpm check:api`；Prisma 迁移在空库和已有用户库上验证。
- Web Console 单测/组件测试覆盖注册验证码倒计时、找回密码、管理员权限与错误态；typecheck/build。
- SMTP 仅用测试适配器验证调用参数，真实 SMTP 凭证不进入仓库。

## 7. 任务拆分与提交边界

- `app_task`：Desktop Vue、shared Node 插件模板/类型导出、相关测试与 `CONTEXT.md`/`docs/PROJECT_STATUS.md` 更新。
- `backend_task`：Server Prisma/Auth/Admin、OpenAPI/shared auth 协议、Web Console 认证与管理员页面、相关测试与文档更新。
- 两个子任务先分别产出审计意见和实现计划；审计批准后再编码。每个领域显式 `git add <path>`，英文 commit message，不自动 push。

## 8. 待维护者确认

1. 是否采用通用 SMTP 环境变量 + 开发日志适配器的邮件方案（当前推荐）。
2. 管理员端是否接受“复用 Web Console、最小 RBAC、只管理账户元数据与会话”的范围；不读取用户配置正文。
3. 注册流程是否接受“服务端一次性 verification ticket”而不是让验证码明文在注册请求中长期传递。

维护者已确认本草案，允许按上述边界实施；实际实现中保留了现有工作区改动并按领域验证。
