import {
  cancelOrder,
  prepareOrder,
  routeQuantOrder,
  submitOrder,
  syncAccount,
  syncMarketQuote,
  syncOrderStatus,
  type BrokerBridgeKind,
  type BrokerBridgeStatus,
  type BrokerAccountSnapshot,
  type MarketQuoteSnapshot,
  type OrderCommandResult,
  type QuantOrderRouteResult,
} from "./broker-bridge";
import type { OrderRecord } from "./order-store";
import type { QbotPreset } from "./strategy-engine";

export type BrokerMode = "local-paper" | "qbot-bridge" | "live-gateway";

export type BrokerAdapterAction =
  | "prepareOrder"
  | "submitOrder"
  | "cancelOrder"
  | "syncOrders"
  | "syncAccount"
  | "syncQuote";

export type BrokerAdapterCapability = {
  key: BrokerAdapterAction;
  label: string;
  ready: boolean;
  detail: string;
};

export type BrokerAdapterPlan = {
  bridge: BrokerBridgeKind;
  mode: BrokerMode;
  label: string;
  routeLabel: string;
  ready: boolean;
  summary: string;
  statusLabel: string;
  path: string;
  pathReady: boolean;
  adapterReady: boolean;
  runtimeReady: boolean;
  capabilities: BrokerAdapterCapability[];
  warnings: string[];
  nextActions: string[];
  commandPreview: string[];
};

export type RouteOrderThroughAdapterInput = {
  allowLive?: boolean;
  mode: BrokerMode;
  order: OrderRecord;
  preset: QbotPreset;
  riskOverride: boolean;
};

export type OrderCommandThroughAdapterInput = RouteOrderThroughAdapterInput;

export type AccountSyncThroughAdapterInput = {
  allowLive?: boolean;
  mode: BrokerMode;
  preset: QbotPreset;
  riskOverride: boolean;
};

export type MarketQuoteThroughAdapterInput = AccountSyncThroughAdapterInput & {
  assetType?: string;
  market: string;
  name: string;
  referencePrice?: number | null;
  symbol: string;
};

export function brokerModeToBridge(mode: BrokerMode): BrokerBridgeKind {
  if (mode === "qbot-bridge") return "qbot";
  if (mode === "live-gateway") return "vnpy";
  return "local-paper";
}

export function buildBrokerAdapterPlan(statuses: BrokerBridgeStatus[], mode: BrokerMode): BrokerAdapterPlan {
  const bridge = brokerModeToBridge(mode);
  if (bridge === "local-paper") {
    return {
      bridge,
      mode,
      label: "本地模拟",
      routeLabel: "本地模拟",
      ready: true,
      summary: "本地模拟盘可直接排队，不触达真实账户。",
      statusLabel: "可排队",
      path: "local",
      pathReady: true,
      adapterReady: true,
      runtimeReady: true,
      capabilities: localCapabilities(),
      warnings: [],
      nextActions: ["把订单队列持久化到 App Data，支持回放和审计。"],
      commandPreview: [],
    };
  }

  const status = statuses.find((item) => item.bridge === bridge);
  if (!status) {
    return missingProbePlan(bridge, mode);
  }

  const ready = status.commandAvailable;
  return {
    bridge,
    mode,
    label: status.label,
    routeLabel: status.routeLabel,
    ready,
    summary: ready ? adapterReadySummary(bridge) : status.summary,
    statusLabel: ready ? "可路由" : "待配置",
    path: status.path,
    pathReady: status.pathExists,
    adapterReady: status.adapterExists,
    runtimeReady: status.pythonOk,
    capabilities: adapterCapabilities(bridge, ready),
    warnings: status.warnings,
    nextActions: nextActionsForStatus(status),
    commandPreview: status.commandPreview,
  };
}

export async function routeOrderThroughAdapter({
  allowLive = false,
  mode,
  order,
  preset,
  riskOverride,
}: RouteOrderThroughAdapterInput): Promise<QuantOrderRouteResult> {
  return routeQuantOrder({
    allowLive,
    bridge: brokerModeToBridge(mode),
    brokerMode: mode,
    symbol: order.symbol,
    name: order.name,
    side: order.side,
    quantity: order.quantity,
    limit: order.limit,
    amount: order.amount,
    weight: order.weight,
    strategy: preset.strategy,
    platform: preset.platform,
    tradeType: preset.tradeType,
    riskOverride,
  });
}

export async function prepareOrderThroughAdapter(input: OrderCommandThroughAdapterInput): Promise<OrderCommandResult> {
  return prepareOrder(orderCommandRequestFor(input));
}

export async function submitOrderThroughAdapter(input: OrderCommandThroughAdapterInput): Promise<OrderCommandResult> {
  return submitOrder(orderCommandRequestFor(input));
}

export async function cancelOrderThroughAdapter(input: OrderCommandThroughAdapterInput): Promise<OrderCommandResult> {
  return cancelOrder(orderCommandRequestFor(input));
}

export async function syncOrderStatusThroughAdapter(input: OrderCommandThroughAdapterInput): Promise<OrderCommandResult> {
  return syncOrderStatus(orderCommandRequestFor(input));
}

