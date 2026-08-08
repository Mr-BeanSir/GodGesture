# Server 承载官方公共手势模板目录，RustFS 保存不可变包

## 状态

已采纳；取代 ADR-0008 中“默认手势模板库由 GitHub 运行时分发”的部分。ADR-0008
关于 GitHub Releases 更新和官方在线插件目录/源码分发的结论继续有效。

## 背景

GitHub 静态目录要求投稿者熟悉仓库协作，所有模板元数据集中在单一 catalog 文件，且文件名
冲突会成为内容增长后的维护成本。产品需要让登录到官方端点的用户直接投稿，同时保留未登录
用户匿名浏览、预览、下载和采纳模板的能力。

## 决策

- 官方公共模板目录由固定官方 Server origin 匿名读取；自定义同步端点绝不提供目录读取或
  投稿接口。Desktop 仅在登录到官方端点时显示“提交到公共目录”，此操作不称为“同步”。
- PostgreSQL 保存模板 UUID、版本、审核状态、作者关系、配额、举报和匿名聚合下载指标。标题
  可以重复，不构成 URL 或存储对象键；模板不使用 `slug`。作者实时解析为
  `User.displayName.trim() || User.email`，不保存作者快照。
- RustFS 的 S3 兼容存储保存经 Server 规范化且不可变的模板 JSON。对象键只由 Server UUID 和
  内容哈希构成；客户端文件名、标题、摘要和其他用户文本不得进入对象键。
- 模板版本为不可变审核单元：作者可撤回，管理员可审核、拒绝、下架、恢复、处理举报和调整
  配额，但不能编辑已提交的内容。账户不提供注销或删除接口；禁用账户不可登录、关联 OAuth
  或投稿。
- 公共响应中的 `title`、`summary` 是已验证的单一普通字符串，不是本地化对象。UI 自身仍使用
  vue-i18n。模板命令和配置只引用 `pluginId`；安装时从固定
  `Mr-BeanSir/GodGesture-Plugins` 的 `main` 官方目录解析受启用的 `pluginId -> subdirectory`。
- 模板下载按日轮换 HMAC 的匿名标识去重，短期去重记录最多保留 48 小时，只保存聚合次数，
  不保存用户或设备下载历史。目录分页支持 `newest`、`downloads` 和 `trending` 排序。

## 后果

Server 的职责扩大到受审核的公共用户生成内容；生产部署除 PostgreSQL 外还必须提供内部
RustFS 服务和持久卷。模板 API、对象存储凭据、配额和审核操作必须走 Server 认证、验证、
审计及最小权限边界。GitHub `GodGesture-Templates` 不再是 Desktop 的运行时目录来源；它可作为
历史迁移素材，但不得继续定义公共模板协议或可见目录。

Server/Web Console 以私有子模块嵌入主工作区，RustFS 的 Docker Compose、环境变量和部署说明
在 Server 私有仓库中维护；其 Docker 构建上下文仍为主仓库根目录，原因见 ADR-0015。
