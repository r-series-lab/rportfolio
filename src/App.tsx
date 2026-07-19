import AccountBalanceWalletRoundedIcon from "@mui/icons-material/AccountBalanceWalletRounded";
import FactCheckRoundedIcon from "@mui/icons-material/FactCheckRounded";
import QueryStatsRoundedIcon from "@mui/icons-material/QueryStatsRounded";
import ScienceRoundedIcon from "@mui/icons-material/ScienceRounded";
import TodayRoundedIcon from "@mui/icons-material/TodayRounded";
import { CssBaseline, ThemeProvider } from "@mui/material";
import { lazy, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import "./App.css";
import { AppTitlebarActions, AppTopbar } from "./components/app-topbar";
import type { AnalysisWorkspacePane, AnalysisWorkspaceTab } from "./components/analysis-workspace";
import { DeferredContent } from "./components/deferred-content";
import type { ConfigPanelSection } from "./components/settings-panel";
import { Toaster } from "./components/ui/sonner";
import { TooltipProvider } from "./components/ui/tooltip";
import { useLocalStorageState } from "./hooks/use-local-storage-state";
import { useMarketAnalysis } from "./hooks/use-market-analysis";
import { loadPersistedAccountStore, savePersistedAccountStore } from "./lib/account-storage";
import {
  accountCashHoldingsForPlanning,
  emptyAccountStore,
  normalizeAccountStore,
  type AccountStoreSnapshot,
} from "./lib/accounts";
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
  isCashHolding,
  normalizePositionPolicy,
  profileRiskGateFromReport,
  type PositionPolicy,
} from "./lib/position-plan";
import {
  DEFAULT_PORTFOLIO_VALUATION_SETTINGS,
  normalizePortfolioValuationSettings,
  type PortfolioValuationSettings,
} from "./lib/portfolio-valuation";
import {
  appendRecommendationRecords,
  loadRecommendationRecords,
  recordRecommendationDecision,
  recommendationRecordsForPositionPlan,
  type RecommendationDecisionAction,
  type RecommendationRecord,
} from "./lib/recommendation-log";
import { recommendationReadinessFor } from "./lib/recommendation-readiness";
import { buildExecutionAttribution } from "./lib/execution-attribution";
import { emptyPerformanceLedger, type PerformanceLedger } from "./lib/performance-ledger";
import { loadPersistedPerformanceLedger, savePersistedPerformanceLedger } from "./lib/performance-storage";
import { emptyStatementImportLedger, type StatementImportLedger } from "./lib/statement-import";
import { loadPersistedStatementImportLedger, savePersistedStatementImportLedger } from "./lib/statement-import-storage";
import {
  REQUESTED_FUND_SEED_STORAGE_KEY,
  applyResearchTargetBands,
  importRequestedFundProfiles,
  mergeRequestedFundHoldings,
} from "./lib/requested-fund-seeds";
import { loadPersistedTrades, savePersistedTrades } from "./lib/trade-storage";
import { isTradeRecord, type TradeRecord } from "./lib/trades";
import { loadPersistedOrders } from "./lib/order-persistence";
import { normalizeOrderRecords, type OrderRecord } from "./lib/order-store";
import { buildTodayInbox } from "./lib/today-inbox";
import type { DataSource, ProfileSummary } from "./lib/types";
import { configureDesktopWindow } from "./lib/window-layout";
import { createRPortfolioTheme, type RPortfolioStyleMode } from "./theme/r-theme";

type AppWorkspace = "today" | "holdings" | "asset" | "analysis" | "quant" | "review";

const loadTodayWorkspace = () => import("./components/today-workspace");
const loadPortfolioWorkspace = () => import("./components/portfolio-workspace");
const loadHoldingsWorkspace = () => import("./components/holdings-workspace");
const loadStatementImportPanel = () => import("./components/statement-import-panel");
const loadAssetAnalysisWorkspace = () => import("./components/asset-analysis-workspace");
const loadAnalysisWorkspace = () => import("./components/analysis-workspace");
const loadQuantLabWorkspace = () => import("./components/quant-lab-workspace");
const loadReviewWorkspace = () => import("./components/review-workspace");
const loadSettingsPanel = () => import("./components/settings-panel");

