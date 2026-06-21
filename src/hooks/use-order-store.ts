import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import {
  loadOrdersFromLocalStorage,
  loadPersistedOrders,
  savePersistedOrders,
} from "../lib/order-persistence";
import { normalizeOrderRecords, type OrderRecord } from "../lib/order-store";

export type OrderStoreState = {
  error: string;
  hydrated: boolean;
  saving: boolean;
  source: "app-data" | "local-storage";
};

export function useOrderStore(): [OrderRecord[], Dispatch<SetStateAction<OrderRecord[]>>, OrderStoreState] {
  const initialOrdersRef = useRef<OrderRecord[]>(normalizeOrderRecords(loadOrdersFromLocalStorage()));
  const [orders, setOrders] = useState<OrderRecord[]>(initialOrdersRef.current);
  const [state, setState] = useState<OrderStoreState>({
    error: "",
    hydrated: false,
    saving: false,
    source: "local-storage",
  });

  useEffect(() => {
    let ignore = false;
    void loadPersistedOrders()
      .then((persisted) => {
        if (ignore) return;
        const normalizedPersisted = normalizeOrderRecords(persisted);
        const localOrders = initialOrdersRef.current;
        const nextOrders = normalizedPersisted.length ? normalizedPersisted : localOrders;
        setOrders(nextOrders);
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
          error: error instanceof Error ? error.message : "订单存储读取失败",
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
    const normalized = normalizeOrderRecords(orders);
    setState((current) => ({ ...current, saving: true }));
    void savePersistedOrders(normalized)
      .then((saved) => {
        if (ignore) return;
        const normalizedSaved = normalizeOrderRecords(saved);
        setState((current) => ({
          ...current,
          error: "",
          saving: false,
          source: "__TAURI_INTERNALS__" in window ? "app-data" : "local-storage",
        }));
        if (JSON.stringify(normalizedSaved) !== JSON.stringify(normalized)) {
          setOrders(normalizedSaved);
        }
      })
      .catch((error) => {
        if (ignore) return;
        setState((current) => ({
          ...current,
          error: error instanceof Error ? error.message : "订单存储写入失败",
          saving: false,
        }));
      });
    return () => {
      ignore = true;
    };
  }, [orders, state.hydrated]);

  return [orders, setOrders, state];
}
