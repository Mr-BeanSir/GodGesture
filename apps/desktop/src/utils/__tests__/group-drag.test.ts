import { describe, expect, it } from "vitest";
import {
  groupIdFromDropTarget,
  getDragPreviewOffset,
  isActivePointerDrag,
  type PointerDrag,
} from "../group-drag";

describe("pointer group drag helpers", () => {
  it("only accepts events from the pointer that started the drag", () => {
    const drag: PointerDrag = { kind: "app", id: "app-1", pointerId: 7 };

    expect(isActivePointerDrag(drag, 7)).toBe(true);
    expect(isActivePointerDrag(drag, 8)).toBe(false);
    expect(isActivePointerDrag(null, 7)).toBe(false);
  });

  it("resolves a group id from any descendant under the pointer", () => {
    const group = { dataset: { groupId: "group-1" } };
    const target = {
      closest: (_selector: string) => group,
    } as unknown as Element;

    expect(groupIdFromDropTarget(target)).toBe("group-1");
    expect(groupIdFromDropTarget(null)).toBeNull();
  });

  it("keeps the pointer offset when positioning a drag preview", () => {
    expect(getDragPreviewOffset({ left: 100, top: 200 }, 118, 227)).toEqual({
      x: 18,
      y: 27,
    });
  });
});
