import { describe, expect, it } from "vitest";

import { isT0ChinaInstrument, simulateAShareFill } from "./a-share-sim";
import type { HoldingRecord } from "./holdings";

function holding(assetType: HoldingRecord["assetType"], symbol: string, name: string): HoldingRecord {
  return {
    id: symbol,
    symbol,
    name,
    market: "CN",
    currency: "CNY",
    role: "real",
    assetType,
    quantity: 1000,
    costPrice: 10,
    currentPrice: 10,
    targetWeight: 10,
    notes: "",
  };
}

function fill(overrides: Partial<Parameters<typeof simulateAShareFill>[0]> = {}) {
  const stock = holding("stock", "600000", "浦发银行");
  return simulateAShareFill({
    availableQuantity: 1000,
    cash: 100_000,
    change1d: 0,
    currentQuantity: 1000,
    holding: stock,
    name: stock.name,
    referencePrice: 10,
    requestedNotional: 2500,
    side: "BUY",
    symbol: stock.symbol,
    ...overrides,
  });
}

describe("A-share fill rules", () => {
  it("rounds ordinary stock buys down to 100-share lots and charges minimum commission", () => {
    const result = fill();

    expect(result.executed).toBe(true);
    expect(result.quantity).toBe(200);
    expect(result.executionPrice).toBe(10.02);
    expect(result.fees.commission).toBe(5);
    expect(result.fees.stampDuty).toBe(0);
    expect(result.fees.transferFee).toBeGreaterThan(0);
  });

  it("blocks selling when T+1 available quantity is zero", () => {
    const result = fill({ side: "SELL", availableQuantity: 0, requestedNotional: 1000 });

    expect(result.executed).toBe(false);
    expect(result.reason).toContain("T+1");
  });

  it("allows a full odd-lot exit but still blocks a partial sub-lot exit", () => {
    const fullExit = fill({ side: "SELL", currentQuantity: 150, availableQuantity: 150, requestedNotional: 5000 });
    const partialExit = fill({ side: "SELL", currentQuantity: 150, availableQuantity: 150, requestedNotional: 500 });

    expect(fullExit.executed).toBe(true);
    expect(fullExit.quantity).toBe(150);
    expect(partialExit.executed).toBe(false);
  });

  it("does not assume fills at the daily price limit", () => {
    const mainBoard = fill({ change1d: 9.95 });
    const chinextHolding = holding("stock", "300750", "宁德时代");
    const chinext = fill({ holding: chinextHolding, symbol: "300750", name: chinextHolding.name, change1d: 19.95 });

    expect(mainBoard.executed).toBe(false);
    expect(mainBoard.reason).toContain("涨停");
    expect(chinext.executed).toBe(false);
    expect(chinext.reason).toContain("20%");
  });

  it("does not charge stamp duty for ETF sells and recognizes cross-border T+0 ETFs", () => {
    const etf = holding("etf", "513100", "纳指 ETF");
    const result = fill({ holding: etf, symbol: etf.symbol, name: etf.name, side: "SELL" });

    expect(result.executed).toBe(true);
    expect(result.fees.stampDuty).toBe(0);
    expect(isT0ChinaInstrument("etf", etf.name)).toBe(true);
    expect(isT0ChinaInstrument("etf", "沪深300ETF")).toBe(false);
  });

  it("routes off-exchange funds away from intraday fill simulation", () => {
    const fund = holding("fund", "016702", "银华数字经济量化混合");
    const result = fill({ holding: fund, symbol: fund.symbol, name: fund.name });

    expect(result.executed).toBe(false);
    expect(result.reason).toContain("下一确认净值");
  });
});
