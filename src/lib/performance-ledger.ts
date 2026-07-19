import type { HoldingRecord } from "./holdings";
import {
  convertCurrency,
  isSupportedCurrency,
  normalizePortfolioValuationSettings,
  type PortfolioValuationSettings,
  type SupportedCurrency,
} from "./portfolio-valuation";
import type { TradeRecord } from "./trades";

export const PERFORMANCE_LEDGER_VERSION = 1;

export type PerformanceSnapshotSource = "portfolio" | "manual" | "import";
export type ExternalCashFlowKind = "deposit" | "withdrawal";

export type PerformanceSnapshot = {
  id: string;
  date: string;
  capturedAt: string;
  baseCurrency: SupportedCurrency;
  portfolioValue: number;
  benchmarkSymbol: string;
  benchmarkLevel: number | null;
  cumulativeFees: number;
  cnyExposureValue: number;
  usdExposureValue: number;
  usdCnyRate: number | null;
  source: PerformanceSnapshotSource;
  note: string;
};

export type ExternalCashFlow = {
  id: string;
  date: string;
  capturedAt: string;
  accountId: string;
  kind: ExternalCashFlowKind;
  amount: number;
  currency: SupportedCurrency;
  baseAmount: number;
  baseCurrency: SupportedCurrency;
  usdCnyRate: number | null;
  note: string;
};

export type PerformanceLedger = {
  version: typeof PERFORMANCE_LEDGER_VERSION;
  updatedAt: string;
  snapshots: PerformanceSnapshot[];
  cashFlows: ExternalCashFlow[];
};

export type PortfolioAttributionSummary = {
  ready: boolean;
  issue: string;
  baseCurrency: SupportedCurrency;
  startDate: string;
  endDate: string;
  periodDays: number;
  snapshotCount: number;
  cashFlowCount: number;
  netExternalFlow: number;
  startValue: number;
  endValue: number;
  twrPct: number | null;
  mwrAnnualizedPct: number | null;
  grossTwrPct: number | null;
  feeDragPct: number | null;
  benchmarkReturnPct: number | null;
  excessReturnPct: number | null;
  fxContributionPct: number | null;
  selectionContributionPct: number | null;
};

export type CreatePortfolioSnapshotInput = {
  asOf: string;
  benchmarkLevel?: number | null;
  benchmarkSymbol?: string;
  holdings: HoldingRecord[];
  note?: string;
  portfolioValue: number;
  trades: TradeRecord[];
  valuation: PortfolioValuationSettings;
  now?: Date;
};

export function emptyPerformanceLedger(): PerformanceLedger {
  return {
    version: PERFORMANCE_LEDGER_VERSION,
    updatedAt: "",
    snapshots: [],
    cashFlows: [],
  };
}

export function createPortfolioSnapshot(input: CreatePortfolioSnapshotInput): PerformanceSnapshot {
  const now = input.now ?? new Date();
  const valuation = normalizePortfolioValuationSettings(input.valuation);
  const date = isDateKey(input.asOf) ? input.asOf : now.toISOString().slice(0, 10);
  const exposures = currencyExposures(input.holdings, valuation);
  const cumulativeFees = input.trades
    .filter((trade) => trade.tradeDate <= date)
    .reduce((total, trade) => {
      const converted = convertCurrency(Math.max(0, finiteNumber(trade.fee)), trade.currency, valuation.baseCurrency, valuation);
      return total + (converted ?? 0);
    }, 0);
  return {
    id: `performance-${date}`,
    date,
    capturedAt: now.toISOString(),
    baseCurrency: valuation.baseCurrency,
    portfolioValue: nonNegativeNumber(input.portfolioValue),
    benchmarkSymbol: cleanText(input.benchmarkSymbol),
    benchmarkLevel: positiveNumberOrNull(input.benchmarkLevel),
    cumulativeFees: roundMoney(cumulativeFees),
    cnyExposureValue: roundMoney(exposures.CNY),
    usdExposureValue: roundMoney(exposures.USD),
    usdCnyRate: positiveNumberOrNull(valuation.usdCnyRate),
    source: "portfolio",
    note: cleanText(input.note),
  };
}

