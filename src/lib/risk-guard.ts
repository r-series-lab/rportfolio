import {
  holdingAssetTypeLabel,
  type HoldingAssetType,
  type HoldingRecord,
} from "./holdings";
import { evaluateExecutionQuality, type ExecutionQualityAssessment, type ExecutionQuote } from "./execution-quality";
import { isCashHolding, targetBandForHolding, type PositionPlan } from "./position-plan";
import type { OrderRecord } from "./order-store";
import {
  DEFAULT_RISK_GUARD_POLICY,
  normalizeRiskGuardPolicy,
  riskPolicyInstrumentCap,
  type RiskGuardPolicy,
} from "./risk-policy";
import type { LabTone, OrderIntent, QbotPreset, StrategyScore } from "./strategy-engine";
import type { MarketAnalysisReport, TechnicalRow } from "./types";
import { formatMoney, formatNumber, formatPercent } from "./utils";
import { assessDataQuality } from "./data-quality";
import { overlapClusterForHolding, overlapPairForHolding } from "./portfolio-overlap";
import { substitutionForHolding } from "./fund-substitution";
import { holdingMarketValueInBase } from "./portfolio-valuation";

export type RiskInstrumentKind = "fund" | "etf" | "leveraged-etf" | "stock" | "cash" | "other";
export type RiskGuardSeverity = "pass" | "warn" | "block";

export type RiskGuardCheck = {
  key: string;
  label: string;
  severity: RiskGuardSeverity;
  detail: string;
  overridden?: boolean;
};

export type RiskGuardResult = {
  blocked: boolean;
  checks: RiskGuardCheck[];
  executionQuality: ExecutionQualityAssessment;
  instrumentKind: RiskInstrumentKind;
  instrumentLabel: string;
  intent: OrderIntent;
  limitHint: string;
  quantityHint: string;
  summary: string;
  tone: LabTone;
  warnings: string[];
};

export type RiskGuardInput = {
  holdings: HoldingRecord[];
  orderIntent: OrderIntent;
  positionPlan: PositionPlan;
  policy?: RiskGuardPolicy;
  preset: QbotPreset;
  quote?: ExecutionQuote | null;
  queuedOrders: OrderRecord[];
  report: MarketAnalysisReport;
  riskOverride: boolean;
  score: StrategyScore;
  totalValue: number;
};

const ACTIVE_ORDER_STATUSES = new Set(["preview", "queued", "prepared", "submitted", "partially_filled"]);

