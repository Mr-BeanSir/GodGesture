import { parse as parseYaml } from "yaml";

export type NodeDiffKind = "added" | "removed" | "changed";

export interface NodeDiffEntry {
  kind: NodeDiffKind;
  path: string;
  before?: string;
  after?: string;
}

export interface NodeDiffResult {
  entries: NodeDiffEntry[];
  error?: string;
}

function display(value: unknown): string {
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function flatten(value: unknown, prefix = "", result = new Map<string, string>()): Map<string, string> {
  if (value === null || typeof value !== "object") {
    result.set(prefix || "$", display(value));
    return result;
  }
  if (Array.isArray(value)) {
    if (!value.length) result.set(prefix || "$", "[]");
    value.forEach((item, index) => flatten(item, `${prefix}[${index}]`, result));
    return result;
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (!entries.length) result.set(prefix || "$", "{}");
  entries.forEach(([key, item]) => flatten(item, prefix ? `${prefix}.${key}` : key, result));
  return result;
}

function diffValues(before: unknown, after: unknown): NodeDiffEntry[] {
  const left = flatten(before);
  const right = flatten(after);
  const paths = [...new Set([...left.keys(), ...right.keys()])].sort((a, b) => a.localeCompare(b));
  return paths.flatMap<NodeDiffEntry>((path) => {
    const oldValue = left.get(path);
    const newValue = right.get(path);
    if (oldValue === undefined) return [{ kind: "added", path, after: newValue }];
    if (newValue === undefined) return [{ kind: "removed", path, before: oldValue }];
    return oldValue === newValue ? [] : [{ kind: "changed", path, before: oldValue, after: newValue }];
  });
}

export function diffManifest(before: string, after: string): NodeDiffResult {
  try {
    return { entries: diffValues(JSON.parse(before), JSON.parse(after)) };
  } catch (error) {
    return { entries: [], error: error instanceof Error ? error.message : String(error) };
  }
}

export function diffLockfile(before: string | null, after: string | null): NodeDiffResult {
  if (before === after) return { entries: [] };
  try {
    return { entries: diffValues(before ? parseYaml(before) : {}, after ? parseYaml(after) : {}) };
  } catch (error) {
    return { entries: [], error: error instanceof Error ? error.message : String(error) };
  }
}

export function summarizeDiff(entries: NodeDiffEntry[]): Record<NodeDiffKind, number> {
  return entries.reduce(
    (summary, entry) => {
      summary[entry.kind] += 1;
      return summary;
    },
    { added: 0, removed: 0, changed: 0 },
  );
}
