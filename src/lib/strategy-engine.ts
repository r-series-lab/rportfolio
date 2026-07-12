import type { PositionPlan, PositionPlanTone } from "./position-plan";
import { priceActionForSymbol } from "./price-action";
import type { TradeHabit } from "./trades";
import type { DecisionAxis, MarketAnalysisReport } from "./types";
import { formatMoney } from "./utils";
import {
  DEFAULT_STRATEGY_POLICY_CONFIG,
  evaluateScalingPolicy,
  normalizeStrategyPolicyConfig,
  scalingPolicyDefinition,
  type ScalingDecision,
  type StrategyPolicyBundle,
  type StrategyPolicyConfig,
  type StrategyScalingRuntime,
} from "./strategy-policies";

export type LabTone = "positive" | "neutral" | "caution" | "negative";
export type BuiltInStrategyKey = "risk-gated-trend" | "reversion-probe" | "rebalance-band" | "defense-first";
export type StrategyKey = BuiltInStrategyKey | (string & {});
export type QbotPresetKey = "rsi-single-factor" | "roc-momentum" | "boll-reversion" | "multi-factor-top1" | "btc-grid";

export type StrategyDefinition = {
  key: StrategyKey;
  label: string;
  shortLabel: string;
  mode: string;
  benchmark: string;
  detail: string;
  policies: StrategyPolicyBundle;
};

export type QbotPreset = {
  key: QbotPresetKey;
  label: string;
  strategy: string;
  tradeType: string;
  platform: string;
  detail: string;
  mapsTo: StrategyKey;
};

export type StrategyScore = {
  score: number;
  tone: LabTone;
  label: string;
  permission: string;
  summary: string;
};

export type StrategySignal = {
  key: string;
  label: string;
  value: string;
  tone: LabTone;
  detail: string;
};

export type OrderIntent = {
  key: string;
  symbol: string;
  name: string;
  side: string;
  state: string;
  tone: LabTone;
  amount: string;
  weight: string;
  detail: string;
  replacementLink?: ReplacementOrderLink;
  scaling?: ScalingDecision;
};

export type ReplacementOrderLink = {
  id: string;
  stage: "redeem" | "subscribe";
  sourceSymbol: string;
  targetSymbol: string;
  targetName: string;
  remainingBuyAmount: number;
  batchAmount: number;
  sellFeeRatePct: number;
};

export type StrategyEngineInput = {
  budgetWeight: number;
  positionPlan: PositionPlan;
  report: MarketAnalysisReport;
  riskOverride: boolean;
  strategyKey: StrategyKey;
  tradeHabit: TradeHabit;
  policyConfig?: StrategyPolicyConfig;
  runtimeBySymbol?: Record<string, StrategyScalingRuntime>;
};

export type StrategyEvaluation = {
  orderIntents: OrderIntent[];
  score: StrategyScore;
  signals: StrategySignal[];
  strategy: StrategyDefinition;
  policyConfig: StrategyPolicyConfig;
};

export type RegisteredStrategy = {
  definition: StrategyDefinition;
  buildOrders: (input: StrategyEngineInput, score: StrategyScore) => OrderIntent[];
  buildSignals: (input: StrategyEngineInput) => StrategySignal[];
  score: (input: StrategyEngineInput) => StrategyScore;
};

