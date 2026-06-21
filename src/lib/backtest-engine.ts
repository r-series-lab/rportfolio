import type { PositionPlan } from "./position-plan";
import type { LabTone, OrderIntent, QbotPreset, StrategyDefinition, StrategyScore } from "./strategy-engine";
import type { TradeHabit } from "./trades";
import type { BacktestHorizonStat, MarketAnalysisReport, TechnicalRow } from "./types";
import { formatPercent } from "./utils";

export type BacktestEventType = "signal" | "blocked" | "submitted" | "filled" | "marked" | "cost";

export type BacktestEquityCurve = {
  points: string;
  area: string;
  minReturn: number;
  maxReturn: number;
};

export type BacktestEvent = {
  key: string;
  at: string;
  type: BacktestEventType;
  symbol: string;
  label: string;
  detail: string;
  pnlPct: number;
  cashWeight: number;
  exposurePct: number;
  tone: LabTone;
};

export type BacktestSimulatedOrder = {
  key: string;
  symbol: string;
  name: string;
  side: string;
  blocked: boolean;
  notional: number;
  weightPct: number;
  referencePrice: number;
  executionPrice: number;
  quantity: number;
  expectedReturnPct: number;
  grossPnlPct: number;
  feePct: number;
  slippagePct: number;
  netPnlPct: number;
};

export type BacktestRunResult = {
  key: string;
  createdAt: string;
  equity: BacktestEquityCurve;
  events: BacktestEvent[];
  finalCashWeight: number;
  grossPnlPct: number;
  maxDrawdownPct: number;
  netExposurePct: number;
  pnlPct: number;
  presetLabel: string;
  sharpe: number;
  simulatedOrders: BacktestSimulatedOrder[];
  strategyLabel: string;
  summary: string;
  tone: LabTone;
  trades: number;
  turnoverPct: number;
  winRatePct: number;
};

export type BacktestEngineInput = {
  budgetWeight: number;
  feeBps?: number;
  orderIntents: OrderIntent[];
  positionPlan: PositionPlan;
  preset: QbotPreset;
  report: MarketAnalysisReport;
  score: StrategyScore;
  slippageBps?: number;
  strategy: StrategyDefinition;
  tradeHabit: TradeHabit;
};

const DEFAULT_FEE_BPS = 10;
const DEFAULT_SLIPPAGE_BPS = 20;

export function runBacktestEngine({
  budgetWeight,
  feeBps = DEFAULT_FEE_BPS,
  orderIntents,
  positionPlan,
  preset,
  report,
  score,
  slippageBps = DEFAULT_SLIPPAGE_BPS,
  strategy,
  tradeHabit,
}: BacktestEngineInput): BacktestRunResult {
  const horizon = primaryHorizon(report.backtest.stateValidation.horizonStats);
  const technicalBySymbol = new Map(report.technicalRows.map((row) => [row.symbol, row]));
  const simulatedOrders = orderIntents.map((intent, index) => simulateOrder({
    feeBps,
    horizon,
    index,
    intent,
    positionPlan,
    slippageBps,
    technical: technicalBySymbol.get(intent.symbol),
  }));
  const executableOrders = simulatedOrders.filter((order) => !order.blocked);
  const turnoverPct = round(executableOrders.reduce((sum, order) => sum + Math.abs(order.weightPct), 0));
  const orderGrossPnlPct = executableOrders.reduce((sum, order) => sum + order.grossPnlPct, 0);
  const orderCostPct = executableOrders.reduce((sum, order) => sum + order.feePct + order.slippagePct, 0);
  const sampleEdgePct = sampleEdge(report, score, tradeHabit, horizon);
  const riskDragPct = report.score >= 66 ? (report.score - 62) / 9 : 0;
  const grossPnlPct = round(clamp(sampleEdgePct + orderGrossPnlPct - riskDragPct, -22, 28));
  const pnlPct = round(clamp(grossPnlPct - orderCostPct, -24, 26));
  const maxDrawdownPct = -round(clamp(Math.abs(horizon?.medianMaxDrawdownPct ?? report.score / 6 + budgetWeight / 2) + Math.max(0, turnoverPct - 8) * 0.18, 2.2, 36));
  const winRatePct = round(clamp((horizon?.winRatePct ?? 50) + (score.score - 55) * 0.16 - riskDragPct * 2 - orderCostPct * 2, 16, 86));
  const sharpe = round(clamp(pnlPct / Math.max(4, Math.abs(maxDrawdownPct)) + (winRatePct - 50) / 55, -2.4, 3.8));
  const netExposurePct = round(clamp(executableOrders.reduce((sum, order) => {
    const signed = order.side.toUpperCase() === "SELL" ? -Math.abs(order.weightPct) : Math.abs(order.weightPct);
    return sum + signed;
  }, 0), -80, 100));
  const finalCashWeight = round(clamp(positionPlan.cashWeight - netExposurePct - orderCostPct, 0, 100));
  const events = buildBacktestEvents({
    costPct: orderCostPct,
    finalCashWeight,
    netExposurePct,
    orders: simulatedOrders,
    pnlPct,
    report,
  });
  const curveReturns = equityReturnsFor({ grossPnlPct, maxDrawdownPct, pnlPct, sampleEdgePct, winRatePct });
  const trades = Math.max(executableOrders.length, Math.round(executableOrders.length + tradeHabit.trades30d * 0.25));
  const tone: LabTone = pnlPct > 3 && sharpe > 0.6 ? "positive" : pnlPct < -2 || maxDrawdownPct < -18 ? "negative" : "caution";

  return {
    key: `run-${Date.now()}`,
    createdAt: shortTimeLabel(),
    equity: equityCurveFromReturns(curveReturns),
    events,
    finalCashWeight,
    grossPnlPct,
    maxDrawdownPct,
    netExposurePct,
    pnlPct,
    presetLabel: preset.label,
    sharpe,
    simulatedOrders,
    strategyLabel: strategy.label,
    summary: `${strategy.label} / ${preset.strategy} · ${formatPercent(pnlPct)} · 回撤 ${formatPercent(maxDrawdownPct)} · ${executableOrders.length} 单`,
    tone,
    trades,
    turnoverPct,
    winRatePct,
  };
}

