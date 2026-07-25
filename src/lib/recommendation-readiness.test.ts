import { describe, expect, it } from "vitest";
import type { HoldingRecord } from "./holdings";
import { createPositionPlan } from "./position-plan";
import { recommendationReadinessFor } from "./recommendation-readiness";
import type { MarketAnalysisReport } from "./types";

const today = new Date().toISOString().slice(0, 10);

function holding(overrides: Partial<HoldingRecord>): HoldingRecord {
  return {
    id: "holding",
    symbol: "AAPL",
    name: "Apple",
    market: "US",
    currency: "USD",
    role: "real",
    assetType: "stock",
    quoteSource: "manual",
    quantity: 10,
    costPrice: 100,
    currentPrice: 150,
    quoteAsOf: today,
    targetMinWeight: 10,
    targetWeight: 15,
    targetMaxWeight: 20,
    notes: "",
    ...overrides,
  };
}

function sampleReport(): MarketAnalysisReport {
  return {
    source: "sample",
    sourceLabel: "示例数据",
    providerNote: "演示数据",
    asOf: today,
    technicalRows: [{ symbol: "AAPL", close: 150, change1d: 0, ma20: 145, ma50: 140 }],
    assetStatuses: [{ symbol: "AAPL" }],
    signalQuality: { score: 80, summary: "信号完整" },
    stateConfidence: { score: 80 },
    profileCalibrationStatus: { executionGrade: false, label: "待验证" },
  } as unknown as MarketAnalysisReport;
}

describe("recommendation readiness", () => {
  it("keeps risk-reducing actions available when market data is blocked", () => {
    const plan = createPositionPlan([
      holding({ id: "stock" }),
      holding({
        id: "cash",
        symbol: "CASH",
        name: "USD Cash",
        assetType: "cash",
        quantity: 1,
        costPrice: 500,
        currentPrice: 500,
        targetWeight: 15,
      }),
    ], {
      valuation: { baseCurrency: "USD", usdCnyRate: null, fxAsOf: "", fxSource: "manual" },
    });

    const readiness = recommendationReadinessFor({ plan, report: sampleReport(), reportIsCurrent: true });

    expect(readiness.canReduceRisk).toBe(true);
    expect(readiness.canIncreaseRisk).toBe(false);
    expect(readiness.autoExecutionAllowed).toBe(false);
    expect(readiness.label).toBe("只减不加");
  });

  it("blocks every action when the portfolio cannot be valued", () => {
    const plan = createPositionPlan([
      holding({ currency: "HKD" }),
    ], {
      valuation: { baseCurrency: "CNY", usdCnyRate: null, fxAsOf: "", fxSource: "manual" },
    });

    const readiness = recommendationReadinessFor({ plan, report: sampleReport(), reportIsCurrent: true });

    expect(readiness.canReduceRisk).toBe(false);
    expect(readiness.canIncreaseRisk).toBe(false);
    expect(readiness.label).toBe("估值阻断");
  });
});
