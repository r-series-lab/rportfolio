import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "./holding-storage";
import {
  emptyPerformanceLedger,
  normalizePerformanceLedger,
  type PerformanceLedger,
} from "./performance-ledger";

const PERFORMANCE_STORAGE_KEY = "rportfolio.performance-ledger.v1";

export async function loadPersistedPerformanceLedger(): Promise<PerformanceLedger> {
  if (isTauriRuntime()) {
    return normalizePerformanceLedger(await invoke<unknown>("load_performance_ledger"));
  }
  try {
    const value = window.localStorage.getItem(PERFORMANCE_STORAGE_KEY);
    return value ? normalizePerformanceLedger(JSON.parse(value)) : emptyPerformanceLedger();
  } catch {
    return emptyPerformanceLedger();
  }
}

export async function savePersistedPerformanceLedger(ledger: PerformanceLedger): Promise<PerformanceLedger> {
  const normalized = normalizePerformanceLedger({ ...ledger, updatedAt: new Date().toISOString() });
  if (isTauriRuntime()) {
    return normalizePerformanceLedger(await invoke<unknown>("save_performance_ledger", { snapshot: normalized }));
  }
  window.localStorage.setItem(PERFORMANCE_STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}
