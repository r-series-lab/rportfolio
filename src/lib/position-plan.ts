import { isHoldingRecord, type HoldingRecord } from "./holdings";
import type { MarketAnalysisReport } from "./types";

export type PositionPlanTone = "positive" | "neutral" | "caution" | "negative";

export type PositionPolicy = {
  minCashWeight: number;
  singleAssetCap: number;
  maxSingleAddWeight: number;
};

export type PositionRiskGate = {
  label: string;
  tone: PositionPlanTone;
  blocked: boolean;
  watch: boolean;
  addMultiplier: number;
  reason: string;
  source: string;
};

type PositionPlanOptions = {
  marketRiskScore?: number;
  policy?: Partial<PositionPolicy> | null;
  riskGate?: PositionRiskGate | null;
};

export type RecommendationIntent =
  | "HOLD"
  | "DEPLOY_EXCESS_CASH"
  | "ADD_TO_TARGET"
  | "REBALANCE_TO_BAND"
  | "TRIM_OVERWEIGHT"
  | "REDUCE_RISK"
  | "WAIT_FOR_TRIGGER"
  | "CONFIG_REQUIRED";

export type ExecutionState =
  | "EXECUTABLE"
  | "BLOCKED_BY_PROFILE"
  | "BLOCKED_BY_RISK"
  | "BLOCKED_BY_SCHEDULE"
  | "BLOCKED_BY_DATA"
  | "NO_BUDGET"
  | "NO_HEADROOM"
  | "PAUSED";

export type ReasonCode =
  | "TARGET_MIN_SUM_GT_100"
  | "TARGET_MAX_SUM_LT_100"
  | "CASH_OVER_TARGET"
  | "CASH_BELOW_TARGET"
  | "CASH_WITHIN_TARGET"
  | "ASSET_WITHIN_BAND"
  | "ASSET_BELOW_MID"
  | "ASSET_BELOW_MIN"
  | "ASSET_OVER_MAX"
  | "RISK_GATE_CLOSED"
  | "MARKET_RISK_HIGH"
  | "NO_CASH_INSTRUMENT"
  | "NO_BUDGET"
  | "NO_HEADROOM"
  | "NO_ASSET_CAPACITY"
  | "CONFIG_REQUIRED";

export const POSITION_REASON_TEXT: Record<ReasonCode, string> = {
  TARGET_MIN_SUM_GT_100: "目标下限合计超过 100%，配置不可执行",
  TARGET_MAX_SUM_LT_100: "目标上限合计低于 100%，现有资产池无法覆盖全部资金",
  CASH_OVER_TARGET: "现金超过目标上限",
  CASH_BELOW_TARGET: "现金低于目标下限",
  CASH_WITHIN_TARGET: "现金位于目标区间",
  ASSET_WITHIN_BAND: "资产仍在目标区间内",
  ASSET_BELOW_MID: "资产低于目标中位数",
  ASSET_BELOW_MIN: "资产低于目标下限",
  ASSET_OVER_MAX: "资产超过目标上限",
  RISK_GATE_CLOSED: "风险门未打开",
  MARKET_RISK_HIGH: "组合风险评分偏高",
  NO_CASH_INSTRUMENT: "未记录现金或货基",
  NO_BUDGET: "今日没有可用预算",
  NO_HEADROOM: "资产已接近目标上限",
  NO_ASSET_CAPACITY: "现有资产目标上限不足，无法吸收超额现金",
  CONFIG_REQUIRED: "需要先完善目标带配置",
};

export type ProfileHealth = {
  valid: boolean;
  level: "ok" | "warning" | "error";
  minSum: number;
  midSum: number;
  maxSum: number;
  message: string;
  reasonCodes: ReasonCode[];
};

export type CashDecision = {
  status: "MISSING" | "LOW_CASH" | "NORMAL" | "EXCESS_CASH" | "SEVERE_EXCESS_CASH";
  label: string;
  tone: PositionPlanTone;
  cashMinValue: number;
  cashMaxValue: number;
  excessCashToUpper: number;
  maxSpendUntilCashMin: number;
  targetMinWeight: number;
  targetMaxWeight: number;
  reasonCodes: ReasonCode[];
};

export type AssetDecision = {
  holdingId: string;
  symbol: string;
  name: string;
  value: number;
  weight: number;
  targetMin: number;
  targetMid: number;
  targetMax: number;
  headroomToMid: number;
  headroomToMax: number;
  intent: RecommendationIntent;
  executionState: ExecutionState;
  todayAmount: number;
  triggerAmount: number;
  pendingAmount: number;
  priority: number;
  reasonCodes: ReasonCode[];
};

export type PortfolioDecision = {
  totalValue: number;
  currency: string;
  cashValue: number;
  cashWeight: number;
  profileHealth: ProfileHealth;
  cashDecision: CashDecision;
  executableBudget: number;
  triggerBudget: number;
  pendingDeployBudget: number;
  singleTradeBudget: number;
  assetCapacityToMid: number;
  assetCapacityToMax: number;
  unallocatableExcessCash: number;
  portfolioIntent: RecommendationIntent;
  executionState: ExecutionState;
  reasonCodes: ReasonCode[];
  assetDecisions: AssetDecision[];
};

export type PositionPlanAction = {
  key: string;
  holdingId: string | null;
  symbol: string;
  name: string;
  action: string;
  tone: PositionPlanTone;
  amount: number;
  amountLabel: string;
  weightDelta: number;
  weightLabel: string;
  targetBandLabel: string;
  reason: string;
  detail: string;
  assetType?: HoldingRecord["assetType"];
  profileKey?: string;
};

export type PositionPlanHorizon = {
  key: "short" | "medium" | "long";
  label: string;
  range: string;
  action: string;
  tone: PositionPlanTone;
  amountLabel: string;
  target: string;
  trigger: string;
  detail: string;
};

export type PositionPlan = {
  statusLabel: string;
  statusTone: PositionPlanTone;
  summary: string;
  totalValue: number;
  currency: string;
  cashValue: number;
  cashWeight: number;
  riskExposure: number;
  addableBudget: number;
  addableBudgetLabel: string;
  trimNeeded: number;
  trimNeededLabel: string;
  hasCashInstrument: boolean;
  actionCount: number;
  actions: PositionPlanAction[];
  decision: PortfolioDecision;
  horizons: PositionPlanHorizon[];
  policy: {
    minCashWeight: number;
    singleAssetCap: number;
    maxSingleAddWeight: number;
  };
  riskGate: PositionRiskGate | null;
};

export const DEFAULT_POSITION_POLICY: PositionPolicy = {
  minCashWeight: 15,
  singleAssetCap: 25,
  maxSingleAddWeight: 3,
};

export function normalizePositionPolicy(policy: Partial<PositionPolicy> | null | undefined): PositionPolicy {
  return {
    minCashWeight: clampPolicyNumber(policy?.minCashWeight, DEFAULT_POSITION_POLICY.minCashWeight, 0, 80),
    singleAssetCap: clampPolicyNumber(policy?.singleAssetCap, DEFAULT_POSITION_POLICY.singleAssetCap, 1, 100),
    maxSingleAddWeight: clampPolicyNumber(policy?.maxSingleAddWeight, DEFAULT_POSITION_POLICY.maxSingleAddWeight, 0.1, 50),
  };
}