export function guardOrderIntent({
  holdings,
  orderIntent,
  policy,
  positionPlan,
  preset,
  quote,
  queuedOrders,
  report,
  riskOverride,
  score,
  totalValue,
}: RiskGuardInput): RiskGuardResult {
  const activePolicy = normalizeRiskGuardPolicy(policy ?? DEFAULT_RISK_GUARD_POLICY);
  const side = normalizeSide(orderIntent.side);
  const holding = findHolding(holdings, orderIntent.symbol);
  const technical = report.technicalRows.find((row) => sameSymbol(row.symbol, orderIntent.symbol));
  const instrumentKind = classifyInstrument(orderIntent, holding, preset);
  const instrumentLabel = instrumentKindLabel(instrumentKind, holding?.assetType);
  const checks: RiskGuardCheck[] = [];
  const originalNotional = orderIntent.notional ?? parseMoney(orderIntent.amount);
  const originalBaseNotional = orderIntent.baseNotional ?? originalNotional;
  const originalWeight = parsePercent(orderIntent.weight);
  let effectiveNotional = originalNotional;
  let effectiveBaseNotional = originalBaseNotional;
  let effectiveWeight = originalWeight;
  let capped = false;

  const addCheck = (
    key: string,
    label: string,
    severity: RiskGuardSeverity,
    detail: string,
    overridable = true,
  ) => {
    if (severity === "block" && riskOverride && overridable) {
      checks.push({ key, label, severity: "warn", detail: `手动放行：${detail}`, overridden: true });
      return;
    }
    checks.push({ key, label, severity, detail });
  };

  if (isBuy(side) && orderIntent.scaling) {
    addCheck(
      "strategy.scaling",
      "仓位递进",
      orderIntent.scaling.allowed ? "pass" : "block",
      `${orderIntent.scaling.policyLabel} · ${orderIntent.scaling.stateLabel} · ${orderIntent.scaling.detail}`,
      false,
    );
  }

  if (instrumentKind === "cash") {
    addCheck("instrument.cash", "标的类型", "block", "现金或货基不作为交易委托标的。", false);
  } else {
    addCheck("instrument.kind", "标的类型", "pass", `${instrumentLabel} · ${orderIntent.symbol}`);
  }

  const dataQuality = assessDataQuality(report, true);
  dataQuality.checks.forEach((check) => {
    const severity = !isBuy(side) && check.severity === "block" ? "warn" : check.severity;
    addCheck(
      `data.${check.key}`,
      check.label,
      severity,
      severity === "warn" && check.severity === "block" ? `${check.detail} 当前仅允许降低风险。` : check.detail,
      severity !== "block",
    );
  });

  positionPlan.valuation.checks.forEach((check) => {
    const reductionOverride = !isBuy(side) && positionPlan.valuation.riskReductionAllowed && check.severity === "block";
    addCheck(
      `valuation.${check.key}`,
      check.label,
      reductionOverride ? "warn" : check.severity,
      reductionOverride ? `${check.detail} 当前仅允许降低风险。` : check.detail,
      reductionOverride,
    );
  });

  if (!positionPlan.decision.profileHealth.valid) {
    addCheck("profile.invalid", "配置完整性", "block", positionPlan.decision.profileHealth.message || "Profile 目标带配置不可执行。", false);
  }

  const dailyLimitCheck = dailyOrderLimitCheck({ orderIntent, policy: activePolicy, queuedOrders });
  addCheck(dailyLimitCheck.key, "单日委托", dailyLimitCheck.severity, dailyLimitCheck.detail, dailyLimitCheck.overridable);

  if (instrumentKind === "fund") {
    fundTradeChecks({ holding, notional: effectiveNotional, report, side }).forEach((check) => {
      addCheck(check.key, check.label, check.severity, check.detail, false);
    });
  }

  if (isBuy(side)) {
    const cashCheck = cashCapacityCheck({ notional: effectiveBaseNotional, positionPlan, totalValue });
    addCheck(cashCheck.key, "现金校验", cashCheck.severity, cashCheck.detail, cashCheck.overridable);
  } else {
    const sellCheck = sellCapacityCheck({ holding, notional: effectiveNotional });
    addCheck(sellCheck.key, "持仓校验", sellCheck.severity, sellCheck.detail, sellCheck.overridable);
  }

  const activeDuplicate = queuedOrders.find((order) =>
    isActiveOrderForGuard(order)
    && sameSymbol(order.symbol, orderIntent.symbol)
    && normalizeSide(order.side) === side
  );
  if (activeDuplicate) {
    addCheck(
      "duplicate.active",
      "重复委托",
      "block",
      `${orderIntent.symbol} 已有活跃${sideLabel(side)}委托，先同步或撤单后再下。`,
      false,
    );
  }

  const cooldownCheck = cooldownOrderCheck({ orderIntent, policy: activePolicy, queuedOrders, side });
  if (cooldownCheck) {
    addCheck(cooldownCheck.key, "冷却时间", cooldownCheck.severity, cooldownCheck.detail, cooldownCheck.overridable);
  }

  if (isBuy(side)) {
    const cap = maxSingleBuyWeight(instrumentKind, positionPlan, activePolicy);
    if (effectiveWeight > cap && cap > 0) {
      effectiveWeight = cap;
      effectiveBaseNotional = totalValue > 0 ? (totalValue * cap) / 100 : effectiveBaseNotional;
      effectiveNotional = settlementNotionalForBase(effectiveBaseNotional, orderIntent);
      capped = true;
      addCheck("budget.cap", "单笔上限", "warn", `单笔预算已降至 ${formatPercent(cap)}。`);
    } else {
      addCheck("budget.cap", "单笔上限", "pass", `单笔预算 ${formatPercent(effectiveWeight || cap)}。`);
    }

    const targetCheck = targetBandCheck({
      effectiveNotional: effectiveBaseNotional,
      holding,
      positionPlan,
      totalValue,
    });
    if (targetCheck.cappedNotional != null && targetCheck.cappedNotional < effectiveBaseNotional) {
      effectiveBaseNotional = targetCheck.cappedNotional;
      effectiveNotional = settlementNotionalForBase(effectiveBaseNotional, orderIntent);
      effectiveWeight = totalValue > 0 ? (effectiveBaseNotional / totalValue) * 100 : effectiveWeight;
      capped = true;
    }
    addCheck(targetCheck.key, "目标带", targetCheck.severity, targetCheck.detail, targetCheck.overridable);

    if (instrumentKind === "fund" || instrumentKind === "etf") {
      const pair = overlapPairForHolding(holdings, orderIntent.symbol, totalValue, positionPlan.valuation.settings);
      const overlap = overlapClusterForHolding(holdings, orderIntent.symbol, totalValue, positionPlan.valuation.settings);
      if (pair) {
        const peer = sameSymbol(pair.left, orderIntent.symbol) ? pair.right : pair.left;
        const substitution = substitutionForHolding(holdings, pair, orderIntent.symbol);
        const evidence = [
          pair.overlapWeight >= 5
            ? `前十大重合 ${formatPercent(pair.overlapWeight)}${pair.commonSymbols.length ? `（${pair.commonSymbols.join(" / ")}）` : ""}`
            : "",
          pair.correlation60 != null ? `60日相关 ${formatNumber(pair.correlation60, 2)}` : "",
          pair.correlation120 != null ? `120日相关 ${formatNumber(pair.correlation120, 2)}` : "",
        ].filter(Boolean).join(" · ");
        addCheck(
          "portfolio.lookthrough-overlap",
          "分散校验",
          substitution?.isSecondary && substitution.action === "replace-candidate" ? "block" : "warn",
          `与 ${peer}：${evidence}${pair.overlapWeight >= 5 ? `，持仓截至 ${pair.asOf}` : ""}；${substitution?.isSecondary ? `${orderIntent.symbol} 为替换候选，暂停新增。` : substitution?.isPreferred ? `${orderIntent.symbol} 质量更优，优先保留但不重复叠加。` : "保持现状，不为小差异换仓。"}`,
          true,
        );
      } else if (overlap) {
        addCheck(
          "portfolio.overlap",
          "主题重叠",
          "warn",
          `${overlap.label}已占 ${formatPercent(overlap.weight)}，覆盖 ${overlap.symbols.join(" / ")}；新增前优先比较替代，不直接叠加。`,
          false,
        );
      }
    }
  }

  const executionQuality = evaluateExecutionQuality({
    holding,
    instrumentKind,
    orderIntent,
    quote,
    report,
    side,
    technical,
  });
  executionQuality.checks.forEach((check) => {
    addCheck(
      `execution.${check.key}`,
      check.label,
      check.severity,
      check.detail,
      check.overridable,
    );
  });

  addLossBrakeCheck({
    addCheck,
    instrumentKind,
    policy: activePolicy,
    side,
    technical,
  });

  const blocked = checks.some((check) => check.severity === "block");
  const warnings = checks
    .filter((check) => check.severity !== "pass")
    .map((check) => `${check.label}：${check.detail}`);
  const firstImportant = checks.find((check) => check.severity === "block")
    ?? checks.find((check) => check.severity === "warn");
  const summary = firstImportant?.detail ?? `${instrumentLabel} 风控通过。`;
  const tone: LabTone = blocked ? "negative" : warnings.length ? "caution" : score.tone === "negative" ? "caution" : orderIntent.tone;
  const intent: OrderIntent = {
    ...orderIntent,
    amount: capped && effectiveNotional > 0 ? formatMoney(effectiveNotional, orderIntent.currency ?? positionPlan.currency) : orderIntent.amount,
    baseCurrency: orderIntent.baseCurrency ?? positionPlan.currency,
    baseNotional: effectiveBaseNotional,
    currency: orderIntent.currency ?? positionPlan.currency,
    notional: effectiveNotional,
    detail: warnings.length ? `${orderIntent.detail} · ${warnings[0]}` : orderIntent.detail,
    state: blocked ? "已阻断" : capped ? "风控降级" : orderIntent.state,
    tone,
    weight: capped && effectiveWeight > 0 ? `${formatNumber(effectiveWeight, 1)}%` : orderIntent.weight,
  };

  return {
    blocked,
    checks,
    executionQuality,
    instrumentKind,
    instrumentLabel,
    intent,
    limitHint: executionQuality.limitHint,
    quantityHint: executionQuality.quantityHint,
    summary,
    tone,
    warnings,
  };
}

