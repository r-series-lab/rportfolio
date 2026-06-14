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
  const blocked = Boolean(firstBlock) || ["broken", "panic"].includes(protocolState) || permissionTone === "negative" || defensiveTone;
  const watch = !blocked && (Boolean(firstWatch) || permissionTone === "caution" || report.score >= 66);
  const reason =
    firstBlock?.detail ||
    (defensiveTone ? shortAdvice?.rationale : "") ||
    firstWatch?.detail ||
    report.decisionFrame.condition ||
    report.summary;

  if (blocked) {
    return {
      label: "Profile 阻断",
      tone: "negative",
      blocked: true,
      watch: false,
      addMultiplier: 0,
      reason: compactText(reason, "风险门未通过，暂停新增风险仓位。"),
      source: shortAdvice?.horizonLabel ?? "Profile",
    };
  }
  if (watch) {
    return {
      label: "Profile 观察",
      tone: "caution",
      blocked: false,
      watch: true,
      addMultiplier: 0.5,
      reason: compactText(reason, "风险门处于观察状态，只允许小额动作。"),
      source: shortAdvice?.horizonLabel ?? "Profile",
    };
  }
  return {
    label: "Profile 通过",
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
  const addableBudget =
    totalValue > 0 && hasCashInstrument ? Math.max(0, cashValue - (totalValue * policy.minCashWeight) / 100) : 0;
  const addLimit = addLimitFor({ cashWeight, marketRiskScore, policy, riskGate });
  const executableAddableBudget = addLimit.blocked ? 0 : addableBudget;
  const status = planStatus({ cashWeight, hasCashInstrument, marketRiskScore, policy, realCount: realRows.length, riskGate });
  let remainingAddableBudget = executableAddableBudget;
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
    addableBudget: executableAddableBudget,
    addableBudgetLabel: addLimit.blocked ? "暂停" : formatAmount(executableAddableBudget, currency),
    trimNeeded,
    trimNeededLabel: trimNeeded > 0 ? formatAmount(trimNeeded, currency) : "—",
    hasCashInstrument,
    actionCount: actions.filter((action) => action.holdingId).length,
    actions,
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

function actionForHolding({
  addableBudget,
  cashWeight,
  holding,
  hasCashInstrument,
  marketRiskScore,
  policy,
  riskGate,
  totalValue,
}: {
  addableBudget: number;
  cashWeight: number;
  holding: HoldingRecord;
  hasCashInstrument: boolean;
  marketRiskScore: number;
  policy: PositionPolicy;
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
      action: currentWeight < band.min ? "等待" : "继续持有",
      tone: currentWeight < band.min ? "caution" : "neutral",
      amount: 0,
      amountLabel: "—",
      weightDelta: 0,
      weightLabel: `${formatWeight(currentWeight)} / ${targetBandLabel}`,
      reason: currentWeight < band.min ? "低于区间，但未记录现金" : "现金数据缺失",
      detail: "添加现金/货基后，系统才能把建议换算成可执行金额。",
    };
  }

  if (currentWeight < band.min) {
    const addLimit = addLimitFor({ cashWeight, marketRiskScore, policy, riskGate });
    return addActionFor({
      action: addLimit.blocked ? "等待" : addLimit.watch ? "可小加" : "可加仓",
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

  if (currentWeight < band.target - 1) {
    const addLimit = addLimitFor({ cashWeight, marketRiskScore, policy, riskGate });
    return addActionFor({
      action: addLimit.blocked ? "等待" : "可小加",
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
    detail: holding.profileKey ? `已关联 ${holding.profileKey}，按 Profile 风险门观察。` : "仓位未偏离，等待新触发条件。",
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
  action: "可加仓" | "可小加" | "等待";
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
  const amount = action === "等待" ? 0 : Math.min(requestedAmount, maxBudget);
  const actualDeltaWeight = totalValue > 0 ? (amount / totalValue) * 100 : 0;
  const blockedByBudget = action !== "等待" && requestedAmount > 0 && amount <= 0;
  const budgetLimited = amount > 0 && amount < requestedAmount;
  const resolvedAction = blockedByBudget ? "等待" : action;
  const nextWeight = currentWeight + actualDeltaWeight;

  return {
    ...base,
    key: `${resolvedAction === "可小加" ? "small-add" : resolvedAction === "等待" ? "wait" : "add"}-${holding.id}`,
    action: resolvedAction,
    tone: resolvedAction === "等待" ? "caution" : "positive",
    amount,
    amountLabel: amount > 0 ? formatAmount(amount, holding.currency) : "—",
    weightDelta: round1(actualDeltaWeight),
    weightLabel: amount > 0 ? `+${formatWeight(actualDeltaWeight)}` : "—",
    reason: blockedByBudget ? "可加预算已分配给更高优先级资产" : limitReason || `当前 ${formatWeight(currentWeight)}，低于目标 ${formatWeight(targetWeight)}`,
    detail:
      amount > 0
        ? `${buyVerbFor(holding)} ${formatAmount(amount, holding.currency)}，仓位约 ${formatWeight(currentWeight)} → ${formatWeight(nextWeight)}。${
            budgetLimited ? "受剩余预算限制。" : `单次上限 ${formatWeight(policy.maxSingleAddWeight)}。`
          }`
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
  cashWeight,
  hasCashInstrument,
  marketRiskScore,
  policy,
  realCount,
  riskGate,
}: {
  cashWeight: number;
  hasCashInstrument: boolean;
  marketRiskScore: number;
  policy: PositionPolicy;
  realCount: number;
  riskGate: PositionRiskGate | null;
}) {
  if (!realCount) {
    return { label: "待建仓", tone: "neutral" as const, summary: "先添加真实持仓。" };
  }
  if (!hasCashInstrument) {
    return { label: "缺现金数据", tone: "caution" as const, summary: "补现金后可计算加仓预算。" };
  }
  if (riskGate?.blocked) {
    return { label: riskGate.label, tone: riskGate.tone, summary: riskGate.reason };
  }
  if (marketRiskScore >= 78) {
    return { label: "防守", tone: "negative" as const, summary: "风险评分偏高，暂停扩仓。" };
  }
  if (cashWeight < 8) {
    return { label: "现金偏低", tone: "negative" as const, summary: "优先恢复现金缓冲。" };
  }
  if (cashWeight < policy.minCashWeight) {
    return { label: "谨慎", tone: "caution" as const, summary: "只处理减仓和计划内小动作。" };
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
  riskGate,
}: {
  cashWeight: number;
  marketRiskScore: number;
  policy: PositionPolicy;
  riskGate: PositionRiskGate | null;
}) {
  if (riskGate?.blocked) {
    return { blocked: true, watch: false, multiplier: 0, reason: riskGate.reason };
  }
  if (marketRiskScore >= 78) {
    return { blocked: true, watch: false, multiplier: 0, reason: "风险评分偏高，先等待 Profile 风险门修复" };
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
    if (action.action === "等待" || action.action === "补现金") return 3;
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
  const waits = assetActions.filter((action) => action.action === "等待");
  const setupCount = assetActions.filter((action) => action.action === "设置计划").length;
  const addTotal = sumActionAmounts(adds);
  const firstAdd = adds[0];
  const firstReduce = reductions[0];
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
            action: setupCount ? "先补计划" : "持有观察",
            tone: setupCount || waits.length ? "caution" : "neutral",
            amountLabel: "—",
            target: setupCount ? `${setupCount} 个资产缺目标` : "不新增",
            trigger: hasCashInstrument ? "等 Profile / 价格触发" : "先补现金记录",
            detail: setupCount ? "补齐最小/目标/最大仓位后，才能输出金额建议。" : "仓位未明显偏离，等待新触发。",
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
  if (currentWeight < band.target - 1) return { bucket: 2, gap: band.target - currentWeight };
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
