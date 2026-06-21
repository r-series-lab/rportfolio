import type { BrokerBridgeKind, MarketQuoteSnapshot, OrderCommandAction, OrderCommandResult, QuantOrderRouteResult } from "./broker-bridge";
import type { RiskGuardResult } from "./risk-guard";
import type { LabTone, OrderIntent, QbotPreset } from "./strategy-engine";

export type OrderRecordStatus =
  | "preview"
  | "queued"
  | "blocked"
  | "prepared"
  | "submitted"
  | "partially_filled"
  | "filled"
  | "cancelled"
  | "error";

export type OrderSourceKind = "strategy" | "manual" | "profile-monitor" | "broker-sync";

export type OrderEventType =
  | "created"
  | "queued"
  | "risk_blocked"
  | "routed"
  | "prepared"
  | "submitted"
  | "partially_filled"
  | "filled"
  | "cancelled"
  | "error"
  | "pre_submit_check"
  | "synced";

export type OrderSourceContext = {
  kind: OrderSourceKind;
  label: string;
  presetKey?: string;
  presetLabel?: string;
  profileKey?: string;
  profileName?: string;
  strategyKey?: string;
  strategyName?: string;
};

export type OrderEvent = {
  key: string;
  at: string;
  time: string;
  type: OrderEventType;
  status: OrderRecordStatus;
  tone: LabTone;
  label: string;
  detail: string;
};

export type OrderRecord = OrderIntent & {
  id: string;
  intentKey: string;
  fingerprint: string;
  sourceKind: OrderSourceKind;
  sourceLabel: string;
  profileKey: string;
  profileName: string;
  strategyKey: string;
  strategyName: string;
  presetKey: string;
  presetLabel: string;
  broker: string;
  createdAt: string;
  createdIso: string;
  updatedAt: string;
  updatedIso: string;
  submittedAt: string;
  filledAt: string;
  limit: string;
  quantity: string;
  route: string;
  source: string;
  status: OrderRecordStatus;
  routeStatus: string;
  orderRef: string;
  routeAttempts: number;
  lastError: string;
  warnings: string[];
  commandPreview: string[];
  preSubmitQuote: MarketQuoteSnapshot | null;
  preSubmitRiskSummary: string;
  events: OrderEvent[];
};

export type CreateOrderRecordInput = {
  brokerMode: string;
  index: number;
  intent: OrderIntent;
  limit?: string;
  preset: QbotPreset;
  quantity?: string;
  riskBlocked?: boolean;
  riskBlockedReason?: string;
  riskOverride: boolean;
  riskWarnings?: string[];
  source?: OrderSourceContext;
};

export type MergeOrderRecordsOptions = {
  limit?: number;
};

export type MergeOrderRecordsResult = {
  orders: OrderRecord[];
  accepted: number;
  duplicates: number;
};

export type OrderCenterSummary = {
  total: number;
  active: number;
  blocked: number;
  errored: number;
  prepared: number;
  submitted: number;
  filled: number;
  latestEvent: OrderEvent | null;
};

export type BrokerAccountOrderSnapshot = {
  orders?: Array<Record<string, unknown>>;
  route?: string;
  syncedAt?: string;
};

export type BrokerAccountReconcileResult = {
  matched: number;
  orders: OrderRecord[];
};

const DEFAULT_ORDER_CENTER_LIMIT = 24;
const ACTIVE_STATUSES = new Set<OrderRecordStatus>(["preview", "queued", "prepared", "submitted", "partially_filled"]);
const ROUTED_STATUSES = new Set<OrderRecordStatus>(["prepared", "submitted", "partially_filled", "filled"]);

