import type { ComponentType } from "react";
import { createDeferredModuleLoader } from "../../lib/deferred-module";
import type { MarketAnalysisReport } from "../../lib/types";

export type AnalysisWorkspaceTab = "overview" | "structure" | "backtest" | "rules" | "indicators";

export type AnalysisTabProps = {
  report: MarketAnalysisReport;
};

type AnalysisTabModule = {
  default: ComponentType<AnalysisTabProps>;
};

const ANALYSIS_TAB_LOADERS: Record<AnalysisWorkspaceTab, () => Promise<AnalysisTabModule>> = {
  overview: () => import("./overview-analysis-tab"),
  structure: () => import("./structure-analysis-tab"),
  backtest: () => import("./backtest-analysis-tab"),
  rules: () => import("./rules-analysis-tab"),
  indicators: () => import("./indicators-analysis-tab"),
};

const loadAnalysisTabModule = createDeferredModuleLoader(ANALYSIS_TAB_LOADERS);

export function loadAnalysisTab(tab: AnalysisWorkspaceTab): Promise<AnalysisTabModule> {
  return loadAnalysisTabModule(tab);
}

export function preloadAnalysisTab(tab: AnalysisWorkspaceTab) {
  void loadAnalysisTab(tab).catch(() => undefined);
}
