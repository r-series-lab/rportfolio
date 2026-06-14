import type { AssetStatus, FactorScore, MarketAnalysisReport, StructureSignal } from "./types";

export type DecisionMetric = {
  label: string;
  value: number;
  tone: string;
  strong?: boolean;
};

export function decisionMetricsFor(report: MarketAnalysisReport): DecisionMetric[] {
  const trend = factorFor(report.factorScores, "trend")?.score ?? 50;
  const structure = factorFor(report.factorScores, "structure")?.score ?? 50;
  const systemic = factorFor(report.factorScores, "systemic")?.score ?? 50;
  const trade = report.opportunityScores.find((item) => item.horizonKey === "short")?.score
    ?? factorFor(report.factorScores, "opportunity")?.score
    ?? 50;
  const consistency = structureConsistencyFor(report);
  const quality = Math.min(
    trendQualityCap(consistency),
    Math.round(trend * 0.45 + structure * 0.35 + (100 - systemic) * 0.2),
  );

  return [
    { label: "趋势质量", value: quality, tone: "index", strong: true },
    { label: "结构一致", value: consistency, tone: consistencyTone(consistency) },
    { label: "交易买点", value: trade, tone: tradeTone(trade) },
  ];
}

function structureConsistencyFor(report: MarketAnalysisReport) {
  const base = assetConsistencyScore(report.assetStatuses);
  const leader = report.structure.signals.find((item) => item.key === "leader");
  const leaderScore = leader ? leaderScoreFor(leader) : base;
  let score = Math.round(base * 0.55 + leaderScore * 0.45);

  if (report.marketState.key === "trend_repair_leader_divergence") {
    score = Math.min(score, 58);
  } else if (report.marketState.key === "strong_trend_divergence") {
    score = Math.min(score, 65);
  } else if (report.marketState.key === "strong_trend_pullback_watch") {
    score = Math.min(score, 72);
  }

  return score;
}

function assetConsistencyScore(assets: AssetStatus[]) {
  if (!assets.length) return 50;
  const total = assets.reduce((sum, asset) => {
    if (asset.status === "green") return sum + 100;
    if (asset.status === "yellow") return sum + 65;
    if (asset.status === "red") return sum + 35;
    return sum + 50;
  }, 0);
  return Math.round(total / assets.length);
}

function leaderScoreFor(signal: StructureSignal) {
  if (signal.tone === "positive") return 76;
  if (signal.tone === "neutral") return 60;
  if (signal.tone === "caution") return 55;
  return 35;
}

function trendQualityCap(consistency: number) {
  if (consistency < 55) return 82;
  if (consistency < 70) return 88;
  if (consistency < 85) return 94;
  return 96;
}

function consistencyTone(score: number) {
  if (score >= 75) return "leader";
  if (score >= 55) return "composite";
  return "negative";
}

function tradeTone(score: number) {
  if (score >= 75) return "leader";
  if (score >= 55) return "composite";
  if (score >= 35) return "caution";
  return "negative";
}

function factorFor(factors: FactorScore[], key: string) {
  return factors.find((item) => item.key === key);
}
