import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import {
  DEFAULT_RISK_GUARD_POLICY,
  normalizeRiskGuardPolicy,
  type RiskGuardPolicy,
} from "../lib/risk-policy";
import {
  loadPersistedRiskPolicy,
  loadRiskPolicyFromLocalStorage,
  savePersistedRiskPolicy,
} from "../lib/risk-policy-storage";

export type RiskPolicyState = {
  error: string;
  hydrated: boolean;
  saving: boolean;
  source: "app-data" | "local-storage";
};

export function useRiskPolicy(): [RiskGuardPolicy, Dispatch<SetStateAction<RiskGuardPolicy>>, RiskPolicyState] {
  const initialPolicyRef = useRef<RiskGuardPolicy>(normalizeRiskGuardPolicy(loadRiskPolicyFromLocalStorage()));
  const [policy, setPolicy] = useState<RiskGuardPolicy>(initialPolicyRef.current);
  const [state, setState] = useState<RiskPolicyState>({
    error: "",
    hydrated: false,
    saving: false,
    source: "local-storage",
  });

  useEffect(() => {
    let ignore = false;
    void loadPersistedRiskPolicy()
      .then((persisted) => {
        if (ignore) return;
        const normalizedPersisted = normalizeRiskGuardPolicy(persisted);
        const localPolicy = initialPolicyRef.current;
        const nextPolicy = riskPolicyHasLocalChanges(normalizedPersisted) ? normalizedPersisted : localPolicy;
        setPolicy(nextPolicy);
        setState({
          error: "",
          hydrated: true,
          saving: false,
          source: "__TAURI_INTERNALS__" in window ? "app-data" : "local-storage",
        });
      })
      .catch((error) => {
        if (ignore) return;
        setPolicy(initialPolicyRef.current);
        setState({
          error: error instanceof Error ? error.message : "风控配置读取失败",
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
    const normalized = normalizeRiskGuardPolicy({
      ...policy,
      updatedAt: policy.updatedAt || new Date().toISOString(),
    });
    setState((current) => ({ ...current, saving: true }));
    void savePersistedRiskPolicy(normalized)
      .then((saved) => {
        if (ignore) return;
        const normalizedSaved = normalizeRiskGuardPolicy(saved);
        setState((current) => ({
          ...current,
          error: "",
          saving: false,
          source: "__TAURI_INTERNALS__" in window ? "app-data" : "local-storage",
        }));
        if (JSON.stringify(normalizedSaved) !== JSON.stringify(normalized)) {
          setPolicy(normalizedSaved);
        }
      })
      .catch((error) => {
        if (ignore) return;
        setState((current) => ({
          ...current,
          error: error instanceof Error ? error.message : "风控配置保存失败",
          saving: false,
        }));
      });
    return () => {
      ignore = true;
    };
  }, [policy, state.hydrated]);

  return [policy, setPolicy, state];
}

function riskPolicyHasLocalChanges(policy: RiskGuardPolicy) {
  return Boolean(policy.updatedAt)
    || JSON.stringify(normalizeRiskGuardPolicy(policy)) !== JSON.stringify(DEFAULT_RISK_GUARD_POLICY);
}
