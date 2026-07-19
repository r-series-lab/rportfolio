import AutoGraphRoundedIcon from "@mui/icons-material/AutoGraphRounded";
import CandlestickChartRoundedIcon from "@mui/icons-material/CandlestickChartRounded";
import DatasetRoundedIcon from "@mui/icons-material/DatasetRounded";
import PlayArrowRoundedIcon from "@mui/icons-material/PlayArrowRounded";
import ReceiptLongRoundedIcon from "@mui/icons-material/ReceiptLongRounded";
import ShieldRoundedIcon from "@mui/icons-material/ShieldRounded";
import SpeedRoundedIcon from "@mui/icons-material/SpeedRounded";
import TuneRoundedIcon from "@mui/icons-material/TuneRounded";
import { useEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import "../styles/pages/quant-lab.css";
import {
  buildBrokerAdapterPlan,
  cancelOrderThroughAdapter,
  prepareOrderThroughAdapter,
  syncAccountThroughAdapter,
  syncMarketQuoteThroughAdapter,
  submitOrderThroughAdapter,
  syncOrderStatusThroughAdapter,
  type BrokerAdapterPlan,
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
import { runScenarioProjection, type ScenarioProjectionResult } from "../lib/backtest-engine";
import { lookupFundNav, lookupFundProfileSeed } from "../lib/analysis";
import { executionGuidanceFor } from "../lib/execution-guidance";
import type { HoldingRecord } from "../lib/holdings";
import {
  accountBookFromSnapshots,
  reconcileAccountBookWithHoldings,
  summarizeAccountBook,
  type AccountBookPosition,
  type PortfolioReconcileStatus,
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
  orderLatestEvent,
  orderStatusLabel,
  routeOrderErrorResult,
  summarizeOrderCenter,
  type OrderRecord,
  type OrderSourceKind,
} from "../lib/order-store";
import { isCashHolding, type PositionPlan, type PositionPlanAction, type PositionPlanTone } from "../lib/position-plan";
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
  paperFundOrderNextDate,
  paperFundOrderStatusLabel,
  paperSimCompactReturn,
  paperSimMetricLabel,
  paperSimRunButtonLabel,
  paperReplacementCostFor,
  paperTradePerformanceFor,
  paperTradePerformanceGroupsFor,
  pausePaperSimState,
  runPaperSimulationDay,
  summarizePaperSimState,
  type PaperSimSummary,
  type PaperSimState,
} from "../lib/paper-sim";
import type {
  AssetStatus,
  MarketAnalysisReport,
  TechnicalRow,
} from "../lib/types";
import { formatMoney, formatNumber, formatPercent } from "../lib/utils";
import type { FundExecutionPolicy } from "../lib/fund-execution-policy";
import { paperTradeAttributionFor } from "../lib/paper-trade-attribution";
import { paperStrategyExperimentFor } from "../lib/paper-strategy-experiment";
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
  SCALING_POLICIES,
  scalingPolicyDefinition,
  strategyScalingRuntimeBySymbol,
  type ScalingPolicyKey,
  type StrategyPolicyConfig,
} from "../lib/strategy-policies";
import {
  compareScalingPolicies,
  type ScalingReplayComparison,
} from "../lib/strategy-scaling-replay";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { ProgressiveDisclosure } from "./progressive-disclosure";

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
type ExecutionMode = "manual" | "simulation" | "auto";
type ExecutionRailTab = "ticket" | "orders" | "account" | "simulation" | "logs";
type QuantDialogKey = "strategy" | "bridge" | "risk" | "replacement" | "backtest" | null;

type LabLog = {
  key: string;
  time: string;
  tone: LabTone;
  text: string;
};

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

type BrokerOption = {
  key: BrokerMode;
  label: string;
  detail: string;
};

type WatchFilter = "tradable" | "signals" | "all";

const MANUAL_BROKER_MODE = "manual-ticket";
const PAPER_SIM_BROKER_MODE = "paper-simulation";
const PROFILE_MONITOR_INTERVAL_MS = 60_000;
const PROFILE_MONITOR_INTERVAL_LABEL = "60 秒";

const BROKER_OPTIONS: BrokerOption[] = [
  { key: "local-paper", label: "本地模拟", detail: "本地撮合" },
  { key: "qbot-bridge", label: "Qbot 桥接", detail: "Qbot 参数" },
  { key: "live-gateway", label: "vn.py 通道", detail: "券商适配器" },
];

const EXECUTION_MODE_OPTIONS: Array<{ key: ExecutionMode; label: string; detail: string }> = [
  { key: "manual", label: "手动交易", detail: "生成下单票" },
  { key: "simulation", label: "自动模拟", detail: "实验账本" },
  { key: "auto", label: "通道自动", detail: "桥接提交" },
];

const EXECUTION_RAIL_TABS: Array<{ key: ExecutionRailTab; label: string }> = [
  { key: "ticket", label: "交易票" },
  { key: "orders", label: "委托" },
  { key: "account", label: "账户" },
  { key: "simulation", label: "模拟" },
  { key: "logs", label: "日志" },
];

