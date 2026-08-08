import {
  GestureTemplatePackage,
  GESTURE_TEMPLATE_FORMAT_VERSION,
  type AppEntry,
  type GestureIntent,
  type GestureTemplatePackage as GestureTemplatePackageValue,
} from "@godgesture/shared";

export type GestureExportTarget =
  | { scope: "global"; id: "__global__" }
  | { scope: "app"; id: string; app: AppEntry };

export interface GestureExportMetadata {
  title: string;
  summary: string;
  tags: string[];
}

export function gestureTemplateExportFileName(): string {
  const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
  return `gesture-template-${id}.json`;
}

export interface GestureExportSelection {
  target: GestureExportTarget;
  intents: readonly GestureIntent[];
}

function cloneIntents(intents: readonly GestureIntent[]) {
  const cloned = JSON.parse(JSON.stringify(intents)) as GestureIntent[];
  return cloned.map(({ id: _id, order: _order, ...intent }) => intent);
}

export function nodePluginIdsInIntents(intents: readonly GestureIntent[]): string[] {
  return [...new Set(
    intents
      .flatMap((intent) =>
        intent.command.type === "nodePlugin" ? [intent.command.pluginId] : [],
      ),
  )];
}

export function intentsForGestureExportTarget(
  document: { global: { intents: GestureIntent[] }; apps: AppEntry[] },
  target: GestureExportTarget,
): GestureIntent[] {
  if (target.scope === "global") return document.global.intents;
  return document.apps.find((app) => app.id === target.id)?.intents ?? [];
}

export function buildGestureTemplatePackage(
  selections: readonly GestureExportSelection[],
  metadata: GestureExportMetadata,
): GestureTemplatePackageValue {
  if (selections.length === 0) {
    throw new Error("Cannot export a package without targets");
  }
  const pluginIds = nodePluginIdsInIntents(
    selections.flatMap((selection) => selection.intents),
  );
  if (pluginIds.length > 0) {
    throw new Error(`Missing online sources for Node.js plugins: ${pluginIds.join(", ")}`);
  }

  const packageTargets = selections.map(({ target, intents }) =>
    target.scope === "global"
      ? {
          scope: "global" as const,
          intents: cloneIntents(intents),
        }
      : {
          scope: "app" as const,
          name: target.app.name,
          ...(target.app.windows ? { windows: { ...target.app.windows } } : {}),
          ...(target.app.mac ? { mac: { ...target.app.mac } } : {}),
          gesturingEnabled: target.app.gesturingEnabled,
          inheritGlobalGestures: target.app.inheritGlobalGestures,
          intents: cloneIntents(intents),
        },
  );

  return GestureTemplatePackage.parse({
    formatVersion: GESTURE_TEMPLATE_FORMAT_VERSION,
    author: "-",
    title: metadata.title,
    summary: metadata.summary,
    tags: metadata.tags,
    plugins: [],
    targets: packageTargets,
  });
}
