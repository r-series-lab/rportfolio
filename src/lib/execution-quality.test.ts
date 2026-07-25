import { describe, expect, it } from "vitest";
import { evaluateExecutionQuality } from "./execution-quality";
import type { OrderIntent } from "./strategy-engine";
import type { MarketAnalysisReport } from "./types";

const report = {
  profileMarket: "CN",
  profileFund: { holdingsAgeDays: 220 },
} as unknown as MarketAnalysisReport;

function intent(side: "BUY" | "SELL"): OrderIntent {
  return {
    amount: "¥1,000",
    detail: "测试基金动作",
    key: `fund-${side}`,
    name: "测试基金",
    side,
    state: "待复核",
    symbol: "000001",
    tone: side === "BUY" ? "positive" : "caution",
    weight: "2%",
  };
}

describe("fund execution quality", () => {
  it("blocks a buy when fund disclosure is expired", () => {
    const assessment = evaluateExecutionQuality({
      instrumentKind: "fund",
      orderIntent: intent("BUY"),
      report,
      side: "BUY",
    });

    expect(assessment.checks.some((check) => check.key === "fund.freshness.block" && check.severity === "block")).toBe(true);
  });

  it("warns but does not block a risk-reducing redemption", () => {
    const assessment = evaluateExecutionQuality({
      instrumentKind: "fund",
      orderIntent: intent("SELL"),
      report,
      side: "SELL",
    });

    expect(assessment.checks.some((check) => check.key === "fund.freshness.block" && check.severity === "warn")).toBe(true);
    expect(assessment.checks.some((check) => check.severity === "block")).toBe(false);
  });
});
