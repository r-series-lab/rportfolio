import { describe, expect, it } from "vitest";
import type { BrokerAccountSnapshot } from "./broker-bridge";
import {
  ACCOUNT_STORE_VERSION,
  accountIdForBrokerSnapshot,
  emptyAccountStore,
  normalizeAccountStore,
  summarizeAccounts,
  upsertBrokerAccountSnapshot,
} from "./accounts";
import { tradePositionsFromTrades } from "./trades";

function brokerSnapshot(overrides: Partial<BrokerAccountSnapshot> = {}): BrokerAccountSnapshot {
  return {
    accepted: true,
    bridge: "qbot",
    route: "paper",
    status: "synced",
    accountId: "ACC-1",
    accountName: "美元核心账户",
    currency: "USD",
    cash: 1_000,
    availableCash: 800,
    settledCash: 900,
    pendingSettlement: 100,
    marketValue: 4_000,
    equity: 5_000,
    positions: [],
    orders: [],
    trades: [],
    warnings: [],
    commandPreview: [],
    syncedAt: "2026-07-16T08:00:00.000Z",
    message: "ok",
    ...overrides,
  };
}

describe("account truth", () => {
  it("keeps one stable account identity across broker syncs", () => {
    const first = brokerSnapshot();
    const second = brokerSnapshot({ cash: 1_100, availableCash: 950, syncedAt: "2026-07-16T09:00:00.000Z" });
    const once = upsertBrokerAccountSnapshot(emptyAccountStore(), first);
    const twice = upsertBrokerAccountSnapshot(once, second);

    expect(accountIdForBrokerSnapshot(first)).toBe(accountIdForBrokerSnapshot(second));
    expect(twice.accounts).toHaveLength(1);
    expect(twice.brokerSnapshots).toHaveLength(1);
    expect(twice.accounts[0].availableCash).toBe(950);
    expect(twice.accounts[0].pendingSettlement).toBe(100);
  });

  it("migrates a legacy cash-only account into the current cash model", () => {
    const migrated = normalizeAccountStore({
      version: 1,
      accounts: [{ id: "legacy", name: "人民币账户", currency: "CNY", cash: 12_000 }],
    });

    expect(migrated.version).toBe(ACCOUNT_STORE_VERSION);
    expect(migrated.accounts[0]).toMatchObject({
      settledCash: 12_000,
      availableCash: 12_000,
      pendingSettlement: 0,
    });
  });

  it("preserves user-facing account metadata while normalizing current stores", () => {
    const synced = upsertBrokerAccountSnapshot(emptyAccountStore(), brokerSnapshot());
    const customized = {
      ...synced,
      accounts: synced.accounts.map((account) => ({ ...account, name: "长期账户", notes: "核心" })),
    };

    expect(normalizeAccountStore(customized).accounts[0]).toMatchObject({ name: "长期账户", notes: "核心" });
  });

  it("values CNY and USD account cash without mixing nominal amounts", () => {
    const usdStore = upsertBrokerAccountSnapshot(emptyAccountStore(), brokerSnapshot());
    const cnyStore = upsertBrokerAccountSnapshot(usdStore, brokerSnapshot({
      bridge: "manual",
      accountId: "CNY-1",
      accountName: "人民币账户",
      currency: "CNY",
      cash: 7_000,
      availableCash: 6_000,
      settledCash: 7_000,
      pendingSettlement: 0,
      marketValue: 0,
      equity: 7_000,
    }));
    const summary = summarizeAccounts(cnyStore.accounts, {
      baseCurrency: "CNY",
      usdCnyRate: 7,
      fxAsOf: "2026-07-16",
      fxSource: "manual",
    });

    expect(summary.availableCash).toBe(11_600);
    expect(summary.settledCash).toBe(13_300);
    expect(summary.pendingSettlement).toBe(700);
    expect(summary.equity).toBe(42_000);
    expect(summary.complete).toBe(true);
  });

  it("marks cross-currency totals incomplete when the FX rate is missing", () => {
    const store = upsertBrokerAccountSnapshot(emptyAccountStore(), brokerSnapshot());
    const summary = summarizeAccounts(store.accounts, {
      baseCurrency: "CNY",
      usdCnyRate: null,
      fxAsOf: "",
      fxSource: "manual",
    });

    expect(summary.complete).toBe(false);
    expect(summary.availableCash).toBe(0);
    expect(summary.issue).toContain("USD/CNY");
  });

  it("keeps trade positions separate by account", () => {
    const positions = tradePositionsFromTrades([
      { id: "t1", accountId: "a1", symbol: "SPY", name: "SPY", side: "buy", tradeDate: "2026-07-15", quantity: 10, price: 100, fee: 0, currency: "USD", notes: "" },
      { id: "t2", accountId: "a2", symbol: "SPY", name: "SPY", side: "buy", tradeDate: "2026-07-15", quantity: 20, price: 100, fee: 0, currency: "USD", notes: "" },
    ]);

    expect(positions).toHaveLength(2);
    expect(positions.find((position) => position.accountId === "a1")?.quantity).toBe(10);
    expect(positions.find((position) => position.accountId === "a2")?.quantity).toBe(20);
  });
});
