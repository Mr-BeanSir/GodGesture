import { z } from "zod";
import {
  ConfigDocument,
  DEFAULT_APP_GROUP_ID,
  type ConfigDocument as ConfigDocumentValue,
} from "../config/document.js";
import {
  type AppEntry,
  type GestureIntent,
  type GestureSpec,
  MacBinding,
  WindowsBinding,
} from "../config/gestures.js";
import {
  MAX_CONFIG_DOCUMENT_BYTES,
  configDocumentSizeBytes,
} from "../config/limits.js";
import {
  GestureTemplatePackage,
  gestureIdentityKey,
  gestureTemplatePackageRisks,
  type GestureTemplateRisk,
} from "./protocol.js";
import type { OnlinePluginSource } from "../plugins/online.js";

export type TemplateConflictPolicy = "keepExisting" | "replaceExisting";

export interface TemplateGestureConflict {
  gesture: GestureSpec;
  templateName: string;
  existingNames: string[];
}

export interface TemplateAdoptionStats {
  added: number;
  replaced: number;
  skipped: number;
}

export interface TemplateAdoptionPlan {
  document: ConfigDocumentValue;
  targetAppId: string | null;
  createdApp: boolean;
  conflicts: TemplateGestureConflict[];
  stats: TemplateAdoptionStats;
  risks: GestureTemplateRisk[];
  pluginSources: OnlinePluginSource[];
}

export type TemplateAdoptionErrorCode =
  | "ambiguous_app_target"
  | "app_binding_conflict"
  | "invalid_id_factory"
  | "capacity_exceeded"
  | "document_too_large";

export class TemplateAdoptionError extends Error {
  constructor(
    public readonly code: TemplateAdoptionErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "TemplateAdoptionError";
  }
}

export interface PlanTemplateAdoptionOptions {
  conflictPolicy: TemplateConflictPolicy;
  createId: () => string;
}

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase("en-US");
}

function windowsBindingsMatch(
  target: z.infer<typeof WindowsBinding>,
  candidate: z.infer<typeof WindowsBinding>,
): boolean {
  if (target.aumid) {
    return Boolean(
      candidate.aumid &&
        normalized(target.aumid) === normalized(candidate.aumid),
    );
  }
  return normalized(target.exeName) === normalized(candidate.exeName);
}

function windowsBindingsCompatible(
  left: z.infer<typeof WindowsBinding>,
  right: z.infer<typeof WindowsBinding>,
): boolean {
  if (left.aumid && right.aumid) {
    return normalized(left.aumid) === normalized(right.aumid);
  }
  return normalized(left.exeName) === normalized(right.exeName);
}

function macBindingsMatch(
  left: z.infer<typeof MacBinding>,
  right: z.infer<typeof MacBinding>,
): boolean {
  return normalized(left.bundleId) === normalized(right.bundleId);
}

function resolveTargetApp(
  document: ConfigDocumentValue,
  target: Extract<GestureTemplatePackage["target"], { scope: "app" }>,
): AppEntry | null {
  const matches = new Map<string, AppEntry>();
  for (const app of document.apps) {
    if (
      target.windows &&
      app.windows &&
      windowsBindingsMatch(target.windows, app.windows)
    ) {
      matches.set(app.id, app);
    }
    if (target.mac && app.mac && macBindingsMatch(target.mac, app.mac)) {
      matches.set(app.id, app);
    }
  }

  if (matches.size > 1) {
    throw new TemplateAdoptionError(
      "ambiguous_app_target",
      "Template bindings resolve to different existing applications",
    );
  }

  const app = matches.values().next().value as AppEntry | undefined;
  if (!app) return null;

  if (
    target.windows &&
    app.windows &&
    !windowsBindingsCompatible(target.windows, app.windows)
  ) {
    throw new TemplateAdoptionError(
      "app_binding_conflict",
      "The matched application has a different Windows binding",
    );
  }
  if (target.mac && app.mac && !macBindingsMatch(target.mac, app.mac)) {
    throw new TemplateAdoptionError(
      "app_binding_conflict",
      "The matched application has a different macOS binding",
    );
  }

  return app;
}

function allocatedIdFactory(
  document: ConfigDocumentValue,
  createId: () => string,
): () => string {
  const ids = new Set<string>();
  for (const app of document.apps) {
    ids.add(app.id);
    for (const intent of app.intents) ids.add(intent.id);
  }
  for (const intent of document.global.intents) ids.add(intent.id);

  return () => {
    const id = createId();
    if (!z.string().uuid().safeParse(id).success || ids.has(id)) {
      throw new TemplateAdoptionError(
        "invalid_id_factory",
        "Template adoption requires fresh UUIDs",
      );
    }
    ids.add(id);
    return id;
  };
}

