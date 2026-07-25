import { describe, expect, it } from "vitest";

import { derivePatternAnalysis } from "./chart-patterns";
import { analyzePriceAction } from "./price-action";
import type { PriceBar, TechnicalRow } from "./types";

function row(overrides: Partial<TechnicalRow>): TechnicalRow {
  return {
    symbol: "QQQ",
    label: "科技",
    cells: [],
    close: 100,
    change1d: 0,
    return10d: 0,
    return20d: 0,
    rsi14: 50,
    ma20: 100,
    ma50: 100,
    ma200: 100,
    macd: 0,
    macdSignal: 0,
    macdHistogram: 0,
    kdjK: 50,
    kdjD: 50,
    kdjJ: 50,
    volumeRatio: 1,
    status: "yellow",
    note: "",
    ...overrides,
  };
}

function bar(day: number, close: number, high = close + 1, low = close - 1, volume = 1000): PriceBar {
  return {
    date: `2026-06-${String(day).padStart(2, "0")}`,
    open: close,
    high,
    low,
    close,
    volume,
  };
}

describe("chart pattern analysis", () => {
  it("detects a confirmed double top from OHLC bars", () => {
    const bars = [
      bar(1, 101), bar(2, 103), bar(3, 105), bar(4, 107), bar(5, 109, 110, 108),
      bar(6, 106), bar(7, 102), bar(8, 100, 101, 99), bar(9, 103), bar(10, 106),
      bar(11, 108, 109.2, 107), bar(12, 105), bar(13, 102), bar(14, 99), bar(15, 98, 99, 97),
      bar(16, 97, 98, 96, 1400), bar(17, 98), bar(18, 97), bar(19, 96),
    ];
    const analysis = derivePatternAnalysis({
      asOf: "2026-06-19",
      priceBarsBySymbol: { QQQ: bars },
      technicalRows: [row({ close: 96, ma20: 102, ma50: 101, return20d: -4 })],
    });

    expect(analysis.dominant).toMatchObject({
      label: "双顶",
      status: "confirmed",
      tone: "negative",
    });
    expect(analysis.dominant?.neckline).toBe("99.00");
  });

  it("derives support-break patterns from price-action snapshots when bars are unavailable", () => {
    const technicalRows = [
      row({
        symbol: "159915",
        label: "创业板ETF",
        close: 86,
        ma20: 100,
        ma50: 95,
        ma200: 91,
        macd: -1.1,
        macdSignal: -0.3,
        macdHistogram: -0.8,
        return20d: -8,
        rsi14: 36,
        volumeRatio: 1.7,
      }),
    ];
    const priceAction = analyzePriceAction({ technicalRows });
    const analysis = derivePatternAnalysis({
      asOf: "2026-07-10",
      priceAction,
      technicalRows,
    });

    expect(analysis.dominant).toMatchObject({
      label: "支撑破位",
      symbol: "159915",
      tone: "negative",
    });
    expect(analysis.summary).toContain("支撑破位");
  });
});
