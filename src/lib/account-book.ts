import type { BrokerAccountSnapshot } from "./broker-bridge";
import type { HoldingRecord } from "./holdings";
import { accountIdForBrokerSnapshot } from "./accounts";

export type AccountBookAccount = {
  id: string;
  key: string;
  bridge: string;
  route: string;
  accountId: string;
  accountName: string;
  currency: string;
  cash: number;
  marketValue: number;
  equity: number;
  positionCount: number;
  orderCount: number;
  tradeCount: number;
  accepted: boolean;
  status: string;
  message: string;
  syncedAt: string;
};

export type AccountBookPosition = {
  key: string;
  accountId: string;
  accountKey: string;
  accountName: string;
  bridge: string;
  route: string;
  symbol: string;
  name: string;
  exchange: string;
  direction: string;
  currency: string;
  quantity: number;
  available: number;
  price: number;
  marketValue: number;
  costValue: number;
  unrealizedPnl: number;
  raw: Record<string, unknown>;
};

export type AccountBookSnapshot = {
  accounts: AccountBookAccount[];
  positions: AccountBookPosition[];
  cash: number;
  marketValue: number;
  equity: number;
  positionCount: number;
  orderCount: number;
  tradeCount: number;
  accountCount: number;
  acceptedCount: number;
  currency: string;
  updatedAt: string;
  warnings: string[];
};

export type PortfolioReconcileStatus = "matched" | "drift" | "missing" | "extra";

export type PortfolioReconcileRow = {
  key: string;
  accountId: string;
  accountName: string;
  symbol: string;
  name: string;
  currency: string;
  status: PortfolioReconcileStatus;
  tone: "positive" | "caution" | "negative" | "neutral";
  localQuantity: number;
  brokerQuantity: number;
  quantityDiff: number;
  localValue: number;
  brokerValue: number;
  valueDiff: number;
  valueDiffPct: number | null;
  accounts: string[];
  summary: string;
};

export type PortfolioReconcileSummary = {
  total: number;
  matched: number;
  drift: number;
  missing: number;
  extra: number;
  localValue: number;
  brokerValue: number;
  valueDiff: number;
  tone: "positive" | "caution" | "negative" | "neutral";
  headline: string;
};

export type PortfolioReconcileResult = {
  rows: PortfolioReconcileRow[];
  summary: PortfolioReconcileSummary;
};

const MAX_ACCOUNT_SNAPSHOTS = 12;
const QUANTITY_TOLERANCE = 0.0001;
const VALUE_TOLERANCE_FLOOR = 10;
const VALUE_TOLERANCE_RATE = 0.01;

export function accountKeyForSnapshot(snapshot: BrokerAccountSnapshot) {
  return accountIdForBrokerSnapshot(snapshot);
}

export function mergeAccountSnapshot(
  snapshots: BrokerAccountSnapshot[],
  incoming: BrokerAccountSnapshot,
  maxSnapshots = MAX_ACCOUNT_SNAPSHOTS,
) {
  const incomingKey = accountKeyForSnapshot(incoming);
  const deduped = snapshots.filter((snapshot) => accountKeyForSnapshot(snapshot) !== incomingKey);
  return [incoming, ...deduped]
    .sort((left, right) => timeValue(right.syncedAt) - timeValue(left.syncedAt))
    .slice(0, maxSnapshots);
}

export function accountBookFromSnapshots(
  snapshots: BrokerAccountSnapshot[],
  holdings: HoldingRecord[] = [],
): AccountBookSnapshot {
  const holdingBySymbol = holdingsBySymbol(holdings);
  const accounts = snapshots.map(accountFromSnapshot);
  const positions = snapshots.flatMap((snapshot) => {
    const account = accountFromSnapshot(snapshot);
    return snapshot.positions
      .map((raw, index) => positionFromRaw(raw, index, account, holdingBySymbol))
      .filter((position): position is AccountBookPosition => Boolean(position));
  });
  const currency = dominantCurrency([...accounts.map((item) => item.currency), ...positions.map((item) => item.currency)]);
  const warnings = snapshots.flatMap((snapshot) => snapshot.warnings ?? []);
  return {
    accounts,
    positions,
    cash: sum(accounts.map((item) => item.cash)),
    marketValue: sum(accounts.map((item) => item.marketValue)) || sum(positions.map((item) => item.marketValue)),
    equity: sum(accounts.map((item) => item.equity)),
    positionCount: positions.length,
    orderCount: sum(accounts.map((item) => item.orderCount)),
    tradeCount: sum(accounts.map((item) => item.tradeCount)),
    accountCount: accounts.length,
    acceptedCount: accounts.filter((item) => item.accepted).length,
    currency,
    updatedAt: snapshots.reduce((latest, snapshot) => {
      if (!latest) return snapshot.syncedAt;
      return timeValue(snapshot.syncedAt) > timeValue(latest) ? snapshot.syncedAt : latest;
    }, ""),
    warnings,
  };
}

