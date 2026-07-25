import { describe, expect, it } from "vitest";

import {
  buildHoldingDeskSummary,
  buildHoldingLedgerRow,
  filterHoldingLedgerRows,
  type HoldingLedgerRowInput,
} from "./holding-desk-view";
import type { PositionPlan } from "./position-plan";
import type { RecommendationReadiness } from "./recommendation-readiness";

const readiness: RecommendationReadiness = {
  autoExecutionAllowed: false,
  canExecute: true,
  canIncreaseRisk: false,
  canReduceRisk: true,
  confidenceLabel: "中",
  confidenceScore: 72,
  dataQuality: {
    blocksExecution: false,
    checks: [],
    detail: "数据可用",
    label: "数据可用",
    riskIncreaseAllowed: false,
    score: 80,
    severity: "pass",
  },
  detail: "买入需要等待复核",
  label: "待复核",
  tone: "caution",
  validationLabel: "样本外不足",
};

function holding(patch: Partial<HoldingLedgerRowInput> = {}): HoldingLedgerRowInput {
  return {
    assetType: "fund",
    costPrice: 1,
    costValue: 1000,
    currency: "CNY",
    currentPrice: 1,
    drift: 4,
    id: "h1",
    market: "CN",
    marketValue: 1200,
    name: "测试基金",
    notes: "",
    pnl: 200,
    pnlPct: 20,
    quantity: 1200,
    quoteSource: "manual",
    role: "real",
    symbol: "000001",
    targetWeight: 10,
    weight: 14,
    ...patch,
  };
}

describe("holding desk view", () => {
  it("summarizes review count and readiness in one card model", () => {
    const summary = buildHoldingDeskSummary({
      positionPlan: {
        actions: [
          { amount: 200, holdingId: "h1", weightDelta: -2 },
          { amount: 0, holdingId: "h2", weightDelta: 0 },
        ],
        statusTone: "neutral",
      } as PositionPlan,
      readiness,
    });

    expect(summary).toMatchObject({
      reviewCount: 1,
      reviewDetail: "待复核 · 中 72/100",
      reviewTone: "negative",
      reviewValue: "1",
    });
  });

  it("marks actionable, blocked and observation rows with stable labels", () => {
    const actionable = buildHoldingLedgerRow({
      action: { amount: 300, tone: "negative" } as never,
      advice: { action: "今日卖出", amount: "-¥300", reason: "超配", state: "可建票", tone: "negative" },
      holding: holding(),
      readiness,
    });
    const blocked = buildHoldingLedgerRow({
      action: { amount: 100, tone: "positive" } as never,
      advice: { action: "计划买入", amount: "¥100", reason: "风险门未开", state: "风险门未开", tone: "caution" },
      holding: holding({ id: "h2", symbol: "000002" }),
      readiness,
    });
    const watch = buildHoldingLedgerRow({
      advice: { action: "不计仓位", amount: "¥0", reason: "观察资产", state: "未触发", tone: "neutral" },
      holding: holding({ id: "h3", role: "watch", symbol: "000003" }),
      readiness,
    });

    expect(actionable.statusLabel).toBe("可建票");
    expect(blocked.statusLabel).toBe("阻断");
    expect(watch.statusLabel).toBe("观察");

    const rows = [{ ledger: actionable }, { ledger: blocked }, { ledger: watch }];
    expect(filterHoldingLedgerRows({ filter: "actionable", query: "", rows })).toHaveLength(2);
    expect(filterHoldingLedgerRows({ filter: "watch", query: "000003", rows })).toHaveLength(1);
  });
});
