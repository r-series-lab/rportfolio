import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import {
  loadPaperSimFromLocalStorage,
  loadPersistedPaperSim,
  savePersistedPaperSim,
} from "../lib/paper-sim-persistence";
import { normalizePaperSimState, type PaperSimState } from "../lib/paper-sim";

export type PaperSimStoreState = {
  error: string;
  hydrated: boolean;
  saving: boolean;
  source: "app-data" | "local-storage";
};

export function usePaperSimStore(): [PaperSimState, Dispatch<SetStateAction<PaperSimState>>, PaperSimStoreState] {
  const initialStateRef = useRef<PaperSimState>(normalizePaperSimState(loadPaperSimFromLocalStorage()));
  const [paperSim, setPaperSim] = useState<PaperSimState>(initialStateRef.current);
  const [state, setState] = useState<PaperSimStoreState>({
    error: "",
    hydrated: false,
    saving: false,
    source: "local-storage",
  });

  useEffect(() => {
    let ignore = false;
    void loadPersistedPaperSim()
      .then((persisted) => {
        if (ignore) return;
        setPaperSim(normalizePaperSimState(persisted));
        setState({
          error: "",
          hydrated: true,
          saving: false,
          source: "__TAURI_INTERNALS__" in window ? "app-data" : "local-storage",
        });
      })
      .catch((error) => {
        if (ignore) return;
        setState({
          error: error instanceof Error ? error.message : "模拟实验存储读取失败",
          hydrated: true,
          saving: false,
          source: "local-storage",
        });
      });
    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    if (!state.hydrated) return;
    let ignore = false;
    const normalized = normalizePaperSimState(paperSim);
    setState((current) => ({ ...current, saving: true }));
    void savePersistedPaperSim(normalized)
      .then((saved) => {
        if (ignore) return;
        const normalizedSaved = normalizePaperSimState(saved);
        setState((current) => ({
          ...current,
          error: "",
          saving: false,
          source: "__TAURI_INTERNALS__" in window ? "app-data" : "local-storage",
        }));
        if (JSON.stringify(normalizedSaved) !== JSON.stringify(normalized)) {
          setPaperSim(normalizedSaved);
        }
      })
      .catch((error) => {
        if (ignore) return;
        setState((current) => ({
          ...current,
          error: error instanceof Error ? error.message : "模拟实验存储写入失败",
          saving: false,
        }));
      });
    return () => {
      ignore = true;
    };
  }, [paperSim, state.hydrated]);

  return [paperSim, setPaperSim, state];
}