function planIntents(
  existing: GestureIntent[],
  incoming: GestureTemplatePackage["target"]["intents"],
  conflictPolicy: TemplateConflictPolicy,
  nextId: () => string,
): {
  intents: GestureIntent[];
  conflicts: TemplateGestureConflict[];
  stats: TemplateAdoptionStats;
} {
  const existingByGesture = new Map<string, GestureIntent[]>();
  for (const intent of existing) {
    const key = gestureIdentityKey(intent.gesture);
    const values = existingByGesture.get(key) ?? [];
    values.push(intent);
    existingByGesture.set(key, values);
  }

  const conflictKeys = new Set<string>();
  const conflicts: TemplateGestureConflict[] = [];
  for (const intent of incoming) {
    const key = gestureIdentityKey(intent.gesture);
    const matches = existingByGesture.get(key) ?? [];
    if (matches.length > 0) {
      conflictKeys.add(key);
      conflicts.push({
        gesture: intent.gesture,
        templateName: intent.name,
        existingNames: matches.map((match) => match.name),
      });
    }
  }

  const retained =
    conflictPolicy === "replaceExisting"
      ? existing.filter(
          (intent) => !conflictKeys.has(gestureIdentityKey(intent.gesture)),
        )
      : [...existing];
  let nextOrder =
    retained.reduce((maximum, intent) => Math.max(maximum, intent.order), -1) +
    1;
  const stats: TemplateAdoptionStats = { added: 0, replaced: 0, skipped: 0 };

  for (const intent of incoming) {
    const conflicting = conflictKeys.has(gestureIdentityKey(intent.gesture));
    if (conflicting && conflictPolicy === "keepExisting") {
      stats.skipped += 1;
      continue;
    }
    retained.push({
      ...intent,
      id: nextId(),
      order: nextOrder++,
    });
    if (conflicting) stats.replaced += 1;
    else stats.added += 1;
  }

  return { intents: retained, conflicts, stats };
}

export function planGestureTemplateAdoption(
  currentDocument: ConfigDocumentValue,
  inputPackage: GestureTemplatePackage,
  options: PlanTemplateAdoptionOptions,
): TemplateAdoptionPlan {
  const parsedDocument = ConfigDocument.parse(currentDocument);
  const templatePackage = GestureTemplatePackage.parse(inputPackage);
  const document = ConfigDocument.parse(
    JSON.parse(JSON.stringify(parsedDocument)) as unknown,
  );
  const nextId = allocatedIdFactory(document, options.createId);
  let targetAppId: string | null = null;
  let createdApp = false;

  if (templatePackage.target.scope === "global") {
    const planned = planIntents(
      document.global.intents,
      templatePackage.target.intents,
      options.conflictPolicy,
      nextId,
    );
    document.global.intents = planned.intents;
    return finishPlan(
      document,
      templatePackage,
      targetAppId,
      createdApp,
      planned,
    );
  }

  let app = resolveTargetApp(document, templatePackage.target);
  if (!app) {
    createdApp = true;
    app = {
      id: nextId(),
      name: templatePackage.target.name,
      ...(templatePackage.target.windows
        ? { windows: templatePackage.target.windows }
        : {}),
      ...(templatePackage.target.mac ? { mac: templatePackage.target.mac } : {}),
      groupId: DEFAULT_APP_GROUP_ID,
      gesturingEnabled: templatePackage.target.gesturingEnabled,
      inheritGlobalGestures: templatePackage.target.inheritGlobalGestures,
      intents: [],
      order:
        document.apps.reduce(
          (maximum, existing) => Math.max(maximum, existing.order),
          -1,
        ) + 1,
    };
    document.apps.push(app);
  } else {
    if (!app.windows && templatePackage.target.windows) {
      app.windows = templatePackage.target.windows;
    }
    if (!app.mac && templatePackage.target.mac) {
      app.mac = templatePackage.target.mac;
    }
  }
  targetAppId = app.id;

  const planned = planIntents(
    app.intents,
    templatePackage.target.intents,
    options.conflictPolicy,
    nextId,
  );
  app.intents = planned.intents;
  return finishPlan(
    document,
    templatePackage,
    targetAppId,
    createdApp,
    planned,
  );
}

function finishPlan(
  document: ConfigDocumentValue,
  templatePackage: GestureTemplatePackage,
  targetAppId: string | null,
  createdApp: boolean,
  planned: {
    conflicts: TemplateGestureConflict[];
    stats: TemplateAdoptionStats;
  },
): TemplateAdoptionPlan {
  const parsed = ConfigDocument.safeParse(document);
  if (!parsed.success) {
    throw new TemplateAdoptionError(
      "capacity_exceeded",
      "Template adoption exceeds a configuration collection limit",
      parsed.error,
    );
  }
  if (configDocumentSizeBytes(parsed.data) > MAX_CONFIG_DOCUMENT_BYTES) {
    throw new TemplateAdoptionError(
      "document_too_large",
      `Template adoption exceeds ${MAX_CONFIG_DOCUMENT_BYTES} bytes`,
    );
  }
  return {
    document: parsed.data,
    targetAppId,
    createdApp,
    conflicts: planned.conflicts,
    stats: planned.stats,
    risks: gestureTemplatePackageRisks(templatePackage),
    pluginSources: templatePackage.plugins,
  };
}
