import { describe, expect, it } from "vitest";

import {
  evaluateScalingPolicy,
  normalizeStrategyPolicyConfig,
  registerScalingPolicy,
  scalingPolicyDefinition,
  strategyScalingRuntimeBySymbol,
} from "./strategy-policies";

function decision(overrides: Partial<Parameters<typeof evaluateScalingPolicy>[0]> = {}) {
  return evaluateScalingPolicy({
    assetType: "etf",
    config: scalingPolicyDefinition("bounded-average-down").defaultConfig,
    currentPrice: 10,
    marketRiskScore: 40,
    permissionBlocked: false,
    profileKey: "a-share-risk",
    runDate: "2026-07-06",
    strategyKey: "reversion-probe",
    symbol: "510300",
    ...overrides,
  });
}

describe("strategy policy config", () => {
  it("keeps the existing single-entry behavior as the safe default", () => {
    const config = normalizeStrategyPolicyConfig(null);

    expect(config).toEqual({
      version: 1,
      scalingPolicyKey: "single-entry",
      maxTranches: 1,
      triggerPct: 0,
      cooldownDays: 0,
      trancheWeights: [1],
    });
  });

  it("normalizes tranche weights into a fixed total budget", () => {
    const config = normalizeStrategyPolicyConfig({
      scalingPolicyKey: "bounded-average-down",
      maxTranches: 3,
      trancheWeights: [2, 3, 5],
    });

    expect(config.trancheWeights).toEqual([0.2, 0.3, 0.5]);
    expect(config.trancheWeights.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 10);
  });

  it("accepts a registered custom scaling module", () => {
    const registered = registerScalingPolicy({
      key: "custom-time-ladder",
      label: "自定义时间阶梯",
      shortLabel: "阶梯",
      detail: "按自定义间隔分批。",
      riskLabel: "测试",
      triggerDirection: "time",
      defaultConfig: {
        version: 1,
        scalingPolicyKey: "custom-time-ladder",
        maxTranches: 2,
        triggerPct: 0,
        cooldownDays: 5,
        trancheWeights: [0.4, 0.6],
      },
    });

    expect(registered).toBe(true);
    expect(normalizeStrategyPolicyConfig({ scalingPolicyKey: "custom-time-ladder" })).toMatchObject({
      scalingPolicyKey: "custom-time-ladder",
      maxTranches: 2,
      cooldownDays: 5,
      trancheWeights: [0.4, 0.6],
    });
  });
});

describe("bounded average-down policy", () => {
  it("allows only the configured fraction for the first ETF tranche", () => {
    const result = decision();

    expect(result.allowed).toBe(true);
    expect(result.trancheIndex).toBe(1);
    expect(result.budgetFraction).toBeCloseTo(0.25, 10);
  });

  it("blocks individual stocks by default", () => {
    const result = decision({ assetType: "stock" });

    expect(result.allowed).toBe(false);
    expect(result.stateLabel).toBe("标的不适用");
  });

  it("requires cooldown and the configured drawdown before the second tranche", () => {
    const runtime = {
      instanceKey: "cycle-1",
      completedEntries: 1,
      openQuantity: 100,
      lastEntryPrice: 10,
      lastEntryDate: "2026-07-05",
    };
    const cooling = decision({ currentPrice: 9.6, runtime });
    const waiting = decision({ currentPrice: 9.8, runDate: "2026-07-10", runtime });
    const allowed = decision({ currentPrice: 9.6, runDate: "2026-07-10", runtime });

    expect(cooling.stateLabel).toBe("冷却中");
    expect(waiting.stateLabel).toBe("等待回撤");
    expect(allowed.allowed).toBe(true);
    expect(allowed.trancheIndex).toBe(2);
    expect(allowed.budgetFraction).toBeCloseTo(0.3, 10);
  });

  it("stops adding when the profile permission or market risk gate closes", () => {
    expect(decision({ permissionBlocked: true }).stateLabel).toBe("风险门关闭");
    expect(decision({ marketRiskScore: 75 }).stateLabel).toBe("风险门关闭");
  });
});

describe("pyramid and runtime state", () => {
  it("requires positive price confirmation for a pyramid tranche", () => {
    const config = scalingPolicyDefinition("pyramid-winners").defaultConfig;
    const runtime = {
      instanceKey: "cycle-2",
      completedEntries: 1,
      openQuantity: 100,
      lastEntryPrice: 10,
      lastEntryDate: "2026-07-01",
    };
    const waiting = decision({ config, currentPrice: 10.2, runDate: "2026-07-06", runtime });
    const allowed = decision({ config, currentPrice: 10.4, runDate: "2026-07-06", runtime });

    expect(waiting.stateLabel).toBe("等待确认");
    expect(allowed.allowed).toBe(true);
  });

  it("rebuilds and closes a strategy instance from persisted trades", () => {
    const active = strategyScalingRuntimeBySymbol([
      {
        runDate: "2026-07-01",
        symbol: "510300",
        side: "BUY",
        quantity: 100,
        price: 10,
        strategyKey: "reversion-probe",
        scalingPolicyKey: "bounded-average-down",
        strategyInstanceKey: "cycle-3",
        trancheIndex: 1,
      },
      {
        runDate: "2026-07-05",
        symbol: "510300",
        side: "BUY",
        quantity: 100,
        price: 9.6,
        strategyKey: "reversion-probe",
        scalingPolicyKey: "bounded-average-down",
        strategyInstanceKey: "cycle-3",
        trancheIndex: 2,
      },
    ], "reversion-probe", "bounded-average-down");
    const closed = strategyScalingRuntimeBySymbol([
      ...[
        {
          runDate: "2026-07-01",
          symbol: "510300",
          side: "BUY" as const,
          quantity: 100,
          price: 10,
          strategyKey: "reversion-probe",
          scalingPolicyKey: "bounded-average-down",
          strategyInstanceKey: "cycle-3",
          trancheIndex: 1,
        },
      ],
      {
        runDate: "2026-07-05",
        symbol: "510300",
        side: "SELL",
        quantity: 100,
        price: 11,
        strategyKey: "defense-first",
        scalingPolicyKey: "single-entry",
        strategyInstanceKey: "cycle-3",
        trancheIndex: 0,
      },
    ], "reversion-probe", "bounded-average-down");

    expect(active["510300"]).toMatchObject({ completedEntries: 2, openQuantity: 200, lastEntryPrice: 9.6 });
    expect(closed["510300"]).toMatchObject({ completedEntries: 0, openQuantity: 0 });
  });
});