export function createOrderRecordFromIntent({
  brokerMode,
  index,
  intent,
  limit,
  preset,
  quantity,
  riskBlocked,
  riskBlockedReason,
  riskOverride,
  riskWarnings,
  source,
}: CreateOrderRecordInput): OrderRecord {
  const blocked = Boolean(riskBlocked) || intent.state === "已阻断" && !riskOverride;
  const route = brokerRouteLabel(brokerMode, preset);
  const now = new Date();
  const status: OrderRecordStatus = blocked ? "blocked" : "queued";
  const tone: LabTone = blocked ? "negative" : intent.tone === "negative" ? "caution" : intent.tone;
  const warnings = uniqueWarnings(riskWarnings ?? []);
  const sourceContext = source ?? {
    kind: "strategy",
    label: "策略建议",
    presetKey: preset.key,
    presetLabel: preset.label,
  };
  const id = `ord-${now.getTime()}-${index}-${slugToken(intent.symbol)}`;
  const record: OrderRecord = {
    ...intent,
    id,
    key: id,
    intentKey: intent.key,
    fingerprint: orderIntentFingerprint(intent),
    sourceKind: sourceContext.kind,
    sourceLabel: sourceContext.label,
    profileKey: sourceContext.profileKey ?? "",
    profileName: sourceContext.profileName ?? "",
    strategyKey: sourceContext.strategyKey ?? "",
    strategyName: sourceContext.strategyName ?? "",
    presetKey: sourceContext.presetKey ?? preset.key,
    presetLabel: sourceContext.presetLabel ?? preset.label,
    broker: brokerMode,
    createdAt: shortTimeLabel(now),
    createdIso: now.toISOString(),
    updatedAt: shortTimeLabel(now),
    updatedIso: now.toISOString(),
    submittedAt: "",
    filledAt: "",
    limit: limit ?? "次日收盘",
    quantity: quantity ?? "计划拆分",
    route,
    source: preset.strategy,
    state: blocked ? "已阻断" : riskOverride ? "手动放行排队" : `${route} 已排队`,
    status,
    routeStatus: blocked ? "blocked" : "queued",
    orderRef: "",
    routeAttempts: 0,
    lastError: blocked ? riskBlockedReason || "风控阻断" : "",
    warnings,
    commandPreview: [],
    preSubmitQuote: null,
    preSubmitRiskSummary: "",
    events: [
      createOrderEvent({
        detail: blocked
          ? riskBlockedReason || "策略触发但被风控阻断。"
          : warnings[0] ?? `${sourceContext.label} 已进入订单中心。`,
        label: blocked ? "风控阻断" : "进入队列",
        status,
        tone,
        type: blocked ? "risk_blocked" : "queued",
      }, now),
    ],
    tone,
  };

  return record;
}

export function applyOrderRouteResult(order: OrderRecord, result: QuantOrderRouteResult): OrderRecord {
  const normalized = normalizeOrderRecord(order);
  const warnings = uniqueWarnings([...normalized.warnings, ...result.warnings]);
  const failed = !result.accepted || result.status === "missing_adapter" || result.status === "missing_bridge" || result.status === "route_error";
  const submitted = result.submitted || result.status === "submitted" || result.status === "ready_to_submit";
  const prepared = result.status === "prepared" || result.status === "prepared_override";
  const status: OrderRecordStatus = failed
    ? "error"
    : submitted
      ? "submitted"
      : prepared
        ? "prepared"
        : normalized.status;
  const tone: LabTone = failed ? "negative" : submitted || prepared ? "positive" : normalized.tone;
  const now = new Date();
  const eventType: OrderEventType = failed ? "error" : submitted ? "submitted" : prepared ? "prepared" : "routed";
  const route = friendlyRouteLabel(result.route || normalized.route);
  const event = createOrderEvent({
    detail: result.warnings[0] ?? result.message,
    label: failed ? "路由失败" : friendlyRouteState(result),
    status,
    tone,
    type: eventType,
  }, now);

  return {
    ...normalized,
    route,
    state: failed ? result.message : friendlyRouteState(result),
    status,
    routeStatus: result.status,
    tone,
    source: result.bridge,
    detail: warnings[0] ?? normalized.detail,
    orderRef: result.orderRef || normalized.orderRef,
    warnings,
    commandPreview: result.commandPreview,
    routeAttempts: normalized.routeAttempts + 1,
    lastError: failed ? result.message : "",
    submittedAt: submitted ? now.toISOString() : normalized.submittedAt,
    updatedAt: shortTimeLabel(now),
    updatedIso: now.toISOString(),
    events: [event, ...normalized.events].slice(0, 10),
  };
}