const QUANT_DIALOG_META: Record<Exclude<QuantDialogKey, null>, { eyebrow: string; title: string }> = {
  strategy: { eyebrow: "策略参数", title: "策略与参数" },
  bridge: { eyebrow: "执行通道", title: "执行通道" },
  risk: { eyebrow: "风控", title: "风控开关" },
  replacement: { eyebrow: "基金替换", title: "关联模拟计划" },
  backtest: { eyebrow: "情景验证", title: "情景试算结果" },
};

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
  const strategy = STRATEGIES.find((item) => item.key === activeStrategyKey) ?? STRATEGIES[0];
  const strategyPolicyConfig = useMemo(
    () => normalizeStrategyPolicyConfig(storedStrategyPolicyConfig),
    [storedStrategyPolicyConfig],
  );
  const activeScalingPolicy = scalingPolicyDefinition(strategyPolicyConfig.scalingPolicyKey);
  const scalingReplay = useMemo(
    () => compareScalingPolicies({
      activeConfig: strategyPolicyConfig,
      samples: report?.backtest.stateValidation.replaySamples ?? [],
    }),
    [report, strategyPolicyConfig],
  );
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

  const handleRunBacktest = () => {
    if (!report || !reportIsCurrent) {
      onOpenAnalysis();
      return;
    }
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
    handleRunBacktest();
    setActiveDialog("backtest");
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
          onClick={() => setActiveDialog("bridge")}
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
                  <button type="button" onClick={() => setActiveDialog("bridge")}>调整</button>
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
                  <button type="button" onClick={() => setActiveDialog("strategy")}>
                    <TuneRoundedIcon fontSize="inherit" />
                    <span>策略</span>
                  </button>
                  <button
                    type="button"
                    aria-haspopup="dialog"
                    aria-expanded={activeDialog === "risk"}
                    onClick={() => setActiveDialog("risk")}
                  >
                    <ShieldRoundedIcon fontSize="inherit" />
                    <span>风控</span>
                  </button>
                  <button type="button" onClick={() => setActiveDialog("bridge")}>
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
                  <button type="button" onClick={() => setActiveDialog("risk")}>
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
                    <button type="button" onClick={() => setActiveDialog("replacement")}>查看计划</button>
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
                <button type="button" aria-haspopup="dialog" aria-expanded={activeDialog === "strategy"} onClick={() => setActiveDialog("strategy")}>策略</button>
                <button type="button" aria-pressed={executionRailTab === "account"} onClick={() => setExecutionRailTab("account")}>账户</button>
                <button type="button" aria-haspopup="dialog" aria-expanded={activeDialog === "backtest"} onClick={handleRunBacktestAndOpen}>试算</button>
                <button type="button" aria-pressed={executionRailTab === "logs"} onClick={() => setExecutionRailTab("logs")}>日志</button>
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
                <PaperSimulationCard
                  paperSim={paperSim}
                  summary={paperSimSummary}
                  onPause={handlePausePaperSimulation}
                  onRun={paperSimSummary.active ? handleRunPaperSimulation : handleStartPaperSimulation}
                />
              ) : null}

              <Card id="quant-order-center" size="sm" className="rail-card quant-order-blotter" role="region" aria-label="委托队列" hidden={executionRailTab !== "orders"}>
                <div className="quant-section-head">
                  <div>
                    <span>委托队列</span>
                    <strong>{orderRows.length ? `${orderCenter.active} 活跃 / ${orderRows.length} 总计` : "等待排队"}</strong>
                  </div>
                  <span className="quant-audit-actions" aria-label="订单审计导出">
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      className="quant-rail-control"
                      disabled={!blockedOrderCount}
                      onClick={handleClearBlockedOrders}
                    >
                      清理阻断
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      className="quant-rail-control"
                      disabled={!orderRows.length || Boolean(orderAuditExporting)}
                      onClick={() => void handleExportOrderAudit("json")}
                    >
                      {orderAuditExporting === "json" ? "导出中" : "JSON"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      className="quant-rail-control"
                      disabled={!orderRows.length || Boolean(orderAuditExporting)}
                      onClick={() => void handleExportOrderAudit("csv")}
                    >
                      {orderAuditExporting === "csv" ? "导出中" : "CSV"}
                    </Button>
                  </span>
                </div>
                {orderRows.length ? (
                  <div className="quant-order-center-summary" aria-label="订单中心摘要">
                    <span>预备 <strong>{orderCenter.prepared}</strong></span>
                    <span>提交 <strong>{orderCenter.submitted}</strong></span>
                    <span>异常 <strong>{orderCenter.errored}</strong></span>
                  </div>
                ) : null}
                <div className="quant-order-list">
                  {orderRows.length ? orderRows.map((order) => {
                    const latestEvent = orderLatestEvent(order);
                    const manualOrder = isManualExecutionOrder(order);
                    const submitBusy = activeOrderCommandKey === `${order.id}:submitOrder`;
                    const cancelBusy = activeOrderCommandKey === `${order.id}:cancelOrder`;
                    const syncBusy = activeOrderCommandKey === `${order.id}:syncOrderStatus`;
                    const commandBusy = Boolean(activeOrderCommandKey);
                    return (
                      <article key={order.key} className={`is-${order.tone} is-${order.status}`}>
                        <div>
                          <span>{sideLabel(order.side)} · {orderStatusLabel(order.status)}</span>
                          <strong>{order.symbol}</strong>
                          <em>{order.name}</em>
                        </div>
                        <div>
                          <strong>{order.amount}</strong>
                          <span>{order.weight}</span>
                          <em>{order.route}</em>
                        </div>
                        <p>{order.quantity} @ {order.limit} · {latestEvent?.label ?? order.state}</p>
                        <div className="quant-order-actions" aria-label={`${order.symbol} 委托动作`}>
                          {manualOrder && manualOrderCanAdvance(order) ? (
                            <Button
                              type="button"
                              size="xs"
                              className="quant-order-command is-manual"
                              disabled={commandBusy}
                              onClick={() => handleManualOrderStep(order)}
                            >
                              {manualOrderActionLabel(order)}
                            </Button>
                          ) : null}
                          {!manualOrder && canSubmitOrder(order) ? (
                            <Button
                              type="button"
                              size="xs"
                              className="quant-order-command is-submit"
                              disabled={commandBusy}
                              onClick={() => void handleOrderCommand(order, "submitOrder")}
                            >
                              {submitBusy ? "提交中" : "提交"}
                            </Button>
                          ) : null}
                          {!manualOrder && canCancelOrder(order) ? (
                            <Button
                              type="button"
                              variant="destructive"
                              size="xs"
                              className="quant-order-command is-cancel"
                              disabled={commandBusy}
                              onClick={() => void handleOrderCommand(order, "cancelOrder")}
                            >
                              {cancelBusy ? "撤单中" : "撤单"}
                            </Button>
                          ) : null}
                          {!manualOrder ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="xs"
                              className="quant-order-command is-sync"
                              disabled={commandBusy}
                              onClick={() => void handleOrderCommand(order, "syncOrderStatus")}
                            >
                              {syncBusy ? "同步中" : "同步"}
                            </Button>
                          ) : null}
                        </div>
                      </article>
                    );
                  }) : (
                    <div className="quant-no-orders">
                      <DatasetRoundedIcon fontSize="inherit" />
                      <strong>暂无委托</strong>
                      <span>等待风险门和目标带给出动作。</span>
                    </div>
                  )}
                </div>
              </Card>

              <Card id="quant-account-center" size="sm" className="rail-card quant-account-sync" role="region" aria-label="账户同步" hidden={executionRailTab !== "account"}>
                <div className="quant-section-head">
                  <div>
                    <span>账户</span>
                    <strong>{accountBook.accountCount ? summarizeAccountBook(accountBook) : "账户同步"}</strong>
                  </div>
                  <span className="quant-account-actions">
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      className="quant-rail-control"
                      disabled={!actionableReconcileRows.some((row) => row.status === "extra" || row.status === "drift")}
                      onClick={handleApplyReconcileDiffs}
                    >
                      应用差异
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      className="quant-rail-control"
                      disabled={accountSyncing}
                      onClick={() => void handleSyncAccount()}
                    >
                      {accountSyncing ? "同步中" : "同步"}
                    </Button>
                  </span>
                </div>
                <div className="quant-order-center-summary" aria-label="账户同步摘要">
                  <span>权益 <strong>{formatBookMoney(accountPortfolio.equity, accountPortfolio.baseCurrency, positionPlan.currency)}</strong></span>
                  <span>可用 <strong>{formatBookMoney(accountPortfolio.availableCash, accountPortfolio.baseCurrency, positionPlan.currency)}</strong></span>
                  <span>持仓 <strong>{accountBook.positionCount}</strong></span>
                </div>
                <label className="quant-account-selector">
                  <span>执行账户</span>
                  <select value={executionAccountId} onChange={(event) => setExecutionAccountId(event.target.value)}>
                    <option value="">待选择</option>
                    {activeAccounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {account.currency}</option>)}
                  </select>
                </label>
                {accountBook.accounts.length ? (
                  <div className="quant-account-list" aria-label="已同步账户">
                    {accountBook.accounts.slice(0, 3).map((account) => (
                      <article key={account.key} className={account.accepted ? "is-positive" : "is-negative"}>
                        <div>
                          <strong>{account.accountName}</strong>
                          <span>{account.route || account.bridge}</span>
                        </div>
                        <em>{formatBookMoney(account.equity, account.currency || accountBook.currency, positionPlan.currency)}</em>
                      </article>
                    ))}
                  </div>
                ) : null}
                {accountBook.accountCount ? (
                  <div className={`quant-reconcile-panel is-${accountReconcile.summary.tone}`}>
                    <div className="quant-reconcile-strip" aria-label="持仓对账摘要">
                      <span>匹配 <strong>{accountReconcile.summary.matched}</strong></span>
                      <span>偏差 <strong>{accountReconcile.summary.drift}</strong></span>
                      <span>缺口 <strong>{accountReconcile.summary.missing + accountReconcile.summary.extra}</strong></span>
                    </div>
                    {accountReconcile.rows.some((row) => row.status !== "matched") ? (
                      <div className="quant-reconcile-list" aria-label="持仓差异">
                        {actionableReconcileRows.slice(0, 3).map((row) => (
                          <article key={row.key} className={`is-${row.tone}`}>
                            <div>
                              <strong>{row.symbol}</strong>
                              <span>{row.name}</span>
                            </div>
                            <em>{reconcileStatusLabel(row.status)}</em>
                            <small>{row.summary}</small>
                            <Button
                              type="button"
                              variant="outline"
                              size="xs"
                              className="quant-reconcile-action"
                              onClick={() => handleApplyReconcileRow(row)}
                            >
                              {reconcileActionLabel(row.status)}
                            </Button>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <p>{accountReconcile.summary.headline}</p>
                    )}
                  </div>
                ) : (
                  <p>同步真实账户、持仓、委托和成交回报。</p>
                )}
              </Card>

              <Card id="quant-execution-log" size="sm" className="rail-card quant-log-panel" role="region" aria-label="运行日志" hidden={executionRailTab !== "logs"}>
                <div className="quant-section-head">
                  <div>
                    <span>日志</span>
                    <strong>运行日志</strong>
                  </div>
                  <CandlestickChartRoundedIcon fontSize="inherit" />
                </div>
                {logs.slice(0, 3).map((item) => (
                  <article key={item.key} className={`is-${item.tone}`}>
                    <span>{item.time}</span>
                    <p>{item.text}</p>
                  </article>
                ))}
                {logs.length > 3 ? (
                  <ProgressiveDisclosure className="quant-log-disclosure" label="更早日志" badge={`${logs.length - 3} 条`}>
                    {logs.slice(3).map((item) => (
                      <article key={item.key} className={`is-${item.tone}`}>
                        <span>{item.time}</span>
                        <p>{item.text}</p>
                      </article>
                    ))}
                  </ProgressiveDisclosure>
                ) : null}
              </Card>

          </aside>
        </div>
      )}
      <Dialog
        open={Boolean(activeDialog && report && reportIsCurrent)}
        onOpenChange={(open) => {
          if (!open) setActiveDialog(null);
        }}
      >
        <DialogContent
          className={`quant-dialog is-${activeDialog ?? "strategy"}`}
          mobileMode="sheet"
          showCloseButton
          size="lg"
        >
          <DialogHeader className="quant-dialog-head">
            <div>
              <DialogDescription>{QUANT_DIALOG_META[activeDialog ?? "strategy"].eyebrow}</DialogDescription>
              <DialogTitle>{QUANT_DIALOG_META[activeDialog ?? "strategy"].title}</DialogTitle>
            </div>
          </DialogHeader>

            {activeDialog === "strategy" ? (
              <div className="quant-dialog-stack">
                <div className="quant-qbot-presets" aria-label="Qbot 策略预设">
                  <div className="quant-mini-head">
                    <span>Qbot 预设</span>
                    <strong>{qbotPreset.platform}</strong>
                  </div>
                  <div className="quant-qbot-list">
                    {QBOT_PRESETS.map((item) => (
                      <button
                        key={item.key}
                        type="button"
                        className={item.key === qbotPreset.key ? "is-active" : undefined}
                        onClick={() => handlePresetChange(item)}
                      >
                        <strong>{item.label}</strong>
                        <span>{item.tradeType}</span>
                        <em>{item.strategy}</em>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="quant-qbot-presets quant-scaling-policy-panel" aria-label="仓位递进方法">
                  <div className="quant-mini-head">
                    <span>仓位方法</span>
                    <strong>{activeScalingPolicy.label} · {activeScalingPolicy.riskLabel}</strong>
                  </div>
                  <div className="quant-qbot-list quant-scaling-policy-list">
                    {SCALING_POLICIES.map((policy) => (
                      <button
                        key={policy.key}
                        type="button"
                        className={policy.key === strategyPolicyConfig.scalingPolicyKey ? "is-active" : undefined}
                        onClick={() => handleScalingPolicyChange(policy.key)}
                      >
                        <strong>{policy.label}</strong>
                        <span>{policy.riskLabel}</span>
                        <em>{policy.detail}</em>
                      </button>
                    ))}
                  </div>
                  {activeScalingPolicy.triggerDirection !== "none" ? (
                    <div className="quant-policy-controls" aria-label="仓位方法参数">
                      <label>
                        <span>最多批次</span>
                        <strong>{strategyPolicyConfig.maxTranches}</strong>
                        <input
                          type="range"
                          min="2"
                          max="5"
                          step="1"
                          value={strategyPolicyConfig.maxTranches}
                          onChange={(event) => updateStrategyPolicyConfig({ maxTranches: Number(event.target.value) })}
                        />
                      </label>
                      {activeScalingPolicy.triggerDirection === "down" || activeScalingPolicy.triggerDirection === "up" ? (
                        <label>
                          <span>{activeScalingPolicy.triggerDirection === "down" ? "回撤触发" : "上涨触发"}</span>
                          <strong>{formatNumber(strategyPolicyConfig.triggerPct, 1)}%</strong>
                          <input
                            type="range"
                            min="0.5"
                            max="10"
                            step="0.5"
                            value={strategyPolicyConfig.triggerPct}
                            onChange={(event) => updateStrategyPolicyConfig({ triggerPct: Number(event.target.value) })}
                          />
                        </label>
                      ) : null}
                      <label>
                        <span>冷却时间</span>
                        <strong>{strategyPolicyConfig.cooldownDays} 天</strong>
                        <input
                          type="range"
                          min="0"
                          max="10"
                          step="1"
                          value={strategyPolicyConfig.cooldownDays}
                          onChange={(event) => updateStrategyPolicyConfig({ cooldownDays: Number(event.target.value) })}
                        />
                      </label>
                    </div>
                  ) : null}
                </div>

                <ScalingReplayPanel
                  comparison={scalingReplay}
                  activePolicyKey={strategyPolicyConfig.scalingPolicyKey}
                />

                <div className="quant-parameter-grid" aria-label="情景试算参数">
                  <Param label="标的池" value={report?.profileKey ?? "—"} />
                  <Param label="仓位方法" value={activeScalingPolicy.label} />
                  <Param label="周期" value="1D" />
                  <Param label="成交" value="次日收盘" />
                  <Param label="费用" value="10 bps" />
                  <Param label="滑点" value="20 bps" />
                  <Param label="单标上限" value={`${formatNumber(positionPlan.policy.singleAssetCap, 0)}%`} />
                </div>
              </div>
            ) : null}

            {activeDialog === "bridge" ? (
              <div className="quant-dialog-stack">
                <div className="quant-execution-mode-options" role="tablist" aria-label="执行方式" onKeyDown={handleTabListKeyDown}>
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
                <div className="quant-broker-options" role="tablist" aria-label="执行通道" onKeyDown={handleTabListKeyDown}>
                  {BROKER_OPTIONS.map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      role="tab"
                      aria-selected={brokerMode === item.key}
                      tabIndex={brokerMode === item.key ? 0 : -1}
                      className={brokerMode === item.key ? "is-active" : undefined}
                      disabled={!recommendationReadiness.autoExecutionAllowed}
                      title={!recommendationReadiness.autoExecutionAllowed ? `${recommendationReadiness.validationLabel}：通道自动暂不可用` : item.detail}
                      onClick={() => handleBrokerChange(item.key)}
                    >
                      <strong>{item.label}</strong>
                      <span>{item.detail}</span>
                    </button>
                  ))}
                </div>
                <div className="quant-router-meta">
                  <Param label="方式" value={executionLabel} tone={executionTone} />
                  <Param label="类型" value={executionMode === "manual" ? "人工" : executionMode === "simulation" ? "实验" : brokerMode === "live-gateway" ? "实盘" : "虚拟盘"} tone={executionMode === "manual" ? "caution" : executionMode === "simulation" ? paperSimSummary.tone : brokerMode === "live-gateway" ? "caution" : "positive"} />
                  <Param label="平台" value={qbotPreset.platform} />
                  <Param label="品种" value={qbotPreset.tradeType} />
                </div>
                {executionMode === "manual" ? (
                  <article className="quant-manual-mode-card">
                    <strong>手动交易</strong>
                    <span>系统只生成下单票、执行风控和保留审计；你在外部交易平台完成下单后，再回到订单中心标记状态。</span>
                  </article>
                ) : null}
                {executionMode === "simulation" ? (
                  <article className="quant-manual-mode-card">
                    <strong>自动模拟</strong>
                    <span>系统使用独立虚拟账户执行 Profile 建议、记录成交和每日净值，不触达真实通道。</span>
                  </article>
                ) : null}
                <AdapterPlanCard plan={activeAdapterPlan} />
                <div className="quant-bridge-status-list">
                  <div className="quant-mini-head">
                    <span>本机桥接</span>
                    <button type="button" onClick={refreshBridgeStatus}>{bridgeLoading ? "探测中" : "重新探测"}</button>
                  </div>
                  {bridgeError ? <p className="quant-dialog-error">{bridgeError}</p> : null}
                  {bridgeStatuses.map((item) => <BridgeStatusCard key={item.bridge} status={item} />)}
                </div>
              </div>
            ) : null}

            {activeDialog === "backtest" ? (
              <div className="quant-dialog-stack quant-backtest-dialog">
                {lastRun ? (
                  <>
                    <article className={`quant-backtest-summary is-${lastRun.tone}`}>
                      <span>当前情景结果</span>
                      <strong>{lastRun.summary}</strong>
                      <p>{lastRun.methodology}</p>
                    </article>
                    <div className="quant-parameter-grid" aria-label="情景试算结果">
                      <Param label="净收益" value={formatPercent(lastRun.pnlPct)} tone={lastRun.tone} />
                      <Param label="最大回撤" value={formatPercent(lastRun.maxDrawdownPct)} tone={lastRun.maxDrawdownPct <= -18 ? "negative" : "caution"} />
                      <Param label="胜率" value={formatPercent(lastRun.winRatePct)} />
                      <Param label="Sharpe" value={formatNumber(lastRun.sharpe, 2)} />
                      <Param label="模拟委托" value={`${lastRun.simulatedOrders.length} 单`} />
                      <Param label="换手" value={formatPercent(lastRun.turnoverPct)} />
                    </div>
                    {lastRun.simulatedOrders.length ? (
                      <div className="quant-backtest-orders" aria-label="模拟委托明细">
                        {lastRun.simulatedOrders.map((order) => (
                          <article key={order.key} className={order.blocked ? "is-negative" : "is-neutral"}>
                            <strong>{order.symbol}</strong>
                            <span>{sideLabel(order.side)} · {formatMoney(order.notional, positionPlan.currency)}</span>
                            <em>{order.blocked ? "已阻断" : `净贡献 ${formatPercent(order.netPnlPct)}`}</em>
                          </article>
                        ))}
                      </div>
                    ) : null}
                  </>
                ) : (
                  <div className="quant-dialog-empty">
                    <strong>暂无试算结果</strong>
                    <span>请先生成可建票建议后重新运行试算。</span>
                  </div>
                )}
              </div>
            ) : null}

            {activeDialog === "risk" ? (
              <div className="quant-dialog-stack">
                <section className="quant-risk-switchboard">
                  <div className="quant-risk-summary-grid" aria-label="当前风控摘要">
                    <RiskRule label="现金底线" value={`${formatNumber(positionPlan.policy.minCashWeight, 0)}%`} tone={positionPlan.hasCashInstrument ? "positive" : "caution"} />
                    <RiskRule label="单标上限" value={`${formatNumber(positionPlan.policy.singleAssetCap, 0)}%`} tone="positive" />
                    <RiskRule label="单日委托" value={`${riskPolicy.maxDailyOrders} 单`} tone="positive" />
                    <RiskRule label="冷却时间" value={`${riskPolicy.cooldownMinutes} 分钟`} tone={riskPolicy.cooldownMinutes ? "positive" : "neutral"} />
                    <RiskRule label="风险门" value={activeGate?.blocked ? "阻断" : activeGate?.watch ? "观察" : "通过"} tone={activeGate?.tone ?? "neutral"} />
                  </div>
                  <div className="quant-parameter-grid" aria-label="风控参数">
                    <RiskNumberInput
                      label="ETF 单笔"
                      max={20}
                      min={0.5}
                      step={0.5}
                      suffix="%"
                      value={riskPolicy.singleOrderCaps.etfPct}
                      onChange={(value) => updateRiskPolicyCap("etfPct", value)}
                    />
                    <RiskNumberInput
                      label="基金单笔"
                      max={20}
                      min={0.5}
                      step={0.5}
                      suffix="%"
                      value={riskPolicy.singleOrderCaps.fundPct}
                      onChange={(value) => updateRiskPolicyCap("fundPct", value)}
                    />
                    <RiskNumberInput
                      label="杠杆 ETF"
                      max={10}
                      min={0.5}
                      step={0.5}
                      suffix="%"
                      value={riskPolicy.singleOrderCaps.leveragedEtfPct}
                      onChange={(value) => updateRiskPolicyCap("leveragedEtfPct", value)}
                    />
                    <RiskNumberInput
                      label="股票单笔"
                      max={20}
                      min={0.5}
                      step={0.5}
                      suffix="%"
                      value={riskPolicy.singleOrderCaps.stockPct}
                      onChange={(value) => updateRiskPolicyCap("stockPct", value)}
                    />
                    <RiskNumberInput
                      label="单日委托"
                      max={50}
                      min={0}
                      step={1}
                      suffix="单"
                      value={riskPolicy.maxDailyOrders}
                      onChange={(value) => updateRiskPolicyNumber("maxDailyOrders", value)}
                    />
                    <RiskNumberInput
                      label="冷却"
                      max={240}
                      min={0}
                      step={5}
                      suffix="分钟"
                      value={riskPolicy.cooldownMinutes}
                      onChange={(value) => updateRiskPolicyNumber("cooldownMinutes", value)}
                    />
                    <RiskNumberInput
                      label="ETF 提醒"
                      max={20}
                      min={0}
                      step={0.5}
                      suffix="%"
                      value={riskPolicy.lossBrake.etfDailyDropWarnPct}
                      onChange={(value) => updateRiskPolicyLoss("etfDailyDropWarnPct", value)}
                    />
                    <RiskNumberInput
                      label="ETF 阻断"
                      max={30}
                      min={0}
                      step={0.5}
                      suffix="%"
                      value={riskPolicy.lossBrake.etfDailyDropBlockPct}
                      onChange={(value) => updateRiskPolicyLoss("etfDailyDropBlockPct", value)}
                    />
                  </div>
                  <button
                    type="button"
                    aria-pressed={riskOverride}
                    className={`quant-override-button ${riskOverride ? "is-active" : ""}`}
                    onClick={() => {
                      setRiskOverride((current) => !current);
                      pushLog("caution", `手动放行${riskOverride ? "关闭" : "开启"} · 手动路由会覆盖策略阻断`);
                    }}
                  >
                    手动放行
                    <strong>{riskOverride ? "开启" : "关闭"}</strong>
                  </button>
                  <button
                    type="button"
                    aria-pressed={riskPolicy.requireLiveConfirmation}
                    className={`quant-override-button ${riskPolicy.requireLiveConfirmation ? "is-active" : ""}`}
                    onClick={() => {
                      setRiskPolicy((current) => normalizeRiskGuardPolicy({
                        ...current,
                        requireLiveConfirmation: !current.requireLiveConfirmation,
                        updatedAt: new Date().toISOString(),
                      }));
                    }}
                  >
                    实盘二次确认
                    <strong>{riskPolicy.requireLiveConfirmation ? "开启" : "关闭"}</strong>
                  </button>
                  {riskPolicyState.error ? <p className="quant-dialog-error">{riskPolicyState.error}</p> : null}
                </section>
              </div>
            ) : null}

            {activeDialog === "replacement" && primaryReplacementPlan ? (
              <div className="quant-dialog-stack">
                <article className={`quant-replacement-summary is-${primaryReplacementPlan.executable ? "positive" : "caution"}`}>
                  <span>{primaryReplacementPlan.label}</span>
                  <strong>{primaryReplacementPlan.sourceSymbol} → {primaryReplacementPlan.targetSymbol}</strong>
                  <p>{primaryReplacementPlan.summary}</p>
                </article>

                <div className="quant-parameter-grid" aria-label="替换金额">
                  <Param label="预计赎回" value={formatMoney(primaryReplacementPlan.sellAmount, positionPlan.currency)} tone="caution" />
                  <Param
                    label="预计赎回费"
                    value={primaryReplacementPlan.estimatedRedemptionFee == null
                      ? "待核对"
                      : formatMoney(primaryReplacementPlan.estimatedRedemptionFee, positionPlan.currency)}
                    tone={primaryReplacementPlan.estimatedRedemptionFee == null ? "caution" : "neutral"}
                  />
                  <Param label="预计申购" value={formatMoney(primaryReplacementPlan.buyAmount, positionPlan.currency)} tone="positive" />
                  <Param label="申购批次" value={primaryReplacementPlan.batches ? `${primaryReplacementPlan.batches} 批` : "—"} />
                </div>

                <section className="quant-replacement-sequence" aria-label="关联模拟顺序">
                  <article>
                    <em>1</em>
                    <div><strong>提交赎回模拟</strong><span>只创建 {primaryReplacementPlan.sourceSymbol} 的赎回委托。</span></div>
                  </article>
                  <article>
                    <em>2</em>
                    <div><strong>等待净值确认与资金到账</strong><span>到账前不会预先创建目标基金申购。</span></div>
                  </article>
                  <article>
                    <em>3</em>
                    <div><strong>按限购分批申购</strong><span>每个交易日重新核对 {primaryReplacementPlan.targetSymbol} 的申购状态和限额。</span></div>
                  </article>
                </section>

                {primaryReplacementPlan.warnings.length ? (
                  <article className="quant-replacement-warning">
                    <strong>当前不能直接执行</strong>
                    <span>{primaryReplacementPlan.warnings.join("；")}</span>
                  </article>
                ) : null}

                <article className="quant-manual-mode-card">
                  <strong>仅进入模拟账本</strong>
                  <span>不会连接券商或生成真实交易；申购暂停、限购变化或数据过期时，链路会停止并保留现金。</span>
                </article>

                <div className="quant-replacement-actions">
                  <button
                    type="button"
                    className="is-primary"
                    disabled={!report
                      || !primaryReplacementPlan.executable
                      || primaryReplacementPlan.action !== "replace"
                      || paperSim.lastRunDate === report.asOf}
                    title={report && paperSim.lastRunDate === report.asOf
                      ? `${report.asOf} 模拟账户已经结算，请在下一交易日刷新后启动。`
                      : primaryReplacementPlan.executable
                        ? "创建关联基金替换模拟"
                        : primaryReplacementPlan.summary}
                    onClick={handleStartReplacementSimulation}
                  >
                    创建关联模拟
                  </button>
                  <button type="button" onClick={() => setActiveDialog(null)}>取消</button>
                </div>
              </div>
            ) : null}
        </DialogContent>
      </Dialog>
    </section>
  );
}

