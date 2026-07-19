import type { BrokerAccountSnapshot } from "./broker-bridge";
import type { HoldingRecord } from "./holdings";
import {
  convertCurrency,
  type PortfolioValuationSettings,
  type SupportedCurrency,
} from "./portfolio-valuation";

export const ACCOUNT_STORE_VERSION = 2;

export type AccountSource = "manual" | "broker" | "paper" | "import";
export type AccountStatus = "active" | "disconnected" | "archived";

export type AccountRecord = {
  id: string;
  name: string;
  broker: string;
  route: string;
  externalAccountId: string;
  currency: SupportedCurrency;
  source: AccountSource;
  status: AccountStatus;
  settledCash: number;
  availableCash: number;
  pendingSettlement: number;
  marketValue: number;
  equity: number;
  lastSyncStatus: string;
  lastSyncMessage: string;
  syncedAt: string;
  updatedAt: string;
  notes: string;
};

export type AccountStoreSnapshot = {
  version: typeof ACCOUNT_STORE_VERSION;
  updatedAt: string;
  accounts: AccountRecord[];
  brokerSnapshots: BrokerAccountSnapshot[];
};

export type AccountPortfolioSummary = {
  accountCount: number;
  activeCount: number;
  baseCurrency: SupportedCurrency;
  availableCash: number;
  settledCash: number;
  pendingSettlement: number;
  totalCash: number;
  marketValue: number;
  equity: number;
  complete: boolean;
  issue: string;
};

const MAX_BROKER_SNAPSHOTS = 24;

export function emptyAccountStore(): AccountStoreSnapshot {
  return {
    version: ACCOUNT_STORE_VERSION,
    updatedAt: "",
    accounts: [],
    brokerSnapshots: [],
  };
}

export function accountIdForBrokerSnapshot(snapshot: BrokerAccountSnapshot) {
  const identity = [
    cleanText(snapshot.bridge) || "broker",
    cleanText(snapshot.route) || "route",
    cleanText(snapshot.accountId) || cleanText(snapshot.accountName) || "account",
    normalizeCurrency(snapshot.currency) || "CNY",
  ].join("|");
  return `account-${hashIdentity(identity)}`;
}

export function accountFromBrokerSnapshot(
  snapshot: BrokerAccountSnapshot,
  existing?: AccountRecord,
): AccountRecord | null {
  const currency = normalizeCurrency(snapshot.currency);
  if (!currency) return null;
  const now = cleanText(snapshot.syncedAt) || new Date().toISOString();
  const settledCash = finiteNumber(snapshot.settledCash ?? snapshot.cash);
  const availableCash = finiteNumber(snapshot.availableCash ?? snapshot.cash);
  const pendingSettlement = finiteNumber(snapshot.pendingSettlement);
  const marketValue = finiteNumber(snapshot.marketValue);
  const equity = finiteNumber(snapshot.equity) || settledCash + pendingSettlement + marketValue;
  return {
    id: existing?.id || accountIdForBrokerSnapshot(snapshot),
    name: cleanText(snapshot.accountName) || existing?.name || cleanText(snapshot.route) || "投资账户",
    broker: cleanText(snapshot.bridge) || existing?.broker || "broker",
    route: cleanText(snapshot.route) || existing?.route || "",
    externalAccountId: cleanText(snapshot.accountId) || existing?.externalAccountId || "",
    currency,
    source: existing?.source === "paper" ? "paper" : "broker",
    status: snapshot.accepted ? "active" : existing?.status === "archived" ? "archived" : "disconnected",
    settledCash,
    availableCash,
    pendingSettlement,
    marketValue,
    equity,
    lastSyncStatus: cleanText(snapshot.status),
    lastSyncMessage: cleanText(snapshot.message),
    syncedAt: now,
    updatedAt: now,
    notes: existing?.notes ?? "",
  };
}

