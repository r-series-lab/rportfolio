import { invoke } from "@tauri-apps/api/core";
import type { ExecutionQuote } from "./execution-quality";

export type BrokerBridgeKind = "local-paper" | "qbot" | "vnpy";

export type BrokerBridgeProbeRequest = {
  bridge?: BrokerBridgeKind;
  qbotPath?: string;
  vnpyPath?: string;
  python?: string;
};

export type BrokerBridgeStatus = {
  bridge: BrokerBridgeKind;
  label: string;
  path: string;
  pathExists: boolean;
  adapterExists: boolean;
  pythonOk: boolean;
  commandAvailable: boolean;
  routeLabel: string;
  summary: string;
  warnings: string[];
  capabilities: string[];
  commandPreview: string[];
};

export type QuantOrderRouteRequest = {
  bridge: BrokerBridgeKind;
  brokerMode: string;
  symbol: string;
  name: string;
  side: string;
  quantity: string;
  limit: string;
  amount: string;
  weight: string;
  strategy: string;
  platform: string;
  tradeType: string;
  riskOverride: boolean;
  allowLive?: boolean;
};

export type QuantOrderRouteResult = {
  accepted: boolean;
  submitted: boolean;
  bridge: BrokerBridgeKind;
  route: string;
  status: string;
  orderRef: string;
  message: string;
  warnings: string[];
  commandPreview: string[];
};

export type OrderCommandAction = "prepareOrder" | "submitOrder" | "cancelOrder" | "syncOrderStatus";

export type OrderCommandRequest = QuantOrderRouteRequest & {
  orderId?: string;
  orderRef?: string;
  currentStatus?: string;
};

export type OrderCommandResult = QuantOrderRouteResult & {
  action: OrderCommandAction;
  orderId: string;
  eventLabel: string;
};

export type BrokerAccountSyncRequest = {
  bridge: BrokerBridgeKind;
  brokerMode: string;
  platform: string;
  tradeType: string;
  strategy: string;
  riskOverride: boolean;
  allowLive?: boolean;
};

export type BrokerAccountSnapshot = {
  accepted: boolean;
  bridge: BrokerBridgeKind | string;
  route: string;
  status: string;
  accountId: string;
  accountName: string;
  currency: string;
  cash: number;
  availableCash?: number;
  settledCash?: number;
  pendingSettlement?: number;
  marketValue: number;
  equity: number;
  positions: Array<Record<string, unknown>>;
  orders: Array<Record<string, unknown>>;
  trades: Array<Record<string, unknown>>;
  warnings: string[];
  commandPreview: string[];
  syncedAt: string;
  message: string;
};

export type MarketQuoteRequest = {
  bridge: BrokerBridgeKind;
  brokerMode: string;
  symbol: string;
  name: string;
  market: string;
  assetType?: string;
  referencePrice?: number | null;
  platform: string;
  tradeType: string;
  strategy: string;
  riskOverride: boolean;
  allowLive?: boolean;
};

export type MarketQuoteSnapshot = ExecutionQuote & {
  accepted: boolean;
  bridge: BrokerBridgeKind | string;
  route: string;
  status: string;
  symbol: string;
  name: string;
  market: string;
  assetType: string;
  currency: string;
  warnings: string[];
  commandPreview: string[];
  syncedAt: string;
  message: string;
};

const PREVIEW_BRIDGES: BrokerBridgeStatus[] = [
  {
    bridge: "qbot",
    label: "Qbot TradeEngine",
    path: "/Users/ikiru/Documents/Qbot",
    pathExists: true,
    adapterExists: false,
    pythonOk: true,
    commandAvailable: false,
    routeLabel: "Qbot Bridge",
    summary: "Qbot adapter not ready",
    warnings: ["浏览器预览模式；Tauri 内会调用 Rust command 探测本地 Qbot。"],
    capabilities: ["trader_opts", "login", "get_positions", "start_trade"],
    commandPreview: [
      "cd /Users/ikiru/Documents/Qbot",
      "python3 -c \"from qbot.engine.trade.trade_engine import TradeEngine\"",
    ],
  },
  {
    bridge: "vnpy",
    label: "vn.py Gateway",
    path: "/Users/ikiru/Documents/vnpy",
    pathExists: true,
    adapterExists: true,
    pythonOk: true,
    commandAvailable: true,
    routeLabel: "vn.py Gateway",
    summary: "vn.py gateway adapter ready",
    warnings: ["浏览器预览模式；Tauri 内会调用 Rust command 探测本地 vn.py。"],
    capabilities: ["EventEngine", "MainEngine", "BaseGateway", "send_order"],
    commandPreview: [
      "cd /Users/ikiru/Documents/vnpy",
      "python3 -c \"from vnpy.trader.gateway import BaseGateway\"",
    ],
  },
];

