import type { HoldingAssetType } from "./holdings";

export type SignalPolicyKey = "profile-decision" | "trend-confirmation" | "reversion-confirmation";
export type SizingPolicyKey = "plan-budget" | "fixed-fraction" | "volatility-budget";
export type BuiltInScalingPolicyKey = "single-entry" | "equal-tranches" | "bounded-average-down" | "pyramid-winners";
export type ScalingPolicyKey = BuiltInScalingPolicyKey | (string & {});
export type ExitPolicyKey = "profile-invalidation" | "target-band" | "defense-first";
export type RiskPolicyKey = "profile-guard";
export type ExecutionPolicyKey = "market-aware";
export type EvaluationPolicyKey = "closed-rounds";

export type StrategyPolicyBundle = {
  signal: SignalPolicyKey;
  sizing: SizingPolicyKey;
  scaling: ScalingPolicyKey;
  exit: ExitPolicyKey;
  risk: RiskPolicyKey;
  execution: ExecutionPolicyKey;
  evaluation: EvaluationPolicyKey;
};

export type StrategyPolicyConfig = {
  version: 1;
  scalingPolicyKey: ScalingPolicyKey;
  maxTranches: number;
  triggerPct: number;
  cooldownDays: number;
  trancheWeights: number[];
};

export type ScalingPolicyDefinition = {
  key: ScalingPolicyKey;
  label: string;
  shortLabel: string;
  detail: string;
  riskLabel: string;
  triggerDirection: "none" | "time" | "down" | "up";
  eligibleAssetTypes?: HoldingAssetType[];
  defaultConfig: StrategyPolicyConfig;
};

export type StrategyScalingRuntime = {
  instanceKey: string;
  completedEntries: number;
  openQuantity: number;
  lastEntryPrice: number | null;
  lastEntryDate: string;
};

export type StrategyRuntimeTrade = {
  runDate: string;
  symbol: string;
  side: "BUY" | "SELL";
  quantity: number;
  price: number;
  strategyKey?: string;
  scalingPolicyKey?: string;
  strategyInstanceKey?: string;
  trancheIndex?: number;
};

export type ScalingDecision = {
  allowed: boolean;
  policyKey: ScalingPolicyKey;
  policyLabel: string;
  instanceKey: string;
  trancheIndex: number;
  maxTranches: number;
  budgetFraction: number;
  stateLabel: string;
  detail: string;
  nextTriggerLabel: string;
};

export const SCALING_POLICIES: ScalingPolicyDefinition[] = [
  {
    key: "single-entry",
    label: "按建议执行",
    shortLabel: "单次",
    detail: "保持现有行为，直接使用组合建议与单笔预算。",
    riskLabel: "默认",
    triggerDirection: "none",
    defaultConfig: {
      version: 1,
      scalingPolicyKey: "single-entry",
      maxTranches: 1,
      triggerPct: 0,
      cooldownDays: 0,
      trancheWeights: [1],
    },
  },
  {
    key: "equal-tranches",
    label: "等额分批",
    shortLabel: "等额",
    detail: "按固定批次平均投入；不因浮亏放大下一笔。",
    riskLabel: "基准",
    triggerDirection: "time",
    defaultConfig: {
      version: 1,
      scalingPolicyKey: "equal-tranches",
      maxTranches: 3,
      triggerPct: 0,
      cooldownDays: 3,
      trancheWeights: [1, 1, 1],
    },
  },
  {
    key: "bounded-average-down",
    label: "受限递进",
    shortLabel: "递进",
    detail: "只对基金和 ETF 使用预设总预算递进；结构或风险失效即停止。",
    riskLabel: "审慎",
    triggerDirection: "down",
    eligibleAssetTypes: ["etf", "fund"],
    defaultConfig: {
      version: 1,
      scalingPolicyKey: "bounded-average-down",
      maxTranches: 3,
      triggerPct: 3,
      cooldownDays: 3,
      trancheWeights: [0.25, 0.3, 0.45],
    },
  },
  {
    key: "pyramid-winners",
    label: "顺势加仓",
    shortLabel: "顺势",
    detail: "价格继续确认后才递增仓位，不在浮亏时自动补仓。",
    riskLabel: "趋势",
    triggerDirection: "up",
    defaultConfig: {
      version: 1,
      scalingPolicyKey: "pyramid-winners",
      maxTranches: 3,
      triggerPct: 3,
      cooldownDays: 3,
      trancheWeights: [0.25, 0.3, 0.45],
    },
  },
];

export const DEFAULT_STRATEGY_POLICY_CONFIG = SCALING_POLICIES[0].defaultConfig;

