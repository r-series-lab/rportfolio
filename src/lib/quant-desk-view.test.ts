import { describe, expect, it } from "vitest";

import {
  buildExecutionReadiness,
  createTradeTicketFromRecommendation,
  parseMoneyLabel,
} from "./quant-desk-view";
import type { RecommendationReadiness } from "./recommendation-readiness";
import type { OrderIntent, QbotPreset } from "./strategy-engine";

const preset: QbotPreset = {
  detail: "test",
  key: "rsi-single-factor",
  label: "RSI",
  mapsTo: "reversion-probe",
  platform: "东方财富",
  strategy: "测试策略",
  tradeType: "基金",
};

const readiness: RecommendationReadiness = {
  autoExecutionAllowed: true,
  canExecute: true,
  canIncreaseRisk: true,
  canReduceRisk: true,
  confidenceLabel: "高",
  confidenceScore: 88,
  dataQuality: {
    blocksExecution: false,
    checks: [],
    detail: "数据可用",
    label: "数据可用",
    riskIncreaseAllowed: true,
    score: 90,
    severity: "pass",
  },
  detail: "可执行",
  label: "可执行",
  tone: "positive",
  validationLabel: "验证通过",
};

describe("quant trade ticket view", () => {
  it("inherits sell recommendation direction, amount and target weight", () => {
    const recommendation: OrderIntent = {
      amount: "¥2,305",
      detail: "超配减仓",
      key: "rec-017437",
      name: "华宝纳斯达克精选",
      side: "SELL",
      state: "待减仓",
      symbol: "017437",
      tone: "negative",
      weight: "24.3% → 18.0%",
    };

    const ticket = createTradeTicketFromRecommendation({
      brokerMode: "manual-ticket",
      now: 123,
      preset,
      recommendation,
      watch: {
        close: 2.48,
        label: recommendation.name,
        sourceLabel: "本地持仓",
        symbol: recommendation.symbol,
        tradable: true,
        tradeBlockReason: "",
        weight: 24.3,
      },
    });

    expect(ticket).toMatchObject({
      amount: "¥2,305",
      currentWeightLabel: "24.3%",
      key: "ticket-123-017437",
      side: "SELL",
      targetWeightLabel: "24.3% → 18.0%",
      weight: "24.3% → 18.0%",
    });
    expect(ticket.quantity).toBe("929");
  });

  it("keeps buy ticket amount from the recommendation budget", () => {
    const recommendation: OrderIntent = {
      amount: "¥900",
      detail: "预算内加仓",
      key: "rec-buy",
      name: "测试 ETF",
      side: "BUY",
      state: "待买入",
      symbol: "TEST",
      tone: "positive",
      weight: "+2.0%",
    };

    const ticket = createTradeTicketFromRecommendation({
      brokerMode: "manual-ticket",
      now: 456,
      preset,
      recommendation,
      watch: {
        close: 30,
        label: recommendation.name,
        sourceLabel: "本地持仓",
        symbol: recommendation.symbol,
        tradable: true,
        tradeBlockReason: "",
        weight: 3,
      },
    });

    expect(ticket.side).toBe("BUY");
    expect(ticket.amount).toBe("¥900");
    expect(ticket.quantity).toBe("30.0000");
  });

  it("uses settlement-currency notional for a cross-currency ticket", () => {
    const recommendation: OrderIntent = {
      amount: "$400",
      baseCurrency: "CNY",
      baseNotional: 2_800,
      currency: "USD",
      detail: "人民币预算，美元下单",
      key: "rec-usd",
      name: "NVIDIA",
      notional: 400,
      side: "SELL",
      state: "待减仓",
      symbol: "NVDA",
      tone: "negative",
      weight: "-2.0%",
    };

    const ticket = createTradeTicketFromRecommendation({
      brokerMode: "manual-ticket",
      now: 789,
      preset,
      recommendation,
      watch: {
        close: 100,
        label: recommendation.name,
        sourceLabel: "本地持仓",
        symbol: recommendation.symbol,
        tradable: true,
        tradeBlockReason: "",
        weight: 12,
      },
    });

    expect(ticket.amount).toBe("$400");
    expect(ticket.quantity).toBe("4.0000");
  });

  it("explains disabled states before a suggestion can become a ticket", () => {
    expect(buildExecutionReadiness({
      executionMode: "manual",
      recommendation: null,
      recommendationAllowed: false,
      readiness,
      watch: null,
    })).toMatchObject({ disabled: true, primaryLabel: "选择一条建议" });

    expect(buildExecutionReadiness({
      executionMode: "manual",
      recommendation: null,
      recommendationAllowed: false,
      readiness,
      watch: {
        close: 1,
        label: "代理",
        sourceLabel: "代理信号",
        symbol: "PX",
        tradable: false,
        tradeBlockReason: "代理信号只用于组合风控",
        weight: null,
      },
    })).toMatchObject({ disabled: true, primaryLabel: "仅观察", reason: "代理信号只用于组合风控" });
  });

  it("parses signed and grouped currency labels as absolute notionals", () => {
    expect(parseMoneyLabel("-¥2,305.50")).toBe(2305.5);
    expect(parseMoneyLabel("约 ¥900")).toBe(900);
  });
});
