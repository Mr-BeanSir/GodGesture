# 作者模板生命周期与投稿向导设计

## 目标

补齐官方模板的作者生命周期管理，并把 Desktop 的模板导出/投稿整理为明确的两步向导：用户先选择
交付目的，再填写模板信息、选择手势和提交方式。Web Console 增加“我提交的模板”页面，作者可以查看
版本状态、撤回已发布模板和删除不再使用的被驳回/已撤回模板。

## 已确认规则

- 被驳回的模板允许提交新的不可变版本并重新审核。
- 撤回只允许作用于通过审核的模板，即模板族至少存在一个 `published` 版本。
- 撤回后公共目录不展示该模板族，但保留模板父 ID，后续可以向同一模板族提交新版本。
- Web 端提供作者模板列表，并允许合法的删除和撤回操作。
- 每个模板族只保留版本号最大的 50 个版本，超过部分及关联 RustFS 对象删除。
- 不编辑任何已投稿版本；更新始终是提交新版本。

## 架构

现有 PostgreSQL `Template`、`TemplateVersion`、审核、举报、下载去重和指标表已经能够表达这套状态机，
不增加数据库字段。新增作者列表响应使用 `packages/shared` 的 Zod 协议，Server 通过认证接口返回模板父
状态和版本摘要；Desktop 与 Web Console 都消费同一响应。OpenAPI 文档由 Server 作为唯一来源重新生成，
随后同步 `packages/shared/src/api/generated.ts`。

创建新版本时，Server 在 `submitVersion` 的交互式事务中锁定父模板，重新计算下一个版本号，写入版本，
按 `versionNumber DESC` 保留前 50 条，并删除旧版本的 `TemplateReview`、`TemplateReport`、下载去重、
每日指标和版本记录。事务提交后逐个尽力删除旧 RustFS 对象；对象清理失败不影响新版本响应。

作者操作的状态边界如下：

| 父模板当前版本集合 | Desktop 可更新 | Web 可撤回 | Web 可删除 |
| --- | --- | --- | --- |
| 含 `published` | 是 | 是 | 否 |
| 仅 `rejected` / `withdrawn` | 是 | 否 | 是 |
| 含 `pending_review` 且无发布版本 | 否 | 否 | 否 |
| 含 `suspended` 且无发布版本 | 否 | 否 | 否 |

父状态仍按 ADR-0014 的投影优先级计算；目录和下载继续直接检查版本状态。撤回时只把
`pending_review`、`published`、`rejected` 转为 `withdrawn`，保留下架版本的管理员治理状态。删除前 Server
在事务内重新读取状态并锁定父行，不能依赖前端按钮是否显示。

## REST 合同

新增 `OwnedTemplateListResponse`：

```ts
{
  templates: Array<{
    id: string;
    status: "pending_review" | "published" | "rejected" | "withdrawn" | "suspended";
    versions: Array<{
      id: string;
      versionNumber: number;
      title: string;
      summary: string;
      status: "pending_review" | "published" | "rejected" | "withdrawn" | "suspended";
      submittedAt: string;
      publishedAt: string | null;
    }>;
  }>;
}
```

版本数组最多 50 项且按版本号倒序。Desktop 只需要父 ID、最新版本号和状态来渲染“更新已有模板”选择；
Web 使用版本摘要展示审计时间线。错误码使用现有 HTTP 错误结构，新增：

- `template_withdrawal_requires_published`
- `template_delete_not_allowed`
- `template_update_not_allowed`

## Desktop 向导

`GestureExportDialog` 保持单个固定尺寸对话框，顶部增加当前步骤指示。Step 1 使用两个等宽、带图标和
说明文字的单选卡片：

- `提交到服务器`：将手势模板提交到服务器，所有用户均可访问使用。
- `导出 JSON`：将手势导出为 JSON 文件，可以发送给任何人导入软件。

Step 2 保留现有标题、摘要、标签和手势目标选择。选择服务器时，在元数据区上方增加同样采用单选卡片
的提交方式：

- `提交新的模板`：创建新的模板族。
- `更新已有模板`：展示当前账户模板列表；已发布、被驳回和已撤回可选，待审核和被管理员下架只读展示并
  禁用选择，同时给出状态说明。

选择服务器模式后，底部主按钮进入现有复核对话框；复核页新增提交类型和目标版本信息。确认时根据模式
调用 `submitPublicTemplate(package)` 或 `submitPublicTemplateVersion(templateId, package)`。JSON 模式
直接使用现有 Tauri 保存或浏览器下载流程。标题与标签字段间距改为紧凑值，左右元数据列通过 stretch
保持等高，摘要 textarea 不再把左列撑成不一致高度。

## Web Console 页面

新增登录用户导航项“我提交的模板”和 `/templates` 路由，使用 `PackageOpen` 图标，位于配置/设备等普通
用户功能区域内，不放入管理员区域。页面使用 `max-w-[1120px]` 的密集工作面：顶部显示标题、版本保留
说明和刷新按钮；主体以模板族为行/卡片，左侧显示标题、最新版本号和版本数量，中间显示最新版本摘要和
更新时间，右侧显示父状态与操作。

- 已发布：显示绿色状态和“撤回”按钮，打开警示确认对话框。
- 被驳回/已撤回：显示对应状态和“删除”按钮，打开不可逆删除确认对话框；页面说明可以在 Desktop
  重新投稿同一模板族。
- 待审核/已下架：只显示状态和不可操作提示。

展开模板族后显示最多 50 个版本的紧凑时间线，展示版本号、状态、投稿时间和发布时间；不提供编辑入口。
所有文案只进入 Web Console `zh-CN` locale，操作使用共享 `AppDialog`、`AppButton`、`AppBadge` 和 Toast。

## 错误处理与并发

所有作者操作在服务端二次授权并在事务中重读状态。撤回、删除与提交新版本竞争时，父模板行锁保证不会
把已发布或下架状态误判为可删除。提交成功后刷新作者列表；失败保留页面状态并显示可翻译错误。RustFS
对象删除使用 best-effort 补偿，数据库提交错误仍按现有投稿逻辑清理新上传对象。

## 验证

只运行受影响范围的测试：Shared 模板协议；Server 模板服务、控制器和 OpenAPI 检查；Desktop 导出向导
测试；Web Console 作者模板 API、路由/导航和页面测试；相关 Server/Web/Desktop 类型检查。按用户要求不运行
仓库全量测试，不做长时间集成数据库测试。手动验收入口为 Desktop 导出模板弹窗和 Web `/templates` 页面，
重点验证被驳回重新投稿、已发布撤回、已撤回重新投稿、非法删除被拒绝以及第 51 个版本清理。

