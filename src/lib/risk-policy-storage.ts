import { invoke } from "@tauri-apps/api/core";
import {
  DEFAULT_RISK_GUARD_POLICY,
  RISK_POLICY_STORAGE_KEY,
  normalizeRiskGuardPolicy,
  type RiskGuardPolicy,
} from "./risk-policy";
import { hasTauriRuntime } from "./order-persistence";

export async function loadPersistedRiskPolicy(): Promise<RiskGuardPolicy> {
  if (hasTauriRuntime()) {
    return normalizeRiskGuardPolicy(await invoke<RiskGuardPolicy>("load_risk_policy"));
  }
  return loadRiskPolicyFromLocalStorage();
}

export async function savePersistedRiskPolicy(policy: RiskGuardPolicy): Promise<RiskGuardPolicy> {
  const normalized = normalizeRiskGuardPolicy(policy);
  writeRiskPolicyToLocalStorage(normalized);
  if (hasTauriRuntime()) {
    return normalizeRiskGuardPolicy(await invoke<RiskGuardPolicy>("save_risk_policy", { policy: normalized }));
  }
  return normalized;
}

export function loadRiskPolicyFromLocalStorage(): RiskGuardPolicy {
  if (!canUseLocalStorage()) return DEFAULT_RISK_GUARD_POLICY;
  try {
    const raw = window.localStorage.getItem(RISK_POLICY_STORAGE_KEY);
    if (!raw) return DEFAULT_RISK_GUARD_POLICY;
    return normalizeRiskGuardPolicy(JSON.parse(raw));
  } catch {
    return DEFAULT_RISK_GUARD_POLICY;
  }
}

export function writeRiskPolicyToLocalStorage(policy: RiskGuardPolicy) {
  if (!canUseLocalStorage()) return;
  try {
    window.localStorage.setItem(RISK_POLICY_STORAGE_KEY, JSON.stringify(normalizeRiskGuardPolicy(policy)));
  } catch {
    // Keep trading screens usable in private browsing or restricted preview contexts.
  }
}

function canUseLocalStorage() {
  return typeof window !== "undefined" && "localStorage" in window;
}