export async function probeBrokerBridge(request: BrokerBridgeProbeRequest = {}): Promise<BrokerBridgeStatus[]> {
  if ("__TAURI_INTERNALS__" in window) {
    return invoke<BrokerBridgeStatus[]>("probe_broker_bridge", { request });
  }

  if (request.bridge) {
    return PREVIEW_BRIDGES.filter((item) => item.bridge === request.bridge);
  }
  return PREVIEW_BRIDGES;
}

export async function routeQuantOrder(request: QuantOrderRouteRequest): Promise<QuantOrderRouteResult> {
  if ("__TAURI_INTERNALS__" in window) {
    return invoke<QuantOrderRouteResult>("route_quant_order", { request });
  }

  const bridge = request.bridge;
  const previewStatus = PREVIEW_BRIDGES.find((item) => item.bridge === bridge);
  const accepted = bridge === "local-paper" || Boolean(previewStatus?.commandAvailable);
  return {
    accepted,
    submitted: false,
    bridge,
    route: bridge === "local-paper" ? "Local Paper" : previewStatus?.routeLabel ?? bridge,
    status: accepted ? (bridge === "local-paper" ? "queued" : "prepared") : "missing_adapter",
    orderRef: `${bridge}-${request.symbol}-${Date.now()}`,
    message: accepted
      ? `${request.side} ${request.symbol} routed to ${bridge}`
      : `${bridge} adapter is not ready`,
    warnings: previewStatus?.warnings ?? [],
    commandPreview: [
      ...(previewStatus?.commandPreview ?? []),
      `order ${request.side} ${request.symbol} qty=${request.quantity} limit=${request.limit}`,
    ],
  };
}

export async function prepareOrder(request: OrderCommandRequest): Promise<OrderCommandResult> {
  return invokeOrderCommand("prepareOrder", "prepare_order", request);
}

export async function submitOrder(request: OrderCommandRequest): Promise<OrderCommandResult> {
  return invokeOrderCommand("submitOrder", "submit_order", request);
}

export async function cancelOrder(request: OrderCommandRequest): Promise<OrderCommandResult> {
  return invokeOrderCommand("cancelOrder", "cancel_order", request);
}

export async function syncOrderStatus(request: OrderCommandRequest): Promise<OrderCommandResult> {
  return invokeOrderCommand("syncOrderStatus", "sync_order_status", request);
}

export async function syncAccount(request: BrokerAccountSyncRequest): Promise<BrokerAccountSnapshot> {
  if ("__TAURI_INTERNALS__" in window) {
    return invoke<BrokerAccountSnapshot>("sync_account", { request });
  }
  return previewAccountSnapshot(request);
}

export async function syncMarketQuote(request: MarketQuoteRequest): Promise<MarketQuoteSnapshot> {
  if ("__TAURI_INTERNALS__" in window) {
    return invoke<MarketQuoteSnapshot>("sync_market_quote", { request });
  }
  return previewMarketQuoteSnapshot(request);
}

async function invokeOrderCommand(
  action: OrderCommandAction,
  command: string,
  request: OrderCommandRequest,
): Promise<OrderCommandResult> {
  if ("__TAURI_INTERNALS__" in window) {
    return invoke<OrderCommandResult>(command, { request });
  }
  return previewOrderCommand(action, request);
}

function previewOrderCommand(action: OrderCommandAction, request: OrderCommandRequest): OrderCommandResult {
  const bridge = request.bridge;
  const previewStatus = PREVIEW_BRIDGES.find((item) => item.bridge === bridge);
  const adapterReady = bridge === "local-paper" || Boolean(previewStatus?.commandAvailable);
  const liveAction = action === "submitOrder" || action === "cancelOrder";
  const accepted = bridge === "local-paper"
    ? true
    : adapterReady && (!liveAction || Boolean(request.allowLive));
  const status = previewCommandStatus(action, request, accepted);
  return {
    accepted,
    submitted: accepted && action === "submitOrder" && bridge === "local-paper",
    bridge,
    route: bridge === "local-paper" ? "Local Paper" : previewStatus?.routeLabel ?? bridge,
    status,
    orderRef: request.orderRef || `${bridge}-${request.symbol}-${Date.now()}`,
    message: previewCommandMessage(action, request, accepted),
    warnings: accepted
      ? previewStatus?.warnings ?? []
      : [
        bridge === "local-paper"
          ? "本地模拟命令失败。"
          : "浏览器预览模式不会触达真实 adapter；在 Tauri 内会调用 Rust command。",
      ],
    commandPreview: [
      ...(previewStatus?.commandPreview ?? []),
      `${action} ${request.side} ${request.symbol} qty=${request.quantity} limit=${request.limit}`,
    ],
    action,
    orderId: request.orderId || `${bridge}-${request.symbol}-${Date.now()}`,
    eventLabel: previewCommandLabel(action, accepted),
  };
}

