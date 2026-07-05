import type { HoldingRecord } from "./holdings";
import type { PortfolioOverlapPair } from "./portfolio-overlap";
import { formatNumber } from "./utils";

export type FundQualitySnapshot = {
  symbol: string;
  score: number | null;
  sampleCount: number;
  return60: number | null;
  return120: number | null;
  drawdown120: number | null;
  volatility60: number | null;
};

export type FundSubstitutionDecision = {
  key: string;
  preferredSymbol: string | null;
  secondarySymbol: string | null;
  action: "replace-candidate" | "prefer-hold" | "keep-both" | "insufficient";
  label: string;
  summary: string;
  scoreGap: number | null;
  leftQuality: FundQualitySnapshot;
  rightQuality: FundQualitySnapshot;
};

export function assessFundSubstitutions(
  holdings: HoldingRecord[],
  pairs: PortfolioOverlapPair[],
) {
  const bySymbol = new Map(holdings.map((holding) => [normalizeSymbol(holding.symbol), holding]));
  const decisions = pairs.map((pair) => {
    const left = bySymbol.get(normalizeSymbol(pair.left));
    const right = bySymbol.get(normalizeSymbol(pair.right));
    return substitutionDecision(pair, left, right);
  });
  return {
    decisions,
    primary: decisions.find((item) => item.action === "replace-candidate")
      ?? decisions.find((item) => item.action === "prefer-hold")
      ?? decisions[0]
      ?? null,
  };
}

export function substitutionForHolding(
  holdings: HoldingRecord[],
  pair: PortfolioOverlapPair,
  symbol: string,
) {
  const assessment = assessFundSubstitutions(holdings, [pair]);
  const decision = assessment.primary;
  if (!decision) return null;
  const key = normalizeSymbol(symbol);
  return {
    ...decision,
    isPreferred: decision.preferredSymbol != null && normalizeSymbol(decision.preferredSymbol) === key,
    isSecondary: decision.secondarySymbol != null && normalizeSymbol(decision.secondarySymbol) === key,
  };
}

function substitutionDecision(
  pair: PortfolioOverlapPair,
  left: HoldingRecord | undefined,
  right: HoldingRecord | undefined,
): FundSubstitutionDecision {
  const leftQuality = qualityFor(left, pair.left);
  const rightQuality = qualityFor(right, pair.right);
  const base = {
    key: `${pair.left}:${pair.right}`,
    leftQuality,
    rightQuality,
  };
  if (leftQuality.score == null || rightQuality.score == null) {
    return {
      ...base,
      preferredSymbol: null,
      secondarySymbol: null,
      action: "insufficient",
      label: "证据不足",
      summary: `${pair.left} / ${pair.right} 的共同净值样本不足 60 个，保持现状，不做替换结论。`,
      scoreGap: null,
    };
  }

  const leftPreferred = leftQuality.score >= rightQuality.score;
  const preferred = leftPreferred ? leftQuality : rightQuality;
  const secondary = leftPreferred ? rightQuality : leftQuality;
  const gap = Math.abs(leftQuality.score - rightQuality.score);
  if (gap < 8) {
    return {
      ...base,
      preferredSymbol: null,
      secondarySymbol: null,
      action: "keep-both",
      label: "保持现状",
      summary: `${pair.left} / ${pair.right} 质量分仅差 ${formatNumber(gap, 0)} 分；暂停新增重合仓位，不为小差异换仓。`,
      scoreGap: gap,
    };
  }

  const strongEvidence = gap >= 15
    && pair.evidence === "combined"
    && Math.min(leftQuality.sampleCount, rightQuality.sampleCount) >= 90;
  return {
    ...base,
    preferredSymbol: preferred.symbol,
    secondarySymbol: secondary.symbol,
    action: strongEvidence ? "replace-candidate" : "prefer-hold",
    label: strongEvidence ? "替换候选" : "优先保留",
    summary: strongEvidence
      ? `优先保留 ${preferred.symbol}（${preferred.score} 分）；${secondary.symbol}（${secondary.score} 分）停止新增，超目标带时再分批替换。`
      : `优先保留 ${preferred.symbol}（${preferred.score} 分）；${secondary.symbol}（${secondary.score} 分）暂停新增，等待更强证据再替换。`,
    scoreGap: gap,
  };
}

function qualityFor(holding: HoldingRecord | undefined, fallbackSymbol: string): FundQualitySnapshot {
  const points = [...(holding?.fundNavHistory ?? [])]
    .filter((point) => point.date && Number.isFinite(point.nav) && point.nav > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  const returns = points.slice(1).map((point, index) => point.nav / points[index].nav - 1);
  const sampleCount = returns.length;
  const return60 = periodReturn(points, 60);
  const return120 = periodReturn(points, 120);
  const drawdown120 = maxDrawdown(points.slice(-121));
  const volatility60 = annualizedVolatility(returns.slice(-60));
  if (sampleCount < 60 || return60 == null || drawdown120 == null || volatility60 == null) {
    return {
      symbol: holding?.symbol ?? fallbackSymbol,
      score: null,
      sampleCount,
      return60,
      return120,
      drawdown120,
      volatility60,
    };
  }

  const momentumScore = scale(return60, -15, 15, 0, 25)
    + (return120 == null ? 7.5 : scale(return120, -25, 25, 0, 15));
  const drawdownScore = scale(drawdown120, -30, 0, 0, 20);
  const volatilityScore = scale(volatility60, 45, 12, 0, 15);
  const tradeScore = holding?.fundPurchaseOpen === false
    ? 0
    : holding?.fundPurchaseLimit != null && holding.fundPurchaseLimit < 100
      ? 3
      : holding?.fundPurchaseOpen === true
        ? 15
        : 7;
  const evidenceScore = Math.min(10, sampleCount / 12)
    + ((holding?.fundTopHoldings?.length ?? 0) >= 5 ? 5 : 0);
  const score = Math.round(clamp(momentumScore + drawdownScore + volatilityScore + tradeScore + evidenceScore, 0, 100));
  return {
    symbol: holding?.symbol ?? fallbackSymbol,
    score,
    sampleCount,
    return60,
    return120,
    drawdown120,
    volatility60,
  };
}

function periodReturn(points: Array<{ nav: number }>, periods: number) {
  if (points.length < periods + 1) return null;
  const current = points[points.length - 1]?.nav;
  const previous = points[points.length - periods - 1]?.nav;
  if (!current || !previous) return null;
  return (current / previous - 1) * 100;
}

function maxDrawdown(points: Array<{ nav: number }>) {
  if (points.length < 2) return null;
  let peak = points[0].nav;
  let drawdown = 0;
  points.forEach((point) => {
    peak = Math.max(peak, point.nav);
    drawdown = Math.min(drawdown, (point.nav / peak - 1) * 100);
  });
  return drawdown;
}

function annualizedVolatility(returns: number[]) {
  if (returns.length < 20) return null;
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (returns.length - 1);
  return Math.sqrt(variance * 252) * 100;
}

function scale(value: number, min: number, max: number, outputMin: number, outputMax: number) {
  if (min === max) return outputMin;
  return outputMin + clamp((value - min) / (max - min), 0, 1) * (outputMax - outputMin);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normalizeSymbol(value: string) {
  return value.trim().toUpperCase();
}
