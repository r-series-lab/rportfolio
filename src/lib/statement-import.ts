import Papa from "papaparse";
import type { AccountRecord, AccountStoreSnapshot } from "./accounts";
import type { HoldingAssetType, HoldingRecord } from "./holdings";
import {
  appendExternalCashFlow,
  normalizePerformanceLedger,
  type ExternalCashFlow,
  type ExternalCashFlowKind,
  type PerformanceLedger,
} from "./performance-ledger";
import {
  convertCurrency,
  isSupportedCurrency,
  normalizePortfolioValuationSettings,
  type PortfolioValuationSettings,
  type SupportedCurrency,
} from "./portfolio-valuation";
import type { TradeRecord, TradeSide } from "./trades";

export const STATEMENT_IMPORT_LEDGER_VERSION = 1;

export type StatementRecordType = "account" | "position" | "trade" | "cash-flow";
export type StatementIssueSeverity = "error" | "warning";

export type StatementImportIssue = {
  row: number;
  field: string;
  severity: StatementIssueSeverity;
  message: string;
};

export type StatementImportRow = {
  rowNumber: number;
  type: StatementRecordType;
  externalId: string;
  accountName: string;
  externalAccountId: string;
  broker: string;
  route: string;
  currency: SupportedCurrency;
  date: string;
  symbol: string;
  name: string;
  market: string;
  assetType: HoldingAssetType;
  quantity: number;
  price: number;
  costPrice: number;
  fee: number;
  side: TradeSide | "";
  cashFlowKind: ExternalCashFlowKind | "";
  amount: number;
  settledCash: number;
  availableCash: number;
  pendingSettlement: number;
  marketValue: number;
  equity: number;
  quoteAsOf: string;
  usdCnyRate: number | null;
  notes: string;
};

export type StatementImportCounts = Record<StatementRecordType, number>;

export type StatementImportPreview = {
  id: string;
  checksum: string;
  fileName: string;
  parsedAt: string;
  rowCount: number;
  rows: StatementImportRow[];
  issues: StatementImportIssue[];
  counts: StatementImportCounts;
  canApply: boolean;
};

export type StatementImportBatch = {
  id: string;
  checksum: string;
  fileName: string;
  importedAt: string;
  rowCount: number;
  warningCount: number;
  counts: StatementImportCounts;
};

export type StatementImportLedger = {
  version: typeof STATEMENT_IMPORT_LEDGER_VERSION;
  updatedAt: string;
  batches: StatementImportBatch[];
};

export type StatementImportState = {
  accountStore: AccountStoreSnapshot;
  holdings: HoldingRecord[];
  trades: TradeRecord[];
  performanceLedger: PerformanceLedger;
  importLedger: StatementImportLedger;
};

export type StatementImportApplyResult = StatementImportState & {
  applied: boolean;
  message: string;
  imported: StatementImportCounts;
};

type RawRow = Record<string, string>;

const EMPTY_COUNTS: StatementImportCounts = { account: 0, position: 0, trade: 0, "cash-flow": 0 };
const MAX_IMPORT_BATCHES = 200;

