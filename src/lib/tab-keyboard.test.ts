import { describe, expect, it } from "vitest";
import { nextTabIndex } from "./tab-keyboard";

describe("nextTabIndex", () => {
  it("moves in horizontal and vertical directions", () => {
    expect(nextTabIndex(1, 4, "ArrowRight")).toBe(2);
    expect(nextTabIndex(1, 4, "ArrowDown")).toBe(2);
    expect(nextTabIndex(2, 4, "ArrowLeft")).toBe(1);
    expect(nextTabIndex(2, 4, "ArrowUp")).toBe(1);
  });

  it("wraps at both ends", () => {
    expect(nextTabIndex(0, 4, "ArrowLeft")).toBe(3);
    expect(nextTabIndex(3, 4, "ArrowRight")).toBe(0);
  });

  it("supports Home and End and ignores unrelated keys", () => {
    expect(nextTabIndex(2, 4, "Home")).toBe(0);
    expect(nextTabIndex(1, 4, "End")).toBe(3);
    expect(nextTabIndex(1, 4, "Enter")).toBeNull();
    expect(nextTabIndex(0, 0, "ArrowRight")).toBeNull();
  });
});
