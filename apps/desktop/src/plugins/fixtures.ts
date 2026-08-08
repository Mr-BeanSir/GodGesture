/** Browser-preview-only online plugin catalog fixture. */
export const onlinePluginCatalogFixture = {
  formatVersion: 1,
  generatedAt: "2026-08-07T13:18:31.271Z",
  entries: [
    {
      slug: "gesture-demo",
      version: "0.1.0",
      title: {
        "zh-CN": "生命周期示例插件",
        en: "Lifecycle demo plugin",
      },
      summary: {
        "zh-CN": "演示 GodGesture Node.js 插件的完整生命周期。",
        en: "Demonstrates the complete GodGesture Node.js plugin lifecycle.",
      },
      author: "GodGesture",
      pluginId: "30000000-0000-4000-8000-000000000001",
      repositoryUrl: "https://github.com/Mr-BeanSir/GodGesture-Plugins",
      ref: "main",
      subdirectory: "plugins/gesture-demo",
    },
  ],
} as const;