function simulateOrder({
  feeBps,
  horizon,
  index,
  intent,
  positionPlan,
  slippageBps,
  technical,
}: {
  feeBps: number;
  horizon: BacktestHorizonStat | null;
  index: number;
  intent: OrderIntent;
  positionPlan: PositionPlan;
  slippageBps: number;
  technical: TechnicalRow | undefined;
}): BacktestSimulatedOrder {
  const side = intent.side.toUpperCase();
  const blocked = intent.state.includes("阻断") || intent.tone === "negative" && side === "BUY";
  const referencePrice = Math.max(0, technical?.close ?? 0);
  const weightPct = Math.abs(parsePercent(intent.weight)) || Math.min(8, Math.max(1, positionPlan.decision.singleTradeBudget / Math.max(1, positionPlan.totalValue) * 100));
  const notionalFromText = parseMoney(intent.amount);
  const notional = notionalFromText > 0
    ? notionalFromText
    : positionPlan.totalValue > 0
      ? positionPlan.totalValue * weightPct / 100
      : referencePrice * 100;
  const slippageDirection = side === "SELL" ? -1 : 1;
  const executionPrice = referencePrice > 0
    ? referencePrice * (1 + slippageDirection * slippageBps / 10_000)
    : 0;
  const quantity = executionPrice > 0 ? notional / executionPrice : 0;
  const expectedReturnPct = expectedReturnForOrder(intent, technical, horizon);
  const direction = side === "SELL" ? -1 : 1;
  const grossPnlPct = blocked ? 0 : round(direction * weightPct * expectedReturnPct / 100);
  const feePct = blocked ? 0 : round(weightPct * feeBps / 10_000);
  const slippagePct = blocked ? 0 : round(weightPct * slippageBps / 10_000);
  return {
    key: `bt-order-${index}-${intent.symbol}`,
    symbol: intent.symbol,
    name: intent.name,
    side,
    blocked,
    notional: round(notional),
    weightPct: round(weightPct),
    referencePrice: round(referencePrice),
    executionPrice: round(executionPrice),
    quantity: round(quantity),
    expectedReturnPct,
    grossPnlPct,
    feePct,
    slippagePct,
    netPnlPct: round(grossPnlPct - feePct - slippagePct),
  };
}

function expectedReturnForOrder(
  intent: OrderIntent,
  technical: TechnicalRow | undefined,
  horizon: BacktestHorizonStat | null,
) {
  const median = horizon?.medianReturnPct ?? horizon?.averageReturnPct ?? 0;
  const momentum = (technical?.return20d ?? technical?.return10d ?? 0) * 0.18;
  const meanReversion = technical?.rsi14 && technical.rsi14 < 35 ? 1.2 : technical?.rsi14 && technical.rsi14 > 72 ? -1.2 : 0;
  const statusAdjustment = intent.tone === "positive" ? 0.7 : intent.tone === "caution" ? -0.2 : intent.tone === "negative" ? -1 : 0;
  return round(clamp(median * 0.72 + momentum + meanReversion + statusAdjustment, -16, 18));
}

function sampleEdge(
  report: MarketAnalysisReport,
  score: StrategyScore,
  tradeHabit: TradeHabit,
  horizon: BacktestHorizonStat | null,
) {
  const median = horizon?.medianReturnPct ?? horizon?.averageReturnPct ?? 0;
  const sampleBoost = clamp(report.backtest.stateValidation.sampleCount / 120, 0, 1.8);
  const habitDrag = tradeHabit.tone === "negative" ? 1.8 : tradeHabit.tone === "caution" ? 0.8 : 0;
  return clamp((score.score - 50) / 8 + median * 0.46 + sampleBoost - habitDrag, -10, 12);
}

