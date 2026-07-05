import AccountBalanceWalletRoundedIcon from "@mui/icons-material/AccountBalanceWalletRounded";
import ErrorOutlineRoundedIcon from "@mui/icons-material/ErrorOutlineRounded";
import QueryStatsRoundedIcon from "@mui/icons-material/QueryStatsRounded";
import ScienceRoundedIcon from "@mui/icons-material/ScienceRounded";
import { Card, CardContent, CircularProgress, CssBaseline, ThemeProvider } from "@mui/material";
import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import { AppTitlebarActions, AppTopbar } from "./components/app-topbar";
import { AssetAnalysisWorkspace } from "./components/asset-analysis-workspace";
import { AssetLights } from "./components/asset-lights";
import { BacktestPanel } from "./components/backtest-panel";
import { BacktestSummaryPanel } from "./components/backtest-summary-panel";
import { DecisionRail } from "./components/decision-rail";
import { DecisionSummaryPanel } from "./components/decision-summary-panel";
import { HoldingsWorkspace } from "./components/holdings-workspace";
import { PortfolioProfilePanel } from "./components/portfolio-profile-panel";
import { QuantLabWorkspace } from "./components/quant-lab-workspace";
import { RecommendationOutcomePanel } from "./components/recommendation-outcome-panel";
import { RulesPanel } from "./components/rules-panel";
import { SettingsPanel, type ConfigPanelSection } from "./components/settings-panel";
import { Toaster } from "./components/ui/sonner";
import { StructurePanel } from "./components/structure-panel";
import { TechnicalPanel } from "./components/technical-panel";
import { TooltipProvider } from "./components/ui/tooltip";
import { useLocalStorageState } from "./hooks/use-local-storage-state";
import { useMarketAnalysis } from "./hooks/use-market-analysis";
import {
  isTauriRuntime,
  loadPersistedHoldings,
  savePersistedHoldings,
} from "./lib/holding-storage";
import { isHoldingRecord, type HoldingRecord } from "./lib/holdings";
import {
  DEFAULT_FUND_EXECUTION_POLICY,
  normalizeFundExecutionPolicy,
  type FundExecutionPolicy,
} from "./lib/fund-execution-policy";
import {
  DEFAULT_POSITION_POLICY,
  createPositionPlan,
  normalizePositionPolicy,
  profileRiskGateFromReport,
  type PositionPolicy,
} from "./lib/position-plan";
import {
  appendRecommendationRecords,
  loadRecommendationRecords,
  recommendationRecordsForPositionPlan,
  type RecommendationRecord,
} from "./lib/recommendation-log";
import { recommendationReadinessFor } from "./lib/recommendation-readiness";
import { buildExecutionAttribution } from "./lib/execution-attribution";
import {
  REQUESTED_FUND_SEED_STORAGE_KEY,
  applyResearchTargetBands,
  importRequestedFundProfiles,
  mergeRequestedFundHoldings,
} from "./lib/requested-fund-seeds";
import { loadPersistedTrades, savePersistedTrades } from "./lib/trade-storage";
import { isTradeRecord, type TradeRecord } from "./lib/trades";
import type { DataSource, ProfileSummary } from "./lib/types";
import { createRPortfolioTheme, type RPortfolioStyleMode } from "./theme/r-theme";

type AppWorkspace = "holdings" | "asset" | "analysis" | "quant";
type WorkspaceTab = "overview" | "structure" | "backtest" | "rules" | "indicators";

const APP_WORKSPACES: Array<{ key: AppWorkspace; label: string; detail: string; icon: typeof AccountBalanceWalletRoundedIcon }> = [
  { key: "holdings", label: "持仓管理", detail: "真实仓位、代理与观察", icon: AccountBalanceWalletRoundedIcon },
  { key: "analysis", label: "组合决策", detail: "状态、证据与仓位", icon: QueryStatsRoundedIcon },
  { key: "quant", label: "量化交易", detail: "监测、下单、执行", icon: ScienceRoundedIcon },
];

const WORKSPACE_TABS: Array<{ key: WorkspaceTab; label: string }> = [
  { key: "overview", label: "概览" },
  { key: "structure", label: "结构" },
  { key: "backtest", label: "回测" },
  { key: "rules", label: "规则" },
  { key: "indicators", label: "指标" },
];

