import type { HoldingRecord } from "./holdings";

export type ChinaInstrumentKind = "stock" | "etf" | "fund" | "other";

export type AShareFeeBreakdown = {
  commission: number;
  stampDuty: number;
  transferFee: number;
  total: number;
};

export type AShareFillResult = {
  availableQuantity: number;
  executed: boolean;
  executionPrice: number;
  fees: AShareFeeBreakdown;
  kind: ChinaInstrumentKind;
  notional: number;
  quantity: number;
  reason: string;
  ruleLabel: string;
  slippage: number;
};

export type AShareSimulationPolicy = {
  commissionRate: number;
  minimumCommission: number;
  slippageRate: number;
  stampDutySellRate: number;
  transferFeeRate: number;
};

export const DEFAULT_A_SHARE_SIM_POLICY: AShareSimulationPolicy = {
  commissionRate: 0.00025,
  minimumCommission: 5,
  slippageRate: 0.0015,
  stampDutySellRate: 0.0005,
  transferFeeRate: 0.00001,
};

export function simulateAShareFill({
  availableQuantity,
  cash,
  change1d,
  currentQuantity,
  holding,
  name,
  policy = DEFAULT_A_SHARE_SIM_POLICY,
  referencePrice,
  requestedNotional,
  side,
  symbol,
}: {
  availableQuantity: number;
  cash: number;
  change1d: number | null;
  currentQuantity: number;
  holding?: HoldingRecord;
  name: string;
  policy?: AShareSimulationPolicy;
  referencePrice: number;
  requestedNotional: number;
  side: "BUY" | "SELL";
  symbol: string;
}): AShareFillResult {
  const kind = chinaInstrumentKind(holding, symbol);
  const ruleLabel = executionRuleLabel(kind, symbol, name);
  if (kind === "fund") {
    return skipped(kind, ruleLabel, "场外基金按下一确认净值成交，不使用盘中价格模拟。", availableQuantity);
  }
  if (kind === "other") {
    return skipped(kind, ruleLabel, "标的不是可识别的 A 股、ETF 或场外基金。", availableQuantity);
  }
  const priceLimit = priceLimitPct(kind, symbol);
  if (side === "BUY" && typeof change1d === "number" && change1d >= priceLimit - 0.1) {
    return skipped(kind, ruleLabel, `接近 ${priceLimit}% 涨停，默认不假设买单能够成交。`, availableQuantity);
  }
  if (side === "SELL" && typeof change1d === "number" && change1d <= -priceLimit + 0.1) {
    return skipped(kind, ruleLabel, `接近 ${priceLimit}% 跌停，默认不假设卖单能够成交。`, availableQuantity);
  }

  const executionPrice = roundPrice(referencePrice * (side === "BUY" ? 1 + policy.slippageRate : 1 - policy.slippageRate));
  if (!(executionPrice > 0) || requestedNotional <= 0) {
    return skipped(kind, ruleLabel, "缺少有效价格或委托金额。", availableQuantity);
  }

  if (side === "BUY") {
    const maxCashNotional = Math.max(0, cash - policy.minimumCommission);
    const budget = Math.min(requestedNotional, maxCashNotional);
    const quantity = buyQuantityFor(kind, symbol, budget / executionPrice);
    if (quantity <= 0) {
      return skipped(kind, ruleLabel, `预算不足一个申报单位（${minimumBuyLabel(kind, symbol)}）。`, availableQuantity);
    }
    const notional = quantity * executionPrice;
    const fees = feesFor(kind, "BUY", notional, policy);
    if (notional + fees.total > cash) {
      return skipped(kind, ruleLabel, "现金不足以覆盖成交金额和费用。", availableQuantity);
    }
    return {
      availableQuantity,
      executed: true,
      executionPrice,
      fees,
      kind,
      notional,
      quantity,
      reason: "按 A 股申报单位、滑点和费用成交；普通股票买入份额次日可卖。",
      ruleLabel,
      slippage: quantity * Math.abs(executionPrice - referencePrice),
    };
  }

  const quantity = sellQuantityFor(kind, symbol, currentQuantity, availableQuantity, requestedNotional / executionPrice);
  if (quantity <= 0) {
    return skipped(kind, ruleLabel, availableQuantity <= 0 ? "T+1 可卖数量为 0。" : "可卖数量不足一个申报单位。", availableQuantity);
  }
  const notional = quantity * executionPrice;
  const fees = feesFor(kind, "SELL", notional, policy);
  return {
    availableQuantity: Math.max(0, availableQuantity - quantity),
    executed: true,
    executionPrice,
    fees,
    kind,
    notional,
    quantity,
    reason: "卖出数量受可用持仓和申报单位约束，股票卖出计入印花税。",
    ruleLabel,
    slippage: quantity * Math.abs(executionPrice - referencePrice),
  };
}

