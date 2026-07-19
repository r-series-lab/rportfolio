import { invoke } from "@tauri-apps/api/core";
import { executionGuidanceFor } from "./execution-guidance";
import { isTauriRuntime } from "./holding-storage";
import type { PositionPlanAction } from "./position-plan";
import type { RecommendationReadiness } from "./recommendation-readiness";
import type { RankedRecommendation, RecommendationPriority } from "./recommendation-ranking";
import type { OrderIntent, StrategyDefinition, StrategyScore } from "./strategy-engine";
import type { MarketAnalysisReport } from "./types";

const RECOMMENDATION_STORAGE_KEY = "rportfolio.recommendations";
const MAX_RECOMMENDATION_RECORDS = 5_000;

export type RecommendationOutcome = {
  status: "pending" | "evaluated" | "insufficient";
  evaluatedAt: string | null;
  horizonDays: number;
  evaluationPrice: number | null;
  returnPct: number | null;
  signedReturnPct: number | null;
  benchmarkReturnPct: number | null;
  excessReturnPct: number | null;
  maxDrawdownPct: number | null;
  avoidedLossPct: number | null;
  wasCorrect: boolean | null;
  note: string;
};

export type RecommendationCohortEvidence = {
  kind: "forward-live" | "simulation" | "unverified";
  strategyVersion: string;
  dataSignature: string;
  trainingWindow: string;
  validationWindow: string;
  frozenAt: string;
};

export type RecommendationRecord = {
  id: string;
  decisionId: string;
  schemaVersion: 3;
  createdAt: string;
  asOf: string;
  source: "daily-decision" | "ledger-batch" | "ticket" | "simulation";
  profileKey: string;
  profileVersion: string;
  profileSchemaVersion: number;
  strategyKey: string;
  strategyLabel: string;
  strategyScore: number;
  cohortEvidence: RecommendationCohortEvidence;
  symbol: string;
  name: string;
  side: string;
  decisionType?: RecommendationDecisionType;
  actionLabel?: string;
  triggerCondition?: string;
  limitPriceRange?: string;
  invalidationCondition?: string;
  reviewAt?: string;
  amount: string;
  weight: string;
  recommendationState: string;
  priority?: RecommendationPriority;
  priorityScore?: number;
  detail: string;
  readinessLabel: string;
  confidenceScore: number;
  riskScore: number;
  signalQualityScore: number;
  stateConfidenceScore: number;
  historicalSampleCount: number;
  historicalSampleQuality: string;
  marketState: string;
  protocolState: string;
  dataSource: string;
  referencePrice: number | null;
  referencePriceSource: "technical-close" | "asset-close" | "unavailable";
  disposition: RecommendationDisposition;
  dispositionUpdatedAt: string | null;
  deferredUntil: string | null;
  decisionEvents: RecommendationDecisionEvent[];
  outcomes: RecommendationOutcome[];
};

export type RecommendationDecisionType = "increase" | "reduce" | "hold" | "wait" | "blocked" | "config";
export type RecommendationDisposition = "pending" | "accepted" | "rejected" | "deferred" | "reviewed";
export type RecommendationDecisionAction = "accept" | "reject" | "defer" | "review";

export type RecommendationDecisionEvent = {
  id: string;
  action: RecommendationDecisionAction;
  at: string;
  note: string;
  reviewAt: string | null;
};

export type RecordRecommendationDecisionInput = {
  action: RecommendationDecisionAction;
  at?: string;
  note?: string;
  reviewAt?: string | null;
};

const EVALUATION_HORIZONS = [5, 20, 60] as const;