const HEADER_ALIASES: Record<string, keyof RawRow> = {
  recordtype: "record_type",
  type: "record_type",
  类型: "record_type",
  记录类型: "record_type",
  externalid: "external_id",
  transactionid: "external_id",
  外部编号: "external_id",
  流水号: "external_id",
  account: "account_name",
  accountname: "account_name",
  账户: "account_name",
  账户名称: "account_name",
  accountid: "account_id",
  brokeraccountid: "account_id",
  账户编号: "account_id",
  broker: "broker",
  券商: "broker",
  route: "route",
  通道: "route",
  currency: "currency",
  币种: "currency",
  date: "date",
  tradedate: "date",
  日期: "date",
  成交日期: "date",
  symbol: "symbol",
  code: "symbol",
  代码: "symbol",
  证券代码: "symbol",
  name: "name",
  名称: "name",
  证券名称: "name",
  market: "market",
  市场: "market",
  assettype: "asset_type",
  资产类型: "asset_type",
  quantity: "quantity",
  qty: "quantity",
  数量: "quantity",
  price: "price",
  currentprice: "price",
  价格: "price",
  当前价: "price",
  成交价: "price",
  costprice: "cost_price",
  成本价: "cost_price",
  fee: "fee",
  commission: "fee",
  费用: "fee",
  手续费: "fee",
  side: "side",
  direction: "side",
  方向: "side",
  kind: "kind",
  cashflowkind: "kind",
  现金流类型: "kind",
  amount: "amount",
  金额: "amount",
  settledcash: "settled_cash",
  已结算现金: "settled_cash",
  availablecash: "available_cash",
  可用现金: "available_cash",
  pendingsettlement: "pending_settlement",
  待交收: "pending_settlement",
  marketvalue: "market_value",
  市值: "market_value",
  equity: "equity",
  权益: "equity",
  quoteasof: "quote_as_of",
  pricedate: "quote_as_of",
  价格日期: "quote_as_of",
  usdcnyrate: "usd_cny_rate",
  美元人民币汇率: "usd_cny_rate",
  notes: "notes",
  note: "notes",
  备注: "notes",
};

export function emptyStatementImportLedger(): StatementImportLedger {
  return { version: STATEMENT_IMPORT_LEDGER_VERSION, updatedAt: "", batches: [] };
}

export function parseStatementCsv(
  content: string,
  fileName: string,
  valuationValue: PortfolioValuationSettings,
  now = new Date(),
): StatementImportPreview {
  const valuation = normalizePortfolioValuationSettings(valuationValue);
  const parsed = Papa.parse<RawRow>(stripBom(content), {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: normalizeHeader,
  });
  const issues: StatementImportIssue[] = parsed.errors.map((error) => ({
    row: typeof error.row === "number" ? error.row + 2 : 1,
    field: "csv",
    severity: "error",
    message: `CSV 解析失败：${error.message}`,
  }));
  const rows = parsed.data.flatMap((raw, index) => {
    const rowNumber = index + 2;
    const result = normalizeRow(raw, rowNumber, valuation);
    issues.push(...result.issues);
    return result.row ? [result.row] : [];
  });
  if (!parsed.meta.fields?.includes("record_type")) {
    issues.unshift({ row: 1, field: "record_type", severity: "error", message: "缺少记录类型列 record_type / 记录类型。" });
  }
  const counts = rows.reduce<StatementImportCounts>((result, row) => {
    result[row.type] += 1;
    return result;
  }, { ...EMPTY_COUNTS });
  const checksum = fingerprint(`statement-v1|${stripBom(content).replace(/\r\n/g, "\n").trim()}`);
  return {
    id: `statement-${checksum}`,
    checksum,
    fileName: cleanText(fileName) || "statement.csv",
    parsedAt: now.toISOString(),
    rowCount: parsed.data.length,
    rows,
    issues: issues.sort(compareIssues),
    counts,
    canApply: rows.length > 0 && !issues.some((issue) => issue.severity === "error"),
  };
}

