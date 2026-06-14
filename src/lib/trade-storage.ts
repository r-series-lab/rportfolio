import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "./holding-storage";
import { isTradeRecord, type TradeRecord } from "./trades";

const TRADES_STORAGE_KEY = "rportfolio.trades";

export async function loadPersistedTrades(): Promise<TradeRecord[]> {
  if (isTauriRuntime()) {
    return normalizeTrades(await invoke<TradeRecord[]>("load_trades"));
  }
  return loadTradesFromLocalStorage();
}

export async function savePersistedTrades(trades: TradeRecord[]): Promise<TradeRecord[]> {
  const normalized = normalizeTrades(trades);
  if (isTauriRuntime()) {
    return normalizeTrades(await invoke<TradeRecord[]>("save_trades", { trades: normalized }));
  }
  window.localStorage.setItem(TRADES_STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}

export function loadTradesFromLocalStorage() {
  try {
    const stored = window.localStorage.getItem(TRADES_STORAGE_KEY);
    if (!stored) return [];
    return normalizeTrades(JSON.parse(stored) as unknown[]);
  } catch {
    return [];
  }
}

function normalizeTrades(trades: unknown[]) {
  return trades.filter(isTradeRecord);
}