export function reconcileAccountBookWithHoldings(
  book: AccountBookSnapshot,
  holdings: HoldingRecord[],
): PortfolioReconcileResult {
  if (!book.acceptedCount) {
    return { rows: [], summary: summarizeReconcileRows([]) };
  }
  const localHoldings = holdings.filter((holding) => holding.role === "real");
  const localByKey = holdingsByAccountAndSymbol(localHoldings);
  const brokerByKey = positionsByAccountAndSymbol(book.positions);
  const keys = Array.from(new Set([...localByKey.keys(), ...brokerByKey.keys()])).sort();
  const rows = keys.map((key) => {
    const local = localByKey.get(key) ?? [];
    const broker = brokerByKey.get(key) ?? [];
    const sampleHolding = local[0];
    const samplePosition = broker[0];
    return reconcileSymbol(
      sampleHolding?.symbol || samplePosition?.symbol || "",
      sampleHolding?.accountId || samplePosition?.accountId || "",
      local,
      broker,
    );
  });
  const summary = summarizeReconcileRows(rows);
  return {
    rows: rows.sort(compareReconcileRows),
    summary,
  };
}

export function summarizeAccountBook(book: AccountBookSnapshot) {
  if (!book.accountCount) return "尚未同步账户";
  const failed = book.accountCount - book.acceptedCount;
  const failedText = failed > 0 ? `，${failed} 个异常` : "";
  return `${book.accountCount} 个账户，${book.positionCount} 个持仓${failedText}`;
}

function accountFromSnapshot(snapshot: BrokerAccountSnapshot): AccountBookAccount {
  const id = accountIdForBrokerSnapshot(snapshot);
  return {
    id,
    key: id,
    bridge: cleanText(snapshot.bridge),
    route: cleanText(snapshot.route),
    accountId: cleanText(snapshot.accountId),
    accountName: cleanText(snapshot.accountName) || cleanText(snapshot.route) || cleanText(snapshot.bridge) || "账户",
    currency: cleanText(snapshot.currency),
    cash: finiteNumber(snapshot.cash),
    marketValue: finiteNumber(snapshot.marketValue),
    equity: finiteNumber(snapshot.equity) || finiteNumber(snapshot.cash) + finiteNumber(snapshot.marketValue),
    positionCount: snapshot.positions.length,
    orderCount: snapshot.orders.length,
    tradeCount: snapshot.trades.length,
    accepted: Boolean(snapshot.accepted),
    status: cleanText(snapshot.status),
    message: cleanText(snapshot.message),
    syncedAt: cleanText(snapshot.syncedAt),
  };
}

function positionFromRaw(
  raw: Record<string, unknown>,
  index: number,
  account: AccountBookAccount,
  holdingBySymbol: Map<string, HoldingRecord>,
): AccountBookPosition | null {
  const symbol = cleanSymbol(
    firstText(raw.symbol, raw.code, raw.securityCode, raw.ticker, raw.vtSymbol, raw.instrumentId),
  );
  if (!symbol) return null;
  const holding = holdingBySymbol.get(symbol);
  const quantity = firstNumber(raw.quantity, raw.volume, raw.position, raw.balance, raw.totalQty, raw.totalQuantity);
  const price = firstNumber(raw.price, raw.currentPrice, raw.lastPrice, raw.nav, raw.costPrice);
  const marketValue = firstNumber(raw.marketValue, raw.value, raw.amount, raw.market_value) || quantity * price;
  const costValue = firstNumber(raw.costValue, raw.cost, raw.costAmount, raw.cost_value);
  const direction = cleanText(firstText(raw.direction, raw.side, raw.positionSide));
  return {
    key: `${account.key}:${symbol}:${direction || "net"}:${index}`,
    accountId: account.id,
    accountKey: account.key,
    accountName: account.accountName,
    bridge: account.bridge,
    route: account.route,
    symbol,
    name: cleanText(firstText(raw.name, raw.securityName, raw.displayName)) || holding?.name || symbol,
    exchange: cleanText(firstText(raw.exchange, raw.market, raw.exchangeId)),
    direction,
    currency: cleanText(firstText(raw.currency)) || account.currency || holding?.currency || "",
    quantity,
    available: firstNumber(raw.available, raw.availableVolume, raw.canSell, raw.sellable, raw.availableQuantity),
    price,
    marketValue,
    costValue,
    unrealizedPnl: firstNumber(raw.unrealizedPnl, raw.pnl, raw.profit, raw.floatProfit),
    raw,
  };
}

