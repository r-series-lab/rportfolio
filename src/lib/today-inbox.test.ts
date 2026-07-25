import { describe, expect, it } from "vitest";
import type { OrderRecord } from "./order-store";
import type { PortfolioValuationAssessment } from "./portfolio-valuation";
import type { RecommendationReadiness } from "./recommendation-readiness";
import {
  applyRecommendationDecision,
  type RecommendationDecisionType,
  type RecommendationRecord,
} from "./recommendation-log";
import { buildTodayInbox, decisionIdForOrderIntent } from "./today-inbox";
import type { TradeRecord } from "./trades";

describe("daily decision lifecycle", () => {
  it("appends immutable user events and keeps the decision identity", () => {
    const original = recommendation("decision-a", "AAPL", "increase");
    const updated = applyRecommendationDecision([original], original.decisionId, {
      action: "defer",
      at: "2026-07-15T09:00:00.000Z",
      note: "等待财报",
      reviewAt: "2026-07-17",
    })[0];

    expect(original.disposition).toBe("pending");
    expect(updated.decisionId).toBe("decision-a");
    expect(updated.disposition).toBe("deferred");
    expect(updated.deferredUntil).toBe("2026-07-17");
    expect(updated.decisionEvents).toHaveLength(1);
    expect(updated.decisionEvents[0].note).toBe("等待财报");
  });
});

describe("Today inbox", () => {
  it("prioritizes risk reduction and exposes blocker ownership", () => {
    const valuation = assessment({
      key: "fx.date.stale.warn",
      label: "美元兑人民币",
      severity: "warn",
      detail: "汇率日期待确认",
    });
    const inbox = buildTodayInbox({
      asOf: "2026-07-15",
      orders: [],
      profileKey: "us-core",
      readiness: readiness("估值待确认", "汇率日期待确认"),
      records: [
        recommendation("decision-buy", "AAPL", "increase"),
        recommendation("decision-sell", "QQQ", "reduce"),
      ],
      trades: [],
      valuation,
      now: new Date("2026-07-15T10:00:00+08:00"),
    });

    expect(inbox.decisions.map((item) => item.record.symbol)).toEqual(["QQQ", "AAPL"]);
    expect(inbox.blockers[0].owner).toBe("资产数据");
  });

  it("removes accepted decisions after a linked order and finds linked trades", () => {
    const record = applyRecommendationDecision([recommendation("decision-a", "AAPL", "increase")], "decision-a", {
      action: "accept",
      at: "2026-07-15T09:00:00.000Z",
    })[0];
    const order = { id: "order-a", decisionId: "decision-a" } as OrderRecord;
    const trade = {
      id: "trade-a",
      decisionId: "decision-a",
      orderId: "order-a",
      symbol: "AAPL",
      name: "Apple",
      side: "buy",
      tradeDate: "2026-07-15",
      quantity: 1,
      price: 200,
      fee: 0,
      currency: "USD",
      notes: "",
    } satisfies TradeRecord;
    const inbox = buildTodayInbox({
      asOf: "2026-07-15",
      orders: [order],
      profileKey: "us-core",
      readiness: readiness("交易就绪", "检查通过", "positive"),
      records: [record],
      trades: [trade],
      valuation: assessment(),
      now: new Date("2026-07-15T10:00:00+08:00"),
    });

    expect(inbox.decisions).toHaveLength(0);
    expect(inbox.processedCount).toBe(1);
    expect(inbox.linkedOrderCount).toBe(1);
    expect(inbox.linkedTradeCount).toBe(1);
  });

  it("keeps an accepted decision visible while its linked order is in flight", () => {
    const record = applyRecommendationDecision([recommendation("decision-a", "AAPL", "increase")], "decision-a", {
      action: "accept",
      at: "2026-07-15T09:00:00.000Z",
    })[0];
    const inbox = buildTodayInbox({
      asOf: "2026-07-15",
      orders: [{ id: "order-a", decisionId: "decision-a" } as OrderRecord],
      profileKey: "us-core",
      readiness: readiness("交易就绪", "检查通过", "positive"),
      records: [record],
      trades: [],
      valuation: assessment(),
      now: new Date("2026-07-15T10:00:00+08:00"),
    });

    expect(inbox.decisions).toHaveLength(1);
    expect(inbox.decisions[0].state).toBe("routed");
    expect(inbox.decisions[0].linkedOrderIds).toEqual(["order-a"]);
  });

  it("links order intents to the accepted daily decision", () => {
    const accepted = applyRecommendationDecision([recommendation("decision-a", "AAPL", "increase")], "decision-a", {
      action: "accept",
      at: "2026-07-15T09:00:00.000Z",
    })[0];
    const decisionId = decisionIdForOrderIntent(
      { symbol: "aapl", side: "BUY" },
      [accepted],
      { asOf: "2026-07-15", profileKey: "us-core" },
    );
    expect(decisionId).toBe("decision-a");
  });
});

