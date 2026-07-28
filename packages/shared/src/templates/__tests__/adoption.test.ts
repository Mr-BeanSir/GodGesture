import { describe, expect, it } from "vitest";
import {
  ConfigDocument,
  GestureTemplatePackage,
  TemplateAdoptionError,
  planGestureTemplateAdoption,
} from "../../index.js";

const ids = [
  "90000000-0000-4000-8000-000000000001",
  "90000000-0000-4000-8000-000000000002",
  "90000000-0000-4000-8000-000000000003",
  "90000000-0000-4000-8000-000000000004",
];

describe("gesture template adoption", () => {
  it("adds global intents with fresh IDs and preserves unrelated config", () => {
    const document = ConfigDocument.parse({
      preferences: { locale: "en" },
      hotCorners: {
        enabled: true,
        commands: { leftTop: { type: "pause" } },
      },
    });
    const plan = planGestureTemplateAdoption(
      document,
      globalPackage([templateIntent("Back", ["left"])]),
      options("keepExisting"),
    );

    expect(plan.stats).toEqual({ added: 1, replaced: 0, skipped: 0 });
    expect(plan.document.global.intents[0]?.id).toBe(ids[0]);
    expect(plan.document.preferences.locale).toBe("en");
    expect(plan.document.hotCorners.commands.leftTop).toEqual({ type: "pause" });
    expect(document.global.intents).toHaveLength(0);
  });

  it("keeps or replaces gesture conflicts only after an explicit policy", () => {
    const document = ConfigDocument.parse({
      global: { intents: [existingIntent("Existing", ["left"], 4)] },
    });
    const template = globalPackage([
      templateIntent("Replacement", ["left"]),
      templateIntent("New", ["right"]),
    ]);

    const kept = planGestureTemplateAdoption(
      document,
      template,
      options("keepExisting"),
    );
    expect(kept.stats).toEqual({ added: 1, replaced: 0, skipped: 1 });
    expect(kept.document.global.intents.map((intent) => intent.name)).toEqual([
      "Existing",
      "New",
    ]);
    expect(kept.conflicts[0]?.existingNames).toEqual(["Existing"]);

    const replaced = planGestureTemplateAdoption(
      document,
      template,
      options("replaceExisting"),
    );
    expect(replaced.stats).toEqual({ added: 1, replaced: 1, skipped: 0 });
    expect(replaced.document.global.intents.map((intent) => intent.name)).toEqual([
      "Replacement",
      "New",
    ]);
  });

  it("creates an App with both bindings and deterministic order", () => {
    const document = ConfigDocument.parse({
      apps: [
        {
          id: "20000000-0000-4000-8000-000000000001",
          name: "Existing",
          windows: { exeName: "existing.exe" },
          order: 7,
        },
      ],
    });
    const plan = planGestureTemplateAdoption(
      document,
      appPackage("Browser", "browser.exe", "com.example.browser"),
      options("keepExisting"),
    );

    expect(plan.createdApp).toBe(true);
    expect(plan.targetAppId).toBe(ids[0]);
    expect(plan.document.apps[1]).toMatchObject({
      id: ids[0],
      name: "Browser",
      windows: { exeName: "browser.exe" },
      mac: { bundleId: "com.example.browser" },
      order: 8,
    });
    expect(plan.document.apps[1]?.intents[0]?.id).toBe(ids[1]);
  });

  it("reuses a uniquely matching App and fills a missing platform binding", () => {
    const appId = "20000000-0000-4000-8000-000000000001";
    const document = ConfigDocument.parse({
      apps: [
        {
          id: appId,
          name: "My Browser",
          windows: { exeName: "BROWSER.EXE" },
          inheritGlobalGestures: false,
        },
      ],
    });
    const plan = planGestureTemplateAdoption(
      document,
      appPackage("Browser", "browser.exe", "com.example.browser"),
      options("keepExisting"),
    );

    expect(plan.createdApp).toBe(false);
    expect(plan.targetAppId).toBe(appId);
    expect(plan.document.apps[0]?.name).toBe("My Browser");
    expect(plan.document.apps[0]?.inheritGlobalGestures).toBe(false);
    expect(plan.document.apps[0]?.mac?.bundleId).toBe("com.example.browser");
  });

  it("rejects bindings that resolve to two Apps", () => {
    const document = ConfigDocument.parse({
      apps: [
        {
          id: "20000000-0000-4000-8000-000000000001",
          name: "Windows Browser",
          windows: { exeName: "browser.exe" },
        },
        {
          id: "20000000-0000-4000-8000-000000000002",
          name: "Mac Browser",
          mac: { bundleId: "com.example.browser" },
        },
      ],
    });
    expectAdoptionCode(
      () =>
        planGestureTemplateAdoption(
          document,
          appPackage("Browser", "browser.exe", "com.example.browser"),
          options("keepExisting"),
        ),
      "ambiguous_app_target",
    );
  });

  it("rejects a conflicting second platform binding", () => {
    const document = ConfigDocument.parse({
      apps: [
        {
          id: "20000000-0000-4000-8000-000000000001",
          name: "Browser",
          windows: { exeName: "other.exe" },
          mac: { bundleId: "com.example.browser" },
        },
      ],
    });
    expectAdoptionCode(
      () =>
        planGestureTemplateAdoption(
          document,
          appPackage("Browser", "browser.exe", "com.example.browser"),
          options("keepExisting"),
        ),
      "app_binding_conflict",
    );
  });

  it("rejects duplicate or malformed generated IDs", () => {
    const document = ConfigDocument.parse({});
    const template = globalPackage([
      templateIntent("One", ["left"]),
      templateIntent("Two", ["right"]),
    ]);
    expectAdoptionCode(
      () =>
        planGestureTemplateAdoption(document, template, {
          conflictPolicy: "keepExisting",
          createId: () => ids[0]!,
        }),
      "invalid_id_factory",
    );
    expectAdoptionCode(
      () =>
        planGestureTemplateAdoption(document, template, {
          conflictPolicy: "keepExisting",
          createId: () => "not-a-uuid",
        }),
      "invalid_id_factory",
    );
  });

  it("rejects a resulting document above the sync size limit", () => {
    const largeScriptSlot = "x".repeat(32 * 1024);
    const document = ConfigDocument.parse({
      global: {
        intents: [0, 1, 2].map((index) => ({
          ...existingIntent(`Large ${index}`, [index === 0 ? "up" : index === 1 ? "right" : "down"], index),
          command: {
            type: "script",
            initScript: largeScriptSlot,
            script: largeScriptSlot,
          },
        })),
      },
    });
    const template = GestureTemplatePackage.parse({
      formatVersion: 1,
      slug: "large-template",
      version: "1.0.0",
      target: {
        scope: "global",
        intents: [
          {
            ...templateIntent("Large incoming", ["left"]),
            command: {
              type: "script",
              initScript: largeScriptSlot,
              script: largeScriptSlot,
            },
          },
        ],
      },
    });
    expectAdoptionCode(
      () =>
        planGestureTemplateAdoption(
          document,
          template,
          options("keepExisting"),
        ),
      "document_too_large",
    );
  });
});