export const STRATEGIES: StrategyDefinition[] = [
  {
    key: "risk-gated-trend",
    label: "风险门趋势",
    shortLabel: "趋势",
    mode: "顺势",
    benchmark: "趋势 / 风险 / 赔率",
    detail: "Profile 风险门通过后才排入分批模拟单。",
    policies: policyBundle("trend-confirmation", "profile-invalidation"),
  },
  {
    key: "reversion-probe",
    label: "回撤试探",
    shortLabel: "回撤",
    mode: "试探",
    benchmark: "损伤 / 样本 / 支撑",
    detail: "只给小额试探单，验证回撤后的结构修复。",
    policies: policyBundle("reversion-confirmation", "profile-invalidation"),
  },
  {
    key: "rebalance-band",
    label: "目标带再平衡",
    shortLabel: "目标",
    mode: "再平衡",
    benchmark: "现金 / 目标带 / 上限",
    detail: "围绕目标带生成再平衡队列。",
    policies: policyBundle("profile-decision", "target-band"),
  },
  {
    key: "defense-first",
    label: "防守优先",
    shortLabel: "防守",
    mode: "防守",
    benchmark: "风险 / 损伤 / 止损",
    detail: "风险升高时只保留减速和降仓动作。",
    policies: policyBundle("profile-decision", "defense-first"),
  },
];

export const QBOT_PRESETS: QbotPreset[] = [
  {
    key: "rsi-single-factor",
    label: "RSI 单因子",
    strategy: "单因子-相对强弱指数RSI",
    tradeType: "股票",
    platform: "东方财富",
    detail: "沿用 Qbot 回测面板默认策略，适合做反转/超买超卖验证。",
    mapsTo: "reversion-probe",
  },
  {
    key: "roc-momentum",
    label: "ROC 动量",
    strategy: "ROC(20)动量信号周频Top1",
    tradeType: "股票",
    platform: "东方财富",
    detail: "来自 Qbot 多因子配置，用于趋势强度和轮动候选。",
    mapsTo: "risk-gated-trend",
  },
  {
    key: "boll-reversion",
    label: "BOLL 回归",
    strategy: "布林带均值回归",
    tradeType: "基金",
    platform: "东方财富",
    detail: "把波动带作为试探单过滤器，降低追涨概率。",
    mapsTo: "reversion-probe",
  },
  {
    key: "multi-factor-top1",
    label: "多因子 Top1",
    strategy: "多因子-动量质量低波Top1",
    tradeType: "股票",
    platform: "东方财富",
    detail: "组合股票池里只推最高分标的，适合小账户集中验证。",
    mapsTo: "rebalance-band",
  },
  {
    key: "btc-grid",
    label: "BTC 网格",
    strategy: "BTC 现货网格",
    tradeType: "BTC",
    platform: "欧易OKX",
    detail: "对齐 Qbot 的 BTC/OKX 交易入口，作为加密资产通道预设。",
    mapsTo: "defense-first",
  },
];

export const STRATEGY_REGISTRY: Record<string, RegisteredStrategy> = STRATEGIES.reduce(
  (registry, definition) => ({
    ...registry,
    [definition.key]: {
      definition,
      buildOrders: buildPositionPlanOrderIntents,
      buildSignals: buildStrategySignals,
      score: scoreStrategy,
    },
  }),
  {} as Record<string, RegisteredStrategy>,
);

export function registerStrategy(strategy: RegisteredStrategy, replace = false) {
  if (STRATEGY_REGISTRY[strategy.definition.key] && !replace) return false;
  STRATEGY_REGISTRY[strategy.definition.key] = strategy;
  const index = STRATEGIES.findIndex((item) => item.key === strategy.definition.key);
  if (index >= 0) STRATEGIES[index] = strategy.definition;
  else STRATEGIES.push(strategy.definition);
  return true;
}

export function evaluateStrategy(input: StrategyEngineInput): StrategyEvaluation {
  const strategy = STRATEGY_REGISTRY[input.strategyKey] ?? STRATEGY_REGISTRY["risk-gated-trend"];
  const score = strategy.score(input);
  const policyConfig = normalizeStrategyPolicyConfig(input.policyConfig ?? {
    ...DEFAULT_STRATEGY_POLICY_CONFIG,
    scalingPolicyKey: strategy.definition.policies.scaling,
  });
  const policyInput = { ...input, policyConfig };
  return {
    strategy: strategy.definition,
    score,
    policyConfig,
    signals: strategy.buildSignals(policyInput),
    orderIntents: strategy.buildOrders(policyInput, score),
  };
}

