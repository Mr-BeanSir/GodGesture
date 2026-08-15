/** Browser-preview-only fixtures for the Shared template package protocol. */
export const gestureTemplateCatalogFixture = {
  formatVersion: 2,
  generatedAt: "2026-08-08T00:00:00.000Z",
  entries: [{
    id: "10000000-0000-4000-8000-000000000001",
    versionNumber: 1,
    title: "Global window basics",
    summary: "Maximize, minimize, and close the current window.",
    author: "GodGesture",
    tags: ["window", "global"],
    risks: [],
    downloadCount: 0,
    publishedAt: "2026-08-08T00:00:00.000Z",
    updatedAt: "2026-08-08T00:00:00.000Z",
  }],
} as const;

export const gestureTemplatePackageFixtures = {
  "10000000-0000-4000-8000-000000000001": {
    formatVersion: 2,
    author: "-",
    title: "Global window basics",
    summary: "Maximize, minimize, and close the current window.",
    tags: ["window", "global"],
    plugins: [],
    targets: [{
      scope: "global",
      intents: [
        { name: "Maximize", gesture: { trigger: "right", strokes: ["up"], modifier: "none" }, command: { type: "windowControl", operation: "maximizeRestore" } },
        { name: "Minimize", gesture: { trigger: "right", strokes: ["down"], modifier: "none" }, command: { type: "windowControl", operation: "minimize" } },
      ],
    }],
  },
} as const;
