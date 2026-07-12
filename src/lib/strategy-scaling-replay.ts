import type { StateReplaySample } from "./types";
import {
  normalizeStrategyPolicyConfig,
  SCALING_POLICIES,
  scalingPolicyDefinition,
  type ScalingPolicyKey,
  type StrategyPolicyConfig,
} from "./strategy-policies";

export type ScalingReplayEvidence = "insufficient" | "preliminary" | "reviewable";

export type ScalingReplayMetric = {
  policyKey: ScalingPolicyKey;
  label: string;
  sampleCount: number;
  medianNetReturnPct: number;
  winRatePct: number;
  medianMaxDrawdownPct: number;
  tailAverageReturnPct: number;
  averageCapitalUtilizationPct: number;
  averageTranches: number;
  score: number | null;
};

export type ScalingReplayComparison = {
  horizonDays: number;
  sampleCount: number;
  exactSampleCount: number;
  evidence: ScalingReplayEvidence;
  evidenceLabel: string;
  winnerKey: ScalingPolicyKey | null;
  metrics: ScalingReplayMetric[];
  methodology: string;
};

type SampleResult = {
  netReturnPct: number;
  maxDrawdownPct: number;
  averageCapitalUtilizationPct: number;
  tranches: number;
};

const ENTRY_FEE_RATE = 0.001;
const EXIT_FEE_RATE = 0.001;
const SLIPPAGE_RATE = 0.002;

export function compareScalingPolicies({
  activeConfig,
  samples,
}: {
  activeConfig?: StrategyPolicyConfig;
  samples: StateReplaySample[];
}): ScalingReplayComparison {
  const validSamples = samples.filter((sample) => validPath(sample.pathReturnsPct));
  const sampleCount = validSamples.length;
  const evidence: ScalingReplayEvidence = sampleCount >= 30
    ? "reviewable"
    : sampleCount >= 10
      ? "preliminary"
      : "insufficient";
  const metrics = SCALING_POLICIES.map((policy) => {
    const config = activeConfig?.scalingPolicyKey === policy.key
      ? normalizeStrategyPolicyConfig(activeConfig)
      : normalizeStrategyPolicyConfig(policy.defaultConfig);
    return summarizePolicy(policy.key, config, validSamples);
  });
  const ranked = evidence === "reviewable"
    ? [...metrics].sort((left, right) => (right.score ?? -Infinity) - (left.score ?? -Infinity))
    : [];

  return {
    horizonDays: validSamples[0]?.pathReturnsPct.length ? validSamples[0].pathReturnsPct.length - 1 : 20,
    sampleCount,
    exactSampleCount: validSamples.filter((sample) => sample.exactStateMatch).length,
    evidence,
    evidenceLabel: evidence === "reviewable"
      ? "可复核比较"
      : evidence === "preliminary"
        ? "初步观察，不排名"
        : `样本不足，至少还需 ${Math.max(0, 10 - sampleCount)} 条`,
    winnerKey: ranked[0]?.policyKey ?? null,
    metrics,
    methodology: "同状态/相似状态的基准指数路径代理；每次固定总预算，统一计入单边 10 bps 费用与 20 bps 滑点。不是标的级收益承诺。",
  };
}

function summarizePolicy(
  policyKey: ScalingPolicyKey,
  config: StrategyPolicyConfig,
  samples: StateReplaySample[],
): ScalingReplayMetric {
  const results = samples.map((sample) => replayPath(sample.pathReturnsPct, config));
  const returns = results.map((item) => item.netReturnPct);
  const drawdowns = results.map((item) => item.maxDrawdownPct);
  const tailSize = Math.max(1, Math.ceil(returns.length * 0.1));
  const tail = [...returns].sort((a, b) => a - b).slice(0, tailSize);
  const medianNetReturnPct = median(returns);
  const medianMaxDrawdownPct = median(drawdowns);
  const tailAverageReturnPct = average(tail);
  const evidenceReady = results.length >= 30;
  return {
    policyKey,
    label: scalingPolicyDefinition(policyKey).label,
    sampleCount: results.length,
    medianNetReturnPct: round(medianNetReturnPct),
    winRatePct: round(rate(returns.filter((value) => value > 0).length, returns.length)),
    medianMaxDrawdownPct: round(medianMaxDrawdownPct),
    tailAverageReturnPct: round(tailAverageReturnPct),
    averageCapitalUtilizationPct: round(average(results.map((item) => item.averageCapitalUtilizationPct))),
    averageTranches: round(average(results.map((item) => item.tranches)), 2),
    score: evidenceReady
      ? round(medianNetReturnPct + medianMaxDrawdownPct * 0.35 + tailAverageReturnPct * 0.2, 4)
      : null,
  };
}

function replayPath(pathReturnsPct: number[], rawConfig: StrategyPolicyConfig): SampleResult {
  const config = normalizeStrategyPolicyConfig(rawConfig);
  const policy = scalingPolicyDefinition(config.scalingPolicyKey);
  const prices = pathReturnsPct.map((value) => Math.max(0.0001, 1 + value / 100));
  let cash = 1;
  let units = 0;
  let investedBudget = 0;
  let lastEntryDay = -Infinity;
  let lastEntryPrice = 0;
  let tranches = 0;
  let peakEquity = 1;
  let maxDrawdownPct = 0;
  let utilizationTotal = 0;

  prices.forEach((price, day) => {
    const weight = config.trancheWeights[tranches] ?? 0;
    if (weight > 0 && shouldEnter({ config, day, lastEntryDay, lastEntryPrice, policyDirection: policy.triggerDirection, price, tranches })) {
      const allocation = Math.min(cash, weight);
      const entryPrice = price * (1 + SLIPPAGE_RATE);
      units += allocation * (1 - ENTRY_FEE_RATE) / entryPrice;
      cash -= allocation;
      investedBudget += allocation;
      lastEntryDay = day;
      lastEntryPrice = price;
      tranches += 1;
    }
    const equity = cash + units * price;
    peakEquity = Math.max(peakEquity, equity);
    maxDrawdownPct = Math.min(maxDrawdownPct, (equity / peakEquity - 1) * 100);
    utilizationTotal += investedBudget * 100;
  });

  const exitPrice = prices[prices.length - 1] * (1 - SLIPPAGE_RATE);
  const finalEquity = cash + units * exitPrice * (1 - EXIT_FEE_RATE);
  return {
    netReturnPct: (finalEquity - 1) * 100,
    maxDrawdownPct,
    averageCapitalUtilizationPct: utilizationTotal / prices.length,
    tranches,
  };
}

function shouldEnter({
  config,
  day,
  lastEntryDay,
  lastEntryPrice,
  policyDirection,
  price,
  tranches,
}: {
  config: StrategyPolicyConfig;
  day: number;
  lastEntryDay: number;
  lastEntryPrice: number;
  policyDirection: "none" | "time" | "down" | "up";
  price: number;
  tranches: number;
}) {
  if (tranches >= config.maxTranches) return false;
  if (tranches === 0) return day === 0;
  if (policyDirection === "none") return false;
  if (day - lastEntryDay < config.cooldownDays) return false;
  if (policyDirection === "time") return true;
  if (policyDirection === "down") return price <= lastEntryPrice * (1 - config.triggerPct / 100);
  return price >= lastEntryPrice * (1 + config.triggerPct / 100);
}

function validPath(path: number[]) {
  return Array.isArray(path) && path.length >= 2 && path.every(Number.isFinite);
}

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function rate(count: number, total: number) {
  return total ? count / total * 100 : 0;
}

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