export function recommendationRecordsForOrders({
  orders,
  readiness,
  report,
  score,
  source,
  strategy,
  rankings = [],
}: {
  orders: OrderIntent[];
  readiness: RecommendationReadiness;
  report: MarketAnalysisReport;
  score: StrategyScore;
  source: RecommendationRecord["source"];
  strategy: StrategyDefinition;
  rankings?: RankedRecommendation[];
}): RecommendationRecord[] {
  const createdAt = new Date().toISOString();
  const validation = report.backtest.stateValidation;
  return orders.map((order, index) => {
    const reference = referencePriceFor(order.symbol, report);
    const ranking = rankings.find((item) => item.order.key === order.key);
    const id = recommendationId(createdAt, order.symbol, order.side, index);
    return {
    id,
    decisionId: order.decisionId || id,
    schemaVersion: 3,
    createdAt,
    asOf: report.asOf,
    source,
    profileKey: report.profileKey,
    profileVersion: report.profileVersion || "1.0.0",
    profileSchemaVersion: report.profileSchemaVersion || 1,
    strategyKey: strategy.key,
    strategyLabel: strategy.label,
    strategyScore: score.score,
    cohortEvidence: cohortEvidenceFor(report, source, strategy.key, createdAt),
    symbol: order.symbol,
    name: order.name,
    side: order.side,
    amount: order.amount,
    weight: order.weight,
    recommendationState: order.state,
    priority: ranking?.priority,
    priorityScore: ranking?.score,
    detail: order.detail,
    readinessLabel: readiness.label,
    confidenceScore: readiness.confidenceScore,
    riskScore: report.score,
    signalQualityScore: report.signalQuality?.score ?? 0,
    stateConfidenceScore: report.stateConfidence?.score ?? 0,
    historicalSampleCount: validation.effectiveSampleCount ?? validation.sampleCount,
    historicalSampleQuality: validation.sampleQualityLabel || validation.confidence,
    marketState: report.marketState.key,
    protocolState: report.decisionFrame.protocolState,
    dataSource: report.source,
    referencePrice: reference.price,
    referencePriceSource: reference.source,
    ...emptyDecisionLifecycle(),
    outcomes: EVALUATION_HORIZONS.map((horizonDays) => emptyOutcome(horizonDays, reference.price)),
  };
  });
}

export function recommendationRecordsForPositionPlan({
  actions,
  readiness,
  report,
}: {
  actions: PositionPlanAction[];
  readiness: RecommendationReadiness;
  report: MarketAnalysisReport;
}): RecommendationRecord[] {
  const createdAt = new Date().toISOString();
  const validation = report.backtest.stateValidation;
  return actions
    .filter((action) => Boolean(action.holdingId && action.symbol))
    .map((action) => {
      const reference = referencePriceFor(action.symbol, report);
      const decisionType = decisionTypeForAction(action);
      const side = sideForDecisionType(decisionType);
      const guidance = executionGuidanceFor({ action, currentPrice: reference.price, report, side });
      const id = dailyDecisionId(report.asOf, report.profileKey, action.symbol);
      return {
        id,
        decisionId: id,
        schemaVersion: 3,
        createdAt,
        asOf: report.asOf,
        source: "daily-decision",
        profileKey: report.profileKey,
        profileVersion: report.profileVersion || "1.0.0",
        profileSchemaVersion: report.profileSchemaVersion || 1,
        strategyKey: "portfolio-decision",
        strategyLabel: "组合决策",
        strategyScore: readiness.confidenceScore,
        cohortEvidence: cohortEvidenceFor(report, "daily-decision", "portfolio-decision", createdAt),
        symbol: action.symbol,
        name: action.name,
        side,
        decisionType,
        actionLabel: action.action,
        ...guidance,
        amount: action.amountLabel,
        weight: action.weightLabel,
        recommendationState: action.action,
        detail: action.reason || action.detail,
        readinessLabel: readiness.label,
        confidenceScore: readiness.confidenceScore,
        riskScore: report.score,
        signalQualityScore: report.signalQuality?.score ?? 0,
        stateConfidenceScore: report.stateConfidence?.score ?? 0,
        historicalSampleCount: validation.effectiveSampleCount ?? validation.sampleCount,
        historicalSampleQuality: validation.sampleQualityLabel || validation.confidence,
        marketState: report.marketState.key,
        protocolState: report.decisionFrame.protocolState,
        dataSource: report.source,
        referencePrice: reference.price,
        referencePriceSource: reference.source,
        ...emptyDecisionLifecycle(),
        outcomes: EVALUATION_HORIZONS.map((horizonDays) => emptyOutcome(horizonDays, reference.price)),
      };
    });
}

