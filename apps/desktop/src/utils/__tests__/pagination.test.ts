import { describe, expect, it } from "vitest";
import { getPageCount, getPageItems } from "../pagination";

describe("pagination helpers", () => {
  it("returns the requested page slice", () => {
    const items = [1, 2, 3, 4, 5];

    expect(getPageItems(items, 2, 2)).toEqual([3, 4]);
    expect(getPageCount(items.length, 2)).toBe(3);
  });

  it("normalizes invalid page arguments and keeps an empty collection usable", () => {
    expect(getPageItems([1, 2], 0, 1)).toEqual([1]);
    expect(getPageItems([1, 2], 1, 0)).toEqual([1, 2]);
    expect(getPageItems([1, 2], 4, 10)).toEqual([]);
    expect(getPageCount(0, 10)).toBe(1);
  });
});
