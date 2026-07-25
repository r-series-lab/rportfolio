import { createDeferredModuleLoader } from "../../lib/deferred-module";

type QuantDeferredModule = "dialogs" | "simulation" | "orders" | "account" | "logs";

const loadDialogsModule = createDeferredModuleLoader({
  dialogs: () => import("./quant-lab-dialogs"),
});
const loadSimulationModule = createDeferredModuleLoader({
  simulation: () => import("./quant-simulation-panel"),
});
const loadOrdersModule = createDeferredModuleLoader({
  orders: () => import("./quant-orders-panel"),
});
const loadAccountModule = createDeferredModuleLoader({
  account: () => import("./quant-account-panel"),
});
const loadLogsModule = createDeferredModuleLoader({
  logs: () => import("./quant-logs-panel"),
});

export function preloadQuantModule(module: QuantDeferredModule) {
  const pending = loadQuantModule(module);
  void pending.catch(() => undefined);
}

export function loadQuantDialogs() {
  return loadDialogsModule("dialogs");
}

export function loadQuantSimulation() {
  return loadSimulationModule("simulation");
}

export function loadQuantOrders() {
  return loadOrdersModule("orders");
}

export function loadQuantAccount() {
  return loadAccountModule("account");
}

export function loadQuantLogs() {
  return loadLogsModule("logs");
}

function loadQuantModule(module: QuantDeferredModule) {
  if (module === "dialogs") return loadQuantDialogs();
  if (module === "simulation") return loadQuantSimulation();
  if (module === "orders") return loadQuantOrders();
  if (module === "account") return loadQuantAccount();
  return loadQuantLogs();
}
