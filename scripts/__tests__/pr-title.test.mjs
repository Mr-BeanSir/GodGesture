import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { parse as parseYaml } from "yaml";
import {
  PR_TYPES,
  TYPE_LABELS,
  flattenLabelPages,
  parsePrTitle,
  reconcileTypeLabels,
} from "../pr-title.mjs";

const REPOSITORY_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("exposes the twelve approved PR types as frozen values", () => {
  assert.deepEqual(PR_TYPES, [
    "feat",
    "fix",
    "chore",
    "docs",
    "style",
    "refactor",
    "perf",
    "test",
    "revert",
    "build",
    "ci",
    "config",
  ]);
  assert.equal(Object.isFrozen(PR_TYPES), true);
  assert.equal(Object.isFrozen(TYPE_LABELS), true);
  assert.deepEqual(
    Object.fromEntries(PR_TYPES.map((type) => [type, TYPE_LABELS[type]])),
    Object.fromEntries(PR_TYPES.map((type) => [type, `type: ${type}`])),
  );
});

test("parses the twelve allowed types", () => {
  for (const type of PR_TYPES) {
    const parsed = parsePrTitle(`${type}: update release tooling`);
    assert.equal(parsed.type, type);
    assert.equal(parsed.label, `type: ${type}`);
    assert.equal(parsed.scope, null);
    assert.equal(parsed.breaking, false);
  }
});

test("accepts scope and breaking markers", () => {
  assert.deepEqual(parsePrTitle("feat(ui): add template search"), {
    type: "feat",
    label: "type: feat",
    scope: "ui",
    breaking: false,
  });
  assert.deepEqual(parsePrTitle("fix(overlay)!: restore trail"), {
    type: "fix",
    label: "type: fix",
    scope: "overlay",
    breaking: true,
  });
  assert.deepEqual(parsePrTitle("refactor!: revise release API"), {
    type: "refactor",
    label: "type: refactor",
    scope: null,
    breaking: true,
  });
});

test("rejects missing, malformed, or unsupported types", () => {
  for (const title of [
    "add feature",
    "unknown: change",
    "feat : bad",
    "feat(): bad",
    "feat: ",
  ]) {
    assert.throws(() => parsePrTitle(title), /allowed Conventional Commit type/i);
  }
});

test("requires a non-empty scope and description", () => {
  for (const title of [
    "feat( ): change",
    "feat( ui): change",
    "feat(ui ): change",
    "feat:change",
    "feat:\t",
  ]) {
    assert.throws(() => parsePrTitle(title), /allowed Conventional Commit type/i);
  }
});

test("reconciles stale type labels without removing unrelated labels", () => {
  const parsed = parsePrTitle("feat(ui): add template search");
  const reconciliation = reconcileTypeLabels(
    [
      "type: feat",
      "type: fix",
      "type:legacy",
      "type:old",
      "bug",
      "typewriter",
    ],
    parsed.label,
  );

  assert.deepEqual(reconciliation, {
    remove: ["type: feat", "type: fix", "type:legacy", "type:old"],
    add: ["type: feat"],
  });
  assert.equal(reconciliation.remove.includes("bug"), false);
  assert.equal(reconciliation.remove.includes("typewriter"), false);
});

test("includes stale type labels from every API response page", () => {
  const parsed = parsePrTitle("fix: repair release labels");
  const labelPages = [
    [{ name: "bug" }, { name: "type:old" }],
    [{ name: "type:legacy" }, { name: "typewriter" }],
  ];

  const reconciliation = reconcileTypeLabels(
    flattenLabelPages(labelPages)
      .map((label) => label.name)
      .filter(Boolean),
    parsed.label,
  );

  assert.deepEqual(reconciliation, {
    remove: ["type:old", "type:legacy"],
    add: ["type: fix"],
  });
});

test("rejects an invalid canonical label before reconciliation", () => {
  assert.throws(
    () => reconcileTypeLabels(["bug"], "type: unknown"),
    /approved PR type label/i,
  );
});

test("defines a trusted base checkout and stable PR title workflow contract", async () => {
  const workflowPath = join(REPOSITORY_ROOT, ".github", "workflows", "pr-title.yml");
  const workflowSource = await readFile(workflowPath, "utf8");
  const workflow = parseYaml(workflowSource);

  assert.deepEqual(workflow.on.pull_request_target.types, [
    "opened",
    "edited",
    "synchronize",
    "reopened",
  ]);
  assert.deepEqual(workflow.permissions, {
    contents: "read",
    issues: "write",
    "pull-requests": "write",
  });
  assert.deepEqual(workflow.concurrency, {
    group: "pr-title-${{ github.event.pull_request.number }}",
    "cancel-in-progress": false,
  });
  assert.equal(workflow.jobs.classify.name, "Classify PR title");
  assert.match(
    workflowSource,
    /ref:\s*\$\{\{\s*github\.event\.pull_request\.base\.(?:ref|sha)\s*\}\}/,
  );
  assert.doesNotMatch(workflowSource, /pull_request\.(?:head|merge_commit_sha)/);
  assert.doesNotMatch(workflowSource, /pnpm\s+(?:install|exec|run)/);
  assert.match(workflowSource, /scripts\/pr-title\.mjs/);
  assert.match(workflowSource, /flattenLabelPages/);
  assert.match(workflowSource, /page=\$\{page\}/);
  assert.match(workflowSource, /process\.exitCode\s*=\s*1/);
  assert.match(workflowSource, /PR_TITLE:\s*\$\{\{\s*github\.event\.pull_request\.title\s*\}\}/);
  assert.match(workflowSource, /GITHUB_TOKEN:\s*\$\{\{\s*github\.token\s*\}\}/);
});