export function scalingPolicyDefinition(key: ScalingPolicyKey) {
  return SCALING_POLICIES.find((policy) => policy.key === key) ?? SCALING_POLICIES[0];
}

export function registerScalingPolicy(policy: ScalingPolicyDefinition, replace = false) {
  const index = SCALING_POLICIES.findIndex((item) => item.key === policy.key);
  if (index >= 0 && !replace) return false;
  if (index >= 0) SCALING_POLICIES[index] = policy;
  else SCALING_POLICIES.push(policy);
  return true;
}

export function normalizeStrategyPolicyConfig(
  value: Partial<StrategyPolicyConfig> | null | undefined,
): StrategyPolicyConfig {
  const policy = scalingPolicyDefinition(isScalingPolicyKey(value?.scalingPolicyKey) ? value.scalingPolicyKey : "single-entry");
  const maxTranches = integerBetween(value?.maxTranches, 1, 5, policy.defaultConfig.maxTranches);
  const fallbackWeights = policy.defaultConfig.trancheWeights.slice(0, maxTranches);
  const suppliedWeights = Array.isArray(value?.trancheWeights)
    ? value.trancheWeights.slice(0, maxTranches).map((weight) => finiteBetween(weight, 0.01, 100, 0))
    : [];
  const trancheWeights = suppliedWeights.length === maxTranches && suppliedWeights.every((weight) => weight > 0)
    ? normalizeWeights(suppliedWeights)
    : normalizeWeights(fallbackWeights.length === maxTranches ? fallbackWeights : Array.from({ length: maxTranches }, () => 1));
  return {
    version: 1,
    scalingPolicyKey: policy.key,
    maxTranches,
    triggerPct: policy.triggerDirection === "down" || policy.triggerDirection === "up"
      ? finiteBetween(value?.triggerPct, 0.5, 15, policy.defaultConfig.triggerPct)
      : 0,
    cooldownDays: integerBetween(value?.cooldownDays, 0, 30, policy.defaultConfig.cooldownDays),
    trancheWeights,
  };
}

export function strategyScalingRuntimeBySymbol(
  trades: StrategyRuntimeTrade[],
  strategyKey: string,
  scalingPolicyKey: ScalingPolicyKey,
) {
  const bySymbol = new Map<string, StrategyScalingRuntime>();
  [...trades]
    .sort((left, right) => left.runDate.localeCompare(right.runDate))
    .forEach((trade) => {
      const symbol = symbolKey(trade.symbol);
      const current = bySymbol.get(symbol) ?? emptyRuntime();
      if (trade.side === "SELL") {
        if (!current.instanceKey) return;
        const openQuantity = Math.max(0, current.openQuantity - Math.max(0, trade.quantity));
        bySymbol.set(symbol, openQuantity > 1e-8 ? { ...current, openQuantity } : emptyRuntime());
        return;
      }
      if (trade.strategyKey !== strategyKey || trade.scalingPolicyKey !== scalingPolicyKey) return;
      bySymbol.set(symbol, {
        instanceKey: trade.strategyInstanceKey || current.instanceKey,
        completedEntries: Math.max(current.completedEntries + 1, trade.trancheIndex ?? 0),
        openQuantity: current.openQuantity + Math.max(0, trade.quantity),
        lastEntryPrice: trade.price > 0 ? trade.price : current.lastEntryPrice,
        lastEntryDate: trade.runDate || current.lastEntryDate,
      });
    });
  return Object.fromEntries(bySymbol.entries());
}

