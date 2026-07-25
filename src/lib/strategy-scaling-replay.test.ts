import { describe, expect, it } from "vitest";

import { compareScalingPolicies } from "./strategy-scaling-replay";
import { scalingPolicyDefinition } from "./strategy-policies";
import type { StateReplaySample } from "./types";

function sample(pathReturnsPct: number[], index = 0): StateReplaySample {
  return {
    date: `2025-01-${String(index + 1).padStart(2, "0")}`,
    exactStateMatch: index % 2 === 0,
    pathReturnsPct,
  };
}

describe("scaling policy historical replay", () => {
  it("does not rank policies before 30 effective historical paths", () => {
    const comparison = compareScalingPolicies({
      samples: Array.from({ length: 12 }, (_, index) => sample([0, -1, -2, 0, 2], index)),
    });

    expect(comparison.evidence).toBe("preliminary");
    expect(comparison.winnerKey).toBeNull();
    expect(comparison.metrics.every((metric) => metric.score === null)).toBe(true);
  });

  it("keeps a fixed total budget and exposes capital utilization", () => {
    const comparison = compareScalingPolicies({
      samples: Array.from({ length: 30 }, (_, index) => sample([0, 0, 0, 0, 0, 0, 0], index)),
    });
    const single = comparison.metrics.find((metric) => metric.policyKey === "single-entry");
    const equal = comparison.metrics.find((metric) => metric.policyKey === "equal-tranches");

    expect(single?.averageCapitalUtilizationPct).toBe(100);
    expect(equal?.averageCapitalUtilizationPct).toBeLessThan(100);
    expect(equal?.averageTranches).toBe(3);
    expect(comparison.evidence).toBe("reviewable");
    expect(comparison.winnerKey).not.toBeNull();
  });

  it("uses the active trigger parameters for the selected policy", () => {
    const base = Array.from({ length: 30 }, (_, index) => sample([0, -2, -4, -6, -3, 0, 2], index));
    const loose = compareScalingPolicies({
      samples: base,
      activeConfig: {
        ...scalingPolicyDefinition("bounded-average-down").defaultConfig,
        triggerPct: 2,
        cooldownDays: 0,
      },
    });
    const strict = compareScalingPolicies({
      samples: base,
      activeConfig: {
        ...scalingPolicyDefinition("bounded-average-down").defaultConfig,
        triggerPct: 8,
        cooldownDays: 0,
      },
    });

    const looseMetric = loose.metrics.find((metric) => metric.policyKey === "bounded-average-down");
    const strictMetric = strict.metrics.find((metric) => metric.policyKey === "bounded-average-down");
    expect(looseMetric?.averageTranches).toBeGreaterThan(strictMetric?.averageTranches ?? 0);
  });

  it("rejects malformed paths instead of fabricating outcomes", () => {
    const comparison = compareScalingPolicies({
      samples: [sample([]), sample([0, Number.NaN]), sample([0, 1, 2])],
    });

    expect(comparison.sampleCount).toBe(1);
    expect(comparison.evidence).toBe("insufficient");
  });
});