export function profileRiskGateFromReport(report: MarketAnalysisReport | null | undefined): PositionRiskGate | null {
  if (!report) return null;
  const shortAdvice = report.positionAdvice.find((item) => item.horizonKey === "short") ?? report.positionAdvice[0];
  const gates = shortAdvice?.gates ?? [];
  const firstBlock = gates.find((gate) => gate.status === "block");
  const firstWatch = gates.find((gate) => gate.status === "watch");
  const protocolState = String(report.decisionFrame.protocolState || "").toLowerCase();
  const permissionTone = String(report.decisionFrame.permissionTone || "").toLowerCase();
  const defensiveTone = ["reduce", "defensive"].includes(String(shortAdvice?.tone ?? ""));
  const hardBlocked = protocolState === "panic";
  const researchBlockedSignal =
    Boolean(firstBlock) || protocolState === "broken" || permissionTone === "negative" || defensiveTone;
  const watch = !hardBlocked && (researchBlockedSignal || Boolean(firstWatch) || permissionTone === "caution" || report.score >= 66);
  const reason =
    firstBlock?.detail ||
    (defensiveTone ? shortAdvice?.rationale : "") ||
    firstWatch?.detail ||
    report.decisionFrame.condition ||
    report.summary;

  if (hardBlocked) {
    return {
      label: "风险硬保护",
      tone: "negative",
      blocked: true,
      watch: false,
      addMultiplier: 0,
      reason: compactText(reason, "极端风险触发，暂停新增风险仓位。"),
      source: shortAdvice?.horizonLabel ?? "Profile",
    };
  }
  if (watch) {
    const addMultiplier = researchBlockedSignal ? 0.25 : 0.5;
    return {
      label: researchBlockedSignal ? "研究观察" : "风险观察",
      tone: "caution",
      blocked: false,
      watch: true,
      addMultiplier,
      reason: compactText(reason, "风险信号偏弱，研究模式只给小额模拟动作。"),
      source: shortAdvice?.horizonLabel ?? "Profile",
    };
  }
  return {
    label: "风险门通过",
    tone: "positive",
    blocked: false,
    watch: false,
    addMultiplier: 1,
    reason: compactText(report.decisionFrame.permission || report.summary, "风险门允许计划内动作。"),
    source: shortAdvice?.horizonLabel ?? "Profile",
  };
}

export function createPositionPlan(holdings: HoldingRecord[], options: number | PositionPlanOptions = 50): PositionPlan {
  const planOptions = typeof options === "number" ? { marketRiskScore: options } : options;
  const marketRiskScore = planOptions.marketRiskScore ?? 50;
  const policy = normalizePositionPolicy(planOptions.policy);
  const riskGate = planOptions.riskGate ?? null;
  const records = holdings.filter(isHoldingRecord);
  const realRows = records.filter((holding) => holding.role === "real");
  const cashRows = realRows.filter(isCashHolding);
  const riskRows = realRows.filter((holding) => !isCashHolding(holding));
  const totalValue = realRows.reduce((sum, holding) => sum + marketValueOf(holding), 0);
  const cashValue = cashRows.reduce((sum, holding) => sum + marketValueOf(holding), 0);
  const currency = dominantCurrency(realRows);
  const hasCashInstrument = cashRows.length > 0;
  const cashWeight = totalValue > 0 && hasCashInstrument ? (cashValue / totalValue) * 100 : 0;
  const riskExposure = totalValue > 0 ? (riskRows.reduce((sum, holding) => sum + marketValueOf(holding), 0) / totalValue) * 100 : 0;
  const decision = createPortfolioDecision({
    cashValue,
    cashWeight,
    currency,
    hasCashInstrument,
    marketRiskScore,
    policy,
    riskGate,
    riskRows,
    totalValue,
  });
  const profileBlockReason = decision.profileHealth.valid ? "" : decision.profileHealth.message;
  const status = planStatus({
    cashDecision: decision.cashDecision,
    cashWeight,
    decision,
    hasCashInstrument,
    marketRiskScore,
    profileHealth: decision.profileHealth,
    realCount: realRows.length,
    riskGate,
  });
  let remainingAddableBudget = decision.executableBudget;
  const riskActions = [...riskRows]
    .sort((left, right) => compareHoldingPlanPriority(left, right, totalValue, policy))
    .map((holding) => {
      const action = actionForHolding({
        addableBudget: remainingAddableBudget,
        cashWeight,
        holding,
        hasCashInstrument,
        marketRiskScore,
        policy,
        profileBlockReason,
        riskGate,
        totalValue,
      });
      if (action.amount > 0 && action.weightDelta > 0) {
        remainingAddableBudget = Math.max(0, remainingAddableBudget - action.amount);
      }
      return action;
    });
  const trimNeeded = riskActions
    .filter((action) => action.weightDelta < 0)
    .reduce((sum, action) => sum + Math.abs(action.amount), 0);
  const guardrailAction = guardrailActionFor({
    cashWeight,
    currency,
    hasCashInstrument,
    policy,
    totalValue,
  });
  const riskGateAction = riskGateActionFor({ riskGate, totalValue });
  const actions = [riskGateAction, guardrailAction, ...riskActions]
    .filter((action): action is PositionPlanAction => Boolean(action))
    .sort(compareActions);
  const horizons = horizonAdviceFor({
    actions,
    cashWeight,
    currency,
    hasCashInstrument,
    policy,
    realRows,
    riskGate,
    riskRows,
    totalValue,
    trimNeeded,
  });

  return {
    statusLabel: status.label,
    statusTone: status.tone,
    summary: status.summary,
    totalValue,
    currency,
    cashValue,
    cashWeight: round1(cashWeight),
    riskExposure: round1(riskExposure),
    addableBudget: decision.executableBudget,
    addableBudgetLabel: decision.executableBudget > 0 ? formatAmount(decision.executableBudget, currency) : formatAmount(0, currency),
    trimNeeded,
    trimNeededLabel: trimNeeded > 0 ? formatAmount(trimNeeded, currency) : "—",
    hasCashInstrument,
    actionCount: actions.filter((action) => action.holdingId).length,
    actions,
    decision,
    horizons,
    policy,
    riskGate,
  };
}

export function targetBandForHolding(holding: HoldingRecord, policy: Partial<PositionPolicy> | null = DEFAULT_POSITION_POLICY) {
  const normalizedPolicy = normalizePositionPolicy(policy);
  const target = clamp(holding.targetWeight, 0, 100);
  if (target <= 0) {
    return {
      min: 0,
      target: 0,
      max: 0,
      label: "未设置",
    };
  }

  const min = clamp(optionalWeight(holding.targetMinWeight) ?? target * 0.72, 0, target);
  const max = clamp(optionalWeight(holding.targetMaxWeight) ?? Math.max(target * 1.28, target + 2), target, normalizedPolicy.singleAssetCap);
  return {
    min: round1(min),
    target: round1(target),
    max: round1(max),
    label: `${formatWeight(min)}-${formatWeight(max)}`,
  };
}

