import { defineHandler } from "@godgesture/sdk";

// 插件 Worker 首次加载或崩溃后重建时调用。这里适合初始化可重复创建的资源。
export const onInit = defineHandler(
  async (/** @type {import("@godgesture/sdk").PluginContext} */ context) => {
    await context.status.report("gesture-demo 已加载");
  },
);

// 手势识别完成并释放触发键后调用。这是普通 Node.js 插件命令的主处理函数。
export const onExecute = defineHandler(
  async (/** @type {import("@godgesture/sdk").PluginContext} */ context) => {
    const trigger = context.triggerButton ?? "无";
    await context.status.report(
      `执行完成：触发键=${trigger}，终点=(${context.endpoint.x}, ${context.endpoint.y})`,
    );
  },
);

// 手势刚被识别、触发键仍按住时调用。此时可以更新状态，但不要执行耗时阻塞操作。
export const onGestureRecognized = defineHandler(
  async (/** @type {import("@godgesture/sdk").PluginContext} */ context) => {
    await context.status.report(`手势已识别：${context.phase}`);
  },
);

// 配置了独立修饰符时，每次修饰符触发都会调用，直到用户释放手势触发键。
export const onModifierTriggered = defineHandler(
  async (/** @type {import("@godgesture/sdk").PluginContext} */ context) => {
    await context.status.report(`修饰符已触发：${context.modifier}`);
  },
);

// 手势生命周期结束时调用，取消手势也会进入这里，适合释放本次手势使用的临时状态。
export const onEnd = defineHandler(
  async (/** @type {import("@godgesture/sdk").PluginContext} */ context) => {
    await context.status.report(`手势已结束：${context.phase}`);
  },
);
