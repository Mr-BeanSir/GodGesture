const APPROVED_TYPES = [
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
];

export const PR_TYPES = Object.freeze([...APPROVED_TYPES]);
export const TYPE_LABELS = Object.freeze(
  Object.fromEntries(PR_TYPES.map((type) => [type, `type: ${type}`])),
);

const TITLE_PATTERN = new RegExp(
  `^(${PR_TYPES.join("|")})(?:\\(([^()]+)\\))?(!)?:[ \\t]+(\\S.*)$`,
  "u",
);
const ALLOWED_TYPES_MESSAGE = PR_TYPES.join(", ");

export function parsePrTitle(title) {
  if (typeof title !== "string" || /[\r\n]/u.test(title)) {
    throw invalidTitleError();
  }

  const match = TITLE_PATTERN.exec(title);
  if (!match) {
    throw invalidTitleError();
  }

  const [, type, rawScope, breakingMarker] = match;
  const scope = rawScope ?? null;
  if (scope !== null && scope.trim().length === 0) {
    throw invalidTitleError();
  }
  if (scope !== null && scope !== scope.trim()) {
    throw invalidTitleError();
  }

  return {
    type,
    label: TYPE_LABELS[type],
    scope,
    breaking: breakingMarker === "!",
  };
}

export function reconcileTypeLabels(existingLabels, canonicalLabel) {
  if (!Array.isArray(existingLabels)) {
    throw new TypeError("Existing PR labels must be an array");
  }
  if (!Object.values(TYPE_LABELS).includes(canonicalLabel)) {
    throw new Error(`Unknown approved PR type label: ${canonicalLabel}`);
  }

  return {
    remove: existingLabels.filter(
      (label) => typeof label === "string" && label.startsWith("type: "),
    ),
    add: [canonicalLabel],
  };
}

function invalidTitleError() {
  return new Error(
    `PR title must start with an allowed Conventional Commit type (${ALLOWED_TYPES_MESSAGE})`,
  );
}