export async function syncAccountThroughAdapter({
  allowLive = false,
  mode,
  preset,
  riskOverride,
}: AccountSyncThroughAdapterInput): Promise<BrokerAccountSnapshot> {
  return syncAccount({
    allowLive,
    bridge: brokerModeToBridge(mode),
    brokerMode: mode,
    platform: preset.platform,
    tradeType: preset.tradeType,
    strategy: preset.strategy,
    riskOverride,
  });
}

export async function syncMarketQuoteThroughAdapter({
  allowLive = false,
  assetType,
  market,
  mode,
  name,
  preset,
  referencePrice,
  riskOverride,
  symbol,
}: MarketQuoteThroughAdapterInput): Promise<MarketQuoteSnapshot> {
  return syncMarketQuote({
    allowLive,
    assetType,
    bridge: brokerModeToBridge(mode),
    brokerMode: mode,
    market,
    name,
    platform: preset.platform,
    referencePrice,
    riskOverride,
    strategy: preset.strategy,
    symbol,
    tradeType: preset.tradeType,
  });
}

function orderCommandRequestFor({
  allowLive = false,
  mode,
  order,
  preset,
  riskOverride,
}: OrderCommandThroughAdapterInput) {
  return {
    allowLive,
    bridge: brokerModeToBridge(mode),
    brokerMode: mode,
    orderId: order.id,
    orderRef: order.orderRef,
    currentStatus: order.status,
    symbol: order.symbol,
    name: order.name,
    side: order.side,
    quantity: order.quantity,
    limit: order.limit,
    amount: order.amount,
    weight: order.weight,
    strategy: preset.strategy,
    platform: preset.platform,
    tradeType: preset.tradeType,
    riskOverride,
  };
}

function missingProbePlan(bridge: BrokerBridgeKind, mode: BrokerMode): BrokerAdapterPlan {
  const label = bridge === "qbot" ? "Qbot TradeEngine" : "vn.py Gateway";
  return {
    bridge,
    mode,
    label,
    routeLabel: label,
    ready: false,
    summary: "还没有完成本机通道探测。",
    statusLabel: "待探测",
    path: "未探测",
    pathReady: false,
    adapterReady: false,
    runtimeReady: false,
    capabilities: adapterCapabilities(bridge, false),
    warnings: ["点击重新探测，确认本机工作区、Python 和 adapter 是否可用。"],
    nextActions: ["重新探测本机通道。"],
    commandPreview: [],
  };
}

function adapterReadySummary(bridge: BrokerBridgeKind) {
  if (bridge === "qbot") return "Qbot JSON adapter 已可接收委托命令。";
  if (bridge === "vnpy") return "vn.py Gateway adapter 已可接收委托命令。";
  return "本地模拟盘可直接排队。";
}

function adapterCapabilities(bridge: BrokerBridgeKind, ready: boolean): BrokerAdapterCapability[] {
  if (bridge === "qbot") {
    return [
      { key: "syncAccount", label: "账户登录", ready, detail: "login / trader_opts" },
      { key: "syncQuote", label: "行情回填", ready, detail: "quote JSON" },
      { key: "syncOrders", label: "订单同步", ready, detail: "JSON adapter" },
      { key: "prepareOrder", label: "预备委托", ready, detail: "TradeEngine 参数" },
      { key: "submitOrder", label: "真实提交", ready, detail: "RPORTFOLIO_QBOT_COMMAND" },
      { key: "cancelOrder", label: "撤单", ready, detail: "RPORTFOLIO_QBOT_COMMAND" },
    ];
  }

  if (bridge === "vnpy") {
    return [
      { key: "syncAccount", label: "网关登录", ready, detail: "MainEngine / Gateway" },
      { key: "syncQuote", label: "行情回填", ready, detail: "MainEngine.get_tick" },
      { key: "syncOrders", label: "订单同步", ready, detail: "MainEngine.get_all_orders" },
      { key: "prepareOrder", label: "预备委托", ready, detail: "send_order payload" },
      { key: "submitOrder", label: "真实提交", ready, detail: "MainEngine.send_order" },
      { key: "cancelOrder", label: "撤单", ready, detail: "MainEngine.cancel_order" },
    ];
  }

  return localCapabilities();
}

function localCapabilities(): BrokerAdapterCapability[] {
  return [
    { key: "prepareOrder", label: "生成委托", ready: true, detail: "本地队列" },
    { key: "syncQuote", label: "参考行情", ready: true, detail: "当前价保护" },
    { key: "syncOrders", label: "队列回放", ready: true, detail: "localStorage" },
    { key: "submitOrder", label: "模拟提交", ready: true, detail: "本地状态推进" },
    { key: "cancelOrder", label: "模拟撤单", ready: true, detail: "本地状态推进" },
  ];
}

function nextActionsForStatus(status: BrokerBridgeStatus) {
  if (!status.pathExists) return [`确认路径：${status.path}`];
  if (!status.adapterExists) return [`补齐 ${status.label} adapter 文件。`];
  if (!status.pythonOk) return ["配置可用 Python 运行时。"];
  if (!status.commandAvailable) return ["补齐 adapter 探测条件后重新探测。"];
  return ["配置账户密钥/网关登录。", "执行小额委托 smoke test，并确认订单回报。"];
}