function fundTradeChecks({
  holding,
  notional,
  report,
  side,
}: {
  holding: HoldingRecord | undefined;
  notional: number;
  report: MarketAnalysisReport;
  side: string;
}): RiskGuardCheck[] {
  if (!holding) {
    return [{
      key: "fund.holding.missing",
      label: "基金资料",
      severity: "block",
      detail: "基金未进入持仓资料，无法校验净值与申购规则。",
    }];
  }

  const checks: RiskGuardCheck[] = [];
  const navAge = businessDayAge(holding.confirmedNavAsOf, report.asOf);
  if (!holding.confirmedNav || !holding.confirmedNavAsOf) {
    checks.push({
      key: "fund.nav.missing",
      label: "确认净值",
      severity: isBuy(side) ? "block" : "warn",
      detail: isBuy(side)
        ? "尚未同步基金确认净值和日期，不能生成买入交易票。"
        : "确认净值待同步；赎回按下一净值确认，允许降低风险但需复核份额。",
    });
  } else if (navAge === null || navAge > 3) {
    checks.push({
      key: "fund.nav.stale",
      label: "确认净值",
      severity: isBuy(side) ? "block" : "warn",
      detail: isBuy(side)
        ? `最新确认净值日期 ${holding.confirmedNavAsOf}，已超过买入时效。`
        : `最新确认净值日期 ${holding.confirmedNavAsOf}；赎回按下一净值确认，允许降低风险。`,
    });
  } else {
    checks.push({
      key: "fund.nav.ready",
      label: "确认净值",
      severity: "pass",
      detail: `确认净值 ${formatNumber(holding.confirmedNav, 4)} · ${holding.confirmedNavAsOf}。`,
    });
  }

  if (isBuy(side)) {
    const tradeStatusAge = businessDayAge(holding.fundTradeStatusAsOf, report.asOf);
    if (!holding.fundTradeStatusAsOf || tradeStatusAge === null || tradeStatusAge > 1) {
      checks.push({
        key: "fund.purchase.stale",
        label: "申购状态",
        severity: "block",
        detail: "基金申购状态不是当期数据，先刷新基金资料。",
      });
    } else if (holding.fundPurchaseOpen === false) {
      checks.push({
        key: "fund.purchase.closed",
        label: "申购状态",
        severity: "block",
        detail: holding.fundPurchaseStatus || "基金当前暂停申购。",
      });
    } else if (holding.fundPurchaseOpen !== true) {
      checks.push({
        key: "fund.purchase.unknown",
        label: "申购状态",
        severity: "block",
        detail: "尚未同步基金申购状态，先刷新基金资料。",
      });
    } else if (holding.fundPurchaseLimit && notional > holding.fundPurchaseLimit + 0.01) {
      checks.push({
        key: "fund.purchase.limit",
        label: "申购限额",
        severity: "block",
        detail: `单日申购上限 ${formatMoney(holding.fundPurchaseLimit, holding.currency)}，当前建议 ${formatMoney(notional, holding.currency)} 不可执行。`,
      });
    } else {
      checks.push({
        key: "fund.purchase.ready",
        label: "申购状态",
        severity: "pass",
        detail: holding.fundPurchaseStatus || "申购状态可用。",
      });
    }
  } else if (holding.fundRedemptionOpen === false) {
    checks.push({
      key: "fund.redemption.closed",
      label: "赎回状态",
      severity: "block",
      detail: holding.fundPurchaseStatus || "基金当前暂停赎回。",
    });
  }

  return checks;
}