export function isCashHolding(holding: HoldingRecord) {
  const text = `${holding.symbol} ${holding.name}`.toUpperCase();
  return holding.assetType === "cash" || /(^CASH$|现金|货币|货基|MONEY|MMF)/u.test(text);
}

function createPortfolioDecision({
  cashValue,
  cashWeight,
  currency,
  hasCashInstrument,
  marketRiskScore,
  policy,
  riskGate,
  riskRows,
  totalValue,
}: {
  cashValue: number;
  cashWeight: number;
  currency: string;
  hasCashInstrument: boolean;
  marketRiskScore: number;
  policy: PositionPolicy;
  riskGate: PositionRiskGate | null;
  riskRows: HoldingRecord[];
  totalValue: number;
}): PortfolioDecision {
  const profileHealth = profileHealthFor({ policy, riskRows });
  const cashDecision = cashDecisionFor({ cashValue, cashWeight, hasCashInstrument, policy, totalValue });
  const baseAssetDecisions = riskRows.map((holding) =>
    assetDecisionFor({
      cashDecision,
      hasCashInstrument,
      holding,
      marketRiskScore,
      policy,
      profileHealth,
      riskGate,
      totalValue,
    }),
  );
  const assetCapacityToMid = baseAssetDecisions.reduce((sum, item) => sum + item.headroomToMid, 0);
  const assetCapacityToMax = baseAssetDecisions.reduce((sum, item) => sum + item.headroomToMax, 0);
  const pendingDeployBudget = cashDecision.excessCashToUpper;
  const unallocatableExcessCash = Math.max(0, pendingDeployBudget - assetCapacityToMax);
  const hasAddIntent = baseAssetDecisions.some(
    (item) => item.intent === "ADD_TO_TARGET" || item.intent === "DEPLOY_EXCESS_CASH" || item.intent === "REBALANCE_TO_BAND",
  );
  const portfolioIntent: RecommendationIntent = !profileHealth.valid && pendingDeployBudget > 0
    ? "DEPLOY_EXCESS_CASH"
    : !profileHealth.valid
      ? "CONFIG_REQUIRED"
      : pendingDeployBudget > 0
        ? "DEPLOY_EXCESS_CASH"
        : hasAddIntent
          ? "ADD_TO_TARGET"
          : "HOLD";
  const reasonCodes = uniqueReasonCodes([
    ...profileHealth.reasonCodes,
    ...cashDecision.reasonCodes,
    ...(riskGate?.blocked ? (["RISK_GATE_CLOSED"] as ReasonCode[]) : []),
    ...(marketRiskScore >= 78 ? (["MARKET_RISK_HIGH"] as ReasonCode[]) : []),
    ...(unallocatableExcessCash > 0 ? (["NO_ASSET_CAPACITY"] as ReasonCode[]) : []),
  ]);
  const executionState = portfolioExecutionStateFor({
    assetCapacityToMax,
    cashDecision,
    hasCashInstrument,
    marketRiskScore,
    portfolioIntent,
    profileHealth,
    riskGate,
  });
  const deployPool = pendingDeployBudget > 0 ? Math.min(pendingDeployBudget, assetCapacityToMax) : assetCapacityToMid || assetCapacityToMax;
  const singleTradeBudget = totalValue > 0 ? (totalValue * policy.maxSingleAddWeight) / 100 : 0;
  const gateBudgetMultiplier = riskGate?.watch ? Math.max(0, Math.min(1, riskGate.addMultiplier)) : 1;
  const scoreBudgetMultiplier = marketRiskScore >= 78 ? 0.25 : marketRiskScore >= 66 ? 0.5 : 1;
  const effectiveSingleTradeBudget = singleTradeBudget * Math.min(gateBudgetMultiplier, scoreBudgetMultiplier);
  const canPlanTrigger =
    profileHealth.valid &&
    !riskGate?.blocked &&
    hasCashInstrument &&
    cashDecision.status !== "LOW_CASH" &&
    cashDecision.maxSpendUntilCashMin > 0 &&
    assetCapacityToMax > 0 &&
    portfolioIntent !== "HOLD";
  const triggerBudget = canPlanTrigger
    ? Math.max(0, Math.min(effectiveSingleTradeBudget, cashDecision.maxSpendUntilCashMin, deployPool))
    : 0;
  const executableBudget =
    executionState === "EXECUTABLE"
      ? triggerBudget
      : 0;
  const assetDecisions = allocateDecisionAmounts(baseAssetDecisions, executableBudget, triggerBudget);

  return {
    totalValue,
    currency,
    cashValue,
    cashWeight: round1(cashWeight),
    profileHealth,
    cashDecision,
    executableBudget,
    triggerBudget,
    pendingDeployBudget,
    singleTradeBudget,
    assetCapacityToMid,
    assetCapacityToMax,
    unallocatableExcessCash,
    portfolioIntent,
    executionState,
    reasonCodes,
    assetDecisions,
  };
}

function profileHealthFor({ policy, riskRows }: { policy: PositionPolicy; riskRows: HoldingRecord[] }): ProfileHealth {
  const cashMin = policy.minCashWeight;
  const cashMax = cashTargetMaxWeight(policy);
  const entries = [
    {
      min: cashMin,
      mid: (cashMin + cashMax) / 2,
      max: cashMax,
    },
    ...riskRows.map((holding) => {
      const band = targetBandForHolding(holding, policy);
      return {
        min: band.min,
        mid: (band.min + band.max) / 2,
        max: band.max,
      };
    }),
  ];
  const minSum = round1(entries.reduce((sum, entry) => sum + entry.min, 0));
  const midSum = round1(entries.reduce((sum, entry) => sum + entry.mid, 0));
  const maxSum = round1(entries.reduce((sum, entry) => sum + entry.max, 0));
  const reasonCodes: ReasonCode[] = [];
  if (minSum > 100) reasonCodes.push("TARGET_MIN_SUM_GT_100");
  if (maxSum < 100) reasonCodes.push("TARGET_MAX_SUM_LT_100");
  const hasHardError = reasonCodes.includes("TARGET_MIN_SUM_GT_100");
  const hasCapacityGap = reasonCodes.includes("TARGET_MAX_SUM_LT_100");
  const valid = !hasHardError;
  const level: ProfileHealth["level"] = hasHardError ? "error" : hasCapacityGap ? "warning" : "ok";
  const message = hasHardError
    ? `目标下限合计 ${formatWeight(minSum)}，高于 100%。`
    : hasCapacityGap
      ? `目标上限合计 ${formatWeight(maxSum)}，低于 100%，现有资产池容量不足。`
      : `目标带覆盖 ${formatWeight(minSum)}-${formatWeight(maxSum)}。`;
  return {
    valid,
    level,
    minSum,
    midSum,
    maxSum,
    message,
    reasonCodes,
  };
}

