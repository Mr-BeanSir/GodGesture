import { describe, expect, it } from "vitest";
import { createMockBackend } from "../mock";

describe("mock backend application acquisition", () => {
  it("returns a deterministic executable binding for a dropped path", async () => {
    const backend = createMockBackend();

    await expect(backend.resolveAppFile("C:/Tools/Example.exe")).resolves.toEqual({
      exeName: "example.exe",
      exePath: "C:\\Tools\\Example.exe",
      appName: "Example",
      aumid: null,
      bundleId: null,
    });
  });

  it("provides a removable no-op drop subscription", async () => {
    const backend = createMockBackend();
    const unlisten = await backend.onAppFileDrop(() => undefined);

    expect(unlisten).toBeTypeOf("function");
    expect(() => unlisten()).not.toThrow();
  });
});

describe("mock backend updater", () => {
  it("checks one deterministic update and consumes it during installation", async () => {
    const backend = createMockBackend();
    const update = await backend.updateCheck();
    const events: string[] = [];

    expect(update).toMatchObject({
      currentVersion: "0.1.0-dev",
      version: "0.2.0",
    });
    await backend.updateInstall((event) => events.push(event.event));

    expect(events).toEqual(["started", "progress", "finished"]);
    await expect(
      backend.updateInstall(() => undefined),
    ).rejects.toThrow("update_not_pending");
  });
});

describe("mock backend Node plugin workspace", () => {
  it("returns filesystem projects and their declared lifecycles", async () => {
    const backend = createMockBackend();
    const snapshot = await backend.nodePluginsGet();

    expect(snapshot.root).toContain("plugins");
    expect(snapshot.plugins[0]).toMatchObject({
      name: "gesture-demo",
      status: "ready",
      lifecycles: ["onInit", "onExecute", "onGestureRecognized", "onModifierTriggered", "onEnd"],
    });
  });
});
