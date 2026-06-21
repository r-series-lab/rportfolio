import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import {
  emptyMonitorStore,
  loadMonitorStoreFromLocalStorage,
  loadPersistedMonitorStore,
  normalizeMonitorStore,
  savePersistedMonitorStore,
  type ProfileMonitorStore,
} from "../lib/monitor-persistence";
import {
  createProfileMonitorRecord,
  type ProfileMonitorEvaluation,
  type ProfileMonitorSnapshot,
} from "../lib/profile-monitor";
import type { OrderRecord } from "../lib/order-store";

export type MonitorStoreState = {
  error: string;
  hydrated: boolean;
  saving: boolean;
  source: "app-data" | "local-storage";
};

export type CommitMonitorEvaluationInput = {
  evaluation: ProfileMonitorEvaluation;
  previousSnapshot: ProfileMonitorSnapshot | null;
  queuedOrders?: OrderRecord[];
};

export function useMonitorStore(): [
  ProfileMonitorStore,
  Dispatch<SetStateAction<ProfileMonitorStore>>,
  MonitorStoreState,
  (input: CommitMonitorEvaluationInput) => void,
] {
  const initialStoreRef = useRef<ProfileMonitorStore>(normalizeMonitorStore(loadMonitorStoreFromLocalStorage()));
  const [store, setStore] = useState<ProfileMonitorStore>(initialStoreRef.current);
  const [state, setState] = useState<MonitorStoreState>({
    error: "",
    hydrated: false,
    saving: false,
    source: "local-storage",
  });

  useEffect(() => {
    let ignore = false;
    void loadPersistedMonitorStore()
      .then((persisted) => {
        if (ignore) return;
        const normalizedPersisted = normalizeMonitorStore(persisted);
        const localStore = initialStoreRef.current;
        const nextStore = normalizedPersisted.snapshot || normalizedPersisted.records.length
          ? normalizedPersisted
          : localStore;
        setStore(nextStore);
        setState({
          error: "",
          hydrated: true,
          saving: false,
          source: "__TAURI_INTERNALS__" in window ? "app-data" : "local-storage",
        });
      })
      .catch((error) => {
        if (ignore) return;
        setStore(initialStoreRef.current);
        setState({
          error: error instanceof Error ? error.message : "监测存储读取失败",
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
    const normalized = normalizeMonitorStore(store);
    setState((current) => ({ ...current, saving: true }));
    void savePersistedMonitorStore(normalized)
      .then((saved) => {
        if (ignore) return;
        const normalizedSaved = normalizeMonitorStore(saved);
        setState((current) => ({
          ...current,
          error: "",
          saving: false,
          source: "__TAURI_INTERNALS__" in window ? "app-data" : "local-storage",
        }));
        if (JSON.stringify(normalizedSaved) !== JSON.stringify(normalized)) {
          setStore(normalizedSaved);
        }
      })
      .catch((error) => {
        if (ignore) return;
        setState((current) => ({
          ...current,
          error: error instanceof Error ? error.message : "监测存储写入失败",
          saving: false,
        }));
      });
    return () => {
      ignore = true;
    };
  }, [state.hydrated, store]);

  const commitMonitorEvaluation = ({
    evaluation,
    previousSnapshot,
    queuedOrders = [],
  }: CommitMonitorEvaluationInput) => {
    const record = createProfileMonitorRecord({ evaluation, previousSnapshot, queuedOrders });
    setStore((current) => {
      const normalized = normalizeMonitorStore(current);
      const records = [record, ...normalized.records.filter((item) => item.key !== record.key)].slice(0, 500);
      return {
        ...emptyMonitorStore(),
        snapshot: evaluation.snapshot,
        records,
        updatedAt: record.at,
      };
    });
  };

  return [store, setStore, state, commitMonitorEvaluation];
}