function ScalingReplayPanel({
  activePolicyKey,
  comparison,
}: {
  activePolicyKey: ScalingPolicyKey;
  comparison: ScalingReplayComparison;
}) {
  return (
    <section className="quant-scaling-replay" aria-label="仓位方法历史回放对照">
      <header>
        <div>
          <span>历史回放对照</span>
          <strong>{comparison.horizonDays} 日 · 基准路径代理</strong>
        </div>
        <em className={`is-${comparison.evidence}`}>n={comparison.sampleCount} · {comparison.evidenceLabel}</em>
      </header>
      {comparison.sampleCount ? (
        <>
          <div className="quant-scaling-replay-head" aria-hidden="true">
            <span>方法</span>
            <span>净收益中位</span>
            <span>回撤中位</span>
            <span>尾部均值</span>
            <span>资金占用</span>
          </div>
          <div className="quant-scaling-replay-list">
            {comparison.metrics.map((metric) => (
              <article
                key={metric.policyKey}
                className={metric.policyKey === activePolicyKey ? "is-active" : undefined}
              >
                <div>
                  <strong>{metric.label}</strong>
                  <small>{metric.averageTranches} 批</small>
                </div>
                <span className={replayTone(metric.medianNetReturnPct)}>{formatReplayMetric(metric.medianNetReturnPct)}</span>
                <span className="is-negative">{formatReplayMetric(metric.medianMaxDrawdownPct)}</span>
                <span className="is-negative">{formatReplayMetric(metric.tailAverageReturnPct)}</span>
                <span>{formatNumber(metric.averageCapitalUtilizationPct, 0)}%</span>
                {comparison.winnerKey === metric.policyKey ? <b>稳健领先</b> : null}
              </article>
            ))}
          </div>
        </>
      ) : (
        <div className="quant-scaling-replay-empty">
          当前报告没有可回放的历史路径；刷新市场数据后再比较，系统不会用均值伪造回放。
        </div>
      )}
      <p>{comparison.methodology}</p>
    </section>
  );
}

