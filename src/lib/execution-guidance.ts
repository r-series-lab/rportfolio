import type { PositionPlanAction } from "./position-plan";
import type { MarketAnalysisReport, TechnicalRow } from "./types";

export type ExecutionGuidance = {
  triggerCondition: string;
  limitPriceRange: string;
  invalidationCondition: string;
  reviewAt: string;
};

export function executionGuidanceFor({
  action,
  currentPrice,
  report,
  side,
}: {
  action: PositionPlanAction | null;
  currentPrice: number | null;
  report: MarketAnalysisReport | null;
  side: string | null;
}): ExecutionGuidance {
  const technical = action && report ? technicalFor(action.symbol, report) : null;
  const price = positiveNumber(currentPrice) ?? positiveNumber(technical?.close);
  const normalizedSide = side?.trim().toUpperCase() ?? "";
  const reviewAt = nextWeekdayReview(report?.asOf, 5);

  if (!action || !normalizedSide) {
    return {
      triggerCondition: "先从建议账本选择一条可建票建议",
      limitPriceRange: "—",
      invalidationCondition: "没有选中建议，不生成交易票",
      reviewAt,
    };
  }

  if (normalizedSide === "SELL") {
    return {
      triggerCondition: action.weightDelta < 0
        ? `当前已触发：${action.reason}`
        : technical?.ma50
          ? `收盘跌破 MA50 ${formatPrice(technical.ma50)}`
          : action.reason,
      limitPriceRange: priceRange(price, "SELL"),
      invalidationCondition: `仓位降回 ${action.targetBandLabel} 后停止减仓`,
      reviewAt,
    };
  }

  const ma20 = positiveNumber(technical?.ma20);
  const ma50 = positiveNumber(technical?.ma50);
  const triggerCondition = ma20
    ? price && price < ma20
      ? `收盘重新站上 MA20 ${formatPrice(ma20)}`
      : `回踩 MA20 ${formatPrice(ma20)} 不破，且风险门保持通过`
    : "风险门通过且信号质量不低于 65";
  const invalidationCondition = ma50
    ? `收盘跌破 MA50 ${formatPrice(ma50)}`
    : price
      ? `价格跌破 ${formatPrice(price * 0.93)}`
      : "风险门转为阻断或数据过期";

  return {
    triggerCondition,
    limitPriceRange: priceRange(price, "BUY"),
    invalidationCondition,
    reviewAt,
  };
}

function technicalFor(symbol: string, report: MarketAnalysisReport): TechnicalRow | null {
  const key = normalizeSymbol(symbol);
  return report.technicalRows.find((row) => normalizeSymbol(row.symbol) === key) ?? null;
}

function priceRange(price: number | null, side: "BUY" | "SELL") {
  if (!price) return "行情同步后计算";
  const lowerMultiplier = side === "BUY" ? 0.997 : 0.998;
  const upperMultiplier = side === "BUY" ? 1.002 : 1.003;
  return `${formatPrice(price * lowerMultiplier)}–${formatPrice(price * upperMultiplier)}`;
}

function nextWeekdayReview(asOf: string | undefined, businessDays: number) {
  const parsed = asOf ? new Date(`${asOf}T12:00:00`) : new Date();
  const date = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  let remaining = businessDays;
  while (remaining > 0) {
    date.setDate(date.getDate() + 1);
    const day = date.getDay();
    if (day !== 0 && day !== 6) remaining -= 1;
  }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatPrice(value: number) {
  return value >= 100 ? value.toFixed(2) : value >= 10 ? value.toFixed(3) : value.toFixed(4);
}

function positiveNumber(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function normalizeSymbol(value: string) {
  return value.trim().toUpperCase();
}