function previewCommandStatus(
  action: OrderCommandAction,
  request: OrderCommandRequest,
  accepted: boolean,
) {
  if (!accepted) return action === "syncOrderStatus" ? "missing_adapter" : "live_disabled";
  if (action === "submitOrder") return request.bridge === "local-paper" ? "submitted" : "ready_to_submit";
  if (action === "cancelOrder") return request.bridge === "local-paper" ? "cancelled" : "ready_to_cancel";
  if (action === "syncOrderStatus") return request.currentStatus || "synced";
  return request.bridge === "local-paper" ? "queued" : "prepared";
}

function previewCommandMessage(action: OrderCommandAction, request: OrderCommandRequest, accepted: boolean) {
  if (!accepted) return `${request.bridge} command is not ready`;
  if (action === "submitOrder") return `${request.bridge} submit ${request.side} ${request.symbol}`;
  if (action === "cancelOrder") return `${request.bridge} cancel ${request.side} ${request.symbol}`;
  if (action === "syncOrderStatus") return `${request.bridge} sync ${request.side} ${request.symbol}`;
  return `${request.bridge} prepare ${request.side} ${request.symbol}`;
}

function previewCommandLabel(action: OrderCommandAction, accepted: boolean) {
  if (!accepted) return "命令失败";
  if (action === "submitOrder") return "已提交";
  if (action === "cancelOrder") return "已撤单";
  if (action === "syncOrderStatus") return "状态同步";
  return "已预备";
}

function previewAccountSnapshot(request: BrokerAccountSyncRequest): BrokerAccountSnapshot {
  const bridge = request.bridge;
  const previewStatus = PREVIEW_BRIDGES.find((item) => item.bridge === bridge);
  const accepted = bridge === "local-paper" || Boolean(previewStatus?.commandAvailable);
  return {
    accepted,
    bridge,
    route: bridge === "local-paper" ? "Local Paper" : previewStatus?.routeLabel ?? bridge,
    status: accepted ? "synced" : "missing_adapter",
    accountId: bridge === "local-paper" ? "local-paper" : "",
    accountName: bridge === "local-paper" ? "本地模拟账户" : previewStatus?.label ?? bridge,
    currency: "",
    cash: 0,
    marketValue: 0,
    equity: 0,
    positions: [],
    orders: [],
    trades: [],
    warnings: accepted
      ? previewStatus?.warnings ?? []
      : ["浏览器预览模式不会触达真实账户；在 Tauri 内会调用 Rust command。"],
    commandPreview: [
      ...(previewStatus?.commandPreview ?? []),
      `syncAccount platform=${request.platform} tradeType=${request.tradeType}`,
    ],
    syncedAt: new Date().toISOString(),
    message: accepted
      ? `${bridge} account sync complete`
      : `${bridge} adapter is not ready`,
  };
}

function previewMarketQuoteSnapshot(request: MarketQuoteRequest): MarketQuoteSnapshot {
  const bridge = request.bridge;
  const previewStatus = PREVIEW_BRIDGES.find((item) => item.bridge === bridge);
  const accepted = bridge === "local-paper" || Boolean(previewStatus?.commandAvailable);
  const reference = Number.isFinite(request.referencePrice ?? NaN) ? Number(request.referencePrice) : 0;
  const bid = reference > 0 ? roundPrice(reference * 0.999) : null;
  const ask = reference > 0 ? roundPrice(reference * 1.001) : null;
  return {
    accepted,
    bridge,
    route: bridge === "local-paper" ? "Local Paper" : previewStatus?.routeLabel ?? bridge,
    status: accepted ? "synced" : "missing_adapter",
    symbol: request.symbol,
    name: request.name,
    market: request.market,
    assetType: request.assetType ?? "",
    bid,
    ask,
    last: reference > 0 ? roundPrice(reference) : null,
    nav: null,
    indicativeNav: null,
    premiumDiscountPct: null,
    session: "unknown",
    source: bridge === "local-paper" ? "local-paper" : "browser-preview",
    tradableVolume: null,
    currency: "",
    warnings: accepted
      ? previewStatus?.warnings ?? []
      : ["浏览器预览模式不会触达真实行情；在 Tauri 内会调用 Rust command。"],
    commandPreview: [
      ...(previewStatus?.commandPreview ?? []),
      `syncMarketQuote symbol=${request.symbol} market=${request.market} tradeType=${request.tradeType}`,
    ],
    syncedAt: new Date().toISOString(),
    message: accepted
      ? `${bridge} market quote synced for ${request.symbol}`
      : `${bridge} market data adapter is not ready`,
  };
}

function roundPrice(value: number) {
  return Math.round(value * 10_000) / 10_000;
}
