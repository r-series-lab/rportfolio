import type { HoldingRecord } from "./holdings";
import { isHoldingRecord } from "./holdings";

export type TradeSide = "buy" | "sell";

export type TradeRecord = {
  id: string;
  symbol: string;
  name: string;
  side: TradeSide;
  tradeDate: string;
  quantity: number;
  price: number;
  fee: number;
  currency: string;
  notes: string;
};

export type TradeHabit = {
  title: string;
  tone: "positive" | "neutral" | "caution" | "negative";
  summary: string;
  trades30d: number;
  averageAmount: number;
  averageAmountLabel: string;
  largestTradeWeight: number | null;
  largestTradeWeightLabel: string;
  repeatBuySymbol: string | null;
  lossAverageCount: number;
  actions: Array<{
    key: string;
    label: string;
    tone: "positive" | "neutral" | "caution" | "negative";
    detail: string;
  }>;
};

export type TradePosition = {
  symbol: string;
  name: string;
  currency: string;
  quantity: number;
  averageCost: number;
  costValue: number;
  buyCount: number;
  sellCount: number;
  realizedPnl: number;
  latestTradeDate: string;
};

export type TradeReconcileItem = {
  key: string;
  symbol: string;
  name: string;
  currency: string;
  quantity: number;
  averageCost: number;
  holdingQuantity: number | null;
  holdingCostPrice: number | null;
  quantityDiff: number | null;
  costDiff: number | null;
  status: "matched" | "different" | "missing-holding" | "closed";
  tone: "positive" | "neutral" | "caution" | "negative";
  summary: string;
  syncable: boolean;
};

export type TradeReconcileReport = {
  total: number;
  matched: number;
  different: number;
  missing: number;
  closed: number;
  summary: string;
  tone: "positive" | "neutral" | "caution" | "negative";
  items: TradeReconcileItem[];
};

export function isTradeRecord(value: unknown): value is TradeRecord {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<TradeRecord>;
  return (
    typeof item.id === "string" &&
    typeof item.symbol === "string" &&
    typeof item.name === "string" &&
    (item.side === "buy" || item.side === "sell") &&
    typeof item.tradeDate === "string" &&
    typeof item.quantity === "number" &&
    typeof item.price === "number" &&
    typeof item.fee === "number" &&
    typeof item.currency === "string" &&
    typeof item.notes === "string"
  );
}

export function tradeAmount(trade: TradeRecord) {
  return trade.quantity * trade.price + trade.fee;
}

export function reconcileTradesWithHoldings(trades: TradeRecord[], holdings: HoldingRecord[]): TradeReconcileReport {
  const positions = tradePositionsFromTrades(trades);
  const validHoldings = holdings.filter(isHoldingRecord);
  const items = positions.map((position) => reconcilePosition(position, validHoldings));
  const matched = items.filter((item) => item.status === "matched").length;
  const different = items.filter((item) => item.status === "different").length;
  const missing = items.filter((item) => item.status === "missing-holding").length;
  const closed = items.filter((item) => item.status === "closed").length;
  const tone = different || missing ? "caution" : items.length ? "positive" : "neutral";

  return {
    total: items.length,
    matched,
    different,
    missing,
    closed,
    summary: items.length
      ? different || missing
        ? `${different + missing} 个标的需要核对`
        : "流水与持仓一致"
      : "暂无可核对流水",
    tone,
    items: items.sort(compareReconcileItems).slice(0, 5),
  };
}

export function tradePositionsFromTrades(trades: TradeRecord[]): TradePosition[] {
  const states = new Map<string, TradePosition>();
  const sorted = trades.filter(isTradeRecord).sort((left, right) => {
    const dateOrder = left.tradeDate.localeCompare(right.tradeDate);
    if (dateOrder !== 0) return dateOrder;
    return left.id.localeCompare(right.id);
  });

  for (const trade of sorted) {
    const existing = states.get(trade.symbol) ?? {
      symbol: trade.symbol,
      name: trade.name,
      currency: trade.currency,
      quantity: 0,
      averageCost: 0,
      costValue: 0,
      buyCount: 0,
      sellCount: 0,
      realizedPnl: 0,
      latestTradeDate: trade.tradeDate,
    };
    existing.name = trade.name || existing.name;
    existing.currency = trade.currency || existing.currency;
    existing.latestTradeDate = trade.tradeDate >= existing.latestTradeDate ? trade.tradeDate : existing.latestTradeDate;

    if (trade.side === "buy") {
      existing.buyCount += 1;
      existing.costValue += trade.quantity * trade.price + trade.fee;
      existing.quantity += trade.quantity;
    } else {
      existing.sellCount += 1;
      const averageCost = existing.quantity > 0 ? existing.costValue / existing.quantity : 0;
      const sellQuantity = Math.min(trade.quantity, existing.quantity);
      existing.realizedPnl += sellQuantity * (trade.price - averageCost) - trade.fee;
      existing.quantity -= sellQuantity;
      existing.costValue -= averageCost * sellQuantity;
      if (existing.quantity <= 0.000001) {
        existing.quantity = 0;
        existing.costValue = 0;
      }
    }

    existing.averageCost = existing.quantity > 0 ? existing.costValue / existing.quantity : 0;
    states.set(trade.symbol, existing);
  }

  return [...states.values()].map((position) => ({
    ...position,
    averageCost: round4(position.averageCost),
    costValue: round4(position.costValue),
    quantity: round4(position.quantity),
    realizedPnl: round4(position.realizedPnl),
  }));
}