const TodayWorkspace = lazy(() => loadTodayWorkspace().then((module) => ({ default: module.TodayWorkspace })));
const PortfolioWorkspace = lazy(() => loadPortfolioWorkspace().then((module) => ({ default: module.PortfolioWorkspace })));
const HoldingsWorkspace = lazy(() => loadHoldingsWorkspace().then((module) => ({ default: module.HoldingsWorkspace })));
const StatementImportPanel = lazy(() => loadStatementImportPanel().then((module) => ({ default: module.StatementImportPanel })));
const AssetAnalysisWorkspace = lazy(() => loadAssetAnalysisWorkspace().then((module) => ({ default: module.AssetAnalysisWorkspace })));
const AnalysisWorkspace = lazy(() => loadAnalysisWorkspace().then((module) => ({ default: module.AnalysisWorkspace })));
const QuantLabWorkspace = lazy(() => loadQuantLabWorkspace().then((module) => ({ default: module.QuantLabWorkspace })));
const ReviewWorkspace = lazy(() => loadReviewWorkspace().then((module) => ({ default: module.ReviewWorkspace })));
const SettingsPanel = lazy(() => loadSettingsPanel().then((module) => ({ default: module.SettingsPanel })));

const WORKSPACE_PRELOADERS: Record<AppWorkspace, () => Promise<unknown>> = {
  today: loadTodayWorkspace,
  holdings: () => Promise.all([loadPortfolioWorkspace(), loadHoldingsWorkspace(), loadStatementImportPanel()]),
  asset: loadAssetAnalysisWorkspace,
  analysis: loadAnalysisWorkspace,
  quant: loadQuantLabWorkspace,
  review: loadReviewWorkspace,
};

const APP_WORKSPACES: Array<{ key: AppWorkspace; label: string; detail: string; icon: typeof AccountBalanceWalletRoundedIcon }> = [
  { key: "today", label: "今日", detail: "行动、阻断与复核", icon: TodayRoundedIcon },
  { key: "holdings", label: "组合账户", detail: "账户、现金、持仓与对账", icon: AccountBalanceWalletRoundedIcon },
  { key: "analysis", label: "组合决策", detail: "状态、证据与仓位", icon: QueryStatsRoundedIcon },
  { key: "quant", label: "量化交易", detail: "监测、下单、执行", icon: ScienceRoundedIcon },
  { key: "review", label: "复盘归因", detail: "收益、结果与晋级", icon: FactCheckRoundedIcon },
];