function cashDecisionFor({
  cashValue,
  cashWeight,
  hasCashInstrument,
  policy,
  totalValue,
}: {
  cashValue: number;
  cashWeight: number;
  hasCashInstrument: boolean;
  policy: PositionPolicy;
  totalValue: number;
}): CashDecision {
  const targetMinWeight = policy.minCashWeight;
  const targetMaxWeight = cashTargetMaxWeight(policy);
  const cashMinValue = totalValue > 0 ? (totalValue * targetMinWeight) / 100 : 0;
  const cashMaxValue = totalValue > 0 ? (totalValue * targetMaxWeight) / 100 : 0;
  const excessCashToUpper = hasCashInstrument ? Math.max(0, cashValue - cashMaxValue) : 0;
  const maxSpendUntilCashMin = hasCashInstrument ? Math.max(0, cashValue - cashMinValue) : 0;

  if (!hasCashInstrument) {
    return {
      status: "MISSING",
      label: "缺现金数据",
      tone: "caution",
      cashMinValue,
      cashMaxValue,
      excessCashToUpper,
      maxSpendUntilCashMin,
      targetMinWeight,
      targetMaxWeight,
      reasonCodes: ["NO_CASH_INSTRUMENT"],
    };
  }
  if (cashWeight < targetMinWeight) {
    return {
      status: "LOW_CASH",
      label: "现金不足",
      tone: "negative",
      cashMinValue,
      cashMaxValue,
      excessCashToUpper,
      maxSpendUntilCashMin,
      targetMinWeight,
      targetMaxWeight,
      reasonCodes: ["CASH_BELOW_TARGET"],
    };
  }
  if (cashWeight > targetMaxWeight) {
    const severe = cashWeight - targetMaxWeight >= 20 || excessCashToUpper >= totalValue * 0.2;
    return {
      status: severe ? "SEVERE_EXCESS_CASH" : "EXCESS_CASH",
      label: severe ? "现金严重超配" : "现金超配",
      tone: "caution",
      cashMinValue,
      cashMaxValue,
      excessCashToUpper,
      maxSpendUntilCashMin,
      targetMinWeight,
      targetMaxWeight,
      reasonCodes: ["CASH_OVER_TARGET"],
    };
  }
  return {
    status: "NORMAL",
    label: "现金正常",
    tone: "positive",
    cashMinValue,
    cashMaxValue,
    excessCashToUpper,
    maxSpendUntilCashMin,
    targetMinWeight,
    targetMaxWeight,
    reasonCodes: ["CASH_WITHIN_TARGET"],
  };
}

function assetDecisionFor({
  cashDecision,
  hasCashInstrument,
  holding,
  marketRiskScore,
  policy,
  profileHealth,
  riskGate,
  totalValue,
}: {
  cashDecision: CashDecision;
  hasCashInstrument: boolean;
  holding: HoldingRecord;
  marketRiskScore: number;
  policy: PositionPolicy;
  profileHealth: ProfileHealth;
  riskGate: PositionRiskGate | null;
  totalValue: number;
}): AssetDecision {
  const value = marketValueOf(holding);
  const weight = totalValue > 0 ? (value / totalValue) * 100 : 0;
  const band = targetBandForHolding(holding, policy);
  const targetMid = round1((band.min + band.max) / 2);
  const headroomToMid = totalValue > 0 ? Math.max(0, (totalValue * targetMid) / 100 - value) : 0;
  const headroomToMax = totalValue > 0 ? Math.max(0, (totalValue * band.max) / 100 - value) : 0;
  const overMaxAmount = totalValue > 0 ? Math.max(0, value - (totalValue * band.max) / 100) : 0;
  const reasonCodes: ReasonCode[] = [];
  let intent: RecommendationIntent = "HOLD";

  if (band.target <= 0 || band.max <= 0) {
    intent = "CONFIG_REQUIRED";
    reasonCodes.push("CONFIG_REQUIRED");
  } else if (weight > band.max) {
    intent = "TRIM_OVERWEIGHT";
    reasonCodes.push("ASSET_OVER_MAX");
  } else if (weight < band.min) {
    intent = "ADD_TO_TARGET";
    reasonCodes.push("ASSET_BELOW_MIN");
  } else if (weight < targetMid - 0.05) {
    intent = "ADD_TO_TARGET";
    reasonCodes.push("ASSET_BELOW_MID");
  } else if (cashDecision.excessCashToUpper > 0 && headroomToMax > 0) {
    intent = "WAIT_FOR_TRIGGER";
    reasonCodes.push("ASSET_WITHIN_BAND");
  } else {
    reasonCodes.push("ASSET_WITHIN_BAND");
  }

  const executionState = assetExecutionStateFor({
    cashDecision,
    hasCashInstrument,
    headroomToMax,
    intent,
    marketRiskScore,
    profileHealth,
    riskGate,
  });
  const priority = assetPriorityFor({ headroomToMid, headroomToMax, intent, weight, bandMin: band.min, targetMid });
  const profileWarningCodes = profileHealth.reasonCodes.filter((code) => code === "TARGET_MAX_SUM_LT_100");

  return {
    holdingId: holding.id,
    symbol: holding.symbol,
    name: holding.name,
    value,
    weight: round1(weight),
    targetMin: band.min,
    targetMid,
    targetMax: band.max,
    headroomToMid,
    headroomToMax,
    intent,
    executionState,
    todayAmount: intent === "TRIM_OVERWEIGHT" ? overMaxAmount : 0,
    triggerAmount: intent === "TRIM_OVERWEIGHT" ? overMaxAmount : 0,
    pendingAmount: intent === "TRIM_OVERWEIGHT" ? overMaxAmount : headroomToMid || headroomToMax,
    priority,
    reasonCodes: uniqueReasonCodes([
      ...reasonCodes,
      ...(executionState === "BLOCKED_BY_PROFILE" ? profileHealth.reasonCodes : profileWarningCodes),
      ...(executionState === "BLOCKED_BY_RISK" ? ([riskGate?.blocked ? "RISK_GATE_CLOSED" : "MARKET_RISK_HIGH"] as ReasonCode[]) : []),
      ...(executionState === "NO_BUDGET" ? ([hasCashInstrument ? "NO_BUDGET" : "NO_CASH_INSTRUMENT"] as ReasonCode[]) : []),
      ...(executionState === "NO_HEADROOM" ? (["NO_HEADROOM"] as ReasonCode[]) : []),
    ]),
  };
}

function portfolioExecutionStateFor({
  assetCapacityToMax,
  cashDecision,
  hasCashInstrument,
  marketRiskScore,
  portfolioIntent,
  profileHealth,
  riskGate,
}: {
  assetCapacityToMax: number;
  cashDecision: CashDecision;
  hasCashInstrument: boolean;
  marketRiskScore: number;
  portfolioIntent: RecommendationIntent;
  profileHealth: ProfileHealth;
  riskGate: PositionRiskGate | null;
}): ExecutionState {
  if (!profileHealth.valid) return "BLOCKED_BY_PROFILE";
  if (riskGate?.blocked) return "BLOCKED_BY_RISK";
  if (!riskGate && marketRiskScore >= 90) return "BLOCKED_BY_RISK";
  if (!hasCashInstrument || cashDecision.status === "LOW_CASH") return "NO_BUDGET";
  if (portfolioIntent === "HOLD") return "EXECUTABLE";
  if (assetCapacityToMax <= 0) return "NO_HEADROOM";
  if (cashDecision.maxSpendUntilCashMin <= 0) return "NO_BUDGET";
  return "EXECUTABLE";
}

