import type { HoldingRecord } from "./holdings";

export type SupportedCurrency = "CNY" | "USD";
export type FxRateSource = "manual" | "provider" | "import";

export type PortfolioValuationSettings = {
  baseCurrency: SupportedCurrency;
  usdCnyRate: number | null;
  fxAsOf: string;
  fxSource: FxRateSource;
};

export type PortfolioValuationSeverity = "pass" | "warn" | "block";

export type PortfolioValuationCheck = {
  key: string;
  label: string;
  severity: PortfolioValuationSeverity;
  detail: string;
};

export type PortfolioValuationAssessment = {
  canCalculate: boolean;
  checks: PortfolioValuationCheck[];
  detail: string;
  label: string;
  requiresFx: boolean;
  riskIncreaseAllowed: boolean;
  riskReductionAllowed: boolean;
  severity: PortfolioValuationSeverity;
  settings: PortfolioValuationSettings;
};

export const DEFAULT_PORTFOLIO_VALUATION_SETTINGS: PortfolioValuationSettings = {
  baseCurrency: "CNY",
  usdCnyRate: null,
  fxAsOf: "",
  fxSource: "manual",
};

export function normalizePortfolioValuationSettings(
  value: Partial<PortfolioValuationSettings> | null | undefined,
): PortfolioValuationSettings {
  const rate = Number(value?.usdCnyRate);
  return {
    baseCurrency: value?.baseCurrency === "USD" ? "USD" : "CNY",
    usdCnyRate: Number.isFinite(rate) && rate > 0 ? rate : null,
    fxAsOf: isDateKey(value?.fxAsOf) ? String(value?.fxAsOf) : "",
    fxSource: value?.fxSource === "provider" || value?.fxSource === "import" ? value.fxSource : "manual",
  };
}

export function assessPortfolioValuation(
  holdings: HoldingRecord[],
  value: Partial<PortfolioValuationSettings> | null | undefined,
  now = new Date(),
): PortfolioValuationAssessment {
  const settings = normalizePortfolioValuationSettings(value);
  const realHoldings = holdings.filter((holding) => holding.role === "real");
  const unsupported = Array.from(new Set(
    realHoldings
      .map((holding) => normalizeCurrency(holding.currency))
      .filter((currency) => !isSupportedCurrency(currency)),
  ));
  const requiresFx = realHoldings.some(
    (holding) => isSupportedCurrency(normalizeCurrency(holding.currency))
      && normalizeCurrency(holding.currency) !== settings.baseCurrency,
  );
  const checks: PortfolioValuationCheck[] = [];

  if (unsupported.length) {
    checks.push({
      key: "currency.unsupported",
      label: "组合币种",
      severity: "block",
      detail: `当前版本只支持人民币和美元，暂不支持：${unsupported.join(" / ")}。`,
    });
  } else {
    checks.push({
      key: "currency.supported",
      label: "组合币种",
      severity: "pass",
      detail: `统一按 ${settings.baseCurrency} 计算组合权重。`,
    });
  }

  if (requiresFx && !settings.usdCnyRate) {
    checks.push({
      key: "fx.missing",
      label: "美元兑人民币",
      severity: "block",
      detail: "组合同时包含人民币和美元资产，需要先填写 USD/CNY 汇率。",
    });
  } else if (requiresFx) {
    checks.push(freshnessCheck({
      asOf: settings.fxAsOf,
      key: "fx",
      label: "美元兑人民币",
      missingDetail: `当前汇率 ${settings.usdCnyRate} 缺少日期，只允许降低风险。`,
      staleDetail: `当前汇率 ${settings.usdCnyRate}`,
      now,
    }));
  }

  const datedRiskHoldings = realHoldings.filter((holding) => !isCashLike(holding));
  const missingQuoteDates = datedRiskHoldings.filter((holding) => !holdingQuoteAsOf(holding));
  if (missingQuoteDates.length) {
    checks.push({
      key: "quote.date.missing",
      label: "持仓价格",
      severity: "warn",
      detail: `${missingQuoteDates.slice(0, 3).map((holding) => holding.symbol).join(" / ")} 缺少价格日期，只允许降低风险。`,
    });
  }

  const staleQuotes = datedRiskHoldings
    .map((holding) => ({ holding, age: ageInCalendarDays(holdingQuoteAsOf(holding), now) }))
    .filter((item) => item.age !== null && item.age > 3);
  const blockedQuotes = staleQuotes.filter((item) => (item.age ?? 0) > 7);
  if (blockedQuotes.length) {
    checks.push({
      key: "quote.date.stale.block",
      label: "持仓价格",
      severity: "block",
      detail: `${blockedQuotes.slice(0, 3).map(({ holding, age }) => `${holding.symbol} ${age}天`).join(" / ")}，价格已过期。`,
    });
  } else if (staleQuotes.length) {
    checks.push({
      key: "quote.date.stale.warn",
      label: "持仓价格",
      severity: "warn",
      detail: `${staleQuotes.slice(0, 3).map(({ holding, age }) => `${holding.symbol} ${age}天`).join(" / ")}，新增风险前需要复核。`,
    });
  } else if (datedRiskHoldings.length && !missingQuoteDates.length) {
    checks.push({
      key: "quote.date.fresh",
      label: "持仓价格",
      severity: "pass",
      detail: `${datedRiskHoldings.length} 个风险资产的价格日期完整。`,
    });
  }

  const blocks = checks.filter((check) => check.severity === "block");
  const warnings = checks.filter((check) => check.severity === "warn");
  const severity: PortfolioValuationSeverity = blocks.length ? "block" : warnings.length ? "warn" : "pass";
  const canCalculate = !checks.some((check) => check.key === "currency.unsupported" || check.key === "fx.missing");
  const firstIssue = blocks[0] ?? warnings[0];

  return {
    canCalculate,
    checks,
    detail: firstIssue?.detail ?? `组合已按 ${settings.baseCurrency} 完成双币种估值。`,
    label: severity === "block" ? "估值阻断" : severity === "warn" ? "估值待确认" : "估值可信",
    requiresFx,
    riskIncreaseAllowed: canCalculate && severity === "pass",
    riskReductionAllowed: canCalculate,
    severity,
    settings,
  };
}

