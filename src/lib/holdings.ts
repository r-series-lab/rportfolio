export type HoldingRole = "real" | "proxy" | "watch";
export type HoldingAssetType = "stock" | "etf" | "fund" | "cash" | "other";
export type HoldingQuoteSource = "manual" | "eastmoney_tiantian" | "yahoo" | "csv";

export type FundHoldingPosition = {
  symbol: string;
  name: string;
  weight: number;
};

export type FundNavPoint = {
  date: string;
  nav: number;
};

export type FundRedemptionFeeTier = {
  label: string;
  minDays: number | null;
  maxDaysExclusive: number | null;
  rate: number;
};

export type HoldingRecord = {
  id: string;
  accountId?: string;
  symbol: string;
  name: string;
  market: string;
  currency: string;
  role: HoldingRole;
  assetType?: HoldingAssetType;
  quoteSource?: HoldingQuoteSource;
  profileKey?: string;
  quantity: number;
  costPrice: number;
  currentPrice: number;
  quoteAsOf?: string;
  confirmedNav?: number;
  confirmedNavAsOf?: string;
  fundPurchaseStatus?: string;
  fundPurchaseOpen?: boolean;
  fundPurchaseLimit?: number;
  fundRedemptionOpen?: boolean;
  fundTradeStatusAsOf?: string;
  fundHoldingsAsOf?: string;
  fundTopHoldings?: FundHoldingPosition[];
  fundNavHistory?: FundNavPoint[];
  fundRedemptionFeeSchedule?: FundRedemptionFeeTier[];
  targetMinWeight?: number;
  targetWeight: number;
  targetMaxWeight?: number;
  notes: string;
};

export const HOLDING_ROLE_OPTIONS: Array<{ key: HoldingRole; label: string; detail: string }> = [
  { key: "real", label: "本地持仓", detail: "计入本地账本市值与权重" },
  { key: "proxy", label: "代理资产", detail: "用于跟踪替代暴露" },
  { key: "watch", label: "观察资产", detail: "只观察，不进仓位" },
];

export const HOLDING_MARKET_OPTIONS = ["CN", "US", "Global"];
export const HOLDING_CURRENCY_OPTIONS = ["CNY", "USD"];
export const HOLDING_ASSET_TYPE_OPTIONS: Array<{ key: HoldingAssetType; label: string; detail: string }> = [
  { key: "stock", label: "股票", detail: "个股仓位" },
  { key: "etf", label: "ETF", detail: "指数/主题基金" },
  { key: "fund", label: "基金", detail: "公募基金净值" },
  { key: "cash", label: "现金", detail: "现金或货基" },
  { key: "other", label: "其他", detail: "手动记录" },
];
export const HOLDING_QUOTE_SOURCE_OPTIONS: Array<{ key: HoldingQuoteSource; label: string; detail: string }> = [
  { key: "manual", label: "手动", detail: "手动维护现价/净值" },
  { key: "eastmoney_tiantian", label: "东方财富 / 天天基金", detail: "公募基金资料与净值" },
  { key: "yahoo", label: "Yahoo", detail: "海外股票/ETF 参考" },
  { key: "csv", label: "CSV", detail: "本地导入或离线数据" },
];

export function holdingRoleLabel(role: HoldingRole) {
  return HOLDING_ROLE_OPTIONS.find((option) => option.key === role)?.label ?? role;
}

export function holdingAssetTypeLabel(assetType: HoldingAssetType | undefined) {
  return HOLDING_ASSET_TYPE_OPTIONS.find((option) => option.key === (assetType ?? "stock"))?.label ?? "股票";
}

export function holdingQuoteSourceLabel(quoteSource: HoldingQuoteSource | undefined) {
  return HOLDING_QUOTE_SOURCE_OPTIONS.find((option) => option.key === (quoteSource ?? "manual"))?.label ?? "手动";
}

export function isHoldingRecord(value: unknown): value is HoldingRecord {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<HoldingRecord>;
  return (
    typeof item.id === "string" &&
    (item.accountId === undefined || typeof item.accountId === "string") &&
    typeof item.symbol === "string" &&
    typeof item.name === "string" &&
    typeof item.market === "string" &&
    typeof item.currency === "string" &&
    (item.role === "real" || item.role === "proxy" || item.role === "watch") &&
    typeof item.quantity === "number" &&
    typeof item.costPrice === "number" &&
    typeof item.currentPrice === "number" &&
    typeof item.targetWeight === "number" &&
    typeof item.notes === "string"
  );
}
