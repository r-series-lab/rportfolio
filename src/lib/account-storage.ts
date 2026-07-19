import { invoke } from "@tauri-apps/api/core";
import {
  emptyAccountStore,
  normalizeAccountStore,
  type AccountStoreSnapshot,
} from "./accounts";
import { isTauriRuntime } from "./holding-storage";

const ACCOUNT_STORAGE_KEY = "rportfolio.accounts.v2";
const LEGACY_ACCOUNT_STORAGE_KEY = "rportfolio.quant.account-snapshots.v1";

export async function loadPersistedAccountStore(): Promise<AccountStoreSnapshot> {
  if (isTauriRuntime()) {
    return normalizeAccountStore(await invoke<unknown>("load_accounts"));
  }
  return loadAccountStoreFromLocalStorage();
}

export async function savePersistedAccountStore(store: AccountStoreSnapshot): Promise<AccountStoreSnapshot> {
  const normalized = normalizeAccountStore({ ...store, updatedAt: new Date().toISOString() });
  if (isTauriRuntime()) {
    return normalizeAccountStore(await invoke<unknown>("save_accounts", { snapshot: normalized }));
  }
  window.localStorage.setItem(ACCOUNT_STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}

export function loadAccountStoreFromLocalStorage(): AccountStoreSnapshot {
  try {
    const current = window.localStorage.getItem(ACCOUNT_STORAGE_KEY);
    if (current) return normalizeAccountStore(JSON.parse(current));
    const legacy = window.localStorage.getItem(LEGACY_ACCOUNT_STORAGE_KEY);
    return legacy ? normalizeAccountStore(JSON.parse(legacy)) : emptyAccountStore();
  } catch {
    return emptyAccountStore();
  }
}
