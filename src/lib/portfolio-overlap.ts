import type { HoldingRecord } from "./holdings";
import { formatNumber } from "./utils";

export type PortfolioOverlapCluster = {
  key: string;
  label: string;
  symbols: string[];
  weight: number;
  tone: "neutral" | "caution";
};

export type PortfolioOverlapAssessment = {
  clusters: PortfolioOverlapCluster[];
  pairs: PortfolioOverlapPair[];
  summary: string;
};

export type PortfolioOverlapPair = {
  left: string;
  right: string;
  overlapWeight: number;
  commonSymbols: string[];
  asOf: string;
  correlation60: number | null;
  correlation120: number | null;
  sample60: number;
  sample120: number;
  evidence: "combined" | "holdings" | "returns";
};

const EXPOSURE_RULES: Array<{ key: string; label: string; pattern: RegExp }> = [
  { key: "technology-growth", label: "科技成长", pattern: /科技|数字经济|纳斯达克|半导体|芯片|人工智能|\bAI\b/i },
  { key: "us-equity", label: "美国权益", pattern: /标普|纳斯达克|美国|美股|S&P|NASDAQ/i },
  { key: "offshore-china", label: "离岸中国", pattern: /恒生|港股|中概|海外中国/i },
  { key: "emerging-market", label: "新兴市场", pattern: /新兴市场|韩国|印度|东南亚/i },
];

export function assessPortfolioOverlap(
  holdings: HoldingRecord[],
  totalValue: number,
): PortfolioOverlapAssessment {
  if (totalValue <= 0) return { clusters: [], pairs: [], summary: "组合重叠待评估" };
  const grouped = new Map<string, { label: string; symbols: Set<string>; value: number }>();

  holdings
    .filter((holding) => holding.role === "real" && (holding.assetType === "fund" || holding.assetType === "etf"))
    .forEach((holding) => {
      const value = Math.max(0, holding.quantity * holding.currentPrice);
      if (!value) return;
      exposureKeysFor(holding).forEach(({ key, label }) => {
        const current = grouped.get(key) ?? { label, symbols: new Set<string>(), value: 0 };
        current.symbols.add(holding.symbol);
        current.value += value;
        grouped.set(key, current);
      });
    });

  const clusters = Array.from(grouped.entries())
    .map(([key, group]) => ({
      key,
      label: group.label,
      symbols: Array.from(group.symbols),
      weight: (group.value / totalValue) * 100,
      tone: group.value / totalValue >= 0.15 ? "caution" as const : "neutral" as const,
    }))
    .filter((cluster) => cluster.symbols.length >= 2 && cluster.weight >= 8)
    .sort((left, right) => right.weight - left.weight);

  const penetrated = holdings.filter((holding) => holding.role === "real" && (
    (holding.fundTopHoldings?.length ?? 0) >= 3
    || (holding.fundNavHistory?.length ?? 0) >= 31
  ));
  const pairs: PortfolioOverlapPair[] = [];
  for (let leftIndex = 0; leftIndex < penetrated.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < penetrated.length; rightIndex += 1) {
      const left = penetrated[leftIndex];
      const right = penetrated[rightIndex];
      const rightWeights = new Map(
        (right.fundTopHoldings ?? []).map((item) => [normalizeSymbol(item.symbol), item.weight]),
      );
      const common = (left.fundTopHoldings ?? [])
        .map((item) => ({
          symbol: normalizeSymbol(item.symbol),
          weight: Math.min(item.weight, rightWeights.get(normalizeSymbol(item.symbol)) ?? 0),
        }))
        .filter((item) => item.weight > 0)
        .sort((a, b) => b.weight - a.weight);
      const overlapWeight = common.reduce((sum, item) => sum + item.weight, 0);
      const correlation = navCorrelation(left, right);
      const correlated = (correlation.correlation60 ?? -1) >= 0.8
        || (correlation.correlation120 ?? -1) >= 0.8;
      if (overlapWeight < 5 && !correlated) continue;
      const evidence = overlapWeight >= 5 && correlated
        ? "combined" as const
        : overlapWeight >= 5
          ? "holdings" as const
          : "returns" as const;
      pairs.push({
        left: left.symbol,
        right: right.symbol,
        overlapWeight,
        commonSymbols: common.slice(0, 4).map((item) => item.symbol),
        asOf: latestCommonDate(left.fundHoldingsAsOf, right.fundHoldingsAsOf),
        ...correlation,
        evidence,
      });
    }
  }
  pairs.sort((left, right) => pairRiskScore(right) - pairRiskScore(left));

  const primaryPair = pairs[0];
  const primary = clusters[0];
  return {
    clusters,
    pairs,
    summary: primaryPair
      ? pairSummary(primaryPair)
      : primary
      ? `${primary.label} ${formatNumber(primary.weight, 1)}% · ${primary.symbols.length} 只重叠`
      : "未发现需要提示的同主题重叠",
  };
}

