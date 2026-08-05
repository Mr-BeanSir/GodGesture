import { describe, expect, it } from "vitest";
import { MachineLocalSettings, importLegacyConfig } from "@godgesture/shared";
import { createMockBackend } from "../mock";

const EMPTY_WG2 = JSON.stringify({
  FileVersion: "3",
  Global: { GestureIntents: [] },
  Apps: {},
});

describe("mock backend legacy import", () => {
  it("validates both payloads before replacing either one", async () => {
    const backend = createMockBackend();
    const beforeDocument = await backend.configGet();
    const beforeMachine = await backend.machineGet();
    const imported = importLegacyConfig({ gesturesWg2: EMPTY_WG2 });

    await expect(
      backend.legacyImportApply(
        imported.document,
        { ...MachineLocalSettings.parse({}), autoStart: "invalid" } as never,
      ),
    ).rejects.toBeDefined();

    expect(await backend.configGet()).toEqual(beforeDocument);
    expect(await backend.machineGet()).toEqual(beforeMachine);
  });
});

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
  it("returns filesystem projects and their declared actions", async () => {
    const backend = createMockBackend();
    const snapshot = await backend.nodePluginsGet();

    expect(snapshot.root).toContain("plugins");
    expect(snapshot.plugins[0]).toMatchObject({
      name: "gesture-demo",
      status: "ready",
      actions: [{ id: "default", exportName: "onExecute" }],
    });
  });
});
