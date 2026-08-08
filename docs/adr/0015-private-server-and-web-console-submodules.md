# 私有 Server 和 Web Console 仓库以子模块嵌入工作区

## 状态

已采纳，取代 ADR-0002 中 `apps/server` 与 `apps/web-console` 必须由主仓库直接追踪
的部分；ADR-0002 关于 pnpm 工作区和共享协议的结论仍然有效。

## 背景

Server 与 Web Console 包含部署配置、管理能力和后端实现，需要与开源的桌面端及
共享协议分开授权。维护者决定将它们分别保存在私有 GitHub 仓库，同时保留现有路径，
避免破坏 pnpm workspace、OpenAPI 生成和 Docker 构建。

## 决策

- `apps/server` 指向私有 `Mr-BeanSir/GodGesture-Server` 子模块；
  `apps/web-console` 指向私有 `Mr-BeanSir/GodGesture-Web-Console` 子模块。
- 主仓库及 CI 必须递归检出子模块。GitHub Actions 使用仅具两个私有仓库读取权限的
  `PRIVATE_SUBMODULES_TOKEN` 机密；令牌不能进入仓库、镜像或部署配置。
- 两个子模块仍是主工作区的一部分，不作为独立可构建发布物：它们继续以
  `workspace:*` 使用 `@godgesture/shared`，Server 的 OpenAPI 生成、协议改动与消费方
  验证仍从主工作区完成。
- Server Docker 镜像的构建上下文仍是主仓库根目录。1Panel 部署前必须递归初始化私有
  子模块，并使用部署密钥或等效的只读凭据。
- 子模块代码变更先在各自私有仓库提交和发布，再由主仓库提交对应 gitlink 更新。涉及
  shared 协议、OpenAPI 或消费者的变更必须在同一协调变更中完成验证。

## 后果

私有实现可获得独立访问控制，代价是开发机、CI 和 1Panel 都需要私有子模块读取权限。
常规克隆必须使用 `--recurse-submodules`，已有检出必须运行
`git submodule update --init --recursive`。缺少这些凭据时，根工作区不能安装完整依赖、
生成 OpenAPI 或构建 Server 镜像。