export function chinaInstrumentKind(holding: HoldingRecord | undefined, symbol: string): ChinaInstrumentKind {
  if (holding?.assetType === "fund") return "fund";
  if (holding?.assetType === "etf") return "etf";
  if (holding?.assetType === "stock") return "stock";
  return /^\d{6}$/.test(symbol.trim()) ? "stock" : "other";
}

export function isT0ChinaInstrument(kind: ChinaInstrumentKind, name: string) {
  if (kind !== "etf") return false;
  return /跨境|海外|黄金|商品|债券|货币|纳指|标普|日经|德国|法国|恒生|港股/.test(name);
}

function buyQuantityFor(kind: ChinaInstrumentKind, symbol: string, rawQuantity: number) {
  if (kind === "stock" && isStarSymbol(symbol)) {
    return rawQuantity >= 200 ? Math.floor(rawQuantity) : 0;
  }
  return Math.floor(rawQuantity / 100) * 100;
}

function sellQuantityFor(
  kind: ChinaInstrumentKind,
  symbol: string,
  currentQuantity: number,
  availableQuantity: number,
  requestedQuantity: number,
) {
  const available = Math.min(currentQuantity, availableQuantity);
  if (available <= 0) return 0;
  const desired = Math.min(available, Math.max(0, requestedQuantity));
  if (desired >= available - 0.000001) return available;
  if (kind === "stock" && isStarSymbol(symbol)) {
    return desired >= 200 ? Math.floor(desired) : 0;
  }
  return Math.floor(desired / 100) * 100;
}

function feesFor(
  kind: ChinaInstrumentKind,
  side: "BUY" | "SELL",
  notional: number,
  policy: AShareSimulationPolicy,
): AShareFeeBreakdown {
  const commission = Math.max(policy.minimumCommission, notional * policy.commissionRate);
  const stampDuty = kind === "stock" && side === "SELL" ? notional * policy.stampDutySellRate : 0;
  const transferFee = kind === "stock" ? notional * policy.transferFeeRate : 0;
  return {
    commission,
    stampDuty,
    transferFee,
    total: commission + stampDuty + transferFee,
  };
}

function priceLimitPct(kind: ChinaInstrumentKind, symbol: string) {
  if (kind === "etf") return 10;
  if (isStarSymbol(symbol) || /^(300|301)/.test(symbol)) return 20;
  if (/^[48]/.test(symbol)) return 30;
  return 10;
}

function minimumBuyLabel(kind: ChinaInstrumentKind, symbol: string) {
  return kind === "stock" && isStarSymbol(symbol) ? "科创板至少 200 股" : "100 股整数手";
}

function executionRuleLabel(kind: ChinaInstrumentKind, symbol: string, name: string) {
  if (kind === "fund") return "场外基金 · 下一净值";
  if (kind === "etf") return isT0ChinaInstrument(kind, name) ? "A 股 ETF · T+0" : "A 股 ETF · T+1";
  if (isStarSymbol(symbol)) return "科创板 · 200 股起 · T+1";
  if (/^(300|301)/.test(symbol)) return "创业板 · 100 股 · T+1";
  if (/^[48]/.test(symbol)) return "北交所 · 100 股 · T+1";
  return "A 股主板 · 100 股 · T+1";
}

function skipped(kind: ChinaInstrumentKind, ruleLabel: string, reason: string, availableQuantity: number): AShareFillResult {
  return {
    availableQuantity,
    executed: false,
    executionPrice: 0,
    fees: { commission: 0, stampDuty: 0, transferFee: 0, total: 0 },
    kind,
    notional: 0,
    quantity: 0,
    reason,
    ruleLabel,
    slippage: 0,
  };
}

function isStarSymbol(symbol: string) {
  return /^(688|689)/.test(symbol.trim());
}

function roundPrice(value: number) {
  return Math.round(value * 100) / 100;
}
