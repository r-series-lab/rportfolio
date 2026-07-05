import type { RecommendationOutcome, RecommendationRecord } from "./recommendation-log";
import type { TradeRecord } from "./trades";

export type ExecutionAttributionRow = {
  actualNetReturnPct: number | null;
  executionDragPct: number | null;
  feeBps: number;
  key: string;
  priority: string;
  recommendationReturnPct: number | null;
  side: string;
  slippageBps: number;
  symbol: string;
  tradeDate: string;
};

export type ExecutionAttributionSummary = {
  averageExecutionDragPct: number | null;
  averageFeeBps: number | null;
  averageSlippageBps: number | null;
  matched: number;
  missed: number;
  missedOpportunityPct: number | null;
  pending: number;
  rows: ExecutionAttributionRow[];
  total: number;
  verdict: string;
  verdictDetail: string;
  verdictTone: "positive" | "neutral" | "caution" | "negative";
};

export function buildExecutionAttribution(
  records: RecommendationRecord[],
  trades: TradeRecord[],
  profileKey: string | undefined,
): ExecutionAttributionSummary {
  const candidates = deduplicateActionableRecords(records, profileKey);
  const availableTrades = [...trades].sort((left, right) => left.tradeDate.localeCompare(right.tradeDate));
  const usedTradeIds = new Set<string>();
  const rows: ExecutionAttributionRow[] = [];
  const missedReturns: number[] = [];
  let pending = 0;
  let missed = 0;

  for (const record of candidates) {
    const outcome = reviewOutcome(record.outcomes);
    if (!outcome) {
      pending += 1;
      continue;
    }
    const trade = availableTrades.find((item) =>
      !usedTradeIds.has(item.id)
      && sameSymbol(item.symbol, record.symbol)
      && item.side === tradeSide(record.side)
      && dayDistance(record.asOf, item.tradeDate) >= 0
      && dayDistance(record.asOf, item.tradeDate) <= 5
    );
    if (!trade) {
      missed += 1;
      if (typeof outcome.signedReturnPct === "number" && outcome.signedReturnPct > 0) {
        missedReturns.push(outcome.signedReturnPct);
      }
      continue;
    }
    usedTradeIds.add(trade.id);
    rows.push(attributionRow(record, outcome, trade));
  }

  const averageSlippageBps = average(rows.map((row) => row.slippageBps));
  const averageFeeBps = average(rows.map((row) => row.feeBps));
  const averageExecutionDragPct = average(rows.flatMap((row) => row.executionDragPct == null ? [] : [row.executionDragPct]));
  const missedOpportunityPct = average(missedReturns);
  const verdict = executionVerdict({ averageExecutionDragPct, averageSlippageBps, matched: rows.length });

  return {
    averageExecutionDragPct,
    averageFeeBps,
    averageSlippageBps,
    matched: rows.length,
    missed,
    missedOpportunityPct,
    pending,
    rows: rows.sort((left, right) => right.tradeDate.localeCompare(left.tradeDate)).slice(0, 8),
    total: candidates.length,
    ...verdict,
  };
}

function attributionRow(
  record: RecommendationRecord,
  outcome: RecommendationOutcome,
  trade: TradeRecord,
): ExecutionAttributionRow {
  const referencePrice = record.referencePrice ?? trade.price;
  const sell = record.side.toUpperCase() === "SELL";
  const slippageBps = referencePrice > 0
    ? (sell ? (referencePrice - trade.price) / referencePrice : (trade.price - referencePrice) / referencePrice) * 10_000
    : 0;
  const notional = trade.quantity * trade.price;
  const feeBps = notional > 0 ? (trade.fee / notional) * 10_000 : 0;
  const feePct = feeBps / 100;
  const evaluationPrice = outcome.evaluationPrice;
  const actualNetReturnPct = typeof evaluationPrice === "number" && evaluationPrice > 0 && trade.price > 0
    ? (sell ? trade.price / evaluationPrice - 1 : evaluationPrice / trade.price - 1) * 100 - feePct
    : null;
  const recommendationReturnPct = outcome.signedReturnPct;
  const executionDragPct = actualNetReturnPct != null && recommendationReturnPct != null
    ? actualNetReturnPct - recommendationReturnPct
    : null;

  return {
    actualNetReturnPct,
    executionDragPct,
    feeBps,
    key: `${record.id}:${trade.id}`,
    priority: record.priority ?? "—",
    recommendationReturnPct,
    side: sell ? "卖出" : "买入",
    slippageBps,
    symbol: record.symbol,
    tradeDate: trade.tradeDate,
  };
}

function deduplicateActionableRecords(records: RecommendationRecord[], profileKey: string | undefined) {
  const eligible = records
    .filter((record) => (!profileKey || record.profileKey === profileKey)
      && (record.source === "ledger-batch" || record.source === "ticket")
      && (record.side.toUpperCase() === "BUY" || record.side.toUpperCase() === "SELL"))
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  const byDecision = new Map<string, RecommendationRecord>();
  eligible.forEach((record) => {
    byDecision.set(`${record.asOf}:${normalizeSymbol(record.symbol)}:${record.side.toUpperCase()}`, record);
  });
  return [...byDecision.values()];
}

function reviewOutcome(outcomes: RecommendationOutcome[]) {
  return outcomes.find((item) => item.horizonDays === 20 && item.status === "evaluated")
    ?? outcomes.find((item) => item.status === "evaluated")
    ?? null;
}

function executionVerdict({
  averageExecutionDragPct,
  averageSlippageBps,
  matched,
}: {
  averageExecutionDragPct: number | null;
  averageSlippageBps: number | null;
  matched: number;
}) {
  if (!matched) {
    return {
      verdict: "等待成交流水",
      verdictDetail: "尚未匹配到建议后 5 日内的真实成交；同步或录入成交后再评估执行质量。",
      verdictTone: "neutral" as const,
    };
  }
  if ((averageExecutionDragPct ?? 0) <= -0.5) {
    return {
      verdict: "执行明显拖累",
      verdictDetail: `成交后的平均收益比建议基准低 ${Math.abs(averageExecutionDragPct ?? 0).toFixed(2)}%，优先检查时机、滑点和费用。`,
      verdictTone: "negative" as const,
    };
  }
  if ((averageSlippageBps ?? 0) > 35) {
    return {
      verdict: "滑点偏高",
      verdictDetail: `平均不利滑点 ${(averageSlippageBps ?? 0).toFixed(0)} bps，建议缩小单笔并强化限价。`,
      verdictTone: "caution" as const,
    };
  }
  return {
    verdict: "执行质量正常",
    verdictDetail: "已成交建议的滑点和执行拖累暂未触发限制。",
    verdictTone: "positive" as const,
  };
}

function tradeSide(side: string) {
  return side.toUpperCase() === "SELL" ? "sell" : "buy";
}

function dayDistance(from: string, to: string) {
  const fromTime = Date.parse(`${from.slice(0, 10)}T00:00:00Z`);
  const toTime = Date.parse(`${to.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(fromTime) || !Number.isFinite(toTime)) return Number.POSITIVE_INFINITY;
  return Math.round((toTime - fromTime) / 86_400_000);
}

function sameSymbol(left: string, right: string) {
  return normalizeSymbol(left) === normalizeSymbol(right);
}

function normalizeSymbol(value: string) {
  return value.trim().toUpperCase();
}

function average(values: number[]) {
  const finite = values.filter(Number.isFinite);
  return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : null;
}
