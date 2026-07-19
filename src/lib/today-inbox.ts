import type { OrderRecord } from "./order-store";
import type { PortfolioValuationAssessment, PortfolioValuationCheck } from "./portfolio-valuation";
import type { RecommendationReadiness } from "./recommendation-readiness";
import type { RecommendationDecisionType, RecommendationRecord } from "./recommendation-log";
import type { OrderIntent } from "./strategy-engine";
import type { TradeRecord } from "./trades";

export type TodayBlockerOwner = "资产数据" | "行情数据" | "策略配置" | "风险政策";

export type TodayDecisionItem = {
  record: RecommendationRecord;
  state: "pending" | "accepted" | "due" | "routed";
  stateLabel: string;
  priorityScore: number;
  linkedOrderIds: string[];
  linkedTradeIds: string[];
};

export type TodayBlocker = {
  key: string;
  label: string;
  detail: string;
  owner: TodayBlockerOwner;
  severity: "warn" | "block";
};

export type TodayInbox = {
  asOf: string;
  decisions: TodayDecisionItem[];
  blockers: TodayBlocker[];
  deferredCount: number;
  processedCount: number;
  linkedOrderCount: number;
  linkedTradeCount: number;
};

export function buildTodayInbox({
  asOf,
  orders,
  profileKey,
  readiness,
  records,
  trades,
  valuation,
  now = new Date(),
}: {
  asOf: string;
  orders: OrderRecord[];
  profileKey: string;
  readiness: RecommendationReadiness;
  records: RecommendationRecord[];
  trades: TradeRecord[];
  valuation: PortfolioValuationAssessment;
  now?: Date;
}): TodayInbox {
  const dateKey = localDateKey(now);
  const scoped = latestDailyDecisions(records, profileKey, asOf);
  const actionable = scoped.filter((record) => isActionableDecision(record.decisionType));
  const decisions = actionable.flatMap((record) => {
    const links = auditLinksForDecision(record.decisionId, orders, trades);
    const state = inboxState(record, links.linkedOrderIds.length, links.linkedTradeIds.length, dateKey);
    if (!state) return [];
    return [{
      record,
      state,
      stateLabel: state === "routed" ? "委托跟踪" : state === "accepted" ? "待生成委托" : state === "due" ? "延期到期" : "待决定",
      priorityScore: decisionPriority(record, state),
      ...links,
    } satisfies TodayDecisionItem];
  }).sort((left, right) => right.priorityScore - left.priorityScore || left.record.symbol.localeCompare(right.record.symbol));
  const processedCount = actionable.length - decisions.length - actionable.filter((record) => (
    record.disposition === "deferred" && Boolean(record.deferredUntil && record.deferredUntil > dateKey)
  )).length;
  const linkedDecisionIds = new Set(scoped.map((record) => record.decisionId));
  const linkedOrders = orders.filter((order) => order.decisionId && linkedDecisionIds.has(order.decisionId));
  const linkedOrderIds = new Set(linkedOrders.map((order) => order.id));
  const linkedTrades = trades.filter((trade) => (
    Boolean(trade.decisionId && linkedDecisionIds.has(trade.decisionId))
    || Boolean(trade.orderId && linkedOrderIds.has(trade.orderId))
  ));

  return {
    asOf,
    decisions,
    blockers: buildTodayBlockers(scoped, valuation.checks, readiness),
    deferredCount: actionable.filter((record) => record.disposition === "deferred" && Boolean(record.deferredUntil && record.deferredUntil > dateKey)).length,
    processedCount: Math.max(0, processedCount),
    linkedOrderCount: linkedOrders.length,
    linkedTradeCount: linkedTrades.length,
  };
}

export function decisionIdForOrderIntent(
  intent: Pick<OrderIntent, "decisionId" | "side" | "symbol">,
  records: RecommendationRecord[],
  context: { asOf: string; profileKey: string; preferredDecisionId?: string },
) {
  if (intent.decisionId) return intent.decisionId;
  const expectedType = intent.side.toUpperCase() === "SELL" ? "reduce" : "increase";
  const candidates = latestDailyDecisions(records, context.profileKey, context.asOf)
    .filter((record) => normalizeSymbol(record.symbol) === normalizeSymbol(intent.symbol))
    .filter((record) => record.decisionType === expectedType)
    .filter((record) => record.disposition !== "rejected");
  return candidates.find((record) => record.decisionId === context.preferredDecisionId)?.decisionId
    ?? candidates.find((record) => record.disposition === "accepted")?.decisionId
    ?? candidates[0]?.decisionId;
}

