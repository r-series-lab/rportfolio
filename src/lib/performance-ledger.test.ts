import { describe, expect, it } from "vitest";
import {
  calculatePortfolioAttribution,
  normalizePerformanceLedger,
  type PerformanceLedger,
  type PerformanceSnapshot,
} from "./performance-ledger";

function snapshot(overrides: Partial<PerformanceSnapshot>): PerformanceSnapshot {
  return {
    id: `snapshot-${overrides.date}`,
    date: "2025-01-01",
    capturedAt: "2025-01-01T23:00:00.000Z",
    baseCurrency: "CNY",
    portfolioValue: 100,
    benchmarkSymbol: "CSI300",
    benchmarkLevel: 100,
    cumulativeFees: 0,
    cnyExposureValue: 50,
    usdExposureValue: 50,
    usdCnyRate: 7,
    source: "portfolio",
    note: "",
    ...overrides,
  };
}

function ledger(snapshots: PerformanceSnapshot[]): PerformanceLedger {
  return { version: 1, updatedAt: "", snapshots, cashFlows: [] };
}

describe("performance ledger", () => {
  it("removes external deposits from time-weighted return", () => {
    const value = ledger([
      snapshot({ date: "2025-01-02", capturedAt: "2025-01-02T23:00:00.000Z", portfolioValue: 160, benchmarkLevel: 105 }),
      snapshot({ date: "2025-01-01" }),
    ]);
    value.cashFlows.push({
      id: "flow-1",
      date: "2025-01-02",
      capturedAt: "2025-01-02T10:00:00.000Z",
      accountId: "account-1",
      kind: "deposit",
      amount: 50,
      currency: "CNY",
      baseAmount: 50,
      baseCurrency: "CNY",
      usdCnyRate: 7,
      note: "",
    });

    const result = calculatePortfolioAttribution(value);

    expect(result.twrPct).toBe(10);
    expect(result.benchmarkReturnPct).toBe(5);
    expect(result.excessReturnPct).toBe(5);
    expect(result.netExternalFlow).toBe(50);
  });

  it("separates fee drag from gross performance", () => {
    const result = calculatePortfolioAttribution(ledger([
      snapshot({ date: "2025-01-02", capturedAt: "2025-01-02T23:00:00.000Z", portfolioValue: 108, cumulativeFees: 2, benchmarkLevel: 100 }),
      snapshot({ date: "2025-01-01" }),
    ]));

    expect(result.twrPct).toBe(8);
    expect(result.grossTwrPct).toBe(10);
    expect(result.feeDragPct).toBe(-2);
  });

  it("attributes base-currency FX movement using prior foreign exposure", () => {
    const result = calculatePortfolioAttribution(ledger([
      snapshot({ date: "2025-01-02", capturedAt: "2025-01-02T23:00:00.000Z", portfolioValue: 108, benchmarkLevel: 105, usdCnyRate: 7.7 }),
      snapshot({ date: "2025-01-01" }),
    ]));

    expect(result.fxContributionPct).toBeCloseTo(5, 6);
    expect(result.selectionContributionPct).toBeCloseTo(-2, 6);
  });

  it("calculates dated money-weighted return", () => {
    const result = calculatePortfolioAttribution(ledger([
      snapshot({ date: "2026-01-01", capturedAt: "2026-01-01T23:00:00.000Z", portfolioValue: 110, benchmarkLevel: 110 }),
      snapshot({ date: "2025-01-01" }),
    ]));

    expect(result.mwrAnnualizedPct).toBeCloseTo(10, 4);
  });

  it("deduplicates daily snapshots and drops invalid rows", () => {
    const normalized = normalizePerformanceLedger({
      version: 99,
      snapshots: [
        snapshot({ date: "2025-01-01", capturedAt: "2025-01-01T20:00:00.000Z", portfolioValue: 100 }),
        snapshot({ date: "2025-01-01", capturedAt: "2025-01-01T23:00:00.000Z", portfolioValue: 101 }),
        { date: "bad", portfolioValue: 0 },
      ],
      cashFlows: [],
    });

    expect(normalized.version).toBe(1);
    expect(normalized.snapshots).toHaveLength(1);
    expect(normalized.snapshots[0].portfolioValue).toBe(101);
  });
});