export async function appendRecommendationRecords(records: RecommendationRecord[]) {
  if (!records.length) return loadRecommendationRecords();
  const current = await loadRecommendationRecords();
  const byId = new Map(current.map((record) => [record.id, record]));
  records.forEach((record) => {
    const existing = byId.get(record.id);
    byId.set(record.id, existing ? mergeGeneratedRecommendation(existing, record) : record);
  });
  const next = [...byId.values()]
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    .slice(-MAX_RECOMMENDATION_RECORDS);
  return saveRecommendationRecords(next);
}

export async function recordRecommendationDecision(
  decisionId: string,
  input: RecordRecommendationDecisionInput,
) {
  const current = await loadRecommendationRecords();
  const next = applyRecommendationDecision(current, decisionId, input);
  return saveRecommendationRecords(next);
}

export function applyRecommendationDecision(
  records: RecommendationRecord[],
  decisionId: string,
  input: RecordRecommendationDecisionInput,
) {
  const at = validIso(input.at) ? String(input.at) : new Date().toISOString();
  const reviewAt = input.action === "defer" && isDateKey(input.reviewAt) ? String(input.reviewAt) : null;
  const event: RecommendationDecisionEvent = {
    id: `decision-event-${safeIdPart(decisionId)}-${at}-${input.action}`,
    action: input.action,
    at,
    note: input.note?.trim() ?? "",
    reviewAt,
  };
  return records.map((record) => {
    if (record.decisionId !== decisionId && record.id !== decisionId) return record;
    return {
      ...record,
      disposition: dispositionForAction(input.action),
      dispositionUpdatedAt: at,
      deferredUntil: reviewAt,
      decisionEvents: [...record.decisionEvents, event],
    };
  });
}

export async function loadRecommendationRecords(): Promise<RecommendationRecord[]> {
  if (isTauriRuntime()) {
    return normalizeRecommendationRecords(await invoke<unknown[]>("load_recommendations"));
  }
  try {
    return normalizeRecommendationRecords(JSON.parse(window.localStorage.getItem(RECOMMENDATION_STORAGE_KEY) || "[]") as unknown[]);
  } catch {
    return [];
  }
}

async function saveRecommendationRecords(records: RecommendationRecord[]) {
  if (isTauriRuntime()) {
    return normalizeRecommendationRecords(await invoke<unknown[]>("save_recommendations", { records }));
  }
  window.localStorage.setItem(RECOMMENDATION_STORAGE_KEY, JSON.stringify(records));
  return records;
}

function normalizeRecommendationRecords(records: unknown[]) {
  return records
    .map(normalizeRecommendationRecord)
    .filter((record): record is RecommendationRecord => Boolean(record))
    .slice(-MAX_RECOMMENDATION_RECORDS);
}

function normalizeRecommendationRecord(value: unknown): RecommendationRecord | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<RecommendationRecord> & { outcome?: Partial<RecommendationOutcome> };
  if (typeof record.id !== "string"
    || typeof record.createdAt !== "string"
    || typeof record.profileKey !== "string"
    || typeof record.symbol !== "string"
    || typeof record.side !== "string") return null;

  const schemaVersion = (value as { schemaVersion?: number }).schemaVersion;
  if ((schemaVersion === 2 || schemaVersion === 3) && Array.isArray(record.outcomes)) {
    const normalized = record as unknown as RecommendationRecord;
    return {
      ...normalized,
      schemaVersion: 3,
      decisionId: typeof record.decisionId === "string" && record.decisionId ? record.decisionId : record.id,
      cohortEvidence: normalizeCohortEvidence(record.cohortEvidence, record),
      disposition: normalizeDisposition(record.disposition),
      dispositionUpdatedAt: typeof record.dispositionUpdatedAt === "string" ? record.dispositionUpdatedAt : null,
      deferredUntil: isDateKey(record.deferredUntil) ? record.deferredUntil : null,
      decisionEvents: normalizeDecisionEvents(record.decisionEvents),
    };
  }

  if (schemaVersion !== 1) return null;
  const legacyOutcome = record.outcome;
  const legacyHorizon = typeof legacyOutcome?.horizonDays === "number" ? legacyOutcome.horizonDays : null;
  return {
    ...(record as unknown as Omit<RecommendationRecord, "schemaVersion" | "cohortEvidence" | "referencePrice" | "referencePriceSource" | "outcomes">),
    decisionId: record.id,
    schemaVersion: 3,
    cohortEvidence: unverifiedCohortEvidence(record),
    referencePrice: null,
    referencePriceSource: "unavailable",
    ...emptyDecisionLifecycle(),
    outcomes: EVALUATION_HORIZONS.map((horizonDays) => ({
      ...emptyOutcome(horizonDays, null),
      status: legacyHorizon === horizonDays && legacyOutcome?.status === "evaluated" ? "evaluated" : "insufficient",
      evaluatedAt: legacyHorizon === horizonDays ? legacyOutcome?.evaluatedAt ?? null : null,
      returnPct: legacyHorizon === horizonDays ? legacyOutcome?.returnPct ?? null : null,
      maxDrawdownPct: legacyHorizon === horizonDays ? legacyOutcome?.maxDrawdownPct ?? null : null,
      avoidedLossPct: legacyHorizon === horizonDays ? legacyOutcome?.avoidedLossPct ?? null : null,
      wasCorrect: legacyHorizon === horizonDays ? legacyOutcome?.wasCorrect ?? null : null,
      note: legacyHorizon === horizonDays ? legacyOutcome?.note ?? "旧记录缺少参考价。" : "旧记录缺少参考价，无法补算。",
    })),
  };
}