function isActiveOrderForGuard(order: OrderRecord) {
  if (!ACTIVE_ORDER_STATUSES.has(order.status)) return false;
  if (order.status === "submitted" || order.status === "partially_filled") return true;
  const time = timeFromOrder(order);
  if (!time) return true;
  return Date.now() - time <= 24 * 60 * 60 * 1000;
}

export function summarizeRiskGuardResults(results: RiskGuardResult[]) {
  const blocked = results.filter((result) => result.blocked).length;
  const warned = results.filter((result) => !result.blocked && result.warnings.length).length;
  const passed = results.length - blocked - warned;
  if (!results.length) return "无风控检查";
  if (blocked) return `${blocked} 条阻断，${warned} 条降级/提示，${passed} 条通过`;
  if (warned) return `${warned} 条降级/提示，${passed} 条通过`;
  return `${passed} 条通过`;
}

function addLossBrakeCheck({
  addCheck,
  instrumentKind,
  policy,
  side,
  technical,
}: {
  addCheck: (key: string, label: string, severity: RiskGuardSeverity, detail: string, overridable?: boolean) => void;
  instrumentKind: RiskInstrumentKind;
  policy: RiskGuardPolicy;
  side: string;
  technical: TechnicalRow | undefined;
}) {
  const dayMove = technical?.change1d ?? null;
  if (!isBuy(side) || typeof dayMove !== "number") return;
  if (instrumentKind === "leveraged-etf" && dayMove <= -Math.abs(policy.lossBrake.leveragedEtfDailyDropBlockPct)) {
    addCheck("loss.day-move.leveraged", "日内刹车", "block", `杠杆/反向 ETF 当日跌幅 ${formatPercent(dayMove)}，暂停新增。`);
    return;
  }
  if ((instrumentKind === "etf" || instrumentKind === "leveraged-etf") && dayMove <= -Math.abs(policy.lossBrake.etfDailyDropBlockPct)) {
    addCheck("loss.day-move.block", "日内刹车", "block", `ETF 当日跌幅 ${formatPercent(dayMove)}，暂停新增。`);
    return;
  }
  if ((instrumentKind === "etf" || instrumentKind === "leveraged-etf") && dayMove <= -Math.abs(policy.lossBrake.etfDailyDropWarnPct)) {
    addCheck("loss.day-move.warn", "日内刹车", "warn", `ETF 当日跌幅 ${formatPercent(dayMove)}，不追连续下跌。`);
  }
}

