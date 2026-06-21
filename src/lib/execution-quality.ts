import type { HoldingRecord } from "./holdings";
import type { OrderIntent } from "./strategy-engine";
import type { MarketAnalysisReport, TechnicalRow } from "./types";
import { formatNumber, formatPercent } from "./utils";

export type ExecutionInstrumentKind = "fund" | "etf" | "leveraged-etf" | "stock" | "cash" | "other";
export type ExecutionQualitySeverity = "pass" | "warn" | "block";
export type ExecutionSessionStatus = "open" | "closed" | "unknown";

export type ExecutionQuote = {
  asOf?: string;
  ask?: number | null;
  bid?: number | null;
  indicativeNav?: number | null;
  last?: number | null;
  nav?: number | null;
  premiumDiscountPct?: number | null;
  session?: ExecutionSessionStatus;
  source?: string;
  tradableVolume?: number | null;
};

export type ExecutionQualityCheck = {
  key: string;
  label: string;
  severity: ExecutionQualitySeverity;
  detail: string;
  overridable?: boolean;
};

export type ExecutionQualityAssessment = {
  checks: ExecutionQualityCheck[];
  limitHint: string;
  quantityHint: string;
  quoteReady: boolean;
  sessionLabel: string;
  summary: string;
};

export type ExecutionQualityInput = {
  holding?: HoldingRecord;
  instrumentKind: ExecutionInstrumentKind;
  orderIntent: OrderIntent;
  quote?: ExecutionQuote | null;
  report: MarketAnalysisReport;
  side: string;
  technical?: TechnicalRow;
  now?: Date;
};

const ETF_WARN_SPREAD_BPS = 35;
const ETF_BLOCK_SPREAD_BPS = 100;
const ETF_WARN_PREMIUM_PCT = 0.8;
const ETF_BLOCK_PREMIUM_PCT = 2;
const ETF_WARN_VOLUME_RATIO = 0.65;
const ETF_BLOCK_VOLUME_RATIO = 0.35;

export function evaluateExecutionQuality({
  holding,
  instrumentKind,
  orderIntent,
  quote,
  report,
  side,
  technical,
  now = new Date(),
}: ExecutionQualityInput): ExecutionQualityAssessment {
  const market = normalizeMarket(holding?.market || report.profileMarket);
  const session = quote?.session
    ? { status: quote.session, label: quote.session === "open" ? "broker 回报开盘" : quote.session === "closed" ? "broker 回报休市" : "broker 时段未知" }
    : sessionForMarket(market, now);
  const checks: ExecutionQualityCheck[] = [];

  if (instrumentKind === "fund") {
    checks.push(...fundExecutionChecks(report));
    return {
      checks,
      limitHint: "下一净值",
      quantityHint: "份额按渠道确认",
      quoteReady: false,
      sessionLabel: "净值确认",
      summary: firstNonPass(checks)?.detail ?? "基金按下一净值/渠道确认执行。",
    };
  }

  if (instrumentKind === "etf" || instrumentKind === "leveraged-etf") {
    checks.push(sessionCheck(session, market, true));
    checks.push(...etfQuoteChecks({ instrumentKind, orderIntent, quote, side, technical }));
    checks.push(protectedLimitCheck(instrumentKind, quote));
    return {
      checks,
      limitHint: "限价保护",
      quantityHint: "按限价折算",
      quoteReady: Boolean(quote?.bid && quote?.ask),
      sessionLabel: session.label,
      summary: firstNonPass(checks)?.detail ?? "ETF 执行质量通过。",
    };
  }

  if (instrumentKind === "stock") {
    checks.push(sessionCheck(session, market, false));
    checks.push({
      key: "stock.limit",
      label: "价格保护",
      severity: "pass",
      detail: "股票委托默认使用限价保护。",
    });
    return {
      checks,
      limitHint: "限价保护",
      quantityHint: "按限价折算",
      quoteReady: Boolean(quote?.bid && quote?.ask),
      sessionLabel: session.label,
      summary: firstNonPass(checks)?.detail ?? "股票执行保护通过。",
    };
  }

  return {
    checks: [{
      key: "execution.generic",
      label: "执行质量",
      severity: "warn",
      detail: `${orderIntent.symbol} 缺少可识别的执行质量规则，按限价保护处理。`,
    }],
    limitHint: "限价保护",
    quantityHint: "按限价折算",
    quoteReady: false,
    sessionLabel: "未知",
    summary: "缺少专属执行质量规则。",
  };
}

