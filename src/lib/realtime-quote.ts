import { invoke } from "@tauri-apps/api/core";

export type RealtimeAssetQuoteRequest = {
  symbol: string;
  name?: string;
  market?: string;
  referencePrice?: number | null;
};

export type RealtimeAssetQuotePoint = {
  time: string;
  price: number;
  volume: number;
};

export type RealtimeAssetQuoteSnapshot = {
  accepted: boolean;
  symbol: string;
  name: string;
  market: string;
  source: string;
  sourceLabel: string;
  status: string;
  session: string;
  last: number | null;
  previousClose: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
  change: number | null;
  changePct: number | null;
  bid: number | null;
  ask: number | null;
  spreadBps: number | null;
  syncedAt: string;
  message: string;
  warnings: string[];
  points: RealtimeAssetQuotePoint[];
};

export async function syncRealtimeAssetQuote(request: RealtimeAssetQuoteRequest): Promise<RealtimeAssetQuoteSnapshot> {
  if ("__TAURI_INTERNALS__" in window) {
    return invoke<RealtimeAssetQuoteSnapshot>("sync_realtime_asset_quote", { request });
  }
  return previewRealtimeAssetQuote(request);
}

function previewRealtimeAssetQuote(request: RealtimeAssetQuoteRequest): RealtimeAssetQuoteSnapshot {
  const reference = typeof request.referencePrice === "number" && Number.isFinite(request.referencePrice) && request.referencePrice > 0
    ? request.referencePrice
    : null;
  const points = reference ? previewPoints(reference) : [];
  const last = points[points.length - 1]?.price ?? reference;
  const previousClose = reference ? reference * 0.996 : null;
  const change = last != null && previousClose ? last - previousClose : null;
  const changePct = change != null && previousClose ? change / previousClose * 100 : null;
  const spreadBps = request.market === "US" ? 2 : 6;
  const halfSpread = last ? last * spreadBps / 20_000 : 0;
  return {
    accepted: false,
    symbol: request.symbol.trim().toUpperCase(),
    name: request.name?.trim() ?? "",
    market: request.market?.trim() ?? "",
    source: "web-preview",
    sourceLabel: "Web 预览",
    status: "preview",
    session: "preview",
    last,
    previousClose,
    open: points[0]?.price ?? reference,
    high: points.length ? Math.max(...points.map((point) => point.price)) : reference,
    low: points.length ? Math.min(...points.map((point) => point.price)) : reference,
    volume: points.length ? points.reduce((sum, point) => sum + point.volume, 0) : null,
    change,
    changePct,
    bid: last ? last - halfSpread : null,
    ask: last ? last + halfSpread : null,
    spreadBps: last ? spreadBps : null,
    syncedAt: new Date().toISOString(),
    message: "浏览器预览使用本地参考价；桌面版会调用 Tauri 行情接口。",
    warnings: ["Web 预览不是实时行情。"],
    points,
  };
}

function previewPoints(reference: number) {
  const now = Date.now();
  return Array.from({ length: 48 }, (_, index) => {
    const progress = index / 47;
    const drift = (progress - 0.5) * reference * 0.008;
    const wave = Math.sin(progress * Math.PI * 3.2) * reference * 0.004;
    const price = reference + drift + wave;
    return {
      time: new Date(now - (47 - index) * 60_000).toISOString(),
      price,
      volume: Math.round(50_000 + Math.abs(Math.sin(progress * Math.PI * 4)) * 240_000),
    };
  });
}
