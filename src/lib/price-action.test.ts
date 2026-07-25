import { describe, expect, it } from "vitest";

import { analyzePriceAction, topPriceActionSignals } from "./price-action";
import type { TechnicalRow } from "./types";

function row(overrides: Partial<TechnicalRow>): TechnicalRow {
  return {
    symbol: "510300",
    label: "沪深300ETF",
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

describe("price action analysis", () => {
  it("identifies a tradable trend continuation setup", () => {
    const analysis = analyzePriceAction({
      technicalRows: [
        row({
          close: 112,
          ma20: 105,
          ma50: 98,
          ma200: 90,
          macd: 3.2,
          macdSignal: 2.4,
          macdHistogram: 1.8,
          return20d: 8,
          rsi14: 62,
        }),
      ],
    });

    expect(analysis.tone).toBe("positive");
    expect(analysis.snapshots[0]).toMatchObject({
      phase: "trend-continuation",
      tone: "positive",
    });
    expect(analysis.snapshots[0].signals.some((signal) => signal.ruleType === "trend_continuation")).toBe(true);
    expect(analysis.snapshots[0].signals.some((signal) => signal.ruleType === "macd_confirmation")).toBe(true);
  });

  it("prioritizes support-loss risk before bullish confirmations", () => {
    const analysis = analyzePriceAction({
      technicalRows: [
        row({
          symbol: "159915",
          label: "创业板ETF",
          close: 86,
          change1d: -2.4,
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
      ],
    });

    expect(analysis.tone).toBe("negative");
    expect(analysis.primarySignal?.ruleType).toBe("support_lost");
    expect(analysis.snapshots[0]).toMatchObject({
      phase: "breakdown",
      tone: "negative",
    });
    expect(topPriceActionSignals(analysis, 1)[0].ruleType).toBe("support_lost");
  });

  it("treats falling volatility proxies as risk cooling instead of support loss", () => {
    const analysis = analyzePriceAction({
      assetStatuses: [
        {
          symbol: "VIX",
          label: "恐慌",
          assetKind: "observer",
          status: "green",
          statusLabel: "绿灯",
          close: 14.5,
          change1d: -1.2,
          note: "正常区间",
        },
      ],
      technicalRows: [
        row({
          symbol: "VIX",
          label: "恐慌",
          close: 14.5,
          change1d: -1.2,
          ma20: 18.2,
          ma50: 17.4,
          ma200: 16.8,
          return20d: -8.2,
          rsi14: 46.3,
          macd: -0.2,
          macdSignal: -0.1,
          macdHistogram: -0.1,
          volumeRatio: null,
        }),
      ],
    });

    expect(analysis.tone).toBe("positive");
    expect(analysis.primarySignal?.ruleType).toBe("risk_proxy_cooling");
    expect(analysis.snapshots[0].signals.some((signal) => signal.ruleType === "support_lost")).toBe(false);
    expect(analysis.snapshots[0]).toMatchObject({
      phase: "risk-cooling",
      tone: "positive",
    });
  });

  it("keeps an explicit neutral fallback when technical rows are unavailable", () => {
    const analysis = analyzePriceAction({ technicalRows: [] });

    expect(analysis.score).toBe(50);
    expect(analysis.primarySignal).toBeNull();
    expect(analysis.snapshots).toEqual([]);
    expect(analysis.summary).toContain("缺少技术行");
  });
});
