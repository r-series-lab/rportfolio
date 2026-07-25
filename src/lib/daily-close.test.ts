import { describe, expect, it } from "vitest";
import type { AccountRecord } from "./accounts";
import { buildDailyCloseReadiness } from "./daily-close";
import type { HoldingRecord } from "./holdings";
import { emptyPerformanceLedger } from "./performance-ledger";
import type { PositionPlan } from "./position-plan";

const date = "2026-07-16";

function account(overrides: Partial<AccountRecord> = {}): AccountRecord {
  return {
    id: "account-1",
    name: "美元账户",
    broker: "import",
    route: "csv",
    externalAccountId: "US-1",
    currency: "USD",
    source: "import",
    status: "active",
    settledCash: 1000,
    availableCash: 1000,
    pendingSettlement: 0,
    marketValue: 0,
    equity: 1000,
    lastSyncStatus: "imported",
    lastSyncMessage: "",
    syncedAt: `${date}T23:59:59.000Z`,
    updatedAt: `${date}T23:59:59.000Z`,
    notes: "",
    ...overrides,
  };
}

function holding(overrides: Partial<HoldingRecord> = {}): HoldingRecord {
  return {
    id: "holding-1",
    accountId: "account-1",
    symbol: "AAPL",
    name: "Apple",
    market: "US",
    currency: "USD",
    role: "real",
    assetType: "stock",
    quoteSource: "csv",
    quantity: 2,
    costPrice: 180,
    currentPrice: 210,
    quoteAsOf: date,
    targetWeight: 0,
    notes: "",
    ...overrides,
  };
}

function plan(): PositionPlan {
  return {
    totalValue: 7520,
    currency: "CNY",
    valuation: { canCalculate: true, detail: "估值可信" },
  } as PositionPlan;
}

function input() {
  return {
    accounts: [account()],
    date,
    holdings: [holding()],
    ledger: emptyPerformanceLedger(),
    positionPlan: plan(),
    report: {
      asOf: date,
      providerNote: "",
      source: "csv",
      sourceLabel: "本地 CSV",
      backtest: { benchmarkClose: 500, benchmarkSymbol: "SPY" },
    },
    reportIsCurrent: true,
    valuation: { baseCurrency: "CNY" as const, usdCnyRate: 7.1 as number | null, fxAsOf: date, fxSource: "import" as const },
  };
}

describe("daily close readiness", () => {
  it("allows a fully aligned real close", () => {
    const result = buildDailyCloseReadiness(input());

    expect(result.canCapture).toBe(true);
    expect(result.status).toBe("ready");
    expect(result.blockingCount).toBe(0);
  });

  it("blocks sample benchmarks", () => {
    const value = input();
    value.report.sourceLabel = "示例数据";

    const result = buildDailyCloseReadiness(value);

    expect(result.canCapture).toBe(false);
    expect(result.checks.find((check) => check.key === "benchmark")?.severity).toBe("block");
  });

  it("blocks stale quotes and pending settlement", () => {
    const value = input();
    value.holdings = [holding({ quoteAsOf: "2026-07-15" })];
    value.accounts = [account({ pendingSettlement: 100 })];

    const result = buildDailyCloseReadiness(value);

    expect(result.blockingCount).toBe(2);
    expect(result.canCapture).toBe(false);
  });

  it("does not require FX for a single-base-currency portfolio", () => {
    const value = input();
    value.accounts = [account({ currency: "CNY" })];
    value.holdings = [holding({ currency: "CNY", market: "CN" })];
    value.valuation.usdCnyRate = null;
    value.valuation.fxAsOf = "";

    const result = buildDailyCloseReadiness(value);

    expect(result.checks.find((check) => check.key === "fx")?.severity).toBe("pass");
  });
});