export function getStrategyDefinition(key: StrategyKey) {
  return STRATEGY_REGISTRY[key]?.definition ?? STRATEGY_REGISTRY["risk-gated-trend"].definition;
}

export function emptyStrategyScore(loading: boolean): StrategyScore {
  return {
    score: loading ? 35 : 0,
    tone: "neutral",
    label: loading ? "计算中" : "等待报告",
    permission: loading ? "同步中" : "无数据",
    summary: loading ? "正在等待组合分析输出。" : "还没有市场状态和风险门。",
  };
}

export function normalizePlanTone(tone: PositionPlanTone | LabTone): LabTone {
  return tone === "negative" || tone === "caution" || tone === "positive" ? tone : "neutral";
}

export function toneFromText(value: string | undefined): LabTone {
  if (value === "positive" || value === "increase") return "positive";
  if (value === "negative" || value === "reduce" || value === "defensive") return "negative";
  if (value === "caution" || value === "hold" || value === "watch") return "caution";
  return "neutral";
}

function scoreStrategy({
  positionPlan,
  report,
  strategyKey,
  tradeHabit,
}: StrategyEngineInput): StrategyScore {
  const trend = axisScore(report.decisionFrame.trend);
  const riskBudget = clamp(100 - report.score, 0, 100);
  const edge = axisScore(report.decisionFrame.edge);
  const signal = report.signalQuality?.score ?? report.decisionFrame.signalQuality?.score ?? 55;
  const confidence = report.stateConfidence?.score ?? report.decisionFrame.stateConfidence?.score ?? 55;
  const damage = report.damageScore?.score ?? report.decisionFrame.damageScore?.score ?? 45;
  const priceAction = report.priceAction?.score ?? 55;
  const shortOpportunity = report.opportunityScores.find((item) => item.horizonKey === "short")?.score ?? 50;
  const mediumOpportunity = report.opportunityScores.find((item) => item.horizonKey === "medium")?.score ?? 50;
  const portfolioHealth = positionPlan.decision.profileHealth.valid ? 76 : 42;
  const cashDeploy = positionPlan.decision.executableBudget > 0 ? 82 : positionPlan.cashWeight > positionPlan.policy.minCashWeight ? 62 : 38;
  const habitScore = tradeHabit.tone === "negative" ? 35 : tradeHabit.tone === "caution" ? 55 : tradeHabit.tone === "positive" ? 76 : 62;
  const raw = strategyKey === "risk-gated-trend"
    ? trend * 0.24 + edge * 0.2 + signal * 0.16 + priceAction * 0.16 + confidence * 0.12 + riskBudget * 0.08 + shortOpportunity * 0.04
    : strategyKey === "reversion-probe"
      ? mediumOpportunity * 0.2 + priceAction * 0.18 + (100 - damage) * 0.18 + confidence * 0.16 + riskBudget * 0.14 + edge * 0.08 + habitScore * 0.06
      : strategyKey === "rebalance-band"
        ? portfolioHealth * 0.24 + cashDeploy * 0.22 + riskBudget * 0.16 + priceAction * 0.14 + habitScore * 0.1 + signal * 0.08 + confidence * 0.06
        : report.score * 0.3 + damage * 0.22 + (100 - priceAction) * 0.16 + (100 - riskBudget) * 0.14 + (100 - signal) * 0.08 + (100 - trend) * 0.06 + habitScore * 0.04;
  const score = Math.round(clamp(raw, 0, 100));
  const defensive = strategyKey === "defense-first";
  const blocked = positionPlan.riskGate?.blocked || report.decisionFrame.permissionTone === "negative";
  const tone: LabTone = defensive
    ? score >= 64 ? "caution" : "neutral"
    : blocked
      ? "negative"
      : score >= 72
        ? "positive"
        : score >= 55
          ? "caution"
          : "neutral";
  const label = defensive
    ? score >= 64 ? "启动防守" : "保持监控"
    : blocked
      ? "暂停进攻"
      : score >= 72
        ? "可运行"
        : score >= 55
          ? "小额观察"
          : "等待条件";
  const permission = defensive
    ? "防守"
    : blocked
      ? "阻断"
      : score >= 72
        ? "就绪"
        : "观察";
  const summary = defensive
    ? "风险分和损伤指标进入防守队列。"
    : blocked
      ? "Profile 风险门关闭，只保留观察和日志。"
      : score >= 72
        ? "信号、样本和仓位约束基本同向。"
        : "信号仍需确认，预算降到观察级别。";

  return { score, tone, label, permission, summary };
}

