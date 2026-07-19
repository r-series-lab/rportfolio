import ErrorOutlineRoundedIcon from "@mui/icons-material/ErrorOutlineRounded";
import FactCheckRoundedIcon from "@mui/icons-material/FactCheckRounded";
import QueryStatsRoundedIcon from "@mui/icons-material/QueryStatsRounded";
import { Card, CardContent, CircularProgress } from "@mui/material";
import { lazy, useEffect, useRef, type ComponentType, type LazyExoticComponent } from "react";
import { handleTabListKeyDown } from "../lib/tab-keyboard";
import type { MarketAnalysisReport } from "../lib/types";
import {
  loadAnalysisTab,
  preloadAnalysisTab,
  type AnalysisTabProps,
  type AnalysisWorkspaceTab,
} from "./analysis-tabs/analysis-tab-loader";
import { DecisionRail } from "./decision-rail";
import { DecisionSummaryPanel } from "./decision-summary-panel";
import { DeferredContent } from "./deferred-content";
import "../styles/pages/portfolio-analysis-shared.css";

export type { AnalysisWorkspaceTab } from "./analysis-tabs/analysis-tab-loader";
export type AnalysisWorkspacePane = "decision" | "inspection";

type AnalysisWorkspaceProps = {
  activeTab: AnalysisWorkspaceTab;
  analysisPane: AnalysisWorkspacePane;
  error: string | null;
  onActiveTabChange: (tab: AnalysisWorkspaceTab) => void;
  onAnalysisPaneChange: (pane: AnalysisWorkspacePane) => void;
  report: MarketAnalysisReport | null;
  reportIsCurrent: boolean;
  showLoadingState: boolean;
};

const WORKSPACE_TABS: Array<{ key: AnalysisWorkspaceTab; label: string }> = [
  { key: "overview", label: "概览" },
  { key: "structure", label: "结构" },
  { key: "backtest", label: "回测" },
  { key: "rules", label: "规则" },
  { key: "indicators", label: "指标" },
];

const ANALYSIS_TAB_COMPONENTS: Record<AnalysisWorkspaceTab, LazyExoticComponent<ComponentType<AnalysisTabProps>>> = {
  overview: lazy(() => loadAnalysisTab("overview")),
  structure: lazy(() => loadAnalysisTab("structure")),
  backtest: lazy(() => loadAnalysisTab("backtest")),
  rules: lazy(() => loadAnalysisTab("rules")),
  indicators: lazy(() => loadAnalysisTab("indicators")),
};

export function AnalysisWorkspace({
  activeTab,
  analysisPane,
  error,
  onActiveTabChange,
  onAnalysisPaneChange,
  report,
  reportIsCurrent,
  showLoadingState,
}: AnalysisWorkspaceProps) {
  const decisionMainScrollRef = useRef<HTMLDivElement | null>(null);
  const ActiveAnalysisTab = ANALYSIS_TAB_COMPONENTS[activeTab];
  const activeTabLabel = WORKSPACE_TABS.find((tab) => tab.key === activeTab)?.label ?? "分析";

  useEffect(() => {
    if (!reportIsCurrent) return;
    decisionMainScrollRef.current?.scrollTo({ top: 0, left: 0 });
  }, [report?.profileKey, reportIsCurrent]);

  return (
    <div
      className={`analysis-page-stack ${report && reportIsCurrent ? "has-decision-rail" : ""}`}
      data-analysis-pane={analysisPane}
    >
      {report && reportIsCurrent ? (
        <nav className="analysis-pane-nav" role="tablist" aria-label="组合决策工作区" onKeyDown={handleTabListKeyDown}>
          <button
            type="button"
            role="tab"
            aria-selected={analysisPane === "decision"}
            tabIndex={analysisPane === "decision" ? 0 : -1}
            className={analysisPane === "decision" ? "is-active" : undefined}
            onClick={() => onAnalysisPaneChange("decision")}
          >
            <QueryStatsRoundedIcon fontSize="inherit" aria-hidden="true" />
            决策
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={analysisPane === "inspection"}
            tabIndex={analysisPane === "inspection" ? 0 : -1}
            className={analysisPane === "inspection" ? "is-active" : undefined}
            onClick={() => onAnalysisPaneChange("inspection")}
          >
            <FactCheckRoundedIcon fontSize="inherit" aria-hidden="true" />
            检查
          </button>
        </nav>
      ) : null}

      <div className="analysis-main-column" aria-busy={showLoadingState}>
        {error ? (
          <Card className="error-card" role="alert">
            <CardContent>
              <ErrorOutlineRoundedIcon aria-hidden="true" />
              <span>{error}</span>
            </CardContent>
          </Card>
        ) : null}

        {showLoadingState && !reportIsCurrent ? (
          <section className="loading-state" role="status" aria-live="polite">
            <CircularProgress size={26} aria-hidden="true" />
            <span>{report ? "正在切换 Profile…" : "正在计算风险评分…"}</span>
          </section>
        ) : null}

        {!error && !showLoadingState && !report ? (
          <section className="analysis-empty-state" role="status" aria-live="polite">
            <QueryStatsRoundedIcon fontSize="inherit" aria-hidden="true" />
            <div>
              <strong>等待分析报告</strong>
              <span>选择 Profile、日期和数据源后刷新。</span>
            </div>
          </section>
        ) : null}

        {report && reportIsCurrent ? (
          <div className="decision-workspace">
            <div className="decision-main-scroll" ref={decisionMainScrollRef}>
              <DecisionSummaryPanel report={report} />

              <section className="workbench-panel">
                <div className="tab-strip" role="tablist" aria-label="分析视图" onKeyDown={handleTabListKeyDown}>
                  {WORKSPACE_TABS.map((tab) => (
                    <button
                      id={`analysis-tab-${tab.key}`}
                      key={tab.key}
                      type="button"
                      role="tab"
                      aria-controls={`analysis-panel-${tab.key}`}
                      aria-selected={activeTab === tab.key}
                      tabIndex={activeTab === tab.key ? 0 : -1}
                      className={activeTab === tab.key ? "is-active" : undefined}
                      onFocus={() => preloadAnalysisTab(tab.key)}
                      onPointerEnter={() => preloadAnalysisTab(tab.key)}
                      onClick={() => onActiveTabChange(tab.key)}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                <div
                  id={`analysis-panel-${activeTab}`}
                  className="tab-content"
                  role="tabpanel"
                  aria-labelledby={`analysis-tab-${activeTab}`}
                >
                  <DeferredContent label={`${activeTabLabel}视图`} resetKey={activeTab}>
                    <ActiveAnalysisTab report={report} />
                  </DeferredContent>
                </div>
              </section>
            </div>
          </div>
        ) : null}
      </div>

      {report && reportIsCurrent ? <DecisionRail report={report} /> : null}
    </div>
  );
}