export function applyOrderCommandResult(order: OrderRecord, result: OrderCommandResult): OrderRecord {
  const normalized = normalizeOrderRecord(order);
  const warnings = uniqueWarnings([...normalized.warnings, ...result.warnings]);
  const failed = !result.accepted || commandFailedStatus(result.status);
  const status = commandRecordStatus(normalized.status, result);
  const tone: LabTone = failed
    ? "negative"
    : status === "submitted" || status === "prepared" || status === "filled"
      ? "positive"
      : status === "cancelled"
        ? "neutral"
        : normalized.tone;
  const now = new Date();
  const event = createOrderEvent({
    detail: result.warnings[0] ?? result.message,
    label: failed ? "命令失败" : result.eventLabel || orderStatusLabel(status),
    status,
    tone,
    type: commandEventType(result.action, status, failed),
  }, now);
  const route = friendlyRouteLabel(result.route || normalized.route);

  return {
    ...normalized,
    route,
    state: failed ? result.message : result.eventLabel || friendlyCommandState(result),
    status,
    routeStatus: result.status,
    tone,
    source: result.bridge,
    detail: warnings[0] ?? normalized.detail,
    orderRef: result.orderRef || normalized.orderRef,
    warnings,
    commandPreview: result.commandPreview,
    routeAttempts: normalized.routeAttempts + (result.action === "syncOrderStatus" ? 0 : 1),
    lastError: failed ? result.message : "",
    submittedAt: status === "submitted" && !normalized.submittedAt ? now.toISOString() : normalized.submittedAt,
    filledAt: status === "filled" && !normalized.filledAt ? now.toISOString() : normalized.filledAt,
    updatedAt: shortTimeLabel(now),
    updatedIso: now.toISOString(),
    events: [event, ...normalized.events].slice(0, 10),
  };
}

export function applyPreSubmitGuardResult(
  order: OrderRecord,
  quote: MarketQuoteSnapshot | null,
  guard: RiskGuardResult | null,
  options: { requireAcceptedQuote?: boolean } = {},
): OrderRecord {
  const normalized = normalizeOrderRecord(order);
  const quoteBlocked = Boolean(options.requireAcceptedQuote && (!quote || !quote.accepted));
  const blocked = Boolean(guard?.blocked) || quoteBlocked;
  const quoteWarnings = quote?.warnings ?? [];
  const guardWarnings = guard?.warnings ?? [];
  const warnings = uniqueWarnings([
    ...normalized.warnings,
    ...quoteWarnings,
    ...guardWarnings,
    quoteBlocked ? "提交前行情未就绪：真实提交需要先取得 broker 行情回报。" : "",
  ]);
  const now = new Date();
  const tone: LabTone = blocked ? "negative" : warnings.length ? "caution" : "positive";
  const status: OrderRecordStatus = blocked ? "blocked" : normalized.status;
  const quoteDetail = quote
    ? `${quote.symbol} ${quote.accepted ? "行情已回填" : "行情未就绪"}${quote.bid && quote.ask ? ` bid ${quote.bid} / ask ${quote.ask}` : ""}`
    : "提交前未取得行情";
  const event = createOrderEvent({
    detail: `${quoteDetail} · ${quoteBlocked ? "真实提交需要先取得 broker 行情回报。" : guard?.summary ?? "提交前风控复核完成。"}`,
    label: blocked ? "提交前阻断" : "提交前复核",
    status,
    tone,
    type: blocked ? "risk_blocked" : "pre_submit_check",
  }, now);

  return {
    ...normalized,
    detail: warnings[0] ?? normalized.detail,
    lastError: blocked ? quoteBlocked ? "提交前行情未就绪" : guard?.summary ?? "提交前风控阻断" : normalized.lastError,
    preSubmitQuote: quote,
    preSubmitRiskSummary: guard?.summary ?? "",
    routeStatus: blocked ? "pre_submit_blocked" : normalized.routeStatus,
    state: blocked ? "提交前阻断" : "提交前复核通过",
    status,
    tone,
    updatedAt: shortTimeLabel(now),
    updatedIso: now.toISOString(),
    warnings,
    events: [event, ...normalized.events].slice(0, 10),
  };
}

