export const SECTION_IDS = [
  "gestures",
  "templates",
  "plugins",
  "logs",
  "account",
  "options",
  "about",
] as const;

export type Section = (typeof SECTION_IDS)[number];

export function isSection(value: string | null): value is Section {
  return value !== null && SECTION_IDS.includes(value as Section);
}

export function resolveInitialSection(
  search: string,
  fallback: Section = "gestures",
): Section {
  const requested = new URLSearchParams(search).get("section");
  return isSection(requested) ? requested : fallback;
}
