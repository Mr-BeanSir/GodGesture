import { z } from "zod";
import {
  MAX_NODE_PLUGINS,
  MAX_NODE_PLUGIN_FILES,
  MAX_NODE_PLUGIN_FILE_BYTES,
  MAX_NODE_PLUGIN_LOCKFILE_BYTES,
  MAX_NODE_PLUGIN_MANIFEST_BYTES,
  MAX_NODE_PLUGIN_PATH_LENGTH,
  MAX_NODE_PLUGIN_SOURCE_BYTES,
  utf8SizeBytes,
} from "./limits.js";

/**
 * A side-effect-light starter project. Every lifecycle is included so a new
 * plugin is immediately useful as a reference while remaining safe to dry-run.
 */
export const DEFAULT_NODE_PLUGIN_SOURCE = `import { defineHandler } from "@godgesture/sdk";

// Runs once when the plugin worker loads or is rebuilt.
export const onInit = defineHandler(async (/** @type {import("@godgesture/sdk").PluginContext} */ context) => {
  await context.status.report("GodGesture plugin ready");
});

// Runs after the configured gesture is recognized and released.
export const onExecute = defineHandler(async (/** @type {import("@godgesture/sdk").PluginContext} */ context) => {
  await context.status.report("onExecute: " + context.phase);
});

// Runs as soon as the gesture matcher recognizes the configured input.
export const onGestureRecognized = defineHandler(async (/** @type {import("@godgesture/sdk").PluginContext} */ context) => {
  await context.status.report("recognized: " + context.phase);
});

// Runs once for every configured independent modifier trigger.
export const onModifierTriggered = defineHandler(async (/** @type {import("@godgesture/sdk").PluginContext} */ context) => {
  await context.status.report("modifier: " + context.modifier);
});

// Runs when the gesture lifecycle ends, including a cancelled gesture.
export const onEnd = defineHandler(async (/** @type {import("@godgesture/sdk").PluginContext} */ context) => {
  await context.status.report("gesture ended");
});
`;

export const DEFAULT_NODE_PLUGIN_MANIFEST = JSON.stringify(
  { private: true, type: "module" },
  null,
  2,
);

const WINDOWS_RESERVED_PATH_SEGMENT = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

function isPortablePluginPath(path: string): boolean {
  if (path.startsWith("/") || path.includes("\\")) return false;
  return path.split("/").every(
    (segment) =>
      segment !== "" &&
      segment !== "." &&
      segment !== ".." &&
      !/[<>:"|?*\u0000-\u001f]/.test(segment) &&
      !/[. ]$/.test(segment) &&
      !WINDOWS_RESERVED_PATH_SEGMENT.test(segment),
  );
}

export const NodePluginPath = z
  .string()
  .min(1)
  .max(MAX_NODE_PLUGIN_PATH_LENGTH)
  .refine(isPortablePluginPath, "Plugin paths must be portable normalized relative paths");
export type NodePluginPath = z.infer<typeof NodePluginPath>;

const NodePluginFileContent = z.string().superRefine((content, ctx) => {
  const bytes = utf8SizeBytes(content);
  if (bytes > MAX_NODE_PLUGIN_FILE_BYTES) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Plugin file must be at most ${MAX_NODE_PLUGIN_FILE_BYTES} UTF-8 bytes`,
    });
  }
});

export const NodePluginFiles = z
  .record(NodePluginPath, NodePluginFileContent)
  .superRefine((files, ctx) => {
    const entries = Object.entries(files);
    if (entries.length > MAX_NODE_PLUGIN_FILES) {
      ctx.addIssue({
        code: z.ZodIssueCode.too_big,
        maximum: MAX_NODE_PLUGIN_FILES,
        inclusive: true,
        type: "array",
        message: `Plugin must contain at most ${MAX_NODE_PLUGIN_FILES} files`,
      });
    }
    for (const [path] of entries) {
      const firstSegment = path.split("/", 1)[0]!.toLowerCase();
      if (
        firstSegment === "node_modules" ||
        path.toLowerCase() === "package.json" ||
        path.toLowerCase() === "pnpm-lock.yaml"
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [path],
          message: `Plugin source path '${path}' is reserved`,
        });
      }
    }
    const total = entries.reduce((bytes, [, content]) => bytes + utf8SizeBytes(content), 0);
    if (total > MAX_NODE_PLUGIN_SOURCE_BYTES) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Plugin source must be at most ${MAX_NODE_PLUGIN_SOURCE_BYTES} UTF-8 bytes`,
      });
    }
  });
export type NodePluginFiles = z.infer<typeof NodePluginFiles>;

const NodePluginManifest = z.string().superRefine((manifest, ctx) => {
  if (utf8SizeBytes(manifest) > MAX_NODE_PLUGIN_MANIFEST_BYTES) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Plugin manifest must be at most ${MAX_NODE_PLUGIN_MANIFEST_BYTES} UTF-8 bytes`,
    });
    return;
  }
  try {
    const parsed: unknown = JSON.parse(manifest);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed) ||
      (parsed as Record<string, unknown>).type !== "module"
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Plugin package.json must be an object with "type": "module"',
      });
    }
  } catch {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Plugin package.json must be valid JSON" });
  }
});

const NodePluginLockfile = z
  .string()
  .superRefine((lockfile, ctx) => {
    if (utf8SizeBytes(lockfile) > MAX_NODE_PLUGIN_LOCKFILE_BYTES) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Plugin lockfile must be at most ${MAX_NODE_PLUGIN_LOCKFILE_BYTES} UTF-8 bytes`,
      });
    }
  })
  .nullable();

export const NodePlugin = z
  .object({
    id: z.string().uuid(),
    name: z.string().min(1).max(64),
    entry: NodePluginPath.default("index.mjs"),
    files: NodePluginFiles.default({ "index.mjs": DEFAULT_NODE_PLUGIN_SOURCE }),
    packageJson: NodePluginManifest.default(DEFAULT_NODE_PLUGIN_MANIFEST),
    lockfile: NodePluginLockfile.default(null),
    allowLifecycleScripts: z.boolean().default(false),
  })
  .superRefine((plugin, ctx) => {
    if (!(plugin.entry in plugin.files)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["entry"],
        message: "Plugin entry must exist in files",
      });
    }
  });
export type NodePlugin = z.infer<typeof NodePlugin>;

export const NodePlugins = z
  .array(NodePlugin)
  .max(MAX_NODE_PLUGINS)
  .superRefine((plugins, ctx) => {
    const ids = new Set<string>();
    for (const [index, plugin] of plugins.entries()) {
      if (ids.has(plugin.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, "id"],
          message: "Node plugin ids must be unique",
        });
      }
      ids.add(plugin.id);
    }
  })
  .default([]);

export const NodePluginCommand = z.object({
  type: z.literal("nodePlugin"),
  pluginId: z.string().uuid(),
}).strict();
export type NodePluginCommand = z.infer<typeof NodePluginCommand>;