export function createExternalCashFlow(input: {
  accountId?: string;
  amount: number;
  currency: SupportedCurrency;
  date: string;
  kind: ExternalCashFlowKind;
  note?: string;
  valuation: PortfolioValuationSettings;
  now?: Date;
}): ExternalCashFlow | null {
  const valuation = normalizePortfolioValuationSettings(input.valuation);
  const amount = nonNegativeNumber(input.amount);
  if (!amount || !isDateKey(input.date) || !isSupportedCurrency(input.currency)) return null;
  const converted = convertCurrency(amount, input.currency, valuation.baseCurrency, valuation);
  if (converted === null) return null;
  const now = input.now ?? new Date();
  return {
    id: `cash-flow-${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
    date: input.date,
    capturedAt: now.toISOString(),
    accountId: cleanText(input.accountId),
    kind: input.kind,
    amount,
    currency: input.currency,
    baseAmount: roundMoney(input.kind === "deposit" ? converted : -converted),
    baseCurrency: valuation.baseCurrency,
    usdCnyRate: positiveNumberOrNull(valuation.usdCnyRate),
    note: cleanText(input.note),
  };
}

export function upsertPerformanceSnapshot(
  ledger: PerformanceLedger,
  snapshot: PerformanceSnapshot,
): PerformanceLedger {
  const normalized = normalizePerformanceLedger(ledger);
  const snapshots = [snapshot, ...normalized.snapshots.filter((item) => item.date !== snapshot.date)]
    .sort(compareSnapshots);
  return {
    ...normalized,
    updatedAt: snapshot.capturedAt,
    snapshots,
  };
}

export function appendExternalCashFlow(
  ledger: PerformanceLedger,
  cashFlow: ExternalCashFlow,
): PerformanceLedger {
  const normalized = normalizePerformanceLedger(ledger);
  return {
    ...normalized,
    updatedAt: cashFlow.capturedAt,
    cashFlows: [cashFlow, ...normalized.cashFlows.filter((item) => item.id !== cashFlow.id)]
      .sort(compareCashFlows),
  };
}

export function removeExternalCashFlow(ledger: PerformanceLedger, id: string): PerformanceLedger {
  const normalized = normalizePerformanceLedger(ledger);
  return {
    ...normalized,
    updatedAt: new Date().toISOString(),
    cashFlows: normalized.cashFlows.filter((item) => item.id !== id),
  };
}

export function calculatePortfolioAttribution(value: PerformanceLedger): PortfolioAttributionSummary {
  const ledger = normalizePerformanceLedger(value);
  const snapshots = [...ledger.snapshots].sort((left, right) => left.date.localeCompare(right.date));
  const baseCurrency = snapshots[0]?.baseCurrency ?? "CNY";
  const base = emptySummary(baseCurrency, snapshots.length);
  if (snapshots.length < 2) {
    return { ...base, issue: "至少需要两个不同日期的估值快照。" };
  }
  if (snapshots.some((snapshot) => snapshot.baseCurrency !== baseCurrency)) {
    return { ...base, issue: "估值快照的本位币不一致，不能串联收益。" };
  }

  const first = snapshots[0];
  const last = snapshots[snapshots.length - 1];
  const cashFlows = ledger.cashFlows.filter((flow) =>
    flow.baseCurrency === baseCurrency && flow.date > first.date && flow.date <= last.date
  );
  let netGrowth = 1;
  let grossGrowth = 1;
  let fxContribution = 0;
  let twrCalculable = true;
  let fxCalculable = true;

  for (let index = 1; index < snapshots.length; index += 1) {
    const previous = snapshots[index - 1];
    const current = snapshots[index];
    if (previous.portfolioValue <= 0) {
      twrCalculable = false;
      continue;
    }
    const periodFlow = cashFlows
      .filter((flow) => flow.date > previous.date && flow.date <= current.date)
      .reduce((sum, flow) => sum + flow.baseAmount, 0);
    const netReturn = (current.portfolioValue - periodFlow) / previous.portfolioValue - 1;
    const feeDelta = Math.max(0, current.cumulativeFees - previous.cumulativeFees);
    const grossReturn = (current.portfolioValue - periodFlow + feeDelta) / previous.portfolioValue - 1;
    if (!Number.isFinite(netReturn) || !Number.isFinite(grossReturn)) {
      twrCalculable = false;
    } else {
      netGrowth *= 1 + netReturn;
      grossGrowth *= 1 + grossReturn;
    }

    const intervalFx = fxContributionForInterval(previous, current);
    if (intervalFx === null) {
      fxCalculable = false;
    } else {
      fxContribution += intervalFx;
    }
  }

  const twrPct = twrCalculable ? roundPercent((netGrowth - 1) * 100) : null;
  const grossTwrPct = twrCalculable ? roundPercent((grossGrowth - 1) * 100) : null;
  const benchmarkReturnPct = benchmarkReturnFor(snapshots);
  const excessReturnPct = twrPct !== null && benchmarkReturnPct !== null
    ? roundPercent(twrPct - benchmarkReturnPct)
    : null;
  const fxContributionPct = fxCalculable ? roundPercent(fxContribution * 100) : null;
  const periodDays = dayDistance(first.date, last.date);
  const netExternalFlow = roundMoney(cashFlows.reduce((sum, flow) => sum + flow.baseAmount, 0));

  return {
    ready: twrPct !== null,
    issue: twrPct === null ? "存在零值或无效估值区间，TWR 无法计算。" : "",
    baseCurrency,
    startDate: first.date,
    endDate: last.date,
    periodDays,
    snapshotCount: snapshots.length,
    cashFlowCount: cashFlows.length,
    netExternalFlow,
    startValue: first.portfolioValue,
    endValue: last.portfolioValue,
    twrPct,
    mwrAnnualizedPct: moneyWeightedReturn(first, last, cashFlows),
    grossTwrPct,
    feeDragPct: twrPct !== null && grossTwrPct !== null ? roundPercent(twrPct - grossTwrPct) : null,
    benchmarkReturnPct,
    excessReturnPct,
    fxContributionPct,
    selectionContributionPct: excessReturnPct !== null && fxContributionPct !== null
      ? roundPercent(excessReturnPct - fxContributionPct)
      : null,
  };
}

export function normalizePerformanceLedger(value: unknown): PerformanceLedger {
  if (!value || typeof value !== "object") return emptyPerformanceLedger();
  const candidate = value as Partial<PerformanceLedger>;
  const snapshots = Array.isArray(candidate.snapshots)
    ? candidate.snapshots.map(normalizeSnapshot).filter((item): item is PerformanceSnapshot => Boolean(item))
    : [];
  const cashFlows = Array.isArray(candidate.cashFlows)
    ? candidate.cashFlows.map(normalizeCashFlow).filter((item): item is ExternalCashFlow => Boolean(item))
    : [];
  return {
    version: PERFORMANCE_LEDGER_VERSION,
    updatedAt: cleanText(candidate.updatedAt),
    snapshots: deduplicateByDate(snapshots).sort(compareSnapshots),
    cashFlows: cashFlows.sort(compareCashFlows),
  };
}

function normalizeSnapshot(value: unknown): PerformanceSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<PerformanceSnapshot>;
  if (!isDateKey(item.date) || !isSupportedCurrency(String(item.baseCurrency)) || nonNegativeNumber(item.portfolioValue) <= 0) {
    return null;
  }
  return {
    id: cleanText(item.id) || `performance-${item.date}`,
    date: item.date,
    capturedAt: validIso(item.capturedAt) ? String(item.capturedAt) : `${item.date}T23:59:59.000Z`,
    baseCurrency: item.baseCurrency as SupportedCurrency,
    portfolioValue: nonNegativeNumber(item.portfolioValue),
    benchmarkSymbol: cleanText(item.benchmarkSymbol),
    benchmarkLevel: positiveNumberOrNull(item.benchmarkLevel),
    cumulativeFees: nonNegativeNumber(item.cumulativeFees),
    cnyExposureValue: nonNegativeNumber(item.cnyExposureValue),
    usdExposureValue: nonNegativeNumber(item.usdExposureValue),
    usdCnyRate: positiveNumberOrNull(item.usdCnyRate),
    source: item.source === "manual" || item.source === "import" ? item.source : "portfolio",
    note: cleanText(item.note),
  };
}

function normalizeCashFlow(value: unknown): ExternalCashFlow | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<ExternalCashFlow>;
  if (!cleanText(item.id) || !isDateKey(item.date) || !isSupportedCurrency(String(item.currency))
    || !isSupportedCurrency(String(item.baseCurrency)) || nonNegativeNumber(item.amount) <= 0
    || !Number.isFinite(item.baseAmount)) return null;
  return {
    id: cleanText(item.id),
    date: item.date,
    capturedAt: validIso(item.capturedAt) ? String(item.capturedAt) : `${item.date}T23:59:59.000Z`,
    accountId: cleanText(item.accountId),
    kind: item.kind === "withdrawal" ? "withdrawal" : "deposit",
    amount: nonNegativeNumber(item.amount),
    currency: item.currency as SupportedCurrency,
    baseAmount: item.kind === "withdrawal" ? -Math.abs(finiteNumber(item.baseAmount)) : Math.abs(finiteNumber(item.baseAmount)),
    baseCurrency: item.baseCurrency as SupportedCurrency,
    usdCnyRate: positiveNumberOrNull(item.usdCnyRate),
    note: cleanText(item.note),
  };
}

function currencyExposures(holdings: HoldingRecord[], valuation: PortfolioValuationSettings) {
  return holdings
    .filter((holding) => holding.role === "real" && isSupportedCurrency(holding.currency))
    .reduce<Record<SupportedCurrency, number>>((result, holding) => {
      const value = convertCurrency(
        nonNegativeNumber(holding.quantity) * nonNegativeNumber(holding.currentPrice),
        holding.currency,
        valuation.baseCurrency,
        valuation,
      );
      if (value !== null) result[holding.currency as SupportedCurrency] += value;
      return result;
    }, { CNY: 0, USD: 0 });
}

function benchmarkReturnFor(snapshots: PerformanceSnapshot[]) {
  const usable = snapshots.filter((snapshot) => snapshot.benchmarkLevel !== null && snapshot.benchmarkLevel > 0);
  if (usable.length !== snapshots.length) return null;
  const symbol = cleanText(usable[0].benchmarkSymbol);
  if (!symbol || usable.some((snapshot) => cleanText(snapshot.benchmarkSymbol) !== symbol)) return null;
  const first = usable[0].benchmarkLevel as number;
  const last = usable[usable.length - 1].benchmarkLevel as number;
  return roundPercent((last / first - 1) * 100);
}

function fxContributionForInterval(previous: PerformanceSnapshot, current: PerformanceSnapshot) {
  if (!previous.usdCnyRate || !current.usdCnyRate || previous.portfolioValue <= 0) return null;
  if (previous.baseCurrency === "CNY") {
    return (previous.usdExposureValue / previous.portfolioValue) * (current.usdCnyRate / previous.usdCnyRate - 1);
  }
  return (previous.cnyExposureValue / previous.portfolioValue) * (previous.usdCnyRate / current.usdCnyRate - 1);
}

function moneyWeightedReturn(
  first: PerformanceSnapshot,
  last: PerformanceSnapshot,
  cashFlows: ExternalCashFlow[],
) {
  const datedFlows = [
    { date: first.date, amount: -first.portfolioValue },
    ...cashFlows.map((flow) => ({ date: flow.date, amount: -flow.baseAmount })),
    { date: last.date, amount: last.portfolioValue },
  ];
  if (!datedFlows.some((flow) => flow.amount < 0) || !datedFlows.some((flow) => flow.amount > 0)) return null;
  const npv = (rate: number) => datedFlows.reduce((sum, flow) => {
    const years = dayDistance(first.date, flow.date) / 365;
    return sum + flow.amount / ((1 + rate) ** years);
  }, 0);
  let low = -0.9999;
  let high = 1;
  let lowValue = npv(low);
  let highValue = npv(high);
  while (Math.sign(lowValue) === Math.sign(highValue) && high < 1_000_000) {
    high *= 2;
    highValue = npv(high);
  }
  if (!Number.isFinite(lowValue) || !Number.isFinite(highValue) || Math.sign(lowValue) === Math.sign(highValue)) return null;
  for (let index = 0; index < 160; index += 1) {
    const middle = (low + high) / 2;
    const middleValue = npv(middle);
    if (Math.abs(middleValue) < 1e-9) return roundPercent(middle * 100);
    if (Math.sign(middleValue) === Math.sign(lowValue)) {
      low = middle;
      lowValue = middleValue;
    } else {
      high = middle;
      highValue = middleValue;
    }
  }
  return roundPercent(((low + high) / 2) * 100);
}

function emptySummary(baseCurrency: SupportedCurrency, snapshotCount: number): PortfolioAttributionSummary {
  return {
    ready: false,
    issue: "",
    baseCurrency,
    startDate: "",
    endDate: "",
    periodDays: 0,
    snapshotCount,
    cashFlowCount: 0,
    netExternalFlow: 0,
    startValue: 0,
    endValue: 0,
    twrPct: null,
    mwrAnnualizedPct: null,
    grossTwrPct: null,
    feeDragPct: null,
    benchmarkReturnPct: null,
    excessReturnPct: null,
    fxContributionPct: null,
    selectionContributionPct: null,
  };
}

function deduplicateByDate(snapshots: PerformanceSnapshot[]) {
  const byDate = new Map<string, PerformanceSnapshot>();
  snapshots.forEach((snapshot) => {
    const current = byDate.get(snapshot.date);
    if (!current || snapshot.capturedAt >= current.capturedAt) byDate.set(snapshot.date, snapshot);
  });
  return [...byDate.values()];
}

function compareSnapshots(left: PerformanceSnapshot, right: PerformanceSnapshot) {
  return right.date.localeCompare(left.date) || right.capturedAt.localeCompare(left.capturedAt);
}

function compareCashFlows(left: ExternalCashFlow, right: ExternalCashFlow) {
  return right.date.localeCompare(left.date) || right.capturedAt.localeCompare(left.capturedAt);
}

function dayDistance(start: string, end: string) {
  return Math.max(0, Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000));
}

function isDateKey(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function validIso(value: unknown) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function nonNegativeNumber(value: unknown) {
  return Math.max(0, finiteNumber(value));
}

function positiveNumberOrNull(value: unknown) {
  const parsed = finiteNumber(value);
  return parsed > 0 ? parsed : null;
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function roundPercent(value: number) {
  return Math.round(value * 10_000) / 10_000;
}