function assetExecutionStateFor({
  cashDecision,
  hasCashInstrument,
  headroomToMax,
  intent,
  marketRiskScore,
  profileHealth,
  riskGate,
}: {
  cashDecision: CashDecision;
  hasCashInstrument: boolean;
  headroomToMax: number;
  intent: RecommendationIntent;
  marketRiskScore: number;
  profileHealth: ProfileHealth;
  riskGate: PositionRiskGate | null;
}): ExecutionState {
  if (intent === "TRIM_OVERWEIGHT") return "EXECUTABLE";
  if (intent === "CONFIG_REQUIRED") return "BLOCKED_BY_PROFILE";
  if (!profileHealth.valid) return "BLOCKED_BY_PROFILE";
  if (riskGate?.blocked) return "BLOCKED_BY_RISK";
  if (!riskGate && marketRiskScore >= 90) return "BLOCKED_BY_RISK";
  if (!hasCashInstrument || cashDecision.status === "LOW_CASH" || cashDecision.maxSpendUntilCashMin <= 0) return "NO_BUDGET";
  if (headroomToMax <= 0) return "NO_HEADROOM";
  return "EXECUTABLE";
}

function allocateDecisionAmounts(decisions: AssetDecision[], executableBudget: number, triggerBudget: number) {
  let remainingExecutable = executableBudget;
  let remainingTrigger = triggerBudget;
  return [...decisions]
    .sort((left, right) => right.priority - left.priority || right.pendingAmount - left.pendingAmount || left.symbol.localeCompare(right.symbol))
    .map((decision) => {
      if (decision.intent === "TRIM_OVERWEIGHT") {
        return decision;
      }
      const targetAmount = decision.headroomToMid || decision.headroomToMax;
      const canPlanTrigger = decision.executionState !== "BLOCKED_BY_PROFILE" && decision.executionState !== "NO_BUDGET" && decision.executionState !== "NO_HEADROOM";
      const triggerAmount = canPlanTrigger && remainingTrigger > 0 ? Math.min(remainingTrigger, targetAmount) : 0;
      remainingTrigger = Math.max(0, remainingTrigger - triggerAmount);
      const todayAmount = decision.executionState === "EXECUTABLE" && remainingExecutable > 0 ? Math.min(remainingExecutable, targetAmount) : 0;
      remainingExecutable = Math.max(0, remainingExecutable - todayAmount);
      return { ...decision, todayAmount, triggerAmount };
    });
}

function assetPriorityFor({
  bandMin,
  headroomToMax,
  headroomToMid,
  intent,
  targetMid,
  weight,
}: {
  bandMin: number;
  headroomToMax: number;
  headroomToMid: number;
  intent: RecommendationIntent;
  targetMid: number;
  weight: number;
}) {
  if (intent === "TRIM_OVERWEIGHT") return 120 + Math.max(0, weight - targetMid);
  if (intent === "CONFIG_REQUIRED") return 0;
  if (weight < bandMin) return 100 + Math.max(0, bandMin - weight);
  if (headroomToMid > 0) return 70 + Math.max(0, targetMid - weight);
  if (headroomToMax > 0) return 35 + headroomToMax / 10000;
  return 10;
}

function cashTargetMaxWeight(policy: PositionPolicy) {
  return Math.max(policy.minCashWeight, policy.singleAssetCap);
}

function uniqueReasonCodes(codes: ReasonCode[]) {
  return Array.from(new Set(codes));
}

function actionForHolding({
  addableBudget,
  cashWeight,
  holding,
  hasCashInstrument,
  marketRiskScore,
  policy,
  profileBlockReason,
  riskGate,
  totalValue,
}: {
  addableBudget: number;
  cashWeight: number;
  holding: HoldingRecord;
  hasCashInstrument: boolean;
  marketRiskScore: number;
  policy: PositionPolicy;
  profileBlockReason: string;
  riskGate: PositionRiskGate | null;
  totalValue: number;
}): PositionPlanAction {
  const value = marketValueOf(holding);
  const currentWeight = totalValue > 0 ? (value / totalValue) * 100 : 0;
  const band = targetBandForHolding(holding, policy);
  const targetBandLabel = band.label;
  const base = {
    holdingId: holding.id,
    symbol: holding.symbol,
    name: holding.name,
    assetType: holding.assetType,
    profileKey: holding.profileKey,
    targetBandLabel,
  };

  if (band.target <= 0) {
    return {
      ...base,
      key: `plan-${holding.id}`,
      action: "设置计划",
      tone: "neutral",
      amount: 0,
      amountLabel: "—",
      weightDelta: 0,
      weightLabel: `${formatWeight(currentWeight)} / 未设置`,
      reason: "缺少目标区间",
      detail: "先补最小/目标/最大仓位，再生成加减仓建议。",
    };
  }

  if (currentWeight > band.max) {
    const deltaWeight = currentWeight - band.max;
    const amount = (totalValue * deltaWeight) / 100;
    return {
      ...base,
      key: `trim-${holding.id}`,
      action: "应减仓",
      tone: "negative",
      amount,
      amountLabel: formatAmount(amount, holding.currency),
      weightDelta: -round1(deltaWeight),
      weightLabel: `超 ${formatWeight(deltaWeight)}`,
      reason: `当前 ${formatWeight(currentWeight)}，高于上限 ${formatWeight(band.max)}`,
      detail: `${sellVerbFor(holding)} ${formatAmount(amount, holding.currency)}，仓位降至 ${formatWeight(band.max)} 上限附近。`,
    };
  }

  if (!hasCashInstrument) {
    return {
      ...base,
      key: `cash-wait-${holding.id}`,
      action: currentWeight < band.min ? "补现金后加" : "继续持有",
      tone: currentWeight < band.min ? "caution" : "neutral",
      amount: 0,
      amountLabel: currentWeight < band.min ? formatAmount(0, holding.currency) : "—",
      weightDelta: 0,
      weightLabel: currentWeight < band.min ? "0%" : `${formatWeight(currentWeight)} / ${targetBandLabel}`,
      reason: currentWeight < band.min ? "低于区间，但未记录现金" : "现金数据缺失",
      detail: "添加现金/货基后，系统才能把建议换算成可执行金额。",
    };
  }

  if (currentWeight < band.min) {
    const addLimit = addLimitFor({ cashWeight, marketRiskScore, policy, profileBlockReason, riskGate });
    return addActionFor({
      action: addLimit.blocked ? "暂停定投" : addLimit.watch ? "可小加" : "可加仓",
      currentWeight,
      holding,
      limitReason: addLimit.reason,
      policy,
      riskMultiplier: addLimit.multiplier,
      targetWeight: band.target,
      totalValue,
      maxBudget: addableBudget,
      base,
    });
  }

  if (currentWeight < band.target - 0.25) {
    const addLimit = addLimitFor({ cashWeight, marketRiskScore, policy, profileBlockReason, riskGate });
    return addActionFor({
      action: addLimit.blocked ? "暂停定投" : "可小加",
      currentWeight,
      holding,
      limitReason: addLimit.reason,
      policy,
      riskMultiplier: addLimit.multiplier,
      targetWeight: band.target,
      totalValue,
      maxBudget: addableBudget,
      base,
      halfStep: true,
    });
  }

  return {
    ...base,
    key: `hold-${holding.id}`,
    action: "继续持有",
    tone: "neutral",
    amount: 0,
    amountLabel: "—",
    weightDelta: 0,
    weightLabel: `${formatWeight(currentWeight)} / ${targetBandLabel}`,
    reason: `当前位于 ${targetBandLabel} 区间内`,
    detail: holding.profileKey ? `已关联 ${holding.profileKey}，按 Profile 风险门观察。` : "仓位未偏离，继续观察触发条件。",
  };
}

