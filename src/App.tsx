import AccountBalanceWalletRoundedIcon from "@mui/icons-material/AccountBalanceWalletRounded";
import ErrorOutlineRoundedIcon from "@mui/icons-material/ErrorOutlineRounded";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import DarkModeRoundedIcon from "@mui/icons-material/DarkModeRounded";
import LightModeRoundedIcon from "@mui/icons-material/LightModeRounded";
import QueryStatsRoundedIcon from "@mui/icons-material/QueryStatsRounded";
import { Card, CardContent, CircularProgress, CssBaseline, ThemeProvider } from "@mui/material";
import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import { AppTitlebarActions, AppTopbar } from "./components/app-topbar";
import { AssetLights } from "./components/asset-lights";
import { BacktestPanel } from "./components/backtest-panel";
import { BacktestSummaryPanel } from "./components/backtest-summary-panel";
import { DecisionRail } from "./components/decision-rail";
import { DecisionSummaryPanel } from "./components/decision-summary-panel";
import { HoldingsWorkspace } from "./components/holdings-workspace";
import { PortfolioProfilePanel } from "./components/portfolio-profile-panel";
import { ProfileConfigPanel, type ProfileConfigSection } from "./components/profile-config-panel";
import { RulesPanel } from "./components/rules-panel";
import { StructurePanel } from "./components/structure-panel";
import { TechnicalPanel } from "./components/technical-panel";
import { useLocalStorageState } from "./hooks/use-local-storage-state";
import { useMarketAnalysis } from "./hooks/use-market-analysis";
import {
  isTauriRuntime,
  loadPersistedHoldings,
  savePersistedHoldings,
} from "./lib/holding-storage";
import { isHoldingRecord, type HoldingRecord } from "./lib/holdings";
import {
  DEFAULT_POSITION_POLICY,
  createPositionPlan,
  normalizePositionPolicy,
  profileRiskGateFromReport,
  type PositionPolicy,
} from "./lib/position-plan";
import {
  REQUESTED_FUND_SEED_STORAGE_KEY,
  importRequestedFundProfiles,
  mergeRequestedFundHoldings,
} from "./lib/requested-fund-seeds";
import { loadPersistedTrades, savePersistedTrades } from "./lib/trade-storage";
import { isTradeRecord, type TradeRecord } from "./lib/trades";
import type { DataSource, ProfileSummary } from "./lib/types";
import { createRPortfolioTheme, type RPortfolioStyleMode } from "./theme/r-theme";

type AppWorkspace = "holdings" | "analysis";
type WorkspaceTab = "overview" | "structure" | "backtest" | "rules" | "indicators";
type ConfigPanelSection = "global" | ProfileConfigSection;

const APP_WORKSPACES: Array<{ key: AppWorkspace; label: string; detail: string; icon: typeof AccountBalanceWalletRoundedIcon }> = [
  { key: "holdings", label: "持仓管理", detail: "真实仓位、代理与观察", icon: AccountBalanceWalletRoundedIcon },
  { key: "analysis", label: "组合分析", detail: "Profile、规则、回测", icon: QueryStatsRoundedIcon },
];

const WORKSPACE_TABS: Array<{ key: WorkspaceTab; label: string }> = [
  { key: "overview", label: "概览" },
  { key: "structure", label: "结构" },
  { key: "backtest", label: "回测" },
  { key: "rules", label: "规则" },
  { key: "indicators", label: "指标" },
];

const CONFIG_PANEL_SECTIONS: Array<{ key: ConfigPanelSection; label: string; detail: string }> = [
  { key: "global", label: "全局", detail: "默认配置与界面" },
  { key: "profile", label: "Profile", detail: "管理、编辑、校验" },
  { key: "generate", label: "生成", detail: "基金代码与导入" },
];