function dailyOrderLimitCheck({
  orderIntent,
  policy,
  queuedOrders,
}: {
  orderIntent: OrderIntent;
  policy: RiskGuardPolicy;
  queuedOrders: OrderRecord[];
}) {
  if (policy.maxDailyOrders <= 0) {
    return { key: "daily.disabled", severity: "pass" as const, detail: "单日委托上限未启用。", overridable: true };
  }
  const todayOrders = queuedOrders.filter((order) => isSameLocalDay(order.createdIso || order.createdAt, new Date())).length;
  if (todayOrders >= policy.maxDailyOrders) {
    return {
      key: "daily.max-orders",
      severity: "block" as const,
      detail: `今日已记录 ${todayOrders} 条委托，达到上限 ${policy.maxDailyOrders} 条。`,
      overridable: true,
    };
  }
  return {
    key: "daily.ok",
    severity: "pass" as const,
    detail: `${orderIntent.symbol} 下单后今日 ${todayOrders + 1}/${policy.maxDailyOrders} 条。`,
    overridable: true,
  };
}

function cooldownOrderCheck({
  orderIntent,
  policy,
  queuedOrders,
  side,
}: {
  orderIntent: OrderIntent;
  policy: RiskGuardPolicy;
  queuedOrders: OrderRecord[];
  side: string;
}) {
  if (policy.cooldownMinutes <= 0) return null;
  const now = Date.now();
  const latest = queuedOrders
    .filter((order) => sameSymbol(order.symbol, orderIntent.symbol) && normalizeSide(order.side) === side)
    .map((order) => ({ order, time: timeFromOrder(order) }))
    .filter((item) => item.time > 0)
    .sort((left, right) => right.time - left.time)[0];
  if (!latest) return null;
  const minutes = (now - latest.time) / 60_000;
  if (minutes >= 0 && minutes < policy.cooldownMinutes) {
    return {
      key: "cooldown.symbol-side",
      severity: "block" as const,
      detail: `${orderIntent.symbol} 同方向委托距离上次 ${Math.max(1, Math.round(minutes))} 分钟，未满 ${policy.cooldownMinutes} 分钟。`,
      overridable: true,
    };
  }
  return null;
}

