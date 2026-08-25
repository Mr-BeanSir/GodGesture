# Gesture Transfer and Group/App Dialog Design

## Goal

让 Desktop 手势页用一个“导入/导出”入口承载本地手势模板导入与现有导出流程，并把“分组”和“应用”合并为一个直接选择卡片的入口。

## Approved interaction

手势页左侧顶部保留两个入口：

- “导入/导出”：打开无底部操作栏的选择卡片对话框。选择“导出手势模板”后进入现有导出表单和“选择交付方式”；选择“导入手势模板”后打开系统 JSON 文件选择器。
- “分组/应用”：打开无底部操作栏的选择卡片对话框。点击“添加应用”或“添加分组”立即关闭选择框，并打开现有的应用编辑窗口或分组命名窗口。

所有新文案通过 Desktop 的 `zh-CN` 与 `en` locale 提供。卡片使用真实 `button` 元素、可见 focus ring、键盘 Tab/Enter/Space 操作，不依赖 hover。

## Import architecture

本地导入复用现有 `useTemplatesStore` 的模板采纳领域逻辑：

1. Tauri `gesture_template_open` 打开 JSON 文件选择器并读取受大小限制的文本；取消返回 `null`。浏览器 mock 返回 `null`，测试通过 mock backend 注入文本。
2. Desktop 使用 shared `parseGestureTemplatePackage` 校验格式和大小。
3. 解析成功后交给模板 store 建立本地采纳上下文，调用既有 `planGestureTemplateAdoption` 计算新增、替换、跳过、冲突、风险和插件来源。
4. 采纳 UI 展示目标、统计、冲突策略、高风险确认与插件提示；用户确认后调用既有 `adopt()`，确保插件安装成功后才通过 `applyTemplateDocument` 原子应用配置。
5. 导入成功后关闭对话框并提示结果；文件取消、解析失败、插件安装失败或配置并发变化均保留在对话框中展示稳定错误状态，不覆盖当前配置。

模板目录页继续使用现有在线模板详情；本次只把本地文件读取和同一 store 采纳上下文暴露给手势页，不新增协议版本、数据库字段或 migration。

## Component boundaries

- `packages/ui/src/components/AppChoiceDialog.vue`：无业务的选择卡片对话框原语，只接收标题、关闭文案和卡片数据，通过 slot 绘制图标。
- `apps/desktop/src/components/GestureTemplateImportDialog.vue`：本地文件选择、shared 解析、采纳复核和确认调用；不复制采纳算法。
- `apps/desktop/src/views/GesturesView.vue`：仅负责打开两个选择框以及把选项路由到既有 `AppEntryDialog`、分组窗口、`GestureExportDialog` 或导入窗口。
- `apps/desktop/src/stores/templates.ts`：新增本地 package 进入采纳上下文的入口，在线模板与本地导入共享 plan/adopt 生命周期。
- `apps/desktop/src/api/backend.ts`、`apps/desktop/src/api/mock.ts`、`apps/desktop/src-tauri/src/lib.rs`：增加类型化本地 JSON 打开命令。

## Error and platform behavior

Windows 与 macOS 复用同一 Vue、shared 协议和 Backend contract；文件选择器由 Tauri dialog plugin 在两端提供。浏览器预览不模拟系统文件选择器，只保留可测试的取消/错误 mock 行为。

## Verification

- Shared/UI/新增 Desktop 组件测试覆盖协议解析、选择卡片键盘交互、导入路由、冲突策略和成功/失败状态。
- Desktop 定向 Vitest、typecheck、build；Rust `cargo fmt --check` 与 `cargo test --lib --no-default-features`。
- `git diff --check`，并检查文案只来自双语 locale、没有新增兼容代码或 migration。
