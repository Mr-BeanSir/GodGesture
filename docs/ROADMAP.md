# GodGesture 路线图

依据:`CONTEXT.md`(术语表)与 `docs/adr/0001~0011`(架构决策)。功能对齐基准 = WGestures 1.8.5 出厂行为(盘点报告见 git 历史与 ADR)。每个里程碑的完成定义:双平台验收通过,或显式标注单平台能力。

## M0 仓库奠基 ✅
- pnpm monorepo:`apps/desktop`(Tauri 2 + Vue 3 TS)、`apps/server`(NestJS)、`packages/shared`(zod 协议)
- 配置文档/同步/认证协议 Schema 初版落地(`packages/shared/src`)
- 三端构建通过

## M1 Windows 手势引擎核心
- `WH_MOUSE_LL` 低级钩子(独立线程 + 自愈重装)、事件吞噬、模拟事件标记
- 路径追踪:起始移动阈值、起始超时透传拖拽、停留超时、点击透传、按键和弦(左+中=暂停)
- 8 向识别(斜向仅首笔,可回写)、增量识别、最多 12 笔
- 修饰(滚轮/其余按键)、修饰节流、修饰过滤(execute-on-modifier 循环触发)
- 原生分层窗口轨迹覆盖层 + 命令提示标签(tiny-skia 绘制,脏矩形,按显示器定位,DWM 强调色)
- 托盘(暂停/设置/退出)、全局暂停快捷键、单实例

## M2 命令全集 + 设置界面(Windows 单平台已完成) ✅
- 12 类命令全部落地(含"贴靠左/右"补全);触发角/摩擦边(全命令类型可选)
- 按应用配置:应用绑定(exe 名 + AUMID)、继承/覆盖、黑名单、取窗口准星、拖放添加
- Vue 设置界面四大区:选项 / 手势 / 触发角&摩擦边 / 关于(i18n 双语、深浅主题)
- 本地持久化(JSON 单文档 + 本机专属设置分离)、手势录制器
- WGestures 导入(gestures.wg2 + config.plist;Lua 脚本保留原文标记)
- Script 在 M2 完成模型、编辑和持久化;QuickJS 执行器与宿主 API 按 ADR-0005 归 M3

## M3 脚本引擎 ✅
- rquickjs 单 Runtime / 每命令懒建 Context;四脚本槽
- 宿主 API:Input(键鼠模拟)、Context(手势上下文)、窗口操作、剪贴板、ReportStatus
- 设置界面 Monaco 编辑器 + `.d.ts` 类型提示

## M4 macOS 引擎
- CGEventTap 捕获 + 事件吞噬、辅助功能权限引导
- NSWindow + CALayer 覆盖层;命令能力矩阵按平台落地(Bundle ID 绑定、Cmd 命令走 shell 等)
- 免费 ad-hoc universal DMG 流水(无需 Apple Developer 账户;首次启动由用户手动放行)

## M5 后端与账户
- Prisma Schema:用户/设备/刷新令牌/配置文档/快照
- 邮箱+密码(Argon2)+ JWT 双令牌(设备级撤销);OAuth 可插拔(GitHub/Google 先行,微信/QQ 留配置位)
- OpenAPI → 生成 TS 客户端进 shared;Dockerfile + 生产 compose(1Panel 部署)+ dev compose(PG)

## M6 云同步
- 客户端同步引擎:防抖自动推送、启动/定时拉取、手动同步按钮、409 冲突拉取重推
- 服务端:整库版本 + 乐观并发 + 快照留存;桌面端账户/同步面板

## M7 Web 控制台 + 分发
- Web 控制台(Vue):只读配置查看、设备管理、快照回滚、账户安全
- Tauri updater 接 GitHub Releases;手势模板库(独立 GitHub 仓库)浏览与采纳

## M8 打磨与发布
- 双平台安装包(NSIS / DMG)、"以管理员身份运行"开关、开机自启
- 快速入门引导、文档、首个正式版发布