export function evaluateScalingPolicy({
  assetType,
  config: rawConfig,
  currentPrice,
  marketRiskScore,
  permissionBlocked,
  profileKey,
  runDate,
  runtime = emptyRuntime(),
  strategyKey,
  symbol,
}: {
  assetType?: HoldingAssetType;
  config: StrategyPolicyConfig;
  currentPrice: number | null;
  marketRiskScore: number;
  permissionBlocked: boolean;
  profileKey: string;
  runDate: string;
  runtime?: StrategyScalingRuntime;
  strategyKey: string;
  symbol: string;
}): ScalingDecision {
  const config = normalizeStrategyPolicyConfig(rawConfig);
  const policy = scalingPolicyDefinition(config.scalingPolicyKey);
  const trancheIndex = runtime.completedEntries + 1;
  const instanceKey = runtime.instanceKey || `${profileKey}:${strategyKey}:${policy.key}:${symbolKey(symbol)}:${runDate}`;
  const base = {
    policyKey: policy.key,
    policyLabel: policy.label,
    instanceKey,
    trancheIndex,
    maxTranches: config.maxTranches,
    budgetFraction: config.trancheWeights[Math.min(trancheIndex - 1, config.trancheWeights.length - 1)] ?? 0,
  };

  if (trancheIndex > config.maxTranches) {
    return blocked(base, "批次已用完", `已完成 ${runtime.completedEntries}/${config.maxTranches} 批，不再追加。`);
  }
  if (permissionBlocked || marketRiskScore >= 70) {
    return blocked(base, "风险门关闭", `市场风险 ${Math.round(marketRiskScore)}/100，递进策略暂停。`);
  }
  if (policy.eligibleAssetTypes?.length && (!assetType || !policy.eligibleAssetTypes.includes(assetType))) {
    return blocked(base, "标的不适用", `${policy.label}只允许：${policy.eligibleAssetTypes.join(" / ")}。`);
  }
  if (runtime.lastEntryDate && daysBetween(runtime.lastEntryDate, runDate) < config.cooldownDays) {
    return blocked(base, "冷却中", `距离上一批不足 ${config.cooldownDays} 个自然日。`);
  }
  if (runtime.completedEntries > 0 && (!(currentPrice && currentPrice > 0) || !(runtime.lastEntryPrice && runtime.lastEntryPrice > 0))) {
    return blocked(base, "等待价格", "缺少当前价格或上一批成交价，不能判断下一档。\n");
  }
  if (runtime.completedEntries > 0 && policy.triggerDirection === "down") {
    const trigger = (runtime.lastEntryPrice ?? 0) * (1 - config.triggerPct / 100);
    if ((currentPrice ?? Number.POSITIVE_INFINITY) > trigger) {
      return blocked(base, "等待回撤", `当前 ${formatPrice(currentPrice)}；下一批需不高于 ${formatPrice(trigger)}（较上一批 -${config.triggerPct}%）。`);
    }
  }
  if (runtime.completedEntries > 0 && policy.triggerDirection === "up") {
    const trigger = (runtime.lastEntryPrice ?? 0) * (1 + config.triggerPct / 100);
    if ((currentPrice ?? 0) < trigger) {
      return blocked(base, "等待确认", `当前 ${formatPrice(currentPrice)}；下一批需不低于 ${formatPrice(trigger)}（较上一批 +${config.triggerPct}%）。`);
    }
  }

  const nextTriggerLabel = policy.triggerDirection === "none"
    ? "本次建议执行后结束"
    : policy.triggerDirection === "time"
    ? `冷却 ${config.cooldownDays} 天后可评估下一批`
    : `${policy.triggerDirection === "down" ? "回撤" : "上涨"} ${config.triggerPct}% 后评估下一批`;
  return {
    ...base,
    allowed: true,
    stateLabel: `第 ${trancheIndex}/${config.maxTranches} 批`,
    detail: `${policy.label} · 使用策略总预算的 ${formatPercent(base.budgetFraction)}。`,
    nextTriggerLabel,
  };
}

function blocked(
  base: Omit<ScalingDecision, "allowed" | "stateLabel" | "detail" | "nextTriggerLabel">,
  stateLabel: string,
  detail: string,
): ScalingDecision {
  return { ...base, allowed: false, stateLabel, detail: detail.trim(), nextTriggerLabel: detail.trim() };
}

function emptyRuntime(): StrategyScalingRuntime {
  return { instanceKey: "", completedEntries: 0, openQuantity: 0, lastEntryPrice: null, lastEntryDate: "" };
}

function isScalingPolicyKey(value: unknown): value is ScalingPolicyKey {
  return typeof value === "string" && SCALING_POLICIES.some((policy) => policy.key === value);
}

function normalizeWeights(weights: number[]) {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  return total > 0 ? weights.map((weight) => weight / total) : [1];
}

function integerBetween(value: unknown, min: number, max: number, fallback: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.round(value)))
    : fallback;
}

function finiteBetween(value: unknown, min: number, max: number, fallback: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

function daysBetween(left: string, right: string) {
  const start = Date.parse(`${left}T00:00:00Z`);
  const end = Date.parse(`${right}T00:00:00Z`);
  return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, (end - start) / 86_400_000) : 0;
}

function symbolKey(value: string) {
  return value.trim().toUpperCase();
}

function formatPrice(value: number | null) {
  return value && Number.isFinite(value) ? value.toFixed(value < 10 ? 3 : 2) : "—";
}

function formatPercent(value: number) {
  return `${(value * 100).toFixed(value < 0.1 ? 1 : 0)}%`;
}