function emptyDecisionLifecycle(): Pick<
  RecommendationRecord,
  "disposition" | "dispositionUpdatedAt" | "deferredUntil" | "decisionEvents"
> {
  return {
    disposition: "pending",
    dispositionUpdatedAt: null,
    deferredUntil: null,
    decisionEvents: [],
  };
}

function mergeGeneratedRecommendation(existing: RecommendationRecord, incoming: RecommendationRecord): RecommendationRecord {
  const existingOutcomeByHorizon = new Map(existing.outcomes.map((outcome) => [outcome.horizonDays, outcome]));
  return {
    ...incoming,
    createdAt: existing.createdAt,
    decisionId: existing.decisionId || incoming.decisionId,
    disposition: existing.disposition,
    dispositionUpdatedAt: existing.dispositionUpdatedAt,
    deferredUntil: existing.deferredUntil,
    decisionEvents: existing.decisionEvents,
    cohortEvidence: existing.cohortEvidence,
    outcomes: incoming.outcomes.map((outcome) => existingOutcomeByHorizon.get(outcome.horizonDays) ?? outcome),
  };
}

function cohortEvidenceFor(
  report: MarketAnalysisReport,
  source: RecommendationRecord["source"],
  strategyKey: string,
  frozenAt: string,
): RecommendationCohortEvidence {
  const calibration = report.profileCalibrationStatus;
  const dataSignature = cleanText(calibration?.dataSignature);
  const kind = source === "simulation" ? "simulation" : dataSignature ? "forward-live" : "unverified";
  return {
    kind,
    strategyVersion: `${strategyKey}@${report.profileVersion || "1.0.0"}`,
    dataSignature,
    trainingWindow: cleanText(calibration?.trainingWindow),
    validationWindow: cleanText(calibration?.validationWindow),
    frozenAt,
  };
}

function normalizeCohortEvidence(
  value: unknown,
  record: Partial<Pick<RecommendationRecord, "createdAt" | "profileVersion" | "strategyKey">>,
): RecommendationCohortEvidence {
  if (!value || typeof value !== "object") return unverifiedCohortEvidence(record);
  const evidence = value as Partial<RecommendationCohortEvidence>;
  const kind = evidence.kind === "forward-live" || evidence.kind === "simulation" ? evidence.kind : "unverified";
  const dataSignature = cleanText(evidence.dataSignature);
  return {
    kind: kind === "forward-live" && !dataSignature ? "unverified" : kind,
    strategyVersion: cleanText(evidence.strategyVersion) || `${record.strategyKey}@${record.profileVersion}`,
    dataSignature,
    trainingWindow: cleanText(evidence.trainingWindow),
    validationWindow: cleanText(evidence.validationWindow),
    frozenAt: validIso(evidence.frozenAt) ? evidence.frozenAt : cleanText(record.createdAt),
  };
}

