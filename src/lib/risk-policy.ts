export type RiskPolicyInstrumentCaps = {
  etfPct: number;
  fundPct: number;
  leveragedEtfPct: number;
  otherPct: number;
  stockPct: number;
};

export type RiskPolicyLossBrake = {
  etfDailyDropBlockPct: number;
  etfDailyDropWarnPct: number;
  leveragedEtfDailyDropBlockPct: number;
  portfolioDailyLossPct: number;
};

export type RiskGuardPolicy = {
  cooldownMinutes: number;
  lossBrake: RiskPolicyLossBrake;
  maxDailyOrders: number;
  requireLiveConfirmation: boolean;
  singleOrderCaps: RiskPolicyInstrumentCaps;
  updatedAt: string;
  version: number;
};

export const RISK_POLICY_STORAGE_KEY = "rportfolio.riskGuardPolicy.v2";

export const DEFAULT_RISK_GUARD_POLICY: RiskGuardPolicy = {
  cooldownMinutes: 30,
  lossBrake: {
    etfDailyDropBlockPct: 7,
    etfDailyDropWarnPct: 4,
    leveragedEtfDailyDropBlockPct: 4,
    portfolioDailyLossPct: 3.5,
  },
  maxDailyOrders: 8,
  requireLiveConfirmation: true,
  singleOrderCaps: {
    etfPct: 5,
    fundPct: 4,
    leveragedEtfPct: 1,
    otherPct: 2,
    stockPct: 3,
  },
  updatedAt: "",
  version: 2,
};

export function normalizeRiskGuardPolicy(value: Partial<RiskGuardPolicy> | null | undefined): RiskGuardPolicy {
  const singleOrderCaps: Partial<RiskPolicyInstrumentCaps> = value?.singleOrderCaps ?? {};
  const lossBrake: Partial<RiskPolicyLossBrake> = value?.lossBrake ?? {};
  return {
    cooldownMinutes: clampNumber(value?.cooldownMinutes, DEFAULT_RISK_GUARD_POLICY.cooldownMinutes, 0, 24 * 60),
    lossBrake: {
      etfDailyDropBlockPct: clampNumber(lossBrake.etfDailyDropBlockPct, DEFAULT_RISK_GUARD_POLICY.lossBrake.etfDailyDropBlockPct, 0, 50),
      etfDailyDropWarnPct: clampNumber(lossBrake.etfDailyDropWarnPct, DEFAULT_RISK_GUARD_POLICY.lossBrake.etfDailyDropWarnPct, 0, 50),
      leveragedEtfDailyDropBlockPct: clampNumber(lossBrake.leveragedEtfDailyDropBlockPct, DEFAULT_RISK_GUARD_POLICY.lossBrake.leveragedEtfDailyDropBlockPct, 0, 50),
      portfolioDailyLossPct: clampNumber(lossBrake.portfolioDailyLossPct, DEFAULT_RISK_GUARD_POLICY.lossBrake.portfolioDailyLossPct, 0, 50),
    },
    maxDailyOrders: Math.round(clampNumber(value?.maxDailyOrders, DEFAULT_RISK_GUARD_POLICY.maxDailyOrders, 0, 200)),
    requireLiveConfirmation: value?.requireLiveConfirmation ?? DEFAULT_RISK_GUARD_POLICY.requireLiveConfirmation,
    singleOrderCaps: {
      etfPct: clampNumber(singleOrderCaps.etfPct, DEFAULT_RISK_GUARD_POLICY.singleOrderCaps.etfPct, 0.1, 50),
      fundPct: clampNumber(singleOrderCaps.fundPct, DEFAULT_RISK_GUARD_POLICY.singleOrderCaps.fundPct, 0.1, 50),
      leveragedEtfPct: clampNumber(singleOrderCaps.leveragedEtfPct, DEFAULT_RISK_GUARD_POLICY.singleOrderCaps.leveragedEtfPct, 0.1, 20),
      otherPct: clampNumber(singleOrderCaps.otherPct, DEFAULT_RISK_GUARD_POLICY.singleOrderCaps.otherPct, 0.1, 50),
      stockPct: clampNumber(singleOrderCaps.stockPct, DEFAULT_RISK_GUARD_POLICY.singleOrderCaps.stockPct, 0.1, 50),
    },
    updatedAt: value?.updatedAt ?? "",
    version: 2,
  };
}

export function riskPolicyInstrumentCap(
  policy: RiskGuardPolicy,
  kind: "etf" | "fund" | "leveraged-etf" | "stock" | "other" | "cash",
) {
  if (kind === "leveraged-etf") return policy.singleOrderCaps.leveragedEtfPct;
  if (kind === "etf") return policy.singleOrderCaps.etfPct;
  if (kind === "fund") return policy.singleOrderCaps.fundPct;
  if (kind === "stock") return policy.singleOrderCaps.stockPct;
  return policy.singleOrderCaps.otherPct;
}

export function riskPolicySummary(policy: RiskGuardPolicy) {
  return `${policy.maxDailyOrders} 单/日 · 冷却 ${policy.cooldownMinutes} 分钟 · ETF ${policy.singleOrderCaps.etfPct}%`;
}

function clampNumber(value: number | undefined, fallback: number, min: number, max: number) {
  if (typeof value !== "number" || Number.isNaN(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}