function App() {
  const decisionMainScrollRef = useRef<HTMLDivElement | null>(null);
  const didHydrateHoldingsRef = useRef(false);
  const didHydrateTradesRef = useRef(false);
  const skipNextHoldingsPersistRef = useRef(false);
  const skipNextTradesPersistRef = useRef(false);
  const [activeWorkspace, setActiveWorkspace] = useLocalStorageState<AppWorkspace>("rportfolio.workspace", "analysis");
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("overview");
  const [profileDrawerOpen, setProfileDrawerOpen] = useState(false);
  const [activeConfigSection, setActiveConfigSection] = useState<ConfigPanelSection>("global");
  const [configProfile, setConfigProfile] = useState("us-core");
  const [sidebarCollapsed, setSidebarCollapsed] = useLocalStorageState("rportfolio.sidebarCollapsed", false);
  const [rightRailCollapsed, setRightRailCollapsed] = useLocalStorageState("rportfolio.rightRailCollapsed", false);
  const [styleMode, setStyleMode] = useLocalStorageState<RPortfolioStyleMode>("rportfolio.styleMode", "light", {
    legacyKeys: ["rmarket.styleMode"],
  });
  const [defaultProfile, setDefaultProfile] = useLocalStorageState("rportfolio.defaultProfile", "us-core", {
    legacyKeys: ["rmarket.defaultProfile"],
  });
  const [defaultSource, setDefaultSource] = useLocalStorageState<DataSource>("rportfolio.defaultSource", "auto", {
    legacyKeys: ["rmarket.defaultSource"],
  });
  const [positionPolicy, setPositionPolicy] = useLocalStorageState<PositionPolicy>(
    "rportfolio.positionPolicy",
    DEFAULT_POSITION_POLICY,
  );
  const [holdings, setHoldings] = useLocalStorageState<HoldingRecord[]>("rportfolio.holdings", []);
  const [trades, setTrades] = useLocalStorageState<TradeRecord[]>("rportfolio.trades", []);
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
  const activeProfileConfigSection: ProfileConfigSection = activeConfigSection === "global" ? "profile" : activeConfigSection;
  const localHoldingRows = useMemo(() => holdings.filter(isHoldingRecord), [holdings]);
  const localTradeRows = useMemo(() => trades.filter(isTradeRecord), [trades]);
  const normalizedPositionPolicy = useMemo(() => normalizePositionPolicy(positionPolicy), [positionPolicy]);
  const activePositionRiskGate = useMemo(() => profileRiskGateFromReport(report), [report]);
  const activePositionPlan = useMemo(() => {
    return createPositionPlan(localHoldingRows, {
      marketRiskScore: report?.score ?? 50,
      policy: normalizedPositionPolicy,
      riskGate: activePositionRiskGate,
    });
  }, [activePositionRiskGate, localHoldingRows, normalizedPositionPolicy, report?.score]);

  useEffect(() => {
    document.documentElement.dataset.rportfolioStyle = styleMode;
    document.documentElement.style.colorScheme = styleMode;
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

  const toggleStyleMode = () => {
    setStyleMode((current) => (current === "dark" ? "light" : "dark"));
  };

  const openProfileConfig = () => {
    setConfigProfile(profile);
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
        const seedMarker = window.localStorage.getItem(REQUESTED_FUND_SEED_STORAGE_KEY);
        if (!seedMarker) {
          const merged = mergeRequestedFundHoldings(persisted);
          nextHoldings = merged.holdings;
          addedSymbols = merged.addedSymbols;
          if (addedSymbols.length) {
            await savePersistedHoldings(nextHoldings);
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
        skipNextHoldingsPersistRef.current = true;
        setHoldings(nextHoldings);
        setHoldingsPersistenceMessage(
          addedSymbols.length || importedProfiles.length
            ? `已补充 ${[...addedSymbols, ...importedProfiles].join("、")}。`
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

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <div className="window-drag-region" data-tauri-drag-region />
      <AppTitlebarActions
        onOpenProfileConfig={openProfileConfig}
        onToggleSidebar={() => setSidebarCollapsed((current) => !current)}
        onToggleRightRail={() => setRightRailCollapsed((current) => !current)}
        sidebarCollapsed={sidebarCollapsed}
        rightRailCollapsed={rightRailCollapsed}
        rightRailLabel={activeWorkspace === "holdings" ? "资产详情栏" : "组合分析右侧区域"}
      />
      <main className="app-shell">
        <div className={`workspace-shell ${sidebarCollapsed ? "is-sidebar-collapsed" : ""}`}>
          <nav className="app-menu" aria-label="工作区" data-tauri-drag-region>
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
                rightRailCollapsed={rightRailCollapsed}
                onProfileGenerated={(summary) => void applyGeneratedProfile(summary)}
              />
            ) : null}

            {activeWorkspace === "analysis" ? (
              <div className={`analysis-page-stack ${!rightRailCollapsed && report && reportIsCurrent ? "has-decision-rail" : ""}`}>
                <div className="analysis-main-column">
                  <Card className="topbar-card">
                    <CardContent className="topbar-content">
                      <AppTopbar
                        asOf={asOf}
                        loading={loading}
                        profile={profile}
                        profiles={profiles}
                        dataSources={dataSources}
                        source={source}
                        onAsOfChange={setAsOf}
                        onProfileChange={setProfile}
                        onSourceChange={setSource}
                        onRefresh={() => void refresh()}
                      />
                    </CardContent>
                  </Card>

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

                            {activeTab === "backtest" ? <BacktestPanel backtest={report.backtest} showRules={false} /> : null}

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

                {!rightRailCollapsed && report && reportIsCurrent ? <DecisionRail report={report} /> : null}
              </div>
            ) : null}
          </div>
        </div>

        {report && reportIsCurrent ? (
          <div
            className={`config-drawer-layer ${profileDrawerOpen ? "is-open" : ""}`}
            aria-hidden={!profileDrawerOpen}
          >
            <button
              type="button"
              className="config-drawer-backdrop"
              aria-label="关闭配置面板"
              onClick={() => setProfileDrawerOpen(false)}
            />
            <aside
              className="config-drawer"
              role="dialog"
              aria-modal={profileDrawerOpen}
              aria-labelledby="profile-config-dialog-title"
            >
              <div className="config-drawer-head">
                <div>
                  <span>Global Config</span>
                  <strong id="profile-config-dialog-title">Profile 配置工作台</strong>
                </div>
                <button type="button" aria-label="关闭配置面板" onClick={() => setProfileDrawerOpen(false)}>
                  <CloseRoundedIcon fontSize="inherit" />
                </button>
              </div>
              <div className="config-workbench">
                <nav className="config-section-nav" role="tablist" aria-label="设置分类">
                  {CONFIG_PANEL_SECTIONS.map((section) => (
                    <button
                      key={section.key}
                      type="button"
                      role="tab"
                      aria-selected={activeConfigSection === section.key}
                      className={activeConfigSection === section.key ? "is-active" : undefined}
                      onClick={() => setActiveConfigSection(section.key)}
                    >
                      <strong>{section.label}</strong>
                      <span>{section.detail}</span>
                    </button>
                  ))}
                </nav>

                <div className="config-section-body">
                  <section className="config-section-pane" hidden={activeConfigSection !== "global"} aria-label="全局设置">
                    <div className="config-app-settings" aria-label="应用设置">
                      <div>
                        <span>界面模式</span>
                        <strong>界面模式</strong>
                        <p>{styleMode === "light" ? "冷白蓝灰面板，保留市场红绿标识。" : "石墨暗面板，适合长时间盯盘。"}</p>
                      </div>
                      <button
                        type="button"
                        className="appearance-mode-switch"
                        role="switch"
                        aria-checked={styleMode === "light"}
                        aria-label={styleMode === "light" ? "切换暗模式" : "切换亮模式"}
                        onClick={toggleStyleMode}
                      >
                        <span className="is-dark">
                          <DarkModeRoundedIcon fontSize="inherit" />
                          暗
                        </span>
                        <span className="is-light">
                          <LightModeRoundedIcon fontSize="inherit" />
                          亮
                        </span>
                        <i aria-hidden="true" />
                      </button>
                    </div>

                    <div className="config-global-grid">
                      <article>
                        <span>默认 Profile</span>
                        <strong>{profiles.find((item) => item.key === defaultProfile)?.name ?? defaultProfile}</strong>
                        <select
                          value={defaultProfile}
                          name="defaultProfile"
                          aria-label="默认 Profile"
                          onChange={(event) => setDefaultProfile(event.target.value)}
                        >
                          {(profiles.length ? profiles : [{ key: profile, name: report.profileName, market: report.profileMarket, description: "", builtin: false }]).map((item) => (
                            <option key={item.key} value={item.key}>
                              {item.name}
                            </option>
                          ))}
                        </select>
                        <p>启动时优先使用的 Profile；不会立即切换当前分析。</p>
                        <button type="button" onClick={() => setProfile(defaultProfile)} disabled={profile === defaultProfile}>
                          应用到当前
                        </button>
                      </article>
                      <article>
                        <span>默认数据源</span>
                        <strong>{dataSources.find((item) => item.key === defaultSource)?.name ?? defaultSource}</strong>
                        <select
                          value={defaultSource}
                          name="defaultSource"
                          aria-label="默认数据源"
                          onChange={(event) => setDefaultSource(event.target.value as DataSource)}
                        >
                          {(dataSources.length ? dataSources : [{ key: source, name: source, description: "", requiresConfig: false }]).map((item) => (
                            <option key={item.key} value={item.key}>
                              {item.name}
                            </option>
                          ))}
                        </select>
                        <p>启动时优先使用的数据源；当前分析仍可在顶部临时切换。</p>
                        <button type="button" onClick={() => setSource(defaultSource)} disabled={source === defaultSource}>
                          应用到当前
                        </button>
                      </article>
                      <article>
                        <span>当前会话</span>
                        <strong>{report.profileName}</strong>
                        <p>{report.profileMarket.toUpperCase()} · {report.sourceLabel} · {source}</p>
                      </article>
                    </div>
                  </section>

                  <ProfileConfigPanel
                    profile={configProfile}
                    activeAnalysisProfile={profile}
                    profiles={profiles}
                    report={report}
                    activeSection={activeProfileConfigSection}
                    hidden={activeConfigSection === "global"}
                    onProfileChange={setConfigProfile}
                    onApplyProfile={setProfile}
                    onProfilesChanged={reloadProfiles}
                    onRefresh={() => void refresh()}
                    onSectionChange={(section) => setActiveConfigSection(section)}
                  />
                </div>
              </div>
            </aside>
          </div>
        ) : null}
      </main>
    </ThemeProvider>
  );
}

export default App;
