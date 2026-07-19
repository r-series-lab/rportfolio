import type { HoldingRecord } from "./holdings";
import { isCashHolding, type PositionPlan, type PositionPlanAction, type PositionPlanTone } from "./position-plan";
import type { RecommendationReadiness } from "./recommendation-readiness";

export type HoldingDeskFilter = "all" | "actionable" | "real" | "watch";

export type HoldingDeskSummary = {
  reviewCount: number;
  reviewDetail: string;
  reviewTone: PositionPlanTone;
  reviewValue: string;
};

export type HoldingLedgerAdviceInput = {
  action: string;
  amount: string;
  reason: string;
  state: string;
  tone: PositionPlanTone;
};

export type HoldingLedgerRowInput = HoldingRecord & {
  costValue: number;
  drift: number | null;
  marketValue: number;
  pnl: number;
  pnlPct: number | null;
  weight: number;
};

export type HoldingLedgerRow = {
  adviceAction: string;
  adviceAmount: string;
  adviceReason: string;
  id: string;
  isActionable: boolean;
  isObservation: boolean;
  isReal: boolean;
  searchText: string;
  statusLabel: "可建票" | "待复核" | "阻断" | "观察";
  statusTone: PositionPlanTone;
};

export type HoldingInspectorView = {
  actionLabel: string;
  amountLabel: string;
  identityLine: string;
  reason: string;
  statusLabel: HoldingLedgerRow["statusLabel"];
  statusTone: PositionPlanTone;
};

export function buildHoldingDeskSummary({
  positionPlan,
  readiness,
}: {
  positionPlan: PositionPlan;
  readiness: RecommendationReadiness;
}): HoldingDeskSummary {
  const reviewCount = positionPlan.actions.filter((action) => action.holdingId && action.weightDelta !== 0).length;
  const reviewTone = positionPlan.actions.some((action) => action.holdingId && action.weightDelta < 0)
    ? "negative"
    : readiness.tone;
  return {
    reviewCount,
    reviewDetail: `${readiness.label} · ${readiness.confidenceLabel} ${readiness.confidenceScore}/100`,
    reviewTone,
    reviewValue: reviewCount ? `${reviewCount}` : "0",
  };
}

export function buildHoldingLedgerRow({
  action,
  advice,
  holding,
  readiness,
}: {
  action?: PositionPlanAction;
  advice: HoldingLedgerAdviceInput;
  holding: HoldingLedgerRowInput;
  readiness: RecommendationReadiness;
}): HoldingLedgerRow {
  const isReal = holding.role === "real";
  const isObservation = !isReal || isCashHolding(holding);
  const blocked = !isObservation && isBlockedAdvice(advice, readiness);
  const isActionable = !blocked && !isObservation && Boolean(action?.amount && action.amount > 0);
  const statusLabel: HoldingLedgerRow["statusLabel"] = isObservation
    ? "观察"
    : blocked
      ? "阻断"
      : isActionable
        ? "可建票"
        : "待复核";
  const statusTone: PositionPlanTone = statusLabel === "可建票"
    ? action?.tone ?? advice.tone
    : statusLabel === "阻断"
      ? "caution"
      : statusLabel === "观察"
        ? "neutral"
        : advice.tone === "negative"
          ? "caution"
          : "neutral";

  return {
    adviceAction: advice.action,
    adviceAmount: advice.amount,
    adviceReason: advice.reason,
    id: holding.id,
    isActionable,
    isObservation,
    isReal,
    searchText: [
      holding.symbol,
      holding.name,
      holding.market,
      holding.currency,
      holding.role,
      holding.assetType,
      advice.action,
      advice.reason,
      statusLabel,
    ].join(" ").toLowerCase(),
    statusLabel,
    statusTone,
  };
}

export function buildHoldingInspectorView({
  advice,
  ledgerRow,
  sourceLine,
}: {
  advice: HoldingLedgerAdviceInput;
  holding: HoldingRecord;
  ledgerRow: HoldingLedgerRow;
  sourceLine: string;
}): HoldingInspectorView {
  return {
    actionLabel: advice.action,
    amountLabel: advice.amount,
    identityLine: sourceLine,
    reason: advice.reason,
    statusLabel: ledgerRow.statusLabel,
    statusTone: ledgerRow.statusTone,
  };
}

export function filterHoldingLedgerRows<T extends { ledger: HoldingLedgerRow }>({
  filter,
  query,
  rows,
}: {
  filter: HoldingDeskFilter;
  query: string;
  rows: T[];
}): T[] {
  const normalizedQuery = query.trim().toLowerCase();
  return rows.filter((row) => {
    if (normalizedQuery && !row.ledger.searchText.includes(normalizedQuery)) return false;
    if (filter === "actionable") return row.ledger.isActionable || row.ledger.statusLabel === "阻断";
    if (filter === "real") return row.ledger.isReal;
    if (filter === "watch") return row.ledger.isObservation;
    return true;
  });
}

function isBlockedAdvice(advice: HoldingLedgerAdviceInput, readiness: RecommendationReadiness) {
  if (readiness.tone === "negative") return true;
  return /阻断|风险门未开|数据待更新|配置阻断|预算不足|未开/u.test(`${advice.state} ${advice.reason}`);
}