export function overlapClusterForHolding(
  holdings: HoldingRecord[],
  symbol: string,
  totalValue: number,
) {
  const key = symbol.trim().toUpperCase();
  return assessPortfolioOverlap(holdings, totalValue).clusters.find((cluster) =>
    cluster.symbols.some((item) => item.trim().toUpperCase() === key)
  ) ?? null;
}

export function overlapPairForHolding(
  holdings: HoldingRecord[],
  symbol: string,
  totalValue: number,
) {
  const key = normalizeSymbol(symbol);
  return assessPortfolioOverlap(holdings, totalValue).pairs.find((pair) =>
    normalizeSymbol(pair.left) === key || normalizeSymbol(pair.right) === key
  ) ?? null;
}

function exposureKeysFor(holding: HoldingRecord) {
  const text = `${holding.name} ${holding.notes} ${holding.profileKey ?? ""}`;
  return EXPOSURE_RULES.filter((rule) => rule.pattern.test(text)).map(({ key, label }) => ({ key, label }));
}

function normalizeSymbol(value: string) {
  return value.trim().toUpperCase().replace(/^\d+\./, "");
}

function latestCommonDate(left: string | undefined, right: string | undefined) {
  if (left && right) return left < right ? left : right;
  return left || right || "报告期待确认";
}

function navCorrelation(left: HoldingRecord, right: HoldingRecord) {
  const leftReturns = navReturns(left.fundNavHistory ?? []);
  const rightReturns = navReturns(right.fundNavHistory ?? []);
  const joined = Array.from(leftReturns.entries())
    .filter(([date]) => rightReturns.has(date))
    .map(([date, leftReturn]) => ({ date, left: leftReturn, right: rightReturns.get(date)! }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const window60 = joined.slice(-60);
  const window120 = joined.slice(-120);
  return {
    correlation60: window60.length >= 30 ? pearson(window60.map((item) => item.left), window60.map((item) => item.right)) : null,
    correlation120: window120.length >= 60 ? pearson(window120.map((item) => item.left), window120.map((item) => item.right)) : null,
    sample60: window60.length,
    sample120: window120.length,
  };
}

function navReturns(points: Array<{ date: string; nav: number }>) {
  const sorted = [...points]
    .filter((point) => point.date && Number.isFinite(point.nav) && point.nav > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  const returns = new Map<string, number>();
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1].nav;
    returns.set(sorted[index].date, sorted[index].nav / previous - 1);
  }
  return returns;
}

function pearson(left: number[], right: number[]) {
  if (left.length !== right.length || left.length < 2) return null;
  const leftMean = left.reduce((sum, value) => sum + value, 0) / left.length;
  const rightMean = right.reduce((sum, value) => sum + value, 0) / right.length;
  let covariance = 0;
  let leftVariance = 0;
  let rightVariance = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftDelta = left[index] - leftMean;
    const rightDelta = right[index] - rightMean;
    covariance += leftDelta * rightDelta;
    leftVariance += leftDelta ** 2;
    rightVariance += rightDelta ** 2;
  }
  const denominator = Math.sqrt(leftVariance * rightVariance);
  return denominator > 0 ? covariance / denominator : null;
}

function pairRiskScore(pair: PortfolioOverlapPair) {
  return pair.overlapWeight + Math.max(0, pair.correlation60 ?? 0) * 30 + Math.max(0, pair.correlation120 ?? 0) * 15;
}

function pairSummary(pair: PortfolioOverlapPair) {
  const evidence = [
    pair.overlapWeight >= 5 ? `前十大重合 ${formatNumber(pair.overlapWeight, 1)}%` : "",
    pair.correlation60 != null ? `60日相关 ${formatNumber(pair.correlation60, 2)}` : "",
    pair.correlation120 != null ? `120日相关 ${formatNumber(pair.correlation120, 2)}` : "",
  ].filter(Boolean).join(" · ");
  return `${pair.left} / ${pair.right} ${evidence}`;
}