export function applyStatementImport(
  preview: StatementImportPreview,
  state: StatementImportState,
  valuationValue: PortfolioValuationSettings,
): StatementImportApplyResult {
  const importLedger = normalizeStatementImportLedger(state.importLedger);
  if (!preview.canApply) return failedResult(state, importLedger, "账单仍有阻断错误，未写入任何数据。");
  const referenceIssues = statementImportReferenceIssues(preview, state.accountStore);
  if (referenceIssues.some((issue) => issue.severity === "error")) {
    return failedResult(state, importLedger, "账单引用了未建立的账户，未写入任何数据。");
  }
  if (importLedger.batches.some((batch) => batch.checksum === preview.checksum)) {
    return failedResult(state, importLedger, "该账单批次已经导入，未重复写入。");
  }

  const valuation = normalizePortfolioValuationSettings(valuationValue);
  const accountStore = structuredClone(state.accountStore);
  let holdings = [...state.holdings];
  let trades = [...state.trades];
  let performanceLedger = normalizePerformanceLedger(state.performanceLedger);
  const accountIds = new Map<string, string>();

  preview.rows.forEach((row) => {
    const identity = accountIdentity(row);
    const existing = findExistingAccount(accountStore.accounts, row);
    const accountId = existing?.id ?? `account-import-${fingerprint(identity)}`;
    accountIds.set(identity, accountId);
    const current = existing ?? accountStore.accounts.find((account) => account.id === accountId);
    if (row.type === "account") {
      const account = accountFromRow(row, accountId, current, preview.parsedAt);
      accountStore.accounts = [account, ...accountStore.accounts.filter((item) => item.id !== account.id)];
    } else if (!current && !accountStore.accounts.some((account) => account.id === accountId)) {
      const shell = accountFromRow(row, accountId, undefined, preview.parsedAt);
      accountStore.accounts.push(shell);
    }
  });

  preview.rows.forEach((row) => {
    const accountId = accountIds.get(accountIdentity(row)) as string;
    if (row.type === "position") holdings = upsertHolding(holdings, holdingFromRow(row, accountId));
    if (row.type === "trade") trades = upsertTrade(trades, tradeFromRow(row, accountId));
    if (row.type === "cash-flow") {
      const flow = cashFlowFromRow(row, accountId, valuation, preview.parsedAt);
      performanceLedger = appendExternalCashFlow(performanceLedger, flow);
    }
  });

  const batch: StatementImportBatch = {
    id: preview.id,
    checksum: preview.checksum,
    fileName: preview.fileName,
    importedAt: preview.parsedAt,
    rowCount: preview.rowCount,
    warningCount: preview.issues.filter((issue) => issue.severity === "warning").length,
    counts: preview.counts,
  };
  accountStore.updatedAt = preview.parsedAt;
  const nextImportLedger: StatementImportLedger = {
    version: STATEMENT_IMPORT_LEDGER_VERSION,
    updatedAt: preview.parsedAt,
    batches: [batch, ...importLedger.batches].slice(0, MAX_IMPORT_BATCHES),
  };
  return {
    accountStore,
    holdings,
    trades,
    performanceLedger,
    importLedger: nextImportLedger,
    applied: true,
    message: `已整批应用 ${preview.rowCount} 行账单数据。`,
    imported: preview.counts,
  };
}

export function statementImportReferenceIssues(
  preview: StatementImportPreview,
  accountStore: AccountStoreSnapshot,
): StatementImportIssue[] {
  const declaredAccounts = new Set(preview.rows.filter((row) => row.type === "account").map(accountIdentity));
  const seen = new Set<string>();
  return preview.rows.flatMap((row) => {
    if (row.type === "account") return [];
    const identity = accountIdentity(row);
    if (declaredAccounts.has(identity) || findExistingAccount(accountStore.accounts, row) || seen.has(identity)) return [];
    seen.add(identity);
    return [error(row.rowNumber, "account_name", `账户 ${row.accountName || row.externalAccountId} 尚未建立；请在同批加入 ACCOUNT 行。`)];
  });
}

export function normalizeStatementImportLedger(value: unknown): StatementImportLedger {
  if (!value || typeof value !== "object") return emptyStatementImportLedger();
  const candidate = value as Partial<StatementImportLedger>;
  const batches = Array.isArray(candidate.batches)
    ? candidate.batches.flatMap((item) => normalizeBatch(item)).slice(0, MAX_IMPORT_BATCHES)
    : [];
  return {
    version: STATEMENT_IMPORT_LEDGER_VERSION,
    updatedAt: cleanText(candidate.updatedAt),
    batches,
  };
}