export function analyzeTradeHabit(trades: TradeRecord[], holdings: HoldingRecord[], totalValue: number, now = new Date()): TradeHabit {
  const validTrades = trades.filter(isTradeRecord);
  const validHoldings = holdings.filter(isHoldingRecord);
  const cutoff30 = daysBefore(now, 30);
  const cutoff90 = daysBefore(now, 90);
  const recent30 = validTrades.filter((trade) => tradeDateOf(trade) >= cutoff30);
  const recent90 = validTrades.filter((trade) => tradeDateOf(trade) >= cutoff90);
  const recentBuyTrades = recent90.filter((trade) => trade.side === "buy");
  const totalRecentAmount = recent30.reduce((sum, trade) => sum + tradeAmount(trade), 0);
  const averageAmount = recent30.length ? totalRecentAmount / recent30.length : 0;
  const largestTrade = [...recent30].sort((left, right) => tradeAmount(right) - tradeAmount(left))[0] ?? null;
  const largestTradeWeight = largestTrade && totalValue > 0 ? (tradeAmount(largestTrade) / totalValue) * 100 : null;
  const repeatBuySymbol = mostRepeatedBuySymbol(recentBuyTrades);
  const lossAverageCount = recentBuyTrades.filter((trade) => {
    const holding = validHoldings.find((item) => item.symbol === trade.symbol);
    if (!holding) return false;
    const costValue = holding.quantity * holding.costPrice;
    const marketValue = holding.quantity * holding.currentPrice;
    return costValue > 0 && marketValue < costValue;
  }).length;
  const tone = habitTone({
    largestTradeWeight,
    lossAverageCount,
    repeatBuySymbol,
    trades30d: recent30.length,
  });
  const title = habitTitle(tone);
  const actions = habitActions({
    averageAmount,
    largestTradeWeight,
    lossAverageCount,
    repeatBuySymbol,
    trades30d: recent30.length,
  });

  return {
    title,
    tone,
    summary: habitSummary({ lossAverageCount, repeatBuySymbol, trades30d: recent30.length }),
    trades30d: recent30.length,
    averageAmount,
    averageAmountLabel: formatAmount(averageAmount, dominantCurrency(validTrades, validHoldings)),
    largestTradeWeight,
    largestTradeWeightLabel: largestTradeWeight === null ? "—" : `${round1(largestTradeWeight)}%`,
    repeatBuySymbol,
    lossAverageCount,
    actions,
  };
}

function habitTone({
  largestTradeWeight,
  lossAverageCount,
  repeatBuySymbol,
  trades30d,
}: {
  largestTradeWeight: number | null;
  lossAverageCount: number;
  repeatBuySymbol: string | null;
  trades30d: number;
}): TradeHabit["tone"] {
  if (trades30d >= 10 || (largestTradeWeight ?? 0) >= 8 || lossAverageCount >= 4) return "negative";
  if (trades30d >= 6 || (largestTradeWeight ?? 0) >= 5 || lossAverageCount >= 2 || repeatBuySymbol) return "caution";
  if (trades30d === 0) return "neutral";
  return "positive";
}

function habitTitle(tone: TradeHabit["tone"]) {
  if (tone === "negative") return "交易偏激进";
  if (tone === "caution") return "交易需收敛";
  if (tone === "positive") return "节奏平稳";
  return "等待流水";
}

function habitSummary({
  lossAverageCount,
  repeatBuySymbol,
  trades30d,
}: {
  lossAverageCount: number;
  repeatBuySymbol: string | null;
  trades30d: number;
}) {
  if (!trades30d) return "录入交易后可识别频率、单笔大小和补仓倾向。";
  if (lossAverageCount >= 2) return `近 90 天有 ${lossAverageCount} 次亏损补仓，建议降低单次额度。`;
  if (repeatBuySymbol) return `${repeatBuySymbol} 连续加仓较多，先检查目标区间。`;
  return `近 30 天 ${trades30d} 笔交易，节奏仍可控。`;
}

