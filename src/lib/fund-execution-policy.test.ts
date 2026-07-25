import { describe, expect, it } from "vitest";

import {
  DEFAULT_FUND_EXECUTION_POLICY,
  fundFeesFor,
  fundOrderScheduleFor,
  normalizeFundExecutionPolicy,
  updateFundFeeOverride,
} from "./fund-execution-policy";

describe("fund execution schedule", () => {
  it("uses the same NAV date before cutoff and separates confirmation from cash arrival", () => {
    const schedule = fundOrderScheduleFor({
      cutoffTime: "15:00",
      orderDate: "2026-07-06",
      redemptionSettlementDays: 3,
      submittedAt: "2026-07-06T06:00:00.000Z",
    });

    expect(schedule).toEqual({
      afterCutoff: false,
      navDate: "2026-07-06",
      confirmDate: "2026-07-07",
      cashArrivalDate: "2026-07-09",
    });
  });

  it("moves the NAV date to the next trading day after cutoff", () => {
    const schedule = fundOrderScheduleFor({
      cutoffTime: "15:00",
      orderDate: "2026-07-06",
      redemptionSettlementDays: 3,
      submittedAt: "2026-07-06T08:00:00.000Z",
    });

    expect(schedule).toEqual({
      afterCutoff: true,
      navDate: "2026-07-07",
      confirmDate: "2026-07-08",
      cashArrivalDate: "2026-07-10",
    });
  });

  it("skips the 2026 National Day exchange holiday", () => {
    const schedule = fundOrderScheduleFor({
      cutoffTime: "15:00",
      orderDate: "2026-09-30",
      redemptionSettlementDays: 3,
      submittedAt: "2026-09-30T06:00:00.000Z",
    });

    expect(schedule.navDate).toBe("2026-09-30");
    expect(schedule.confirmDate).toBe("2026-10-08");
    expect(schedule.cashArrivalDate).toBe("2026-10-12");
  });
});

describe("fund fee policy", () => {
  it("normalizes unsafe values and applies product-specific overrides", () => {
    const normalized = normalizeFundExecutionPolicy({
      cutoffTime: "99:99",
      defaultBuyFeeRate: -1,
      defaultSellFeeRate: 2,
      defaultRedemptionSettlementDays: 99,
    });
    expect(normalized).toMatchObject({
      cutoffTime: DEFAULT_FUND_EXECUTION_POLICY.cutoffTime,
      defaultBuyFeeRate: 0,
      defaultSellFeeRate: 0.1,
      defaultRedemptionSettlementDays: 10,
    });

    const updated = updateFundFeeOverride(normalized, " 016702 ", {
      buyFeeRate: 0.002,
      sellFeeRate: 0.008,
      redemptionSettlementDays: 5,
    });
    expect(fundFeesFor(updated, "016702")).toEqual({
      buyFeeRate: 0.002,
      sellFeeRate: 0.008,
      redemptionSettlementDays: 5,
    });
  });
});