export function convertCurrency(
  amount: number,
  from: string,
  to: string,
  value: Partial<PortfolioValuationSettings> | null | undefined,
): number | null {
  if (!Number.isFinite(amount)) return null;
  const source = normalizeCurrency(from);
  const target = normalizeCurrency(to);
  if (!isSupportedCurrency(source) || !isSupportedCurrency(target)) return null;
  if (source === target) return amount;
  const settings = normalizePortfolioValuationSettings(value);
  if (!settings.usdCnyRate) return null;
  return source === "USD" ? amount * settings.usdCnyRate : amount / settings.usdCnyRate;
}

export function holdingMarketValueInBase(
  holding: HoldingRecord,
  value: Partial<PortfolioValuationSettings> | null | undefined,
): number | null {
  const settings = normalizePortfolioValuationSettings(value);
  return convertCurrency(holding.quantity * holding.currentPrice, holding.currency, settings.baseCurrency, settings);
}

export function holdingCostValueInBase(
  holding: HoldingRecord,
  value: Partial<PortfolioValuationSettings> | null | undefined,
): number | null {
  const settings = normalizePortfolioValuationSettings(value);
  return convertCurrency(holding.quantity * holding.costPrice, holding.currency, settings.baseCurrency, settings);
}

export function isSupportedCurrency(value: string): value is SupportedCurrency {
  return value === "CNY" || value === "USD";
}

function freshnessCheck({
  asOf,
  key,
  label,
  missingDetail,
  staleDetail,
  now,
}: {
  asOf: string;
  key: string;
  label: string;
  missingDetail: string;
  staleDetail: string;
  now: Date;
}): PortfolioValuationCheck {
  const age = ageInCalendarDays(asOf, now);
  if (age === null) {
    return { key: `${key}.date.missing`, label, severity: "warn", detail: missingDetail };
  }
  if (age > 7) {
    return { key: `${key}.date.stale.block`, label, severity: "block", detail: `${staleDetail} 已过期 ${age} 天。` };
  }
  if (age > 3) {
    return { key: `${key}.date.stale.warn`, label, severity: "warn", detail: `${staleDetail} 已过去 ${age} 天。` };
  }
  return { key: `${key}.date.fresh`, label, severity: "pass", detail: `${staleDetail}，日期 ${asOf}。` };
}

function holdingQuoteAsOf(holding: HoldingRecord) {
  return holding.quoteAsOf || holding.confirmedNavAsOf || "";
}

function ageInCalendarDays(value: string, now: Date) {
  if (!isDateKey(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return Math.max(0, Math.floor((today.getTime() - date.getTime()) / 86_400_000));
}

function isDateKey(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function normalizeCurrency(value: string) {
  return String(value || "").trim().toUpperCase();
}

function isCashLike(holding: HoldingRecord) {
  if (holding.assetType === "cash") return true;
  return /(^CASH$|现金|货币|货基|MONEY|MMF)/u.test(`${holding.symbol} ${holding.name}`.toUpperCase());
}