function buildStrategySignals({
  positionPlan,
  report,
  strategyKey,
  tradeHabit,
}: StrategyEngineInput): StrategySignal[] {
  const validation = report.backtest.stateValidation;
  const primaryAdvice = report.positionAdvice[0];
  const gateBlocks = primaryAdvice?.gates.filter((item) => item.status === "block").length ?? 0;
  const habitTone = tradeHabit.tone === "negative" ? "negative" : tradeHabit.tone === "caution" ? "caution" : tradeHabit.tone === "positive" ? "positive" : "neutral";
  const defenseMode = strategyKey === "defense-first";
  const priceAction = report.priceAction;

  return [
    axisSignal(report.decisionFrame.trend, "趋势"),
    axisSignal(report.decisionFrame.risk, "风险"),
    axisSignal(report.decisionFrame.edge, "赔率"),
    {
      key: "price-action",
      label: "价格行为",
      value: priceAction ? `${priceAction.score}/100` : "—",
      tone: toneFromText(priceAction?.tone),
      detail: priceAction?.summary ?? "等待价格行为分析。",
    },
    {
      key: "sample",
      label: "样本",
      value: `${validation.sampleCount}`,
      tone: toneFromText(validation.sampleQualityTone ?? validation.tone),
      detail: `${validation.confidence} · ${validation.matchMode}`,
    },
    {
      key: "position",
      label: defenseMode ? "防守" : "预算",
      value: defenseMode ? positionPlan.trimNeededLabel : positionPlan.addableBudgetLabel,
      tone: gateBlocks ? "negative" : positionPlan.statusTone,
      detail: gateBlocks ? `${gateBlocks} 项闸门卡住` : positionPlan.summary,
    },
    {
      key: "habit",
      label: "交易习惯",
      value: tradeHabit.title,
      tone: habitTone,
      detail: tradeHabit.summary,
    },
  ];
}