function options(conflictPolicy: "keepExisting" | "replaceExisting") {
  let index = 0;
  return { conflictPolicy, createId: () => ids[index++]! };
}

function templateIntent(name: string, strokes: string[]) {
  return {
    name,
    gesture: { trigger: "right", strokes, modifier: "none" },
    command: { type: "doNothing" },
    executeOnModifier: false,
  };
}

function existingIntent(name: string, strokes: string[], order: number) {
  return {
    id: `10000000-0000-4000-8000-${(order + 1).toString().padStart(12, "0")}`,
    ...templateIntent(name, strokes),
    order,
  };
}

function globalPackage(intents: ReturnType<typeof templateIntent>[]) {
  return GestureTemplatePackage.parse({
    formatVersion: 1,
    slug: "global-navigation",
    version: "1.0.0",
    target: { scope: "global", intents },
  });
}

function appPackage(name: string, exeName: string, bundleId: string) {
  return GestureTemplatePackage.parse({
    formatVersion: 1,
    slug: "browser-navigation",
    version: "1.0.0",
    target: {
      scope: "app",
      name,
      windows: { exeName },
      mac: { bundleId },
      intents: [templateIntent("Back", ["left"])],
    },
  });
}

function expectAdoptionCode(operation: () => unknown, code: string) {
  try {
    operation();
    throw new Error("expected operation to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(TemplateAdoptionError);
    expect((error as TemplateAdoptionError).code).toBe(code);
  }
}
