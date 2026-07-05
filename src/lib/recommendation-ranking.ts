import type { PositionPlanAction } from "./position-plan";
import type { RecommendationReadiness } from "./recommendation-readiness";
import type { OrderIntent, StrategyScore } from "./strategy-engine";
import type { MarketAnalysisReport, RecommendationPerformanceSlice } from "./types";
import type { RiskGuardResult } from "./risk-guard";
import { formatNumber } from "./utils";

export type RecommendationPriority = "P1" | "P2" | "P3" | "BLOCKED";

export type RankedRecommendation = {
  evidence: string;
  order: OrderIntent;
  priority: RecommendationPriority;
  priorityLabel: string;
  reason: string;
  score: number;
  tone: "positive" | "caution" | "negative" | "neutral";
};

export function rankRecommendations({
  actions,
  orders,
  readiness,
  report,
  strategyScore,
  guards = [],
}: {
  actions: PositionPlanAction[];
  orders: OrderIntent[];
  readiness: RecommendationReadiness;
  report: MarketAnalysisReport;
  strategyScore: StrategyScore;
  guards?: RiskGuardResult[];
}): RankedRecommendation[] {
  return orders
    .map((order) => rankRecommendation({
      action: actions.find((item) => item.key === order.key)
        ?? actions.find((item) => sameSymbol(item.symbol, order.symbol)),
      order,
      guard: guards.find((item) => item.intent.key === order.key),
      readiness,
      report,
      strategyScore,
    }))
    .sort((left, right) => priorityOrder(left.priority) - priorityOrder(right.priority) || right.score - left.score);
}

function rankRecommendation({
  action,
  order,
  guard,
  readiness,
  report,
  strategyScore,
}: {
  action?: PositionPlanAction;
  order: OrderIntent;
  guard?: RiskGuardResult;
  readiness: RecommendationReadiness;
  report: MarketAnalysisReport;
  strategyScore: StrategyScore;
}): RankedRecommendation {
  const sell = order.side.toUpperCase() === "SELL";
  const allowed = sell ? readiness.canExecute : readiness.canIncreaseRisk;
  const blocked = order.state === "已阻断" || !allowed || Boolean(guard?.blocked);
  const deviation = Math.abs(action?.weightDelta ?? parseWeight(order.weight));
  const deviationScore = Math.min(100, (deviation / 5) * 100);
  const riskFit = sell ? report.score : 100 - report.score;
  const performance = performanceFor(order.side, report.recommendationPerformance?.directions ?? []);
  const evidenceScore = performance && performance.sampleCount >= 20 && performance.hitRatePct != null
    ? performance.hitRatePct
    : 50;
  const score = Math.round(clamp(
    deviationScore * 0.35
      + riskFit * 0.25
      + readiness.confidenceScore * 0.2
      + readiness.dataQuality.score * 0.1
      + evidenceScore * 0.05
      + strategyScore.score * 0.05,
    0,
    100,
  ));
  const priority = priorityFor({ blocked, dataWarn: readiness.dataQuality.severity === "warn", score, sell });
  const reason = guard?.blocked
    ? guard.summary
    : action?.reason
    ? `${action.reason}；偏离 ${formatNumber(deviation, 1)}%`
    : `目标仓位偏离 ${formatNumber(deviation, 1)}%；策略分 ${formatNumber(strategyScore.score, 0)}`;

  return {
    evidence: guard?.blocked ? guard.summary : evidenceLabel(performance),
    order,
    priority,
    priorityLabel: priorityLabel(priority),
    reason,
    score,
    tone: priority === "P1" ? "positive" : priority === "BLOCKED" ? "negative" : priority === "P2" ? "caution" : "neutral",
  };
}

function priorityFor({
  blocked,
  dataWarn,
  score,
  sell,
}: {
  blocked: boolean;
  dataWarn: boolean;
  score: number;
  sell: boolean;
}): RecommendationPriority {
  if (blocked) return "BLOCKED";
  if (!dataWarn && score >= (sell ? 62 : 72)) return "P1";
  if (score >= 52) return "P2";
  return "P3";
}

function priorityLabel(priority: RecommendationPriority) {
  if (priority === "P1") return "今日复核";
  if (priority === "P2") return "计划执行";
  if (priority === "P3") return "等待触发";
  return "暂不执行";
}

function evidenceLabel(performance: RecommendationPerformanceSlice | undefined) {
  if (!performance || performance.sampleCount < 20) {
    return `真实样本 n=${performance?.sampleCount ?? 0}，暂不估算收益`;
  }
  const edge = performance.averageExcessReturnPct ?? performance.averageSignedReturnPct;
  const edgeLabel = edge == null ? "收益待补" : `历史${performance.averageExcessReturnPct != null ? "超额" : "方向收益"} ${signedPercent(edge)}`;
  const adverseLabel = performance.averageMaxAdversePct == null
    ? "不利波动待补"
    : `不利 ${signedPercent(-Math.abs(performance.averageMaxAdversePct))}`;
  return `${edgeLabel} · ${adverseLabel} · n=${performance.sampleCount}`;
}

function performanceFor(side: string, slices: RecommendationPerformanceSlice[]) {
  const key = side.toUpperCase() === "SELL" ? "SELL" : "BUY";
  return slices.find((slice) => slice.key.toUpperCase() === key);
}

function parseWeight(value: string) {
  const match = value.match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

function signedPercent(value: number) {
  return `${value > 0 ? "+" : ""}${formatNumber(value, 2)}%`;
}

function priorityOrder(priority: RecommendationPriority) {
  if (priority === "P1") return 0;
  if (priority === "P2") return 1;
  if (priority === "P3") return 2;
  return 3;
}

function sameSymbol(left: string, right: string) {
  return left.trim().toUpperCase() === right.trim().toUpperCase();
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