function formatReplayMetric(value: number) {
  return `${value > 0 ? "+" : ""}${formatNumber(value, 2)}%`;
}

function replayTone(value: number) {
  return value > 0 ? "is-positive" : value < 0 ? "is-negative" : undefined;
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

function PaperSimulationCard({
  onPause,
  onRun,
  paperSim,
  summary,
}: {
  onPause: () => void;
  onRun: () => void;
  paperSim: PaperSimState;
  summary: PaperSimSummary;
}) {
  const latestTrade = paperSim.trades[0];
  const latestPendingFundOrder = paperSim.pendingFundOrders[0];
  const latestSnapshot = paperSim.snapshots[0];
  const tradePerformance = paperTradePerformanceFor(paperSim);
  const tradePerformanceGroups = paperTradePerformanceGroupsFor(paperSim);
  const tradeAttribution = paperTradeAttributionFor(paperSim);
  const strategyExperiment = paperStrategyExperimentFor(paperSim);
  const replacementCost = paperReplacementCostFor(paperSim);
  return (
    <Card size="sm" className={`rail-card quant-paper-sim-card is-${summary.tone}`} role="region" aria-label="自动模拟交易">
      <div className="quant-section-head">
        <div>
          <span>自动模拟</span>
          <strong>{summary.statusLabel}</strong>
        </div>
        <span className="quant-account-actions">
          {summary.active ? (
            <Button
              type="button"
              variant="outline"
              size="xs"
              className="quant-rail-control"
              onClick={onPause}
            >
              暂停
            </Button>
          ) : null}
          <Button
            type="button"
            size="xs"
            className="quant-rail-control"
            onClick={onRun}
          >
            {paperSimRunButtonLabel(summary)}
          </Button>
        </span>
      </div>
      <div className="quant-paper-sim-headline">
        <strong>{summary.headline}</strong>
        <span>{summary.active ? paperSim.experimentName : "按当前 Profile 和规则建立虚拟账户。"}</span>
      </div>
      <div className="quant-order-center-summary" aria-label="模拟账户摘要">
        <span>权益 <strong>{paperSimMetricLabel(summary.equity, paperSim.currency)}</strong></span>
        <span>现金 <strong>{paperSimMetricLabel(summary.cash, paperSim.currency)}</strong></span>
        <span>持仓 <strong>{summary.positionCount}</strong></span>
      </div>
      <div className="quant-paper-sim-strip" aria-label="模拟表现">
        <span>收益 <strong>{formatPercent(summary.pnlPct)}</strong></span>
        <span>回撤 <strong>{formatPercent(summary.maxDrawdownPct)}</strong></span>
        <span>成交 <strong>{summary.tradeCount}</strong></span>
        <span>待确认 <strong>{summary.pendingFundOrderCount}</strong></span>
      </div>
      <div className={`quant-paper-evidence-strip is-${tradePerformance.tone}`}>
        <span>{tradePerformance.ready ? "交易质量" : "已平仓样本"}</span>
        <strong>{tradePerformance.ready ? tradePerformance.verdict : `${tradePerformance.sampleCount}/${tradePerformance.requiredSamples}`}</strong>
        <small>{tradePerformance.ready ? tradePerformance.confidenceLabel : "满 10 笔后输出胜率与盈亏比"}</small>
      </div>
      <ProgressiveDisclosure label="指标、归因与规则" badge={`${summary.tradeCount} 笔`}>
        <div className="quant-paper-detail-stack">
        {latestSnapshot ? (
        <section className="quant-paper-performance" aria-label="基准与费用评估">
          <span>策略<strong>{formatPercent(summary.pnlPct)}</strong></span>
          <span title={summary.benchmarkSymbol || "未配置基准"}>
            基准<strong>{summary.benchmarkAvailable ? formatPercent(summary.benchmarkReturnPct) : "—"}</strong>
          </span>
          <span>超额<strong className={summary.excessReturnPct >= 0 ? "is-positive" : "is-negative"}>{summary.benchmarkAvailable ? formatPercent(summary.excessReturnPct) : "—"}</strong></span>
          <span title={`累计费用 ${formatMoney(summary.cumulativeFees, paperSim.currency)}`}>费用拖累<strong className="is-negative">{formatPercent(summary.feeDragPct)}</strong></span>
        </section>
      ) : null}
      <section className={`quant-paper-trade-performance is-${tradePerformance.tone}`} aria-label="已实现交易质量">
        <header>
          <span>{tradePerformance.ready ? "交易质量" : "已平仓样本"}</span>
          <strong>
            {tradePerformance.ready
              ? `${tradePerformance.verdict} · ${tradePerformance.confidenceLabel}`
              : `${tradePerformance.sampleCount}/${tradePerformance.requiredSamples}`}
          </strong>
        </header>
        {tradePerformance.ready ? (
          <div className="quant-paper-trade-metrics">
            <span>胜率<strong>{tradePerformance.winRatePct === null ? "—" : formatPercent(tradePerformance.winRatePct)}</strong></span>
            <span>盈亏比<strong>{tradePerformance.payoffRatio === null ? "—" : `${formatNumber(tradePerformance.payoffRatio, 2)} : 1`}</strong></span>
            <span>单回合期望<strong>{tradePerformance.expectancy === null ? "—" : formatSignedMoney(tradePerformance.expectancy, paperSim.currency)}</strong></span>
            <span>平均持有<strong>{tradePerformance.averageHoldingDays === null ? "—" : `${formatNumber(tradePerformance.averageHoldingDays, 1)} 天`}</strong></span>
          </div>
        ) : (
          <div className="quant-paper-trade-progress" aria-hidden="true">
            <span style={{ width: `${Math.min(100, (tradePerformance.sampleCount / tradePerformance.requiredSamples) * 100)}%` }} />
          </div>
        )}
        <p>{tradePerformance.detail}</p>
        {tradePerformance.ready && tradePerformance.nextConfidenceSample ? (
          <small className="quant-paper-confidence">
            再积累 {tradePerformance.nextConfidenceSample - tradePerformance.sampleCount} 笔，提升为
            {tradePerformance.nextConfidenceSample >= 60 ? "较稳定" : "可参考"}结论
          </small>
        ) : null}
        {tradePerformanceGroups.length ? (
          <div className="quant-paper-trade-groups" aria-label="按 Profile 和策略分组">
            {tradePerformanceGroups.slice(0, 3).map((group) => (
              <span key={group.key} title={`${group.profileName} · ${group.strategyName}`}>
                <em>{group.profileName} · {group.strategyName}</em>
                <strong>
                  {group.ready
                    ? `${group.winRatePct === null ? "—" : formatPercent(group.winRatePct)} / ${group.payoffRatio === null ? "—" : `${formatNumber(group.payoffRatio, 2)}:1`}`
                    : `${group.sampleCount}/${group.requiredSamples}`}
                </strong>
              </span>
            ))}
          </div>
        ) : null}
      </section>
      {replacementCost.tradeCount ? (
        <section className="quant-paper-exit-attribution is-neutral" aria-label="基金替换执行成本">
          <header>
            <span>基金替换成本</span>
            <strong>{replacementCost.completedWorkflowCount}/{replacementCost.workflowCount} 条已闭环</strong>
          </header>
          <div>
            <span>费用<strong>{formatMoney(replacementCost.fees, paperSim.currency)}</strong></span>
            <span>滑点<strong>{formatMoney(replacementCost.slippage, paperSim.currency)}</strong></span>
            <span>总摩擦<strong>{formatMoney(replacementCost.totalCost, paperSim.currency)}</strong></span>
          </div>
          <p>占关联成交额 {formatPercent(replacementCost.costPct)}；只统计已发生费用与模拟滑点，不把等待期机会成本伪装成确定损失。</p>
        </section>
      ) : null}
      {tradeAttribution.sampleCount ? (
        <section className={`quant-paper-exit-attribution is-${tradeAttribution.tone}`} aria-label="交易结果归因">
          <header>
            <span>交易归因</span>
            <strong>{tradeAttribution.primaryDriver}</strong>
          </header>
          <div>
            <span>持有结果<strong>{formatSignedMoney(tradeAttribution.holdingPnl, paperSim.currency)}</strong></span>
            <span>退出滑点<strong>{formatSignedMoney(tradeAttribution.slippageDrag, paperSim.currency)}</strong></span>
            <span>交易费用<strong>{formatSignedMoney(tradeAttribution.feeDrag, paperSim.currency)}</strong></span>
          </div>
          <p>{tradeAttribution.recommendation}</p>
          {tradeAttribution.latest?.decisionDetail ? (
            <small title={tradeAttribution.latest.decisionDetail}>
              最近 {tradeAttribution.latest.symbol} · {tradeAttribution.latest.decisionDetail}
            </small>
          ) : null}
        </section>
      ) : null}
      {strategyExperiment.baseline.tradeCount ? (
        <section className={`quant-paper-experiment is-${strategyExperiment.tone}`} aria-label="策略参数 A/B 回放">
          <header>
            <span>A/B 参数回放</span>
            <strong>{strategyExperiment.verdict}</strong>
          </header>
          {strategyExperiment.ready ? (
            <div>
              <article>
                <span>A · 当前参数</span>
                <strong>{formatSignedMoney(strategyExperiment.baseline.netPnl, paperSim.currency)}</strong>
                <small>最大单笔 {formatSignedMoney(strategyExperiment.baseline.worstTradePnl, paperSim.currency)}</small>
              </article>
              <article className={strategyExperiment.preferred === "B" ? "is-preferred" : ""}>
                <span>B · {strategyExperiment.variantLabel}</span>
                <strong>{formatSignedMoney(strategyExperiment.candidate.netPnl, paperSim.currency)}</strong>
                <small>最大单笔 {formatSignedMoney(strategyExperiment.candidate.worstTradePnl, paperSim.currency)}</small>
              </article>
            </div>
          ) : null}
          <p>{strategyExperiment.ready ? strategyExperiment.changeSummary : strategyExperiment.verdict}</p>
          {strategyExperiment.ready ? <small>{strategyExperiment.assumption} 仅用于反事实比较，不代表未来收益。</small> : null}
        </section>
      ) : null}
      {latestSnapshot ? (
        <section className="quant-paper-attribution" aria-label="当日收益归因">
          <header>
            <span>当日归因</span>
            <strong className={latestSnapshot.dailyPnl >= 0 ? "is-positive" : "is-negative"}>
              {formatSignedMoney(latestSnapshot.dailyPnl, paperSim.currency)} · {formatPercent(latestSnapshot.dailyPnlPct)}
            </strong>
          </header>
          <div>
            <span>持仓估值<strong>{formatSignedMoney(latestSnapshot.marketPnl, paperSim.currency)}</strong></span>
            <span>交易价差<strong>{formatSignedMoney(latestSnapshot.executionPnl, paperSim.currency)}</strong></span>
            <span>费用<strong>{formatSignedMoney(latestSnapshot.feePnl, paperSim.currency)}</strong></span>
            <span>现金/差异<strong>{formatSignedMoney(latestSnapshot.otherPnl, paperSim.currency)}</strong></span>
          </div>
        </section>
      ) : null}
      {latestSnapshot ? (
        <p>{latestSnapshot.runDate} · {latestSnapshot.summary}</p>
      ) : (
        <p>启动后会按交易日记录净值、现金、成交和回撤。</p>
      )}
      <p className="quant-paper-sim-policy">A 股默认：官方交易日、T+1、申报手数、涨跌停校验；场外基金分开处理净值确认、赎回到账和限购分批。</p>
      {latestTrade ? (
        <article className="quant-paper-sim-latest">
          <div>
            <strong>{latestTrade.symbol}</strong>
            <span title={latestTrade.ruleNote}>{latestTrade.side === "BUY" ? "买入" : "卖出"} · {latestTrade.ruleLabel}</span>
          </div>
          <em>{formatNumber(latestTrade.quantity, latestTrade.quantity >= 100 ? 0 : 4)} @ {formatNumber(latestTrade.price, 2)} · 费 {formatMoney(latestTrade.fee, paperSim.currency)}</em>
        </article>
      ) : null}
        </div>
      </ProgressiveDisclosure>
      {latestPendingFundOrder ? (
        <article className="quant-paper-sim-latest is-pending">
          <div>
            <strong>{latestPendingFundOrder.symbol}</strong>
            <span>{latestPendingFundOrder.side === "BUY" ? "申购" : "赎回"} · {paperFundOrderStatusLabel(latestPendingFundOrder)}</span>
          </div>
          <em>{paperFundOrderNextDate(latestPendingFundOrder)}</em>
        </article>
      ) : null}
    </Card>
  );
}

function formatSignedMoney(value: number, currency: string) {
  const formatted = formatMoney(Math.abs(value), currency);
  if (Math.abs(value) < 0.005) return formatted;
  return `${value > 0 ? "+" : "−"}${formatted}`;
}

function Param({ label, tone = "neutral", value }: { label: string; tone?: LabTone; value: string }) {
  return (
    <article className={`quant-param is-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function RiskRule({ label, tone, value }: { label: string; tone: LabTone | PositionPlanTone; value: string }) {
  return (
    <article className={`quant-risk-rule is-${normalizePlanTone(tone)}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function RiskNumberInput({
  label,
  max,
  min,
  onChange,
  step,
  suffix,
  value,
}: {
  label: string;
  max: number;
  min: number;
  onChange: (value: number) => void;
  step: number;
  suffix: string;
  value: number;
}) {
  return (
    <label className="quant-param">
      <span>{label}</span>
      <strong>{formatNumber(value, step >= 1 ? 0 : 1)}{suffix}</strong>
      <input
        max={max}
        min={min}
        step={step}
        type="number"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

function BridgeStatusCard({ status }: { status: BrokerBridgeStatus }) {
  const tone: LabTone = status.commandAvailable ? "positive" : status.pathExists ? "caution" : "negative";
  return (
    <article className={`quant-bridge-status is-${tone}`}>
      <div>
        <span>{status.label}</span>
        <strong>{status.commandAvailable ? "就绪" : "未就绪"}</strong>
      </div>
      <p>{status.summary}</p>
      <code>{status.path}</code>
      <div className="quant-bridge-flags">
        <em>路径 {status.pathExists ? "正常" : "缺失"}</em>
        <em>适配器 {status.adapterExists ? "正常" : "缺失"}</em>
        <em>Python {status.pythonOk ? "正常" : "缺失"}</em>
      </div>
      {status.warnings.length ? <p>{status.warnings[0]}</p> : null}
    </article>
  );
}

function AdapterPlanCard({ plan }: { plan: BrokerAdapterPlan }) {
  const tone: LabTone = plan.ready ? "positive" : plan.pathReady ? "caution" : "negative";
  return (
    <article className={`quant-adapter-plan is-${tone}`}>
      <div className="quant-adapter-plan-head">
        <div>
          <span>当前通道</span>
          <strong>{plan.label}</strong>
          <p>{plan.summary}</p>
        </div>
        <em>{plan.statusLabel}</em>
      </div>
      <div className="quant-adapter-capabilities">
        {plan.capabilities.map((item) => (
          <span key={item.key} className={item.ready ? "is-ready" : undefined}>
            <strong>{item.label}</strong>
            <em>{item.detail}</em>
          </span>
        ))}
      </div>
      {plan.nextActions.length ? (
        <div className="quant-adapter-next">
          <span>下一步</span>
          <strong>{plan.nextActions[0]}</strong>
        </div>
      ) : null}
    </article>
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

function formatBookMoney(value: number, currency: string, fallbackCurrency: string) {
  if (!Number.isFinite(value) || value <= 0) return "—";
  if (currency === "MIXED") return "多币种";
  return formatMoney(value, currency || fallbackCurrency);
}

function reconcileStatusLabel(status: PortfolioReconcileStatus) {
  if (status === "matched") return "匹配";
  if (status === "drift") return "偏差";
  if (status === "missing") return "账户缺失";
  return "本地缺失";
}

function reconcileActionLabel(status: PortfolioReconcileStatus) {
  if (status === "extra") return "加入";
  if (status === "drift") return "更新";
  if (status === "missing") return "设观察";
  return "已匹配";
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

function isManualExecutionOrder(order: OrderRecord) {
  return order.broker === MANUAL_BROKER_MODE || order.route === "手动交易" || order.routeStatus.startsWith("manual_");
}

function manualOrderCanAdvance(order: OrderRecord) {
  return isManualExecutionOrder(order) && (order.status === "queued" || order.status === "prepared" || order.status === "submitted" || order.status === "partially_filled");
}

function manualOrderActionLabel(order: OrderRecord) {
  return order.status === "submitted" || order.status === "partially_filled" ? "已成交" : "已下单";
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

function canSubmitOrder(order: OrderRecord) {
  if (isManualExecutionOrder(order)) return false;
  return order.status === "queued" || order.status === "prepared";
}

function canCancelOrder(order: OrderRecord) {
  if (isManualExecutionOrder(order)) return false;
  return order.status === "queued" || order.status === "prepared" || order.status === "submitted" || order.status === "partially_filled";
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