function buildBacktestEvents({
  costPct,
  finalCashWeight,
  netExposurePct,
  orders,
  pnlPct,
  report,
}: {
  costPct: number;
  finalCashWeight: number;
  netExposurePct: number;
  orders: BacktestSimulatedOrder[];
  pnlPct: number;
  report: MarketAnalysisReport;
}) {
  const events: BacktestEvent[] = [{
    key: "event-signal",
    at: report.asOf,
    type: "signal",
    symbol: report.backtest.benchmarkSymbol,
    label: "状态采样",
    detail: `${report.backtest.stateValidation.stateLabel} · n=${report.backtest.stateValidation.sampleCount}`,
    pnlPct: 0,
    cashWeight: round(finalCashWeight + netExposurePct),
    exposurePct: 0,
    tone: toneFromBacktest(report.backtest.stateValidation.tone),
  }];

  orders.forEach((order) => {
    if (order.blocked) {
      events.push({
        key: `event-blocked-${order.key}`,
        at: report.asOf,
        type: "blocked",
        symbol: order.symbol,
        label: "风控阻断",
        detail: `${order.side} ${order.symbol} 未进入撮合`,
        pnlPct: 0,
        cashWeight: round(finalCashWeight + netExposurePct),
        exposurePct: 0,
        tone: "negative",
      });
      return;
    }
    events.push({
      key: `event-fill-${order.key}`,
      at: report.asOf,
      type: "filled",
      symbol: order.symbol,
      label: "模拟成交",
      detail: `${order.side} ${order.symbol} · ${order.weightPct}% · 成本 ${formatPercent(order.feePct + order.slippagePct)}`,
      pnlPct: order.netPnlPct,
      cashWeight: finalCashWeight,
      exposurePct: order.side === "SELL" ? -order.weightPct : order.weightPct,
      tone: order.netPnlPct >= 0 ? "positive" : "caution",
    });
  });

  events.push({
    key: "event-cost",
    at: report.asOf,
    type: "cost",
    symbol: "portfolio",
    label: "成本扣减",
    detail: `手续费+滑点 ${formatPercent(costPct)}`,
    pnlPct: -round(costPct),
    cashWeight: finalCashWeight,
    exposurePct: netExposurePct,
    tone: costPct > 0.2 ? "caution" : "neutral",
  });
  events.push({
    key: "event-mark",
    at: report.asOf,
    type: "marked",
    symbol: "portfolio",
    label: "组合估值",
    detail: `净收益 ${formatPercent(pnlPct)} · 现金 ${formatPercent(finalCashWeight)}`,
    pnlPct,
    cashWeight: finalCashWeight,
    exposurePct: netExposurePct,
    tone: pnlPct > 0 ? "positive" : pnlPct < -2 ? "negative" : "neutral",
  });
  return events.slice(0, 18);
}

function equityReturnsFor({
  grossPnlPct,
  maxDrawdownPct,
  pnlPct,
  sampleEdgePct,
  winRatePct,
}: {
  grossPnlPct: number;
  maxDrawdownPct: number;
  pnlPct: number;
  sampleEdgePct: number;
  winRatePct: number;
}) {
  return [
    0,
    round(sampleEdgePct * 0.26),
    round(Math.min(grossPnlPct * 0.38, pnlPct * 0.4) + maxDrawdownPct * 0.12),
    round(grossPnlPct * 0.58),
    round(pnlPct * 0.78 + (winRatePct - 50) / 20),
    round(pnlPct),
  ];
}

function equityCurveFromReturns(returns: number[]): BacktestEquityCurve {
  const minReturn = Math.min(...returns, -4);
  const maxReturn = Math.max(...returns, 6);
  const span = Math.max(0.0001, maxReturn - minReturn);
  const pointItems = returns.map((value, index) => {
    const x = 16 + index * (388 / Math.max(1, returns.length - 1));
    const y = 112 - ((value - minReturn) / span) * 88;
    return `${round(x)},${round(y)}`;
  });
  const points = pointItems.join(" ");
  const area = `M16,118 L${pointItems.join(" L")} L404,118 Z`;
  return { area, maxReturn, minReturn, points };
}

function primaryHorizon(stats: BacktestHorizonStat[]) {
  return stats.find((item) => item.days === 20) ?? stats[0] ?? null;
}

function toneFromBacktest(tone: string): LabTone {
  if (tone === "positive" || tone === "negative" || tone === "caution") return tone;
  return "neutral";
}

function parseMoney(value: string) {
  const normalized = value.replace(/[,，]/g, "").match(/-?\d+(\.\d+)?/);
  return normalized ? Number(normalized[0]) : 0;
}

function parsePercent(value: string) {
  const normalized = value.replace(/[,，]/g, "").match(/-?\d+(\.\d+)?/);
  return normalized ? Number(normalized[0]) : 0;
}

function shortTimeLabel() {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date());
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function round(value: number) {
  return Math.round(value * 10) / 10;
}