function reconcileSymbol(
  symbol: string,
  accountId: string,
  holdings: HoldingRecord[],
  positions: AccountBookPosition[],
): PortfolioReconcileRow {
  const brokerQuantity = sum(positions.map((position) => position.quantity));
  const brokerValue = sum(positions.map((position) => position.marketValue));
  const localQuantity = sum(holdings.map((holding) => holding.quantity));
  const localValue = sum(holdings.map((holding) => holding.quantity * holding.currentPrice));
  const quantityDiff = brokerQuantity - localQuantity;
  const valueDiff = brokerValue - localValue;
  const valueDiffPct = localValue > 0 ? (valueDiff / localValue) * 100 : null;
  const valueTolerance = Math.max(VALUE_TOLERANCE_FLOOR, localValue * VALUE_TOLERANCE_RATE);
  const status = reconcileStatus({
    brokerQuantity,
    brokerValue,
    localQuantity,
    localValue,
    quantityDiff,
    valueDiff,
    valueTolerance,
  });
  return {
    key: reconciliationKey(accountId, symbol),
    accountId,
    accountName: positions[0]?.accountName || (accountId ? accountId : "待归属"),
    symbol,
    name: holdings[0]?.name || positions[0]?.name || symbol,
    currency: holdings[0]?.currency || positions[0]?.currency || "",
    status,
    tone: toneForStatus(status),
    localQuantity,
    brokerQuantity,
    quantityDiff,
    localValue,
    brokerValue,
    valueDiff,
    valueDiffPct,
    accounts: Array.from(new Set(positions.map((position) => position.accountName).filter(Boolean))),
    summary: reconcileSummary(status, quantityDiff, valueDiff),
  };
}

function reconcileStatus({
  brokerQuantity,
  brokerValue,
  localQuantity,
  localValue,
  quantityDiff,
  valueDiff,
  valueTolerance,
}: {
  brokerQuantity: number;
  brokerValue: number;
  localQuantity: number;
  localValue: number;
  quantityDiff: number;
  valueDiff: number;
  valueTolerance: number;
}): PortfolioReconcileStatus {
  if (localQuantity <= QUANTITY_TOLERANCE && localValue <= VALUE_TOLERANCE_FLOOR && (brokerQuantity > QUANTITY_TOLERANCE || brokerValue > VALUE_TOLERANCE_FLOOR)) {
    return "extra";
  }
  if ((localQuantity > QUANTITY_TOLERANCE || localValue > VALUE_TOLERANCE_FLOOR) && brokerQuantity <= QUANTITY_TOLERANCE && brokerValue <= VALUE_TOLERANCE_FLOOR) {
    return "missing";
  }
  if (Math.abs(quantityDiff) > QUANTITY_TOLERANCE || Math.abs(valueDiff) > valueTolerance) {
    return "drift";
  }
  return "matched";
}

function summarizeReconcileRows(rows: PortfolioReconcileRow[]): PortfolioReconcileSummary {
  const matched = rows.filter((row) => row.status === "matched").length;
  const drift = rows.filter((row) => row.status === "drift").length;
  const missing = rows.filter((row) => row.status === "missing").length;
  const extra = rows.filter((row) => row.status === "extra").length;
  const localValue = sum(rows.map((row) => row.localValue));
  const brokerValue = sum(rows.map((row) => row.brokerValue));
  const valueDiff = brokerValue - localValue;
  const tone = missing || extra ? "negative" : drift ? "caution" : rows.length ? "positive" : "neutral";
  return {
    total: rows.length,
    matched,
    drift,
    missing,
    extra,
    localValue,
    brokerValue,
    valueDiff,
    tone,
    headline: headlineForSummary({ drift, extra, matched, missing, total: rows.length }),
  };
}