function fundExecutionChecks(report: MarketAnalysisReport): ExecutionQualityCheck[] {
  const checks: ExecutionQualityCheck[] = [];
  const fund = report.profileFund;
  const ageDays = fund?.holdingsAgeDays;
  if (typeof ageDays === "number" && ageDays > 180) {
    checks.push({
      key: "fund.freshness.block",
      label: "基金披露",
      severity: "block",
      detail: `基金持仓披露已 ${ageDays} 天，先更新资料再交易。`,
      overridable: true,
    });
  } else if (typeof ageDays === "number" && ageDays > 120) {
    checks.push({
      key: "fund.freshness.warn",
      label: "基金披露",
      severity: "warn",
      detail: `基金持仓披露已 ${ageDays} 天，建议小额或等待更新。`,
    });
  } else {
    checks.push({
      key: "fund.execution.nav",
      label: "基金交易",
      severity: "pass",
      detail: "按下一净值/渠道确认执行。",
    });
  }
  checks.push({
    key: "fund.intraday.skip",
    label: "盘中价格",
    severity: "pass",
    detail: "基金不使用 ETF 盘中价差/NAV 执行规则。",
  });
  return checks;
}

function etfQuoteChecks({
  instrumentKind,
  orderIntent,
  quote,
  side,
  technical,
}: {
  instrumentKind: ExecutionInstrumentKind;
  orderIntent: OrderIntent;
  quote?: ExecutionQuote | null;
  side: string;
  technical?: TechnicalRow;
}): ExecutionQualityCheck[] {
  const checks: ExecutionQualityCheck[] = [];
  const spreadBps = spreadBpsFor(quote);
  if (spreadBps == null) {
    checks.push({
      key: "etf.spread.missing",
      label: "ETF 价差",
      severity: "warn",
      detail: "缺少 bid/ask，真实提交前只允许限价保护。",
    });
  } else if (spreadBps < 0) {
    checks.push({
      key: "etf.spread.invalid",
      label: "ETF 价差",
      severity: "block",
      detail: "盘口 bid/ask 异常，暂停提交。",
      overridable: false,
    });
  } else if (spreadBps > ETF_BLOCK_SPREAD_BPS) {
    checks.push({
      key: "etf.spread.block",
      label: "ETF 价差",
      severity: "block",
      detail: `买卖价差 ${formatNumber(spreadBps, 0)} bps 过宽，暂停提交。`,
    });
  } else if (spreadBps > ETF_WARN_SPREAD_BPS) {
    checks.push({
      key: "etf.spread.warn",
      label: "ETF 价差",
      severity: "warn",
      detail: `买卖价差 ${formatNumber(spreadBps, 0)} bps 偏宽，限价小单。`,
    });
  } else {
    checks.push({
      key: "etf.spread.pass",
      label: "ETF 价差",
      severity: "pass",
      detail: `价差 ${formatNumber(spreadBps, 0)} bps。`,
    });
  }

  const premium = premiumDiscountPctFor(quote);
  if (premium == null) {
    checks.push({
      key: "etf.nav.missing",
      label: "ETF 折溢价",
      severity: "warn",
      detail: "缺少 NAV/iNAV，暂按价格保护执行。",
    });
  } else if (Math.abs(premium) > ETF_BLOCK_PREMIUM_PCT && isBuy(side)) {
    checks.push({
      key: "etf.nav.block",
      label: "ETF 折溢价",
      severity: "block",
      detail: `折溢价 ${formatPercent(premium)} 过大，买入暂停。`,
    });
  } else if (Math.abs(premium) > ETF_WARN_PREMIUM_PCT) {
    checks.push({
      key: "etf.nav.warn",
      label: "ETF 折溢价",
      severity: "warn",
      detail: `折溢价 ${formatPercent(premium)} 偏离，降低委托。`,
    });
  } else {
    checks.push({
      key: "etf.nav.pass",
      label: "ETF 折溢价",
      severity: "pass",
      detail: `折溢价 ${formatPercent(premium)}。`,
    });
  }

  const volumeRatio = technical?.volumeRatio ?? null;
  if (typeof volumeRatio !== "number") {
    checks.push({
      key: "etf.volume.missing",
      label: "ETF 流动性",
      severity: "warn",
      detail: "缺少量能数据，限价小单。",
    });
  } else if (volumeRatio < ETF_BLOCK_VOLUME_RATIO && isBuy(side)) {
    checks.push({
      key: "etf.volume.block",
      label: "ETF 流动性",
      severity: "block",
      detail: `量能比 ${formatNumber(volumeRatio, 2)} 偏低，买入先等待。`,
    });
  } else if (volumeRatio < ETF_WARN_VOLUME_RATIO) {
    checks.push({
      key: "etf.volume.warn",
      label: "ETF 流动性",
      severity: "warn",
      detail: `量能比 ${formatNumber(volumeRatio, 2)} 偏弱，限价小单。`,
    });
  } else {
    checks.push({
      key: "etf.volume.pass",
      label: "ETF 流动性",
      severity: "pass",
      detail: "量能未触发限制。",
    });
  }

  if (instrumentKind === "leveraged-etf" && isBuy(side)) {
    checks.push({
      key: "etf.leveraged",
      label: "杠杆/反向 ETF",
      severity: "warn",
      detail: `${orderIntent.symbol} 按高风险 ETF 处理，单笔预算限制更低。`,
    });
  }
  return checks;
}

