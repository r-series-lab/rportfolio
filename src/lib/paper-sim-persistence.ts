import { invoke } from "@tauri-apps/api/core";
import { hasTauriRuntime } from "./order-persistence";
import { defaultPaperSimState, normalizePaperSimState, type PaperSimState } from "./paper-sim";

export const PAPER_SIM_STORAGE_KEY = "rportfolio.quant.paper-sim.v1";

export async function loadPersistedPaperSim(): Promise<PaperSimState> {
  if (hasTauriRuntime()) {
    return normalizePaperSimState(await invoke<PaperSimState>("load_paper_sim"));
  }
  return loadPaperSimFromLocalStorage();
}

export async function savePersistedPaperSim(state: PaperSimState): Promise<PaperSimState> {
  const normalized = normalizePaperSimState(state);
  writePaperSimToLocalStorage(normalized);
  if (hasTauriRuntime()) {
    return normalizePaperSimState(await invoke<PaperSimState>("save_paper_sim", { state: normalized }));
  }
  return normalized;
}

export function loadPaperSimFromLocalStorage(): PaperSimState {
  try {
    const stored = window.localStorage.getItem(PAPER_SIM_STORAGE_KEY);
    return stored ? normalizePaperSimState(JSON.parse(stored) as PaperSimState) : defaultPaperSimState();
  } catch {
    return defaultPaperSimState();
  }
}

export function writePaperSimToLocalStorage(state: PaperSimState) {
  try {
    window.localStorage.setItem(PAPER_SIM_STORAGE_KEY, JSON.stringify(normalizePaperSimState(state)));
  } catch {
    // Keep the quant lab usable when browser preview storage is restricted.
  }
}