function App() {
  const decisionMainScrollRef = useRef<HTMLDivElement | null>(null);
  const didHydrateHoldingsRef = useRef(false);
  const didHydrateTradesRef = useRef(false);
  const skipNextHoldingsPersistRef = useRef(false);
  const skipNextTradesPersistRef = useRef(false);
  const dailyDecisionSignatureRef = useRef("");
  const [activeWorkspace, setActiveWorkspace] = useLocalStorageState<AppWorkspace>("rportfolio.workspace", "analysis");
  const [assetResearchSymbol, setAssetResearchSymbol] = useState("");
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("overview");
  const [profileDrawerOpen, setProfileDrawerOpen] = useState(false);
  const [activeConfigSection, setActiveConfigSection] = useState<ConfigPanelSection>("global");
  const [configProfile, setConfigProfile] = useState("us-core");
  const [sidebarCollapsed, setSidebarCollapsed] = useLocalStorageState("rportfolio.sidebarCollapsed", false);
  const [styleMode, setStyleMode] = useLocalStorageState<RPortfolioStyleMode>("rportfolio.styleMode", "light", {
    legacyKeys: ["rmarket.styleMode"],
  });
  const [defaultProfile, setDefaultProfile] = useLocalStorageState("rportfolio.defaultProfile", "us-core", {
    legacyKeys: ["rmarket.defaultProfile"],
  });
  const [defaultSource, setDefaultSource] = useLocalStorageState<DataSource>("rportfolio.defaultSource", "auto", {
    legacyKeys: ["rmarket.defaultSource"],
  });
  const [fundExecutionPolicy, setFundExecutionPolicy] = useLocalStorageState<FundExecutionPolicy>(
    "rportfolio.fundExecutionPolicy",
    DEFAULT_FUND_EXECUTION_POLICY,
  );
  const [positionPolicy, setPositionPolicy] = useLocalStorageState<PositionPolicy>(
    "rportfolio.positionPolicy",
    DEFAULT_POSITION_POLICY,
  );
  const [holdings, setHoldings] = useLocalStorageState<HoldingRecord[]>("rportfolio.holdings", []);
  const [trades, setTrades] = useLocalStorageState<TradeRecord[]>("rportfolio.trades", []);
  const [recommendationRecords, setRecommendationRecords] = useState<RecommendationRecord[]>([]);
  const [holdingsPersistenceMessage, setHoldingsPersistenceMessage] = useState(
    isTauriRuntime() ? "正在读取本机持仓文件…" : "Web 预览保存在浏览器。",
  );
  const [, setTradesPersistenceMessage] = useState(
    isTauriRuntime() ? "正在读取本机交易流水…" : "Web 预览保存在浏览器。",
  );
  const theme = useMemo(() => createRPortfolioTheme(styleMode), [styleMode]);
  const {
    asOf,
    dataSources,
    error,
    loading,
    profile,
    profiles,
    reloadProfiles,
    refresh,
    report,
    setAsOf,
    setProfile,
    setSource,
    source,
  } = useMarketAnalysis({ defaultProfile, defaultSource });
  const reportIsCurrent = Boolean(report && report.profileKey === profile);
  const showLoadingState = loading || (report && !reportIsCurrent);
  const localHoldingRows = useMemo(() => holdings.filter(isHoldingRecord), [holdings]);
  const localTradeRows = useMemo(() => trades.filter(isTradeRecord), [trades]);
  const normalizedPositionPolicy = useMemo(() => normalizePositionPolicy(positionPolicy), [positionPolicy]);
  const normalizedFundExecutionPolicy = useMemo(
    () => normalizeFundExecutionPolicy(fundExecutionPolicy),
    [fundExecutionPolicy],
  );
  const activePositionRiskGate = useMemo(() => profileRiskGateFromReport(report), [report]);
  const activePositionPlan = useMemo(() => {
    return createPositionPlan(localHoldingRows, {
      marketRiskScore: report?.score ?? 50,
      policy: normalizedPositionPolicy,
      riskGate: activePositionRiskGate,
    });
  }, [activePositionRiskGate, localHoldingRows, normalizedPositionPolicy, report?.score]);
  const recommendationReadiness = useMemo(
    () => recommendationReadinessFor({ plan: activePositionPlan, report, reportIsCurrent }),
    [activePositionPlan, report, reportIsCurrent],
  );
  const executionAttribution = useMemo(
    () => buildExecutionAttribution(recommendationRecords, localTradeRows, report?.profileKey),
    [localTradeRows, recommendationRecords, report?.profileKey],
  );

  useEffect(() => {
    if (activeWorkspace === "asset" && !assetResearchSymbol) {
      setActiveWorkspace("holdings");
    }
  }, [activeWorkspace, assetResearchSymbol, setActiveWorkspace]);

  useEffect(() => {
    document.documentElement.dataset.rportfolioStyle = styleMode;
    document.documentElement.style.colorScheme = styleMode;
    document.documentElement.classList.toggle("dark", styleMode === "dark");
  }, [styleMode]);

  useEffect(() => {
    if (!profileDrawerOpen) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setProfileDrawerOpen(false);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [profileDrawerOpen]);

  useEffect(() => {
    if (profileDrawerOpen) return;
    setConfigProfile(profile);
  }, [profile, profileDrawerOpen]);

  useEffect(() => {
    if (!reportIsCurrent) return;
    decisionMainScrollRef.current?.scrollTo({ top: 0, left: 0 });
  }, [report?.profileKey, reportIsCurrent]);

  useEffect(() => {
    if (!report || !reportIsCurrent) return;
    let cancelled = false;
    void loadRecommendationRecords()
      .then((records) => {
        if (!cancelled) setRecommendationRecords(records);
      })
      .catch(() => {
        if (!cancelled) setRecommendationRecords([]);
      });
    return () => {
      cancelled = true;
    };
  }, [report?.generatedAt, report, reportIsCurrent]);

  useEffect(() => {
    if (!report || !reportIsCurrent) return;
    const assetActions = activePositionPlan.actions.filter((action) => action.holdingId);
    if (!assetActions.length) return;
    const signature = [
      report.asOf,
      report.profileKey,
      report.profileVersion,
      ...assetActions.map((action) => `${action.symbol}:${action.action}:${action.weightLabel}:${action.reason}`),
    ].join("|");
    if (dailyDecisionSignatureRef.current === signature) return;
    dailyDecisionSignatureRef.current = signature;
    const records = recommendationRecordsForPositionPlan({
      actions: assetActions,
      readiness: recommendationReadiness,
      report,
    });
    void appendRecommendationRecords(records).catch(() => {
      dailyDecisionSignatureRef.current = "";
    });
  }, [activePositionPlan.actions, recommendationReadiness, report, reportIsCurrent]);

  const openProfileConfig = () => {
    setConfigProfile(profile);
    setActiveConfigSection("global");
    setProfileDrawerOpen(true);
  };

  const applyGeneratedProfile = async (summary: ProfileSummary) => {
    await reloadProfiles();
    setConfigProfile(summary.key);
    setProfile(summary.key);
    setActiveTab("overview");
    setActiveWorkspace("analysis");
  };

  useEffect(() => {
    let cancelled = false;
    const localCache = holdings.filter(isHoldingRecord);

    async function hydrateHoldings() {
      try {
        const persisted = await loadPersistedHoldings();
        if (cancelled) return;
        if (persisted.length === 0 && localCache.length > 0) {
          await savePersistedHoldings(localCache);
          if (cancelled) return;
          setHoldingsPersistenceMessage(
            isTauriRuntime() ? "已从旧缓存迁移到本机文件。" : "Web 预览保存在浏览器。",
          );
          didHydrateHoldingsRef.current = true;
          return;
        }
        let nextHoldings = persisted;
        let addedSymbols: string[] = [];
        let importedProfiles: string[] = [];
        let shouldPersistHoldings = false;
        let researchBandsApplied = false;
        const seedMarker = window.localStorage.getItem(REQUESTED_FUND_SEED_STORAGE_KEY);
        if (!seedMarker) {
          const merged = mergeRequestedFundHoldings(persisted);
          nextHoldings = merged.holdings;
          addedSymbols = merged.addedSymbols;
          if (addedSymbols.length) {
            shouldPersistHoldings = true;
          }
          importedProfiles = await importRequestedFundProfiles();
          if (importedProfiles.length) {
            await reloadProfiles();
          }
          window.localStorage.setItem(
            REQUESTED_FUND_SEED_STORAGE_KEY,
            JSON.stringify({ seededAt: new Date().toISOString(), holdings: addedSymbols, profiles: importedProfiles }),
          );
        }
        const researchHoldings = applyResearchTargetBands(nextHoldings);
        if (JSON.stringify(researchHoldings) !== JSON.stringify(nextHoldings)) {
          nextHoldings = researchHoldings;
          shouldPersistHoldings = true;
          researchBandsApplied = true;
        }
        if (shouldPersistHoldings) {
          await savePersistedHoldings(nextHoldings);
        }
        skipNextHoldingsPersistRef.current = true;
        setHoldings(nextHoldings);
        setHoldingsPersistenceMessage(
          addedSymbols.length || importedProfiles.length
            ? `已补充 ${[...addedSymbols, ...importedProfiles].join("、")}。`
            : researchBandsApplied
              ? "已应用研究版目标带。"
            : isTauriRuntime()
              ? "已持久化到本机文件。"
              : "Web 预览保存在浏览器。",
        );
      } catch (error) {
        if (cancelled) return;
        setHoldingsPersistenceMessage(
          error instanceof Error ? `持仓文件读取失败：${error.message}` : "持仓文件读取失败。",
        );
      } finally {
        if (!cancelled) {
          didHydrateHoldingsRef.current = true;
        }
      }
    }

    void hydrateHoldings();
    return () => {
      cancelled = true;
    };
    // Initial persistence hydration only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!didHydrateHoldingsRef.current) return;
    if (skipNextHoldingsPersistRef.current) {
      skipNextHoldingsPersistRef.current = false;
      return;
    }

    let cancelled = false;
    void savePersistedHoldings(localHoldingRows)
      .then(() => {
        if (cancelled) return;
        setHoldingsPersistenceMessage(
          isTauriRuntime() ? "已保存到本机文件。" : "Web 预览保存在浏览器。",
        );
      })
      .catch((error) => {
        if (cancelled) return;
        setHoldingsPersistenceMessage(
          error instanceof Error ? `持仓保存失败：${error.message}` : "持仓保存失败。",
        );
      });

    return () => {
      cancelled = true;
    };
  }, [localHoldingRows]);

  useEffect(() => {
    let cancelled = false;
    const localCache = trades.filter(isTradeRecord);

    async function hydrateTrades() {
      try {
        const persisted = await loadPersistedTrades();
        if (cancelled) return;
        if (persisted.length === 0 && localCache.length > 0) {
          await savePersistedTrades(localCache);
          if (cancelled) return;
          setTradesPersistenceMessage(
            isTauriRuntime() ? "已从旧缓存迁移到本机交易流水。" : "Web 预览保存在浏览器。",
          );
          didHydrateTradesRef.current = true;
          return;
        }
        skipNextTradesPersistRef.current = true;
        setTrades(persisted);
        setTradesPersistenceMessage(
          isTauriRuntime() ? "交易流水已持久化到本机文件。" : "Web 预览保存在浏览器。",
        );
      } catch (error) {
        if (cancelled) return;
        setTradesPersistenceMessage(
          error instanceof Error ? `交易流水读取失败：${error.message}` : "交易流水读取失败。",
        );
      } finally {
        if (!cancelled) {
          didHydrateTradesRef.current = true;
        }
      }
    }

    void hydrateTrades();
    return () => {
      cancelled = true;
    };
    // Initial persistence hydration only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!didHydrateTradesRef.current) return;
    if (skipNextTradesPersistRef.current) {
      skipNextTradesPersistRef.current = false;
      return;
    }

    let cancelled = false;
    void savePersistedTrades(localTradeRows)
      .then(() => {
        if (cancelled) return;
        setTradesPersistenceMessage(
          isTauriRuntime() ? "交易流水已保存到本机文件。" : "Web 预览保存在浏览器。",
        );
      })
      .catch((error) => {
        if (cancelled) return;
        setTradesPersistenceMessage(
          error instanceof Error ? `交易流水保存失败：${error.message}` : "交易流水保存失败。",
        );
      });

    return () => {
      cancelled = true;
    };
  }, [localTradeRows]);

  const analysisToolbarVisible = activeWorkspace === "analysis";
  const analysisRightRailVisible = activeWorkspace === "analysis" && Boolean(report && reportIsCurrent);

  return (
    <ThemeProvider theme={theme}>
      <TooltipProvider>
        <CssBaseline />
        <div className="window-drag-region" data-tauri-drag-region />
        <AppTitlebarActions
          onOpenProfileConfig={openProfileConfig}
          onToggleSidebar={() => setSidebarCollapsed((current) => !current)}
          sidebarCollapsed={sidebarCollapsed}
          sourceDetail={recommendationReadiness.dataQuality.detail}
          sourceLabel={report && reportIsCurrent
            ? report.sourceLabel
            : dataSources.find((item) => item.key === source)?.name ?? source}
          sourceQuality={recommendationReadiness.dataQuality.severity}
        />
        {analysisToolbarVisible ? (
        <div
          className={`window-center-toolbar ${analysisRightRailVisible ? "has-right-rail" : ""} ${sidebarCollapsed ? "is-sidebar-collapsed" : ""}`}
        >
          <AppTopbar
            asOf={asOf}
            loading={loading}
            profile={profile}
            profiles={profiles}
            onAsOfChange={setAsOf}
            onProfileChange={setProfile}
            onRefresh={() => void refresh()}
          />
        </div>
      ) : null}
      <main className="app-shell" data-workspace={activeWorkspace}>
        <div className={`workspace-shell ${sidebarCollapsed ? "is-sidebar-collapsed" : ""}`}>
          <nav className="app-menu" aria-label="工作区">
            <div className="app-menu-brand" aria-hidden={sidebarCollapsed ? "true" : undefined}>
              <span>
                <AccountBalanceWalletRoundedIcon fontSize="inherit" />
              </span>
              <strong>rPortfolio</strong>
            </div>
            {APP_WORKSPACES.map((workspace) => {
              const Icon = workspace.icon;
              const active = activeWorkspace === workspace.key;
              return (
                <button
                  key={workspace.key}
                  type="button"
                  aria-label={workspace.label}
                  aria-current={active ? "page" : undefined}
                  className={active ? "is-active" : undefined}
                  title={workspace.label}
                  onClick={() => setActiveWorkspace(workspace.key)}
                >
                  <Icon fontSize="inherit" />
                  <span>
                    <strong>{workspace.label}</strong>
                  </span>
                </button>
              );
            })}
          </nav>

          <div className="workspace-area">
            {activeWorkspace === "holdings" ? (
              <HoldingsWorkspace
                holdings={holdings}
                persistenceMessage={holdingsPersistenceMessage}
                onHoldingsChange={setHoldings}
                onPositionPolicyChange={setPositionPolicy}
                onTradesChange={setTrades}
                positionPlan={activePositionPlan}
                positionPolicy={normalizedPositionPolicy}
                profiles={profiles}
                onProfileGenerated={(summary) => void applyGeneratedProfile(summary)}
                onOpenResearch={(holding) => {
                  setAssetResearchSymbol(holding.symbol);
                  setActiveWorkspace("asset");
                }}
                report={report}
                reportIsCurrent={reportIsCurrent}
              />
            ) : null}

            {activeWorkspace === "asset" ? (
              <AssetAnalysisWorkspace
                focusSymbol={assetResearchSymbol}
                holdings={localHoldingRows}
                loading={loading}
                onHoldingsChange={setHoldings}
                onOpenAnalysis={() => setActiveWorkspace("analysis")}
                onOpenHoldings={() => setActiveWorkspace("holdings")}
                onOpenQuant={() => setActiveWorkspace("quant")}
                positionPlan={activePositionPlan}
                report={report}
                reportIsCurrent={reportIsCurrent}
              />
            ) : null}

            {activeWorkspace === "analysis" ? (
              <div className={`analysis-page-stack ${report && reportIsCurrent ? "has-decision-rail" : ""}`}>
                <div className="analysis-main-column">
                  {error ? (
                    <Card className="error-card">
                      <CardContent>
                        <ErrorOutlineRoundedIcon />
                        <span>{error}</span>
                      </CardContent>
                    </Card>
                  ) : null}

                  {showLoadingState && !reportIsCurrent ? (
                    <section className="loading-state">
                      <CircularProgress size={26} />
                      <span>{report ? "正在切换 Profile" : "正在计算风险评分"}</span>
                    </section>
                  ) : null}

                  {!error && !showLoadingState && !report ? (
                    <section className="analysis-empty-state" aria-live="polite">
                      <QueryStatsRoundedIcon fontSize="inherit" />
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
                          <div className="tab-strip" role="tablist" aria-label="分析视图">
                            {WORKSPACE_TABS.map((tab) => (
                              <button
                                key={tab.key}
                                type="button"
                                role="tab"
                                aria-selected={activeTab === tab.key}
                                className={activeTab === tab.key ? "is-active" : undefined}
                                onClick={() => setActiveTab(tab.key)}
                              >
                                {tab.label}
                              </button>
                            ))}
                          </div>

                          <div className="tab-content">
                            {activeTab === "overview" ? (
                              <div className="overview-grid">
                                <div className="overview-main">
                                  <AssetLights assets={report.assetStatuses} />
                                  <PortfolioProfilePanel portfolio={report.portfolioProfile} />
                                  <div className="overview-lower-grid">
                                    <BacktestSummaryPanel backtest={report.backtest} />
                                  </div>
                                </div>
                              </div>
                            ) : null}

                            {activeTab === "structure" ? (
                              <div className="tab-stack">
                                <StructurePanel
                                  structure={report.structure}
                                  factorScores={report.factorScores}
                                  patternAnalysis={report.patternAnalysis}
                                  report={report}
                                />
                              </div>
                            ) : null}

                            {activeTab === "backtest" ? (
                              <div className="tab-stack recommendation-validation-stack">
                                <RecommendationOutcomePanel
                                  action={report.calibrationAction}
                                  attribution={executionAttribution}
                                  performance={report.recommendationPerformance}
                                />
                                <BacktestPanel backtest={report.backtest} showRules={false} />
                              </div>
                            ) : null}

                            {activeTab === "rules" ? <RulesPanel report={report} /> : null}

                            {activeTab === "indicators" ? (
                              <TechnicalPanel
                                profileMarket={report.profileMarket}
                                columns={report.technicalColumns}
                                rows={report.technicalRows}
                                strength={report.sectorStrength}
                              />
                            ) : null}
                          </div>
                        </section>
                      </div>
                    </div>
                  ) : null}
                </div>

                {report && reportIsCurrent ? <DecisionRail report={report} /> : null}
              </div>
            ) : null}

            {activeWorkspace === "quant" ? (
              <QuantLabWorkspace
                fundExecutionPolicy={normalizedFundExecutionPolicy}
                holdings={localHoldingRows}
                loading={loading}
                onHoldingsChange={setHoldings}
                onOpenAnalysis={() => setActiveWorkspace("analysis")}
                onOpenHoldings={() => setActiveWorkspace("holdings")}
                onRefresh={() => void refresh()}
                positionPlan={activePositionPlan}
                report={report}
                reportIsCurrent={reportIsCurrent}
                trades={localTradeRows}
              />
            ) : null}
          </div>
        </div>

        {report && reportIsCurrent ? (
          <SettingsPanel
            open={profileDrawerOpen}
            onOpenChange={setProfileDrawerOpen}
            activeSection={activeConfigSection}
            onActiveSectionChange={setActiveConfigSection}
            configProfile={configProfile}
            profile={profile}
            activeAnalysisProfile={profile}
            profiles={profiles}
            report={report}
            dataSources={dataSources}
            defaultProfile={defaultProfile}
            defaultSource={defaultSource}
            fundExecutionPolicy={normalizedFundExecutionPolicy}
            fundHoldings={localHoldingRows.filter((holding) => holding.assetType === "fund")}
            source={source}
            styleMode={styleMode}
            onSetStyleMode={setStyleMode}
            onSetDefaultProfile={setDefaultProfile}
            onSetDefaultSource={setDefaultSource}
            onFundExecutionPolicyChange={(policy) => setFundExecutionPolicy(normalizeFundExecutionPolicy(policy))}
            onSourceChange={setSource}
            onApplyDefaultProfile={() => setProfile(defaultProfile)}
            onProfileChange={setConfigProfile}
            onUseProfile={setProfile}
            onProfilesChanged={reloadProfiles}
            onRefresh={() => void refresh()}
          />
        ) : null}
      </main>
      <Toaster theme={styleMode} position="bottom-right" />
      </TooltipProvider>
    </ThemeProvider>
  );
}

export default App;
