import { describe, expect, it } from "vitest";
import { accountBookFromSnapshots, reconcileAccountBookWithHoldings } from "./account-book";
import { accountIdForBrokerSnapshot } from "./accounts";
import type { BrokerAccountSnapshot } from "./broker-bridge";
import type { HoldingRecord } from "./holdings";

function snapshot(accountId: string, quantity: number): BrokerAccountSnapshot {
  return {
    accepted: true,
    bridge: "qbot",
    route: "paper",
    status: "synced",
    accountId,
    accountName: accountId,
    currency: "USD",
    cash: 0,
    marketValue: quantity * 100,
    equity: quantity * 100,
    positions: [{ symbol: "SPY", name: "SPY", quantity, price: 100, marketValue: quantity * 100 }],
    orders: [],
    trades: [],
    warnings: [],
    commandPreview: [],
    syncedAt: "2026-07-16T08:00:00.000Z",
    message: "ok",
  };
}

function holding(accountId: string, quantity: number): HoldingRecord {
  return {
    id: `${accountId}-spy`,
    accountId,
    symbol: "SPY",
    name: "SPY",
    market: "US",
    currency: "USD",
    role: "real",
    assetType: "etf",
    quantity,
    costPrice: 90,
    currentPrice: 100,
    targetWeight: 50,
    notes: "",
  };
}

describe("account-aware reconciliation", () => {
  it("waits for an accepted account snapshot before reporting local gaps", () => {
    const local = holding("account-a", 10);
    const result = reconcileAccountBookWithHoldings(accountBookFromSnapshots([], [local]), [local]);

    expect(result.rows).toEqual([]);
    expect(result.summary.headline).toBe("等待账户回报");
  });

  it("does not net the same symbol across different accounts", () => {
    const first = snapshot("A-1", 10);
    const second = snapshot("A-2", 20);
    const firstId = accountIdForBrokerSnapshot(first);
    const secondId = accountIdForBrokerSnapshot(second);
    const book = accountBookFromSnapshots([first, second], [holding(firstId, 10), holding(secondId, 15)]);
    const result = reconcileAccountBookWithHoldings(book, [holding(firstId, 10), holding(secondId, 15)]);

    expect(result.rows).toHaveLength(2);
    expect(result.rows.find((row) => row.accountId === firstId)?.status).toBe("matched");
    expect(result.rows.find((row) => row.accountId === secondId)?.status).toBe("drift");
  });

  it("keeps legacy holdings without account identity visibly unassigned", () => {
    const broker = snapshot("A-1", 10);
    const local = { ...holding("", 10), accountId: undefined };
    const result = reconcileAccountBookWithHoldings(accountBookFromSnapshots([broker], [local]), [local]);

    expect(result.rows).toHaveLength(2);
    expect(result.rows.some((row) => row.accountName === "待归属" && row.status === "missing")).toBe(true);
    expect(result.rows.some((row) => row.status === "extra")).toBe(true);
  });
});
