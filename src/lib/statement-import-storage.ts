import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "./holding-storage";
import {
  emptyStatementImportLedger,
  normalizeStatementImportLedger,
  type StatementImportLedger,
} from "./statement-import";

const STATEMENT_IMPORT_STORAGE_KEY = "rportfolio.statement-imports.v1";

export async function loadPersistedStatementImportLedger(): Promise<StatementImportLedger> {
  if (isTauriRuntime()) {
    return normalizeStatementImportLedger(await invoke<unknown>("load_statement_imports"));
  }
  try {
    const value = window.localStorage.getItem(STATEMENT_IMPORT_STORAGE_KEY);
    return value ? normalizeStatementImportLedger(JSON.parse(value)) : emptyStatementImportLedger();
  } catch {
    return emptyStatementImportLedger();
  }
}

export async function savePersistedStatementImportLedger(ledger: StatementImportLedger): Promise<StatementImportLedger> {
  const normalized = normalizeStatementImportLedger({ ...ledger, updatedAt: new Date().toISOString() });
  if (isTauriRuntime()) {
    return normalizeStatementImportLedger(await invoke<unknown>("save_statement_imports", { snapshot: normalized }));
  }
  window.localStorage.setItem(STATEMENT_IMPORT_STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}
