import { describe, expect, it } from "vitest";

import {
  defaultPaperSimState,
  paperReplacementCostFor,
  paperTradePerformanceFor,
  paperTradeRoundTripsFromTrades,
  type PaperSimState,
  type PaperSimTrade,
} from "./paper-sim";

function trade(overrides: Partial<PaperSimTrade> & Pick<PaperSimTrade, "id" | "runDate" | "side">): PaperSimTrade {
  const quantity = overrides.quantity ?? 100;
  const price = overrides.price ?? 10;
  return {
    id: overrides.id,
    at: overrides.at ?? `${overrides.runDate}T08:00:00.000Z`,
    runDate: overrides.runDate,
    symbol: overrides.symbol ?? "510300",
    name: overrides.name ?? "沪深300ETF",
    side: overrides.side,
    quantity,
    price,
    notional: overrides.notional ?? quantity * price,
    fee: overrides.fee ?? 0,
    commission: overrides.commission ?? overrides.fee ?? 0,
    stampDuty: overrides.stampDuty ?? 0,
    transferFee: overrides.transferFee ?? 0,
    slippage: overrides.slippage ?? 0,
    realizedPnl: overrides.realizedPnl ?? 0,
    orderKey: overrides.orderKey ?? overrides.id,
    source: overrides.source ?? "test",
    ruleLabel: overrides.ruleLabel ?? "测试成交",
    ruleNote: overrides.ruleNote ?? "",
    profileKey: overrides.profileKey ?? "a-share-risk",
    profileName: overrides.profileName ?? "A 股组合",
    strategyKey: overrides.strategyKey ?? "risk-gated-trend",
    strategyName: overrides.strategyName ?? "风险门控趋势",
    decisionState: overrides.decisionState ?? "测试",
    decisionDetail: overrides.decisionDetail ?? "确定性测试",
    targetWeight: overrides.targetWeight ?? "10%",
    replacementLink: overrides.replacementLink ?? null,
  };
}

function stateWithTrades(trades: PaperSimTrade[]): PaperSimState {
  return {
    ...defaultPaperSimState(),
    initialCapital: 100_000,
    cash: 100_000,
    trades,
  };
}

describe("paper trade FIFO round trips", () => {
  it("aggregates multiple FIFO entry lots into one completed exit round", () => {
    const result = paperTradeRoundTripsFromTrades([
      trade({ id: "buy-1", runDate: "2026-06-01", side: "BUY", quantity: 100, price: 10, fee: 5 }),
      trade({ id: "buy-2", runDate: "2026-06-06", side: "BUY", quantity: 100, price: 12, fee: 5 }),
      trade({ id: "sell-1", runDate: "2026-06-11", side: "SELL", quantity: 150, price: 15, fee: 15 }),
    ]);

    expect(result.unmatchedExitCount).toBe(0);
    expect(result.rounds).toHaveLength(1);
    expect(result.rounds[0]).toMatchObject({ complete: true, quantity: 150, entryNotional: 1600, exitNotional: 2250 });
    expect(result.rounds[0].entryFees).toBeCloseTo(7.5, 8);
    expect(result.rounds[0].netPnl).toBeCloseTo(627.5, 8);
    expect(result.rounds[0].holdingDays).toBeCloseTo(8.333333, 5);
  });

  it("does not count exits from imported opening inventory as a strategy sample", () => {
    const result = paperTradeRoundTripsFromTrades([
      trade({ id: "seeded-sell", runDate: "2026-06-11", side: "SELL", quantity: 50, price: 11 }),
    ], { "510300": 100 });

    expect(result.rounds).toHaveLength(0);
    expect(result.unmatchedExitCount).toBe(1);
    expect(result.unmatchedExitQuantity).toBe(50);
  });

  it("keeps opening inventory ahead of later buys in the FIFO queue", () => {
    const result = paperTradeRoundTripsFromTrades([
      trade({ id: "new-buy", runDate: "2026-06-02", side: "BUY", quantity: 20, price: 10 }),
      trade({ id: "seeded-exit", runDate: "2026-06-03", side: "SELL", quantity: 100, price: 11 }),
      trade({ id: "tracked-exit", runDate: "2026-06-04", side: "SELL", quantity: 20, price: 12 }),
    ], { "510300": 100 });

    expect(result.unmatchedExitCount).toBe(1);
    expect(result.rounds).toHaveLength(1);
    expect(result.rounds[0]).toMatchObject({ id: "round-tracked-exit", complete: true, quantity: 20, netPnl: 40 });
  });
});

describe("paper trade performance threshold", () => {
  function completedRounds(count: number) {
    return Array.from({ length: count }, (_, index) => {
      const day = String(index * 2 + 1).padStart(2, "0");
      const nextDay = String(index * 2 + 2).padStart(2, "0");
      const exitPrice = index % 2 === 0 ? 11 : 9.5;
      return [
        trade({ id: `buy-${index}`, runDate: `2026-06-${day}`, side: "BUY", price: 10 }),
        trade({ id: `sell-${index}`, runDate: `2026-06-${nextDay}`, side: "SELL", price: exitPrice }),
      ];
    }).flat();
  }

  it("withholds win rate and payoff ratio before 10 completed rounds", () => {
    const performance = paperTradePerformanceFor(stateWithTrades(completedRounds(9)));

    expect(performance.ready).toBe(false);
    expect(performance.sampleCount).toBe(9);
    expect(performance.winRatePct).toBeNull();
    expect(performance.payoffRatio).toBeNull();
  });

  it("publishes metrics at 10 completed rounds", () => {
    const performance = paperTradePerformanceFor(stateWithTrades(completedRounds(10)));

    expect(performance.ready).toBe(true);
    expect(performance.sampleCount).toBe(10);
    expect(performance.winRatePct).toBeCloseTo(50, 8);
    expect(performance.payoffRatio).toBeCloseTo(2, 8);
    expect(performance.expectancy).toBeCloseTo(25, 8);
    expect(performance.averageHoldingDays).toBeCloseTo(1, 8);
  });
});

describe("fund replacement costs", () => {
  it("counts only linked replacement trades and reports a completed workflow", () => {
    const link = {
      id: "replace-1",
      sourceSymbol: "016702",
      targetSymbol: "019305",
      targetName: "目标基金",
      remainingBuyAmount: 0,
      batchAmount: 1000,
      sellFeeRatePct: 0.5,
    } as const;
    const state = stateWithTrades([
      trade({
        id: "redeem",
        runDate: "2026-06-01",
        side: "SELL",
        symbol: "016702",
        notional: 1000,
        fee: 3,
        slippage: 1,
        replacementLink: { ...link, stage: "redeem" },
      }),
      trade({
        id: "subscribe",
        runDate: "2026-06-05",
        side: "BUY",
        symbol: "019305",
        notional: 1000,
        fee: 2,
        replacementLink: { ...link, stage: "subscribe" },
      }),
      trade({ id: "unrelated", runDate: "2026-06-06", side: "BUY", fee: 99 }),
    ]);

    const costs = paperReplacementCostFor(state);
    expect(costs).toMatchObject({ workflowCount: 1, completedWorkflowCount: 1, tradeCount: 2 });
    expect(costs.fees).toBe(5);
    expect(costs.slippage).toBe(1);
    expect(costs.totalCost).toBe(6);
    expect(costs.costPct).toBeCloseTo(0.3, 8);
  });
});
