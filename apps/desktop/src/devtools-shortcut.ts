export function isDevtoolsShortcut(
  event: Pick<KeyboardEvent, "key" | "code">,
): boolean {
  return event.key === "F12" || event.code === "F12";
}
