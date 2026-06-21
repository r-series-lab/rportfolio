import { invoke } from "@tauri-apps/api/core";
import type { OrderRecord } from "./order-store";

export const ORDER_STORAGE_KEY = "rportfolio.quant.orders.v1";

export type OrderAuditExportFormat = "json" | "csv";

export type OrderAuditExportResult = {
  path: string;
  format: OrderAuditExportFormat;
  orders: number;
  events: number;
  exportedAt: string;
  summary: string;
};

export function hasTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function loadPersistedOrders(): Promise<OrderRecord[]> {
  if (hasTauriRuntime()) {
    return invoke<OrderRecord[]>("load_orders");
  }
  return loadOrdersFromLocalStorage();
}

export async function savePersistedOrders(orders: OrderRecord[]): Promise<OrderRecord[]> {
  writeOrdersToLocalStorage(orders);
  if (hasTauriRuntime()) {
    return invoke<OrderRecord[]>("save_orders", { orders });
  }
  return orders;
}

export async function exportOrderAudit(format: OrderAuditExportFormat): Promise<OrderAuditExportResult> {
  if (hasTauriRuntime()) {
    return invoke<OrderAuditExportResult>("export_order_audit", { request: { format } });
  }
  const orders = loadOrdersFromLocalStorage();
  const payload = downloadBrowserAuditExport(orders, format);
  return {
    path: payload.fileName,
    format,
    orders: orders.length,
    events: orders.reduce((sum, order) => sum + (order.events?.length ?? 0), 0),
    exportedAt: new Date().toISOString(),
    summary: `预览导出 ${orders.length} 条委托`,
  };
}

export function loadOrdersFromLocalStorage(): OrderRecord[] {
  try {
    const stored = window.localStorage.getItem(ORDER_STORAGE_KEY);
    return stored ? JSON.parse(stored) as OrderRecord[] : [];
  } catch {
    return [];
  }
}

export function writeOrdersToLocalStorage(orders: OrderRecord[]) {
  try {
    window.localStorage.setItem(ORDER_STORAGE_KEY, JSON.stringify(orders));
  } catch {
    // Keep desktop trading usable even if browser preview storage is restricted.
  }
}

function downloadBrowserAuditExport(orders: OrderRecord[], format: OrderAuditExportFormat) {
  const content = format === "csv" ? browserAuditCsv(orders) : JSON.stringify({
    version: 1,
    exportedAt: new Date().toISOString(),
    summary: {
      orders: orders.length,
      events: orders.reduce((sum, order) => sum + (order.events?.length ?? 0), 0),
    },
    orders,
  }, null, 2);
  const blob = new Blob([content], { type: format === "csv" ? "text/csv;charset=utf-8" : "application/json" });
  const url = URL.createObjectURL(blob);
  const fileName = `order-audit-${new Date().toISOString().replace(/[:.]/g, "-")}.${format}`;
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
  return { fileName };
}

function browserAuditCsv(orders: OrderRecord[]) {
  const header = [
    "order_id",
    "symbol",
    "name",
    "side",
    "status",
    "broker",
    "route",
    "order_ref",
    "source_kind",
    "source_label",
    "amount",
    "weight",
    "quantity",
    "limit",
    "event_at",
    "event_type",
    "event_label",
    "event_detail",
  ];
  const rows = orders.flatMap((order) => {
    const events = order.events?.length ? order.events : [null];
    return events.map((event) => [
      order.id,
      order.symbol,
      order.name,
      order.side,
      order.status,
      order.broker,
      order.route,
      order.orderRef,
      order.sourceKind,
      order.sourceLabel,
      order.amount,
      order.weight,
      order.quantity,
      order.limit,
      event?.at ?? "",
      event?.type ?? "",
      event?.label ?? "",
      event?.detail ?? "",
    ]);
  });
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
}

function csvCell(value: string) {
  return `"${String(value ?? "").replace(/"/g, "\"\"")}"`;
}