export function routeOrderErrorResult(bridge: BrokerBridgeKind, error: unknown): QuantOrderRouteResult {
  const message = error instanceof Error ? error.message : "route_quant_order failed";
  return {
    accepted: false,
    submitted: false,
    bridge,
    route: bridge,
    status: "route_error",
    orderRef: `error-${Date.now()}`,
    message,
    warnings: [message],
    commandPreview: [],
  };
}

export function orderCommandErrorResult(
  bridge: BrokerBridgeKind,
  action: OrderCommandAction,
  order: OrderRecord,
  error: unknown,
): OrderCommandResult {
  const message = error instanceof Error ? error.message : "order command failed";
  return {
    accepted: false,
    submitted: false,
    bridge,
    route: bridge,
    status: "command_error",
    orderRef: order.orderRef || `error-${Date.now()}`,
    message,
    warnings: [message],
    commandPreview: [],
    action,
    orderId: order.id,
    eventLabel: "命令失败",
  };
}

export function mergeOrderRecords(
  current: OrderRecord[],
  incoming: OrderRecord[],
  options: MergeOrderRecordsOptions = {},
): MergeOrderRecordsResult {
  const limit = options.limit ?? DEFAULT_ORDER_CENTER_LIMIT;
  const currentOrders: OrderRecord[] = [];
  const incomingOrders: OrderRecord[] = [];
  const currentKeys = new Set<string>();
  const incomingKeys = new Set<string>();
  let accepted = 0;
  let duplicates = 0;

  current.forEach((order) => {
    const normalized = normalizeOrderRecord(order);
    const key = orderDedupeKey(normalized);
    if (currentKeys.has(key)) return;
    currentKeys.add(key);
    currentOrders.push(normalized);
  });

  incoming.forEach((order) => {
    const normalized = normalizeOrderRecord(order);
    const key = orderDedupeKey(normalized);
    if (currentKeys.has(key) || incomingKeys.has(key)) {
      duplicates += 1;
      return;
    }
    incomingKeys.add(key);
    incomingOrders.push(normalized);
    accepted += 1;
  });

  return {
    accepted,
    duplicates,
    orders: [...incomingOrders, ...currentOrders]
      .sort((left, right) => (right.updatedIso || right.createdIso).localeCompare(left.updatedIso || left.createdIso))
      .slice(0, limit),
  };
}

export function normalizeOrderRecords(orders: OrderRecord[], limit = DEFAULT_ORDER_CENTER_LIMIT): OrderRecord[] {
  return orders.map((order, index) => normalizeOrderRecord(order, index)).slice(0, limit);
}

export function normalizeOrderRecord(order: OrderRecord, index = 0): OrderRecord {
  const partial = order as Partial<OrderRecord> & OrderIntent;
  const now = new Date();
  const createdIso = partial.createdIso || isoFromMaybeTime(partial.createdAt) || now.toISOString();
  const updatedIso = partial.updatedIso || isoFromMaybeTime(partial.updatedAt) || createdIso;
  const status = normalizeStatus(partial.status);
  const sourceKind = partial.sourceKind ?? "strategy";
  const sourceLabel = partial.sourceLabel ?? sourceLabelFor(sourceKind);
  const id = partial.id || partial.key || `ord-legacy-${index}-${slugToken(partial.symbol)}`;
  const tone = normalizeTone(partial.tone);
  const events = normalizeEvents(partial.events, {
    detail: partial.state || orderStatusLabel(status),
    status,
    tone,
  });

  return {
    ...partial,
    id,
    key: id,
    intentKey: partial.intentKey || partial.key || id,
    fingerprint: partial.fingerprint || orderIntentFingerprint(partial),
    sourceKind,
    sourceLabel,
    profileKey: partial.profileKey ?? "",
    profileName: partial.profileName ?? "",
    strategyKey: partial.strategyKey ?? "",
    strategyName: partial.strategyName ?? "",
    presetKey: partial.presetKey ?? "",
    presetLabel: partial.presetLabel ?? "",
    broker: partial.broker ?? "local-paper",
    createdAt: partial.createdAt || shortTimeLabel(new Date(createdIso)),
    createdIso,
    updatedAt: partial.updatedAt || shortTimeLabel(new Date(updatedIso)),
    updatedIso,
    submittedAt: partial.submittedAt ?? "",
    filledAt: partial.filledAt ?? "",
    limit: partial.limit ?? "次日收盘",
    quantity: partial.quantity ?? "计划拆分",
    route: partial.route ?? "本地模拟",
    source: partial.source ?? "",
    status,
    routeStatus: partial.routeStatus ?? status,
    orderRef: partial.orderRef ?? "",
    routeAttempts: partial.routeAttempts ?? (ROUTED_STATUSES.has(status) ? 1 : 0),
    lastError: partial.lastError ?? (status === "error" ? partial.state : ""),
    warnings: partial.warnings ?? [],
    commandPreview: partial.commandPreview ?? [],
    preSubmitQuote: partial.preSubmitQuote ?? null,
    preSubmitRiskSummary: partial.preSubmitRiskSummary ?? "",
    events,
    tone,
  };
}

