import type { FundSubstitutionDecision } from "./fund-substitution";
import type { HoldingRecord, FundRedemptionFeeTier } from "./holdings";
import type { TradeRecord } from "./trades";
import { formatMoney } from "./utils";

export type FundReplacementPlan = {
  key: string;
  action: "redirect" | "replace" | "draft" | "blocked";
  label: string;
  summary: string;
  sourceSymbol: string;
  targetSymbol: string;
  sellAmount: number;
  buyAmount: number;
  estimatedRedemptionFee: number | null;
  batches: number;
  executable: boolean;
  warnings: string[];
};

export function buildFundReplacementPlans({
  asOf,
  decisions,
  holdings,
  totalValue,
  trades,
}: {
  asOf: string;
  decisions: FundSubstitutionDecision[];
  holdings: HoldingRecord[];
  totalValue: number;
  trades: TradeRecord[];
}) {
  const bySymbol = new Map(holdings.map((holding) => [normalizeSymbol(holding.symbol), holding]));
  return decisions
    .filter((decision) => decision.preferredSymbol && decision.secondarySymbol)
    .map((decision) => replacementPlan({
      asOf,
      decision,
      source: bySymbol.get(normalizeSymbol(decision.secondarySymbol!)),
      target: bySymbol.get(normalizeSymbol(decision.preferredSymbol!)),
      totalValue,
      trades,
    }));
}

function replacementPlan({
  asOf,
  decision,
  source,
  target,
  totalValue,
  trades,
}: {
  asOf: string;
  decision: FundSubstitutionDecision;
  source: HoldingRecord | undefined;
  target: HoldingRecord | undefined;
  totalValue: number;
  trades: TradeRecord[];
}): FundReplacementPlan {
  const sourceSymbol = decision.secondarySymbol!;
  const targetSymbol = decision.preferredSymbol!;
  const base = { key: `${sourceSymbol}:${targetSymbol}`, sourceSymbol, targetSymbol };
  if (!source || !target || totalValue <= 0) {
    return blockedPlan(base, "持仓或组合市值不完整，不能计算替换金额。");
  }
  if (source.fundRedemptionOpen === false) {
    return blockedPlan(base, `${sourceSymbol} 当前暂停赎回，不能执行替换。`);
  }
  if (target.fundPurchaseOpen === false) {
    return blockedPlan(base, `${targetSymbol} 当前暂停申购，不能执行替换。`);
  }

  const sourceValue = Math.max(0, source.quantity * source.currentPrice);
  const targetValue = Math.max(0, target.quantity * target.currentPrice);
  const sourceFloor = source.targetMinWeight != null ? totalValue * source.targetMinWeight / 100 : null;
  const targetCeiling = target.targetMaxWeight != null ? totalValue * target.targetMaxWeight / 100 : null;
  if (sourceFloor == null || targetCeiling == null) {
    return {
      ...base,
      action: "draft",
      label: "补目标带",
      summary: `${sourceSymbol} 或 ${targetSymbol} 缺少目标带上下限；先补配置，再计算替换金额。`,
      sellAmount: 0,
      buyAmount: 0,
      estimatedRedemptionFee: null,
      batches: 0,
      executable: false,
      warnings: ["缺少目标带边界"],
    };
  }

  const sourceExcess = Math.max(0, sourceValue - sourceFloor);
  const targetCapacity = Math.max(0, targetCeiling - targetValue);
  let amount = Math.min(sourceExcess, targetCapacity);
  if (decision.action !== "replace-candidate" || amount < 100) {
    return {
      ...base,
      action: "redirect",
      label: "新增转向",
      summary: `不卖 ${sourceSymbol}；后续同主题新增优先给 ${targetSymbol}，${sourceSymbol} 暂停新增。`,
      sellAmount: 0,
      buyAmount: 0,
      estimatedRedemptionFee: 0,
      batches: 0,
      executable: true,
      warnings: amount < 100 ? ["当前可替换空间不足 ¥100"] : [],
    };
  }

  const lots = fifoLotsFor(trades, sourceSymbol, asOf);
  const lotQuantity = lots.reduce((sum, lot) => sum + lot.quantity, 0);
  const holdingCovered = lotQuantity >= source.quantity * 0.95;
  const feesReady = (source.fundRedemptionFeeSchedule?.length ?? 0) > 0;
  const warnings: string[] = [];
  if (!holdingCovered) warnings.push("本地成交流水无法覆盖当前持仓份额");
  if (!feesReady) warnings.push("赎回费率表缺失");

  const purchaseLimit = target.fundPurchaseLimit && target.fundPurchaseLimit > 0
    ? target.fundPurchaseLimit
    : null;
  const batches = purchaseLimit ? Math.max(1, Math.ceil(amount / purchaseLimit)) : 1;
  if (purchaseLimit && batches > 20) {
    return blockedPlan(base, `${targetSymbol} 单日限购 ${formatMoney(purchaseLimit, target.currency)}，完成替换需要 ${batches} 日，性价比过低。`);
  }

  const saleQuantity = amount / Math.max(source.currentPrice, 0.0001);
  const estimatedRedemptionFee = feesReady && holdingCovered
    ? estimateRedemptionFee(lots, saleQuantity, source.currentPrice, source.fundRedemptionFeeSchedule ?? [], asOf)
    : null;
  if (estimatedRedemptionFee != null) {
    amount = Math.max(0, amount - estimatedRedemptionFee);
  }
  const executable = holdingCovered
    && feesReady
    && estimatedRedemptionFee != null
    && source.fundRedemptionOpen === true
    && target.fundPurchaseOpen === true;
  return {
    ...base,
    action: executable ? "replace" : "draft",
    label: executable ? "分批替换" : "替换草案",
    summary: `${sourceSymbol} 卖出约 ${formatMoney(amount + (estimatedRedemptionFee ?? 0), source.currency)} → ${targetSymbol} 买入约 ${formatMoney(amount, target.currency)}，${batches} 批；${estimatedRedemptionFee == null ? "费用待核对" : `预计赎回费 ${formatMoney(estimatedRedemptionFee, source.currency)}`}。`,
    sellAmount: amount + (estimatedRedemptionFee ?? 0),
    buyAmount: amount,
    estimatedRedemptionFee,
    batches,
    executable,
    warnings,
  };
}

