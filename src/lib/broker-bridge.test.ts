import { describe, expect, it } from "vitest";
import { probeBrokerBridge, routeQuantOrder } from "./broker-bridge";

describe("broker bridge browser preview", () => {
  it("does not claim that machine-local adapters are available", async () => {
    const statuses = await probeBrokerBridge();

    expect(statuses).toHaveLength(2);
    for (const status of statuses) {
      expect(status.path).toMatch(/^~\/Documents\//);
      expect(status.path).not.toContain("/Users/");
      expect(status.pathExists).toBe(false);
      expect(status.adapterExists).toBe(false);
      expect(status.pythonOk).toBe(false);
      expect(status.commandAvailable).toBe(false);
    }
  });

  it("keeps external routes disabled outside Tauri", async () => {
    const result = await routeQuantOrder({
      bridge: "vnpy",
      brokerMode: "live-gateway",
      symbol: "SPY",
      name: "SPDR S&P 500 ETF Trust",
      side: "buy",
      quantity: "1",
      limit: "500",
      amount: "500",
      weight: "1",
      strategy: "preview",
      platform: "desktop",
      tradeType: "stock",
      riskOverride: false,
      allowLive: true,
    });

    expect(result.accepted).toBe(false);
    expect(result.submitted).toBe(false);
    expect(result.status).toBe("missing_adapter");
  });
});