export function summarizeOrderCenter(orders: OrderRecord[]): OrderCenterSummary {
  const normalized = normalizeOrderRecords(orders);
  return normalized.reduce<OrderCenterSummary>((summary, order) => {
    const latest = orderLatestEvent(order);
    return {
      total: summary.total + 1,
      active: summary.active + (ACTIVE_STATUSES.has(order.status) ? 1 : 0),
      blocked: summary.blocked + (order.status === "blocked" ? 1 : 0),
      errored: summary.errored + (order.status === "error" ? 1 : 0),
      prepared: summary.prepared + (order.status === "prepared" ? 1 : 0),
      submitted: summary.submitted + (order.status === "submitted" || order.status === "partially_filled" ? 1 : 0),
      filled: summary.filled + (order.status === "filled" ? 1 : 0),
      latestEvent: latest && (!summary.latestEvent || latest.at > summary.latestEvent.at) ? latest : summary.latestEvent,
    };
  }, {
    total: 0,
    active: 0,
    blocked: 0,
    errored: 0,
    prepared: 0,
    submitted: 0,
    filled: 0,
    latestEvent: null,
  });
}

export function applyBrokerAccountSnapshotToOrders(
  current: OrderRecord[],
  snapshot: BrokerAccountOrderSnapshot,
): BrokerAccountReconcileResult {
  const brokerOrders = snapshot.orders ?? [];
  if (!brokerOrders.length) {
    return { matched: 0, orders: normalizeOrderRecords(current) };
  }
  let matched = 0;
  const orders = normalizeOrderRecords(current).map((order) => {
    const raw = brokerOrders.find((item) => brokerOrderMatches(item, order));
    if (!raw) return order;
    matched += 1;
    return applyBrokerOrderSnapshot(order, raw, snapshot);
  });
  return { matched, orders };
}

export function orderLatestEvent(order: OrderRecord): OrderEvent | null {
  return normalizeOrderRecord(order).events[0] ?? null;
}

export function orderStatusLabel(status: OrderRecordStatus) {
  if (status === "preview") return "待确认";
  if (status === "queued") return "已排队";
  if (status === "blocked") return "已阻断";
  if (status === "prepared") return "已预备";
  if (status === "submitted") return "已提交";
  if (status === "partially_filled") return "部分成交";
  if (status === "filled") return "已成交";
  if (status === "cancelled") return "已撤单";
  return "异常";
}

export function orderSourceLabel(order: OrderRecord) {
  const normalized = normalizeOrderRecord(order);
  if (normalized.profileName && normalized.sourceKind !== "manual") {
    return `${normalized.sourceLabel} · ${normalized.profileName}`;
  }
  return normalized.sourceLabel;
}

export function brokerRouteLabel(mode: string, preset: QbotPreset) {
  if (mode === "qbot-bridge") return `${preset.platform} / Qbot`;
  if (mode === "live-gateway") return `${preset.platform} / vn.py`;
  return "本地模拟";
}

export function friendlyRouteLabel(route: string) {
  if (route === "Local Paper" || route === "local-paper") return "本地模拟";
  if (route === "qbot") return "Qbot";
  if (route === "vnpy") return "vn.py";
  return route;
}

export function friendlyRouteState(result: QuantOrderRouteResult) {
  if (result.status === "queued") return "已排队";
  if (result.status === "prepared" || result.status === "prepared_override") return "已预备";
  if (result.status === "ready_to_submit") return "通道就绪";
  if (result.status === "submitted") return "已提交";
  return result.message;
}

