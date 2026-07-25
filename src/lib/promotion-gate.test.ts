import { describe, expect, it } from "vitest";
import type { RecommendationRecord } from "./recommendation-log";
import { buildPromotionGate } from "./promotion-gate";

function record(index: number, overrides: Partial<RecommendationRecord> = {}): RecommendationRecord {
  const date = `2025-01-${String(index + 1).padStart(2, "0")}`;
  return {
    id: `record-${index}`,
    decisionId: `decision-${index}`,
    schemaVersion: 3,
    createdAt: `${date}T10:00:00.000Z`,
    asOf: date,
    source: "daily-decision",
    profileKey: "us-core",
    profileVersion: "2.0.0",
    profileSchemaVersion: 2,
    strategyKey: "portfolio-decision",
    strategyLabel: "组合决策",
    strategyScore: 70,
    cohortEvidence: {
      kind: "forward-live",
      strategyVersion: "portfolio-decision@2.0.0",
      dataSignature: "frozen-v2",
      trainingWindow: "",
      validationWindow: "live-forward",
      frozenAt: `${date}T10:00:00.000Z`,
    },
    symbol: `ASSET-${index}`,
    name: "Asset",
    side: "BUY",
    amount: "",
    weight: "",
    recommendationState: "",
    detail: "",
    readinessLabel: "",
    confidenceScore: 70,
    riskScore: 50,
    signalQualityScore: 70,
    stateConfidenceScore: 70,
    historicalSampleCount: 20,
    historicalSampleQuality: "medium",
    marketState: "normal",
    protocolState: "normal",
    dataSource: "local",
    referencePrice: 100,
    referencePriceSource: "technical-close",
    disposition: "pending",
    dispositionUpdatedAt: null,
    deferredUntil: null,
    decisionEvents: [],
    outcomes: [{
      status: "evaluated",
      evaluatedAt: "2025-02-01T00:00:00.000Z",
      horizonDays: 20,
      evaluationPrice: 102,
      returnPct: 2,
      signedReturnPct: 2,
      benchmarkReturnPct: 1,
      excessReturnPct: 1,
      maxDrawdownPct: -1,
      avoidedLossPct: null,
      wasCorrect: true,
      note: "",
    }],
    ...overrides,
  };
}

describe("promotion gate", () => {
  it("allows only a complete positive forward cohort into human review", () => {
    const result = buildPromotionGate(Array.from({ length: 20 }, (_, index) => record(index)));

    expect(result.reviewable).toBe(1);
    expect(result.cohorts[0].canPromote).toBe(true);
    expect(result.cohorts[0].sampleCount).toBe(20);
  });

  it("keeps a valid but small cohort in collection", () => {
    const result = buildPromotionGate(Array.from({ length: 8 }, (_, index) => record(index)));

    expect(result.cohorts[0].status).toBe("collecting");
    expect(result.cohorts[0].canPromote).toBe(false);
  });

  it("blocks legacy records without immutable cohort evidence", () => {
    const result = buildPromotionGate([
      record(0, {
        cohortEvidence: {
          kind: "unverified",
          strategyVersion: "portfolio-decision@legacy",
          dataSignature: "",
          trainingWindow: "",
          validationWindow: "",
          frozenAt: "",
        },
      }),
    ]);

    expect(result.cohorts[0].status).toBe("blocked");
    expect(result.cohorts[0].sampleCount).toBe(0);
  });

  it("holds a sufficiently large cohort when benchmark excess is negative", () => {
    const records = Array.from({ length: 20 }, (_, index) => record(index));
    records.forEach((item) => {
      item.outcomes[0].excessReturnPct = -0.2;
    });

    expect(buildPromotionGate(records).cohorts[0].status).toBe("hold");
  });

  it("deduplicates repeated symbol-side decisions on the same date", () => {
    const duplicate = record(0, { id: "duplicate", createdAt: "2025-01-01T11:00:00.000Z" });
    const result = buildPromotionGate([record(0), duplicate], { minimumSampleCount: 5 });

    expect(result.cohorts[0].sampleCount).toBe(1);
  });
});
