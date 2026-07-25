import { describe, expect, it } from "vitest";
import type { HoldingRecord } from "./holdings";
import { assessPortfolioOverlap } from "./portfolio-overlap";
import { createPositionPlan } from "./position-plan";
import { analyzeTradeHabit, type TradeRecord } from "./trades";
import {
  assessPortfolioValuation,
  convertCurrency,
  holdingMarketValueInBase,
  type PortfolioValuationSettings,
} from "./portfolio-valuation";

const today = new Date().toISOString().slice(0, 10);

const valuation: PortfolioValuationSettings = {
  baseCurrency: "CNY",
  usdCnyRate: 7,
  fxAsOf: today,
  fxSource: "manual",
};

function holding(overrides: Partial<HoldingRecord>): HoldingRecord {
  return {
    id: "holding",
    symbol: "CASH",
    name: "现金",
    market: "CN",
    currency: "CNY",
    role: "real",
    assetType: "cash",
    quoteSource: "manual",
    quantity: 1,
    costPrice: 10_000,
    currentPrice: 10_000,
    quoteAsOf: today,
    targetWeight: 50,
    notes: "",
    ...overrides,
  };
}

describe("portfolio valuation", () => {
  it("converts CNY and USD holdings into one base currency", () => {
    const cash = holding({ id: "cash" });
    const stock = holding({
      id: "nvda",
      symbol: "NVDA",
      name: "NVIDIA",
      market: "US",
      currency: "USD",
      assetType: "stock",
      quantity: 10,
      costPrice: 80,
      currentPrice: 100,
      targetMinWeight: 15,
      targetWeight: 20,
      targetMaxWeight: 25,
    });

    expect(holdingMarketValueInBase(stock, valuation)).toBe(7_000);
    expect(convertCurrency(7_000, "CNY", "USD", valuation)).toBe(1_000);

    const plan = createPositionPlan([cash, stock], { marketRiskScore: 50, valuation });
    const stockDecision = plan.decision.assetDecisions.find((item) => item.holdingId === stock.id);
    const trim = plan.actions.find((item) => item.holdingId === stock.id);

    expect(plan.totalValue).toBe(17_000);
    expect(plan.currency).toBe("CNY");
    expect(stockDecision?.weight).toBe(41.2);
    expect(trim?.amount).toBeCloseTo(2_750, 6);
    expect(trim?.settlementCurrency).toBe("USD");
    expect(trim?.settlementAmount).toBeCloseTo(392.8571, 4);
  });

  it("blocks unsupported currencies instead of silently mixing values", () => {
    const assessment = assessPortfolioValuation([
      holding({ id: "hkd", currency: "HKD", symbol: "0700", name: "Tencent", assetType: "stock" }),
    ], valuation);

    expect(assessment.canCalculate).toBe(false);
    expect(assessment.riskReductionAllowed).toBe(false);
    expect(assessment.checks.some((check) => check.key === "currency.unsupported")).toBe(true);
  });

  it("requires an FX rate for cross-currency valuation", () => {
    const assessment = assessPortfolioValuation([
      holding({ id: "usd", currency: "USD", symbol: "SPY", name: "SPY", assetType: "etf" }),
    ], { ...valuation, usdCnyRate: null });

    expect(assessment.canCalculate).toBe(false);
    expect(assessment.label).toBe("估值阻断");
  });

  it("allows risk reduction but not risk increase when quote dates need confirmation", () => {
    const assessment = assessPortfolioValuation([
      holding({ id: "undated", symbol: "AAPL", name: "Apple", assetType: "stock", quoteAsOf: undefined }),
    ], valuation);

    expect(assessment.canCalculate).toBe(true);
    expect(assessment.riskReductionAllowed).toBe(true);
    expect(assessment.riskIncreaseAllowed).toBe(false);
    expect(assessment.severity).toBe("warn");
  });

  it("uses base-currency values for overlap exposure", () => {
    const cnyFund = holding({
      id: "cny-fund",
      symbol: "CNY-FUND",
      name: "人民币科技基金",
      assetType: "fund",
      quantity: 1,
      currentPrice: 7_000,
      notes: "科技",
    });
    const usdFund = holding({
      id: "usd-fund",
      symbol: "USD-FUND",
      name: "美元科技基金",
      currency: "USD",
      assetType: "fund",
      quantity: 10,
      currentPrice: 100,
      notes: "科技",
    });

    const overlap = assessPortfolioOverlap([cnyFund, usdFund], 14_000, valuation);

    expect(overlap.clusters[0]?.weight).toBe(100);
  });

  it("compares trade size with portfolio value in the same base currency", () => {
    const trade: TradeRecord = {
      id: "usd-trade",
      symbol: "NVDA",
      name: "NVIDIA",
      side: "buy",
      tradeDate: today,
      quantity: 10,
      price: 100,
      fee: 0,
      currency: "USD",
      notes: "",
    };

    const habit = analyzeTradeHabit([trade], [], 7_000, valuation);

    expect(habit.averageAmount).toBe(7_000);
    expect(habit.largestTradeWeight).toBe(100);
  });
});