function unverifiedCohortEvidence(
  record: Partial<Pick<RecommendationRecord, "createdAt" | "profileVersion" | "strategyKey">>,
): RecommendationCohortEvidence {
  return {
    kind: "unverified",
    strategyVersion: `${cleanText(record.strategyKey) || "legacy"}@${cleanText(record.profileVersion) || "legacy"}`,
    dataSignature: "",
    trainingWindow: "",
    validationWindow: "",
    frozenAt: validIso(record.createdAt) ? record.createdAt : "",
  };
}

function dispositionForAction(action: RecommendationDecisionAction): RecommendationDisposition {
  if (action === "accept") return "accepted";
  if (action === "reject") return "rejected";
  if (action === "defer") return "deferred";
  return "reviewed";
}

function normalizeDisposition(value: unknown): RecommendationDisposition {
  return value === "accepted" || value === "rejected" || value === "deferred" || value === "reviewed"
    ? value
    : "pending";
}

function normalizeDecisionEvents(value: unknown): RecommendationDecisionEvent[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const event = item as Partial<RecommendationDecisionEvent>;
    if (!validIso(event.at) || !isDecisionAction(event.action)) return [];
    return [{
      id: typeof event.id === "string" && event.id ? event.id : `decision-event-${event.at}-${event.action}`,
      action: event.action,
      at: event.at,
      note: typeof event.note === "string" ? event.note : "",
      reviewAt: isDateKey(event.reviewAt) ? event.reviewAt : null,
    }];
  });
}

function isDecisionAction(value: unknown): value is RecommendationDecisionAction {
  return value === "accept" || value === "reject" || value === "defer" || value === "review";
}

function validIso(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isDateKey(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function emptyOutcome(horizonDays: number, referencePrice: number | null): RecommendationOutcome {
  return {
    status: referencePrice == null ? "insufficient" : "pending",
    evaluatedAt: null,
    horizonDays,
    evaluationPrice: null,
    returnPct: null,
    signedReturnPct: null,
    benchmarkReturnPct: null,
    excessReturnPct: null,
    maxDrawdownPct: null,
    avoidedLossPct: null,
    wasCorrect: null,
    note: referencePrice == null ? "缺少建议时点参考价，暂不能评估。" : `等待 ${horizonDays} 个交易日后评估。`,
  };
}

function referencePriceFor(symbol: string, report: MarketAnalysisReport) {
  const key = normalizeSymbol(symbol);
  const technical = report.technicalRows.find((row) => normalizeSymbol(row.symbol) === key);
  if (isPositiveNumber(technical?.close)) {
    return { price: technical.close, source: "technical-close" as const };
  }
  const asset = report.assetStatuses.find((row) => normalizeSymbol(row.symbol) === key);
  if (isPositiveNumber(asset?.close)) {
    return { price: asset.close, source: "asset-close" as const };
  }
  return { price: null, source: "unavailable" as const };
}

function decisionTypeForAction(action: PositionPlanAction): RecommendationDecisionType {
  if (action.weightDelta > 0) return "increase";
  if (action.weightDelta < 0) return "reduce";
  if (action.action === "继续持有") return "hold";
  if (action.action === "设置计划") return "config";
  if (/暂停|阻断|预算不足|补现金/.test(action.action)) return "blocked";
  return "wait";
}

function sideForDecisionType(decisionType: RecommendationDecisionType) {
  if (decisionType === "increase") return "BUY";
  if (decisionType === "reduce") return "SELL";
  if (decisionType === "hold") return "HOLD";
  if (decisionType === "config") return "CONFIG";
  if (decisionType === "blocked") return "BLOCKED";
  return "WAIT";
}

function normalizeSymbol(value: string) {
  return value.trim().toUpperCase();
}

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function recommendationId(createdAt: string, symbol: string, side: string, index: number) {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${index}`;
  return `rec-${createdAt}-${symbol}-${side}-${random}`;
}

function dailyDecisionId(asOf: string, profileKey: string, symbol: string) {
  return `rec-daily-${safeIdPart(asOf)}-${safeIdPart(profileKey)}-${safeIdPart(symbol)}`;
}

function safeIdPart(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "unknown";
}