export const STATEMENT_CSV_TEMPLATE = [
  "record_type,external_id,account_name,account_id,broker,currency,date,symbol,name,market,asset_type,quantity,price,cost_price,fee,side,kind,amount,settled_cash,available_cash,pending_settlement,market_value,equity,quote_as_of,usd_cny_rate,notes",
  ["ACCOUNT", "", "人民币账户", "CN-001", "manual", "CNY", "2026-07-16", "", "", "", "", "", "", "", "", "", "", "", "100000", "98000", "0", "0", "100000", "", "", "账户余额"].join(","),
  ["POSITION", "", "人民币账户", "CN-001", "manual", "CNY", "2026-07-16", "510300", "沪深300ETF", "CN", "etf", "1000", "4.1", "3.9", "", "", "", "", "", "", "", "", "", "2026-07-16", "", "持仓"].join(","),
  ["TRADE", "T-001", "人民币账户", "CN-001", "manual", "CNY", "2026-07-16", "510300", "沪深300ETF", "CN", "etf", "100", "4.1", "4.1", "5", "buy", "", "", "", "", "", "", "", "", "", "成交"].join(","),
  ["CASH_FLOW", "F-001", "人民币账户", "CN-001", "manual", "CNY", "2026-07-16", "", "", "", "", "", "", "", "", "", "deposit", "10000", "", "", "", "", "", "", "", "入金"].join(","),
].join("\n");

function normalizeRow(raw: RawRow, rowNumber: number, valuation: PortfolioValuationSettings) {
  const issues: StatementImportIssue[] = [];
  const type = recordType(raw.record_type);
  const currency = cleanText(raw.currency).toUpperCase();
  if (!type) issues.push(error(rowNumber, "record_type", "记录类型必须是 ACCOUNT、POSITION、TRADE 或 CASH_FLOW。"));
  if (!isSupportedCurrency(currency)) issues.push(error(rowNumber, "currency", "币种只支持 CNY 或 USD。"));
  if (!type || !isSupportedCurrency(currency)) return { row: null, issues };

  const row: StatementImportRow = {
    rowNumber,
    type,
    externalId: cleanText(raw.external_id),
    accountName: cleanText(raw.account_name),
    externalAccountId: cleanText(raw.account_id),
    broker: cleanText(raw.broker) || "import",
    route: cleanText(raw.route),
    currency,
    date: cleanText(raw.date),
    symbol: cleanText(raw.symbol).toUpperCase(),
    name: cleanText(raw.name),
    market: cleanText(raw.market) || marketFor(currency),
    assetType: assetType(raw.asset_type),
    quantity: numberValue(raw.quantity),
    price: numberValue(raw.price),
    costPrice: numberValue(raw.cost_price || raw.price),
    fee: numberValue(raw.fee),
    side: tradeSide(raw.side),
    cashFlowKind: cashFlowKind(raw.kind || raw.side),
    amount: numberValue(raw.amount),
    settledCash: numberValue(raw.settled_cash),
    availableCash: raw.available_cash === undefined || cleanText(raw.available_cash) === ""
      ? numberValue(raw.settled_cash)
      : numberValue(raw.available_cash),
    pendingSettlement: numberValue(raw.pending_settlement),
    marketValue: numberValue(raw.market_value),
    equity: numberValue(raw.equity),
    quoteAsOf: cleanText(raw.quote_as_of || raw.date),
    usdCnyRate: positiveNumberOrNull(raw.usd_cny_rate),
    notes: cleanText(raw.notes),
  };

  validateNumericCells(raw, rowNumber, type, issues);
  if (!row.accountName && !row.externalAccountId) issues.push(error(rowNumber, "account_name", "账户名称或账户编号至少填写一个。"));
  if (type === "account") validateAccountRow(row, issues);
  if (type === "position") validatePositionRow(row, issues);
  if (type === "trade") validateTradeRow(row, issues);
  if (type === "cash-flow") validateCashFlowRow(row, valuation, issues);
  return { row, issues };
}

function validateNumericCells(
  raw: RawRow,
  rowNumber: number,
  type: StatementRecordType,
  issues: StatementImportIssue[],
) {
  const fields = type === "account"
    ? ["settled_cash", "available_cash", "pending_settlement", "market_value", "equity"]
    : type === "position"
      ? ["quantity", "price", "cost_price"]
      : type === "trade"
        ? ["quantity", "price", "cost_price", "fee"]
        : ["amount", "usd_cny_rate"];
  fields.forEach((field) => {
    const value = raw[field];
    if (value !== undefined && cleanText(value) && !numericText(value)) {
      issues.push(error(rowNumber, field, `${field} 必须是有效数字。`));
    }
  });
}

