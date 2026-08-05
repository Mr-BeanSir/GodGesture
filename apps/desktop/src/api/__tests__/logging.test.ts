import { describe, expect, it } from "vitest";
import { createMockBackend } from "../mock";

describe("mock backend local logging", () => {
  it("keeps logging off by default and applies threshold filtering", async () => {
    const backend = createMockBackend();
    const events: string[] = [];
    const unlisten = await backend.onLogEvent((entry) => events.push(entry.message));

    expect(await backend.logLevelGet()).toBe("off");
    await backend.logWrite("error", "cloud", "ignored while off");
    expect((await backend.logsQuery({})).total).toBe(0);

    await backend.logLevelSet("warn");
    await backend.logWrite("info", "cloud", "ignored info");
    await backend.logWrite("warn", "cloud", "kept warning");
    await backend.logWrite("error", "cloud", "kept error");

    expect(events).toEqual(["kept warning", "kept error"]);
    await expect(backend.logsQuery({ level: "warn" })).resolves.toMatchObject({
      total: 1,
      entries: [{ level: "warn", message: "kept warning" }],
      level: "warn",
    });
    unlisten();
  });

  it("filters live entries and clears/export logs", async () => {
    const backend = createMockBackend();
    await backend.logLevelSet("debug");
    await backend.logWrite("info", "config", "loaded");
    await backend.logWrite("error", "node.worker", "failed");

    await expect(
      backend.logsQuery({ target: "node", keyword: "failed", limit: 10 }),
    ).resolves.toMatchObject({
      total: 1,
      entries: [{ target: "node.worker", message: "failed" }],
    });
    await expect(backend.logsExport({ keyword: "failed" })).resolves.toBe(
      "browser-preview://logs/1",
    );

    await backend.logsClear();
    await expect(backend.logsQuery({})).resolves.toMatchObject({
      total: 0,
      entries: [],
      level: "debug",
    });
  });
});