export function friendlyCommandState(result: OrderCommandResult) {
  if (result.status === "queued") return "已排队";
  if (result.status === "prepared" || result.status === "prepared_override") return "已预备";
  if (result.status === "ready_to_submit") return "等待成交回报";
  if (result.status === "ready_to_cancel") return "撤单待回报";
  if (result.status === "submitted") return "已提交";
  if (result.status === "cancelled") return "已撤单";
  if (result.status === "synced") return "状态同步";
  return result.message;
}

function commandFailedStatus(status: string) {
  return status === "missing_adapter"
    || status === "missing_bridge"
    || status === "route_error"
    || status === "live_disabled"
    || status === "command_error";
}

function commandRecordStatus(current: OrderRecordStatus, result: OrderCommandResult): OrderRecordStatus {
  if (!result.accepted || commandFailedStatus(result.status)) return "error";
  if (result.status === "submitted" || result.submitted) return "submitted";
  if (result.status === "partially_filled") return "partially_filled";
  if (result.status === "filled") return "filled";
  if (result.status === "cancelled") return "cancelled";
  if (result.status === "prepared" || result.status === "prepared_override" || result.status === "ready_to_submit" || result.status === "ready_to_cancel") {
    return current === "submitted" && result.status === "ready_to_cancel" ? "submitted" : "prepared";
  }
  if (result.status === "queued") return "queued";
  return current;
}

function commandEventType(
  action: OrderCommandAction,
  status: OrderRecordStatus,
  failed: boolean,
): OrderEventType {
  if (failed) return "error";
  if (action === "syncOrderStatus") return "synced";
  if (status === "cancelled") return "cancelled";
  if (status === "submitted") return "submitted";
  if (status === "partially_filled") return "partially_filled";
  if (status === "filled") return "filled";
  if (status === "prepared") return "prepared";
  return "queued";
}

function createOrderEvent({
  detail,
  label,
  status,
  tone,
  type,
}: {
  detail: string;
  label: string;
  status: OrderRecordStatus;
  tone: LabTone;
  type: OrderEventType;
}, date = new Date()): OrderEvent {
  return {
    key: `evt-${date.getTime()}-${type}`,
    at: date.toISOString(),
    time: shortTimeLabel(date),
    type,
    status,
    tone,
    label,
    detail,
  };
}

function normalizeEvents(
  events: OrderEvent[] | undefined,
  fallback: { detail: string; status: OrderRecordStatus; tone: LabTone },
) {
  if (events?.length) {
    return events
      .map((event, index) => ({
        ...event,
        key: event.key || `evt-legacy-${index}`,
        at: event.at || new Date().toISOString(),
        time: event.time || shortTimeLabel(new Date(event.at || Date.now())),
        status: normalizeStatus(event.status),
        tone: normalizeTone(event.tone),
      }))
      .slice(0, 10);
  }
  return [
    createOrderEvent({
      detail: fallback.detail,
      label: orderStatusLabel(fallback.status),
      status: fallback.status,
      tone: fallback.tone,
      type: fallback.status === "error" ? "error" : fallback.status === "blocked" ? "risk_blocked" : "created",
    }),
  ];
}

function applyBrokerOrderSnapshot(
  order: OrderRecord,
  raw: Record<string, unknown>,
  snapshot: BrokerAccountOrderSnapshot,
): OrderRecord {
  const status = statusFromBrokerOrder(raw, order.status);
  const now = snapshot.syncedAt ? new Date(snapshot.syncedAt) : new Date();
  const statusText = rawText(raw, ["statusText", "status"]) || orderStatusLabel(status);
  const event = createOrderEvent({
    detail: `${statusText} · ${rawText(raw, ["vtOrderId", "orderRef", "orderId"]) || order.orderRef || order.symbol}`,
    label: "账户回报",
    status,
    tone: status === "error" ? "negative" : status === "cancelled" ? "neutral" : status === "filled" ? "positive" : "caution",
    type: status === "filled" ? "filled" : status === "partially_filled" ? "partially_filled" : status === "cancelled" ? "cancelled" : status === "error" ? "error" : "synced",
  }, Number.isNaN(now.getTime()) ? new Date() : now);
  return {
    ...order,
    filledAt: status === "filled" && !order.filledAt ? event.at : order.filledAt,
    orderRef: order.orderRef || rawText(raw, ["vtOrderId", "orderRef", "orderId"]),
    route: snapshot.route || order.route,
    routeStatus: rawText(raw, ["status"]) || status,
    status,
    state: orderStatusLabel(status),
    submittedAt: (status === "submitted" || status === "partially_filled" || status === "filled") && !order.submittedAt ? event.at : order.submittedAt,
    tone: event.tone,
    updatedAt: event.time,
    updatedIso: event.at,
    events: [event, ...order.events].slice(0, 10),
  };
}

