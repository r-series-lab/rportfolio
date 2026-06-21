import AutoGraphRoundedIcon from "@mui/icons-material/AutoGraphRounded";
import BiotechRoundedIcon from "@mui/icons-material/BiotechRounded";
import CandlestickChartRoundedIcon from "@mui/icons-material/CandlestickChartRounded";
import DatasetRoundedIcon from "@mui/icons-material/DatasetRounded";
import PauseCircleRoundedIcon from "@mui/icons-material/PauseCircleRounded";
import PlayArrowRoundedIcon from "@mui/icons-material/PlayArrowRounded";
import ReceiptLongRoundedIcon from "@mui/icons-material/ReceiptLongRounded";
import ShieldRoundedIcon from "@mui/icons-material/ShieldRounded";
import SpeedRoundedIcon from "@mui/icons-material/SpeedRounded";
import TuneRoundedIcon from "@mui/icons-material/TuneRounded";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
  probeBrokerBridge,
  type BrokerAccountSnapshot,
  type BrokerBridgeStatus,
  type MarketQuoteSnapshot,
  type OrderCommandAction,
} from "../lib/broker-bridge";
import { runBacktestEngine, type BacktestRunResult } from "../lib/backtest-engine";
import type { HoldingRecord } from "../lib/holdings";
import {
  accountBookFromSnapshots,
  mergeAccountSnapshot,
  reconcileAccountBookWithHoldings,
  summarizeAccountBook,
  type PortfolioReconcileStatus,
} from "../lib/account-book";
import {
  applyOrderCommandResult,
  applyOrderRouteResult,
  applyBrokerAccountSnapshotToOrders,
  applyPreSubmitGuardResult,
  brokerRouteLabel,
  createOrderRecordFromIntent,
  mergeOrderRecords,
  normalizeOrderRecords,
  orderCommandErrorResult,
  orderLatestEvent,
  orderSourceLabel,
  orderStatusLabel,
  routeOrderErrorResult,
  summarizeOrderCenter,
  type OrderRecord,
  type OrderSourceKind,
} from "../lib/order-store";
import { isCashHolding, type PositionPlan, type PositionPlanTone } from "../lib/position-plan";
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
import type {
  AssetStatus,
  MarketAnalysisReport,
  TechnicalRow,
} from "../lib/types";
import { formatMoney, formatNumber, formatPercent } from "../lib/utils";
import { useMonitorStore } from "../hooks/use-monitor-store";
import { useOrderStore } from "../hooks/use-order-store";
import { useRiskPolicy } from "../hooks/use-risk-policy";
import { exportOrderAudit, type OrderAuditExportFormat } from "../lib/order-persistence";
import { normalizeRiskGuardPolicy } from "../lib/risk-policy";
import { Button } from "./ui/button";
import { Card } from "./ui/card";

type QuantLabWorkspaceProps = {
  holdings: HoldingRecord[];
  loading: boolean;
  onOpenAnalysis: () => void;
  onRefresh: () => void;
  positionPlan: PositionPlan;
  report: MarketAnalysisReport | null;
  reportIsCurrent: boolean;
  rightRailCollapsed: boolean;
  trades: TradeRecord[];
};

type EngineMode = "backtest" | "paper";
type QuantDialogKey = "strategy" | "bridge" | "risk" | "signals" | null;

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
};

type BrokerOption = {
  key: BrokerMode;
  label: string;
  detail: string;
};

type ManualOrderDraft = OrderIntent & {
  limit: string;
  quantity: string;
};

const PROFILE_MONITOR_INTERVAL_MS = 60_000;
const PROFILE_MONITOR_INTERVAL_LABEL = "60 秒";

const BROKER_OPTIONS: BrokerOption[] = [
  { key: "local-paper", label: "本地模拟", detail: "本地撮合" },
  { key: "qbot-bridge", label: "Qbot 桥接", detail: "Qbot 参数" },
  { key: "live-gateway", label: "vn.py 通道", detail: "券商适配器" },
];

