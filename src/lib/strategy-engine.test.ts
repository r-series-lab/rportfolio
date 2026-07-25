import { describe, expect, it } from "vitest";

import {
  STRATEGIES,
  getStrategyDefinition,
  registerStrategy,
  type RegisteredStrategy,
} from "./strategy-engine";

describe("strategy registry", () => {
  it("registers a strategy module without changing the evaluation engine", () => {
    const strategy: RegisteredStrategy = {
      definition: {
        key: "custom-liquidity-filtered-trend",
        label: "流动性趋势",
        shortLabel: "流动性",
        mode: "顺势",
        benchmark: "趋势 / 流动性 / 风险",
        detail: "测试注册策略。",
        policies: {
          signal: "trend-confirmation",
          sizing: "plan-budget",
          scaling: "pyramid-winners",
          exit: "profile-invalidation",
          risk: "profile-guard",
          execution: "market-aware",
          evaluation: "closed-rounds",
        },
      },
      buildOrders: () => [],
      buildSignals: () => [],
      score: () => ({
        score: 50,
        tone: "neutral",
        label: "观察",
        permission: "观察",
        summary: "测试策略。",
      }),
    };

    expect(registerStrategy(strategy)).toBe(true);
    expect(registerStrategy(strategy)).toBe(false);
    expect(getStrategyDefinition(strategy.definition.key).label).toBe("流动性趋势");
    expect(STRATEGIES.some((item) => item.key === strategy.definition.key)).toBe(true);
  });
});