function validateAccountRow(row: StatementImportRow, issues: StatementImportIssue[]) {
  if (!isDateKey(row.date)) issues.push(error(row.rowNumber, "date", "账户余额必须提供 YYYY-MM-DD 账单日期。"));
  for (const [field, amount] of [["settled_cash", row.settledCash], ["available_cash", row.availableCash], ["market_value", row.marketValue], ["equity", row.equity]] as const) {
    if (!Number.isFinite(amount) || amount < 0) issues.push(error(row.rowNumber, field, `${field} 不能为负数。`));
  }
}

function validatePositionRow(row: StatementImportRow, issues: StatementImportIssue[]) {
  if (!row.symbol) issues.push(error(row.rowNumber, "symbol", "持仓缺少证券代码。"));
  if (row.quantity < 0) issues.push(error(row.rowNumber, "quantity", "持仓数量不能为负数。"));
  if (row.price < 0 || row.costPrice < 0 || (row.quantity > 0 && row.price <= 0)) issues.push(error(row.rowNumber, "price", "有数量的持仓必须提供大于 0 的当前价格，成本价不能为负数。"));
  if (!isDateKey(row.quoteAsOf)) issues.push(error(row.rowNumber, "quote_as_of", "持仓必须提供 YYYY-MM-DD 价格日期。"));
}

function validateTradeRow(row: StatementImportRow, issues: StatementImportIssue[]) {
  if (!row.symbol) issues.push(error(row.rowNumber, "symbol", "成交缺少证券代码。"));
  if (!isDateKey(row.date)) issues.push(error(row.rowNumber, "date", "成交日期必须是 YYYY-MM-DD。"));
  if (!row.side) issues.push(error(row.rowNumber, "side", "成交方向必须是 buy 或 sell。"));
  if (row.quantity <= 0 || row.price <= 0) issues.push(error(row.rowNumber, "quantity", "成交数量和价格必须大于 0。"));
  if (row.fee < 0) issues.push(error(row.rowNumber, "fee", "成交费用不能为负数。"));
  if (!row.externalId) issues.push(warning(row.rowNumber, "external_id", "成交未提供外部流水号，将使用内容指纹去重。"));
}

function validateCashFlowRow(row: StatementImportRow, valuation: PortfolioValuationSettings, issues: StatementImportIssue[]) {
  if (!isDateKey(row.date)) issues.push(error(row.rowNumber, "date", "现金流日期必须是 YYYY-MM-DD。"));
  if (!row.cashFlowKind) issues.push(error(row.rowNumber, "kind", "现金流类型必须是 deposit 或 withdrawal。"));
  if (row.amount <= 0) issues.push(error(row.rowNumber, "amount", "现金流金额必须大于 0。"));
  if (row.currency !== valuation.baseCurrency && !row.usdCnyRate) {
    issues.push(error(row.rowNumber, "usd_cny_rate", "跨币种现金流必须提供当日 USD/CNY 汇率。"));
  }
  if (!row.externalId) issues.push(warning(row.rowNumber, "external_id", "现金流未提供外部流水号，将使用内容指纹去重。"));
}

function accountFromRow(row: StatementImportRow, id: string, existing: AccountRecord | undefined, importedAt: string): AccountRecord {
  const settledCash = row.type === "account" ? row.settledCash : existing?.settledCash ?? 0;
  const pendingSettlement = row.type === "account" ? row.pendingSettlement : existing?.pendingSettlement ?? 0;
  const marketValue = row.type === "account" ? row.marketValue : existing?.marketValue ?? 0;
  const equity = row.type === "account" && row.equity > 0 ? row.equity : settledCash + pendingSettlement + marketValue;
  return {
    id,
    name: row.accountName || row.externalAccountId || existing?.name || `${row.currency} 账户`,
    broker: row.broker || existing?.broker || "import",
    route: row.route || existing?.route || "csv",
    externalAccountId: row.externalAccountId || existing?.externalAccountId || "",
    currency: row.currency,
    source: "import",
    status: existing?.status === "archived" ? "archived" : "active",
    settledCash,
    availableCash: row.type === "account" ? row.availableCash : existing?.availableCash ?? 0,
    pendingSettlement,
    marketValue,
    equity,
    lastSyncStatus: "imported",
    lastSyncMessage: "CSV 账单导入",
    syncedAt: isDateKey(row.date) ? `${row.date}T23:59:59.000Z` : importedAt,
    updatedAt: importedAt,
    notes: row.notes || existing?.notes || "",
  };
}