export function createManualAccount(input: {
  name: string;
  currency: SupportedCurrency;
  settledCash?: number;
  availableCash?: number;
  pendingSettlement?: number;
  notes?: string;
  now?: Date;
}): AccountRecord {
  const now = input.now ?? new Date();
  const updatedAt = now.toISOString();
  const settledCash = nonNegativeNumber(input.settledCash);
  const availableCash = nonNegativeNumber(input.availableCash ?? settledCash);
  const pendingSettlement = finiteNumber(input.pendingSettlement);
  return {
    id: `account-manual-${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
    name: cleanText(input.name) || `${input.currency} 账户`,
    broker: "manual",
    route: "",
    externalAccountId: "",
    currency: input.currency,
    source: "manual",
    status: "active",
    settledCash,
    availableCash,
    pendingSettlement,
    marketValue: 0,
    equity: settledCash + pendingSettlement,
    lastSyncStatus: "manual",
    lastSyncMessage: "",
    syncedAt: "",
    updatedAt,
    notes: cleanText(input.notes),
  };
}

export function upsertBrokerAccountSnapshot(
  store: AccountStoreSnapshot,
  incoming: BrokerAccountSnapshot,
): AccountStoreSnapshot {
  const normalized = normalizeAccountStore(store);
  const id = accountIdForBrokerSnapshot(incoming);
  const existing = normalized.accounts.find((account) => account.id === id);
  const account = accountFromBrokerSnapshot(incoming, existing);
  const brokerSnapshots = [
    incoming,
    ...normalized.brokerSnapshots.filter((snapshot) => accountIdForBrokerSnapshot(snapshot) !== id),
  ]
    .sort((left, right) => timeValue(right.syncedAt) - timeValue(left.syncedAt))
    .slice(0, MAX_BROKER_SNAPSHOTS);
  const accounts = account
    ? [account, ...normalized.accounts.filter((item) => item.id !== account.id)]
    : normalized.accounts;
  return {
    version: ACCOUNT_STORE_VERSION,
    updatedAt: cleanText(incoming.syncedAt) || new Date().toISOString(),
    accounts,
    brokerSnapshots,
  };
}

export function normalizeAccountStore(value: unknown): AccountStoreSnapshot {
  if (Array.isArray(value)) {
    return value.reduce(
      (store, snapshot) => isBrokerAccountSnapshot(snapshot) ? upsertBrokerAccountSnapshot(store, snapshot) : store,
      emptyAccountStore(),
    );
  }
  if (!value || typeof value !== "object") return emptyAccountStore();
  const candidate = value as Partial<AccountStoreSnapshot> & { snapshots?: unknown[] };
  const accounts = Array.isArray(candidate.accounts)
    ? candidate.accounts.map(normalizeAccountRecord).filter((account): account is AccountRecord => Boolean(account))
    : [];
  const rawSnapshots = Array.isArray(candidate.brokerSnapshots)
    ? candidate.brokerSnapshots
    : Array.isArray(candidate.snapshots)
      ? candidate.snapshots
      : [];
  const brokerSnapshots = rawSnapshots.filter(isBrokerAccountSnapshot).slice(0, MAX_BROKER_SNAPSHOTS);
  const base: AccountStoreSnapshot = {
    version: ACCOUNT_STORE_VERSION,
    updatedAt: cleanText(candidate.updatedAt),
    accounts,
    brokerSnapshots: brokerSnapshots
      .sort((left, right) => timeValue(right.syncedAt) - timeValue(left.syncedAt))
      .slice(0, MAX_BROKER_SNAPSHOTS),
  };
  if (accounts.length || !brokerSnapshots.length) return base;
  return brokerSnapshots.reduce<AccountStoreSnapshot>(
    (store, snapshot) => upsertBrokerAccountSnapshot(store, snapshot),
    { ...base, brokerSnapshots: [] },
  );
}

export function summarizeAccounts(
  accounts: AccountRecord[],
  valuation: PortfolioValuationSettings,
): AccountPortfolioSummary {
  const activeAccounts = accounts.filter((account) => account.status === "active");
  let complete = true;
  const sumField = (field: "availableCash" | "settledCash" | "pendingSettlement" | "marketValue" | "equity") => {
    return activeAccounts.reduce((sum, account) => {
      const rawValue = field === "equity" && account.equity === 0
        ? account.settledCash + account.pendingSettlement + account.marketValue
        : account[field];
      const converted = convertCurrency(rawValue, account.currency, valuation.baseCurrency, valuation);
      if (converted === null) {
        complete = false;
        return sum;
      }
      return sum + converted;
    }, 0);
  };
  const availableCash = sumField("availableCash");
  const settledCash = sumField("settledCash");
  const pendingSettlement = sumField("pendingSettlement");
  const marketValue = sumField("marketValue");
  const equity = sumField("equity");
  return {
    accountCount: accounts.length,
    activeCount: activeAccounts.length,
    baseCurrency: valuation.baseCurrency,
    availableCash,
    settledCash,
    pendingSettlement,
    totalCash: settledCash + pendingSettlement,
    marketValue,
    equity,
    complete,
    issue: complete ? "" : "账户包含跨币种金额，需要有效的 USD/CNY 汇率。",
  };
}

export function accountCashHoldingsForPlanning(accounts: AccountRecord[]): HoldingRecord[] {
  return accounts
    .filter((account) => account.status === "active")
    .map((account) => ({
      id: `cash-${account.id}`,
      accountId: account.id,
      symbol: `CASH-${account.currency}-${account.id}`,
      name: `${account.name}可用现金`,
      market: account.currency === "CNY" ? "CN" : "US",
      currency: account.currency,
      role: "real" as const,
      assetType: "cash" as const,
      quoteSource: "manual" as const,
      quantity: 1,
      costPrice: account.availableCash,
      currentPrice: account.availableCash,
      quoteAsOf: account.syncedAt.slice(0, 10) || account.updatedAt.slice(0, 10) || undefined,
      targetWeight: 0,
      notes: "账户可用现金",
    }));
}

export function normalizeAccountRecord(value: unknown): AccountRecord | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<AccountRecord> & { cash?: unknown };
  const id = cleanText(item.id);
  const currency = normalizeCurrency(item.currency);
  if (!id || !currency) return null;
  const settledCash = nonNegativeNumber(item.settledCash ?? item.cash);
  const availableCash = nonNegativeNumber(item.availableCash ?? item.cash ?? settledCash);
  const pendingSettlement = finiteNumber(item.pendingSettlement);
  const marketValue = nonNegativeNumber(item.marketValue);
  const equity = finiteNumber(item.equity) || settledCash + pendingSettlement + marketValue;
  return {
    id,
    name: cleanText(item.name) || `${currency} 账户`,
    broker: cleanText(item.broker) || "manual",
    route: cleanText(item.route),
    externalAccountId: cleanText(item.externalAccountId),
    currency,
    source: normalizeSource(item.source),
    status: normalizeStatus(item.status),
    settledCash,
    availableCash,
    pendingSettlement,
    marketValue,
    equity,
    lastSyncStatus: cleanText(item.lastSyncStatus),
    lastSyncMessage: cleanText(item.lastSyncMessage),
    syncedAt: cleanText(item.syncedAt),
    updatedAt: cleanText(item.updatedAt),
    notes: cleanText(item.notes),
  };
}

function isBrokerAccountSnapshot(value: unknown): value is BrokerAccountSnapshot {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<BrokerAccountSnapshot>;
  return typeof item.bridge === "string"
    && Array.isArray(item.positions)
    && Array.isArray(item.orders)
    && Array.isArray(item.trades);
}

function normalizeCurrency(value: unknown): SupportedCurrency | null {
  const currency = cleanText(value).toUpperCase();
  return currency === "CNY" || currency === "USD" ? currency : null;
}

function normalizeSource(value: unknown): AccountSource {
  return value === "broker" || value === "paper" || value === "import" ? value : "manual";
}

function normalizeStatus(value: unknown): AccountStatus {
  return value === "disconnected" || value === "archived" ? value : "active";
}

function finiteNumber(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nonNegativeNumber(value: unknown) {
  return Math.max(0, finiteNumber(value));
}

function cleanText(value: unknown) {
  return String(value ?? "").trim();
}

function timeValue(value: string) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function hashIdentity(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
