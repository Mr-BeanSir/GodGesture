import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  formatReleaseNotes,
  generateReleaseNotesFromGitHub,
} from "../generate-release-notes.mjs";

const sha = (letter) => letter.repeat(40);

test("groups direct commits and pull request titles into the configured sections", () => {
  const notes = formatReleaseNotes({
    repository: "Mr-BeanSir/GodGesture",
    previousTag: "v0.2.1",
    currentTag: "v0.2.2",
    commits: [
      {
        sha: sha("a"),
        title: "feat(ui): add template search",
        html_url: "https://github.com/Mr-BeanSir/GodGesture/commit/aaaaaaaa",
      },
      {
        sha: sha("b"),
        title: "fix: prevent overlay flicker",
        html_url: "https://github.com/Mr-BeanSir/GodGesture/commit/bbbbbbbb",
      },
      {
        sha: sha("c"),
        title: "docs: clarify release steps",
        html_url: "https://github.com/Mr-BeanSir/GodGesture/commit/cccccccc",
      },
      {
        sha: sha("d"),
        title: "feat: same change as the pull request",
        html_url: "https://github.com/Mr-BeanSir/GodGesture/commit/dddddddd",
      },
      {
        sha: sha("h"),
        title: "Merge pull request #42 from topic/catalog",
        html_url: "https://github.com/Mr-BeanSir/GodGesture/commit/hhhhhhhh",
      },
    ],
    pullRequests: [
      {
        number: 42,
        title: "feat: publish plugin catalog",
        html_url: "https://github.com/Mr-BeanSir/GodGesture/pull/42",
        labels: [{ name: "type: fix" }],
        commitShas: [sha("d")],
        mergeCommitSha: sha("h"),
      },
    ],
  });

  assert.match(notes, /## 自动生成的 Release Notes/);
  assert.match(notes, /### ✨ Features \| 新功能/);
  assert.match(notes, /### 🐛 Bug Fixes \| Bug 修复/);
  assert.match(notes, /### 📝 Documentation \| 文档/);
  assert.match(notes, /template search/);
  assert.match(notes, /prevent overlay flicker/);
  assert.match(notes, /clarify release steps/);
  assert.match(notes, /publish plugin catalog.*\(#42\)/);
  assert.doesNotMatch(notes, /same change as the pull request/);
  assert.doesNotMatch(notes, /Merge pull request #42/);
  const featureSection = notes.slice(
    notes.indexOf("### ✨ Features | 新功能"),
    notes.indexOf("### 🐛 Bug Fixes | Bug 修复"),
  );
  assert.match(featureSection, /publish plugin catalog/);
  assert.match(
    notes,
    /\*\*Full Changelog\*\*: https:\/\/github\.com\/Mr-BeanSir\/GodGesture\/compare\/v0\.2\.1\.\.\.v0\.2\.2/,
  );
  assert.equal((notes.match(/## 自动生成的 Release Notes/g) ?? []).length, 1);
  assert.ok(notes.endsWith(
    "**Full Changelog**: https://github.com/Mr-BeanSir/GodGesture/compare/v0.2.1...v0.2.2",
  ));
});

test("keeps untyped commits visible in the chores section", () => {
  const notes = formatReleaseNotes({
    repository: "Mr-BeanSir/GodGesture",
    previousTag: "v0.2.1",
    currentTag: "v0.2.2",
    commits: [
      {
        sha: sha("e"),
        title: "security: harden release permissions",
        html_url: "https://github.com/Mr-BeanSir/GodGesture/commit/eeeeeeee",
      },
    ],
    pullRequests: [],
  });

  assert.match(notes, /### 🎫 Chores \| 其他更新/);
  assert.match(notes, /harden release permissions/);
});

test("uses a current-tag commits link when no previous release exists", () => {
  const notes = formatReleaseNotes({
    repository: "Mr-BeanSir/GodGesture",
    previousTag: null,
    currentTag: "v0.1.0",
    commits: [],
    pullRequests: [],
  });

  assert.match(
    notes,
    /\*\*Full Changelog\*\*: https:\/\/github\.com\/Mr-BeanSir\/GodGesture\/commits\/v0\.1\.0/,
  );
});

test("collects the previous release, compare commits, and merged PR commits", async () => {
  const outputDirectory = await mkdtemp(join(tmpdir(), "godgesture-release-notes-"));
  const outputPath = join(outputDirectory, "github-output");
  const pullRequestCommitSha = sha("f");
  const mergeCommitSha = sha("h");
  const requests = [];
  const response = (value) => ({
    ok: true,
    async json() {
      return value;
    },
    async text() {
      return "";
    },
  });
  const fetchImpl = async (url, options) => {
    requests.push({ url: String(url), options });
    const path = new URL(url).pathname;
    if (path.endsWith("/releases")) {
      return response([
        { tag_name: "v0.2.2", draft: false },
        { tag_name: "v0.2.1", draft: false },
      ]);
    }
    if (path.includes("/compare/")) {
      return response({
        total_commits: 3,
        commits: [
          {
            sha: pullRequestCommitSha,
            commit: { message: "feat: add catalog" },
            html_url: `https://github.com/Mr-BeanSir/GodGesture/commit/${pullRequestCommitSha}`,
          },
          {
            sha: mergeCommitSha,
            commit: { message: "Merge pull request #7 from topic/catalog" },
            html_url: `https://github.com/Mr-BeanSir/GodGesture/commit/${mergeCommitSha}`,
          },
          {
            sha: sha("g"),
            commit: { message: "fix: avoid duplicate catalog entries" },
            html_url: "https://github.com/Mr-BeanSir/GodGesture/commit/gggggggg",
          },
        ],
      });
    }
    if (path.endsWith("/pulls")) {
      return response([
        {
          number: 7,
          title: "feat: publish catalog",
          html_url: "https://github.com/Mr-BeanSir/GodGesture/pull/7",
          labels: [{ name: "type: feat" }],
          merged_at: "2026-08-20T00:00:00Z",
          merge_commit_sha: mergeCommitSha,
        },
      ]);
    }
    if (path.endsWith("/pulls/7/commits")) {
      return response([{ sha: pullRequestCommitSha }]);
    }
    throw new Error(`Unexpected GitHub API path: ${path}`);
  };

  try {
    const body = await generateReleaseNotesFromGitHub({
      env: {
        GITHUB_TOKEN: "test-token",
        GITHUB_REPOSITORY: "Mr-BeanSir/GodGesture",
        GITHUB_REF_NAME: "v0.2.2",
        GITHUB_API_URL: "https://api.github.com",
        GITHUB_OUTPUT: outputPath,
      },
      fetchImpl,
    });
    const output = await readFile(outputPath, "utf8");

    assert.equal(body, output.replace(/^body<<[^\r\n]+\r?\n/u, "").replace(/\r?\n[^\r\n]+\r?\n$/u, ""));
    assert.match(body, /publish catalog.*\(#7\)/);
    assert.match(body, /avoid duplicate catalog entries/);
    assert.doesNotMatch(body, /add catalog\]\(.*commit/);
    assert.doesNotMatch(body, /Merge pull request #7/);
    assert.equal(requests[0].options.headers.Authorization, "Bearer test-token");
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
  }
});