function holdingFromRow(row: StatementImportRow, accountId: string): HoldingRecord {
  return {
    id: `holding-import-${fingerprint(`${accountId}|${row.symbol}`)}`,
    accountId,
    symbol: row.symbol,
    name: row.name || row.symbol,
    market: row.market,
    currency: row.currency,
    role: "real",
    assetType: row.assetType,
    quoteSource: "csv",
    quantity: row.quantity,
    costPrice: row.costPrice,
    currentPrice: row.price,
    quoteAsOf: row.quoteAsOf,
    targetWeight: 0,
    notes: row.notes,
  };
}

function tradeFromRow(row: StatementImportRow, accountId: string): TradeRecord {
  const identity = row.externalId || `${accountId}|${row.date}|${row.symbol}|${row.side}|${row.quantity}|${row.price}|${row.fee}`;
  return {
    id: `trade-import-${fingerprint(identity)}`,
    accountId,
    symbol: row.symbol,
    name: row.name || row.symbol,
    side: row.side as TradeSide,
    tradeDate: row.date,
    quantity: row.quantity,
    price: row.price,
    fee: row.fee,
    currency: row.currency,
    notes: row.notes,
  };
}

function cashFlowFromRow(
  row: StatementImportRow,
  accountId: string,
  valuation: PortfolioValuationSettings,
  importedAt: string,
): ExternalCashFlow {
  const conversion: PortfolioValuationSettings = { ...valuation, usdCnyRate: row.usdCnyRate ?? valuation.usdCnyRate, fxAsOf: row.date, fxSource: "import" };
  const converted = convertCurrency(row.amount, row.currency, valuation.baseCurrency, conversion) as number;
  const identity = row.externalId || `${accountId}|${row.date}|${row.cashFlowKind}|${row.amount}|${row.currency}`;
  return {
    id: `cash-flow-import-${fingerprint(identity)}`,
    date: row.date,
    capturedAt: importedAt,
    accountId,
    kind: row.cashFlowKind as ExternalCashFlowKind,
    amount: row.amount,
    currency: row.currency,
    baseAmount: row.cashFlowKind === "deposit" ? converted : -converted,
    baseCurrency: valuation.baseCurrency,
    usdCnyRate: row.usdCnyRate ?? valuation.usdCnyRate,
    note: row.notes,
  };
}

function upsertHolding(holdings: HoldingRecord[], incoming: HoldingRecord) {
  const existing = holdings.find((holding) => holding.accountId === incoming.accountId && symbolKey(holding.symbol) === symbolKey(incoming.symbol));
  const next = existing ? { ...existing, ...incoming, id: existing.id, profileKey: existing.profileKey, targetMinWeight: existing.targetMinWeight, targetWeight: existing.targetWeight, targetMaxWeight: existing.targetMaxWeight } : incoming;
  return [next, ...holdings.filter((holding) => holding.id !== next.id && !(holding.accountId === next.accountId && symbolKey(holding.symbol) === symbolKey(next.symbol)))];
}

function upsertTrade(trades: TradeRecord[], incoming: TradeRecord) {
  return [incoming, ...trades.filter((trade) => trade.id !== incoming.id)];
}

function findExistingAccount(accounts: AccountRecord[], row: StatementImportRow) {
  return accounts.find((account) =>
    account.currency === row.currency
    && ((row.externalAccountId && account.externalAccountId === row.externalAccountId)
      || (!row.externalAccountId && account.name === row.accountName))
  );
}

function accountIdentity(row: StatementImportRow) {
  return `${row.broker}|${row.externalAccountId || row.accountName}|${row.currency}`.toLowerCase();
}