function App() {
  const workspaceMenuRef = useRef<HTMLElement | null>(null);
  const didHydrateHoldingsRef = useRef(false);
  const didHydrateTradesRef = useRef(false);
  const didHydrateAccountsRef = useRef(false);
  const didHydratePerformanceRef = useRef(false);
  const didHydrateStatementImportsRef = useRef(false);
  const skipNextHoldingsPersistRef = useRef(false);
  const skipNextTradesPersistRef = useRef(false);
  const skipNextAccountsPersistRef = useRef(false);
  const skipNextPerformancePersistRef = useRef(false);
  const skipNextStatementImportsPersistRef = useRef(false);
  const dailyDecisionSignatureRef = useRef("");
  const [activeWorkspace, setActiveWorkspace] = useLocalStorageState<AppWorkspace>("rportfolio.workspace", "today");
  const [assetResearchSymbol, setAssetResearchSymbol] = useState("");
  const [activeTab, setActiveTab] = useState<AnalysisWorkspaceTab>("overview");
  const [analysisPane, setAnalysisPane] = useState<AnalysisWorkspacePane>("decision");
  const [profileDrawerOpen, setProfileDrawerOpen] = useState(false);
  const [settingsMounted, setSettingsMounted] = useState(false);
  const [activeConfigSection, setActiveConfigSection] = useState<ConfigPanelSection>("global");
  const [configProfile, setConfigProfile] = useState("us-core");
  const [sidebarCollapsed, setSidebarCollapsed] = useLocalStorageState("rportfolio.sidebarCollapsed", false);
  const [compactViewport, setCompactViewport] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-width: 760px)").matches);
  const [compactSidebarCollapsed, setCompactSidebarCollapsed] = useState(true);
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
  const [portfolioValuation, setPortfolioValuation] = useLocalStorageState<PortfolioValuationSettings>(
    "rportfolio.portfolioValuation",
    DEFAULT_PORTFOLIO_VALUATION_SETTINGS,
  );
  const [holdings, setHoldings] = useLocalStorageState<HoldingRecord[]>("rportfolio.holdings", []);
  const [trades, setTrades] = useLocalStorageState<TradeRecord[]>("rportfolio.trades", []);
  const [accountStore, setAccountStore] = useState<AccountStoreSnapshot>(() => emptyAccountStore());
  const [performanceLedger, setPerformanceLedger] = useState<PerformanceLedger>(() => emptyPerformanceLedger());
  const [statementImportLedger, setStatementImportLedger] = useState<StatementImportLedger>(() => emptyStatementImportLedger());
  const [recommendationRecords, setRecommendationRecords] = useState<RecommendationRecord[]>([]);
  const [orderRecords, setOrderRecords] = useState<OrderRecord[]>([]);
  const [focusedDecisionId, setFocusedDecisionId] = useState("");
  const [holdingsPersistenceMessage, setHoldingsPersistenceMessage] = useState(
    isTauriRuntime() ? "正在读取本机持仓文件…" : "Web 预览保存在浏览器。",
  );
  const [, setTradesPersistenceMessage] = useState(
    isTauriRuntime() ? "正在读取本机交易流水…" : "Web 预览保存在浏览器。",
  );
  const [accountsPersistenceMessage, setAccountsPersistenceMessage] = useState(
    isTauriRuntime() ? "正在读取本机账户文件…" : "Web 预览保存在浏览器。",
  );
  const [performancePersistenceMessage, setPerformancePersistenceMessage] = useState(
    isTauriRuntime() ? "正在读取本机业绩账本…" : "Web 预览保存在浏览器。",
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
  const showLoadingState = Boolean(loading || (report && !reportIsCurrent));
  const localHoldingRows = useMemo(() => holdings.filter(isHoldingRecord), [holdings]);
  const localTradeRows = useMemo(() => trades.filter(isTradeRecord), [trades]);
  const planningHoldingRows = useMemo(() => {
    const accountCash = accountCashHoldingsForPlanning(accountStore.accounts);
    if (!accountCash.length) return localHoldingRows;
    return [...localHoldingRows.filter((holding) => !isCashHolding(holding)), ...accountCash];
  }, [accountStore.accounts, localHoldingRows]);
  const normalizedPositionPolicy = useMemo(() => normalizePositionPolicy(positionPolicy), [positionPolicy]);
  const normalizedPortfolioValuation = useMemo(
    () => normalizePortfolioValuationSettings(portfolioValuation),
    [portfolioValuation],
  );
  const normalizedFundExecutionPolicy = useMemo(
    () => normalizeFundExecutionPolicy(fundExecutionPolicy),
    [fundExecutionPolicy],
  );
  const activePositionRiskGate = useMemo(() => profileRiskGateFromReport(report), [report]);
  const activePositionPlan = useMemo(() => {
    return createPositionPlan(planningHoldingRows, {
      marketRiskScore: report?.score ?? 50,
      policy: normalizedPositionPolicy,
      riskGate: activePositionRiskGate,
      valuation: normalizedPortfolioValuation,
    });
  }, [activePositionRiskGate, normalizedPortfolioValuation, normalizedPositionPolicy, planningHoldingRows, report?.score]);
  const recommendationReadiness = useMemo(
    () => recommendationReadinessFor({ plan: activePositionPlan, report, reportIsCurrent }),
    [activePositionPlan, report, reportIsCurrent],
  );
  const executionAttribution = useMemo(
    () => buildExecutionAttribution(recommendationRecords, localTradeRows, report?.profileKey),
    [localTradeRows, recommendationRecords, report?.profileKey],
  );
  const todayInbox = useMemo(() => buildTodayInbox({
    asOf: report?.asOf ?? asOf,
    orders: orderRecords,
    profileKey: report?.profileKey ?? profile,
    readiness: recommendationReadiness,
    records: recommendationRecords,
    trades: localTradeRows,
    valuation: activePositionPlan.valuation,
  }), [
    activePositionPlan.valuation,
    asOf,
    localTradeRows,
    orderRecords,
    profile,
    recommendationReadiness,
    recommendationRecords,
    report?.asOf,
    report?.profileKey,
  ]);

  useEffect(() => {
    void configureDesktopWindow().catch(() => undefined);
  }, []);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 760px)");
    const updateCompactViewport = (event: MediaQueryListEvent | MediaQueryList) => {
      setCompactViewport(event.matches);
      if (event.matches) setCompactSidebarCollapsed(true);
    };
    updateCompactViewport(query);
    query.addEventListener("change", updateCompactViewport);
    return () => query.removeEventListener("change", updateCompactViewport);
  }, []);

  const effectiveSidebarCollapsed = compactViewport ? compactSidebarCollapsed : sidebarCollapsed;
  const toggleSidebar = () => {
    if (compactViewport) setCompactSidebarCollapsed((current) => !current);
    else setSidebarCollapsed((current) => !current);
  };

  const preloadWorkspace = (workspace: AppWorkspace) => {
    void WORKSPACE_PRELOADERS[workspace]().catch(() => undefined);
  };

  const handleWorkspaceMenuKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const buttons = Array.from(workspaceMenuRef.current?.querySelectorAll<HTMLButtonElement>("button[data-workspace-key]") ?? []);
    if (!buttons.length) return;
    event.preventDefault();
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? buttons.length - 1
        : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
    buttons[nextIndex]?.focus();
  };

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
  }, [report?.generatedAt]);

  useEffect(() => {
    let cancelled = false;
    void loadPersistedOrders()
      .then((orders) => {
        if (!cancelled) setOrderRecords(normalizeOrderRecords(orders));
      })
      .catch(() => {
        if (!cancelled) setOrderRecords([]);
      });
    const handleOrdersSaved = (event: Event) => {
      const orders = (event as CustomEvent<OrderRecord[]>).detail;
      if (Array.isArray(orders)) setOrderRecords(normalizeOrderRecords(orders));
    };
    window.addEventListener("rportfolio:orders-saved", handleOrdersSaved);
    return () => {
      cancelled = true;
      window.removeEventListener("rportfolio:orders-saved", handleOrdersSaved);
    };
  }, []);

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
    void appendRecommendationRecords(records)
      .then(setRecommendationRecords)
      .catch(() => {
        dailyDecisionSignatureRef.current = "";
      });
  }, [activePositionPlan.actions, recommendationReadiness, report, reportIsCurrent]);

  const handleDecisionAction = (
    record: RecommendationRecord,
    action: RecommendationDecisionAction,
    reviewAt?: string,
  ) => {
    void recordRecommendationDecision(record.decisionId, { action, reviewAt })
      .then(setRecommendationRecords);
  };

  const openDecisionExecution = (record: RecommendationRecord) => {
    if (record.disposition === "accepted") {
      setFocusedDecisionId(record.decisionId);
      setActiveWorkspace("quant");
      return;
    }
    void recordRecommendationDecision(record.decisionId, { action: "accept" })
      .then((records) => {
        setRecommendationRecords(records);
        setFocusedDecisionId(record.decisionId);
        setActiveWorkspace("quant");
      });
  };

  const openProfileConfig = () => {
    setSettingsMounted(true);
    void loadSettingsPanel().catch(() => undefined);
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

  useEffect(() => {
    let cancelled = false;
    void loadPersistedAccountStore()
      .then((persisted) => {
        if (cancelled) return;
        skipNextAccountsPersistRef.current = true;
        setAccountStore(normalizeAccountStore(persisted));
        setAccountsPersistenceMessage(
          isTauriRuntime() ? "账户事实已持久化到本机文件。" : "Web 预览保存在浏览器。",
        );
      })
      .catch((error) => {
        if (cancelled) return;
        setAccountsPersistenceMessage(error instanceof Error ? `账户文件读取失败：${error.message}` : "账户文件读取失败。");
      })
      .finally(() => {
        if (!cancelled) didHydrateAccountsRef.current = true;
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!didHydrateAccountsRef.current) return;
    if (skipNextAccountsPersistRef.current) {
      skipNextAccountsPersistRef.current = false;
      return;
    }
    let cancelled = false;
    void savePersistedAccountStore(accountStore)
      .then(() => {
        if (!cancelled) setAccountsPersistenceMessage(isTauriRuntime() ? "账户事实已保存到本机文件。" : "Web 预览保存在浏览器。");
      })
      .catch((error) => {
        if (!cancelled) setAccountsPersistenceMessage(error instanceof Error ? `账户保存失败：${error.message}` : "账户保存失败。");
      });
    return () => {
      cancelled = true;
    };
  }, [accountStore]);

  useEffect(() => {
    let cancelled = false;
    void loadPersistedPerformanceLedger()
      .then((persisted) => {
        if (cancelled) return;
        skipNextPerformancePersistRef.current = true;
        setPerformanceLedger(persisted);
        setPerformancePersistenceMessage(isTauriRuntime() ? "业绩账本已持久化到本机文件。" : "Web 预览保存在浏览器。");
      })
      .catch((error) => {
        if (!cancelled) setPerformancePersistenceMessage(error instanceof Error ? `业绩账本读取失败：${error.message}` : "业绩账本读取失败。");
      })
      .finally(() => {
        if (!cancelled) didHydratePerformanceRef.current = true;
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!didHydratePerformanceRef.current) return;
    if (skipNextPerformancePersistRef.current) {
      skipNextPerformancePersistRef.current = false;
      return;
    }
    let cancelled = false;
    void savePersistedPerformanceLedger(performanceLedger)
      .then(() => {
        if (!cancelled) setPerformancePersistenceMessage(isTauriRuntime() ? "业绩账本已保存到本机文件。" : "Web 预览保存在浏览器。");
      })
      .catch((error) => {
        if (!cancelled) setPerformancePersistenceMessage(error instanceof Error ? `业绩账本保存失败：${error.message}` : "业绩账本保存失败。");
      });
    return () => {
      cancelled = true;
    };
  }, [performanceLedger]);

  useEffect(() => {
    let cancelled = false;
    void loadPersistedStatementImportLedger()
      .then((persisted) => {
        if (cancelled) return;
        skipNextStatementImportsPersistRef.current = true;
        setStatementImportLedger(persisted);
      })
      .catch(() => {
        if (!cancelled) setStatementImportLedger(emptyStatementImportLedger());
      })
      .finally(() => {
        if (!cancelled) didHydrateStatementImportsRef.current = true;
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!didHydrateStatementImportsRef.current) return;
    if (skipNextStatementImportsPersistRef.current) {
      skipNextStatementImportsPersistRef.current = false;
      return;
    }
    void savePersistedStatementImportLedger(statementImportLedger).catch(() => undefined);
  }, [statementImportLedger]);

  const analysisToolbarVisible = activeWorkspace === "analysis";
  const analysisRightRailVisible = activeWorkspace === "analysis" && Boolean(report && reportIsCurrent);

  return (
    <ThemeProvider theme={theme}>
      <TooltipProvider>
        <CssBaseline />
        <a className="skip-to-workspace" href="#workspace-content">跳到当前工作区</a>
        <div className="window-drag-region" data-tauri-drag-region />
        <AppTitlebarActions
          onOpenProfileConfig={openProfileConfig}
          onToggleSidebar={toggleSidebar}
          sidebarCollapsed={effectiveSidebarCollapsed}
          sourceDetail={recommendationReadiness.dataQuality.detail}
          sourceLabel={report && reportIsCurrent
            ? report.sourceLabel
            : dataSources.find((item) => item.key === source)?.name ?? source}
          sourceQuality={recommendationReadiness.dataQuality.severity}
        />
        {analysisToolbarVisible ? (
        <div
          className={`window-center-toolbar ${analysisRightRailVisible ? "has-right-rail" : ""} ${effectiveSidebarCollapsed ? "is-sidebar-collapsed" : ""}`}
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
        <div className={`workspace-shell ${effectiveSidebarCollapsed ? "is-sidebar-collapsed" : ""}`}>
          <nav className="app-menu" aria-label="工作区" ref={workspaceMenuRef}>
            <div className="app-menu-brand" aria-hidden={effectiveSidebarCollapsed ? "true" : undefined}>
              <span>
                <AccountBalanceWalletRoundedIcon fontSize="inherit" />
              </span>
              <strong>rPortfolio</strong>
            </div>
            {APP_WORKSPACES.map((workspace, index) => {
              const Icon = workspace.icon;
              const active = activeWorkspace === workspace.key;
              return (
                <button
                  key={workspace.key}
                  type="button"
                  data-workspace-key={workspace.key}
                  aria-label={workspace.label}
                  aria-current={active ? "page" : undefined}
                  className={active ? "is-active" : undefined}
                  title={workspace.label}
                  onFocus={() => preloadWorkspace(workspace.key)}
                  onKeyDown={(event) => handleWorkspaceMenuKeyDown(event, index)}
                  onPointerEnter={() => preloadWorkspace(workspace.key)}
                  onClick={() => setActiveWorkspace(workspace.key)}
                >
                  <Icon fontSize="inherit" aria-hidden="true" />
                  <span>
                    <strong>{workspace.label}</strong>
                  </span>
                </button>
              );
            })}
          </nav>

          <div
            id="workspace-content"
            className="workspace-area"
            role="region"
            tabIndex={-1}
            aria-label={APP_WORKSPACES.find((workspace) => workspace.key === activeWorkspace)?.label ?? "当前工作区"}
          >
            <DeferredContent
              label={APP_WORKSPACES.find((workspace) => workspace.key === activeWorkspace)?.label ?? "当前工作区"}
              resetKey={activeWorkspace}
            >
            {activeWorkspace === "today" ? (
              <TodayWorkspace
                inbox={todayInbox}
                loading={loading}
                profileName={profiles.find((item) => item.key === profile)?.name ?? profile}
                onDecisionAction={handleDecisionAction}
                onOpenExecution={openDecisionExecution}
              />
            ) : null}

            {activeWorkspace === "holdings" ? (
              <PortfolioWorkspace
                accountStore={accountStore}
                holdings={localHoldingRows}
                onAccountStoreChange={setAccountStore}
                onOpenQuant={() => setActiveWorkspace("quant")}
                persistenceMessage={accountsPersistenceMessage}
                valuation={normalizedPortfolioValuation}
                importer={(
                  <StatementImportPanel
                    accountStore={accountStore}
                    holdings={localHoldingRows}
                    importLedger={statementImportLedger}
                    onAccountStoreChange={setAccountStore}
                    onHoldingsChange={setHoldings}
                    onImportLedgerChange={setStatementImportLedger}
                    onPerformanceLedgerChange={setPerformanceLedger}
                    onTradesChange={setTrades}
                    performanceLedger={performanceLedger}
                    trades={localTradeRows}
                    valuation={normalizedPortfolioValuation}
                  />
                )}
              >
                <HoldingsWorkspace
                  accounts={accountStore.accounts}
                  holdings={holdings}
                  orders={orderRecords}
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
              </PortfolioWorkspace>
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
              <AnalysisWorkspace
                activeTab={activeTab}
                analysisPane={analysisPane}
                error={error}
                onActiveTabChange={setActiveTab}
                onAnalysisPaneChange={setAnalysisPane}
                report={report}
                reportIsCurrent={reportIsCurrent}
                showLoadingState={showLoadingState}
              />
            ) : null}

            {activeWorkspace === "quant" ? (
              <QuantLabWorkspace
                accountStore={accountStore}
                decisionRecords={recommendationRecords}
                focusedDecisionId={focusedDecisionId}
                fundExecutionPolicy={normalizedFundExecutionPolicy}
                holdings={localHoldingRows}
                loading={loading}
                onHoldingsChange={setHoldings}
                onAccountStoreChange={setAccountStore}
                onOpenAnalysis={() => setActiveWorkspace("analysis")}
                onOpenHoldings={() => setActiveWorkspace("holdings")}
                onRefresh={() => void refresh()}
                positionPlan={activePositionPlan}
                report={report}
                reportIsCurrent={reportIsCurrent}
                trades={localTradeRows}
              />
            ) : null}

            {activeWorkspace === "review" ? (
              <ReviewWorkspace
                accounts={accountStore.accounts}
                attribution={executionAttribution}
                holdings={planningHoldingRows}
                ledger={performanceLedger}
                onLedgerChange={setPerformanceLedger}
                performancePersistenceMessage={performancePersistenceMessage}
                positionPlan={activePositionPlan}
                recommendationRecords={recommendationRecords}
                report={report}
                reportIsCurrent={reportIsCurrent}
                trades={localTradeRows}
                valuation={normalizedPortfolioValuation}
              />
            ) : null}
            </DeferredContent>
          </div>
        </div>

        {report && reportIsCurrent && settingsMounted ? (
          <DeferredContent label="Profile 配置" resetKey={`settings-${profileDrawerOpen}`} variant="overlay">
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
              portfolioValuation={normalizedPortfolioValuation}
              source={source}
              styleMode={styleMode}
              onSetStyleMode={setStyleMode}
              onSetDefaultProfile={setDefaultProfile}
              onSetDefaultSource={setDefaultSource}
              onFundExecutionPolicyChange={(policy) => setFundExecutionPolicy(normalizeFundExecutionPolicy(policy))}
              onPortfolioValuationChange={(valuation) => setPortfolioValuation(normalizePortfolioValuationSettings(valuation))}
              onSourceChange={setSource}
              onApplyDefaultProfile={() => setProfile(defaultProfile)}
              onProfileChange={setConfigProfile}
              onUseProfile={setProfile}
              onProfilesChanged={reloadProfiles}
              onRefresh={() => void refresh()}
            />
          </DeferredContent>
        ) : null}
      </main>
      <Toaster theme={styleMode} position="bottom-right" />
      </TooltipProvider>
    </ThemeProvider>
  );
}

export default App;