function habitActions({
  averageAmount,
  largestTradeWeight,
  lossAverageCount,
  repeatBuySymbol,
  trades30d,
}: {
  averageAmount: number;
  largestTradeWeight: number | null;
  lossAverageCount: number;
  repeatBuySymbol: string | null;
  trades30d: number;
}) {
  const emptyActions: TradeHabit["actions"] = [
    {
      key: "journal",
      label: "开始记录",
      tone: "neutral",
      detail: "先录入最近几笔买卖，系统会自动形成交易节奏画像。",
    },
  ];
  const actions: TradeHabit["actions"] = [];
  if (!trades30d) {
    return emptyActions;
  }
  if (trades30d >= 6) {
    actions.push({
      key: "frequency",
      label: "频率偏高",
      tone: trades30d >= 10 ? "negative" : "caution",
      detail: `近 30 天 ${trades30d} 笔交易，建议合并动作，减少噪音交易。`,
    });
  }
  if ((largestTradeWeight ?? 0) >= 5) {
    actions.push({
      key: "single-size",
      label: "单笔偏大",
      tone: (largestTradeWeight ?? 0) >= 8 ? "negative" : "caution",
      detail: `最大单笔约 ${round1(largestTradeWeight ?? 0)}%，建议拆成 2-3 次执行。`,
    });
  }
  if (lossAverageCount >= 2) {
    actions.push({
      key: "loss-average",
      label: "补跌偏多",
      tone: lossAverageCount >= 4 ? "negative" : "caution",
      detail: `近 90 天 ${lossAverageCount} 次在浮亏标的上买入，先确认失效条件。`,
    });
  }
  if (repeatBuySymbol) {
    actions.push({
      key: "repeat-buy",
      label: "集中加仓",
      tone: "caution",
      detail: `${repeatBuySymbol} 近期买入较密集，下一笔先检查目标上限。`,
    });
  }
  if (!actions.length) {
    actions.push({
      key: "steady",
      label: "纪律良好",
      tone: "positive",
      detail: `平均单笔 ${formatPlainAmount(averageAmount)}，暂未发现明显过度交易。`,
    });
  }
  return actions.slice(0, 3);
}

function mostRepeatedBuySymbol(trades: TradeRecord[]) {
  const counts = trades.reduce<Record<string, number>>((acc, trade) => {
    acc[trade.symbol] = (acc[trade.symbol] ?? 0) + 1;
    return acc;
  }, {});
  const [symbol, count] = Object.entries(counts).sort((left, right) => right[1] - left[1])[0] ?? [];
  return count >= 3 ? symbol : null;
}

function reconcilePosition(position: TradePosition, holdings: HoldingRecord[]): TradeReconcileItem {
  const holding = holdings.find((item) => item.symbol === position.symbol && item.role === "real") ?? null;
  if (!holding) {
    return {
      key: `missing-${position.symbol}`,
      symbol: position.symbol,
      name: position.name,
      currency: position.currency,
      quantity: position.quantity,
      averageCost: position.averageCost,
      holdingQuantity: null,
      holdingCostPrice: null,
      quantityDiff: null,
      costDiff: null,
      status: position.quantity > 0 ? "missing-holding" : "closed",
      tone: position.quantity > 0 ? "caution" : "neutral",
      summary: position.quantity > 0 ? "流水有余额，持仓列表未记录" : "流水已清仓",
      syncable: false,
    };
  }

  const quantityDiff = round4(position.quantity - holding.quantity);
  const costDiff = round4(position.averageCost - holding.costPrice);
  const quantityMatched = Math.abs(quantityDiff) <= Math.max(0.0001, Math.abs(position.quantity) * 0.0001);
  const costMatched = position.quantity <= 0 || Math.abs(costDiff) <= Math.max(0.0001, Math.abs(position.averageCost) * 0.001);
  const closed = position.quantity <= 0;
  const matched = quantityMatched && costMatched;

  return {
    key: `reconcile-${position.symbol}`,
    symbol: position.symbol,
    name: position.name || holding.name,
    currency: position.currency || holding.currency,
    quantity: position.quantity,
    averageCost: position.averageCost,
    holdingQuantity: holding.quantity,
    holdingCostPrice: holding.costPrice,
    quantityDiff,
    costDiff,
    status: closed ? "closed" : matched ? "matched" : "different",
    tone: closed ? "neutral" : matched ? "positive" : "caution",
    summary: closed ? "流水显示已清仓" : matched ? "数量和成本一致" : "数量或成本存在差异",
    syncable: !closed && !matched,
  };
}

function compareReconcileItems(left: TradeReconcileItem, right: TradeReconcileItem) {
  const priority = (item: TradeReconcileItem) => {
    if (item.status === "different") return 0;
    if (item.status === "missing-holding") return 1;
    if (item.status === "matched") return 2;
    return 3;
  };
  const priorityDiff = priority(left) - priority(right);
  if (priorityDiff !== 0) return priorityDiff;
  return left.symbol.localeCompare(right.symbol);
}

function tradeDateOf(trade: TradeRecord) {
  const date = new Date(`${trade.tradeDate}T00:00:00`);
  return Number.isNaN(date.getTime()) ? new Date(0) : date;
}

function daysBefore(now: Date, days: number) {
  const date = new Date(now);
  date.setDate(date.getDate() - days);
  date.setHours(0, 0, 0, 0);
  return date;
}

function dominantCurrency(trades: TradeRecord[], holdings: HoldingRecord[]) {
  return trades[0]?.currency || holdings[0]?.currency || "CNY";
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
    return formatPlainAmount(value);
  }
}

function formatPlainAmount(value: number) {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(value);
}

function round1(value: number) {
  return Math.round(value * 10) / 10;
}

function round4(value: number) {
  return Math.round(value * 10000) / 10000;
}