function protectedLimitCheck(kind: ExecutionInstrumentKind, quote?: ExecutionQuote | null): ExecutionQualityCheck {
  const detail = quote?.bid && quote?.ask
    ? "使用 bid/ask 约束限价，避免无保护市价。"
    : "缺少实时盘口时，委托只进入预备队列，真实提交前需 broker 回填价格。";
  return {
    key: `${kind}.limit-protection`,
    label: "限价保护",
    severity: "pass",
    detail,
  };
}

function sessionCheck(
  session: { status: ExecutionSessionStatus; label: string },
  market: string,
  strict: boolean,
): ExecutionQualityCheck {
  if (session.status === "open") {
    return {
      key: "session.open",
      label: "交易时段",
      severity: "pass",
      detail: `${session.label} · 可提交限价单。`,
    };
  }
  if (session.status === "closed") {
    return {
      key: "session.closed",
      label: "交易时段",
      severity: strict ? "warn" : "warn",
      detail: `${session.label} · 先进入预备队列，开盘后再提交。`,
    };
  }
  return {
    key: "session.unknown",
    label: "交易时段",
    severity: "warn",
    detail: `${market || "未知市场"} 时段未知，真实提交前需要 broker 确认。`,
  };
}

function sessionForMarket(market: string, now: Date): { status: ExecutionSessionStatus; label: string } {
  const day = now.getUTCDay();
  if (day === 0 || day === 6) return { status: "closed", label: "周末休市" };
  const minute = now.getUTCHours() * 60 + now.getUTCMinutes();
  if (market === "cn") {
    return inWindows(minute, [[90, 210], [300, 420]])
      ? { status: "open", label: "A 股连续竞价估算" }
      : { status: "closed", label: "A 股非连续竞价时段" };
  }
  if (market === "hk") {
    return inWindows(minute, [[90, 240], [300, 480]])
      ? { status: "open", label: "港股连续竞价估算" }
      : { status: "closed", label: "港股非连续竞价时段" };
  }
  if (market === "us") {
    return inWindows(minute, [[810, 1200]])
      ? { status: "open", label: "美股常规交易时段估算" }
      : { status: "closed", label: "美股非常规交易时段" };
  }
  if (market === "kr") {
    return inWindows(minute, [[0, 390]])
      ? { status: "open", label: "韩股连续竞价估算" }
      : { status: "closed", label: "韩股非连续竞价时段" };
  }
  return { status: "unknown", label: "未知交易时段" };
}

function inWindows(minute: number, windows: Array<[number, number]>) {
  return windows.some(([start, end]) => minute >= start && minute <= end);
}

function spreadBpsFor(quote?: ExecutionQuote | null) {
  const bid = quote?.bid;
  const ask = quote?.ask;
  if (typeof bid !== "number" || typeof ask !== "number") return null;
  const mid = (bid + ask) / 2;
  if (mid <= 0 || bid <= 0 || ask <= 0 || ask < bid) return -1;
  return ((ask - bid) / mid) * 10_000;
}

function premiumDiscountPctFor(quote?: ExecutionQuote | null) {
  if (typeof quote?.premiumDiscountPct === "number") return quote.premiumDiscountPct;
  const nav = quote?.indicativeNav ?? quote?.nav;
  const price = quote?.last ?? midpoint(quote);
  if (typeof nav !== "number" || typeof price !== "number" || nav <= 0) return null;
  return (price / nav - 1) * 100;
}

function midpoint(quote?: ExecutionQuote | null) {
  if (typeof quote?.bid === "number" && typeof quote.ask === "number") {
    return (quote.bid + quote.ask) / 2;
  }
  return null;
}

function firstNonPass(checks: ExecutionQualityCheck[]) {
  return checks.find((check) => check.severity === "block")
    ?? checks.find((check) => check.severity === "warn");
}

function normalizeMarket(value: string | undefined) {
  const text = String(value || "").trim().toLowerCase();
  if (text === "us" || text.includes("美")) return "us";
  if (text === "cn" || text.includes("a股") || text.includes("china")) return "cn";
  if (text === "hk" || text.includes("港")) return "hk";
  if (text === "kr" || text.includes("korea") || text.includes("韩")) return "kr";
  return text || "unknown";
}

function isBuy(side: string) {
  return side.trim().toUpperCase() !== "SELL";
}
