import { describe, expect, it } from "vitest";
import {
  listPluginDependencies,
  removePluginDependency,
  setPluginDependency,
} from "../nodePluginPackages";

describe("Node plugin package manifest editing", () => {
  it("adds and updates sorted exact dependency requests", () => {
    let manifest = '{"private":true,"type":"module","dependencies":{"zod":"^3"}}';
    manifest = setPluginDependency(manifest, "@scope/tool", "2.1.0");
    manifest = setPluginDependency(manifest, "zod", "4.0.0");

    expect(listPluginDependencies(manifest)).toEqual([
      { name: "@scope/tool", spec: "2.1.0", optional: false },
      { name: "zod", spec: "4.0.0", optional: false },
    ]);
  });

  it("removes regular and optional dependencies", () => {
    const manifest = removePluginDependency(
      '{"private":true,"type":"module","dependencies":{"zod":"4"},"optionalDependencies":{"sharp":"1"}}',
      "sharp",
    );
    expect(listPluginDependencies(manifest)).toEqual([
      { name: "zod", spec: "4", optional: false },
    ]);
    expect(JSON.parse(manifest)).not.toHaveProperty("optionalDependencies");
  });

  it("rejects malformed names, specs, and manifests", () => {
    expect(() => setPluginDependency("{}", "../escape", "1")).toThrow("package_name_invalid");
    expect(() => setPluginDependency("{}", "zod", "")).toThrow("package_spec_invalid");
    expect(() => listPluginDependencies("[]")).toThrow("manifest_object_required");
  });
});
