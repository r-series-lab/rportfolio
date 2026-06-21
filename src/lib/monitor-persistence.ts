import { invoke } from "@tauri-apps/api/core";
import type { ProfileMonitorRecord, ProfileMonitorSnapshot } from "./profile-monitor";
import { hasTauriRuntime } from "./order-persistence";

export const MONITOR_SNAPSHOT_STORAGE_KEY = "rportfolio.quant.monitor.snapshot.v1";
export const MONITOR_RECORDS_STORAGE_KEY = "rportfolio.quant.monitor.records.v1";

export type ProfileMonitorStore = {
  version: number;
  updatedAt: string;
  snapshot: ProfileMonitorSnapshot | null;
  records: ProfileMonitorRecord[];
};

export function emptyMonitorStore(): ProfileMonitorStore {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    snapshot: null,
    records: [],
  };
}

export async function loadPersistedMonitorStore(): Promise<ProfileMonitorStore> {
  if (hasTauriRuntime()) {
    return normalizeMonitorStore(await invoke<ProfileMonitorStore>("load_monitor_state"));
  }
  return loadMonitorStoreFromLocalStorage();
}

export async function savePersistedMonitorStore(store: ProfileMonitorStore): Promise<ProfileMonitorStore> {
  const normalized = normalizeMonitorStore(store);
  writeMonitorStoreToLocalStorage(normalized);
  if (hasTauriRuntime()) {
    return normalizeMonitorStore(await invoke<ProfileMonitorStore>("save_monitor_state", { state: normalized }));
  }
  return normalized;
}

export function loadMonitorStoreFromLocalStorage(): ProfileMonitorStore {
  const store = emptyMonitorStore();
  try {
    const snapshot = window.localStorage.getItem(MONITOR_SNAPSHOT_STORAGE_KEY);
    if (snapshot) store.snapshot = JSON.parse(snapshot) as ProfileMonitorSnapshot;
  } catch {
    store.snapshot = null;
  }
  try {
    const records = window.localStorage.getItem(MONITOR_RECORDS_STORAGE_KEY);
    if (records) store.records = JSON.parse(records) as ProfileMonitorRecord[];
  } catch {
    store.records = [];
  }
  return normalizeMonitorStore(store);
}

export function writeMonitorStoreToLocalStorage(store: ProfileMonitorStore) {
  try {
    if (store.snapshot) {
      window.localStorage.setItem(MONITOR_SNAPSHOT_STORAGE_KEY, JSON.stringify(store.snapshot));
    } else {
      window.localStorage.removeItem(MONITOR_SNAPSHOT_STORAGE_KEY);
    }
    window.localStorage.setItem(MONITOR_RECORDS_STORAGE_KEY, JSON.stringify(store.records));
  } catch {
    // Keep monitor state non-blocking in preview/private contexts.
  }
}

export function normalizeMonitorStore(store: Partial<ProfileMonitorStore> | null | undefined): ProfileMonitorStore {
  return {
    version: 1,
    updatedAt: typeof store?.updatedAt === "string" ? store.updatedAt : new Date().toISOString(),
    snapshot: store?.snapshot && typeof store.snapshot === "object" ? store.snapshot : null,
    records: Array.isArray(store?.records)
      ? store.records.filter((record) => record && typeof record === "object").slice(0, 500)
      : [],
  };
}
