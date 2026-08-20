import { randomUUID } from "node:crypto";
import { appendFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { parsePrTitle, PR_TYPES } from "./pr-title.mjs";

const PAGE_SIZE = 100;
const RELEASE_TITLE = "Release Notes";
const RELEASE_TYPE_TITLES = Object.freeze({
  feat: "✨ Features | 新功能",
  fix: "🐛 Bug Fixes | Bug 修复",
  chore: "🎫 Chores | 其他更新",
  docs: "📝 Documentation | 文档",
  style: "💄 Styles | 风格",
  refactor: "♻ Code Refactoring | 代码重构",
  perf: "⚡ Performance Improvements | 性能优化",
  test: "✅ Tests | 测试",
  revert: "⏪ Reverts | 回退",
  build: "👷 Build System | 构建",
  ci: "🔧 Continuous Integration | CI 配置",
  config: "🔨 CONFIG | 配置",
});

export const RELEASE_CATEGORIES = Object.freeze(
  PR_TYPES.map((type) => ({ type, title: RELEASE_TYPE_TITLES[type] })),
);

export function formatReleaseNotes({
  repository,
  previousTag,
  currentTag,
  commits,
  pullRequests,
}) {
  if (!repository || !currentTag) {
    throw new Error("Release notes require a repository and current tag");
  }
  if (!Array.isArray(commits) || !Array.isArray(pullRequests)) {
    throw new TypeError("Release notes commits and pullRequests must be arrays");
  }

  const entries = new Map(PR_TYPES.map((type) => [type, []]));
  const pullRequestCommitShas = new Set(
    pullRequests.flatMap((pullRequest) =>
      [
        ...(pullRequest.commitShas ?? []),
        ...(pullRequest.mergeCommitSha ? [pullRequest.mergeCommitSha] : []),
      ].map((sha) => String(sha).toLowerCase()),
    ),
  );

  const seenPullRequests = new Set();
  for (const pullRequest of pullRequests) {
    const number = Number(pullRequest.number);
    if (!Number.isInteger(number) || seenPullRequests.has(number)) continue;
    seenPullRequests.add(number);
    const type = classifyPullRequest(pullRequest);
    entries.get(type).push({
      label: `${normalizeTitle(pullRequest.title)} (#${number})`,
      url:
        pullRequest.html_url ||
        `https://github.com/${repository}/pull/${number}`,
    });
  }

  const seenCommits = new Set();
  for (const commit of commits) {
    const sha = String(commit.sha ?? "").toLowerCase();
    if (!sha || seenCommits.has(sha) || pullRequestCommitShas.has(sha)) continue;
    seenCommits.add(sha);
    entries.get(classifyTitle(commit.title)).push({
      label: normalizeTitle(commit.title),
      url:
        commit.html_url ||
        `https://github.com/${repository}/commit/${encodeURIComponent(commit.sha)}`,
    });
  }

  const sections = RELEASE_CATEGORIES.flatMap(({ type, title }) => {
    const changes = entries.get(type);
    if (changes.length === 0) return [];
    return [`### ${title}\n\n${changes.map(formatEntry).join("\n")}`];
  });
  if (sections.length === 0) {
    sections.push("暂无可归类的提交或合并 PR。");
  }

  const fullChangelogUrl = previousTag
    ? `https://github.com/${repository}/compare/${encodeURIComponent(previousTag)}...${encodeURIComponent(currentTag)}`
    : `https://github.com/${repository}/commits/${encodeURIComponent(currentTag)}`;

  return [
    `## ${RELEASE_TITLE}`,
    "",
    ...sections.flatMap((section) => [section, ""]),
    `**Full Changelog**: ${fullChangelogUrl}`,
  ].join("\n");
}

export function classifyTitle(title) {
  const firstLine = normalizeTitle(title);
  try {
    return parsePrTitle(firstLine).type;
  } catch {
    return "chore";
  }
}

function classifyPullRequest(pullRequest) {
  const parsedTitle = tryParseTitle(pullRequest.title);
  if (parsedTitle) return parsedTitle.type;

  const label = (pullRequest.labels ?? [])
    .map((value) => (typeof value === "string" ? value : value?.name))
    .find((value) => typeof value === "string" && value.startsWith("type: "));
  const type = label?.slice("type: ".length);
  return PR_TYPES.includes(type) ? type : "chore";
}

function tryParseTitle(title) {
  try {
    return parsePrTitle(normalizeTitle(title));
  } catch {
    return null;
  }
}

function normalizeTitle(title) {
  return String(title ?? "").split(/\r?\n/u, 1)[0].trim() || "Untitled change";
}

function escapeMarkdownLabel(label) {
  return label
    .replaceAll("\\", "\\\\")
    .replaceAll("[", "\\[")
    .replaceAll("]", "\\]");
}

function formatEntry({ label, url }) {
  return `- [${escapeMarkdownLabel(label)}](${url})`;
}

async function githubRequest({ apiUrl, token, path, query = {}, fetchImpl }) {
  const url = new URL(path, `${apiUrl.replace(/\/+$/u, "")}/`);
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, String(value));
  }

  const response = await fetchImpl(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub API request failed (${response.status}): ${body.slice(0, 500)}`);
  }
  return response.json();
}

async function listAll({ apiUrl, token, path, query, fetchImpl }) {
  const values = [];
  for (let page = 1; ; page += 1) {
    const value = await githubRequest({
      apiUrl,
      token,
      path,
      query: { ...query, page, per_page: PAGE_SIZE },
      fetchImpl,
    });
    if (!Array.isArray(value)) {
      throw new Error(`GitHub API list response was not an array: ${path}`);
    }
    values.push(...value);
    if (value.length < PAGE_SIZE) return values;
  }
}

async function listCompareCommits({
  apiUrl,
  token,
  repository,
  previousTag,
  currentTag,
  fetchImpl,
}) {
  if (!previousTag) {
    return listAll({
      apiUrl,
      token,
      path: `/repos/${repository}/commits`,
      query: { sha: currentTag },
      fetchImpl,
    });
  }

  const commits = [];
  for (let page = 1; ; page += 1) {
    const response = await githubRequest({
      apiUrl,
      token,
      path: `/repos/${repository}/compare/${encodeURIComponent(previousTag)}...${encodeURIComponent(currentTag)}`,
      query: { page, per_page: PAGE_SIZE },
      fetchImpl,
    });
    if (!Array.isArray(response.commits)) {
      throw new Error("GitHub compare response did not contain commits");
    }
    commits.push(...response.commits);
    if (commits.length >= response.total_commits || response.commits.length < PAGE_SIZE) {
      return commits;
    }
  }
}

async function resolvePreviousRelease({
  apiUrl,
  token,
  repository,
  currentTag,
  fetchImpl,
}) {
  const releases = await listAll({
    apiUrl,
    token,
    path: `/repos/${repository}/releases`,
    query: {},
    fetchImpl,
  });
  return (
    releases.find(
      (release) => !release.draft && release.tag_name !== currentTag,
    )?.tag_name ?? null
  );
}

async function collectPullRequests({
  apiUrl,
  token,
  repository,
  commitShas,
  fetchImpl,
}) {
  const pullRequests = await listAll({
    apiUrl,
    token,
    path: `/repos/${repository}/pulls`,
    query: { state: "closed" },
    fetchImpl,
  });
  const selected = pullRequests.filter(
    (pullRequest) =>
      pullRequest.merged_at &&
      pullRequest.merge_commit_sha &&
      commitShas.has(pullRequest.merge_commit_sha.toLowerCase()),
  );

  return Promise.all(
    selected.map(async (pullRequest) => {
      const commits = await listAll({
        apiUrl,
        token,
        path: `/repos/${repository}/pulls/${pullRequest.number}/commits`,
        query: {},
        fetchImpl,
      });
      return {
        number: pullRequest.number,
        title: pullRequest.title,
        html_url: pullRequest.html_url,
        labels: pullRequest.labels,
        commitShas: commits.map((commit) => commit.sha),
        mergeCommitSha: pullRequest.merge_commit_sha,
      };
    }),
  );
}

export async function generateReleaseNotesFromGitHub({
  env = process.env,
  fetchImpl = globalThis.fetch,
  outputPath = env.GITHUB_OUTPUT,
} = {}) {
  const token = requireEnvironment(env, "GITHUB_TOKEN");
  const repository = requireEnvironment(env, "GITHUB_REPOSITORY");
  const currentTag = requireEnvironment(env, "GITHUB_REF_NAME");
  const apiUrl = env.GITHUB_API_URL || "https://api.github.com";
  const previousTag = await resolvePreviousRelease({
    apiUrl,
    token,
    repository,
    currentTag,
    fetchImpl,
  });
  const rawCommits = await listCompareCommits({
    apiUrl,
    token,
    repository,
    previousTag,
    currentTag,
    fetchImpl,
  });
  const commitShas = new Set(rawCommits.map((commit) => commit.sha.toLowerCase()));
  const pullRequests = await collectPullRequests({
    apiUrl,
    token,
    repository,
    commitShas,
    fetchImpl,
  });
  const commits = rawCommits
    .map((commit) => ({
      sha: commit.sha,
      title: commit.commit?.message,
      html_url: commit.html_url,
    }))
    .filter(({ title }) => !/^chore:\s+release\s+v\d/iu.test(normalizeTitle(title)));
  const body = formatReleaseNotes({
    repository,
    previousTag,
    currentTag,
    commits,
    pullRequests,
  });

  if (outputPath) {
    const delimiter = `godgesture_release_notes_${randomUUID()}`;
    await appendFile(
      outputPath,
      `body<<${delimiter}\n${body}\n${delimiter}\n`,
      "utf8",
    );
  } else {
    process.stdout.write(`${body}\n`);
  }
  return body;
}

function requireEnvironment(env, name) {
  const value = env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function parseOutputPath(argv) {
  const index = argv.indexOf("--output");
  if (index === -1) return undefined;
  const outputPath = argv[index + 1];
  if (!outputPath) throw new Error("--output requires a file path");
  return outputPath;
}

if (resolve(process.argv[1] ?? "") === resolve(fileURLToPath(import.meta.url))) {
  generateReleaseNotesFromGitHub({ outputPath: parseOutputPath(process.argv.slice(2)) }).catch(
    (error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    },
  );
}
