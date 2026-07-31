export interface PluginDependency {
  name: string;
  spec: string;
  optional: boolean;
}

type PluginManifest = Record<string, unknown> & {
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
};

const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;

function parseManifest(source: string): PluginManifest {
  const manifest = JSON.parse(source) as unknown;
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error("manifest_object_required");
  }
  const parsed = manifest as PluginManifest;
  if (parsed.type !== "module") throw new Error("manifest_type_required");
  return parsed;
}

function dependencyMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

export function listPluginDependencies(source: string): PluginDependency[] {
  const manifest = parseManifest(source);
  return [
    ...Object.entries(dependencyMap(manifest.dependencies)).map(([name, spec]) => ({
      name,
      spec,
      optional: false,
    })),
    ...Object.entries(dependencyMap(manifest.optionalDependencies)).map(([name, spec]) => ({
      name,
      spec,
      optional: true,
    })),
  ].sort((left, right) => left.name.localeCompare(right.name));
}

export function setPluginDependency(source: string, name: string, spec: string): string {
  const normalizedName = name.trim();
  const normalizedSpec = spec.trim();
  if (!PACKAGE_NAME.test(normalizedName)) throw new Error("package_name_invalid");
  if (!normalizedSpec || normalizedSpec.length > 100) throw new Error("package_spec_invalid");
  const manifest = parseManifest(source);
  const dependencies = dependencyMap(manifest.dependencies);
  dependencies[normalizedName] = normalizedSpec;
  manifest.dependencies = Object.fromEntries(
    Object.entries(dependencies).sort(([left], [right]) => left.localeCompare(right)),
  );
  if (manifest.optionalDependencies && normalizedName in manifest.optionalDependencies) {
    delete manifest.optionalDependencies[normalizedName];
  }
  return JSON.stringify(manifest, null, 2);
}

export function removePluginDependency(source: string, name: string): string {
  const manifest = parseManifest(source);
  for (const key of ["dependencies", "optionalDependencies"] as const) {
    const dependencies = dependencyMap(manifest[key]);
    delete dependencies[name];
    if (Object.keys(dependencies).length) manifest[key] = dependencies;
    else delete manifest[key];
  }
  return JSON.stringify(manifest, null, 2);
}
