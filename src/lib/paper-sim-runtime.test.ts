import { describe, expect, it } from "vitest";
import type { PositionPlan } from "./position-plan";
import { defaultPaperSimState } from "./paper-sim";
import { runPaperSimulationDay } from "./paper-sim-runtime";
import type { QbotPreset, StrategyDefinition } from "./strategy-engine";
import type { MarketAnalysisReport } from "./types";

const positionPlan = {
  currency: "CNY",
  totalValue: 100_000,
} as PositionPlan;

const preset = {
  key: "rsi-single-factor",
  label: "RSI 单因子",
} as QbotPreset;

const strategy = {
  key: "risk-gated-trend",
  label: "风险门控趋势",
  shortLabel: "风险趋势",
} as StrategyDefinition;

function report(overrides: Partial<MarketAnalysisReport> = {}) {
  return {
    asOf: "2026-07-20",
    profileKey: "test-profile",
    profileName: "测试组合",
    profileMarket: "us",
    sourceLabel: "测试数据",
    assetStatuses: [],
    technicalRows: [],
    backtest: { benchmarkSymbol: "SPY" },
    ...overrides,
  } as MarketAnalysisReport;
}

describe("paper simulation runtime", () => {
  it("records a complete daily snapshot when there are no executable intents", () => {
    const result = runPaperSimulationDay({
      holdings: [],
      orderIntents: [],
      positionPlan,
      preset,
      report: report(),
      source: "test",
      state: defaultPaperSimState(),
      strategy,
    });

    expect(result).toMatchObject({
      alreadyRan: false,
      marketClosed: false,
      skipped: 0,
      trades: [],
    });
    expect(result.state.lastRunDate).toBe("2026-07-20");
    expect(result.state.snapshots).toHaveLength(1);
    expect(result.summary.equity).toBe(100_000);
  });

  it("does not mutate the ledger on a closed A-share market day", () => {
    const result = runPaperSimulationDay({
      holdings: [],
      orderIntents: [],
      positionPlan,
      preset,
      report: report({ asOf: "2026-07-19", profileMarket: "cn" }),
      source: "test",
      state: defaultPaperSimState(),
      strategy,
    });

    expect(result.marketClosed).toBe(true);
    expect(result.trades).toHaveLength(0);
    expect(result.state.snapshots).toHaveLength(0);
    expect(result.state.lastRunDate).toBe("");
    expect(result.state.nextRunHint).toContain("下个交易日");
  });
});