function cashCapacityCheck({
  notional,
  positionPlan,
  totalValue,
}: {
  notional: number;
  positionPlan: PositionPlan;
  totalValue: number;
}) {
  if (notional <= 0) {
    return { key: "cash.unknown", severity: "warn" as const, detail: "委托金额无法解析，真实提交前需要 broker 回填。", overridable: true };
  }
  if (positionPlan.cashValue > 0 && notional > positionPlan.cashValue * 1.005) {
    return { key: "cash.insufficient", severity: "block" as const, detail: "买入金额超过当前现金。", overridable: false };
  }
  const cashFloorValue = totalValue > 0 ? (totalValue * positionPlan.policy.minCashWeight) / 100 : 0;
  const spendable = Math.max(0, positionPlan.cashValue - cashFloorValue);
  if (spendable > 0 && notional > spendable * 1.02) {
    return { key: "cash.floor", severity: "block" as const, detail: `会跌破 ${formatPercent(positionPlan.policy.minCashWeight)} 现金底线。`, overridable: true };
  }
  return { key: "cash.ok", severity: "pass" as const, detail: "现金覆盖委托金额。", overridable: true };
}

function sellCapacityCheck({
  holding,
  notional,
}: {
  holding: HoldingRecord | undefined;
  notional: number;
}) {
  if (!holding || holding.quantity <= 0) {
    return { key: "sell.no-position", severity: "block" as const, detail: "没有可卖持仓。", overridable: false };
  }
  const holdingValue = marketValueOf(holding);
  if (notional > 0 && holdingValue > 0 && notional > holdingValue * 1.05) {
    return { key: "sell.oversize", severity: "block" as const, detail: "卖出金额超过当前持仓市值。", overridable: false };
  }
  return { key: "sell.ok", severity: "pass" as const, detail: "持仓覆盖卖出委托。", overridable: true };
}

function targetBandCheck({
  effectiveNotional,
  holding,
  positionPlan,
  totalValue,
}: {
  effectiveNotional: number;
  holding: HoldingRecord | undefined;
  positionPlan: PositionPlan;
  totalValue: number;
}) {
  if (!holding) {
    return { key: "target.not-held", severity: "block" as const, detail: "非持仓代理标的不能直接下单，先加入持仓并配置目标带。", overridable: false };
  }
  if (totalValue <= 0 || holding.targetWeight <= 0) {
    return { key: "target.missing", severity: "block" as const, detail: "该持仓缺少目标带，先在持仓管理里补齐。", overridable: false };
  }
  const band = targetBandForHolding(holding, positionPlan.policy);
  const currentValue = holdingMarketValueInBase(holding, positionPlan.valuation.settings) ?? 0;
  const currentWeight = (currentValue / totalValue) * 100;
  if (band.max <= 0) {
    return { key: "target.disabled", severity: "block" as const, detail: "该标的没有可买目标上限。", overridable: true };
  }
  if (currentWeight >= band.max - 0.05) {
    return { key: "target.full", severity: "block" as const, detail: `当前已到目标上限 ${band.label}。`, overridable: true };
  }
  const headroomValue = Math.max(0, (totalValue * band.max) / 100 - currentValue);
  if (effectiveNotional > 0 && headroomValue > 0 && effectiveNotional > headroomValue) {
    return {
      cappedNotional: headroomValue,
      key: "target.cap",
      severity: "warn" as const,
      detail: `委托已降到目标带剩余额度 ${formatMoney(headroomValue, positionPlan.currency)}。`,
      overridable: true,
    };
  }
  return { key: "target.ok", severity: "pass" as const, detail: `目标带 ${band.label} 仍有空间。`, overridable: true };
}