function normalizeBatch(value: unknown): StatementImportBatch[] {
  if (!value || typeof value !== "object") return [];
  const item = value as Partial<StatementImportBatch>;
  if (!cleanText(item.id) || !cleanText(item.checksum) || !validIso(item.importedAt)) return [];
  return [{
    id: cleanText(item.id),
    checksum: cleanText(item.checksum),
    fileName: cleanText(item.fileName) || "statement.csv",
    importedAt: item.importedAt,
    rowCount: nonNegativeInteger(item.rowCount),
    warningCount: nonNegativeInteger(item.warningCount),
    counts: normalizeCounts(item.counts),
  }];
}

function failedResult(state: StatementImportState, importLedger: StatementImportLedger, message: string): StatementImportApplyResult {
  return { ...state, importLedger, applied: false, message, imported: { ...EMPTY_COUNTS } };
}

function normalizeCounts(value: unknown): StatementImportCounts {
  const counts = value && typeof value === "object" ? value as Partial<StatementImportCounts> : {};
  return {
    account: nonNegativeInteger(counts.account),
    position: nonNegativeInteger(counts.position),
    trade: nonNegativeInteger(counts.trade),
    "cash-flow": nonNegativeInteger(counts["cash-flow"]),
  };
}

function normalizeHeader(value: string) {
  const normalized = value.trim().toLowerCase().replace(/[\s_-]+/g, "");
  return HEADER_ALIASES[normalized] ?? value.trim().toLowerCase();
}

function recordType(value: unknown): StatementRecordType | null {
  const key = cleanText(value).toLowerCase().replace(/[\s_-]+/g, "");
  if (key === "account" || key === "账户") return "account";
  if (key === "position" || key === "holding" || key === "持仓") return "position";
  if (key === "trade" || key === "成交") return "trade";
  if (key === "cashflow" || key === "现金流") return "cash-flow";
  return null;
}

function tradeSide(value: unknown): TradeSide | "" {
  const key = cleanText(value).toLowerCase();
  if (key === "buy" || key === "b" || key === "买" || key === "买入") return "buy";
  if (key === "sell" || key === "s" || key === "卖" || key === "卖出") return "sell";
  return "";
}

function cashFlowKind(value: unknown): ExternalCashFlowKind | "" {
  const key = cleanText(value).toLowerCase();
  if (key === "deposit" || key === "in" || key === "入金") return "deposit";
  if (key === "withdrawal" || key === "withdraw" || key === "out" || key === "出金") return "withdrawal";
  return "";
}

function assetType(value: unknown): HoldingAssetType {
  const key = cleanText(value).toLowerCase();
  if (key === "etf") return "etf";
  if (key === "fund" || key === "基金") return "fund";
  if (key === "cash" || key === "现金") return "cash";
  if (key === "other" || key === "其他") return "other";
  return "stock";
}

function marketFor(currency: SupportedCurrency) {
  return currency === "USD" ? "US" : "CN";
}

function error(row: number, field: string, message: string): StatementImportIssue {
  return { row, field, severity: "error", message };
}

function warning(row: number, field: string, message: string): StatementImportIssue {
  return { row, field, severity: "warning", message };
}

function compareIssues(left: StatementImportIssue, right: StatementImportIssue) {
  return left.row - right.row || (left.severity === "error" ? -1 : 1) || left.field.localeCompare(right.field);
}

function numberValue(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(cleanText(value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function numericText(value: unknown) {
  return /^[-+]?\d+(?:\.\d+)?$/.test(cleanText(value).replace(/,/g, ""));
}

function positiveNumberOrNull(value: unknown) {
  const parsed = numberValue(value);
  return parsed > 0 ? parsed : null;
}

function nonNegativeInteger(value: unknown) {
  return Math.max(0, Math.round(numberValue(value)));
}

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function stripBom(value: string) {
  return value.replace(/^\uFEFF/, "");
}

function isDateKey(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`));
}

function validIso(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function symbolKey(value: string) {
  return value.trim().toUpperCase();
}

function fingerprint(value: string) {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return `${(first >>> 0).toString(36)}${(second >>> 0).toString(36)}`;
}
