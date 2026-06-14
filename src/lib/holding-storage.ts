import { invoke } from "@tauri-apps/api/core";
import { isHoldingRecord, type HoldingRecord } from "./holdings";

const HOLDINGS_STORAGE_KEY = "rportfolio.holdings";

export function isTauriRuntime() {
  return "__TAURI_INTERNALS__" in window;
}

export async function loadPersistedHoldings(): Promise<HoldingRecord[]> {
  if (isTauriRuntime()) {
    return normalizeHoldings(await invoke<HoldingRecord[]>("load_holdings"));
  }
  return loadHoldingsFromLocalStorage();
}

export async function savePersistedHoldings(holdings: HoldingRecord[]): Promise<HoldingRecord[]> {
  const normalized = normalizeHoldings(holdings);
  if (isTauriRuntime()) {
    return normalizeHoldings(await invoke<HoldingRecord[]>("save_holdings", { holdings: normalized }));
  }
  window.localStorage.setItem(HOLDINGS_STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}

export function loadHoldingsFromLocalStorage() {
  try {
    const stored = window.localStorage.getItem(HOLDINGS_STORAGE_KEY);
    if (!stored) return [];
    return normalizeHoldings(JSON.parse(stored) as unknown[]);
  } catch {
    return [];
  }
}

function normalizeHoldings(holdings: unknown[]) {
  return holdings.filter(isHoldingRecord);
}