function recommendation(id: string, symbol: string, decisionType: RecommendationDecisionType): RecommendationRecord {
  return {
    id,
    decisionId: id,
    schemaVersion: 3,
    createdAt: "2026-07-15T08:00:00.000Z",
    asOf: "2026-07-15",
    source: "daily-decision",
    profileKey: "us-core",
    profileVersion: "1.0.0",
    profileSchemaVersion: 1,
    strategyKey: "portfolio-decision",
    strategyLabel: "组合决策",
    strategyScore: 70,
    cohortEvidence: {
      kind: "forward-live",
      strategyVersion: "portfolio-decision@1.0.0",
      dataSignature: "test-v1",
      trainingWindow: "",
      validationWindow: "live-forward",
      frozenAt: "2026-07-15T08:00:00.000Z",
    },
    symbol,
    name: symbol,
    side: decisionType === "reduce" ? "SELL" : "BUY",
    decisionType,
    amount: "$1,000",
    weight: "2%",
    recommendationState: "待处理",
    detail: "目标带偏离",
    readinessLabel: "交易就绪",
    confidenceScore: 70,
    riskScore: 40,
    signalQualityScore: 70,
    stateConfidenceScore: 70,
    historicalSampleCount: 20,
    historicalSampleQuality: "中",
    marketState: "trend",
    protocolState: "ready",
    dataSource: "live",
    referencePrice: 100,
    referencePriceSource: "technical-close",
    disposition: "pending",
    dispositionUpdatedAt: null,
    deferredUntil: null,
    decisionEvents: [],
    outcomes: [],
  };
}

function assessment(check?: PortfolioValuationAssessment["checks"][number]): PortfolioValuationAssessment {
  return {
    canCalculate: true,
    checks: check ? [check] : [],
    detail: check?.detail ?? "估值可信",
    label: check ? "估值待确认" : "估值可信",
    requiresFx: false,
    riskIncreaseAllowed: !check,
    riskReductionAllowed: true,
    severity: check ? "warn" : "pass",
    settings: { baseCurrency: "CNY", usdCnyRate: 7, fxAsOf: "2026-07-15", fxSource: "manual" },
  };
}

function readiness(
  label: string,
  detail: string,
  tone: RecommendationReadiness["tone"] = "caution",
): RecommendationReadiness {
  return {
    autoExecutionAllowed: tone === "positive",
    canExecute: true,
    canIncreaseRisk: tone === "positive",
    canReduceRisk: true,
    confidenceLabel: "中可信",
    confidenceScore: 70,
    dataQuality: {
      score: 80,
      severity: "pass",
      label: "数据可信",
      detail: "数据完整",
      blocksExecution: false,
      riskIncreaseAllowed: true,
      checks: [],
    },
    detail,
    label,
    validationLabel: "执行级",
    tone,
  };
}
