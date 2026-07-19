import { brokerRouteLabel } from "./order-store";
import type { RecommendationReadiness } from "./recommendation-readiness";
import type { LabTone, OrderIntent, QbotPreset } from "./strategy-engine";
import { formatNumber } from "./utils";

export type ExecutionModeKey = "manual" | "simulation" | "auto";

export type QuantDeskSummary = {
  dataLabel: string;
  environmentLabel: string;
  riskLabel: string;
  strategyLabel: string;
};

export type RecommendationLedgerRow = {
  actionLabel: string;
  amountLabel: string;
  key: string;
  priorityLabel: string;
  selected: boolean;
  sideLabel: "买入" | "卖出";
  symbol: string;
};

export type TradeTicketWatch = {
  close: number;
  label: string;
  sourceLabel: string;
  symbol: string;
  tradable: boolean;
  tradeBlockReason: string;
  weight: number | null;
};

export type TradeTicketView = OrderIntent & {
  currentWeightLabel: string;
  limit: string;
  primaryLabel: string;
  quantity: string;
  route: string;
  targetWeightLabel: string;
};

export type ExecutionReadiness = {
  disabled: boolean;
  primaryLabel: string;
  reason: string;
  tone: LabTone;
};

export function buildQuantDeskSummary({
  asOf,
  executionMode,
  readiness,
  routeLabel,
  strategyLabel,
}: {
  asOf: string;
  executionMode: ExecutionModeKey;
  readiness: RecommendationReadiness;
  routeLabel: string;
  strategyLabel: string;
}): QuantDeskSummary {
  return {
    dataLabel: asOf ? `数据 ${asOf}` : "数据待刷新",
    environmentLabel: `${executionModeLabel(executionMode)} · ${routeLabel}`,
    riskLabel: readiness.label,
    strategyLabel,
  };
}

export function buildExecutionReadiness({
  executionMode,
  guardSummary,
  recommendation,
  recommendationAllowed,
  readiness,
  watch,
}: {
  executionMode: ExecutionModeKey;
  guardSummary?: string;
  recommendation: OrderIntent | null;
  recommendationAllowed: boolean;
  readiness: RecommendationReadiness;
  watch: TradeTicketWatch | null;
}): ExecutionReadiness {
  if (!watch) {
    return { disabled: true, primaryLabel: "选择一条建议", reason: "从建议账本选择标的。", tone: "neutral" };
  }
  if (!watch.tradable) {
    return { disabled: true, primaryLabel: "仅观察", reason: watch.tradeBlockReason || "该标的不进入委托队列。", tone: "caution" };
  }
  if (!recommendation) {
    return { disabled: true, primaryLabel: "暂无建议", reason: "当前标的没有组合建议。", tone: "caution" };
  }
  if (guardSummary) {
    return { disabled: true, primaryLabel: "查看阻断", reason: guardSummary, tone: "negative" };
  }
  if (executionMode !== "simulation" && !recommendationAllowed) {
    return { disabled: true, primaryLabel: "等待复核", reason: readiness.detail, tone: readiness.tone };
  }
  if (executionMode === "auto" && !readiness.autoExecutionAllowed) {
    return { disabled: true, primaryLabel: "仅可模拟", reason: `${readiness.validationLabel}，自动通道已阻断。`, tone: "caution" };
  }
  return {
    disabled: false,
    primaryLabel: executionMode === "manual"
      ? `生成${sideLabel(recommendation.side)}票`
      : executionMode === "simulation"
        ? "运行模拟"
        : "排入委托",
    reason: "建议、目标带和风控已进入复核。",
    tone: recommendation.side.toUpperCase() === "SELL" ? "caution" : recommendation.tone,
  };
}

export function createTradeTicketFromRecommendation({
  brokerMode,
  now = Date.now(),
  preset,
  recommendation,
  watch,
}: {
  brokerMode: string;
  now?: number;
  preset: QbotPreset;
  recommendation: OrderIntent;
  watch: TradeTicketWatch;
}): TradeTicketView {
  const side = recommendation.side.toUpperCase() === "SELL" ? "SELL" : "BUY";
  const notional = recommendation.notional ?? parseMoneyLabel(recommendation.amount);
  const quantity = watch.close > 0 && notional > 0 ? notional / watch.close : 0;
  const route = brokerRouteLabel(brokerMode, preset);
  const tone: LabTone = recommendation.state === "已阻断" ? "negative" : side === "SELL" ? "caution" : recommendation.tone;

  return {
    key: `ticket-${now}-${watch.symbol}`,
    decisionId: recommendation.decisionId,
    symbol: watch.symbol,
    name: watch.label,
    side,
    state: recommendation.state === "已阻断" ? "已阻断" : `${route} 已排队`,
    tone,
    amount: recommendation.amount,
    baseCurrency: recommendation.baseCurrency,
    baseNotional: recommendation.baseNotional,
    currency: recommendation.currency,
    notional: recommendation.notional,
    weight: recommendation.weight,
    detail: `${recommendation.detail} · ${preset.strategy} · ${route}`,
    currentWeightLabel: watch.weight != null ? `${formatNumber(watch.weight, 1)}%` : "—",
    limit: formatNumber(watch.close, 2),
    primaryLabel: `生成${sideLabel(side)}票`,
    quantity: quantity > 0 ? formatNumber(quantity, quantity >= 100 ? 0 : 4) : "—",
    route,
    targetWeightLabel: recommendation.weight,
  };
}

export function parseMoneyLabel(value: string) {
  const match = value.replace(/[,，]/g, "").match(/-?\d+(?:\.\d+)?/);
  const parsed = match ? Number(match[0]) : 0;
  return Number.isFinite(parsed) ? Math.abs(parsed) : 0;
}

export function sideLabel(side: string): "买入" | "卖出" {
  return side.toUpperCase() === "SELL" ? "卖出" : "买入";
}

function executionModeLabel(mode: ExecutionModeKey) {
  if (mode === "simulation") return "自动模拟";
  return mode === "manual" ? "手动交易" : "通道自动";
}