function buildPositionPlanOrderIntents(
  {
    budgetWeight,
    policyConfig: rawPolicyConfig,
    positionPlan,
    report,
    riskOverride,
    runtimeBySymbol = {},
    strategyKey,
  }: StrategyEngineInput,
  score: StrategyScore,
): OrderIntent[] {
  const policyConfig = normalizeStrategyPolicyConfig(rawPolicyConfig);
  const scalingPolicy = scalingPolicyDefinition(policyConfig.scalingPolicyKey);
  const buyBlocked = !riskOverride && score.tone === "negative" && strategyKey !== "defense-first";
  const maxBudget = positionPlan.totalValue > 0 ? (positionPlan.totalValue * budgetWeight) / 100 : 0;
  const actions = positionPlan.actions.filter((action) => {
    if (!action.holdingId) return false;
    if (strategyKey === "defense-first") return action.weightDelta < 0 || action.tone === "negative" || action.action.includes("减");
    return Math.abs(action.weightDelta) > 0 && (action.amount > 0 || Boolean(action.amountLabel));
  });

  return actions.slice(0, 5).map((action) => {
    const isBuy = action.weightDelta > 0;
    const priceAction = report.priceAction ? priceActionForSymbol(report.priceAction, action.symbol) : null;
    const strategyBudget = action.amount > 0 && maxBudget > 0 && isBuy
      ? Math.min(action.amount, maxBudget)
      : action.amount;
    const runtime = runtimeBySymbol[symbolKey(action.symbol)];
    const currentPrice = currentPriceFor(report, action.symbol);
    const scaling = isBuy
      ? evaluateScalingPolicy({
        assetType: action.assetType,
        config: policyConfig,
        currentPrice,
        marketRiskScore: report.score,
        permissionBlocked: buyBlocked || Boolean(positionPlan.riskGate?.blocked),
        profileKey: report.profileKey,
        runDate: report.asOf,
        runtime,
        strategyKey,
        symbol: action.symbol,
      })
      : runtime?.instanceKey
        ? {
          allowed: true,
          policyKey: policyConfig.scalingPolicyKey,
          policyLabel: scalingPolicy.label,
          instanceKey: runtime.instanceKey,
          trancheIndex: 0,
          maxTranches: policyConfig.maxTranches,
          budgetFraction: 1,
          stateLabel: "退出",
          detail: `${scalingPolicy.label}持仓退出。`,
          nextTriggerLabel: "本轮结束",
        }
        : undefined;
    const priceActionBlocked = isBuy && priceAction?.tone === "negative";
    const blocked = isBuy && (buyBlocked || !scaling?.allowed || priceActionBlocked);
    const amount = isBuy && scaling ? strategyBudget * scaling.budgetFraction : strategyBudget;
    const priceActionDetail = priceAction
      ? `价格行为：${priceAction.phaseLabel}；触发 ${priceAction.entryTrigger}；失效 ${priceAction.invalidation}`
      : "";
    const detail = [action.reason || action.detail, priceActionDetail, scaling?.detail, scaling?.nextTriggerLabel]
      .filter(Boolean)
      .join(" · ");
    return {
      key: scaling?.instanceKey
        ? `${action.key}:${scaling.instanceKey}:t${scaling.trancheIndex}`
        : action.key,
      symbol: action.symbol,
      name: action.name,
      side: isBuy ? "BUY" : "SELL",
      state: blocked ? scaling?.stateLabel || "已阻断" : isBuy ? scaling?.stateLabel || "待买入" : "待减仓",
      tone: blocked ? "negative" : normalizePlanTone(action.tone),
      amount: amount > 0 ? formatMoney(amount, positionPlan.currency) : action.amountLabel,
      weight: action.weightLabel,
      detail,
      scaling,
    };
  });
}

function policyBundle(
  signal: StrategyPolicyBundle["signal"],
  exit: StrategyPolicyBundle["exit"],
): StrategyPolicyBundle {
  return {
    signal,
    sizing: "plan-budget",
    scaling: "single-entry",
    exit,
    risk: "profile-guard",
    execution: "market-aware",
    evaluation: "closed-rounds",
  };
}

function currentPriceFor(report: MarketAnalysisReport, symbol: string) {
  const technical = report.technicalRows.find((row) => symbolKey(row.symbol) === symbolKey(symbol));
  if (technical?.close && technical.close > 0) return technical.close;
  const asset = report.assetStatuses.find((row) => symbolKey(row.symbol) === symbolKey(symbol));
  return asset?.close && asset.close > 0 ? asset.close : null;
}

function symbolKey(value: string) {
  return value.trim().toUpperCase();
}

function axisSignal(axis: DecisionAxis, label: string): StrategySignal {
  return {
    key: axis.key,
    label,
    value: `${Math.round(axis.score)}/100`,
    tone: toneFromText(axis.tone),
    detail: axis.status || axis.detail,
  };
}

function axisScore(axis: DecisionAxis) {
  const tone = toneFromText(axis.tone);
  if (tone === "negative") return Math.max(0, axis.score * 0.55);
  if (tone === "caution") return Math.max(0, axis.score * 0.75);
  return clamp(axis.score, 0, 100);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