function classifyInstrument(intent: OrderIntent, holding: HoldingRecord | undefined, preset: QbotPreset): RiskInstrumentKind {
  if (holding && isCashHolding(holding)) return "cash";
  const assetType = holding?.assetType;
  const text = `${intent.symbol} ${intent.name} ${preset.tradeType} ${preset.strategy}`.toUpperCase();
  if (assetType === "cash") return "cash";
  if (isLeveragedEtfText(text)) return "leveraged-etf";
  if (assetType === "etf" || /\bETF\b/u.test(text)) return "etf";
  if (assetType === "fund" || /基金|QDII|联接|混合|债券|股票型|指数型/u.test(text) || preset.tradeType === "基金") return "fund";
  if (assetType === "stock" || preset.tradeType === "股票") return "stock";
  return assetType === "other" ? "other" : "stock";
}

function instrumentKindLabel(kind: RiskInstrumentKind, assetType: HoldingAssetType | undefined) {
  if (kind === "leveraged-etf") return "杠杆/反向 ETF";
  if (kind === "etf") return "ETF";
  if (kind === "fund") return "基金";
  if (kind === "cash") return "现金";
  if (kind === "other") return holdingAssetTypeLabel(assetType);
  return "股票";
}

function maxSingleBuyWeight(kind: RiskInstrumentKind, positionPlan: PositionPlan, policy: RiskGuardPolicy) {
  const policyCap = positionPlan.policy.maxSingleAddWeight;
  return Math.min(policyCap, riskPolicyInstrumentCap(policy, kind));
}

function findHolding(holdings: HoldingRecord[], symbol: string) {
  return holdings.find((holding) => sameSymbol(holding.symbol, symbol));
}

function sameSymbol(left: string, right: string) {
  return normalizeToken(left) === normalizeToken(right);
}

function normalizeToken(value: string) {
  return value.trim().toUpperCase();
}

function normalizeSide(side: string) {
  return side.trim().toUpperCase() === "SELL" ? "SELL" : "BUY";
}

function isBuy(side: string) {
  return side === "BUY";
}

function sideLabel(side: string) {
  return isBuy(side) ? "买入" : "卖出";
}

function marketValueOf(holding: HoldingRecord) {
  return Math.max(0, holding.quantity * holding.currentPrice);
}

function settlementNotionalForBase(baseNotional: number, intent: OrderIntent) {
  if (baseNotional <= 0) return 0;
  if (intent.baseNotional && intent.baseNotional > 0 && intent.notional != null) {
    return baseNotional * (intent.notional / intent.baseNotional);
  }
  return baseNotional;
}

function parseMoney(value: string) {
  const match = value.replace(/[,，]/g, "").match(/-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

function parsePercent(value: string) {
  const match = value.replace(/[,，]/g, "").match(/-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

function isSameLocalDay(value: string, date: Date) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed.getFullYear() === date.getFullYear()
    && parsed.getMonth() === date.getMonth()
    && parsed.getDate() === date.getDate();
}

function timeFromOrder(order: OrderRecord) {
  const parsed = new Date(order.createdIso || order.updatedIso || order.createdAt || order.updatedAt || "");
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function businessDayAge(fromValue: string | undefined, toValue: string) {
  if (!fromValue) return null;
  const from = parseDateOnly(fromValue);
  const to = parseDateOnly(toValue);
  if (!from || !to || from.getTime() > to.getTime()) return null;
  let age = 0;
  const cursor = new Date(from);
  for (let index = 0; cursor.getTime() < to.getTime() && index < 370; index += 1) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) age += 1;
  }
  return age;
}

function parseDateOnly(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isNaN(date.getTime()) ? null : date;
}

function isLeveragedEtfText(text: string) {
  return /杠杆|反向|做空|2X|3X|ULTRA|INVERSE|BEAR|BULL|LEVERAGED/u.test(text);
}
