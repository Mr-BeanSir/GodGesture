export type PointerDrag = {
  kind: "app" | "group";
  id: string;
  pointerId: number;
};

export function getDragPreviewOffset(
  sourceRect: Pick<DOMRect, "left" | "top">,
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  return {
    x: clientX - sourceRect.left,
    y: clientY - sourceRect.top,
  };
}

export function isActivePointerDrag(
  drag: PointerDrag | null,
  pointerId: number,
): boolean {
  return drag?.pointerId === pointerId;
}

export function groupIdFromDropTarget(target: Element | null): string | null {
  return target?.closest<HTMLElement>("[data-group-id]")?.dataset.groupId ?? null;
}