type TradeLot = { date: string; quantity: number };

function fifoLotsFor(trades: TradeRecord[], symbol: string, asOf: string) {
  const lots: TradeLot[] = [];
  trades
    .filter((trade) => normalizeSymbol(trade.symbol) === normalizeSymbol(symbol) && trade.tradeDate <= asOf)
    .sort((left, right) => left.tradeDate.localeCompare(right.tradeDate) || left.id.localeCompare(right.id))
    .forEach((trade) => {
      if (trade.side === "buy") {
        lots.push({ date: trade.tradeDate, quantity: trade.quantity });
        return;
      }
      let remaining = trade.quantity;
      while (remaining > 0 && lots.length) {
        const lot = lots[0];
        const consumed = Math.min(lot.quantity, remaining);
        lot.quantity -= consumed;
        remaining -= consumed;
        if (lot.quantity <= 0.000001) lots.shift();
      }
    });
  return lots;
}

function estimateRedemptionFee(
  lots: TradeLot[],
  sellQuantity: number,
  price: number,
  schedule: FundRedemptionFeeTier[],
  asOf: string,
) {
  let remaining = sellQuantity;
  let fee = 0;
  for (const lot of lots) {
    if (remaining <= 0) break;
    const quantity = Math.min(lot.quantity, remaining);
    const days = dayDistance(lot.date, asOf);
    const tier = schedule.find((item) =>
      (item.minDays == null || days >= item.minDays)
      && (item.maxDaysExclusive == null || days < item.maxDaysExclusive)
    );
    if (!tier) return null;
    fee += quantity * price * tier.rate / 100;
    remaining -= quantity;
  }
  return remaining <= 0.000001 ? fee : null;
}

function dayDistance(from: string, to: string) {
  const start = new Date(`${from}T00:00:00Z`).getTime();
  const end = new Date(`${to}T00:00:00Z`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, Math.floor((end - start) / 86_400_000));
}

function blockedPlan(
  base: { key: string; sourceSymbol: string; targetSymbol: string },
  summary: string,
): FundReplacementPlan {
  return {
    ...base,
    action: "blocked",
    label: "替换阻断",
    summary,
    sellAmount: 0,
    buyAmount: 0,
    estimatedRedemptionFee: null,
    batches: 0,
    executable: false,
    warnings: [summary],
  };
}

function normalizeSymbol(value: string) {
  return value.trim().toUpperCase();
}