export function auditLinksForDecision(decisionId: string, orders: OrderRecord[], trades: TradeRecord[]) {
  const linkedOrders = orders.filter((order) => order.decisionId === decisionId);
  const linkedOrderIds = linkedOrders.map((order) => order.id);
  const orderIds = new Set(linkedOrderIds);
  const linkedTradeIds = trades
    .filter((trade) => trade.decisionId === decisionId || Boolean(trade.orderId && orderIds.has(trade.orderId)))
    .map((trade) => trade.id);
  return { linkedOrderIds, linkedTradeIds };
}

function latestDailyDecisions(records: RecommendationRecord[], profileKey: string, asOf: string) {
  const byDecision = new Map<string, RecommendationRecord>();
  records
    .filter((record) => record.source === "daily-decision" && record.profileKey === profileKey && record.asOf === asOf)
    .forEach((record) => {
      const existing = byDecision.get(record.decisionId);
      if (!existing || record.createdAt >= existing.createdAt) byDecision.set(record.decisionId, record);
    });
  return [...byDecision.values()];
}

function inboxState(
  record: RecommendationRecord,
  linkedOrderCount: number,
  linkedTradeCount: number,
  dateKey: string,
): TodayDecisionItem["state"] | null {
  if (record.disposition === "rejected" || record.disposition === "reviewed") return null;
  if (record.disposition === "accepted") {
    if (linkedTradeCount) return null;
    return linkedOrderCount ? "routed" : "accepted";
  }
  if (record.disposition === "deferred") {
    return record.deferredUntil && record.deferredUntil <= dateKey ? "due" : null;
  }
  return "pending";
}

function decisionPriority(record: RecommendationRecord, state: TodayDecisionItem["state"]) {
  const direction = record.decisionType === "reduce" ? 300 : 200;
  const lifecycle = state === "routed" ? 70 : state === "accepted" ? 60 : state === "due" ? 40 : 20;
  return direction + lifecycle + Math.max(0, record.priorityScore ?? 0);
}

function buildTodayBlockers(
  records: RecommendationRecord[],
  valuationChecks: PortfolioValuationCheck[],
  readiness: RecommendationReadiness,
) {
  const blockers: TodayBlocker[] = valuationChecks
    .filter((check) => check.severity !== "pass")
    .map((check) => ({
      key: check.key,
      label: check.label,
      detail: check.detail,
      owner: blockerOwnerForKey(check.key),
      severity: check.severity === "block" ? "block" : "warn",
    }));

  if (readiness.tone !== "positive") {
    blockers.push({
      key: `readiness.${readiness.label}`,
      label: readiness.label,
      detail: readiness.detail,
      owner: readiness.dataQuality.severity === "pass" ? "风险政策" : "行情数据",
      severity: readiness.canReduceRisk ? "warn" : "block",
    });
  }

  records
    .filter((record) => record.decisionType === "blocked" || record.decisionType === "config")
    .forEach((record) => blockers.push({
      key: `decision.${record.decisionId}`,
      label: `${record.symbol} · ${record.actionLabel || record.recommendationState}`,
      detail: record.detail,
      owner: record.decisionType === "config" ? "策略配置" : "风险政策",
      severity: "block",
    }));

  const unique = new Map<string, TodayBlocker>();
  blockers.forEach((blocker) => {
    const key = `${blocker.owner}:${blocker.detail}`;
    if (!unique.has(key)) unique.set(key, blocker);
  });
  return [...unique.values()];
}

function blockerOwnerForKey(key: string): TodayBlockerOwner {
  if (/^(fx|currency|quote)/.test(key)) return "资产数据";
  if (/profile|target|config/.test(key)) return "策略配置";
  if (/risk|gate|limit/.test(key)) return "风险政策";
  return "行情数据";
}

function isActionableDecision(value: RecommendationDecisionType | undefined) {
  return value === "increase" || value === "reduce";
}

function localDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeSymbol(value: string) {
  return value.trim().toUpperCase();
}