function addActionFor({
  action,
  base,
  currentWeight,
  halfStep = false,
  holding,
  limitReason,
  policy,
  riskMultiplier,
  maxBudget,
  targetWeight,
  totalValue,
}: {
  action: "可加仓" | "可小加" | "暂停定投";
  base: Pick<PositionPlanAction, "holdingId" | "name" | "profileKey" | "symbol" | "targetBandLabel">;
  currentWeight: number;
  halfStep?: boolean;
  holding: HoldingRecord;
  limitReason: string;
  policy: PositionPolicy;
  riskMultiplier: number;
  maxBudget: number;
  targetWeight: number;
  totalValue: number;
}): PositionPlanAction {
  const rawDeltaWeight = Math.max(0, targetWeight - currentWeight) * (halfStep ? 0.5 : 1);
  const chunkWeight = Math.min(rawDeltaWeight, policy.maxSingleAddWeight * riskMultiplier);
  const requestedAmount = (totalValue * chunkWeight) / 100;
  const amount = action === "暂停定投" ? 0 : Math.min(requestedAmount, maxBudget);
  const actualDeltaWeight = totalValue > 0 ? (amount / totalValue) * 100 : 0;
  const blockedByBudget = action !== "暂停定投" && requestedAmount > 0 && amount <= 0;
  const budgetLimited = amount > 0 && amount < requestedAmount;
  const resolvedAction = blockedByBudget ? "预算不足" : action;
  const nextWeight = currentWeight + actualDeltaWeight;
  const paused = resolvedAction === "暂停定投" || resolvedAction === "预算不足";

  return {
    ...base,
    key: `${resolvedAction === "可小加" ? "small-add" : paused ? "pause-add" : "add"}-${holding.id}`,
    action: resolvedAction,
    tone: paused ? "caution" : "positive",
    amount,
    amountLabel: amount > 0 ? formatAmount(amount, holding.currency) : paused ? formatAmount(0, holding.currency) : "—",
    weightDelta: round1(actualDeltaWeight),
    weightLabel: amount > 0 ? `+${formatWeight(actualDeltaWeight)}` : paused ? "0%" : "—",
    reason: blockedByBudget ? "可加预算已分配给更高优先级资产" : limitReason || `当前 ${formatWeight(currentWeight)}，低于目标 ${formatWeight(targetWeight)}`,
    detail:
      amount > 0
        ? `${buyVerbFor(holding)} ${formatAmount(amount, holding.currency)}，仓位约 ${formatWeight(currentWeight)} → ${formatWeight(nextWeight)}。${
            budgetLimited ? "受剩余预算限制。" : `单次上限 ${formatWeight(policy.maxSingleAddWeight)}。`
          }`
        : resolvedAction === "暂停定投"
          ? `今日不${buyVerbFor(holding)}，${limitReason || "风险门未打开"}。`
          : resolvedAction === "预算不足"
            ? "今日不加，现金预算已分配给优先级更高的资产。"
            : limitReason || "先执行优先级更高动作，或补充现金后再加仓。",
  };
}

function riskGateActionFor({
  riskGate,
  totalValue,
}: {
  riskGate: PositionRiskGate | null;
  totalValue: number;
}): PositionPlanAction | null {
  if (!riskGate || totalValue <= 0 || (!riskGate.blocked && !riskGate.watch)) return null;
  return {
    key: `profile-risk-${riskGate.blocked ? "blocked" : "watch"}`,
    holdingId: null,
    symbol: "Profile",
    name: riskGate.source,
    action: riskGate.blocked ? "暂停加仓" : "小额执行",
    tone: riskGate.tone,
    amount: 0,
    amountLabel: "—",
    weightDelta: 0,
    weightLabel: riskGate.blocked ? "阻断" : "观察",
    targetBandLabel: riskGate.label,
    reason: riskGate.reason,
    detail: riskGate.blocked ? "风险门未通过时，只保留持有/减仓动作。" : "风险门观察时，新增动作按规则缩小。",
  };
}

function guardrailActionFor({
  cashWeight,
  currency,
  hasCashInstrument,
  policy,
  totalValue,
}: {
  cashWeight: number;
  currency: string;
  hasCashInstrument: boolean;
  policy: PositionPolicy;
  totalValue: number;
}): PositionPlanAction | null {
  if (totalValue <= 0) return null;
  if (!hasCashInstrument) {
    return {
      key: "cash-missing",
      holdingId: null,
      symbol: "现金",
      name: "账户缓冲",
      action: "补现金",
      tone: "caution",
      amount: 0,
      amountLabel: "—",
      weightDelta: 0,
      weightLabel: "未记录",
      targetBandLabel: `>=${policy.minCashWeight}%`,
      reason: "未记录现金/货基",
      detail: "补一条现金持仓后，可加仓预算会自动换算成金额。",
    };
  }
  if (cashWeight >= policy.minCashWeight) return null;

  const needed = (totalValue * (policy.minCashWeight - cashWeight)) / 100;
  return {
    key: "cash-low",
    holdingId: null,
    symbol: "现金",
    name: "账户缓冲",
    action: "暂停加仓",
    tone: "negative",
    amount: needed,
    amountLabel: formatAmount(needed, currency),
    weightDelta: round1(policy.minCashWeight - cashWeight),
    weightLabel: `缺 ${formatWeight(policy.minCashWeight - cashWeight)}`,
    targetBandLabel: `>=${policy.minCashWeight}%`,
    reason: `现金 ${formatWeight(cashWeight)}，低于下限`,
    detail: "先恢复现金缓冲，再考虑新增风险仓位。",
  };
}

