import { describe, expect, it } from "vitest";
import {
  AppEntry,
  Command,
  ConfigDocument,
  DEFAULT_APP_GROUP_ID,
  HotKeyCommand,
  MAX_APP_GROUPS,
  MAX_APPS,
  MAX_COMMAND_TEXT_LENGTH,
  MAX_CONFIG_DOCUMENT_BYTES,
  MAX_HOTKEY_KEYS,
  MAX_INTENTS_PER_SCOPE,
  MAX_PATH_LENGTH,
  MAX_URL_LENGTH,
  configDocumentSizeBytes,
} from "../../index.js";

const app = (index: number) => ({
  id: `00000000-0000-4000-8000-${index.toString().padStart(12, "0")}`,
  name: `App ${index}`,
  groupId: DEFAULT_APP_GROUP_ID,
});

const intent = (index: number) => ({
  id: `10000000-0000-4000-8000-${index.toString().padStart(12, "0")}`,
  name: `Intent ${index}`,
  gesture: {
    trigger: "right" as const,
    strokes: ["up" as const],
    modifier: "none" as const,
  },
  command: { type: "doNothing" as const },
  order: index,
});

describe("config capacity limits", () => {
  it("counts the serialized document in UTF-8 bytes", () => {
    expect(configDocumentSizeBytes({ value: "界" })).toBe(
      new TextEncoder().encode(JSON.stringify({ value: "界" })).length,
    );
    expect(MAX_CONFIG_DOCUMENT_BYTES).toBe(4 * 1024 * 1024);
  });

  it("bounds apps and intents per scope", () => {
    expect(
      ConfigDocument.parse({
        apps: Array.from({ length: MAX_APPS }, (_, i) => app(i)),
      }).apps,
    ).toHaveLength(MAX_APPS);
    expect(() =>
      ConfigDocument.parse({
        apps: Array.from({ length: MAX_APPS + 1 }, (_, i) => app(i)),
      }),
    ).toThrow();
    expect(
      ConfigDocument.parse({
        global: {
          intents: Array.from({ length: MAX_INTENTS_PER_SCOPE }, (_, i) =>
            intent(i),
          ),
        },
      }).global.intents,
    ).toHaveLength(MAX_INTENTS_PER_SCOPE);
    expect(() =>
      ConfigDocument.parse({
        global: {
          intents: Array.from({ length: MAX_INTENTS_PER_SCOPE + 1 }, (_, i) =>
            intent(i),
          ),
        },
      }),
    ).toThrow();
  });

  it("bounds the number of application groups", () => {
    const groups = [
      { id: DEFAULT_APP_GROUP_ID, name: "Default", order: 0 },
      ...Array.from({ length: MAX_APP_GROUPS - 1 }, (_, index) => ({
        id: `80000000-0000-4000-8000-${(index + 1).toString().padStart(12, "0")}`,
        name: `Group ${index}`,
        order: index + 1,
      })),
    ];
    expect(ConfigDocument.parse({ groups }).groups).toHaveLength(MAX_APP_GROUPS);
    expect(() =>
      ConfigDocument.parse({
        groups: [
          ...groups,
          {
            id: "80000000-0000-4000-8000-000000000099",
            name: "Too many",
            order: MAX_APP_GROUPS,
          },
        ],
      }),
    ).toThrow();
  });

  it("bounds hotkey sequences and command text", () => {
    expect(
      HotKeyCommand.parse({
        type: "hotKey",
        modifiers: [],
        keys: Array.from({ length: MAX_HOTKEY_KEYS }, () => "a"),
      }).keys,
    ).toHaveLength(MAX_HOTKEY_KEYS);
    expect(() =>
      HotKeyCommand.parse({
        type: "hotKey",
        modifiers: [],
        keys: Array.from({ length: MAX_HOTKEY_KEYS + 1 }, () => "a"),
      }),
    ).toThrow();
    expect(
      HotKeyCommand.parse({
        type: "hotKey",
        modifiers: ["ctrl", "shift", "alt", "meta"],
        keys: ["a"],
      }).modifiers,
    ).toHaveLength(4);
    expect(() =>
      HotKeyCommand.parse({
        type: "hotKey",
        modifiers: ["ctrl", "shift", "alt", "meta", "ctrl"],
        keys: ["a"],
      }),
    ).toThrow();
    expect(
      Command.parse({ type: "cmd", code: "x".repeat(MAX_COMMAND_TEXT_LENGTH) })
        .type,
    ).toBe("cmd");
    expect(() =>
      Command.parse({
        type: "cmd",
        code: "x".repeat(MAX_COMMAND_TEXT_LENGTH + 1),
      }),
    ).toThrow();
    expect(
      Command.parse({ type: "gotoUrl", url: "x".repeat(MAX_URL_LENGTH) }).type,
    ).toBe("gotoUrl");
    expect(() =>
      Command.parse({ type: "gotoUrl", url: "x".repeat(MAX_URL_LENGTH + 1) }),
    ).toThrow();
    expect(
      Command.parse({ type: "openFile", path: "x".repeat(MAX_PATH_LENGTH) })
        .type,
    ).toBe("openFile");
    expect(() =>
      Command.parse({
        type: "openFile",
        path: "x".repeat(MAX_PATH_LENGTH + 1),
      }),
    ).toThrow();
  });

  it("bounds intents inside application entries", () => {
    expect(() =>
      AppEntry.parse({
        ...app(1),
        intents: Array.from({ length: MAX_INTENTS_PER_SCOPE + 1 }, (_, i) =>
          intent(i),
        ),
      }),
    ).toThrow();
  });
});
