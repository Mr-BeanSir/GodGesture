import { describe, expect, it } from "vitest";
import { diffLockfile, diffManifest, summarizeDiff } from "../nodePluginDiff";

describe("Node plugin structured diff", () => {
  it("reports stable manifest additions, removals and changes", () => {
    const result = diffManifest('{"dependencies":{"zod":"4.0.0"},"type":"module"}', '{"dependencies":{"zod":"4.1.0","yaml":"2.9.0"},"type":"module"}');
    expect(result.error).toBeUndefined();
    expect(result.entries).toEqual([
      { kind: "added", path: "dependencies.yaml", after: "2.9.0" },
      { kind: "changed", path: "dependencies.zod", before: "4.0.0", after: "4.1.0" },
    ]);
    expect(summarizeDiff(result.entries)).toEqual({ added: 1, removed: 0, changed: 1 });
  });

  it("parses lockfiles before comparing", () => {
    const result = diffLockfile("lockfileVersion: '9.0'\nsettings:\n  autoInstallPeers: true\n", "lockfileVersion: '9.0'\nsettings:\n  autoInstallPeers: false\n");
    expect(result.entries).toEqual([{ kind: "changed", path: "settings.autoInstallPeers", before: "true", after: "false" }]);
  });

  it("returns parse diagnostics instead of throwing", () => {
    expect(diffManifest("{", "{}").error).toBeTruthy();
    expect(diffLockfile("bad: [", "{}").error).toBeTruthy();
  });
});