export function QuantLabWorkspace({
  holdings,
  loading,
  onOpenAnalysis,
  onRefresh,
  positionPlan,
  report,
  reportIsCurrent,
  rightRailCollapsed,
  trades,
}: QuantLabWorkspaceProps) {
  const onRefreshRef = useRef(onRefresh);
  const monitorRoutingKeyRef = useRef("");
  const [activeStrategyKey, setActiveStrategyKey] = useState<StrategyKey>("risk-gated-trend");
  const [engineMode, setEngineMode] = useState<EngineMode>("paper");
  const [brokerMode, setBrokerMode] = useState<BrokerMode>("local-paper");
  const [budgetWeight, setBudgetWeight] = useState(3);
  const [eventLogs, setEventLogs] = useState<LabLog[]>([]);
  const [activeDialog, setActiveDialog] = useState<QuantDialogKey>(null);
  const [bridgeError, setBridgeError] = useState("");
  const [bridgeLoading, setBridgeLoading] = useState(false);
  const [bridgeStatuses, setBridgeStatuses] = useState<BrokerBridgeStatus[]>([]);
  const [lastRun, setLastRun] = useState<BacktestRunResult | null>(null);
  const [qbotPresetKey, setQbotPresetKey] = useState<QbotPresetKey>("rsi-single-factor");
  const [queuedOrders, setQueuedOrders, orderStoreState] = useOrderStore();
  const [monitorStore, , monitorStoreState, commitMonitorEvaluation] = useMonitorStore();
  const [riskPolicy, setRiskPolicy, riskPolicyState] = useRiskPolicy();
  const [monitorEnabled, setMonitorEnabled] = useState(false);
  const [monitorLastRun, setMonitorLastRun] = useState("");
  const [monitorNextRun, setMonitorNextRun] = useState("");
  const [riskOverride, setRiskOverride] = useState(false);
  const [selectedSymbol, setSelectedSymbol] = useState("");
  const [activeOrderCommandKey, setActiveOrderCommandKey] = useState("");
  const [orderAuditExporting, setOrderAuditExporting] = useState<OrderAuditExportFormat | "">("");
  const [accountSnapshots, setAccountSnapshots] = useState<BrokerAccountSnapshot[]>([]);
  const [accountSyncing, setAccountSyncing] = useState(false);
  const [marketQuotes, setMarketQuotes] = useState<Record<string, MarketQuoteSnapshot>>({});
  const [marketQuoteSyncing, setMarketQuoteSyncing] = useState("");
  const strategy = STRATEGIES.find((item) => item.key === activeStrategyKey) ?? STRATEGIES[0];
  const qbotPreset = QBOT_PRESETS.find((item) => item.key === qbotPresetKey) ?? QBOT_PRESETS[0];
  const broker = BROKER_OPTIONS.find((item) => item.key === brokerMode) ?? BROKER_OPTIONS[0];
  const activeAdapterPlan = useMemo(
    () => buildBrokerAdapterPlan(bridgeStatuses, brokerMode),
    [bridgeStatuses, brokerMode],
  );
  const activeBridgeKind = activeAdapterPlan.bridge;
  const bridgeReady = activeAdapterPlan.ready;
  const validHoldings = useMemo(() => holdings.filter((item) => item.role === "real"), [holdings]);
  const totalValue = positionPlan.totalValue || totalMarketValue(validHoldings);
  const tradeHabit = analyzeTradeHabit(trades, holdings, totalValue);
  const strategyEvaluation = report && reportIsCurrent
    ? evaluateStrategy({
      budgetWeight,
      positionPlan,
      report,
      riskOverride,
      strategyKey: strategy.key,
      tradeHabit,
    })
    : null;
  const score = strategyEvaluation?.score ?? emptyStrategyScore(loading);
  const watchRows = useMemo(() => (report && reportIsCurrent ? watchRowsFor(report, validHoldings, totalValue) : []), [report, reportIsCurrent, totalValue, validHoldings]);
  const activeWatch = watchRows.find((item) => item.symbol === selectedSymbol) ?? watchRows[0] ?? null;
  const activeQuote = activeWatch ? marketQuotes[symbolKey(activeWatch.symbol)] ?? null : null;
  const signals = strategyEvaluation?.signals ?? [];
  const orders = strategyEvaluation?.orderIntents ?? [];
  const orderRows = useMemo(() => normalizeOrderRecords(queuedOrders), [queuedOrders]);
  const orderCenter = useMemo(() => summarizeOrderCenter(orderRows), [orderRows]);
  const accountBook = useMemo(() => accountBookFromSnapshots(accountSnapshots, validHoldings), [accountSnapshots, validHoldings]);
  const accountReconcile = useMemo(() => reconcileAccountBookWithHoldings(accountBook, validHoldings), [accountBook, validHoldings]);
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
  const logs = labLogsFor({ engineMode, eventLogs, lastRun, queuedOrders: orderRows, report, reportIsCurrent, score, strategy, tradeHabit, trades });
  const activeGate = positionPlan.riskGate;
  const storageErrored = Boolean(orderStoreState.error || monitorStoreState.error || riskPolicyState.error);
  const storageSaving = Boolean(orderStoreState.saving || monitorStoreState.saving || riskPolicyState.saving);
  const storageSource = orderStoreState.source === "app-data" && monitorStoreState.source === "app-data" && riskPolicyState.source === "app-data" ? "本机" : "预览";

  useEffect(() => {
    onRefreshRef.current = onRefresh;
  }, [onRefresh]);

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

  const handleBrokerChange = (nextMode: BrokerMode) => {
    const nextBroker = BROKER_OPTIONS.find((item) => item.key === nextMode) ?? BROKER_OPTIONS[0];
    setBrokerMode(nextMode);
    pushLog(nextMode === "local-paper" ? "positive" : "caution", `执行通道切换到 ${nextBroker.label} · ${nextBroker.detail}`);
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

  const handleRunBacktest = () => {
    if (!report || !reportIsCurrent) {
      onOpenAnalysis();
      return;
    }
    const result = runBacktestEngine({
      budgetWeight,
      orderIntents: orders,
      positionPlan,
      preset: qbotPreset,
      report,
      score,
      strategy,
      tradeHabit,
    });
    setEngineMode("backtest");
    setLastRun(result);
    pushLog(result.tone, `回测完成 · ${result.presetLabel} · 收益 ${formatPercent(result.pnlPct)} · ${result.simulatedOrders.length} 单`);
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

  const mergeIntoOrderCenter = (incoming: OrderRecord[]) => {
    const result = mergeOrderRecords(orderRows, incoming);
    setQueuedOrders(result.orders);
    return result;
  };

  const guardIntent = (intent: OrderIntent, quote: MarketQuoteSnapshot | null = marketQuotes[symbolKey(intent.symbol)] ?? null): RiskGuardResult | null => {
    if (!report || !reportIsCurrent) return null;
    return guardOrderIntent({
      holdings: validHoldings,
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

  const syncQuoteForIntent = async (intent: OrderIntent, options: { force?: boolean; silent?: boolean } = {}) => {
    if (!report || !reportIsCurrent) return null;
    const key = symbolKey(intent.symbol);
    const cached = marketQuotes[key];
    if (!options.force && quoteIsFresh(cached)) return cached;
    const holding = validHoldings.find((item) => symbolKey(item.symbol) === key);
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
    const previewOrder = createOrderRecordFromIntent({
      brokerMode,
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
    });
    if (previewOrder.status === "blocked") return previewOrder;
    const routeResult = await routeOrder(previewOrder);
    return applyOrderRouteResult(previewOrder, routeResult);
  };

  const handleQueueGeneratedOrders = async () => {
    if (!report || !reportIsCurrent) {
      onOpenAnalysis();
      return;
    }
    const routedResults = await Promise.all(orders.map(async (order, index) => {
      const quote = await syncQuoteForIntent(order, { silent: true });
      const guard = guardIntent(order, quote);
      const routedOrder = await routePlanOrder(order, index, "strategy", guard);
      return { guard, routedOrder };
    }));
    const riskResults = routedResults.map((item) => item.guard).filter((item): item is RiskGuardResult => Boolean(item));
    const executableOrders = routedResults.map((item) => item.routedOrder);
    if (!executableOrders.length) {
      setEngineMode("paper");
      pushLog("neutral", "当前目标带没有生成可执行委托，先观察信号和仓位差。");
      return;
    }
    setEngineMode("paper");
    const merged = mergeIntoOrderCenter(executableOrders);
    const accepted = executableOrders.filter((item) => item.status !== "blocked" && item.status !== "error").length;
    const acceptedRoutes = merged.accepted ? Math.min(accepted, merged.accepted) : 0;
    const duplicateText = merged.duplicates ? `，过滤 ${merged.duplicates} 条重复` : "";
    pushLog(
      accepted && merged.accepted ? "positive" : merged.duplicates ? "neutral" : "negative",
      `订单中心接收 ${merged.accepted}/${executableOrders.length} 条 · 风控 ${summarizeRiskGuardResults(riskResults)} · 路由通过 ${acceptedRoutes} 条${duplicateText}`,
    );
  };

  const handleQueuePlanOrder = async (order: OrderIntent, index: number) => {
    if (!report || !reportIsCurrent) {
      onOpenAnalysis();
      return;
    }
    const quote = await syncQuoteForIntent(order, { silent: true });
    const guard = guardIntent(order, quote);
    const routedOrder = await routePlanOrder(order, index, "strategy", guard);
    setEngineMode("paper");
    const merged = mergeIntoOrderCenter([routedOrder]);
    pushLog(
      merged.accepted ? routedOrder.tone : "neutral",
      merged.accepted
        ? `${routedOrder.state} · ${routedOrder.side} ${routedOrder.symbol} · ${guard?.summary ?? routedOrder.amount}`
        : `已存在活跃委托 · ${routedOrder.symbol} · ${routedOrder.amount}`,
    );
  };

  const handleQueueActiveOrder = async () => {
    if (!activeWatch) {
      pushLog("neutral", "没有选中的交易标的，先从标的池选择一个资产。");
      return;
    }
    const draft = executableOrderFromTicket({
      brokerMode,
      budgetWeight,
      currency: positionPlan.currency,
      preset: qbotPreset,
      riskOverride,
      score,
      strategy,
      totalValue,
      watch: activeWatch,
    });
    const quote = await syncQuoteForIntent(draft, { silent: true });
    const guard = guardIntent(draft, quote);
    const previewOrder = createOrderRecordFromIntent({
      brokerMode,
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
    });
    const order = previewOrder.status === "blocked"
      ? previewOrder
      : applyOrderRouteResult(previewOrder, await routeOrder(previewOrder));
    setEngineMode("paper");
    mergeIntoOrderCenter([order]);
    pushLog(order.tone, `${order.state} · ${order.side} ${order.symbol} · ${guard?.summary ?? order.amount} · ${order.route}`);
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
      pushLog("negative", "提交前需要先刷新组合分析，确保 Profile 和风控条件是最新的。");
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

  const handleSyncAccount = async () => {
    setAccountSyncing(true);
    try {
      const snapshot = await syncAccountThroughAdapter({
        allowLive: true,
        mode: brokerMode,
        preset: qbotPreset,
        riskOverride,
      });
      setAccountSnapshots((current) => mergeAccountSnapshot(current, snapshot));
      const reconciled = applyBrokerAccountSnapshotToOrders(orderRows, snapshot);
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
    } catch (error) {
      const message = error instanceof Error ? error.message : "订单审计导出失败";
      pushLog("negative", message);
    } finally {
      setOrderAuditExporting("");
    }
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
  }, [broker.label, commitMonitorEvaluation, monitorEnabled, monitorEvaluation, monitorSnapshot, orderRows, orders, report, reportIsCurrent, routePlanOrder, setQueuedOrders]);

  return (
    <section className="quant-lab-page" aria-label="量化交易台">
      <header className="quant-trading-header">
        <div className="quant-terminal-title">
          <span>
            <BiotechRoundedIcon fontSize="inherit" />
            量化交易
          </span>
          <h1>量化交易</h1>
        </div>
        <div className="quant-terminal-status" aria-label="运行状态">
          <CompactStat label="通道" value={broker.label} tone={bridgeReady ? "positive" : "caution"} />
          <CompactStat label="模式" value={modeLabel(engineMode)} tone={score.tone} />
          <CompactStat label="风控" value={riskOverride ? "手动放行" : activeGate?.label ?? "未生成"} tone={riskOverride ? "caution" : activeGate?.tone ?? "neutral"} />
          <CompactStat label="存储" value={storageSource} tone={storageErrored ? "negative" : storageSaving ? "caution" : "positive"} />
        </div>
        <div className="quant-run-controls" aria-label="策略运行控制">
          <button
            type="button"
            className={monitorEnabled ? "is-active" : undefined}
            title={monitorEnabled && monitorLastRun ? `${monitorEvaluation?.summary ?? "Profile 监测运行中"} · 上次 ${monitorLastRun}` : "开启 Profile 监测"}
            onClick={handleToggleMonitor}
          >
            <CandlestickChartRoundedIcon fontSize="inherit" />
            {monitorEnabled ? "监测中" : "监测组合"}
          </button>
          <button type="button" className="is-primary" onClick={handleQueueGeneratedOrders}>
            <PauseCircleRoundedIcon fontSize="inherit" />
            生成委托
          </button>
          <button type="button" onClick={() => setActiveDialog("strategy")}>
            <TuneRoundedIcon fontSize="inherit" />
            设置
          </button>
          <button type="button" onClick={() => setActiveDialog("bridge")}>
            <SpeedRoundedIcon fontSize="inherit" />
            通道
          </button>
        </div>
      </header>

      {!report || !reportIsCurrent ? (
        <section className="quant-empty-state">
          <AutoGraphRoundedIcon fontSize="inherit" />
          <div>
            <strong>{loading ? "正在准备交易输入" : "交易台等待 Profile 输入"}</strong>
            <span>{loading ? "输入完成后会进入交易台。" : "先生成组合 Profile，再推演回测、风控和委托路由。"}</span>
          </div>
          <button type="button" onClick={onOpenAnalysis}>组合分析</button>
        </section>
      ) : (
        <div className={`quant-trading-grid ${rightRailCollapsed ? "is-execution-collapsed" : ""}`}>
          <aside className="quant-control-panel" aria-label="交易设置">
            <PanelTitle icon={<TuneRoundedIcon fontSize="inherit" />} eyebrow="交易参数" title="执行条件" />

            <section className="quant-execution-source-card" aria-label="执行来源">
              <div>
                <span>当前策略</span>
                <strong>{strategy.label}</strong>
                <em>{qbotPreset.label} · {broker.label}</em>
              </div>
              <button type="button" onClick={() => setActiveDialog("strategy")}>调整</button>
            </section>

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
              <button type="button" onClick={() => setActiveDialog("risk")}>
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
                <span>交易标的</span>
                <strong>{watchRows.length} 标的</strong>
              </div>
              <div className="quant-watchlist-table">
                {watchRows.map((row) => (
                  <button
                    key={row.symbol}
                    type="button"
                    className={`${activeWatch?.symbol === row.symbol ? "is-active" : ""} is-${row.tone}`}
                    onClick={() => setSelectedSymbol(row.symbol)}
                  >
                    <span>{row.symbol}</span>
                    <strong>{row.label}</strong>
                    <em>{formatPercent(row.change1d)}</em>
                  </button>
                ))}
              </div>
            </div>
          </aside>

          <main className="quant-market-stage quant-execution-stage" aria-label="交易执行">
            <section className="quant-action-desk">
              <div className="quant-exec-summary">
                <div className="quant-exec-title">
                  <span>建议来源</span>
                  <strong>{report.profileName}</strong>
                  <p>{positionPlan.summary}</p>
                </div>
                <div className="quant-exec-pills" aria-label="执行状态">
                  <span className={`is-${normalizePlanTone(score.tone)}`}>权限 <strong>{score.permission}</strong></span>
                  <span className={`is-${normalizePlanTone(activeGate?.tone ?? "neutral")}`}>风控 <strong>{riskOverride ? "手动放行" : activeGate?.label ?? "待生成"}</strong></span>
                  <span className={monitorEnabled ? `is-${monitorEvaluation?.tone ?? "positive"}` : "is-neutral"}>监测 <strong>{monitorEnabled ? monitorEvaluation?.statusLabel ?? "运行" : "未开启"}</strong></span>
                  <span className={bridgeReady ? "is-positive" : "is-caution"}>通道 <strong>{bridgeReady ? broker.label : "检查"}</strong></span>
                </div>
              </div>

              <div className="quant-suggestion-head">
                <div>
                  <span>待执行建议</span>
                  <strong>{orders.length ? `${orders.length} 条建议单` : "暂无可执行建议"}</strong>
                </div>
                <button type="button" onClick={handleQueueGeneratedOrders}>
                  <PauseCircleRoundedIcon fontSize="inherit" />
                  全部排队
                </button>
              </div>

              <div className="quant-suggestion-list">
                {orders.length ? orders.map((order, index) => (
                  <article key={order.key} className={`is-${order.tone}`}>
                    <div className="quant-suggestion-main">
                      <span>{sideLabel(order.side)}</span>
                      <strong>{order.symbol} · {order.name}</strong>
                      <p>{order.detail}</p>
                    </div>
                    <div className="quant-suggestion-meta">
                      <strong>{order.amount}</strong>
                      <span>{order.weight}</span>
                      <em>{order.state}</em>
                    </div>
                    <button type="button" onClick={() => handleQueuePlanOrder(order, index)}>
                      排队
                    </button>
                  </article>
                )) : (
                  <div className="quant-empty-orders">
                    <DatasetRoundedIcon fontSize="inherit" />
                    <strong>当前没有需要执行的建议单</strong>
                    <span>组合分析或持仓管理给出新的操作建议后，会在这里生成委托。</span>
                  </div>
                )}
              </div>
            </section>

            <section className="quant-execution-footer">
              <div className="quant-manual-ticket">
                <div className="quant-section-head">
                  <div>
                    <span>手动下单</span>
                    <strong>{activeWatch ? `${activeWatch.symbol} · ${activeWatch.label}` : "选择标的"}</strong>
                  </div>
                  <em>{activeWatch ? formatNumber(activeWatch.close, 2) : "—"}</em>
                </div>
                <div className="quant-ticket-grid">
                  <CompactStat label="方向" value={sideLabel(strategy.key === "defense-first" ? "SELL" : "BUY")} tone={strategy.key === "defense-first" ? "negative" : "positive"} />
                  <CompactStat label="金额" value={activeWatch && totalValue > 0 ? formatMoney((totalValue * budgetWeight) / 100, positionPlan.currency) : "—"} />
                  <CompactStat label="比例" value={`${formatNumber(budgetWeight, 1)}%`} />
                  <CompactStat label="限价" value={activeWatch ? formatNumber(activeWatch.close, 2) : "—"} />
                </div>
                <button type="button" className="quant-paper-button" onClick={handleQueueActiveOrder}>
                  <PlayArrowRoundedIcon fontSize="inherit" />
                  排入队列
                </button>
              </div>

              <div className="quant-route-strip">
                <div className="quant-section-head">
                  <div>
                    <span>执行确认</span>
                    <strong>{orderIntentLabel(orderRows.length, orders.length)}</strong>
                  </div>
                  <em>{lastRun ? `试算 ${lastRun.createdAt}` : modeLabel(engineMode)}</em>
                </div>
                <div className="quant-flow-compact" aria-label="订单流">
                  <span className={`is-${normalizePlanTone(score.tone)}`}>建议 <strong>{score.label}</strong></span>
                  <span className={`is-${normalizePlanTone(activeGate?.tone ?? "neutral")}`}>风控 <strong>{activeGate?.label ?? "待生成"}</strong></span>
                  <span className={orderRows.length || orders.length ? "is-caution" : "is-neutral"}>委托 <strong>{orderIntentLabel(orderRows.length, orders.length)}</strong></span>
                  <span className={bridgeReady ? "is-positive" : "is-caution"}>路由 <strong>{bridgeReady ? broker.label : "检查"}</strong></span>
                </div>
              </div>
            </section>
          </main>

          {!rightRailCollapsed ? (
            <aside className="decision-rail quant-execution-rail workspace-inspector-rail" aria-label="委托执行">
              <div className="quant-rail-head">
                <PanelTitle icon={<ReceiptLongRoundedIcon fontSize="inherit" />} eyebrow="执行" title="委托执行" />
              </div>

              <Card size="sm" className="rail-card quant-market-quote-card" role="region" aria-label="行情">
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
                <p>{activeQuote ? quoteMessage(activeQuote) : "排队前会自动回填行情，ETF 会检查价差和折溢价。"}</p>
              </Card>

              <Card size="sm" className="rail-card quant-order-blotter" role="region" aria-label="委托队列">
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
                        <small>{latestEvent ? `${latestEvent.time} · ${latestEvent.detail}` : orderSourceLabel(order)}</small>
                        <div className="quant-order-actions" aria-label={`${order.symbol} 委托动作`}>
                          {canSubmitOrder(order) ? (
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
                          {canCancelOrder(order) ? (
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

              <Card size="sm" className="rail-card quant-account-sync" role="region" aria-label="账户同步">
                <div className="quant-section-head">
                  <div>
                    <span>账户</span>
                    <strong>{accountBook.accountCount ? summarizeAccountBook(accountBook) : "账户同步"}</strong>
                  </div>
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
                </div>
                <div className="quant-order-center-summary" aria-label="账户同步摘要">
                  <span>权益 <strong>{formatBookMoney(accountBook.equity, accountBook.currency, positionPlan.currency)}</strong></span>
                  <span>现金 <strong>{formatBookMoney(accountBook.cash, accountBook.currency, positionPlan.currency)}</strong></span>
                  <span>持仓 <strong>{accountBook.positionCount}</strong></span>
                </div>
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
                        {accountReconcile.rows.filter((row) => row.status !== "matched").slice(0, 3).map((row) => (
                          <article key={row.key} className={`is-${row.tone}`}>
                            <div>
                              <strong>{row.symbol}</strong>
                              <span>{row.name}</span>
                            </div>
                            <em>{reconcileStatusLabel(row.status)}</em>
                            <small>{row.summary}</small>
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

              <Card size="sm" className="rail-card quant-log-panel" role="region" aria-label="运行日志">
                <div className="quant-section-head">
                  <div>
                    <span>日志</span>
                    <strong>运行日志</strong>
                  </div>
                  <CandlestickChartRoundedIcon fontSize="inherit" />
                </div>
                {logs.map((item) => (
                  <article key={item.key} className={`is-${item.tone}`}>
                    <span>{item.time}</span>
                    <p>{item.text}</p>
                  </article>
                ))}
              </Card>
            </aside>
          ) : null}
        </div>
      )}
      {activeDialog && report && reportIsCurrent ? (
        <div className="quant-dialog-layer" role="presentation">
          <button
            type="button"
            className="quant-dialog-backdrop"
            aria-label="关闭弹窗"
            onClick={() => setActiveDialog(null)}
          />
          <aside className="quant-dialog" role="dialog" aria-modal="true" aria-label="交易配置">
            <header className="quant-dialog-head">
              <div>
                <span>{dialogEyebrow(activeDialog)}</span>
                <strong>{dialogTitle(activeDialog)}</strong>
              </div>
              <button type="button" onClick={() => setActiveDialog(null)}>关闭</button>
            </header>

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

                <div className="quant-parameter-grid" aria-label="回测参数">
                  <Param label="标的池" value={report.profileKey} />
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
                <div className="quant-broker-options" role="tablist" aria-label="执行通道">
                  {BROKER_OPTIONS.map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      role="tab"
                      aria-selected={brokerMode === item.key}
                      className={brokerMode === item.key ? "is-active" : undefined}
                      onClick={() => handleBrokerChange(item.key)}
                    >
                      <strong>{item.label}</strong>
                      <span>{item.detail}</span>
                    </button>
                  ))}
                </div>
                <div className="quant-router-meta">
                  <Param label="类型" value={brokerMode === "live-gateway" ? "实盘" : "虚拟盘"} tone={brokerMode === "live-gateway" ? "caution" : "positive"} />
                  <Param label="平台" value={qbotPreset.platform} />
                  <Param label="品种" value={qbotPreset.tradeType} />
                  <Param label="策略" value={qbotPreset.label} />
                </div>
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

            {activeDialog === "risk" ? (
              <div className="quant-dialog-stack">
                <section className="quant-risk-switchboard">
                  <PanelTitle icon={<ShieldRoundedIcon fontSize="inherit" />} eyebrow="风控" title="风控开关" />
                  <RiskRule label="现金底线" value={`${formatNumber(positionPlan.policy.minCashWeight, 0)}%`} tone={positionPlan.hasCashInstrument ? "positive" : "caution"} />
                  <RiskRule label="单标上限" value={`${formatNumber(positionPlan.policy.singleAssetCap, 0)}%`} tone="positive" />
                  <RiskRule label="单日委托" value={`${riskPolicy.maxDailyOrders} 单`} tone="positive" />
                  <RiskRule label="冷却时间" value={`${riskPolicy.cooldownMinutes} 分钟`} tone={riskPolicy.cooldownMinutes ? "positive" : "neutral"} />
                  <RiskRule label="风险门" value={activeGate?.blocked ? "阻断" : activeGate?.watch ? "观察" : "通过"} tone={activeGate?.tone ?? "neutral"} />
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

            {activeDialog === "signals" ? (
              <div className="quant-dialog-stack">
                <div className="quant-signal-board">
                  <div className="quant-section-head">
                    <div>
                      <span>信号条件</span>
                      <strong>信号闸门</strong>
                    </div>
                    <SpeedRoundedIcon fontSize="inherit" />
                  </div>
                  <div className="quant-signal-grid">
                    {signals.map((item) => (
                      <article key={item.key} className={`is-${item.tone}`}>
                        <span>{item.label}</span>
                        <strong>{item.value}</strong>
                        <p>{item.detail}</p>
                      </article>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}
          </aside>
        </div>
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

function CompactStat({ label, tone = "neutral", value }: { label: string; tone?: LabTone | PositionPlanTone; value: string }) {
  return (
    <span className={`quant-inline-stat is-${normalizePlanTone(tone)}`}>
      <em>{label}</em>
      <strong>{value}</strong>
    </span>
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

function dialogEyebrow(key: Exclude<QuantDialogKey, null>) {
  if (key === "strategy") return "策略参数";
  if (key === "bridge") return "执行通道";
  if (key === "risk") return "风控";
  return "信号明细";
}

function dialogTitle(key: Exclude<QuantDialogKey, null>) {
  if (key === "strategy") return "策略与参数";
  if (key === "bridge") return "执行通道";
  if (key === "risk") return "风控开关";
  return "信号闸门";
}

function executableOrderFromTicket({
  brokerMode,
  budgetWeight,
  currency,
  preset,
  riskOverride,
  score,
  strategy,
  totalValue,
  watch,
}: {
  brokerMode: BrokerMode;
  budgetWeight: number;
  currency: string;
  preset: QbotPreset;
  riskOverride: boolean;
  score: StrategyScore;
  strategy: StrategyDefinition;
  totalValue: number;
  watch: WatchRow;
}): ManualOrderDraft {
  const side = strategy.key === "defense-first" ? "SELL" : "BUY";
  const blocked = !riskOverride && score.tone === "negative" && strategy.key !== "defense-first";
  const fallbackNotional = watch.close > 0 ? watch.close * 100 : 0;
  const notional = totalValue > 0 ? (totalValue * budgetWeight) / 100 : fallbackNotional;
  const quantity = watch.close > 0 && notional > 0 ? notional / watch.close : 0;
  const route = brokerRouteLabel(brokerMode, preset);
  const tone: LabTone = blocked ? "negative" : side === "SELL" ? "caution" : riskOverride ? "caution" : "positive";
  return {
    key: `ticket-${Date.now()}-${watch.symbol}`,
    symbol: watch.symbol,
    name: watch.label,
    side,
    state: blocked ? "已阻断" : riskOverride ? "手动放行排队" : `${route} 已排队`,
    tone,
    amount: formatMoney(notional, currency),
    weight: `${formatNumber(budgetWeight, 1)}%`,
    detail: `${preset.strategy} · ${preset.tradeType} · ${route}`,
    limit: formatNumber(watch.close, 2),
    quantity: quantity > 0 ? formatNumber(quantity, quantity >= 100 ? 0 : 4) : "—",
  };
}

function labLogsFor({
  engineMode,
  eventLogs,
  lastRun,
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
  lastRun: BacktestRunResult | null;
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
      text: `${modeLabel(engineMode)} · ${strategy.label} · ${score.permission}`,
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

function watchRowsFor(report: MarketAnalysisReport, holdings: HoldingRecord[], totalValue: number): WatchRow[] {
  const holdingBySymbol = new Map(holdings.map((item) => [item.symbol, item]));
  const technicalBySymbol = new Map(report.technicalRows.map((item) => [item.symbol, item]));
  const rows = report.assetStatuses.map((asset) => {
    const technical = technicalBySymbol.get(asset.symbol);
    const holding = holdingBySymbol.get(asset.symbol);
    return watchRowFromAsset(asset, technical, holding, totalValue);
  });
  const extras = holdings
    .filter((holding) => !rows.some((item) => item.symbol === holding.symbol))
    .map((holding) => watchRowFromHolding(holding, totalValue));
  return [...rows, ...extras].slice(0, 12);
}

function watchRowFromAsset(asset: AssetStatus, technical: TechnicalRow | undefined, holding: HoldingRecord | undefined, totalValue: number): WatchRow {
  return {
    symbol: asset.symbol,
    label: asset.label,
    close: asset.close,
    change1d: asset.change1d,
    weight: holding && totalValue > 0 ? ((holding.quantity * holding.currentPrice) / totalValue) * 100 : null,
    status: asset.statusLabel,
    tone: toneFromStatus(asset.status),
    rsi: technical?.rsi14 ?? null,
    volumeRatio: technical?.volumeRatio ?? null,
  };
}

function watchRowFromHolding(holding: HoldingRecord, totalValue: number): WatchRow {
  return {
    symbol: holding.symbol,
    label: holding.name,
    close: holding.currentPrice,
    change1d: null,
    weight: totalValue > 0 ? ((holding.quantity * holding.currentPrice) / totalValue) * 100 : null,
    status: holding.role,
    tone: isCashHolding(holding) ? "neutral" : "caution",
    rsi: null,
    volumeRatio: null,
  };
}

function modeLabel(mode: EngineMode) {
  return mode === "backtest" ? "回测" : "模拟";
}

function sideLabel(side: string) {
  return side === "SELL" || side.toLowerCase() === "sell" ? "卖出" : "买入";
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

function orderIntentLabel(queuedCount: number, planCount: number) {
  if (queuedCount > 0) return `${queuedCount} 条已排队`;
  if (planCount > 0) return `${planCount} 条计划`;
  return "无委托";
}

function canSubmitOrder(order: OrderRecord) {
  return order.status === "queued" || order.status === "prepared";
}

function canCancelOrder(order: OrderRecord) {
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

function totalMarketValue(holdings: HoldingRecord[]) {
  return holdings.reduce((sum, item) => sum + item.quantity * item.currentPrice, 0);
}
