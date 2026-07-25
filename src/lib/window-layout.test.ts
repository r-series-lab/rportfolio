import { describe, expect, it } from "vitest";
import { windowLayoutForWorkArea } from "./window-layout";

describe("adaptive desktop window layout", () => {
  it("uses most of a 1080p work area without exceeding it", () => {
    expect(windowLayoutForWorkArea({ width: 1920, height: 1080 })).toEqual({
      defaultSize: { width: 1600, height: 972 },
      minimumSize: { width: 1114, height: 734 },
    });
  });

  it("adapts the minimum and default size to a compact display", () => {
    expect(windowLayoutForWorkArea({ width: 1280, height: 720 })).toEqual({
      defaultSize: { width: 1178, height: 648 },
      minimumSize: { width: 800, height: 620 },
    });
  });

  it("never asks for a window larger than the available work area", () => {
    const layout = windowLayoutForWorkArea({ width: 740, height: 580 });

    expect(layout.minimumSize).toEqual({ width: 740, height: 580 });
    expect(layout.defaultSize).toEqual({ width: 740, height: 580 });
  });
});
