import AutoGraphRoundedIcon from "@mui/icons-material/AutoGraphRounded";
import CandlestickChartRoundedIcon from "@mui/icons-material/CandlestickChartRounded";
import DatasetRoundedIcon from "@mui/icons-material/DatasetRounded";
import PlayArrowRoundedIcon from "@mui/icons-material/PlayArrowRounded";
import ReceiptLongRoundedIcon from "@mui/icons-material/ReceiptLongRounded";
import ShieldRoundedIcon from "@mui/icons-material/ShieldRounded";
import SpeedRoundedIcon from "@mui/icons-material/SpeedRounded";
import TuneRoundedIcon from "@mui/icons-material/TuneRounded";
import { lazy, useEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import "../styles/pages/quant-lab-shared.css";
import {
  buildBrokerAdapterPlan,
  cancelOrderThroughAdapter,
  prepareOrderThroughAdapter,
  syncAccountThroughAdapter,
  syncMarketQuoteThroughAdapter,
  submitOrderThroughAdapter,
  syncOrderStatusThroughAdapter,
  type BrokerMode,
} from "../lib/broker-adapter";
import {
  buildExecutionReadiness,
  buildQuantDeskSummary,
  createTradeTicketFromRecommendation,
  parseMoneyLabel,
  sideLabel,
  type ExecutionModeKey,
} from "../lib/quant-desk-view";
import {
  probeBrokerBridge,
  type BrokerBridgeStatus,
  type MarketQuoteSnapshot,
  type OrderCommandAction,
} from "../lib/broker-bridge";
import type { ScenarioProjectionResult } from "../lib/backtest-engine";
import { lookupFundNav, lookupFundProfileSeed } from "../lib/analysis";
import { executionGuidanceFor } from "../lib/execution-guidance";
import type { HoldingRecord } from "../lib/holdings";
import {
  accountBookFromSnapshots,
  reconcileAccountBookWithHoldings,
  type AccountBookPosition,
  type PortfolioReconcileRow,
} from "../lib/account-book";
import {
  accountIdForBrokerSnapshot,
  summarizeAccounts,
  upsertBrokerAccountSnapshot,
  type AccountStoreSnapshot,
} from "../lib/accounts";
import {
  applyOrderCommandResult,
  applyOrderRouteResult,
  applyBrokerAccountSnapshotToOrders,
  applyPreSubmitGuardResult,
  createOrderEvent,
  createOrderRecordFromIntent,
  mergeOrderRecords,
  normalizeOrderRecords,
  orderCommandErrorResult,
  orderStatusLabel,
  routeOrderErrorResult,
  summarizeOrderCenter,
  type OrderRecord,
  type OrderSourceKind,
} from "../lib/order-store";
import { isCashHolding, type PositionPlan, type PositionPlanAction } from "../lib/position-plan";
import { recommendationReadinessFor, type RecommendationReadiness } from "../lib/recommendation-readiness";
import { assessPortfolioOverlap } from "../lib/portfolio-overlap";
import { assessFundSubstitutions } from "../lib/fund-substitution";
import { buildFundReplacementPlans } from "../lib/fund-replacement-plan";
import { rankRecommendations } from "../lib/recommendation-ranking";
import {
  appendRecommendationRecords,
  recommendationRecordsForOrders,
  type RecommendationRecord,
} from "../lib/recommendation-log";
import {
  evaluateProfileMonitor,
  type ProfileMonitorEvaluation,
} from "../lib/profile-monitor";
import { guardOrderIntent, summarizeRiskGuardResults, type RiskGuardResult } from "../lib/risk-guard";
import {
  emptyStrategyScore,
  evaluateStrategy,
  normalizePlanTone,
  QBOT_PRESETS,
  STRATEGIES,
  toneFromText,
  type LabTone,
  type OrderIntent,
  type QbotPreset,
  type QbotPresetKey,
  type StrategyDefinition,
  type StrategyKey,
  type StrategyScore,
} from "../lib/strategy-engine";
import { analyzeTradeHabit, type TradeHabit, type TradeRecord } from "../lib/trades";
import { decisionIdForOrderIntent } from "../lib/today-inbox";
import { handleTabListKeyDown } from "../lib/tab-keyboard";
import {
  activatePaperSimState,
  paperSimCompactReturn,
  pausePaperSimState,
  summarizePaperSimState,
  type PaperSimSummary,
} from "../lib/paper-sim";
import type {
  AssetStatus,
  MarketAnalysisReport,
  TechnicalRow,
} from "../lib/types";
import { formatMoney, formatNumber, formatPercent } from "../lib/utils";
import type { FundExecutionPolicy } from "../lib/fund-execution-policy";
import { useLocalStorageState } from "../hooks/use-local-storage-state";
import { useMonitorStore } from "../hooks/use-monitor-store";
import { useOrderStore } from "../hooks/use-order-store";
import { usePaperSimStore } from "../hooks/use-paper-sim-store";
import { useRiskPolicy } from "../hooks/use-risk-policy";
import { exportOrderAudit, type OrderAuditExportFormat } from "../lib/order-persistence";
import { normalizeRiskGuardPolicy } from "../lib/risk-policy";
import {
  DEFAULT_STRATEGY_POLICY_CONFIG,
  normalizeStrategyPolicyConfig,
  scalingPolicyDefinition,
  strategyScalingRuntimeBySymbol,
  type ScalingPolicyKey,
  type StrategyPolicyConfig,
} from "../lib/strategy-policies";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { DeferredContent } from "./deferred-content";
import { ProgressiveDisclosure } from "./progressive-disclosure";
import {
  BROKER_OPTIONS,
  EXECUTION_MODE_OPTIONS,
  EXECUTION_RAIL_TABS,
  isManualExecutionOrder,
  MANUAL_BROKER_MODE,
  PAPER_SIM_BROKER_MODE,
  type ExecutionMode,
  type ExecutionRailTab,
  type LabLog,
  type QuantDialogKey,
} from "./quant-lab/quant-lab-contracts";
import {
  loadQuantAccount,
  loadQuantDialogs,
  loadQuantLogs,
  loadQuantOrders,
  loadQuantSimulation,
  preloadQuantModule,
} from "./quant-lab/quant-module-loader";

type QuantLabWorkspaceProps = {
  accountStore: AccountStoreSnapshot;
  decisionRecords: RecommendationRecord[];
  focusedDecisionId: string;
  fundExecutionPolicy: FundExecutionPolicy;
  holdings: HoldingRecord[];
  loading: boolean;
  onAccountStoreChange: Dispatch<SetStateAction<AccountStoreSnapshot>>;
  onHoldingsChange: Dispatch<SetStateAction<HoldingRecord[]>>;
  onOpenAnalysis: () => void;
  onOpenHoldings: () => void;
  onRefresh: () => void;
  positionPlan: PositionPlan;
  report: MarketAnalysisReport | null;
  reportIsCurrent: boolean;
  trades: TradeRecord[];
};

type EngineMode = "scenario" | "paper";

type WatchRow = {
  symbol: string;
  label: string;
  close: number;
  change1d: number | null;
  weight: number | null;
  status: string;
  tone: LabTone;
  rsi: number | null;
  volumeRatio: number | null;
  source: "holding" | "profile";
  sourceLabel: string;
  tradable: boolean;
  tradeBlockReason: string;
};

type WatchFilter = "tradable" | "signals" | "all";

const PROFILE_MONITOR_INTERVAL_MS = 60_000;
const PROFILE_MONITOR_INTERVAL_LABEL = "60 秒";

const QuantLabDialogs = lazy(loadQuantDialogs);
const QuantSimulationPanel = lazy(loadQuantSimulation);
const QuantOrdersPanel = lazy(loadQuantOrders);
const QuantAccountPanel = lazy(loadQuantAccount);
const QuantLogsPanel = lazy(loadQuantLogs);

export function QuantLabWorkspace({
  accountStore,
  decisionRecords,
  focusedDecisionId,
  fundExecutionPolicy,
  holdings,
  loading,
  onAccountStoreChange,
  onHoldingsChange,
  onOpenAnalysis,
  onOpenHoldings,
  onRefresh,
  positionPlan,
  report,
  reportIsCurrent,
  trades,
}: QuantLabWorkspaceProps) {
  const onRefreshRef = useRef(onRefresh);
  const monitorRoutingKeyRef = useRef("");
  const paperSettlementKeyRef = useRef("");
  const [activeStrategyKey, setActiveStrategyKey] = useState<StrategyKey>("risk-gated-trend");
  const [storedStrategyPolicyConfig, setStoredStrategyPolicyConfig] = useLocalStorageState<StrategyPolicyConfig>(
    "rportfolio.quant.strategy-policy.v1",
    DEFAULT_STRATEGY_POLICY_CONFIG,
  );
  const [engineMode, setEngineMode] = useState<EngineMode>("paper");
  const [executionMode, setExecutionMode] = useState<ExecutionMode>("manual");
  const [brokerMode, setBrokerMode] = useState<BrokerMode>("local-paper");
  const [budgetWeight, setBudgetWeight] = useState(3);
  const [eventLogs, setEventLogs] = useState<LabLog[]>([]);
  const [activeDialog, setActiveDialog] = useState<QuantDialogKey>(null);
  const [controlPanelOpen, setControlPanelOpen] = useState(false);
  const [executionRailTab, setExecutionRailTab] = useState<ExecutionRailTab>("ticket");
  const [bridgeError, setBridgeError] = useState("");
  const [bridgeLoading, setBridgeLoading] = useState(false);
  const [bridgeStatuses, setBridgeStatuses] = useState<BrokerBridgeStatus[]>([]);
  const [lastRun, setLastRun] = useState<ScenarioProjectionResult | null>(null);
  const [qbotPresetKey, setQbotPresetKey] = useState<QbotPresetKey>("rsi-single-factor");
  const [queuedOrders, setQueuedOrders] = useOrderStore();
  const [paperSim, setPaperSim] = usePaperSimStore();
  const [monitorStore, , , commitMonitorEvaluation] = useMonitorStore();
  const [riskPolicy, setRiskPolicy, riskPolicyState] = useRiskPolicy();
  const [monitorEnabled, setMonitorEnabled] = useState(false);
  const [monitorLastRun, setMonitorLastRun] = useState("");
  const [monitorNextRun, setMonitorNextRun] = useState("");
  const [riskOverride, setRiskOverride] = useState(false);
  const [selectedSymbol, setSelectedSymbol] = useState("");
  const [watchFilter, setWatchFilter] = useState<WatchFilter>("tradable");
  const [activeOrderCommandKey, setActiveOrderCommandKey] = useState("");
  const [orderAuditExporting, setOrderAuditExporting] = useState<OrderAuditExportFormat | "">("");
  const [executionAccountId, setExecutionAccountId] = useState("");
  const [accountSyncing, setAccountSyncing] = useState(false);
  const [marketQuotes, setMarketQuotes] = useState<Record<string, MarketQuoteSnapshot>>({});
  const [marketQuoteSyncing, setMarketQuoteSyncing] = useState("");
  const fundStatusSyncKeyRef = useRef("");
  const handleQuantDialogIntent = () => preloadQuantModule("dialogs");
  const openQuantDialog = (dialog: Exclude<QuantDialogKey, null>) => {
    preloadQuantModule("dialogs");
    setActiveDialog(dialog);
  };
  const strategy = STRATEGIES.find((item) => item.key === activeStrategyKey) ?? STRATEGIES[0];
  const strategyPolicyConfig = useMemo(
    () => normalizeStrategyPolicyConfig(storedStrategyPolicyConfig),
    [storedStrategyPolicyConfig],
  );
  const activeScalingPolicy = scalingPolicyDefinition(strategyPolicyConfig.scalingPolicyKey);
  const qbotPreset = QBOT_PRESETS.find((item) => item.key === qbotPresetKey) ?? QBOT_PRESETS[0];
  const broker = BROKER_OPTIONS.find((item) => item.key === brokerMode) ?? BROKER_OPTIONS[0];
  const activeAdapterPlan = useMemo(
    () => buildBrokerAdapterPlan(bridgeStatuses, brokerMode),
    [bridgeStatuses, brokerMode],
  );
  const activeBridgeKind = activeAdapterPlan.bridge;
  const bridgeReady = activeAdapterPlan.ready;
  const paperSimSummary = useMemo(() => summarizePaperSimState(paperSim), [paperSim]);
  const scalingRuntimeBySymbol = useMemo(
    () => strategyScalingRuntimeBySymbol(paperSim.trades, strategy.key, strategyPolicyConfig.scalingPolicyKey),
    [paperSim.trades, strategy.key, strategyPolicyConfig.scalingPolicyKey],
  );
  const executionLabel = executionModeLabel(executionMode);
  const executionRouteLabel = executionMode === "manual" ? "手动执行" : executionMode === "simulation" ? "模拟实验" : broker.label;
  const recommendationReadiness = recommendationReadinessFor({ plan: positionPlan, report, reportIsCurrent });
  const executionReady = executionMode === "manual"
    || executionMode === "simulation"
    || (bridgeReady && recommendationReadiness.autoExecutionAllowed);
  const executionTone: LabTone = executionMode === "manual" ? "caution" : executionMode === "simulation" ? paperSimSummary.tone : bridgeReady ? "positive" : "caution";
  const orderBrokerMode = executionMode === "manual" ? MANUAL_BROKER_MODE : executionMode === "simulation" ? PAPER_SIM_BROKER_MODE : brokerMode;
  const quantDeskSummary = buildQuantDeskSummary({
    asOf: report?.asOf ?? "",
    executionMode: executionMode as ExecutionModeKey,
    readiness: recommendationReadiness,
    routeLabel: executionRouteLabel,
    strategyLabel: strategy.label,
  });
  const realHoldings = useMemo(() => holdings.filter((item) => item.role === "real"), [holdings]);
  const totalValue = positionPlan.totalValue;
  const paperSimulationCurrencyReady = realHoldings.every(
    (holding) => holding.currency.toUpperCase() === positionPlan.currency,
  );
  const tradeHabit = analyzeTradeHabit(trades, holdings, totalValue, positionPlan.valuation.settings);
  const strategyEvaluation = report && reportIsCurrent
    ? evaluateStrategy({
      budgetWeight,
      positionPlan,
      report,
      riskOverride,
      policyConfig: strategyPolicyConfig,
      runtimeBySymbol: executionMode === "simulation" ? scalingRuntimeBySymbol : {},
      strategyKey: strategy.key,
      tradeHabit,
    })
    : null;
  const score = strategyEvaluation?.score ?? emptyStrategyScore(loading);
  const watchRows = useMemo(
    () => (report && reportIsCurrent ? watchRowsFor(report, holdings, positionPlan) : []),
    [holdings, positionPlan, report, reportIsCurrent],
  );
  const watchCounts = useMemo(() => summarizeWatchRows(watchRows), [watchRows]);
  const filteredWatchRows = useMemo(() => filterWatchRows(watchRows, watchFilter), [watchRows, watchFilter]);
  const orders = (strategyEvaluation?.orderIntents ?? []).map((order) => ({
    ...order,
    decisionId: decisionIdForOrderIntent(order, decisionRecords, {
      asOf: report?.asOf ?? "",
      profileKey: report?.profileKey ?? "",
      preferredDecisionId: focusedDecisionId,
    }),
  }));
  const orderRows = useMemo(() => normalizeOrderRecords(queuedOrders), [queuedOrders]);
  const orderRiskResults = report && reportIsCurrent
    ? orders.map((order) => guardOrderIntent({
      holdings: realHoldings,
      orderIntent: order,
      policy: riskPolicy,
      positionPlan,
      preset: qbotPreset,
      quote: marketQuotes[symbolKey(order.symbol)] ?? null,
      queuedOrders: orderRows,
      report,
      riskOverride,
      score,
      totalValue,
    }))
    : [];
  const rankedRecommendations = report && reportIsCurrent
    ? rankRecommendations({
      actions: positionPlan.actions,
      guards: orderRiskResults,
      orders,
      readiness: recommendationReadiness,
      report,
      strategyScore: score,
    })
    : [];
  const decisionCoverage = summarizeDecisionCoverage(positionPlan, orders, orderRiskResults);
  const portfolioOverlap = assessPortfolioOverlap(realHoldings, totalValue, positionPlan.valuation.settings);
  const fundSubstitution = assessFundSubstitutions(realHoldings, portfolioOverlap.pairs);
  const fundReplacementPlans = buildFundReplacementPlans({
    asOf: report?.asOf ?? "",
    decisions: fundSubstitution.decisions,
    holdings: realHoldings,
    totalValue,
    trades,
  });
  const primaryReplacementPlan = fundReplacementPlans.find((item) => item.action === "replace")
    ?? fundReplacementPlans.find((item) => item.action === "draft" || item.action === "blocked")
    ?? fundReplacementPlans[0]
    ?? null;
  const activeWatch = filteredWatchRows.find((item) => item.symbol === selectedSymbol) ?? filteredWatchRows[0] ?? null;
  const activeRecommendation = activeWatch
    ? orders.find((order) => symbolKey(order.symbol) === symbolKey(activeWatch.symbol)) ?? null
    : null;
  const activeOrderGuard = activeRecommendation
    ? orderRiskResults.find((item) => item.intent.key === activeRecommendation.key) ?? null
    : null;
  const activeRanking = activeRecommendation
    ? rankedRecommendations.find((item) => item.order.key === activeRecommendation.key) ?? null
    : null;
  const activePlanAction = activeWatch
    ? positionPlan.actions.find((action) => symbolKey(action.symbol) === symbolKey(activeWatch.symbol)) ?? null
    : null;
  const activeWatchRegistered = Boolean(activeWatch && holdings.some((item) => symbolKey(item.symbol) === symbolKey(activeWatch.symbol)));
  const activeQuote = activeWatch ? marketQuotes[symbolKey(activeWatch.symbol)] ?? null : null;
  const activeExecutionReadiness = buildExecutionReadiness({
    executionMode,
    guardSummary: activeOrderGuard?.blocked ? activeOrderGuard.summary : undefined,
    recommendation: activeRecommendation,
    recommendationAllowed: Boolean(activeRecommendation && recommendationAllowed(activeRecommendation, recommendationReadiness)),
    readiness: recommendationReadiness,
    watch: activeWatch,
  });
  const activeTicketReady = !activeExecutionReadiness.disabled;
  const activeTargetWeight = activeWatch?.weight != null && activePlanAction
    ? Math.max(0, activeWatch.weight + activePlanAction.weightDelta)
    : null;
  const activeTicketQuantity = activeRecommendation && activeWatch?.close
    ? (activeRecommendation.notional ?? parseMoneyLabel(activeRecommendation.amount)) / activeWatch.close
    : 0;
  const activeRecommendationAllowed = Boolean(activeRecommendation && recommendationAllowed(activeRecommendation, recommendationReadiness));
  const activeRiskPassed = Boolean(activeRecommendationAllowed && !positionPlan.riskGate?.blocked);
  const activeExecutionGuidance = useMemo(
    () => executionGuidanceFor({
      action: activePlanAction,
      currentPrice: activeWatch?.close ?? null,
      report,
      side: activeRecommendation?.side ?? null,
    }),
    [activePlanAction, activeRecommendation?.side, activeWatch?.close, report],
  );
  const activeWatchTradeStatus = activeWatch
    ? activeOrderGuard?.blocked
      ? activeOrderGuard.summary
      : activeWatch.tradable
      ? activeWatch.sourceLabel
      : activeWatch.tradeBlockReason
    : "选择标的";
  const orderCenter = useMemo(() => summarizeOrderCenter(orderRows), [orderRows]);
  useEffect(() => {
    if (!focusedDecisionId) return;
    const decision = decisionRecords.find((record) => record.decisionId === focusedDecisionId);
    if (!decision) return;
    setWatchFilter("all");
    setSelectedSymbol(decision.symbol);
    setExecutionRailTab("ticket");
  }, [decisionRecords, focusedDecisionId]);
  const blockedOrderCount = orderRows.filter((order) => order.status === "blocked").length;
  const accountSnapshots = accountStore.brokerSnapshots;
  const activeAccounts = useMemo(
    () => accountStore.accounts.filter((account) => account.status === "active"),
    [accountStore.accounts],
  );
  const accountBook = useMemo(() => accountBookFromSnapshots(accountSnapshots, realHoldings), [accountSnapshots, realHoldings]);
  const accountPortfolio = useMemo(
    () => summarizeAccounts(activeAccounts, positionPlan.valuation.settings),
    [activeAccounts, positionPlan.valuation.settings],
  );
  const accountReconcile = useMemo(() => reconcileAccountBookWithHoldings(accountBook, realHoldings), [accountBook, realHoldings]);
  const actionableReconcileRows = useMemo(() => accountReconcile.rows.filter((row) => row.status !== "matched"), [accountReconcile.rows]);
  useEffect(() => {
    if (executionAccountId && activeAccounts.some((account) => account.id === executionAccountId)) return;
    setExecutionAccountId(activeAccounts[0]?.id ?? "");
  }, [activeAccounts, executionAccountId]);
  const monitorSnapshot = monitorStore.snapshot;
  const monitorEvaluation = report && reportIsCurrent
    ? evaluateProfileMonitor({
      orderIntents: orders,
      positionPlan,
      previousSnapshot: monitorSnapshot,
      queuedOrders: orderRows,
      report,
      score,
    })
    : null;
  const logs = labLogsFor({ engineMode, eventLogs, executionMode, lastRun, paperSimSummary, queuedOrders: orderRows, report, reportIsCurrent, score, strategy, tradeHabit, trades });
  const activeGate = positionPlan.riskGate;

  useEffect(() => {
    onRefreshRef.current = onRefresh;
  }, [onRefresh]);

  useEffect(() => {
    const cleanup = blockNonTradableActiveOrders(orderRows, realHoldings);
    if (!cleanup.changed) return;
    setQueuedOrders(cleanup.orders);
    if (cleanup.blocked > 0) {
      pushLog("caution", `已整理 ${cleanup.blocked} 条失效旧委托，保留审计记录。`);
    }
  }, [orderRows, realHoldings, setQueuedOrders]);

  useEffect(() => {
    if (!report || !reportIsCurrent) return;
    const fundSymbols = realHoldings
      .filter((holding) => holding.assetType === "fund" && /^\d{6}$/.test(holding.symbol))
      .map((holding) => symbolKey(holding.symbol));
    if (!fundSymbols.length) return;
    const syncKey = `${report.asOf}:${fundSymbols.sort().join(",")}`;
    if (fundStatusSyncKeyRef.current === syncKey) return;
    fundStatusSyncKeyRef.current = syncKey;
    let cancelled = false;
    void Promise.all(fundSymbols.map(async (symbol) => {
      try {
        return { symbol, seed: await lookupFundProfileSeed(symbol) };
      } catch {
        return { symbol, seed: null };
      }
    })).then((results) => {
      if (cancelled) return;
      const seedBySymbol = new Map(results.filter((item) => item.seed).map((item) => [item.symbol, item.seed!]));
      if (!seedBySymbol.size) return;
      onHoldingsChange((current) => current.map((holding) => {
        const seed = seedBySymbol.get(symbolKey(holding.symbol));
        if (!seed) return holding;
        return {
          ...holding,
          confirmedNav: seed.nav ?? holding.confirmedNav,
          confirmedNavAsOf: seed.navDate ?? holding.confirmedNavAsOf,
          currentPrice: seed.estimateNav ?? seed.nav ?? holding.currentPrice,
          fundPurchaseStatus: seed.purchaseStatus || holding.fundPurchaseStatus,
          fundPurchaseOpen: seed.purchaseOpen ?? undefined,
          fundPurchaseLimit: seed.purchaseLimit ?? undefined,
          fundRedemptionOpen: seed.redemptionOpen ?? undefined,
          fundTradeStatusAsOf: seed.fetchedAt,
          fundHoldingsAsOf: seed.holdingsAsOf ?? holding.fundHoldingsAsOf,
          fundTopHoldings: seed.topHoldings.length ? seed.topHoldings : holding.fundTopHoldings,
          fundNavHistory: seed.navHistory.length ? seed.navHistory : holding.fundNavHistory,
          fundRedemptionFeeSchedule: seed.redemptionFeeSchedule.length ? seed.redemptionFeeSchedule : holding.fundRedemptionFeeSchedule,
          quoteSource: "eastmoney_tiantian" as const,
        };
      }));
    });
    return () => {
      cancelled = true;
    };
  }, [onHoldingsChange, realHoldings, report, reportIsCurrent]);

  useEffect(() => {
    let ignore = false;
    setBridgeLoading(true);
    setBridgeError("");
    void probeBrokerBridge()
      .then((statuses) => {
        if (ignore) return;
        setBridgeStatuses(statuses);
      })
      .catch((error) => {
        if (ignore) return;
        setBridgeError(error instanceof Error ? error.message : "桥接探测失败");
      })
      .finally(() => {
        if (!ignore) setBridgeLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    if (!monitorEnabled) return;
    const timer = window.setInterval(() => {
      setMonitorLastRun(shortTimeLabel());
      setMonitorNextRun(nextRunLabel(PROFILE_MONITOR_INTERVAL_MS));
      onRefreshRef.current();
      pushLog("neutral", `Profile 监测刷新中 · 间隔 ${PROFILE_MONITOR_INTERVAL_LABEL}`);
    }, PROFILE_MONITOR_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [monitorEnabled]);

  const pushLog = (tone: LabTone, text: string) => {
    setEventLogs((current) => [
      { key: `event-${Date.now()}-${current.length}`, time: "now", tone, text },
      ...current,
    ].slice(0, 8));
  };

  const recordRecommendations = (
    intents: OrderIntent[],
    source: RecommendationRecord["source"],
  ) => {
    if (!report || !reportIsCurrent || !intents.length) return;
    const records = recommendationRecordsForOrders({
      orders: intents,
      readiness: recommendationReadiness,
      report,
      score,
      source,
      strategy,
      rankings: rankedRecommendations,
    });
    void appendRecommendationRecords(records).catch((error) => {
      pushLog("caution", error instanceof Error ? `建议快照保存失败 · ${error.message}` : "建议快照保存失败");
    });
  };

  const handleExecutionModeChange = (nextMode: ExecutionMode) => {
    if (nextMode === "auto" && !recommendationReadiness.autoExecutionAllowed) {
      setExecutionMode("simulation");
      pushLog("caution", `${recommendationReadiness.validationLabel} · 通道自动已阻断，已切换到自动模拟。`);
      return;
    }
    setExecutionMode(nextMode);
    const nextTone: LabTone = nextMode === "manual" ? "caution" : nextMode === "simulation" ? paperSimSummary.tone : bridgeReady ? "positive" : "caution";
    pushLog(
      nextTone,
      nextMode === "manual"
        ? "执行方式切换到手动交易 · 只生成下单票，不触达交易通道。"
        : nextMode === "simulation"
          ? "执行方式切换到自动模拟 · 只写入虚拟账户和收益账本。"
          : `执行方式切换到通道自动 · ${broker.label}`,
    );
  };

  const handleBrokerChange = (nextMode: BrokerMode) => {
    if (!recommendationReadiness.autoExecutionAllowed) {
      setExecutionMode("simulation");
      pushLog("caution", `${recommendationReadiness.validationLabel} · 当前 Profile 只能使用手动确认或自动模拟。`);
      return;
    }
    const nextBroker = BROKER_OPTIONS.find((item) => item.key === nextMode) ?? BROKER_OPTIONS[0];
    setExecutionMode("auto");
    setBrokerMode(nextMode);
    pushLog(nextMode === "local-paper" ? "positive" : "caution", `通道自动切换到 ${nextBroker.label} · ${nextBroker.detail}`);
  };

  const refreshBridgeStatus = async () => {
    setBridgeLoading(true);
    setBridgeError("");
    try {
      const statuses = await probeBrokerBridge();
      setBridgeStatuses(statuses);
      pushLog("positive", `桥接探测完成 · ${statuses.filter((item) => item.commandAvailable).length}/${statuses.length} ready`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "桥接探测失败";
      setBridgeError(message);
      pushLog("negative", message);
    } finally {
      setBridgeLoading(false);
    }
  };

  const handlePresetChange = (preset: QbotPreset) => {
    setQbotPresetKey(preset.key);
    setActiveStrategyKey(preset.mapsTo);
    pushLog("positive", `载入 Qbot 预设 · ${preset.strategy} · ${preset.platform}`);
  };

  const handleScalingPolicyChange = (key: ScalingPolicyKey) => {
    const policy = scalingPolicyDefinition(key);
    setStoredStrategyPolicyConfig(policy.defaultConfig);
    pushLog("neutral", `仓位方法切换为 ${policy.label} · ${policy.detail}`);
  };

  const updateStrategyPolicyConfig = (patch: Partial<StrategyPolicyConfig>) => {
    setStoredStrategyPolicyConfig((current) => normalizeStrategyPolicyConfig({ ...current, ...patch }));
  };

  const handleRunBacktest = async () => {
    if (!report || !reportIsCurrent) {
      onOpenAnalysis();
      return false;
    }
    const { runScenarioProjection } = await import("../lib/backtest-engine");
    const result = runScenarioProjection({
      budgetWeight,
      orderIntents: orders,
      positionPlan,
      preset: qbotPreset,
      report,
      score,
      strategy,
      tradeHabit,
    });
    setEngineMode("scenario");
    setLastRun(result);
    pushLog(result.tone, `情景试算完成 · ${result.presetLabel} · 投影 ${formatPercent(result.pnlPct)} · ${result.simulatedOrders.length} 单`);
    return true;
  };

  const revealExecutionSection = (sectionId: string) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const section = document.getElementById(sectionId);
        if (!section) return;

        const rail = section.closest<HTMLElement>(".quant-execution-rail");
        if (rail) {
          const railRect = rail.getBoundingClientRect();
          const sectionRect = section.getBoundingClientRect();
          const targetTop = rail.scrollTop + sectionRect.top - railRect.top - 10;
          rail.scrollTo({ behavior: "smooth", top: Math.max(0, targetTop) });
        } else {
          section.scrollIntoView({ behavior: "smooth", block: "start" });
        }

        section.classList.remove("is-revealed-section");
        void section.offsetWidth;
        section.classList.add("is-revealed-section");
        window.setTimeout(() => section.classList.remove("is-revealed-section"), 1200);
      });
    });
  };

  const handleRunBacktestAndOpen = () => {
    preloadQuantModule("dialogs");
    void handleRunBacktest().then((completed) => {
      if (completed) setActiveDialog("backtest");
    });
  };

  const handleToggleMonitor = () => {
    const next = !monitorEnabled;
    setMonitorEnabled(next);
    if (next) {
      const now = shortTimeLabel();
      setMonitorLastRun(now);
      setMonitorNextRun(nextRunLabel(PROFILE_MONITOR_INTERVAL_MS));
      onRefreshRef.current();
      pushLog("positive", `Profile 监测已开启 · ${monitorEvaluation?.summary ?? PROFILE_MONITOR_INTERVAL_LABEL}`);
    } else {
      setMonitorNextRun("");
      pushLog("neutral", "Profile 监测已停止。");
    }
  };

  const runPaperSimulationForIntents = async (
    intents: OrderIntent[],
    source: string,
    stateOverride = paperSim,
  ) => {
    if (!report || !reportIsCurrent) {
      onOpenAnalysis();
      return null;
    }
    if (!paperSimulationCurrencyReady) {
      pushLog("caution", `模拟账户暂不跨币种结算；请将基准币种切换为持仓币种，或使用手动交易票。`);
      return null;
    }
    paperSettlementKeyRef.current = `${stateOverride.accountId}:${report.asOf}`;
    const fundSymbols = new Set([
      ...stateOverride.pendingFundOrders.map((order) => symbolKey(order.symbol)),
      ...stateOverride.pendingFundOrders
        .map((order) => order.replacementLink?.targetSymbol ?? "")
        .filter(Boolean)
        .map(symbolKey),
      ...intents
        .map((intent) => symbolKey(intent.symbol))
        .filter((symbol) => holdings.some((holding) => symbolKey(holding.symbol) === symbol && holding.assetType === "fund")),
    ]);
    let simulationHoldings = holdings;
    const fundNavEvidence: Array<{ symbol: string; nav: number; asOf: string; source: string }> = [];
    if (fundSymbols.size) {
      const navResults = await Promise.all(Array.from(fundSymbols).map(async (symbol) => {
        try {
          const seed = await lookupFundProfileSeed(symbol);
          return { symbol, seed, error: "" };
        } catch (error) {
          return { symbol, seed: null, error: error instanceof Error ? error.message : "净值同步失败" };
        }
      }));
      const navBySymbol = new Map(navResults.filter((item) => item.seed).map((item) => [item.symbol, item.seed!]));
      simulationHoldings = holdings.map((holding) => {
        const seed = navBySymbol.get(symbolKey(holding.symbol));
        if (!seed || seed.nav == null || !seed.navDate) return holding;
        return {
          ...holding,
          confirmedNav: seed.nav,
          confirmedNavAsOf: seed.navDate,
          currentPrice: seed.estimateNav ?? seed.nav,
          fundPurchaseStatus: seed.purchaseStatus,
          fundPurchaseOpen: seed.purchaseOpen ?? undefined,
          fundPurchaseLimit: seed.purchaseLimit ?? undefined,
          fundRedemptionOpen: seed.redemptionOpen ?? undefined,
          fundTradeStatusAsOf: seed.fetchedAt,
          fundHoldingsAsOf: seed.holdingsAsOf ?? holding.fundHoldingsAsOf,
          fundTopHoldings: seed.topHoldings.length ? seed.topHoldings : holding.fundTopHoldings,
          fundNavHistory: seed.navHistory.length ? seed.navHistory : holding.fundNavHistory,
          fundRedemptionFeeSchedule: seed.redemptionFeeSchedule.length ? seed.redemptionFeeSchedule : holding.fundRedemptionFeeSchedule,
          quoteSource: "eastmoney_tiantian" as const,
        };
      });
      if (navBySymbol.size) onHoldingsChange(simulationHoldings);
      const syncErrors = navResults.filter((item) => item.error);
      if (syncErrors.length) pushLog("caution", `基金净值同步失败 ${syncErrors.length} 项；未取得精确日期的委托不会成交。`);
    }
    const simulationRealHoldings = simulationHoldings.filter((holding) => holding.role === "real");
    const guarded = intents.map((intent) => {
      const guard = guardIntent(intent, undefined, simulationRealHoldings);
      return {
        guard,
        intent: guard?.intent ?? intent,
      };
    });
    const riskResults = guarded.map((item) => item.guard).filter((item): item is RiskGuardResult => Boolean(item));
    const executableIntents = guarded
      .filter((item) => !item.guard?.blocked)
      .map((item) => item.intent);
    const pendingNavTargets = Array.from(new Map(
      stateOverride.pendingFundOrders
        .filter((order) => !order.confirmedNav && order.navDate <= report.asOf)
        .map((order) => [`${order.symbol}:${order.navDate}`, { symbol: order.symbol, navDate: order.navDate }]),
    ).values());
    if (pendingNavTargets.length) {
      const exactResults = await Promise.all(pendingNavTargets.map(async (target) => {
        try {
          const result = await lookupFundNav(target.symbol, target.navDate);
          return { target, result, error: "" };
        } catch (error) {
          return { target, result: null, error: error instanceof Error ? error.message : "历史净值查询失败" };
        }
      }));
      exactResults.forEach(({ result, target }) => {
        if (!result?.exact || result.navDate !== target.navDate) return;
        fundNavEvidence.push({
          symbol: target.symbol,
          nav: result.nav,
          asOf: result.navDate,
          source: result.sourceName,
        });
      });
      const exactErrors = exactResults.filter((item) => item.error);
      if (exactErrors.length) pushLog("caution", `精确净值缺失 ${exactErrors.length} 项；相关基金委托继续待确认。`);
    }
    const { runPaperSimulationDay } = await import("../lib/paper-sim-runtime");
    const result = runPaperSimulationDay({
      fundExecutionPolicy,
      fundNavEvidence,
      holdings: simulationHoldings,
      orderIntents: executableIntents,
      positionPlan,
      preset: qbotPreset,
      report,
      source,
      state: stateOverride,
      strategy,
    });
    setPaperSim(result.state);
    setEngineMode("paper");
    if (result.marketClosed) {
      pushLog("neutral", result.skipReasons[0] || `${report.asOf} 非交易日，未执行模拟委托。`);
      return result;
    }
    if (result.alreadyRan) {
      pushLog("neutral", `${report.asOf} 已经入账；自动模拟按交易日只记录一次。`);
      return result;
    }
    recordRecommendations(executableIntents, "simulation");
    const riskText = riskResults.length ? ` · 风控 ${summarizeRiskGuardResults(riskResults)}` : "";
    const skippedText = result.skipped
      ? `，跳过 ${result.skipped}${result.skipReasons[0] ? `（${result.skipReasons[0]}）` : ""}`
      : "";
    pushLog(
      result.summary.tone,
      `自动模拟入账 · ${result.trades.length} 笔成交 · ${result.summary.pendingFundOrderCount} 笔基金待确认${skippedText}${riskText} · ${formatPercent(result.summary.pnlPct)}`,
    );
    return result;
  };

  const handleStartPaperSimulation = () => {
    if (!report || !reportIsCurrent) {
      onOpenAnalysis();
      return;
    }
    if (!paperSimulationCurrencyReady) {
      setExecutionRailTab("simulation");
      pushLog("caution", "模拟账户暂不跨币种结算，未创建可能失真的实验账户。");
      return;
    }
    const started = activatePaperSimState(paperSim, { holdings, positionPlan, preset: qbotPreset, report, strategy });
    setExecutionMode("simulation");
    setExecutionRailTab("simulation");
    if (!monitorEnabled) {
      setMonitorEnabled(true);
      setMonitorLastRun(shortTimeLabel());
      setMonitorNextRun(nextRunLabel(PROFILE_MONITOR_INTERVAL_MS));
      onRefreshRef.current();
    }
    pushLog("positive", "自动模拟交易已启动 · 每次 Profile 刷新后按交易日入账。");
    runPaperSimulationForIntents(orders, "自动模拟启动", started);
  };

  const handleRunPaperSimulation = () => {
    setExecutionRailTab("simulation");
    runPaperSimulationForIntents(orders, "手动运行");
  };

  const handleStartReplacementSimulation = () => {
    if (!report || !reportIsCurrent || !primaryReplacementPlan) return;
    if (!primaryReplacementPlan.executable || primaryReplacementPlan.action !== "replace") {
      pushLog("caution", `${primaryReplacementPlan.label} · ${primaryReplacementPlan.summary}`);
      return;
    }
    if (paperSim.lastRunDate === report.asOf) {
      pushLog("caution", `${report.asOf} 模拟账户已结算；请在下一交易日刷新后启动关联替换。`);
      return;
    }
    const sourceHolding = realHoldings.find((holding) => symbolKey(holding.symbol) === symbolKey(primaryReplacementPlan.sourceSymbol));
    const targetHolding = realHoldings.find((holding) => symbolKey(holding.symbol) === symbolKey(primaryReplacementPlan.targetSymbol));
    if (!sourceHolding || !targetHolding) return;
    const sellFeeRatePct = primaryReplacementPlan.estimatedRedemptionFee != null && primaryReplacementPlan.sellAmount > 0
      ? primaryReplacementPlan.estimatedRedemptionFee / primaryReplacementPlan.sellAmount * 100
      : 0;
    const batchAmount = targetHolding.fundPurchaseLimit && targetHolding.fundPurchaseLimit > 0
      ? Math.min(primaryReplacementPlan.buyAmount, targetHolding.fundPurchaseLimit)
      : primaryReplacementPlan.buyAmount;
    const replacementId = `${report.asOf}-${sourceHolding.symbol}-${targetHolding.symbol}`;
    const intent: OrderIntent = {
      key: `replacement-${replacementId}-sell`,
      symbol: sourceHolding.symbol,
      name: sourceHolding.name,
      side: "SELL",
      state: "关联替换赎回",
      tone: "caution",
      amount: primaryReplacementPlan.sellAmount.toFixed(2),
      weight: `${formatNumber(primaryReplacementPlan.sellAmount / totalValue * 100, 1)}%`,
      detail: `先赎回 ${sourceHolding.symbol}，确认到账后再分批申购 ${targetHolding.symbol}。`,
      replacementLink: {
        id: replacementId,
        stage: "redeem",
        sourceSymbol: sourceHolding.symbol,
        targetSymbol: targetHolding.symbol,
        targetName: targetHolding.name,
        remainingBuyAmount: primaryReplacementPlan.buyAmount,
        batchAmount,
        sellFeeRatePct,
      },
    };
    const started = paperSim.active
      ? paperSim
      : activatePaperSimState(paperSim, { holdings, positionPlan, preset: qbotPreset, report, strategy });
    setExecutionMode("simulation");
    setExecutionRailTab("simulation");
    setActiveDialog(null);
    void runPaperSimulationForIntents([intent], "关联基金替换", started);
  };

  const handlePausePaperSimulation = () => {
    const paused = pausePaperSimState(paperSim);
    setPaperSim(paused);
    pushLog("neutral", "自动模拟交易已暂停，历史净值和成交记录已保留。");
  };

  const orderSourceFor = (kind: OrderSourceKind) => {
    const label = kind === "profile-monitor" ? "Profile 监测" : kind === "manual" ? "手动下单" : "策略建议";
    return {
      kind,
      label,
      presetKey: qbotPreset.key,
      presetLabel: qbotPreset.label,
      profileKey: report?.profileKey,
      profileName: report?.profileName,
      strategyKey: strategy.key,
      strategyName: strategy.label,
    };
  };

  const accountIdForIntent = (intent: OrderIntent) => {
    const matching = Array.from(new Set(
      realHoldings
        .filter((holding) => symbolKey(holding.symbol) === symbolKey(intent.symbol))
        .map((holding) => holding.accountId)
        .filter((accountId): accountId is string => Boolean(accountId)),
    ));
    return matching.length === 1 ? matching[0] : executionAccountId;
  };

  const mergeIntoOrderCenter = (incoming: OrderRecord[]) => {
    const result = mergeOrderRecords(orderRows, incoming);
    setQueuedOrders(result.orders);
    return result;
  };

  const guardIntent = (
    intent: OrderIntent,
    quote: MarketQuoteSnapshot | null = marketQuotes[symbolKey(intent.symbol)] ?? null,
    holdingRows: HoldingRecord[] = realHoldings,
  ): RiskGuardResult | null => {
    if (!report || !reportIsCurrent) return null;
    return guardOrderIntent({
      holdings: holdingRows,
      orderIntent: intent,
      policy: riskPolicy,
      positionPlan,
      preset: qbotPreset,
      quote,
      queuedOrders: orderRows,
      report,
      riskOverride,
      score,
      totalValue,
    });
  };

  const quoteForExecution = async (intent: OrderIntent, options: { force?: boolean; silent?: boolean } = {}) => {
    if (executionMode === "manual") {
      return marketQuotes[symbolKey(intent.symbol)] ?? null;
    }
    return syncQuoteForIntent(intent, options);
  };

  const syncQuoteForIntent = async (intent: OrderIntent, options: { force?: boolean; silent?: boolean } = {}) => {
    if (!report || !reportIsCurrent) return null;
    const key = symbolKey(intent.symbol);
    const cached = marketQuotes[key];
    const quoteMaxAgeMs = (report.executionPolicy?.quoteWarnAgeSeconds ?? 30) * 1000;
    if (!options.force && quoteIsFresh(cached, quoteMaxAgeMs)) return cached;
    const holding = holdings.find((item) => symbolKey(item.symbol) === key);
    const watch = watchRows.find((item) => symbolKey(item.symbol) === key);
    const referencePrice = referencePriceForIntent(intent, holding, watch, report);
    setMarketQuoteSyncing(key);
    try {
      const quote = await syncMarketQuoteThroughAdapter({
        allowLive: true,
        assetType: holding?.assetType,
        market: holding?.market || report.profileMarket || "",
        mode: brokerMode,
        name: intent.name || holding?.name || watch?.label || intent.symbol,
        preset: qbotPreset,
        referencePrice,
        riskOverride,
        symbol: intent.symbol,
      });
      setMarketQuotes((current) => ({ ...current, [key]: quote }));
      if (!options.silent) {
        pushLog(quote.accepted ? "positive" : "caution", `${quote.symbol} 行情${quote.accepted ? "已回填" : "未就绪"} · ${quote.message}`);
      }
      return quote;
    } catch (error) {
      const message = error instanceof Error ? error.message : "行情同步失败";
      if (!options.silent) pushLog("negative", `${intent.symbol} · ${message}`);
      return null;
    } finally {
      setMarketQuoteSyncing((current) => current === key ? "" : current);
    }
  };

  const routePlanOrder = async (
    order: OrderIntent,
    index: number,
    sourceKind: OrderSourceKind = "strategy",
    guardOverride?: RiskGuardResult | null,
  ) => {
    const guard = guardOverride === undefined ? guardIntent(order) : guardOverride;
    const guardedIntent = guard?.intent ?? order;
    const previewOrder = {
      ...createOrderRecordFromIntent({
        brokerMode: orderBrokerMode,
        index,
        intent: guardedIntent,
        limit: guard?.limitHint,
        preset: qbotPreset,
        quantity: guard?.quantityHint,
        riskBlocked: guard?.blocked,
        riskBlockedReason: guard?.blocked ? guard.summary : "",
        riskOverride,
        riskWarnings: guard?.warnings,
        source: orderSourceFor(sourceKind),
      }),
      accountId: accountIdForIntent(guardedIntent),
    };
    if (previewOrder.status === "blocked") return previewOrder;
    if (executionMode === "manual") return prepareManualExecutionOrder(previewOrder);
    const routeResult = await routeOrder(previewOrder);
    return applyOrderRouteResult(previewOrder, routeResult);
  };

  const handleQueueGeneratedOrders = async () => {
    if (!report || !reportIsCurrent) {
      onOpenAnalysis();
      return;
    }
    if (executionMode === "simulation") {
      setExecutionRailTab("simulation");
      handleRunPaperSimulation();
      return;
    }
    if (executionMode === "auto" && !recommendationReadiness.autoExecutionAllowed) {
      pushLog("caution", `${recommendationReadiness.validationLabel} · 通道自动已阻断，请先使用模拟验证。`);
      return;
    }
    const eligibleOrders = orders.filter((order) => recommendationAllowed(order, recommendationReadiness));
    if (!eligibleOrders.length) {
      pushLog("caution", `${recommendationReadiness.label} · ${recommendationReadiness.detail}`);
      return;
    }
    const routedResults = await Promise.all(eligibleOrders.map(async (order, index) => {
      const quote = await quoteForExecution(order, { silent: true });
      const guard = guardIntent(order, quote);
      const routedOrder = await routePlanOrder(order, index, "strategy", guard);
      return { guard, routedOrder };
    }));
    recordRecommendations(orders, "ledger-batch");
    const riskResults = routedResults.map((item) => item.guard).filter((item): item is RiskGuardResult => Boolean(item));
    const executableOrders = routedResults.map((item) => item.routedOrder);
    if (!executableOrders.length) {
      setEngineMode("paper");
      pushLog("neutral", "当前目标带没有生成可建票委托，先观察信号和仓位差。");
      return;
    }
    setEngineMode("paper");
    const merged = mergeIntoOrderCenter(executableOrders);
    setExecutionRailTab("orders");
    const accepted = executableOrders.filter((item) => item.status !== "blocked" && item.status !== "error").length;
    const acceptedRoutes = merged.accepted ? Math.min(accepted, merged.accepted) : 0;
    const duplicateText = merged.duplicates ? `，过滤 ${merged.duplicates} 条重复` : "";
    pushLog(
      accepted && merged.accepted ? "positive" : merged.duplicates ? "neutral" : "negative",
      executionMode === "manual"
        ? `手动下单票 ${merged.accepted}/${executableOrders.length} 条 · 风控 ${summarizeRiskGuardResults(riskResults)}${duplicateText}`
        : `订单中心接收 ${merged.accepted}/${executableOrders.length} 条 · 风控 ${summarizeRiskGuardResults(riskResults)} · 路由通过 ${acceptedRoutes} 条${duplicateText}`,
    );
  };

  const handleRecommendationAction = (order: OrderIntent, guard?: RiskGuardResult) => {
    setSelectedSymbol(order.symbol);
    setExecutionRailTab("ticket");
    if (guard?.blocked) {
      pushLog("caution", `${order.symbol} 暂不执行 · ${guard.summary}`);
      revealExecutionSection("quant-execution-ticket");
      return;
    }
    revealExecutionSection("quant-execution-ticket");
  };

  const handleQueueActiveOrder = async () => {
    if (!activeWatch) {
      pushLog("neutral", "没有选中的交易标的，先从标的池选择一个资产。");
      return;
    }
    if (!activeWatch.tradable) {
      pushLog("caution", `${activeWatch.symbol} 是${activeWatch.sourceLabel}，${activeWatch.tradeBlockReason}。`);
      return;
    }
    if (!activeRecommendation) {
      pushLog("caution", `${activeWatch.symbol} 当前没有组合建议，未生成方向不明的交易票。`);
      return;
    }
    if (executionMode !== "simulation" && !recommendationAllowed(activeRecommendation, recommendationReadiness)) {
      pushLog("caution", `${recommendationReadiness.label} · ${recommendationReadiness.detail}`);
      return;
    }
    if (executionMode === "auto" && !recommendationReadiness.autoExecutionAllowed) {
      pushLog("caution", `${recommendationReadiness.validationLabel} · 通道自动已阻断，请先使用模拟验证。`);
      return;
    }
    const draft = createTradeTicketFromRecommendation({
      brokerMode: orderBrokerMode,
      preset: qbotPreset,
      recommendation: activeRecommendation,
      watch: activeWatch,
    });
    if (executionMode === "simulation") {
      setExecutionRailTab("simulation");
      runPaperSimulationForIntents([draft], "手动模拟票");
      return;
    }
    const quote = await quoteForExecution(draft, { silent: true });
    const guard = guardIntent(draft, quote);
    const previewOrder = {
      ...createOrderRecordFromIntent({
        brokerMode: orderBrokerMode,
        index: 0,
        intent: guard?.intent ?? draft,
        limit: guard?.limitHint ?? draft.limit,
        preset: qbotPreset,
        quantity: guard?.quantityHint ?? draft.quantity,
        riskBlocked: guard?.blocked,
        riskBlockedReason: guard?.blocked ? guard.summary : "",
        riskOverride,
        riskWarnings: guard?.warnings,
        source: orderSourceFor("manual"),
      }),
      accountId: accountIdForIntent(guard?.intent ?? draft),
    };
    const order = previewOrder.status === "blocked"
      ? previewOrder
      : executionMode === "manual"
        ? prepareManualExecutionOrder(previewOrder)
      : applyOrderRouteResult(previewOrder, await routeOrder(previewOrder));
    recordRecommendations([draft], "ticket");
    setEngineMode("paper");
    mergeIntoOrderCenter([order]);
    setExecutionRailTab(order.status === "blocked" || order.status === "error" ? "ticket" : "orders");
    pushLog(order.tone, `${order.state} · ${order.side} ${order.symbol} · ${guard?.summary ?? order.amount} · ${order.route}`);
  };

  const handleRegisterActiveWatch = () => {
    if (!activeWatch || !report) return;
    if (activeWatchRegistered) {
      onOpenHoldings();
      pushLog("neutral", `${activeWatch.symbol} 已在资产管理中，去持仓页调整角色和目标带。`);
      return;
    }
    const nextHolding = createWatchHoldingFromWatch(activeWatch, report);
    onHoldingsChange((current) => {
      if (current.some((item) => symbolKey(item.symbol) === symbolKey(nextHolding.symbol))) {
        return current;
      }
      return [nextHolding, ...current];
    });
    setWatchFilter("signals");
    setSelectedSymbol(nextHolding.symbol);
    pushLog("positive", `${nextHolding.symbol} 已加入观察资产；转为本地持仓后才会进入委托队列。`);
  };

  const routeOrder = async (order: OrderRecord) => {
    try {
      return await prepareOrderThroughAdapter({
        mode: brokerMode,
        order,
        preset: qbotPreset,
        riskOverride,
      });
    } catch (error) {
      return routeOrderErrorResult(activeBridgeKind, error);
    }
  };

  const replaceOrderInCenter = (nextOrder: OrderRecord) => {
    setQueuedOrders((current) => {
      const normalized = normalizeOrderRecords(current);
      let replaced = false;
      const nextOrders = normalized.map((item) => {
        if (item.id !== nextOrder.id) return item;
        replaced = true;
        return nextOrder;
      });
      return replaced ? nextOrders : normalizeOrderRecords([nextOrder, ...normalized]);
    });
  };

  const handleOrderCommand = async (order: OrderRecord, action: OrderCommandAction) => {
    const normalized = normalizeOrderRecords([order])[0];
    if (isManualExecutionOrder(normalized)) {
      pushLog("caution", "手动交易票不会调用通道命令；请在外部平台执行后用人工状态按钮推进。");
      return;
    }
    if (
      action === "submitOrder"
      && brokerMode !== "local-paper"
      && riskPolicy.requireLiveConfirmation
      && !riskOverride
    ) {
      pushLog("negative", "实盘提交需要先在风控里开启手动放行，作为二次确认。");
      return;
    }
    if (action === "submitOrder" && brokerMode !== "local-paper" && (!report || !reportIsCurrent)) {
      pushLog("negative", "提交前需要先刷新组合决策，确保 Profile 和风控条件是最新的。");
      return;
    }
    const commandKey = `${normalized.id}:${action}`;
    setActiveOrderCommandKey(commandKey);
    let activeCommandOrder = normalized;
    try {
      let commandOrder = normalized;
      if (action === "submitOrder") {
        const quote = await syncQuoteForIntent(commandOrder, { force: true, silent: true });
        const submitGuard = guardIntent(commandOrder, quote);
        const checkedOrder = applyPreSubmitGuardResult(commandOrder, quote, submitGuard, {
          requireAcceptedQuote: brokerMode !== "local-paper",
        });
        replaceOrderInCenter(checkedOrder);
        if (checkedOrder.status === "blocked") {
          pushLog("negative", `${checkedOrder.symbol} 提交前阻断 · ${checkedOrder.lastError || submitGuard?.summary || "风控复核未通过"}`);
          return;
        }
        commandOrder = checkedOrder;
        activeCommandOrder = checkedOrder;
      }
      const input = {
        allowLive: action === "submitOrder" || action === "cancelOrder",
        mode: brokerMode,
        order: commandOrder,
        preset: qbotPreset,
        riskOverride,
      };
      const result = action === "submitOrder"
        ? await submitOrderThroughAdapter(input)
        : action === "cancelOrder"
          ? await cancelOrderThroughAdapter(input)
          : await syncOrderStatusThroughAdapter(input);
      const updated = applyOrderCommandResult(commandOrder, result);
      replaceOrderInCenter(updated);
      pushLog(updated.tone, `${result.eventLabel || orderStatusLabel(updated.status)} · ${updated.symbol} · ${result.message}`);
    } catch (error) {
      const result = orderCommandErrorResult(activeBridgeKind, action, activeCommandOrder, error);
      const updated = applyOrderCommandResult(activeCommandOrder, result);
      replaceOrderInCenter(updated);
      pushLog("negative", `${updated.symbol} · ${result.message}`);
    } finally {
      setActiveOrderCommandKey((current) => current === commandKey ? "" : current);
    }
  };

  const handleManualOrderStep = (order: OrderRecord) => {
    const updated = advanceManualExecutionOrder(order);
    replaceOrderInCenter(updated);
    pushLog(updated.tone, `${updated.state} · ${updated.symbol} · ${updated.amount}`);
  };

  const handleSyncAccount = async () => {
    setAccountSyncing(true);
    try {
      const snapshot = await syncAccountThroughAdapter({
        allowLive: true,
        mode: brokerMode,
        preset: qbotPreset,
        riskOverride,
      });
      const accountStoreId = accountIdForBrokerSnapshot(snapshot);
      onAccountStoreChange((current) => upsertBrokerAccountSnapshot(current, snapshot));
      setExecutionAccountId(accountStoreId);
      const reconciled = applyBrokerAccountSnapshotToOrders(orderRows, { ...snapshot, accountStoreId });
      if (reconciled.matched) {
        setQueuedOrders(reconciled.orders);
      }
      pushLog(
        snapshot.accepted ? "positive" : "negative",
        `${snapshot.accepted ? "账户同步完成" : "账户同步失败"} · ${snapshot.positions.length} 持仓 / ${snapshot.orders.length} 委托 / ${snapshot.trades.length} 成交${reconciled.matched ? ` · 回填 ${reconciled.matched} 条` : ""}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "账户同步失败";
      pushLog("negative", message);
    } finally {
      setAccountSyncing(false);
    }
  };

  const handleExportOrderAudit = async (format: OrderAuditExportFormat) => {
    if (!orderRows.length) {
      pushLog("neutral", "没有可导出的委托记录。");
      return;
    }
    setOrderAuditExporting(format);
    try {
      const result = await exportOrderAudit(format);
      pushLog("positive", `${result.summary} · ${result.format.toUpperCase()} · ${result.path}`);
      revealExecutionSection("quant-execution-log");
    } catch (error) {
      const message = error instanceof Error ? error.message : "订单审计导出失败";
      pushLog("negative", message);
      revealExecutionSection("quant-execution-log");
    } finally {
      setOrderAuditExporting("");
    }
  };

  const handleClearBlockedOrders = () => {
    if (!blockedOrderCount) {
      pushLog("neutral", "没有需要清理的阻断委托。");
      return;
    }
    const confirmed = window.confirm(`清理 ${blockedOrderCount} 条已阻断委托？需要留档可先导出 JSON/CSV。`);
    if (!confirmed) return;
    setQueuedOrders((current) => normalizeOrderRecords(current).filter((order) => order.status !== "blocked"));
    pushLog("neutral", `已清理 ${blockedOrderCount} 条阻断委托。`);
  };

  const handleApplyReconcileRow = (row: PortfolioReconcileRow) => {
    if (row.status === "matched") return;
    const result = applyReconcileRowToHoldings({
      fallbackCurrency: positionPlan.currency,
      holdings,
      positions: accountBook.positions,
      row,
    });
    if (!result.changed) {
      pushLog("neutral", `${row.symbol} 暂无可应用差异。`);
      return;
    }
    onHoldingsChange(result.holdings);
    pushLog(result.tone, result.message);
  };

  const handleApplyReconcileDiffs = () => {
    const rows = actionableReconcileRows.filter((row) => row.status === "extra" || row.status === "drift");
    if (!rows.length) {
      pushLog("neutral", "当前没有可自动应用的账户差异。");
      return;
    }
    let nextHoldings = holdings;
    const messages: string[] = [];
    rows.forEach((row) => {
      const result = applyReconcileRowToHoldings({
        fallbackCurrency: positionPlan.currency,
        holdings: nextHoldings,
        positions: accountBook.positions,
        row,
      });
      nextHoldings = result.holdings;
      if (result.changed) messages.push(row.symbol);
    });
    if (!messages.length) {
      pushLog("neutral", "账户差异已与本地持仓一致。");
      return;
    }
    onHoldingsChange(nextHoldings);
    pushLog("positive", `已应用 ${messages.length} 条账户差异：${messages.slice(0, 4).join("、")}${messages.length > 4 ? "…" : ""}`);
  };

  const updateRiskPolicyNumber = (
    key: "cooldownMinutes" | "maxDailyOrders",
    value: number,
  ) => {
    setRiskPolicy((current) => normalizeRiskGuardPolicy({
      ...current,
      [key]: value,
      updatedAt: new Date().toISOString(),
    }));
  };

  const updateRiskPolicyCap = (
    key: keyof typeof riskPolicy.singleOrderCaps,
    value: number,
  ) => {
    setRiskPolicy((current) => normalizeRiskGuardPolicy({
      ...current,
      singleOrderCaps: {
        ...current.singleOrderCaps,
        [key]: value,
      },
      updatedAt: new Date().toISOString(),
    }));
  };

  const updateRiskPolicyLoss = (
    key: keyof typeof riskPolicy.lossBrake,
    value: number,
  ) => {
    setRiskPolicy((current) => normalizeRiskGuardPolicy({
      ...current,
      lossBrake: {
        ...current.lossBrake,
        [key]: value,
      },
      updatedAt: new Date().toISOString(),
    }));
  };

  const handleRiskOverrideToggle = () => {
    const next = !riskOverride;
    setRiskOverride(next);
    pushLog("caution", `手动放行${next ? "开启" : "关闭"} · 手动路由会覆盖策略阻断`);
  };

  const handleRequireLiveConfirmationToggle = () => {
    setRiskPolicy((current) => normalizeRiskGuardPolicy({
      ...current,
      requireLiveConfirmation: !current.requireLiveConfirmation,
      updatedAt: new Date().toISOString(),
    }));
  };

  useEffect(() => {
    if (executionMode !== "simulation" || !paperSim.active || !report || !reportIsCurrent) return;
    if (!report.asOf || paperSim.lastRunDate === report.asOf) return;
    const settlementKey = `${paperSim.accountId}:${report.asOf}`;
    if (paperSettlementKeyRef.current === settlementKey) return;
    paperSettlementKeyRef.current = settlementKey;
    const settlementIntents = monitorEnabled
      && monitorEvaluation?.changed
      && monitorSnapshot?.profileKey === monitorEvaluation.snapshot.profileKey
      ? monitorEvaluation.autoQueueIntents
      : [];
    void runPaperSimulationForIntents(settlementIntents, settlementIntents.length ? "每日结算 · Profile 变化" : "每日自动结算");
  }, [executionMode, monitorEnabled, monitorEvaluation, monitorSnapshot?.profileKey, paperSim.accountId, paperSim.active, paperSim.lastRunDate, report, reportIsCurrent, runPaperSimulationForIntents]);

  useEffect(() => {
    if (!monitorEnabled || !monitorEvaluation || !report || !reportIsCurrent) return;
    const monitorRunKey = `${monitorEvaluation.snapshot.key}:${monitorEvaluation.snapshot.asOf}`;
    if (monitorRoutingKeyRef.current === monitorRunKey) return;
    const previousSnapshot = monitorSnapshot;
    monitorRoutingKeyRef.current = monitorRunKey;

    if (!previousSnapshot || previousSnapshot.profileKey !== monitorEvaluation.snapshot.profileKey) {
      commitMonitorEvaluation({ evaluation: monitorEvaluation, previousSnapshot });
      pushLog("neutral", monitorEvaluation.summary);
      return;
    }

    if (!monitorEvaluation.changed) {
      commitMonitorEvaluation({ evaluation: monitorEvaluation, previousSnapshot });
      if (monitorEvaluation.refreshed) {
        pushLog("neutral", monitorEvaluation.summary);
      }
      return;
    }

    if (!monitorEvaluation.autoQueueIntents.length) {
      commitMonitorEvaluation({ evaluation: monitorEvaluation, previousSnapshot });
      pushLog(monitorEvaluation.tone, monitorEvaluation.summary);
      return;
    }

    if (executionMode === "simulation") {
      commitMonitorEvaluation({ evaluation: monitorEvaluation, previousSnapshot });
      return;
    }

    void Promise.all(
      monitorEvaluation.autoQueueIntents.map((intent) => {
        const index = Math.max(0, orders.findIndex((item) => item.key === intent.key));
        return routePlanOrder(intent, index, "profile-monitor");
      }),
    ).then((routedOrders) => {
      setEngineMode("paper");
      const merged = mergeOrderRecords(orderRows, routedOrders);
      setQueuedOrders(merged.orders);
      commitMonitorEvaluation({ evaluation: monitorEvaluation, previousSnapshot, queuedOrders: routedOrders });
      const duplicateText = merged.duplicates ? `，过滤 ${merged.duplicates} 条重复` : "";
      pushLog("positive", `Profile 触发 ${merged.accepted}/${routedOrders.length} 条委托 · ${broker.label}${duplicateText}`);
    }).catch((error) => {
      commitMonitorEvaluation({ evaluation: monitorEvaluation, previousSnapshot });
      const message = error instanceof Error ? error.message : "Profile 监测路由失败";
      pushLog("negative", message);
    });
  }, [broker.label, commitMonitorEvaluation, executionMode, monitorEnabled, monitorEvaluation, monitorSnapshot, orderRows, orders, report, reportIsCurrent, routePlanOrder, runPaperSimulationForIntents, setQueuedOrders]);

  const tradingHeader = (
    <header className="quant-trading-header quant-command-bar" aria-label="量化交易快捷操作">
      <div className="quant-trading-title">
        <strong>量化交易 · 决策账本</strong>
        <span>基于组合目标与风控规则，生成可建票建议</span>
      </div>
      <div className={`quant-environment-capsule is-${normalizePlanTone(recommendationReadiness.tone)}`} aria-label="交易环境">
        <span>{quantDeskSummary.environmentLabel}</span>
        <span>{quantDeskSummary.strategyLabel}</span>
        <span>{quantDeskSummary.dataLabel}</span>
        <strong>{quantDeskSummary.riskLabel}</strong>
      </div>
      <div className="quant-run-controls" aria-label="策略运行控制">
        <button
          type="button"
          className={monitorEnabled ? "is-active" : undefined}
          aria-pressed={monitorEnabled}
          title={monitorEnabled && monitorLastRun ? `${monitorEvaluation?.summary ?? "Profile 监测运行中"} · 上次 ${monitorLastRun}` : "开启 Profile 监测"}
          onClick={handleToggleMonitor}
        >
          <CandlestickChartRoundedIcon fontSize="inherit" />
          {monitorEnabled ? "监测中" : "监测组合"}
        </button>
        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={controlPanelOpen}
          onClick={() => setControlPanelOpen(true)}
        >
          <TuneRoundedIcon fontSize="inherit" />
          交易参数
        </button>
        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={activeDialog === "bridge"}
          onFocus={handleQuantDialogIntent}
          onPointerEnter={handleQuantDialogIntent}
          onClick={() => openQuantDialog("bridge")}
        >
          <SpeedRoundedIcon fontSize="inherit" />
          通道
        </button>
      </div>
    </header>
  );

  const awaitingInput = !report || !reportIsCurrent;

  return (
    <section className={`quant-lab-page is-terminal-skin ${awaitingInput ? "is-awaiting-input" : ""}`} aria-label="量化交易台">
      {!report || !reportIsCurrent ? (
        <main className="quant-market-stage quant-execution-stage is-empty-state-stage" aria-label="交易执行">
          {tradingHeader}
          <section className={`quant-empty-state ${loading ? "is-loading" : ""}`} role={loading ? "status" : undefined} aria-live="polite">
            <AutoGraphRoundedIcon fontSize="inherit" />
            <div>
              <strong>{loading ? "正在准备交易输入" : "交易台等待 Profile 输入"}</strong>
              <span>{loading ? "正在同步 Profile、行情与风控结果。" : "先生成组合 Profile，再查看历史状态验证、情景试算和委托路由。"}</span>
            </div>
            {loading ? (
              <span className="quant-loading-pulse" aria-hidden="true"><i /><i /><i /></span>
            ) : (
              <button type="button" onClick={onOpenAnalysis}>组合决策</button>
            )}
          </section>
        </main>
      ) : (
        <div className="quant-trading-grid is-decision-ledger">
          <Dialog open={controlPanelOpen} onOpenChange={setControlPanelOpen}>
            <DialogContent className="quant-control-panel quant-control-sheet" mobileMode="sheet" showCloseButton size="sm">
              <DialogHeader className="quant-control-drawer-head">
                <DialogTitle className="sr-only">执行条件</DialogTitle>
                <DialogDescription className="sr-only">交易参数、执行方式、策略配置和标的池</DialogDescription>
                <PanelTitle icon={<TuneRoundedIcon fontSize="inherit" />} eyebrow="交易参数" title="执行条件" />
              </DialogHeader>

              <DialogBody className="quant-control-body">

                <section className="quant-execution-source-card" aria-label="执行来源">
                  <div>
                    <span>执行方式</span>
                    <strong>{executionLabel}</strong>
                    <em>{strategy.label} · {activeScalingPolicy.label} · {executionRouteLabel}</em>
                  </div>
                  <button type="button" onFocus={handleQuantDialogIntent} onPointerEnter={handleQuantDialogIntent} onClick={() => openQuantDialog("bridge")}>调整</button>
                </section>

                <div className="quant-execution-mode-switch" role="tablist" aria-label="执行方式" onKeyDown={handleTabListKeyDown}>
                  {EXECUTION_MODE_OPTIONS.map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      role="tab"
                      aria-selected={executionMode === item.key}
                      tabIndex={executionMode === item.key ? 0 : -1}
                      className={executionMode === item.key ? "is-active" : undefined}
                      disabled={item.key === "auto" && !recommendationReadiness.autoExecutionAllowed}
                      title={item.key === "auto" && !recommendationReadiness.autoExecutionAllowed ? `${recommendationReadiness.validationLabel}：先完成样本外验证` : item.detail}
                      onClick={() => handleExecutionModeChange(item.key)}
                    >
                      <strong>{item.label}</strong>
                      <span>{item.detail}</span>
                    </button>
                  ))}
                </div>

                <MonitorStatusCard
                  enabled={monitorEnabled}
                  evaluation={monitorEvaluation}
                  lastRun={monitorLastRun}
                  nextRun={monitorNextRun}
                />

                <div className="quant-config-actions" aria-label="策略配置">
                  <button type="button" onFocus={handleQuantDialogIntent} onPointerEnter={handleQuantDialogIntent} onClick={() => openQuantDialog("strategy")}>
                    <TuneRoundedIcon fontSize="inherit" />
                    <span>策略</span>
                  </button>
                  <button
                    type="button"
                    aria-haspopup="dialog"
                    aria-expanded={activeDialog === "risk"}
                    onFocus={handleQuantDialogIntent}
                    onPointerEnter={handleQuantDialogIntent}
                    onClick={() => openQuantDialog("risk")}
                  >
                    <ShieldRoundedIcon fontSize="inherit" />
                    <span>风控</span>
                  </button>
                  <button type="button" onFocus={handleQuantDialogIntent} onPointerEnter={handleQuantDialogIntent} onClick={() => openQuantDialog("bridge")}>
                    <SpeedRoundedIcon fontSize="inherit" />
                    <span>通道</span>
                  </button>
                  <button type="button" onClick={handleRunBacktest}>
                    <PlayArrowRoundedIcon fontSize="inherit" />
                    <span>试算</span>
                  </button>
                </div>

                <label className="quant-budget-control">
                  <span>单笔预算</span>
                  <strong>{formatNumber(budgetWeight, 1)}%</strong>
                  <input
                    type="range"
                    min="0.5"
                    max="8"
                    step="0.5"
                    value={budgetWeight}
                    onChange={(event) => setBudgetWeight(Number(event.target.value))}
                  />
                </label>

                <div className="quant-watchlist-card" aria-label="标的池">
                  <div className="quant-mini-head">
                    <span>标的池</span>
                    <strong>{filteredWatchRows.length}/{watchRows.length} 标的</strong>
                  </div>
                  <div className="quant-watch-filter" role="tablist" aria-label="标的范围" onKeyDown={handleTabListKeyDown}>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={watchFilter === "tradable"}
                      tabIndex={watchFilter === "tradable" ? 0 : -1}
                      className={watchFilter === "tradable" ? "is-active" : undefined}
                      onClick={() => setWatchFilter("tradable")}
                    >
                      <span>持仓</span>
                      <strong>{watchCounts.tradable}</strong>
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={watchFilter === "signals"}
                      tabIndex={watchFilter === "signals" ? 0 : -1}
                      className={watchFilter === "signals" ? "is-active" : undefined}
                      onClick={() => setWatchFilter("signals")}
                    >
                      <span>观察</span>
                      <strong>{watchCounts.signals}</strong>
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={watchFilter === "all"}
                      tabIndex={watchFilter === "all" ? 0 : -1}
                      className={watchFilter === "all" ? "is-active" : undefined}
                      onClick={() => setWatchFilter("all")}
                    >
                      <span>全部</span>
                      <strong>{watchCounts.all}</strong>
                    </button>
                  </div>
                  <div className="quant-watchlist-table">
                    {filteredWatchRows.length ? filteredWatchRows.map((row) => (
                      <button
                        key={row.symbol}
                        type="button"
                        className={`${activeWatch?.symbol === row.symbol ? "is-active" : ""} is-${row.tone} is-${row.source} ${row.tradable ? "is-tradable" : "is-not-tradable"}`}
                        onClick={() => setSelectedSymbol(row.symbol)}
                      >
                        <span>{row.symbol}</span>
                        <strong>{row.label}</strong>
                        <small>{row.sourceLabel}</small>
                        <em>{formatPercent(row.change1d)}</em>
                      </button>
                    )) : (
                      <div className="quant-watchlist-empty">
                        <strong>没有可交易持仓</strong>
                        <span>先在持仓管理里记录本地仓位和目标带。</span>
                      </div>
                    )}
                  </div>
                </div>
              </DialogBody>
            </DialogContent>
          </Dialog>

          <main className="quant-market-stage quant-execution-stage" aria-label="交易执行">
            {tradingHeader}
            <section className="quant-action-desk">
              <div className="quant-ledger-summary" aria-label="组合摘要">
                <article>
                  <span>组合市值</span>
                  <strong>{formatMoney(totalValue, positionPlan.currency)}</strong>
                  <small>本地持仓</small>
                </article>
                <article className={!positionPlan.hasCashInstrument ? "is-caution" : undefined}>
                  <span>现金健康</span>
                  <strong>{positionPlan.hasCashInstrument ? `${formatNumber(positionPlan.cashWeight, 1)}%` : "未记录"}</strong>
                  <small>目标 {formatNumber(positionPlan.decision.cashDecision.targetMinWeight, 0)}%–{formatNumber(positionPlan.decision.cashDecision.targetMaxWeight, 0)}%</small>
                </article>
                <article className={orders.length ? "is-negative" : "is-positive"}>
                  <span>待处理</span>
                  <strong>{orders.length}</strong>
                  <small>{orders.length ? "待复核" : "无需动作"}</small>
                </article>
                <article className={`is-${normalizePlanTone(recommendationReadiness.tone)}`}>
                  <span>建票状态</span>
                  <strong>{recommendationReadiness.label}</strong>
                  <small>{recommendationReadiness.dataQuality.label} · {recommendationReadiness.confidenceLabel} {recommendationReadiness.confidenceScore}/100</small>
                </article>
              </div>

              <div className="quant-suggestion-head">
                <div>
                  <strong>组合建议账本</strong>
                  <span>按优先级生成可建票建议</span>
                </div>
                <div className="quant-ledger-toolbar">
                  <button type="button" onFocus={handleQuantDialogIntent} onPointerEnter={handleQuantDialogIntent} onClick={() => openQuantDialog("risk")}>
                    <ShieldRoundedIcon fontSize="inherit" />
                    规则
                  </button>
                  <button
                    type="button"
                    aria-haspopup="dialog"
                    aria-expanded={controlPanelOpen}
                    onClick={() => setControlPanelOpen(true)}
                  >
                    <TuneRoundedIcon fontSize="inherit" />
                    筛选
                  </button>
                  <button type="button" onClick={() => void onRefresh()}>
                    <SpeedRoundedIcon fontSize="inherit" />
                    刷新
                  </button>
                  <button
                    type="button"
                    disabled={(executionMode === "auto" && !recommendationReadiness.autoExecutionAllowed) || (executionMode !== "simulation" && !orderRiskResults.some((guard) => !guard.blocked && recommendationAllowed(guard.intent, recommendationReadiness)))}
                    title={recommendationReadiness.detail}
                    onClick={handleQueueGeneratedOrders}
                  >
                    <ReceiptLongRoundedIcon fontSize="inherit" />
                    全部生成
                  </button>
                </div>
              </div>

              <section className="quant-decision-coverage" aria-label="建议覆盖说明">
                <div className="quant-coverage-stats">
                  <span>已分析 <strong>{decisionCoverage.analyzed}</strong></span>
                  <span className="is-positive">可建票 <strong>{decisionCoverage.executable}</strong></span>
                  <span>继续持有 <strong>{decisionCoverage.hold}</strong></span>
                  <span className={decisionCoverage.waiting ? "is-caution" : undefined}>等待/阻断 <strong>{decisionCoverage.waiting}</strong></span>
                </div>
                <p className="quant-coverage-primary">
                  {decisionCoverage.executable === 1
                    ? `1 条可建票，其余 ${Math.max(0, decisionCoverage.analyzed - 1)} 条等待条件。`
                    : decisionCoverage.executable > 1
                      ? `${decisionCoverage.executable} 条可建票，已按优先级排序。`
                      : "暂无可建票建议，保持观察。"}
                </p>
                {primaryReplacementPlan ? (
                  <p className="quant-overlap-note is-actionable">
                    <strong>{primaryReplacementPlan.label}：</strong>{primaryReplacementPlan.summary}
                    <button type="button" onFocus={handleQuantDialogIntent} onPointerEnter={handleQuantDialogIntent} onClick={() => openQuantDialog("replacement")}>查看计划</button>
                  </p>
                ) : null}
                <ProgressiveDisclosure
                  label="依据与未生成原因"
                  badge={`${decisionCoverage.skipped.length + (portfolioOverlap.pairs.length || portfolioOverlap.clusters.length ? 1 : 0) + (fundSubstitution.primary ? 1 : 0)} 项`}
                >
                  <div className="quant-evidence-summary">
                    <span>
                      <strong>数据</strong>
                      <em>{report?.source === "sample" ? "演示数据 · 禁止实盘" : `${report?.sourceLabel ?? "—"} · ${recommendationReadiness.dataQuality.label}`}</em>
                    </span>
                    {portfolioOverlap.pairs.length || portfolioOverlap.clusters.length ? (
                      <span>
                        <strong>{portfolioOverlap.pairs.length ? "持仓穿透" : "规则型重叠"}</strong>
                        <em>{portfolioOverlap.summary}</em>
                      </span>
                    ) : null}
                    {fundSubstitution.primary ? (
                      <span>
                        <strong>{fundSubstitution.primary.label}</strong>
                        <em>{fundSubstitution.primary.summary}</em>
                      </span>
                    ) : null}
                  </div>
                  {decisionCoverage.skipped.length ? (
                    <div className="quant-coverage-reasons">
                      {decisionCoverage.skipped.map((item) => (
                        <span key={item.key}>
                          <strong>{item.symbol}</strong>
                          <em>{item.action}</em>
                          <small>{item.reason}</small>
                        </span>
                      ))}
                    </div>
                  ) : null}
                </ProgressiveDisclosure>
              </section>

              <div className="quant-ledger-columns" aria-hidden="true">
                <span>标的</span>
                <span>仓位</span>
                <span>目标带</span>
                <span>建议</span>
                <span>金额</span>
                <span>优先级 / 证据</span>
                <span>操作</span>
              </div>
              <div className="quant-suggestion-list">
                {rankedRecommendations.length || decisionCoverage.skipped.length ? (
                  <>
                {rankedRecommendations.map((ranking) => {
                  const order = ranking.order;
                  const orderGuard = orderRiskResults.find((item) => item.intent.key === order.key);
                  return (
                  <article
                    key={order.key}
                    className={`is-${order.tone} is-priority-${ranking.priority.toLowerCase()} ${activeRecommendation?.key === order.key ? "is-selected" : ""}`}
                  >
                    <button
                      type="button"
                      className="quant-suggestion-select"
                      aria-label={`选择 ${order.symbol} ${sideLabel(order.side)}建议`}
                      onClick={() => {
                        setSelectedSymbol(order.symbol);
                        setExecutionRailTab("ticket");
                      }}
                    >
                      <span className="quant-ledger-asset">
                        <strong>{order.symbol}</strong>
                        <small>{order.name}</small>
                      </span>
                      <span className="quant-ledger-weight">{watchRows.find((row) => symbolKey(row.symbol) === symbolKey(order.symbol))?.weight != null ? `${formatNumber(watchRows.find((row) => symbolKey(row.symbol) === symbolKey(order.symbol))?.weight ?? 0, 1)}%` : "—"}</span>
                      <span>{positionPlan.actions.find((action) => symbolKey(action.symbol) === symbolKey(order.symbol))?.targetBandLabel ?? "—"}</span>
                      <span className={`quant-ledger-side is-${order.side.toLowerCase()}`}>{sideLabel(order.side)}</span>
                      <strong className="quant-ledger-amount">{order.amount}</strong>
                      <span className={`quant-ledger-priority is-${ranking.tone}`} title={`${ranking.reason}；${ranking.evidence}`}>
                        <strong>{ranking.priority === "BLOCKED" ? "阻断" : `${ranking.priority} ${ranking.score}`} · {ranking.priorityLabel}</strong>
                      </span>
                    </button>
                    <button
                      type="button"
                      className="quant-ledger-quick-action"
                      title={orderGuard?.blocked ? orderGuard.summary : ""}
                      onClick={() => handleRecommendationAction(order, orderGuard)}
                    >
                      {orderGuard?.blocked ? "查看阻断" : "选择"}
                    </button>
                  </article>
                  );
                })}
                {decisionCoverage.skipped.map((item) => (
                  <article key={`skipped-${item.key}`} className={`is-${item.tone} is-readonly`}>
                    <button
                      type="button"
                      className="quant-suggestion-select"
                      aria-label={`${item.symbol} ${item.action}暂不建票`}
                      title={item.reason}
                      disabled
                    >
                      <span className="quant-ledger-asset">
                        <strong>{item.symbol}</strong>
                        <small>{item.name}</small>
                      </span>
                      <span className="quant-ledger-weight">{item.weightLabel}</span>
                      <span>{item.targetBandLabel}</span>
                      <span className={`quant-ledger-side ${item.sideClass}`}>{item.sideLabel}</span>
                      <strong className="quant-ledger-amount">{item.amountLabel}</strong>
                      <span className={`quant-ledger-priority is-${item.tone}`} title={item.reason}>
                        <strong>{item.priorityLabel}</strong>
                        <small>{item.reason}</small>
                      </span>
                    </button>
                    <button type="button" className="quant-ledger-quick-action" title={item.reason} disabled>
                      待条件
                    </button>
                  </article>
                ))}
                  </>
                ) : (
                  <div className="quant-empty-orders">
                    <DatasetRoundedIcon fontSize="inherit" />
                    <strong>当前没有需要执行的建议单</strong>
                    <span>组合决策或持仓管理给出新的操作建议后，会在这里生成委托。</span>
                  </div>
                )}
              </div>
              <div className="quant-ledger-more-actions" aria-label="更多操作">
                <span>工具</span>
                <button type="button" aria-haspopup="dialog" aria-expanded={activeDialog === "strategy"} onFocus={handleQuantDialogIntent} onPointerEnter={handleQuantDialogIntent} onClick={() => openQuantDialog("strategy")}>策略</button>
                <button
                  type="button"
                  aria-pressed={executionRailTab === "account"}
                  onFocus={() => preloadQuantModule("account")}
                  onPointerEnter={() => preloadQuantModule("account")}
                  onClick={() => setExecutionRailTab("account")}
                >
                  账户
                </button>
                <button type="button" aria-haspopup="dialog" aria-expanded={activeDialog === "backtest"} onFocus={handleQuantDialogIntent} onPointerEnter={handleQuantDialogIntent} onClick={handleRunBacktestAndOpen}>试算</button>
                <button
                  type="button"
                  aria-pressed={executionRailTab === "logs"}
                  onFocus={() => preloadQuantModule("logs")}
                  onPointerEnter={() => preloadQuantModule("logs")}
                  onClick={() => setExecutionRailTab("logs")}
                >
                  日志
                </button>
              </div>
            </section>

          </main>

          <aside className="decision-rail quant-execution-rail workspace-inspector-rail" aria-label="委托执行">
            <div className="quant-rail-head">
              <PanelTitle icon={<ReceiptLongRoundedIcon fontSize="inherit" />} eyebrow="执行" title="委托执行" />
            </div>
            <div className="quant-rail-tabs" role="tablist" aria-label="执行面板" onKeyDown={handleTabListKeyDown}>
              {EXECUTION_RAIL_TABS.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  role="tab"
                  aria-selected={executionRailTab === tab.key}
                  tabIndex={executionRailTab === tab.key ? 0 : -1}
                  className={executionRailTab === tab.key ? "is-active" : undefined}
                  onFocus={() => { if (tab.key !== "ticket") preloadQuantModule(tab.key); }}
                  onPointerEnter={() => { if (tab.key !== "ticket") preloadQuantModule(tab.key); }}
                  onClick={() => setExecutionRailTab(tab.key)}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <section id="quant-execution-ticket" className="quant-ledger-ticket" aria-label="交易票" hidden={executionRailTab !== "ticket"}>
                <header>
                  <div>
                    <span>交易票</span>
                    <strong>{activeRanking ? `${activeRanking.priority === "BLOCKED" ? "阻断" : `${activeRanking.priority} ${activeRanking.score}`} · ${activeRanking.priorityLabel}` : "等待选择"}</strong>
                  </div>
                  {activeRecommendation ? (
                    <button type="button" onClick={() => setControlPanelOpen(true)}>更换</button>
                  ) : null}
                </header>

                <div className="quant-ticket-identity">
                  <strong>{activeWatch?.symbol ?? "选择建议"}</strong>
                  <span>{activeWatch?.label ?? "从左侧账本选择一条建议"}</span>
                  {activeWatch ? <em>{activeWatch.sourceLabel} · {activeWatchTradeStatus}</em> : null}
                </div>

                <div className={`quant-ticket-decision is-${activeRecommendation ? (activeRecommendation.side === "SELL" ? "sell" : "buy") : "neutral"}`}>
                  <div>
                    <span>{activeRecommendation ? sideLabel(activeRecommendation.side) : "待选择"}</span>
                    <small>{activeRecommendation?.side === "SELL" ? "降低仓位" : "增加仓位"}</small>
                  </div>
                  <div>
                    <small>金额</small>
                    <strong>{activeRecommendation?.amount ?? "—"}</strong>
                  </div>
                  <p>
                    目标仓位
                    <strong>
                      {activeWatch?.weight != null ? `${formatNumber(activeWatch.weight, 1)}%` : "—"}
                      <span> → </span>
                      {activeTargetWeight != null ? `${formatNumber(activeTargetWeight, 1)}%` : "—"}
                    </strong>
                  </p>
                </div>

                <dl className="quant-ticket-facts">
                  <div>
                    <dt>参考限价</dt>
                    <dd>{activeWatch ? formatNumber(activeWatch.close, 2) : "—"}</dd>
                  </div>
                  <div>
                    <dt>预计份额</dt>
                    <dd>{activeTicketQuantity > 0 ? `≈ ${formatNumber(activeTicketQuantity, 0)} 份` : "—"}</dd>
                  </div>
                  <div>
                    <dt>交易方式</dt>
                    <dd>{executionLabel}</dd>
                  </div>
                  <div>
                    <dt>交易渠道</dt>
                    <dd>{executionRouteLabel}</dd>
                  </div>
                </dl>

                <section className="quant-ticket-guidance" aria-label="执行条件">
                  <header>
                    <strong>执行条件</strong>
                    <span>{activeExecutionGuidance.reviewAt} 复核</span>
                  </header>
                  <dl>
                    <div>
                      <dt>触发</dt>
                      <dd>{activeExecutionGuidance.triggerCondition}</dd>
                    </div>
                    <div>
                      <dt>限价</dt>
                      <dd>{activeExecutionGuidance.limitPriceRange}</dd>
                    </div>
                    <div className="is-invalidation">
                      <dt>失效</dt>
                      <dd>{activeExecutionGuidance.invalidationCondition}</dd>
                    </div>
                  </dl>
                </section>

                <div className="quant-ticket-risk">
                  <div>
                    <strong>风控检查</strong>
                    <span className={activeRiskPassed ? "is-positive" : "is-caution"}>
                      {activeRiskPassed ? "风控通过" : activeRecommendation ? "需要复核" : "等待建议"}
                    </span>
                  </div>
                  <p className={`quant-ticket-risk-summary ${activeRiskPassed ? "is-positive" : "is-caution"}`}>
                    {activeOrderGuard?.blocked
                      ? activeOrderGuard.summary
                      : activeRiskPassed
                        ? "目标带、预算与执行路由均已通过。"
                        : activeRecommendation
                          ? recommendationReadiness.detail
                          : "选择建议后检查执行条件。"}
                  </p>
                  <ProgressiveDisclosure label="完整检查" badge="6 项">
                    <ul>
                      <li className={activeRecommendation ? "is-positive" : "is-neutral"}><ShieldRoundedIcon fontSize="inherit" />建议方向与交易票一致</li>
                      <li className={recommendationReadiness.dataQuality.severity === "pass" ? "is-positive" : "is-caution"}><ShieldRoundedIcon fontSize="inherit" />{recommendationReadiness.dataQuality.detail}</li>
                      <li className={activePlanAction ? "is-positive" : "is-neutral"}><ShieldRoundedIcon fontSize="inherit" />目标带与仓位变化已校验</li>
                      <li className={activeRecommendationAllowed ? "is-positive" : "is-caution"}><ShieldRoundedIcon fontSize="inherit" />{activeRecommendationAllowed ? "当前方向满足执行门槛" : recommendationReadiness.detail}</li>
                      <li className={executionReady ? "is-positive" : "is-caution"}><ShieldRoundedIcon fontSize="inherit" />{executionMode === "auto" && !recommendationReadiness.autoExecutionAllowed ? `${recommendationReadiness.validationLabel}，仅允许模拟` : executionReady ? "执行路由可用" : "执行通道需要检查"}</li>
                      <li className={activeQuote ? "is-positive" : "is-caution"}><ShieldRoundedIcon fontSize="inherit" />{activeQuote ? "行情已同步" : "排队前自动同步行情"}</li>
                    </ul>
                  </ProgressiveDisclosure>
                </div>

                <div className="quant-flow-compact quant-ticket-flow" aria-label="执行确认">
                  <span className={`is-${normalizePlanTone(score.tone)}`}>建议 <strong>{score.label}</strong></span>
                  <span className={`is-${normalizePlanTone(activeGate?.tone ?? "neutral")}`}>风控 <strong>{activeGate?.label ?? "待生成"}</strong></span>
                  <span className={orderRows.length || orders.length ? "is-caution" : "is-neutral"}>委托 <strong>{orderIntentLabel(orderRows.length, orders.length)}</strong></span>
                  <span className={`is-${normalizePlanTone(executionTone)}`}>方式 <strong>{executionLabel}</strong></span>
                  <span className={executionReady ? "is-positive" : "is-caution"}>路由 <strong>{executionReady ? executionRouteLabel : "检查"}</strong></span>
                </div>

                <button
                  type="button"
                  className="quant-ticket-primary-action"
                  disabled={!activeTicketReady}
                  title={activeExecutionReadiness.reason}
                  onClick={handleQueueActiveOrder}
                >
                  <ReceiptLongRoundedIcon fontSize="inherit" />
                  {activeExecutionReadiness.primaryLabel}
                </button>
                {activeWatch && !activeWatch.tradable ? (
                  <button
                    type="button"
                    className="quant-secondary-button"
                    onClick={activeWatch.source === "profile" && !activeWatchRegistered ? handleRegisterActiveWatch : onOpenHoldings}
                  >
                    {activeWatch.source === "profile" && !activeWatchRegistered ? "加入观察" : "持仓管理"}
                  </button>
                ) : null}
                <p className="quant-ticket-note">生成后进入待执行队列，可在高级执行区查看。</p>
            </section>

            <Card size="sm" className="rail-card quant-market-quote-card" role="region" aria-label="行情" hidden={executionRailTab !== "ticket"}>
                <div className="quant-section-head">
                  <div>
                    <span>行情</span>
                    <strong>{activeWatch ? `${activeWatch.symbol} · ${quoteStatusLabel(activeQuote)}` : "选择标的"}</strong>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    className="quant-rail-control"
                    disabled={!activeWatch || marketQuoteSyncing === symbolKey(activeWatch.symbol)}
                    onClick={() => {
                      if (!activeWatch) return;
                      void syncQuoteForIntent(orderIntentFromWatch(activeWatch, strategy), { force: true });
                    }}
                  >
                    {activeWatch && marketQuoteSyncing === symbolKey(activeWatch.symbol) ? "同步中" : "同步"}
                  </Button>
                </div>
                <div className="quant-order-center-summary" aria-label="行情摘要">
                  <span>买一 <strong>{quotePriceLabel(activeQuote?.bid)}</strong></span>
                  <span>卖一 <strong>{quotePriceLabel(activeQuote?.ask)}</strong></span>
                  <span>NAV <strong>{quotePriceLabel(activeQuote?.indicativeNav ?? activeQuote?.nav)}</strong></span>
                </div>
                <p>{activeQuote ? quoteMessage(activeQuote) : activeWatch?.tradable ? "排队前会自动回填行情，ETF 会检查价差和折溢价。" : activeWatch?.source === "profile" ? "代理信号可同步行情，也可先加入观察资产。" : "观察或代理资产不会直接进入委托队列。"}</p>
              </Card>

              {executionRailTab === "simulation" ? (
                <DeferredContent label="模拟账户" resetKey="quant-simulation">
                  <QuantSimulationPanel
                    paperSim={paperSim}
                    summary={paperSimSummary}
                    onPause={handlePausePaperSimulation}
                    onRun={paperSimSummary.active ? handleRunPaperSimulation : handleStartPaperSimulation}
                  />
                </DeferredContent>
              ) : null}

              {executionRailTab === "orders" ? (
                <DeferredContent label="委托队列" resetKey="quant-orders">
                  <QuantOrdersPanel
                    activeCommandKey={activeOrderCommandKey}
                    blockedOrderCount={blockedOrderCount}
                    exportFormat={orderAuditExporting}
                    orders={orderRows}
                    summary={orderCenter}
                    onClearBlocked={handleClearBlockedOrders}
                    onCommand={handleOrderCommand}
                    onExport={handleExportOrderAudit}
                    onManualAdvance={handleManualOrderStep}
                  />
                </DeferredContent>
              ) : null}

              {executionRailTab === "account" ? (
                <DeferredContent label="账户同步" resetKey="quant-account">
                  <QuantAccountPanel
                    accountBook={accountBook}
                    activeAccounts={activeAccounts}
                    actionableRows={actionableReconcileRows}
                    currency={positionPlan.currency}
                    executionAccountId={executionAccountId}
                    portfolio={accountPortfolio}
                    reconcile={accountReconcile}
                    syncing={accountSyncing}
                    onApplyAll={handleApplyReconcileDiffs}
                    onApplyRow={handleApplyReconcileRow}
                    onExecutionAccountChange={setExecutionAccountId}
                    onSync={handleSyncAccount}
                  />
                </DeferredContent>
              ) : null}

              {executionRailTab === "logs" ? (
                <DeferredContent label="运行日志" resetKey="quant-logs">
                  <QuantLogsPanel logs={logs} />
                </DeferredContent>
              ) : null}

          </aside>
        </div>
      )}
      {activeDialog && report && reportIsCurrent ? (
        <DeferredContent label="量化高级设置" resetKey={activeDialog} variant="overlay">
          <QuantLabDialogs
            activeAdapterPlan={activeAdapterPlan}
            activeDialog={activeDialog}
            bridgeError={bridgeError}
            bridgeLoading={bridgeLoading}
            bridgeStatuses={bridgeStatuses}
            brokerMode={brokerMode}
            executionLabel={executionLabel}
            executionMode={executionMode}
            executionTone={executionTone}
            lastRun={lastRun}
            onBrokerChange={handleBrokerChange}
            onClose={() => setActiveDialog(null)}
            onExecutionModeChange={handleExecutionModeChange}
            onPresetChange={handlePresetChange}
            onRefreshBridge={() => void refreshBridgeStatus()}
            onRequireLiveConfirmationToggle={handleRequireLiveConfirmationToggle}
            onRiskCapChange={updateRiskPolicyCap}
            onRiskLossChange={updateRiskPolicyLoss}
            onRiskNumberChange={updateRiskPolicyNumber}
            onRiskOverrideToggle={handleRiskOverrideToggle}
            onScalingPolicyChange={handleScalingPolicyChange}
            onStartReplacementSimulation={handleStartReplacementSimulation}
            onStrategyPolicyChange={updateStrategyPolicyConfig}
            paperSimLastRunDate={paperSim.lastRunDate}
            paperSimTone={paperSimSummary.tone}
            positionPlan={positionPlan}
            primaryReplacementPlan={primaryReplacementPlan}
            qbotPreset={qbotPreset}
            recommendationReadiness={recommendationReadiness}
            report={report}
            riskOverride={riskOverride}
            riskPolicy={riskPolicy}
            riskPolicyError={riskPolicyState.error}
            strategyPolicyConfig={strategyPolicyConfig}
          />
        </DeferredContent>
      ) : null}
    </section>
  );
}

function PanelTitle({ eyebrow, icon, title }: { eyebrow: string; icon: ReactNode; title: string }) {
  return (
    <div className="quant-panel-title">
      {icon}
      <div>
        <span>{eyebrow}</span>
        <strong>{title}</strong>
      </div>
    </div>
  );
}

function MonitorStatusCard({
  enabled,
  evaluation,
  lastRun,
  nextRun,
}: {
  enabled: boolean;
  evaluation: ProfileMonitorEvaluation | null;
  lastRun: string;
  nextRun: string;
}) {
  const tone = enabled ? evaluation?.tone ?? "neutral" : "neutral";
  return (
    <section className={`quant-monitor-card is-${tone}`} aria-label="Profile 监测">
      <div className="quant-monitor-head">
        <div>
          <span>Profile 监测</span>
          <strong>{enabled ? evaluation?.statusLabel ?? "运行" : "未开启"}</strong>
        </div>
        <em>{enabled ? evaluation?.actionLabel ?? "等待" : "手动"}</em>
      </div>
      <p>{enabled ? evaluation?.summary ?? "等待 Profile 刷新。" : "开启后按 Profile 变化自动识别新委托。"}</p>
      <div className="quant-monitor-meta">
        <span>上次 <strong>{lastRun || "—"}</strong></span>
        <span>下次 <strong>{enabled ? nextRun || "排队中" : "—"}</strong></span>
      </div>
    </section>
  );
}

function labLogsFor({
  engineMode,
  eventLogs,
  executionMode,
  lastRun,
  paperSimSummary,
  queuedOrders,
  report,
  reportIsCurrent,
  score,
  strategy,
  tradeHabit,
  trades,
}: {
  engineMode: EngineMode;
  eventLogs: LabLog[];
  executionMode: ExecutionMode;
  lastRun: ScenarioProjectionResult | null;
  paperSimSummary: PaperSimSummary;
  queuedOrders: OrderRecord[];
  report: MarketAnalysisReport | null;
  reportIsCurrent: boolean;
  score: StrategyScore;
  strategy: StrategyDefinition;
  tradeHabit: TradeHabit;
  trades: TradeRecord[];
}): LabLog[] {
  const orderSummary = summarizeOrderCenter(queuedOrders);
  const base: LabLog[] = [
    {
      key: "strategy",
      time: "now",
      tone: score.tone,
      text: `${executionModeLabel(executionMode)} · ${modeLabel(engineMode)} · ${strategy.label} · ${score.permission}`,
    },
    {
      key: "queue",
      time: "queue",
      tone: queuedOrders.length ? "caution" : "neutral",
      text: queuedOrders.length
        ? `${orderSummary.active} 条活跃，${orderSummary.prepared} 已预备，${orderSummary.errored} 异常`
        : "委托队列为空，等待建议单或手动下单票。",
    },
    {
      key: "paper-sim",
      time: paperSimSummary.lastRunDate || "sim",
      tone: paperSimSummary.tone,
      text: paperSimSummary.active
        ? `自动模拟 · ${paperSimCompactReturn(paperSimSummary)} · ${paperSimSummary.tradeCount} 笔`
        : "自动模拟未启动，等待建立实验账本。",
    },
    {
      key: "habit",
      time: "30d",
      tone: tradeHabit.tone,
      text: tradeHabit.summary,
    },
  ];
  if (report && reportIsCurrent) {
    base.splice(1, 0, {
      key: "profile",
      time: report.asOf,
      tone: toneFromText(report.decisionFrame.permissionTone),
      text: `${report.profileName} · ${report.decisionFrame.permission} · 风险 ${report.score}/100`,
    });
  }
  if (lastRun) {
    base.splice(1, 0, {
      key: lastRun.key,
      time: lastRun.createdAt,
      tone: lastRun.tone,
      text: lastRun.summary,
    });
  }
  const latestTrades = [...trades]
    .sort((left, right) => right.tradeDate.localeCompare(left.tradeDate))
    .slice(0, 2)
    .map((trade, index) => ({
      key: `trade-${trade.id || index}`,
      time: trade.tradeDate,
      tone: (trade.side === "buy" ? "neutral" : "caution") as LabTone,
      text: `${trade.side === "buy" ? "买入" : "卖出"} ${trade.symbol} · ${formatNumber(trade.quantity, 2)} @ ${formatNumber(trade.price, 2)}`,
    }));
  return [...eventLogs, ...base, ...latestTrades].slice(0, 7);
}

function watchRowsFor(report: MarketAnalysisReport, holdings: HoldingRecord[], positionPlan: PositionPlan): WatchRow[] {
  const holdingBySymbol = new Map(holdings.map((item) => [symbolKey(item.symbol), item]));
  const technicalBySymbol = new Map(report.technicalRows.map((item) => [symbolKey(item.symbol), item]));
  const weightByHoldingId = new Map(positionPlan.decision.assetDecisions.map((item) => [item.holdingId, item.weight]));
  const rows = report.assetStatuses.map((asset) => {
    const technical = technicalBySymbol.get(symbolKey(asset.symbol));
    const holding = holdingBySymbol.get(symbolKey(asset.symbol));
    return watchRowFromAsset(asset, technical, holding, holding ? weightByHoldingId.get(holding.id) ?? null : null);
  });
  const extras = holdings
    .filter((holding) => !rows.some((item) => symbolKey(item.symbol) === symbolKey(holding.symbol)))
    .map((holding) => watchRowFromHolding(holding, weightByHoldingId.get(holding.id) ?? null));
  return [...rows, ...extras].sort(compareWatchRows);
}

function watchRowFromAsset(
  asset: AssetStatus,
  technical: TechnicalRow | undefined,
  holding: HoldingRecord | undefined,
  weight: number | null,
): WatchRow {
  const cash = Boolean(holding && isCashHolding(holding));
  const tradable = Boolean(holding?.role === "real" && !cash);
  return {
    symbol: asset.symbol,
    label: holding?.name || asset.label,
    close: firstPositiveNumber(holding?.currentPrice, asset.close) ?? 0,
    change1d: asset.change1d,
    weight: holding?.role === "real" ? weight : null,
    status: holding?.role ?? asset.statusLabel,
    tone: toneFromStatus(asset.status),
    rsi: technical?.rsi14 ?? null,
    volumeRatio: technical?.volumeRatio ?? null,
    source: holding ? "holding" : "profile",
    sourceLabel: holding ? holdingSourceLabel(holding, cash) : "代理信号",
    tradable,
    tradeBlockReason: tradable ? "" : holdingBlockReason(holding, cash),
  };
}

function watchRowFromHolding(holding: HoldingRecord, weight: number | null): WatchRow {
  const cash = isCashHolding(holding);
  const tradable = holding.role === "real" && !cash;
  return {
    symbol: holding.symbol,
    label: holding.name,
    close: holding.currentPrice,
    change1d: null,
    weight: holding.role === "real" ? weight : null,
    status: holding.role,
    tone: cash ? "neutral" : tradable ? "caution" : "neutral",
    rsi: null,
    volumeRatio: null,
    source: "holding",
    sourceLabel: holdingSourceLabel(holding, cash),
    tradable,
    tradeBlockReason: tradable ? "" : holdingBlockReason(holding, cash),
  };
}

function summarizeWatchRows(rows: WatchRow[]) {
  return {
    all: rows.length,
    signals: rows.filter(isObservationWatchRow).length,
    tradable: rows.filter((row) => row.tradable).length,
  };
}

function filterWatchRows(rows: WatchRow[], filter: WatchFilter) {
  if (filter === "tradable") return rows.filter((row) => row.tradable);
  if (filter === "signals") return rows.filter(isObservationWatchRow);
  return rows;
}

function isObservationWatchRow(row: WatchRow) {
  return !row.tradable && row.sourceLabel !== "现金";
}

function holdingSourceLabel(holding: HoldingRecord, cash = isCashHolding(holding)) {
  if (cash) return "现金";
  if (holding.role === "real") return "本地持仓";
  if (holding.role === "proxy") return "代理资产";
  return "观察资产";
}

function holdingBlockReason(holding: HoldingRecord | undefined, cash = Boolean(holding && isCashHolding(holding))) {
  if (!holding) return "代理信号只用于组合风控";
  if (cash) return "现金或货基不进入委托队列";
  if (holding.role === "proxy") return "代理资产不进入委托队列，先转为本地持仓并配置目标带";
  if (holding.role === "watch") return "观察资产不进入委托队列，先转为本地持仓并配置目标带";
  return "该资产暂不满足下单条件";
}

function blockNonTradableActiveOrders(orderRows: OrderRecord[], holdings: HoldingRecord[]) {
  const tradableSymbols = new Set(
    holdings
      .filter((holding) => holding.role === "real" && !isCashHolding(holding))
      .map((holding) => symbolKey(holding.symbol)),
  );
  const cleanableStatuses = new Set(["preview", "queued", "prepared"]);
  let blocked = 0;
  const orders = orderRows.map((order) => {
    if (!cleanableStatuses.has(order.status)) {
      return order;
    }
    const createdAt = new Date(order.createdIso || order.updatedIso || "").getTime();
    const stale = Number.isFinite(createdAt) && Date.now() - createdAt > 24 * 60 * 60 * 1000;
    const nonTradable = !tradableSymbols.has(symbolKey(order.symbol));
    if (!stale && !nonTradable) return order;
    blocked += 1;
    const now = new Date();
    const reason = stale
      ? "排队超过 24 小时且未提交，已自动失效；请按最新净值和规则重新生成。"
      : "非持仓代理标的不能直接下单，先加入持仓并配置目标带。";
    return {
      ...order,
      detail: reason,
      events: [
        createOrderEvent({
          detail: reason,
          label: "风控阻断",
          status: "blocked",
          tone: "negative",
          type: "risk_blocked",
        }, now),
        ...order.events,
      ].slice(0, 10),
      lastError: reason,
      routeStatus: stale ? "expired" : "non_tradable",
      state: "已阻断",
      status: "blocked" as const,
      tone: "negative" as const,
      updatedAt: shortTimeLabel(),
      updatedIso: now.toISOString(),
      warnings: Array.from(new Set([reason, ...order.warnings])),
    };
  });
  return {
    blocked,
    changed: blocked > 0,
    orders,
  };
}

function compareWatchRows(left: WatchRow, right: WatchRow) {
  const priorityDiff = watchRowPriority(left) - watchRowPriority(right);
  if (priorityDiff !== 0) return priorityDiff;
  const leftWeight = left.weight ?? -1;
  const rightWeight = right.weight ?? -1;
  if (rightWeight !== leftWeight) return rightWeight - leftWeight;
  return 0;
}

function watchRowPriority(row: WatchRow) {
  if (row.tradable) return 0;
  if (row.source === "holding") return 1;
  return 2;
}

function modeLabel(mode: EngineMode) {
  return mode === "scenario" ? "情景试算" : "模拟";
}

function recommendationAllowed(order: Pick<OrderIntent, "side">, readiness: RecommendationReadiness) {
  return order.side.toUpperCase() === "SELL" ? readiness.canReduceRisk : readiness.canIncreaseRisk;
}

function executionModeLabel(mode: ExecutionMode) {
  if (mode === "simulation") return "自动模拟";
  return mode === "manual" ? "手动交易" : "通道自动";
}

function orderIntentFromWatch(watch: WatchRow, strategy: StrategyDefinition): OrderIntent {
  return {
    key: `quote-${watch.symbol}`,
    symbol: watch.symbol,
    name: watch.label,
    side: strategy.key === "defense-first" ? "SELL" : "BUY",
    state: "行情同步",
    tone: watch.tone,
    amount: "—",
    weight: watch.weight != null ? `${formatNumber(watch.weight, 1)}%` : "—",
    detail: "手动行情同步",
  };
}

function createWatchHoldingFromWatch(watch: WatchRow, report: MarketAnalysisReport): HoldingRecord {
  const market = inferWatchMarket(watch, report);
  const price = firstPositiveNumber(watch.close) ?? 0;
  const symbol = symbolKey(watch.symbol);
  return {
    id: `watch-${symbol.toLowerCase()}-${Date.now()}`,
    symbol,
    name: watch.label || symbol,
    market,
    currency: currencyForMarket(market),
    role: "watch",
    assetType: inferWatchAssetType(watch),
    quoteSource: quoteSourceForMarket(market),
    quantity: 0,
    costPrice: price,
    currentPrice: price,
    targetWeight: 0,
    notes: `由量化交易页从 ${report.profileName} 代理信号加入观察。`,
  };
}

function inferWatchMarket(watch: WatchRow, report: MarketAnalysisReport) {
  const profileMarket = report.profileMarket.trim();
  if (profileMarket === "US" || profileMarket === "CN" || profileMarket === "HK" || profileMarket === "Global") {
    return profileMarket;
  }
  if (/^\d{6}$/.test(watch.symbol)) return "CN";
  if (/\.HK$/i.test(watch.symbol)) return "HK";
  return "US";
}

function currencyForMarket(market: string) {
  if (market === "CN") return "CNY";
  if (market === "HK") return "HKD";
  return "USD";
}

function quoteSourceForMarket(market: string) {
  return market === "CN" ? "manual" : "yahoo";
}

function inferWatchAssetType(watch: WatchRow) {
  const symbol = symbolKey(watch.symbol);
  if (/^\d{6}$/.test(symbol)) return "fund";
  const etfLike = new Set(["SPY", "QQQ", "SMH", "IWM", "DIA", "VTI", "VOO", "VEA", "VWO", "TLT", "GLD"]);
  if (etfLike.has(symbol) || watch.label.includes("ETF") || watch.label.includes("指数")) return "etf";
  if (symbol === "VIX") return "other";
  return "stock";
}

function referencePriceForIntent(
  intent: OrderIntent,
  holding: HoldingRecord | undefined,
  watch: WatchRow | undefined,
  report: MarketAnalysisReport,
) {
  const asset = report.assetStatuses.find((item) => symbolKey(item.symbol) === symbolKey(intent.symbol));
  const technical = report.technicalRows.find((item) => symbolKey(item.symbol) === symbolKey(intent.symbol));
  return firstPositiveNumber(watch?.close, holding?.currentPrice, asset?.close, technical?.close);
}

function quoteIsFresh(quote: MarketQuoteSnapshot | null | undefined, maxAgeMs = 30_000) {
  if (!quote?.syncedAt) return false;
  const age = Date.now() - Date.parse(quote.syncedAt);
  return Number.isFinite(age) && age >= 0 && age <= maxAgeMs;
}

function quoteStatusLabel(quote: MarketQuoteSnapshot | null) {
  if (!quote) return "待同步";
  if (!quote.accepted) return "未就绪";
  if (quote.bid && quote.ask) return "盘口已回填";
  if (quote.last) return "参考价";
  return "已同步";
}

function quoteMessage(quote: MarketQuoteSnapshot) {
  const source = quote.source ? ` · ${quote.source}` : "";
  const session = quote.session ? ` · ${quote.session}` : "";
  return `${quote.message || quoteStatusLabel(quote)}${source}${session}`;
}

function quotePriceLabel(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return "—";
  return formatNumber(value, value >= 100 ? 2 : 4);
}

function symbolKey(symbol: string) {
  return symbol.trim().toUpperCase();
}

function firstPositiveNumber(...values: Array<number | null | undefined>) {
  return values.find((value) => typeof value === "number" && Number.isFinite(value) && value > 0) ?? null;
}

function orderIntentLabel(queuedCount: number, planCount: number) {
  if (queuedCount > 0) return `${queuedCount} 条已排队`;
  if (planCount > 0) return `${planCount} 条计划`;
  return "无委托";
}

function prepareManualExecutionOrder(order: OrderRecord): OrderRecord {
  const now = new Date();
  const detail = "手动执行票已生成，请在外部交易平台按金额、数量和限价下单。";
  return {
    ...order,
    broker: MANUAL_BROKER_MODE,
    detail,
    events: [
      createOrderEvent({
        detail,
        label: "人工执行",
        status: "prepared",
        tone: "caution",
        type: "prepared",
      }, now),
      ...order.events,
    ].slice(0, 10),
    lastError: "",
    route: "手动交易",
    routeStatus: "manual_ready",
    source: "manual",
    state: "待人工执行",
    status: "prepared" as const,
    tone: order.tone === "negative" ? "negative" : "caution",
    updatedAt: shortTimeLabel(),
    updatedIso: now.toISOString(),
    warnings: Array.from(new Set(["手动票不会自动提交；完成后请同步账户或标记成交。", ...order.warnings])),
  };
}

function advanceManualExecutionOrder(order: OrderRecord): OrderRecord {
  const normalized = normalizeOrderRecords([order])[0];
  const now = new Date();
  const nextFilled = normalized.status === "submitted" || normalized.status === "partially_filled";
  const status = nextFilled ? "filled" : "submitted";
  const label = nextFilled ? "人工已成交" : "人工已下单";
  const detail = nextFilled
    ? "已按外部交易平台结果确认完成，建议同步账户做持仓对账。"
    : "已在外部交易平台下单，等待成交回报或账户同步。";
  return {
    ...normalized,
    events: [
      createOrderEvent({
        detail,
        label,
        status,
        tone: nextFilled ? "positive" : "caution",
        type: nextFilled ? "filled" : "submitted",
      }, now),
      ...normalized.events,
    ].slice(0, 10),
    filledAt: nextFilled && !normalized.filledAt ? now.toISOString() : normalized.filledAt,
    route: "手动交易",
    routeStatus: nextFilled ? "manual_filled" : "manual_submitted",
    state: nextFilled ? "人工已成交" : "等待账户同步",
    status,
    submittedAt: !nextFilled && !normalized.submittedAt ? now.toISOString() : normalized.submittedAt,
    tone: nextFilled ? "positive" : "caution",
    updatedAt: shortTimeLabel(),
    updatedIso: now.toISOString(),
  };
}

function applyReconcileRowToHoldings({
  fallbackCurrency,
  holdings,
  positions,
  row,
}: {
  fallbackCurrency: string;
  holdings: HoldingRecord[];
  positions: AccountBookPosition[];
  row: PortfolioReconcileRow;
}): { changed: boolean; holdings: HoldingRecord[]; message: string; tone: LabTone } {
  const key = symbolKey(row.symbol);
  const index = holdings.findIndex((holding) =>
    symbolKey(holding.symbol) === key && (holding.accountId ?? "") === row.accountId,
  );
  const existing = index >= 0 ? holdings[index] : undefined;
  const brokerPositions = positions.filter((position) =>
    symbolKey(position.symbol) === key && position.accountId === row.accountId,
  );

  if (row.status === "extra" || row.status === "drift") {
    const nextHolding = holdingFromReconcile(row, brokerPositions, existing, fallbackCurrency);
    if (index >= 0) {
      const next = holdings.map((holding, itemIndex) => (itemIndex === index ? nextHolding : holding));
      return {
        changed: true,
        holdings: next,
        message: `${row.symbol} 已按账户回报${existing?.role === "real" ? "更新" : "转为本地持仓"}。`,
        tone: "positive",
      };
    }
    return {
      changed: true,
      holdings: [nextHolding, ...holdings],
      message: `${row.symbol} 已从账户回报加入本地持仓。`,
      tone: "positive",
    };
  }

  if (row.status === "missing" && existing?.role === "real") {
    const next = holdings.map((holding, itemIndex) =>
      itemIndex === index
        ? {
          ...holding,
          role: "watch" as const,
          notes: mergeHoldingNote(holding.notes, "账户同步未返回该持仓，已暂设为观察资产。"),
        }
        : holding,
    );
    return {
      changed: true,
      holdings: next,
      message: `${row.symbol} 已设为观察资产，暂不进入委托队列。`,
      tone: "caution",
    };
  }

  return { changed: false, holdings, message: `${row.symbol} 无需处理。`, tone: "neutral" };
}

function holdingFromReconcile(
  row: PortfolioReconcileRow,
  positions: AccountBookPosition[],
  existing: HoldingRecord | undefined,
  fallbackCurrency: string,
): HoldingRecord {
  const quantity = firstPositiveNumber(row.brokerQuantity, sumPositionField(positions, "quantity"), existing?.quantity) ?? 0;
  const brokerValue = firstPositiveNumber(row.brokerValue, sumPositionField(positions, "marketValue")) ?? 0;
  const price = firstPositiveNumber(
    quantity > 0 && brokerValue > 0 ? brokerValue / quantity : null,
    firstPositionPrice(positions),
    existing?.currentPrice,
  ) ?? 0;
  const costValue = sumPositionField(positions, "costValue");
  const costPrice = firstPositiveNumber(
    quantity > 0 && costValue > 0 ? costValue / quantity : null,
    existing?.costPrice,
    price,
  ) ?? 0;
  const currency = row.currency || positions.find((position) => position.currency)?.currency || existing?.currency || fallbackCurrency || "CNY";
  const exchange = positions.find((position) => position.exchange)?.exchange ?? "";
  return {
    id: existing?.id ?? `acct-${symbolKey(row.symbol).toLowerCase()}-${Date.now()}`,
    accountId: row.accountId || existing?.accountId,
    symbol: symbolKey(row.symbol),
    name: row.name || existing?.name || symbolKey(row.symbol),
    market: existing?.market || inferBrokerMarket(exchange, currency),
    currency,
    role: "real",
    assetType: existing?.assetType ?? inferBrokerAssetType(row.symbol, row.name),
    quoteSource: existing?.quoteSource ?? "manual",
    profileKey: existing?.profileKey,
    quantity,
    costPrice,
    currentPrice: price,
    targetMinWeight: existing?.targetMinWeight,
    targetWeight: existing?.targetWeight ?? 0,
    targetMaxWeight: existing?.targetMaxWeight,
    notes: mergeHoldingNote(existing?.notes ?? "", "由账户同步回报更新本地持仓。"),
  };
}

function sumPositionField(positions: AccountBookPosition[], field: "quantity" | "marketValue" | "costValue") {
  return positions.reduce((sum, position) => sum + (Number.isFinite(position[field]) ? position[field] : 0), 0);
}

function firstPositionPrice(positions: AccountBookPosition[]) {
  return positions.find((position) => Number.isFinite(position.price) && position.price > 0)?.price ?? null;
}

function inferBrokerMarket(exchange: string, currency: string) {
  const value = `${exchange} ${currency}`.toUpperCase();
  if (value.includes("HK") || value.includes("SEHK") || value.includes("HKD")) return "HK";
  if (value.includes("SSE") || value.includes("SZSE") || value.includes("CNY") || value.includes("CN")) return "CN";
  if (value.includes("NYSE") || value.includes("NASDAQ") || value.includes("USD") || value.includes("US")) return "US";
  return "Global";
}

function inferBrokerAssetType(symbol: string, name: string): HoldingRecord["assetType"] {
  const key = symbolKey(symbol);
  const text = `${key} ${name}`.toUpperCase();
  if (/^\d{6}$/.test(key)) return "fund";
  if (text.includes("ETF") || ["SPY", "QQQ", "SMH", "IWM", "DIA", "VTI", "VOO", "TLT", "GLD"].includes(key)) return "etf";
  return "stock";
}

function mergeHoldingNote(current: string, addition: string) {
  const trimmed = current.trim();
  if (trimmed.includes(addition)) return trimmed;
  return [trimmed, addition].filter(Boolean).join(trimmed ? "\n" : "");
}

function shortTimeLabel() {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date());
}

function nextRunLabel(intervalMs: number) {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(Date.now() + intervalMs));
}

function toneFromStatus(status: string): LabTone {
  if (status === "green") return "positive";
  if (status === "red") return "negative";
  if (status === "yellow") return "caution";
  return "neutral";
}

function summarizeDecisionCoverage(positionPlan: PositionPlan, orders: OrderIntent[], guards: RiskGuardResult[] = []) {
  const actions = positionPlan.actions.filter((action) => action.holdingId);
  const orderKeys = new Set(orders.map((order) => order.key));
  const blockedOrderKeys = new Set(guards.filter((guard) => guard.blocked).map((guard) => guard.intent.key));
  const skipped = actions
    .filter((action) => !orderKeys.has(action.key))
    .map((action) => ({
      key: action.key,
      symbol: action.symbol,
      name: action.name,
      action: action.action,
      amountLabel: action.amountLabel,
      priorityLabel: skippedActionPriorityLabel(action),
      reason: action.reason || action.detail || "当前条件未满足",
      sideClass: skippedActionSideClass(action),
      sideLabel: skippedActionSideLabel(action),
      targetBandLabel: action.targetBandLabel,
      tone: normalizePlanTone(action.tone),
      weightLabel: action.weightLabel,
    }));
  const hold = skipped.filter((item) => item.action.includes("持有")).length;
  const blocked = orders.filter((order) => order.state === "已阻断" || blockedOrderKeys.has(order.key)).length;

  return {
    analyzed: actions.length,
    executable: Math.max(0, orders.length - blocked),
    hold,
    waiting: Math.max(0, skipped.length - hold + blocked),
    skipped,
  };
}

function skippedActionSideLabel(action: PositionPlanAction) {
  if (action.weightDelta < -0.01) return "卖出";
  if (action.weightDelta > 0.01 || action.amount > 0) return "买入";
  if (action.action.includes("持有")) return "持有";
  return "观察";
}

function skippedActionSideClass(action: PositionPlanAction) {
  if (action.weightDelta < -0.01) return "is-sell";
  if (action.weightDelta > 0.01 || action.amount > 0) return "is-buy";
  return "is-watch";
}

function skippedActionPriorityLabel(action: PositionPlanAction) {
  if (action.action.includes("持有")) return "继续持有";
  if (action.tone === "negative") return "阻断 · 暂不建票";
  return "等待条件 · 暂不建票";
}