function planStatus({
  cashDecision,
  cashWeight,
  decision,
  hasCashInstrument,
  marketRiskScore,
  profileHealth,
  realCount,
  riskGate,
}: {
  cashDecision: CashDecision;
  cashWeight: number;
  decision: PortfolioDecision;
  hasCashInstrument: boolean;
  marketRiskScore: number;
  profileHealth: ProfileHealth;
  realCount: number;
  riskGate: PositionRiskGate | null;
}) {
  if (!realCount) {
    return { label: "待建仓", tone: "neutral" as const, summary: "先添加真实持仓。" };
  }
  if (!hasCashInstrument) {
    return { label: "缺现金数据", tone: "caution" as const, summary: "补现金后可计算加仓预算。" };
  }
  if (!profileHealth.valid) {
    return { label: "配置阻断", tone: "negative" as const, summary: profileHealth.message };
  }
  if (riskGate?.blocked) {
    return { label: riskGate.label, tone: riskGate.tone, summary: riskGate.reason };
  }
  if (marketRiskScore >= 78) {
    return { label: "研究降额", tone: "caution" as const, summary: "风险评分偏高，仅保留小额模拟动作。" };
  }
  if (cashWeight < 8) {
    return { label: "现金偏低", tone: "negative" as const, summary: "优先恢复现金缓冲。" };
  }
  if (cashDecision.status === "LOW_CASH") {
    return { label: "谨慎", tone: "caution" as const, summary: "只处理减仓和计划内小动作。" };
  }
  if (cashDecision.status === "SEVERE_EXCESS_CASH" || cashDecision.status === "EXCESS_CASH") {
    return { label: cashDecision.label, tone: cashDecision.tone, summary: `待部署 ${formatAmount(decision.pendingDeployBudget, decision.currency)}。` };
  }
  if (riskGate?.watch) {
    return { label: riskGate.label, tone: riskGate.tone, summary: riskGate.reason };
  }
  return { label: "可执行", tone: "positive" as const, summary: "现金缓冲满足加仓纪律。" };
}

function addLimitFor({
  cashWeight,
  marketRiskScore,
  policy,
  profileBlockReason = "",
  riskGate,
}: {
  cashWeight: number;
  marketRiskScore: number;
  policy: PositionPolicy;
  profileBlockReason?: string;
  riskGate: PositionRiskGate | null;
}) {
  if (profileBlockReason) {
    return { blocked: true, watch: false, multiplier: 0, reason: profileBlockReason };
  }
  if (riskGate?.blocked) {
    return { blocked: true, watch: false, multiplier: 0, reason: riskGate.reason };
  }
  if (marketRiskScore >= 78) {
    return { blocked: false, watch: true, multiplier: 0.25, reason: "风险评分偏高，仅保留小额模拟动作" };
  }
  if (marketRiskScore >= 66) {
    return { blocked: false, watch: true, multiplier: 0.5, reason: "风险评分进入观察区，只做半额模拟动作" };
  }
  if (cashWeight < policy.minCashWeight) {
    return { blocked: true, watch: false, multiplier: 0, reason: `现金低于 ${policy.minCashWeight}% 下限` };
  }
  if (riskGate?.watch) {
    return { blocked: false, watch: true, multiplier: riskGate.addMultiplier, reason: riskGate.reason };
  }
  return { blocked: false, watch: false, multiplier: riskGate?.addMultiplier ?? 1, reason: "" };
}

function compareActions(left: PositionPlanAction, right: PositionPlanAction) {
  const priority = (action: PositionPlanAction) => {
    if (action.action === "应减仓" || action.action === "暂停加仓") return 0;
    if (action.action === "可加仓") return 1;
    if (action.action === "可小加") return 2;
    if (action.action === "暂停定投" || action.action === "预算不足" || action.action === "补现金后加" || action.action === "补现金") return 3;
    if (action.action === "设置计划") return 4;
    return 5;
  };
  const priorityDiff = priority(left) - priority(right);
  if (priorityDiff !== 0) return priorityDiff;
  return Math.abs(right.weightDelta) - Math.abs(left.weightDelta);
}

