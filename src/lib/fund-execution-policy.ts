import { nextChinaTradingDay } from "./china-trading-calendar";

export type FundFeeOverride = {
  symbol: string;
  buyFeeRate: number;
  sellFeeRate: number;
  redemptionSettlementDays: number;
};

export type FundExecutionPolicy = {
  version: number;
  cutoffTime: string;
  defaultBuyFeeRate: number;
  defaultSellFeeRate: number;
  defaultRedemptionSettlementDays: number;
  feeOverrides: FundFeeOverride[];
};

export const DEFAULT_FUND_EXECUTION_POLICY: FundExecutionPolicy = {
  version: 2,
  cutoffTime: "15:00",
  defaultBuyFeeRate: 0.001,
  defaultSellFeeRate: 0.005,
  defaultRedemptionSettlementDays: 3,
  feeOverrides: [],
};

export function normalizeFundExecutionPolicy(
  value: Partial<FundExecutionPolicy> | null | undefined,
): FundExecutionPolicy {
  return {
    version: 2,
    cutoffTime: normalizeCutoff(value?.cutoffTime),
    defaultBuyFeeRate: normalizeRate(value?.defaultBuyFeeRate, DEFAULT_FUND_EXECUTION_POLICY.defaultBuyFeeRate),
    defaultSellFeeRate: normalizeRate(value?.defaultSellFeeRate, DEFAULT_FUND_EXECUTION_POLICY.defaultSellFeeRate),
    defaultRedemptionSettlementDays: normalizeSettlementDays(
      value?.defaultRedemptionSettlementDays,
      DEFAULT_FUND_EXECUTION_POLICY.defaultRedemptionSettlementDays,
    ),
    feeOverrides: Array.isArray(value?.feeOverrides)
      ? value.feeOverrides.map(normalizeOverride).filter((item): item is FundFeeOverride => Boolean(item))
      : [],
  };
}

export function fundFeesFor(policy: FundExecutionPolicy, symbol: string) {
  const normalized = normalizeFundExecutionPolicy(policy);
  const override = normalized.feeOverrides.find((item) => item.symbol === symbolKey(symbol));
  return {
    buyFeeRate: override?.buyFeeRate ?? normalized.defaultBuyFeeRate,
    sellFeeRate: override?.sellFeeRate ?? normalized.defaultSellFeeRate,
    redemptionSettlementDays: override?.redemptionSettlementDays ?? normalized.defaultRedemptionSettlementDays,
  };
}

export function fundOrderScheduleFor({
  cutoffTime,
  orderDate,
  redemptionSettlementDays = DEFAULT_FUND_EXECUTION_POLICY.defaultRedemptionSettlementDays,
  submittedAt,
}: {
  cutoffTime: string;
  orderDate: string;
  redemptionSettlementDays?: number;
  submittedAt: string;
}) {
  const chinaNow = chinaDateTime(submittedAt);
  const normalizedOrderDate = normalizeDate(orderDate);
  const afterCutoff = normalizedOrderDate !== chinaNow.date || chinaNow.time >= normalizeCutoff(cutoffTime);
  const navDate = afterCutoff ? nextChinaTradingDay(normalizedOrderDate) : normalizedOrderDate;
  return {
    afterCutoff,
    navDate,
    confirmDate: nextChinaTradingDay(navDate),
    cashArrivalDate: tradingDateAfter(navDate, normalizeSettlementDays(redemptionSettlementDays, 3)),
  };
}

export function updateFundFeeOverride(
  policy: FundExecutionPolicy,
  symbol: string,
  patch: Partial<Pick<FundFeeOverride, "buyFeeRate" | "sellFeeRate" | "redemptionSettlementDays">>,
) {
  const normalized = normalizeFundExecutionPolicy(policy);
  const key = symbolKey(symbol);
  const current = normalized.feeOverrides.find((item) => item.symbol === key);
  const next: FundFeeOverride = {
    symbol: key,
    buyFeeRate: normalizeRate(patch.buyFeeRate, current?.buyFeeRate ?? normalized.defaultBuyFeeRate),
    sellFeeRate: normalizeRate(patch.sellFeeRate, current?.sellFeeRate ?? normalized.defaultSellFeeRate),
    redemptionSettlementDays: normalizeSettlementDays(
      patch.redemptionSettlementDays,
      current?.redemptionSettlementDays ?? normalized.defaultRedemptionSettlementDays,
    ),
  };
  return {
    ...normalized,
    feeOverrides: [...normalized.feeOverrides.filter((item) => item.symbol !== key), next],
  };
}

function normalizeOverride(value: Partial<FundFeeOverride> | null | undefined): FundFeeOverride | null {
  const symbol = symbolKey(value?.symbol ?? "");
  if (!symbol) return null;
  return {
    symbol,
    buyFeeRate: normalizeRate(value?.buyFeeRate, DEFAULT_FUND_EXECUTION_POLICY.defaultBuyFeeRate),
    sellFeeRate: normalizeRate(value?.sellFeeRate, DEFAULT_FUND_EXECUTION_POLICY.defaultSellFeeRate),
    redemptionSettlementDays: normalizeSettlementDays(
      value?.redemptionSettlementDays,
      DEFAULT_FUND_EXECUTION_POLICY.defaultRedemptionSettlementDays,
    ),
  };
}

function normalizeSettlementDays(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(10, Math.max(1, Math.round(value)))
    : fallback;
}

function tradingDateAfter(date: string, tradingDays: number) {
  let current = date;
  for (let day = 0; day < tradingDays; day += 1) current = nextChinaTradingDay(current);
  return current;
}

function normalizeRate(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(0.1, Math.max(0, value))
    : fallback;
}

function normalizeCutoff(value: unknown) {
  return typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)
    ? value
    : DEFAULT_FUND_EXECUTION_POLICY.cutoffTime;
}

function normalizeDate(value: string) {
  const match = value.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (!match) return new Date().toISOString().slice(0, 10);
  return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
}

function chinaDateTime(value: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "00";
  return {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    time: `${part("hour")}:${part("minute")}`,
  };
}

function symbolKey(value: string) {
  return value.trim().toUpperCase();
}