function headlineForSummary({
  drift,
  extra,
  matched,
  missing,
  total,
}: Pick<PortfolioReconcileSummary, "drift" | "extra" | "matched" | "missing" | "total">) {
  if (!total) return "等待账户回报";
  if (missing || extra) return `发现 ${missing + extra} 个缺口`;
  if (drift) return `${drift} 个持仓有偏差`;
  return `${matched} 个持仓已匹配`;
}

function reconcileSummary(status: PortfolioReconcileStatus, quantityDiff: number, valueDiff: number) {
  if (status === "extra") return "账户有，本地未记录";
  if (status === "missing") return "本地有，账户未返回";
  if (status === "drift") {
    const quantityText = Math.abs(quantityDiff) > QUANTITY_TOLERANCE ? `数量差 ${formatSigned(quantityDiff)}` : "";
    const valueText = Math.abs(valueDiff) > VALUE_TOLERANCE_FLOOR ? `市值差 ${formatSigned(valueDiff)}` : "";
    return [quantityText, valueText].filter(Boolean).join(" · ") || "数量或市值偏差";
  }
  return "已匹配";
}

function toneForStatus(status: PortfolioReconcileStatus) {
  if (status === "matched") return "positive";
  if (status === "drift") return "caution";
  if (status === "missing" || status === "extra") return "negative";
  return "neutral";
}

function compareReconcileRows(left: PortfolioReconcileRow, right: PortfolioReconcileRow) {
  const rank: Record<PortfolioReconcileStatus, number> = {
    missing: 0,
    extra: 1,
    drift: 2,
    matched: 3,
  };
  const rankDiff = rank[left.status] - rank[right.status];
  if (rankDiff !== 0) return rankDiff;
  return Math.abs(right.valueDiff) - Math.abs(left.valueDiff);
}

function positionsByAccountAndSymbol(positions: AccountBookPosition[]) {
  return positions.reduce((map, position) => {
    const key = reconciliationKey(position.accountId, position.symbol);
    const current = map.get(key) ?? [];
    current.push(position);
    map.set(key, current);
    return map;
  }, new Map<string, AccountBookPosition[]>());
}

function holdingsByAccountAndSymbol(holdings: HoldingRecord[]) {
  return holdings.reduce((map, holding) => {
    const key = reconciliationKey(holding.accountId ?? "", holding.symbol);
    const current = map.get(key) ?? [];
    current.push(holding);
    map.set(key, current);
    return map;
  }, new Map<string, HoldingRecord[]>());
}

function reconciliationKey(accountId: string, symbol: string) {
  return `${cleanText(accountId) || "unassigned"}:${cleanSymbol(symbol)}`;
}

function holdingsBySymbol(holdings: HoldingRecord[]) {
  return holdings.reduce((map, holding) => {
    map.set(cleanSymbol(holding.symbol), holding);
    return map;
  }, new Map<string, HoldingRecord>());
}

function dominantCurrency(currencies: string[]) {
  const normalized = Array.from(new Set(currencies.map(cleanText).filter(Boolean)));
  if (normalized.length === 1) return normalized[0];
  if (normalized.length > 1) return "MIXED";
  return "";
}

function cleanSymbol(value: unknown) {
  return cleanText(value).toUpperCase();
}

function cleanText(value: unknown) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function firstText(...values: unknown[]) {
  return values.find((value) => cleanText(value)) ?? "";
}

function firstNumber(...values: unknown[]) {
  for (const value of values) {
    const parsed = finiteNumber(value);
    if (parsed !== 0) return parsed;
  }
  return 0;
}

function finiteNumber(value: unknown) {
  const parsed = typeof value === "number"
    ? value
    : Number.parseFloat(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + (Number.isFinite(value) ? value : 0), 0);
}

function timeValue(value: string) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatSigned(value: number) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${Number.isInteger(value) ? value : value.toFixed(2)}`;
}