function brokerOrderMatches(raw: Record<string, unknown>, order: OrderRecord) {
  const refs = ["vtOrderId", "vt_orderid", "orderRef", "order_ref", "orderId", "orderid"]
    .map((key) => rawText(raw, [key]))
    .filter(Boolean)
    .map(normalizeToken);
  const orderRef = normalizeToken(order.orderRef);
  const orderId = normalizeToken(order.id);
  if (orderRef && refs.includes(orderRef)) return true;
  if (orderId && refs.includes(orderId)) return true;
  const rawSymbol = normalizeToken(rawText(raw, ["symbol"]));
  return Boolean(rawSymbol && rawSymbol === normalizeToken(order.symbol) && order.status === "submitted");
}

function statusFromBrokerOrder(raw: Record<string, unknown>, fallback: OrderRecordStatus): OrderRecordStatus {
  const value = normalizeToken(rawText(raw, ["status", "statusText"]));
  if (["ALLTRADED", "FILLED", "全部成交", "已成交"].includes(value)) return "filled";
  if (["PARTTRADED", "PARTIALLY_FILLED", "部分成交"].includes(value)) return "partially_filled";
  if (["CANCELLED", "CANCELED", "已撤销", "已撤单"].includes(value)) return "cancelled";
  if (["REJECTED", "ERROR", "FAILED", "废单", "异常"].includes(value)) return "error";
  if (["SUBMITTING", "NOTTRADED", "SUBMITTED", "PENDING", "未成交", "已提交"].includes(value)) return "submitted";
  return fallback;
}

function rawText(raw: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = raw[key];
    if (value !== null && value !== undefined && String(value).trim()) return String(value).trim();
  }
  return "";
}

function orderDedupeKey(order: OrderRecord) {
  if (order.sourceKind === "manual") return order.id;
  if (!ACTIVE_STATUSES.has(order.status)) return order.id;
  return [
    order.sourceKind,
    order.profileKey,
    order.strategyKey,
    order.broker,
    order.fingerprint,
  ].map(normalizeToken).join("|");
}

function orderIntentFingerprint(intent: OrderIntent) {
  return [
    intent.symbol,
    intent.side,
    intent.amount,
    intent.weight,
  ].map(normalizeToken).join("|");
}

function normalizeStatus(status: OrderRecordStatus | string | undefined): OrderRecordStatus {
  if (status === "preview" || status === "queued" || status === "blocked" || status === "prepared" || status === "submitted" || status === "partially_filled" || status === "filled" || status === "cancelled" || status === "error") {
    return status;
  }
  return "queued";
}

function normalizeTone(tone: LabTone | string | undefined): LabTone {
  if (tone === "positive" || tone === "negative" || tone === "caution" || tone === "neutral") return tone;
  return "neutral";
}

function uniqueWarnings(warnings: string[]) {
  return Array.from(new Set(warnings.map((item) => item.trim()).filter(Boolean))).slice(0, 8);
}

function sourceLabelFor(sourceKind: OrderSourceKind) {
  if (sourceKind === "manual") return "手动下单";
  if (sourceKind === "profile-monitor") return "Profile 监测";
  if (sourceKind === "broker-sync") return "账户回报";
  return "策略建议";
}

function isoFromMaybeTime(value: string | undefined) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function shortTimeLabel(date = new Date()) {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function slugToken(value: string) {
  return normalizeToken(value).replace(/[^a-z0-9-]/g, "").slice(0, 18) || "order";
}

function normalizeToken(value: string | number | undefined) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");
}
