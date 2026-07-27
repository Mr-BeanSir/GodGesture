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
