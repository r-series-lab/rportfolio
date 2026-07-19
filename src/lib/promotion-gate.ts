import type { RecommendationOutcome, RecommendationRecord } from "./recommendation-log";

export type PromotionGateStatus = "blocked" | "collecting" | "review" | "hold";

export type PromotionCohort = {
  key: string;
  profileKey: string;
  profileVersion: string;
  strategyKey: string;
  strategyVersion: string;
  dataSignature: string;
  status: PromotionGateStatus;
  statusLabel: string;
  tone: "positive" | "neutral" | "caution" | "negative";
  canPromote: boolean;
  sampleCount: number;
  minimumSampleCount: number;
  unverifiedRecords: number;
  hitRatePct: number | null;
  averageSignedReturnPct: number | null;
  averageExcessReturnPct: number | null;
  averageMaxAdversePct: number | null;
  latestAsOf: string;
  rationale: string;
};

export type PromotionGateSummary = {
  cohorts: PromotionCohort[];
  reviewable: number;
  collecting: number;
  blocked: number;
  held: number;
};

type CohortBucket = {
  records: RecommendationRecord[];
  outcomes: RecommendationOutcome[];
};

export function buildPromotionGate(
  records: RecommendationRecord[],
  options: { minimumSampleCount?: number; profileKey?: string } = {},
): PromotionGateSummary {
  const minimumSampleCount = Math.max(5, Math.round(options.minimumSampleCount ?? 20));
  const candidates = options.profileKey
    ? records.filter((record) => record.profileKey === options.profileKey)
    : records;
  const buckets = new Map<string, CohortBucket>();

  candidates.forEach((record) => {
    const evidence = record.cohortEvidence;
    const key = [
      record.profileKey,
      record.profileVersion,
      record.strategyKey,
      evidence.strategyVersion,
      evidence.dataSignature || evidence.kind,
    ].join("|");
    const bucket = buckets.get(key) ?? { records: [], outcomes: [] };
    bucket.records.push(record);
    buckets.set(key, bucket);
  });

  const cohorts = [...buckets.entries()].map(([key, bucket]) => {
    const representative = bucket.records[0];
    const evidence = representative.cohortEvidence;
    const eligibleByDecision = deduplicateForwardRecords(bucket.records.filter((record) =>
      record.source !== "simulation"
      && record.cohortEvidence.kind === "forward-live"
      && Boolean(record.cohortEvidence.dataSignature)
    ));
    const outcomes = eligibleByDecision.flatMap((record) => {
      const outcome = record.outcomes.find((item) => item.horizonDays === 20 && item.status === "evaluated");
      return outcome && finite(outcome.signedReturnPct) && finite(outcome.excessReturnPct) ? [outcome] : [];
    });
    bucket.outcomes = outcomes;
    const unverifiedRecords = bucket.records.length - eligibleByDecision.length;
    const sampleCount = outcomes.length;
    const hitRatePct = sampleCount
      ? percent(outcomes.filter((outcome) => outcome.wasCorrect === true).length / sampleCount)
      : null;
    const averageSignedReturnPct = average(outcomes.map((outcome) => outcome.signedReturnPct));
    const averageExcessReturnPct = average(outcomes.map((outcome) => outcome.excessReturnPct));
    const averageMaxAdversePct = average(outcomes.map((outcome) => outcome.maxDrawdownPct));
    const gate = gateVerdict({
      averageExcessReturnPct,
      averageSignedReturnPct,
      evidenceKind: evidence.kind,
      hitRatePct,
      minimumSampleCount,
      sampleCount,
    });
    return {
      key,
      profileKey: representative.profileKey,
      profileVersion: representative.profileVersion,
      strategyKey: representative.strategyKey,
      strategyVersion: evidence.strategyVersion,
      dataSignature: evidence.dataSignature,
      status: gate.status,
      statusLabel: gate.statusLabel,
      tone: gate.tone,
      canPromote: gate.status === "review",
      sampleCount,
      minimumSampleCount,
      unverifiedRecords,
      hitRatePct,
      averageSignedReturnPct,
      averageExcessReturnPct,
      averageMaxAdversePct,
      latestAsOf: bucket.records.reduce((latest, record) => record.asOf > latest ? record.asOf : latest, ""),
      rationale: gate.rationale,
    } satisfies PromotionCohort;
  }).sort(compareCohorts);

  return {
    cohorts,
    reviewable: cohorts.filter((cohort) => cohort.status === "review").length,
    collecting: cohorts.filter((cohort) => cohort.status === "collecting").length,
    blocked: cohorts.filter((cohort) => cohort.status === "blocked").length,
    held: cohorts.filter((cohort) => cohort.status === "hold").length,
  };
}

function gateVerdict(input: {
  averageExcessReturnPct: number | null;
  averageSignedReturnPct: number | null;
  evidenceKind: RecommendationRecord["cohortEvidence"]["kind"];
  hitRatePct: number | null;
  minimumSampleCount: number;
  sampleCount: number;
}) {
  if (input.evidenceKind !== "forward-live") {
    return {
      status: "blocked" as const,
      statusLabel: "证据阻断",
      tone: "negative" as const,
      rationale: "该版本缺少冻结的数据签名或来自模拟记录，不能作为样本外晋级证据。",
    };
  }
  if (input.sampleCount < input.minimumSampleCount) {
    return {
      status: "collecting" as const,
      statusLabel: "继续收集",
      tone: "neutral" as const,
      rationale: `已取得 ${input.sampleCount} 个去重的 20 日样本外结果，还需 ${input.minimumSampleCount - input.sampleCount} 个。`,
    };
  }
  const passed = (input.hitRatePct ?? 0) >= 50
    && (input.averageSignedReturnPct ?? 0) > 0
    && (input.averageExcessReturnPct ?? 0) > 0;
  if (passed) {
    return {
      status: "review" as const,
      statusLabel: "可进入人工评审",
      tone: "positive" as const,
      rationale: "样本数量、方向收益和基准超额均通过晋级门；仍需人工审核后才能升级版本。",
    };
  }
  return {
    status: "hold" as const,
    statusLabel: "维持当前版本",
    tone: "caution" as const,
    rationale: "样本已足够，但命中率、方向收益或基准超额未同时通过，禁止晋级。",
  };
}

function deduplicateForwardRecords(records: RecommendationRecord[]) {
  const byDecision = new Map<string, RecommendationRecord>();
  records.forEach((record) => {
    const key = `${record.asOf}|${record.symbol.trim().toUpperCase()}|${record.side.trim().toUpperCase()}`;
    const current = byDecision.get(key);
    if (!current || record.createdAt > current.createdAt) byDecision.set(key, record);
  });
  return [...byDecision.values()];
}

function average(values: Array<number | null>) {
  const usable = values.filter(finite);
  if (!usable.length) return null;
  return Math.round((usable.reduce((sum, value) => sum + value, 0) / usable.length) * 10_000) / 10_000;
}

function percent(value: number) {
  return Math.round(value * 10_000) / 100;
}

function finite(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function compareCohorts(left: PromotionCohort, right: PromotionCohort) {
  const rank: Record<PromotionGateStatus, number> = { review: 0, collecting: 1, hold: 2, blocked: 3 };
  return rank[left.status] - rank[right.status] || right.latestAsOf.localeCompare(left.latestAsOf);
}