function horizonAdviceFor({
  actions,
  cashWeight,
  currency,
  hasCashInstrument,
  policy,
  realRows,
  riskGate,
  riskRows,
  totalValue,
  trimNeeded,
}: {
  actions: PositionPlanAction[];
  cashWeight: number;
  currency: string;
  hasCashInstrument: boolean;
  policy: PositionPolicy;
  realRows: HoldingRecord[];
  riskGate: PositionRiskGate | null;
  riskRows: HoldingRecord[];
  totalValue: number;
  trimNeeded: number;
}): PositionPlanHorizon[] {
  const assetActions = actions.filter((action) => action.holdingId);
  const reductions = assetActions.filter((action) => action.weightDelta < 0);
  const adds = assetActions.filter((action) => action.weightDelta > 0 && action.amount > 0);
  const pausedAdds = assetActions.filter(
    (action) => action.action === "暂停定投" || action.action === "预算不足" || action.action === "补现金后加",
  );
  const setupCount = assetActions.filter((action) => action.action === "设置计划").length;
  const addTotal = sumActionAmounts(adds);
  const firstAdd = adds[0];
  const firstReduce = reductions[0];
  const firstPaused = pausedAdds[0];
  const largestRisk = largestRiskHolding(realRows, totalValue);

  const short: PositionPlanHorizon = riskGate?.blocked
    ? {
        key: "short",
        label: "短期",
        range: "0-2 周",
        action: "暂停新增",
        tone: "negative",
        amountLabel: "新增 0",
        target: "只处理减仓/持有",
        trigger: "Profile 风险门修复后再看",
        detail: firstReduce
          ? `先${sellVerbText(firstReduce)} ${firstReduce.symbol} ${firstReduce.amountLabel}。`
          : "不做新增风险仓位，观察 Profile 分数和触发条件。",
      }
    : firstReduce
      ? {
          key: "short",
          label: "短期",
          range: "0-2 周",
          action: "先减仓",
          tone: "negative",
          amountLabel: formatAmount(trimNeeded, currency),
          target: "降回目标上限",
          trigger: "超上限资产优先处理",
          detail: `${firstReduce.symbol} ${firstReduce.amountLabel}，${firstReduce.reason}。`,
        }
      : firstAdd
        ? {
            key: "short",
            label: "短期",
            range: "0-2 周",
            action: adds.length > 1 ? "分批加仓" : firstAdd.action,
            tone: "positive",
            amountLabel: firstAdd.amountLabel,
            target: `${firstAdd.symbol} ${firstAdd.weightLabel}`,
            trigger: riskGate?.watch ? "观察态只做半仓节奏" : "按今日行动清单执行",
            detail: `${firstAdd.symbol} ${firstAdd.amountLabel}；多标的时先做前 1-2 个优先级。`,
        }
        : {
            key: "short",
            label: "短期",
            range: "0-2 周",
            action: setupCount ? "先补计划" : firstPaused ? firstPaused.action : "今日不动",
            tone: setupCount || firstPaused ? "caution" : "neutral",
            amountLabel: firstPaused ? formatAmount(0, currency) : "—",
            target: setupCount ? `${setupCount} 个资产缺目标` : firstPaused ? firstPaused.symbol : "不新增",
            trigger: hasCashInstrument ? (firstPaused ? firstPaused.reason : "目标带内") : "先补现金记录",
            detail: setupCount
              ? "补齐最小/目标/最大仓位后，才能输出金额建议。"
              : firstPaused
                ? `${firstPaused.symbol} ${formatAmount(0, currency)}，${firstPaused.reason}。`
                : "仓位未明显偏离，今天不做新增或减仓。",
          };

  const medium: PositionPlanHorizon = !hasCashInstrument
    ? {
        key: "medium",
        label: "中期",
        range: "2-12 周",
        action: "补现金基准",
        tone: "caution",
        amountLabel: "—",
        target: `现金 >= ${policy.minCashWeight}%`,
        trigger: "记录现金/货基后再平衡",
        detail: "没有现金记录时，所有加仓金额都会失真。",
      }
    : riskGate?.blocked
      ? {
          key: "medium",
          label: "中期",
          range: "2-12 周",
          action: "防守复核",
          tone: "negative",
          amountLabel: trimNeeded > 0 ? formatAmount(trimNeeded, currency) : "新增 0",
          target: `现金 >= ${policy.minCashWeight}%`,
          trigger: "风险门转观察/通过",
          detail: "维持现金缓冲，只把超上限仓位降回区间。",
        }
      : addTotal > 0 || trimNeeded > 0
        ? {
            key: "medium",
            label: "中期",
            range: "2-12 周",
            action: "回到目标带",
            tone: addTotal > 0 ? "positive" : "caution",
            amountLabel: formatAmount(addTotal + trimNeeded, currency),
            target: `${adds.length} 加 / ${reductions.length} 减`,
            trigger: "每周复核一次偏离",
            detail: `按目标区间分批处理，不让单只超过 ${formatWeight(policy.singleAssetCap)}。`,
          }
        : firstPaused
          ? {
              key: "medium",
              label: "中期",
              range: "2-12 周",
              action: firstPaused.action === "补现金后加" ? "补现金后加" : firstPaused.action === "预算不足" ? "等预算释放" : "等风险门",
              tone: "caution",
              amountLabel: "新增 0",
              target: firstPaused.targetBandLabel,
              trigger: firstPaused.reason,
              detail: `${firstPaused.symbol} 暂不扩仓；现金、风险门或预算释放后再恢复定投/加仓。`,
            }
        : {
            key: "medium",
            label: "中期",
            range: "2-12 周",
            action: "维持区间",
            tone: "neutral",
            amountLabel: "—",
            target: `现金 ${formatWeight(cashWeight)}`,
            trigger: "偏离目标带再动作",
            detail: "仓位和现金都在纪律内，保持复核节奏。",
          };

  const long: PositionPlanHorizon =
    riskRows.length < 2
      ? {
          key: "long",
          label: "长期",
          range: "3-12 个月",
          action: "补充分散",
          tone: "caution",
          amountLabel: "配置规划",
          target: "至少 2-4 个真实风险资产",
          trigger: "新增基金/股票前先设目标带",
          detail: "当前真实风险资产偏少，长期建议先补核心/主题/防守分层。",
        }
      : largestRisk && largestRisk.weight > policy.singleAssetCap
        ? {
            key: "long",
            label: "长期",
            range: "3-12 个月",
            action: "降集中度",
            tone: "caution",
            amountLabel: largestRisk.symbol,
            target: `单只 <= ${formatWeight(policy.singleAssetCap)}`,
            trigger: "月度或季度再平衡",
            detail: `${largestRisk.symbol} 当前 ${formatWeight(largestRisk.weight)}，长期不应持续压过单只上限。`,
          }
        : {
            key: "long",
            label: "长期",
            range: "3-12 个月",
            action: "维护目标带",
            tone: "neutral",
            amountLabel: `${riskRows.length} 个风险资产`,
            target: `现金 >= ${policy.minCashWeight}%`,
            trigger: "月度复核目标区间",
            detail: "长期只调目标带和集中度，不因短线波动频繁改配置。",
          };

  return [short, medium, long];
}

function compareHoldingPlanPriority(left: HoldingRecord, right: HoldingRecord, totalValue: number, policy: PositionPolicy) {
  const leftRank = holdingPlanRank(left, totalValue, policy);
  const rightRank = holdingPlanRank(right, totalValue, policy);
  if (leftRank.bucket !== rightRank.bucket) return leftRank.bucket - rightRank.bucket;
  if (leftRank.gap !== rightRank.gap) return rightRank.gap - leftRank.gap;
  return left.symbol.localeCompare(right.symbol);
}

function holdingPlanRank(holding: HoldingRecord, totalValue: number, policy: PositionPolicy) {
  const currentWeight = totalValue > 0 ? (marketValueOf(holding) / totalValue) * 100 : 0;
  const band = targetBandForHolding(holding, policy);
  if (band.target <= 0) return { bucket: 4, gap: 0 };
  if (currentWeight > band.max) return { bucket: 0, gap: currentWeight - band.max };
  if (currentWeight < band.min) return { bucket: 1, gap: band.min - currentWeight };
  if (currentWeight < band.target - 0.25) return { bucket: 2, gap: band.target - currentWeight };
  return { bucket: 3, gap: Math.abs(currentWeight - band.target) };
}

function sumActionAmounts(actions: PositionPlanAction[]) {
  return actions.reduce((sum, action) => sum + Math.max(0, action.amount), 0);
}

function largestRiskHolding(rows: HoldingRecord[], totalValue: number) {
  if (totalValue <= 0) return null;
  return rows
    .filter((holding) => holding.role === "real" && !isCashHolding(holding))
    .map((holding) => ({ symbol: holding.symbol, weight: (marketValueOf(holding) / totalValue) * 100 }))
    .sort((left, right) => right.weight - left.weight)[0] ?? null;
}

function buyVerbFor(holding: HoldingRecord) {
  return holding.assetType === "fund" ? "申购" : "买入";
}

function sellVerbFor(holding: HoldingRecord) {
  return holding.assetType === "fund" ? "赎回" : "卖出";
}

function sellVerbText(action: PositionPlanAction) {
  return action.assetType === "fund" ? "赎回" : "卖出";
}

function optionalWeight(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function clampPolicyNumber(value: number | undefined, fallback: number, min: number, max: number) {
  const resolved = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return round1(clamp(resolved, min, max));
}

function compactText(value: string | undefined, fallback: string) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return fallback;
  return text.length > 54 ? `${text.slice(0, 54)}…` : text;
}

function dominantCurrency(rows: HoldingRecord[]) {
  return rows.find(isCashHolding)?.currency || rows[0]?.currency || "CNY";
}

function marketValueOf(holding: HoldingRecord) {
  return holding.quantity * holding.currentPrice;
}

function formatAmount(value: number, currency: string) {
  if (!Number.isFinite(value) || value <= 0) return "—";
  try {
    return new Intl.NumberFormat("zh-CN", {
      currency,
      maximumFractionDigits: 0,
      style: "currency",
    }).format(value);
  } catch {
    return new Intl.NumberFormat("zh-CN", {
      maximumFractionDigits: 0,
    }).format(value);
  }
}

function formatWeight(value: number) {
  return `${round1(value)}%`;
}

function round1(value: number) {
  return Math.round(value * 10) / 10;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
