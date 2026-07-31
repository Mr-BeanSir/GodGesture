export const nodeDeclarationFiles = import.meta.glob(
  [
    "../../node_modules/@types/node/**/*.d.ts",
    "../../node_modules/undici-types/**/*.d.ts",
  ],
  { eager: true, import: "default", query: "?raw" },
) as Record<string, string>;
