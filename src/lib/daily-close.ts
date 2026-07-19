import type { AccountRecord } from "./accounts";
import { isSampleDataReport } from "./data-quality";
import type { HoldingRecord } from "./holdings";
import type { PerformanceLedger } from "./performance-ledger";
import type { PortfolioValuationSettings } from "./portfolio-valuation";
import type { PositionPlan } from "./position-plan";

export type DailyCloseSeverity = "pass" | "warning" | "block";

export type DailyCloseCheck = {
  key: string;
  label: string;
  severity: DailyCloseSeverity;
  detail: string;
};

export type DailyCloseReadiness = {
  date: string;
  canCapture: boolean;
  alreadyCaptured: boolean;
  status: "ready" | "warning" | "blocked" | "captured";
  label: string;
  detail: string;
  blockingCount: number;
  warningCount: number;
  checks: DailyCloseCheck[];
};

type DailyCloseReport = {
  asOf: string;
  providerNote?: string;
  source: string;
  sourceLabel?: string;
  backtest: {
    benchmarkClose: number;
    benchmarkSymbol: string;
  };
};

export function buildDailyCloseReadiness(input: {
  accounts: AccountRecord[];
  date: string;
  holdings: HoldingRecord[];
  ledger: PerformanceLedger;
  positionPlan: PositionPlan;
  report: DailyCloseReport | null | undefined;
  reportIsCurrent: boolean;
  valuation: PortfolioValuationSettings;
}): DailyCloseReadiness {
  const checks: DailyCloseCheck[] = [];
  const date = input.date;
  checks.push(isDateKey(date)
    ? pass("date", "日结日期", date)
    : block("date", "日结日期", "请选择有效的 YYYY-MM-DD 日期。"));

  if (input.positionPlan.totalValue <= 0 || !input.positionPlan.valuation.canCalculate) {
    checks.push(block("valuation", "组合估值", input.positionPlan.valuation.detail || "当前组合无法估值。"));
  } else {
    checks.push(pass("valuation", "组合估值", `${input.positionPlan.currency} ${formatNumber(input.positionPlan.totalValue)}`));
  }

  const riskHoldings = input.holdings.filter((holding) => holding.role === "real" && holding.assetType !== "cash");
  const missingQuoteDates = riskHoldings.filter((holding) => !holdingQuoteDate(holding));
  const misalignedQuotes = riskHoldings.filter((holding) => holdingQuoteDate(holding) && holdingQuoteDate(holding) !== date);
  if (missingQuoteDates.length) {
    checks.push(block("quotes", "持仓价格", `${symbols(missingQuoteDates)} 缺少价格日期。`));
  } else if (misalignedQuotes.length) {
    checks.push(block("quotes", "持仓价格", `${symbols(misalignedQuotes)} 未对齐 ${date}。`));
  } else {
    checks.push(pass("quotes", "持仓价格", riskHoldings.length ? `${riskHoldings.length} 个风险持仓已对齐。` : "无风险持仓。"));
  }

  const activeAccounts = input.accounts.filter((account) => account.status === "active");
  if (!activeAccounts.length) {
    checks.push(warning("accounts", "账户余额", "尚未建立活跃账户，现金来源需要人工复核。"));
  } else {
    const pending = activeAccounts.filter((account) => Math.abs(account.pendingSettlement) > 0.000001);
    const staleSynced = activeAccounts.filter((account) =>
      account.source !== "manual" && timestampDate(account.syncedAt || account.updatedAt) !== date
    );
    const manual = activeAccounts.filter((account) => account.source === "manual");
    if (pending.length) {
      checks.push(block("accounts", "账户余额", `${accountNames(pending)} 存在待交收，当前总值口径不完整。`));
    } else if (staleSynced.length) {
      checks.push(block("accounts", "账户余额", `${accountNames(staleSynced)} 未同步到 ${date}。`));
    } else if (manual.length) {
      checks.push(warning("accounts", "账户余额", `${manual.length} 个手工账户需要人工确认日末余额。`));
    } else {
      checks.push(pass("accounts", "账户余额", `${activeAccounts.length} 个账户已对齐。`));
    }
  }

  const currencies = new Set([
    ...riskHoldings.map((holding) => holding.currency),
    ...activeAccounts.map((account) => account.currency),
  ]);
  const requiresFx = [...currencies].some((currency) => currency !== input.valuation.baseCurrency);
  if (requiresFx && (!input.valuation.usdCnyRate || input.valuation.fxAsOf !== date)) {
    checks.push(block("fx", "USD/CNY", `跨币种日结需要 ${date} 的 USD/CNY 汇率。`));
  } else {
    checks.push(pass("fx", "USD/CNY", requiresFx ? `${input.valuation.usdCnyRate} · ${input.valuation.fxAsOf}` : "组合无需换汇。"));
  }

  if (!input.report || !input.reportIsCurrent || input.report.asOf !== date) {
    checks.push(block("benchmark", "日结基准", `缺少 ${date} 的当前 Profile 基准。`));
  } else if (isSampleDataReport({
    providerNote: input.report.providerNote ?? "",
    source: input.report.source,
    sourceLabel: input.report.sourceLabel ?? "",
  })) {
    checks.push(block("benchmark", "日结基准", "示例数据不能写入真实业绩账本。"));
  } else if (!(input.report.backtest.benchmarkClose > 0) || !input.report.backtest.benchmarkSymbol) {
    checks.push(block("benchmark", "日结基准", "基准代码或收盘值无效。"));
  } else {
    checks.push(pass("benchmark", "日结基准", `${input.report.backtest.benchmarkSymbol} ${formatNumber(input.report.backtest.benchmarkClose)}`));
  }

  const alreadyCaptured = input.ledger.snapshots.some((snapshot) => snapshot.date === date);
  const blockingCount = checks.filter((check) => check.severity === "block").length;
  const warningCount = checks.filter((check) => check.severity === "warning").length;
  const canCapture = blockingCount === 0;
  const status = alreadyCaptured && canCapture ? "captured" : !canCapture ? "blocked" : warningCount ? "warning" : "ready";
  return {
    date,
    canCapture,
    alreadyCaptured,
    status,
    label: status === "captured" ? "日结已记录" : status === "ready" ? "日结就绪" : status === "warning" ? "人工确认后可日结" : "日结阻断",
    detail: blockingCount
      ? `${blockingCount} 项输入未对齐，不能写入真实业绩账本。`
      : warningCount
        ? `${warningCount} 项需要人工确认。`
        : alreadyCaptured ? "当日快照可在输入更新后覆盖。" : "账户、价格、汇率与基准已对齐。",
    blockingCount,
    warningCount,
    checks,
  };
}

function holdingQuoteDate(holding: HoldingRecord) {
  return holding.quoteAsOf || holding.confirmedNavAsOf || "";
}

function timestampDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : "";
}

function symbols(holdings: HoldingRecord[]) {
  return holdings.slice(0, 4).map((holding) => holding.symbol).join("、");
}

function accountNames(accounts: AccountRecord[]) {
  return accounts.slice(0, 3).map((account) => account.name).join("、");
}

function pass(key: string, label: string, detail: string): DailyCloseCheck {
  return { key, label, severity: "pass", detail };
}

function warning(key: string, label: string, detail: string): DailyCloseCheck {
  return { key, label, severity: "warning", detail };
}

function block(key: string, label: string, detail: string): DailyCloseCheck {
  return { key, label, severity: "block", detail };
}

function isDateKey(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`));
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 4 }).format(value);
}
