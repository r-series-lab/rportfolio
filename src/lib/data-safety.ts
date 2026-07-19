import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "./holding-storage";

export type DataBackupSummary = {
  id: string;
  createdAt: string;
  reason: "manual" | "pre-restore" | string;
  schemaVersion: number;
  files: string[];
  bytes: number;
};

export type DataRestoreResult = {
  backupId: string;
  preRestoreBackupId: string;
  restoredFiles: number;
  restoredAt: string;
};

export type DataStoreDiagnostic = {
  key: string;
  file: string;
  present: boolean;
  bytes: number;
  records: number;
  version: number;
  readable: boolean;
};

export type DataDiagnostics = {
  schemaVersion: number;
  generatedAt: string;
  stores: DataStoreDiagnostic[];
  backups: number;
};

export function dataSafetyAvailable() {
  return typeof window !== "undefined" && isTauriRuntime();
}

export async function createDataBackup() {
  requireDesktopRuntime();
  return invoke<DataBackupSummary>("create_data_backup");
}

export async function listDataBackups() {
  if (!dataSafetyAvailable()) return [];
  return invoke<DataBackupSummary[]>("list_data_backups");
}

export async function restoreDataBackup(backupId: string) {
  requireDesktopRuntime();
  return invoke<DataRestoreResult>("restore_data_backup", { backupId });
}

export async function getDataDiagnostics() {
  if (!dataSafetyAvailable()) return null;
  return invoke<DataDiagnostics>("get_data_diagnostics");
}

function requireDesktopRuntime() {
  if (!dataSafetyAvailable()) {
    throw new Error("数据备份与恢复仅在桌面应用中可用。");
  }
}
