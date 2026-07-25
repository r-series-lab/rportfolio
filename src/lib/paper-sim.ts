import { isCashHolding, type PositionPlan } from "./position-plan";
import type { HoldingRecord } from "./holdings";
import type { MarketAnalysisReport } from "./types";
import type { LabTone, OrderIntent, QbotPreset, ReplacementOrderLink, StrategyDefinition } from "./strategy-engine";
import { formatMoney, formatPercent } from "./utils";
import {
  DEFAULT_FUND_EXECUTION_POLICY,
  type FundExecutionPolicy,
} from "./fund-execution-policy";

export type PaperSimPosition = {
  symbol: string;
  name: string;
  currency: string;
  quantity: number;
  availableQuantity: number;
  avgCost: number;
  lastPrice: number;
  marketValue: number;
  realizedPnl: number;
  unrealizedPnl: number;
};

export type PaperSimTrade = {
  id: string;
  at: string;
  runDate: string;
  symbol: string;
  name: string;
  side: "BUY" | "SELL";
  quantity: number;
  price: number;
  notional: number;
  fee: number;
  commission: number;
  stampDuty: number;
  transferFee: number;
  slippage: number;
  realizedPnl: number;
  orderKey: string;
  source: string;
  ruleLabel: string;
  ruleNote: string;
  profileKey: string;
  profileName: string;
  strategyKey: string;
  strategyName: string;
  decisionState: string;
  decisionDetail: string;
  targetWeight: string;
  scalingPolicyKey?: string;
  strategyInstanceKey?: string;
  trancheIndex?: number;
  replacementLink?: ReplacementOrderLink | null;
};

export type PaperTradeRoundTrip = {
  id: string;
  symbol: string;
  name: string;
  openedAt: string;
  openedRunDate: string;
  closedAt: string;
  closedRunDate: string;
  holdingDays: number;
  quantity: number;
  entryNotional: number;
  exitNotional: number;
  entryFees: number;
  exitFees: number;
  slippage: number;
  netPnl: number;
  returnPct: number;
  complete: boolean;
  profileKey: string;
  profileName: string;
  strategyKey: string;
  strategyName: string;
  decisionState: string;
  decisionDetail: string;
  source: string;
  replacementId: string;
};

export type PaperTradeRoundTripSummary = {
  rounds: PaperTradeRoundTrip[];
  unmatchedExitCount: number;
  unmatchedExitQuantity: number;
};

export type PaperReplacementCostSummary = {
  workflowCount: number;
  completedWorkflowCount: number;
  tradeCount: number;
  notional: number;
  fees: number;
  slippage: number;
  totalCost: number;
  costPct: number;
};

export type PaperSimSnapshot = {
  id: string;
  at: string;
  runDate: string;
  equity: number;
  cash: number;
  positionValue: number;
  pnl: number;
  pnlPct: number;
  drawdownPct: number;
  previousEquity: number;
  dailyPnl: number;
  dailyPnlPct: number;
  marketPnl: number;
  executionPnl: number;
  feePnl: number;
  otherPnl: number;
  benchmarkSymbol: string;
  benchmarkAvailable: boolean;
  benchmarkDailyReturnPct: number;
  benchmarkReturnPct: number;
  excessDailyReturnPct: number;
  excessReturnPct: number;
  cumulativeFees: number;
  feeDragPct: number;
  tradeCount: number;
  skippedCount: number;
  summary: string;
};

export type PaperSimPendingFundOrder = {
  id: string;
  submittedAt: string;
  submittedDate: string;
  submittedAfterCutoff: boolean;
  cutoffTime: string;
  navDate: string;
  navCapturedDate: string;
  navSource: string;
  confirmDate: string;
  cashArrivalDate: string;
  settlementStage: "nav-pending" | "cash-pending" | "replacement-paused";
  settledGross: number;
  settledFee: number;
  settledQuantity: number;
  cashCredited: boolean;
  symbol: string;
  name: string;
  side: "BUY" | "SELL";
  requestedNotional: number;
  referenceNav: number;
  confirmedNav: number;
  buyFeeRate: number;
  sellFeeRate: number;
  reservedCash: number;
  reservedQuantity: number;
  orderKey: string;
  source: string;
  profileKey: string;
  profileName: string;
  strategyKey: string;
  strategyName: string;
  decisionState: string;
  decisionDetail: string;
  targetWeight: string;
  scalingPolicyKey?: string;
  strategyInstanceKey?: string;
  trancheIndex?: number;
  replacementLink: ReplacementOrderLink | null;
};

export type PaperSimState = {
  version: number;
  active: boolean;
  accountId: string;
  experimentName: string;
  profileKey: string;
  profileName: string;
  strategyKey: string;
  strategyName: string;
  presetKey: string;
  presetLabel: string;
  currency: string;
  initialCapital: number;
  cash: number;
  positions: PaperSimPosition[];
  pendingFundOrders: PaperSimPendingFundOrder[];
  trades: PaperSimTrade[];
  snapshots: PaperSimSnapshot[];
  startedAt: string;
  updatedAt: string;
  lastRunDate: string;
  nextRunHint: string;
};

export type PaperSimSummary = {
  active: boolean;
  statusLabel: string;
  tone: LabTone;
  equity: number;
  cash: number;
  positionValue: number;
  pnl: number;
  pnlPct: number;
  maxDrawdownPct: number;
  positionCount: number;
  pendingFundOrderCount: number;
  tradeCount: number;
  snapshotCount: number;
  lastRunDate: string;
  headline: string;
  latestDailyPnl: number;
  latestDailyPnlPct: number;
  benchmarkSymbol: string;
  benchmarkAvailable: boolean;
  benchmarkReturnPct: number;
  excessReturnPct: number;
  cumulativeFees: number;
  feeDragPct: number;
};

export type PaperTradePerformance = {
  sampleCount: number;
  requiredSamples: number;
  remainingSamples: number;
  ready: boolean;
  winCount: number;
  lossCount: number;
  breakevenCount: number;
  winRatePct: number | null;
  payoffRatio: number | null;
  expectancy: number | null;
  averageWin: number | null;
  averageLoss: number | null;
  grossProfit: number;
  grossLoss: number;
  averageHoldingDays: number | null;
  unmatchedExitCount: number;
  confidence: "collecting" | "preliminary" | "reference" | "stable";
  confidenceLabel: string;
  nextConfidenceSample: number | null;
  tone: LabTone;
  verdict: string;
  detail: string;
};

export type PaperTradePerformanceGroup = PaperTradePerformance & {
  key: string;
  profileKey: string;
  profileName: string;
  strategyKey: string;
  strategyName: string;
};

export type CreatePaperSimInput = {
  holdings: HoldingRecord[];
  positionPlan: PositionPlan;
  preset: QbotPreset;
  report: MarketAnalysisReport;
  strategy: StrategyDefinition;
};

export type RunPaperSimInput = {
  fundNavEvidence?: Array<{ symbol: string; nav: number; asOf: string; source: string }>;
  holdings: HoldingRecord[];
  orderIntents: OrderIntent[];
  positionPlan: PositionPlan;
  preset: QbotPreset;
  report: MarketAnalysisReport;
  source: string;
  state: PaperSimState;
  strategy: StrategyDefinition;
  fundExecutionPolicy?: FundExecutionPolicy;
};

export type PaperSimRunResult = {
  state: PaperSimState;
  summary: PaperSimSummary;
  trades: PaperSimTrade[];
  skipped: number;
  skipReasons: string[];
  alreadyRan: boolean;
  marketClosed: boolean;
};

const PAPER_SIM_VERSION = 7;


export const MAX_PAPER_SIM_TRADES = 500;
export const MAX_PAPER_SIM_SNAPSHOTS = 260;
export const PAPER_TRADE_PERFORMANCE_MIN_SAMPLES = 10;
const PAPER_TRADE_BREAKEVEN_EPSILON = 0.005;

type PaperSimTradeContext = {
  profileKey: string;
  profileName: string;
  strategyKey: string;
  strategyName: string;
};

export function defaultPaperSimState(): PaperSimState {
  const now = new Date().toISOString();
  return {
    version: PAPER_SIM_VERSION,
    active: false,
    accountId: "paper-sim",
    experimentName: "自动模拟实验",
    profileKey: "",
    profileName: "",
    strategyKey: "",
    strategyName: "",
    presetKey: "",
    presetLabel: "",
    currency: "CNY",
    initialCapital: 0,
    cash: 0,
    positions: [],
    pendingFundOrders: [],
    trades: [],
    snapshots: [],
    startedAt: "",
    updatedAt: now,
    lastRunDate: "",
    nextRunHint: "等待启动",
  };
}

export function createPaperSimExperiment({
  holdings,
  positionPlan,
  preset,
  report,
  strategy,
}: CreatePaperSimInput): PaperSimState {
  const now = new Date().toISOString();
  const realHoldings = holdings.filter((holding) => holding.role === "real");
  const positions = seedPositionsFromHoldings(realHoldings);
  const positionValue = positions.reduce((sum, position) => sum + position.marketValue, 0);
  const cashFromHoldings = realHoldings
    .filter((holding) => isCashHolding(holding))
    .reduce((sum, holding) => sum + holding.quantity * holding.currentPrice, 0);
  const planCapital = firstPositiveNumber(positionPlan.totalValue, positionValue + cashFromHoldings, 100_000) ?? 100_000;
  const inferredCash = cashFromHoldings > 0 ? cashFromHoldings : Math.max(0, planCapital - positionValue);

  return normalizePaperSimState({
    version: PAPER_SIM_VERSION,
    active: true,
    accountId: `paper-${report.profileKey || "profile"}-${Date.now()}`,
    experimentName: `${report.profileName} · ${strategy.shortLabel}`,
    profileKey: report.profileKey,
    profileName: report.profileName,
    strategyKey: strategy.key,
    strategyName: strategy.label,
    presetKey: preset.key,
    presetLabel: preset.label,
    currency: positionPlan.currency || "CNY",
    initialCapital: planCapital,
    cash: inferredCash,
    positions,
    pendingFundOrders: [],
    trades: [],
    snapshots: [],
    startedAt: now,
    updatedAt: now,
    lastRunDate: "",
    nextRunHint: "等待今日模拟",
  });
}

export function activatePaperSimState(state: PaperSimState, input: CreatePaperSimInput): PaperSimState {
  const normalized = normalizePaperSimState(state);
  if (normalized.active && normalized.initialCapital > 0) return normalized;
  return createPaperSimExperiment(input);
}

export function pausePaperSimState(state: PaperSimState): PaperSimState {
  return {
    ...normalizePaperSimState(state),
    active: false,
    nextRunHint: "已暂停",
    updatedAt: new Date().toISOString(),
  };
}


export function summarizePaperSimState(state: PaperSimState): PaperSimSummary {
  const normalized = normalizePaperSimState(state);
  const positionValue = normalized.positions.reduce((sum, position) => sum + position.marketValue, 0);
  const pendingFundValue = normalized.pendingFundOrders.reduce((sum, order) => sum + pendingFundOrderValue(order), 0);
  const equity = normalized.snapshots[0]?.equity ?? normalized.cash + positionValue + pendingFundValue;
  const pnl = normalized.initialCapital > 0 ? equity - normalized.initialCapital : 0;
  const pnlPct = normalized.initialCapital > 0 ? (pnl / normalized.initialCapital) * 100 : 0;
  const maxDrawdownPct = normalized.snapshots.reduce((min, snapshot) => Math.min(min, snapshot.drawdownPct), 0);
  const tone: LabTone = !normalized.active
    ? "neutral"
    : pnlPct > 0
      ? "positive"
      : maxDrawdownPct <= -5
        ? "negative"
        : pnlPct < 0
          ? "caution"
          : "neutral";
  const statusLabel = normalized.active ? normalized.lastRunDate ? "运行中" : "已启动" : "未启动";
  const headline = normalized.active
    ? `${formatMoney(equity, normalized.currency)} · ${formatPercent(pnlPct)}`
    : "等待启动自动模拟";

  return {
    active: normalized.active,
    statusLabel,
    tone,
    equity,
    cash: normalized.cash,
    positionValue,
    pnl,
    pnlPct,
    maxDrawdownPct,
    positionCount: normalized.positions.length,
    pendingFundOrderCount: normalized.pendingFundOrders.length,
    tradeCount: normalized.trades.length,
    snapshotCount: normalized.snapshots.length,
    lastRunDate: normalized.lastRunDate,
    headline,
    latestDailyPnl: normalized.snapshots[0]?.dailyPnl ?? 0,
    latestDailyPnlPct: normalized.snapshots[0]?.dailyPnlPct ?? 0,
    benchmarkSymbol: normalized.snapshots[0]?.benchmarkSymbol ?? "",
    benchmarkAvailable: normalized.snapshots[0]?.benchmarkAvailable ?? false,
    benchmarkReturnPct: normalized.snapshots[0]?.benchmarkReturnPct ?? 0,
    excessReturnPct: normalized.snapshots[0]?.excessReturnPct ?? 0,
    cumulativeFees: normalized.snapshots[0]?.cumulativeFees ?? 0,
    feeDragPct: normalized.snapshots[0]?.feeDragPct ?? 0,
  };
}

export function paperTradePerformanceFor(state: PaperSimState): PaperTradePerformance {
  return paperTradePerformanceFromRoundSummary(paperTradeRoundTripsFor(state));
}

export function paperTradePerformanceGroupsFor(state: PaperSimState): PaperTradePerformanceGroup[] {
  const normalized = normalizePaperSimState(state);
  const groups = new Map<string, { context: PaperSimTradeContext; rounds: PaperTradeRoundTrip[] }>();
  paperTradeRoundTripsFor(normalized).rounds.filter((round) => round.complete).forEach((round) => {
    const context: PaperSimTradeContext = {
      profileKey: round.profileKey || normalized.profileKey || "unknown-profile",
      profileName: round.profileName || normalized.profileName || "未命名 Profile",
      strategyKey: round.strategyKey || normalized.strategyKey || "unknown-strategy",
      strategyName: round.strategyName || normalized.strategyName || "未命名策略",
    };
    const key = `${context.profileKey}::${context.strategyKey}`;
    const group = groups.get(key) ?? { context, rounds: [] };
    group.rounds.push(round);
    groups.set(key, group);
  });
  return Array.from(groups.entries())
    .map(([key, group]) => ({
      key,
      ...group.context,
      ...paperTradePerformanceFromRoundSummary({
        rounds: group.rounds,
        unmatchedExitCount: 0,
        unmatchedExitQuantity: 0,
      }),
    }))
    .sort((left, right) => right.sampleCount - left.sampleCount || left.key.localeCompare(right.key));
}

export function paperTradeRoundTripsFor(state: PaperSimState): PaperTradeRoundTripSummary {
  const normalized = normalizePaperSimState(state);
  const openingQuantityBySymbol: Record<string, number> = {};
  normalized.positions.forEach((position) => {
    openingQuantityBySymbol[symbolKey(position.symbol)] = position.quantity;
  });
  normalized.trades.forEach((trade) => {
    const symbol = symbolKey(trade.symbol);
    openingQuantityBySymbol[symbol] = (openingQuantityBySymbol[symbol] ?? 0)
      + (trade.side === "SELL" ? trade.quantity : -trade.quantity);
  });
  return paperTradeRoundTripsFromTrades(normalized.trades, openingQuantityBySymbol);
}

export function paperTradeRoundTripsFromTrades(
  trades: PaperSimTrade[],
  openingQuantityBySymbol: Record<string, number> = {},
): PaperTradeRoundTripSummary {
  type OpenLot = {
    trade: PaperSimTrade | null;
    tracked: boolean;
    remainingQuantity: number;
    remainingNotional: number;
    remainingFees: number;
    remainingSlippage: number;
  };
  type MatchedLot = {
    trade: PaperSimTrade | null;
    tracked: boolean;
    quantity: number;
    notional: number;
    fees: number;
    slippage: number;
  };

  const ordered = trades
    .map((trade, index) => ({ trade, index }))
    .filter(({ trade }) => trade.quantity > 0 && trade.notional > 0)
    .sort((left, right) => (
      left.trade.runDate.localeCompare(right.trade.runDate)
      || left.trade.at.localeCompare(right.trade.at)
      || left.index - right.index
    ));
  const lotsBySymbol = new Map<string, OpenLot[]>();
  Object.entries(openingQuantityBySymbol).forEach(([rawSymbol, rawQuantity]) => {
    const quantity = Math.max(0, rawQuantity);
    if (quantity <= quantityTolerance(quantity)) return;
    lotsBySymbol.set(symbolKey(rawSymbol), [{
      trade: null,
      tracked: false,
      remainingQuantity: quantity,
      remainingNotional: 0,
      remainingFees: 0,
      remainingSlippage: 0,
    }]);
  });
  const rounds: PaperTradeRoundTrip[] = [];
  let unmatchedExitCount = 0;
  let unmatchedExitQuantity = 0;

  ordered.forEach(({ trade }) => {
    const symbol = symbolKey(trade.symbol);
    if (trade.side === "BUY") {
      const lots = lotsBySymbol.get(symbol) ?? [];
      lots.push({
        trade,
        tracked: true,
        remainingQuantity: trade.quantity,
        remainingNotional: trade.notional,
        remainingFees: trade.fee,
        remainingSlippage: trade.slippage,
      });
      lotsBySymbol.set(symbol, lots);
      return;
    }

    const lots = lotsBySymbol.get(symbol) ?? [];
    const matchedLots: MatchedLot[] = [];
    let remainingExitQuantity = trade.quantity;
    while (remainingExitQuantity > quantityTolerance(trade.quantity) && lots.length) {
      const lot = lots[0];
      const quantity = Math.min(remainingExitQuantity, lot.remainingQuantity);
      const fraction = lot.remainingQuantity > 0 ? quantity / lot.remainingQuantity : 0;
      const matched: MatchedLot = {
        trade: lot.trade,
        tracked: lot.tracked,
        quantity,
        notional: lot.remainingNotional * fraction,
        fees: lot.remainingFees * fraction,
        slippage: lot.remainingSlippage * fraction,
      };
      matchedLots.push(matched);
      lot.remainingQuantity -= quantity;
      lot.remainingNotional -= matched.notional;
      lot.remainingFees -= matched.fees;
      lot.remainingSlippage -= matched.slippage;
      remainingExitQuantity -= quantity;
      if (lot.remainingQuantity <= quantityTolerance(lot.trade?.quantity ?? quantity)) lots.shift();
    }
    lotsBySymbol.set(symbol, lots);

    const trackedLots = matchedLots.filter((lot): lot is MatchedLot & { trade: PaperSimTrade } => lot.tracked && Boolean(lot.trade));
    const matchedQuantity = trackedLots.reduce((sum, lot) => sum + lot.quantity, 0);
    const untrackedQuantity = matchedLots.reduce((sum, lot) => sum + (lot.tracked ? 0 : lot.quantity), 0);
    const complete = remainingExitQuantity <= quantityTolerance(trade.quantity)
      && untrackedQuantity <= quantityTolerance(trade.quantity);
    if (!complete) {
      unmatchedExitCount += 1;
      unmatchedExitQuantity += Math.max(0, remainingExitQuantity) + untrackedQuantity;
    }
    if (matchedQuantity <= quantityTolerance(trade.quantity)) return;

    const exitFraction = Math.min(1, matchedQuantity / trade.quantity);
    const entryNotional = trackedLots.reduce((sum, lot) => sum + lot.notional, 0);
    const entryFees = trackedLots.reduce((sum, lot) => sum + lot.fees, 0);
    const exitNotional = trade.notional * exitFraction;
    const exitFees = trade.fee * exitFraction;
    const entryCost = entryNotional + entryFees;
    const netPnl = exitNotional - exitFees - entryCost;
    const holdingDays = trackedLots.reduce((sum, lot) => (
      sum + calendarDaysBetween(lot.trade.runDate, trade.runDate) * lot.quantity
    ), 0) / matchedQuantity;
    const firstEntry = trackedLots[0].trade;
    const replacementId = trade.replacementLink?.id
      || trackedLots.find((lot) => lot.trade.replacementLink?.id)?.trade.replacementLink?.id
      || "";
    rounds.push({
      id: `round-${trade.id}`,
      symbol,
      name: trade.name || firstEntry.name || symbol,
      openedAt: firstEntry.at,
      openedRunDate: firstEntry.runDate,
      closedAt: trade.at,
      closedRunDate: trade.runDate,
      holdingDays,
      quantity: matchedQuantity,
      entryNotional,
      exitNotional,
      entryFees,
      exitFees,
      slippage: trackedLots.reduce((sum, lot) => sum + lot.slippage, 0) + trade.slippage * exitFraction,
      netPnl,
      returnPct: entryCost > 0 ? (netPnl / entryCost) * 100 : 0,
      complete,
      profileKey: trade.profileKey,
      profileName: trade.profileName,
      strategyKey: trade.strategyKey,
      strategyName: trade.strategyName,
      decisionState: trade.decisionState,
      decisionDetail: trade.decisionDetail || trade.ruleNote || trade.ruleLabel,
      source: trade.source,
      replacementId,
    });
  });

  rounds.sort((left, right) => (
    right.closedRunDate.localeCompare(left.closedRunDate)
    || right.closedAt.localeCompare(left.closedAt)
  ));
  return { rounds, unmatchedExitCount, unmatchedExitQuantity };
}

export function paperReplacementCostFor(state: PaperSimState): PaperReplacementCostSummary {
  const trades = normalizePaperSimState(state).trades.filter((trade) => Boolean(trade.replacementLink?.id));
  const workflows = new Map<string, { bought: boolean; sold: boolean }>();
  trades.forEach((trade) => {
    const id = trade.replacementLink?.id;
    if (!id) return;
    const workflow = workflows.get(id) ?? { bought: false, sold: false };
    workflow.bought ||= trade.side === "BUY";
    workflow.sold ||= trade.side === "SELL";
    workflows.set(id, workflow);
  });
  const fees = trades.reduce((sum, trade) => sum + Math.max(0, trade.fee), 0);
  const slippage = trades.reduce((sum, trade) => sum + Math.max(0, trade.slippage), 0);
  const notional = trades.reduce((sum, trade) => sum + Math.max(0, trade.notional), 0);
  const totalCost = fees + slippage;
  return {
    workflowCount: workflows.size,
    completedWorkflowCount: Array.from(workflows.values()).filter((workflow) => workflow.bought && workflow.sold).length,
    tradeCount: trades.length,
    notional,
    fees,
    slippage,
    totalCost,
    costPct: notional > 0 ? (totalCost / notional) * 100 : 0,
  };
}

function paperTradePerformanceFromRoundSummary(summary: PaperTradeRoundTripSummary): PaperTradePerformance {
  const completedRounds = summary.rounds.filter((round) => round.complete);
  const sampleCount = completedRounds.length;
  const requiredSamples = PAPER_TRADE_PERFORMANCE_MIN_SAMPLES;
  const remainingSamples = Math.max(0, requiredSamples - sampleCount);
  const ready = sampleCount >= requiredSamples;
  const wins = completedRounds.filter((round) => round.netPnl > PAPER_TRADE_BREAKEVEN_EPSILON);
  const losses = completedRounds.filter((round) => round.netPnl < -PAPER_TRADE_BREAKEVEN_EPSILON);
  const winCount = wins.length;
  const lossCount = losses.length;
  const breakevenCount = sampleCount - winCount - lossCount;
  const grossProfit = wins.reduce((sum, round) => sum + round.netPnl, 0);
  const grossLoss = Math.abs(losses.reduce((sum, round) => sum + round.netPnl, 0));
  const averageHoldingDays = sampleCount
    ? completedRounds.reduce((sum, round) => sum + round.holdingDays, 0) / sampleCount
    : null;
  const averageWin = ready && winCount > 0 ? grossProfit / winCount : null;
  const averageLoss = ready && lossCount > 0 ? grossLoss / lossCount : null;
  const payoffRatio = averageWin !== null && averageLoss !== null && averageLoss > 0
    ? averageWin / averageLoss
    : null;
  const winRatePct = ready ? (winCount / sampleCount) * 100 : null;
  const expectancy = ready
    ? completedRounds.reduce((sum, round) => sum + round.netPnl, 0) / sampleCount
    : null;
  const confidence = paperTradeConfidenceFor(sampleCount);
  const unmatchedNote = summary.unmatchedExitCount
    ? `另有 ${summary.unmatchedExitCount} 笔缺少可追溯模拟买入的退出未计入。`
    : "";

  if (!ready) {
    return {
      sampleCount,
      requiredSamples,
      remainingSamples,
      ready,
      winCount,
      lossCount,
      breakevenCount,
      winRatePct: null,
      payoffRatio: null,
      expectancy: null,
      averageWin: null,
      averageLoss: null,
      grossProfit,
      grossLoss,
      averageHoldingDays,
      unmatchedExitCount: summary.unmatchedExitCount,
      ...confidence,
      tone: "neutral",
      verdict: "样本积累中",
      detail: `已完成 ${sampleCount}/${requiredSamples} 个 FIFO 闭合回合，还差 ${remainingSamples} 个；暂不评价策略。${unmatchedNote}`,
    };
  }

  if (winCount === 0 || lossCount === 0 || payoffRatio === null || expectancy === null) {
    return {
      sampleCount,
      requiredSamples,
      remainingSamples,
      ready,
      winCount,
      lossCount,
      breakevenCount,
      winRatePct,
      payoffRatio,
      expectancy,
      averageWin,
      averageLoss,
      grossProfit,
      grossLoss,
      averageHoldingDays,
      unmatchedExitCount: summary.unmatchedExitCount,
      ...confidence,
      tone: "caution",
      verdict: "样本结构不完整",
      detail: `已有 ${sampleCount} 个 FIFO 闭合回合，但缺少${winCount === 0 ? "盈利" : "亏损"}回合，盈亏比暂不可比较。${unmatchedNote}`,
    };
  }

  const positiveEdge = expectancy > 0 && payoffRatio >= 1.2;
  const negativeEdge = expectancy <= 0 || (winRatePct ?? 0) < 40 && payoffRatio < 1;
  return {
    sampleCount,
    requiredSamples,
    remainingSamples,
    ready,
    winCount,
    lossCount,
    breakevenCount,
    winRatePct,
    payoffRatio,
    expectancy,
    averageWin,
    averageLoss,
    grossProfit,
    grossLoss,
    averageHoldingDays,
    unmatchedExitCount: summary.unmatchedExitCount,
    ...confidence,
    tone: positiveEdge ? "positive" : negativeEdge ? "negative" : "caution",
    verdict: positiveEdge ? "样本内正期望" : negativeEdge ? "样本内负期望" : "优势尚不明确",
    detail: `基于 ${sampleCount} 个 FIFO 闭合回合：${winCount} 胜 / ${lossCount} 负 / ${breakevenCount} 平，平均持有 ${formatHoldingDays(averageHoldingDays)}。${unmatchedNote}`,
  };
}

function quantityTolerance(quantity: number) {
  return Math.max(1e-8, Math.abs(quantity) * 1e-8);
}

function calendarDaysBetween(openedRunDate: string, closedRunDate: string) {
  const opened = Date.parse(`${openedRunDate}T00:00:00Z`);
  const closed = Date.parse(`${closedRunDate}T00:00:00Z`);
  if (!Number.isFinite(opened) || !Number.isFinite(closed)) return 0;
  return Math.max(0, (closed - opened) / 86_400_000);
}

function formatHoldingDays(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} 个自然日`;
}

function paperTradeConfidenceFor(sampleCount: number): Pick<
  PaperTradePerformance,
  "confidence" | "confidenceLabel" | "nextConfidenceSample"
> {
  if (sampleCount >= 60) {
    return { confidence: "stable", confidenceLabel: "较稳定", nextConfidenceSample: null };
  }
  if (sampleCount >= 30) {
    return { confidence: "reference", confidenceLabel: "可参考", nextConfidenceSample: 60 };
  }
  if (sampleCount >= PAPER_TRADE_PERFORMANCE_MIN_SAMPLES) {
    return { confidence: "preliminary", confidenceLabel: "初步", nextConfidenceSample: 30 };
  }
  return {
    confidence: "collecting",
    confidenceLabel: "积累中",
    nextConfidenceSample: PAPER_TRADE_PERFORMANCE_MIN_SAMPLES,
  };
}

export function normalizePaperSimState(value: PaperSimState | null | undefined): PaperSimState {
  const fallback = defaultPaperSimState();
  if (!value || typeof value !== "object") return fallback;
  const tradeContext: PaperSimTradeContext = {
    profileKey: stringValue(value.profileKey),
    profileName: stringValue(value.profileName),
    strategyKey: stringValue(value.strategyKey),
    strategyName: stringValue(value.strategyName),
  };
  const positions = Array.isArray(value.positions) ? value.positions.map(normalizePaperPosition).filter(Boolean) as PaperSimPosition[] : [];
  const pendingFundOrders = Array.isArray(value.pendingFundOrders)
    ? value.pendingFundOrders.map((order) => normalizePendingFundOrder(order, tradeContext)).filter(Boolean) as PaperSimPendingFundOrder[]
    : [];
  const trades = Array.isArray(value.trades)
    ? value.trades.map((trade) => normalizePaperTrade(trade, tradeContext)).filter(Boolean) as PaperSimTrade[]
    : [];
  const snapshots = Array.isArray(value.snapshots) ? value.snapshots.map(normalizePaperSnapshot).filter(Boolean) as PaperSimSnapshot[] : [];
  return {
    version: PAPER_SIM_VERSION,
    active: Boolean(value.active),
    accountId: stringValue(value.accountId, fallback.accountId),
    experimentName: stringValue(value.experimentName, fallback.experimentName),
    profileKey: stringValue(value.profileKey),
    profileName: stringValue(value.profileName),
    strategyKey: stringValue(value.strategyKey),
    strategyName: stringValue(value.strategyName),
    presetKey: stringValue(value.presetKey),
    presetLabel: stringValue(value.presetLabel),
    currency: stringValue(value.currency, fallback.currency),
    initialCapital: positiveNumber(value.initialCapital, 0),
    cash: numberValue(value.cash, 0),
    positions,
    pendingFundOrders,
    trades: trades.slice(0, MAX_PAPER_SIM_TRADES),
    snapshots: snapshots.slice(0, MAX_PAPER_SIM_SNAPSHOTS),
    startedAt: stringValue(value.startedAt),
    updatedAt: stringValue(value.updatedAt, new Date().toISOString()),
    lastRunDate: stringValue(value.lastRunDate),
    nextRunHint: stringValue(value.nextRunHint, fallback.nextRunHint),
  };
}

export function paperSimRunButtonLabel(summary: PaperSimSummary) {
  if (!summary.active) return "启动自动";
  return summary.lastRunDate ? "运行今日" : "先跑一次";
}

export function paperSimMetricLabel(value: number, currency: string) {
  return value > 0 ? formatMoney(value, currency) : "—";
}

export function paperSimCompactReturn(summary: PaperSimSummary) {
  return `${formatPercent(summary.pnlPct)} / 回撤 ${formatPercent(summary.maxDrawdownPct)}`;
}

export function paperFundOrderStatusLabel(order: PaperSimPendingFundOrder) {
  if (order.settlementStage === "replacement-paused") return "替换已暂停";
  if (order.settlementStage === "cash-pending") return "等待资金到账";
  return order.confirmedNav > 0 ? "等待份额确认" : "等待净值确认";
}

export function paperFundOrderNextDate(order: PaperSimPendingFundOrder) {
  if (order.settlementStage === "replacement-paused") return "等待恢复申购";
  if (order.settlementStage === "cash-pending") return `预计 ${order.cashArrivalDate} 到账`;
  return `净值 ${order.navDate} · 确认 ${order.confirmDate}`;
}

export function pendingFundOrderValue(order: PaperSimPendingFundOrder) {
  if (order.settlementStage === "cash-pending" && !order.cashCredited) {
    return Math.max(0, order.settledGross - order.settledFee);
  }
  return order.reservedCash;
}

function seedPositionsFromHoldings(holdings: HoldingRecord[]) {
  return holdings
    .filter((holding) => !isCashHolding(holding) && holding.quantity > 0 && holding.currentPrice > 0)
    .map((holding) => markPaperPosition({
      symbol: symbolKey(holding.symbol),
      name: holding.name || symbolKey(holding.symbol),
      currency: holding.currency || "CNY",
      quantity: holding.quantity,
      availableQuantity: holding.quantity,
      avgCost: firstPositiveNumber(holding.costPrice, holding.currentPrice) ?? holding.currentPrice,
      lastPrice: holding.currentPrice,
      marketValue: holding.quantity * holding.currentPrice,
      realizedPnl: 0,
      unrealizedPnl: 0,
    }, holding.currentPrice));
}


export function markPaperPosition(position: PaperSimPosition, price: number): PaperSimPosition {
  const lastPrice = firstPositiveNumber(price, position.lastPrice, position.avgCost) ?? 0;
  const marketValue = position.quantity * lastPrice;
  return {
    ...position,
    lastPrice,
    marketValue,
    unrealizedPnl: (lastPrice - position.avgCost) * position.quantity,
  };
}


function normalizePaperPosition(value: PaperSimPosition | null | undefined): PaperSimPosition | null {
  if (!value || typeof value !== "object") return null;
  const symbol = stringValue(value.symbol).trim();
  if (!symbol) return null;
  const quantity = positiveNumber(value.quantity, 0);
  const lastPrice = positiveNumber(value.lastPrice, positiveNumber(value.avgCost, 0));
  return markPaperPosition({
    symbol: symbolKey(symbol),
    name: stringValue(value.name, symbolKey(symbol)),
    currency: stringValue(value.currency, "CNY"),
    quantity,
    availableQuantity: positiveNumber(value.availableQuantity, quantity),
    avgCost: positiveNumber(value.avgCost, lastPrice),
    lastPrice,
    marketValue: numberValue(value.marketValue, quantity * lastPrice),
    realizedPnl: numberValue(value.realizedPnl, 0),
    unrealizedPnl: numberValue(value.unrealizedPnl, 0),
  }, lastPrice);
}

function normalizePendingFundOrder(
  value: PaperSimPendingFundOrder | null | undefined,
  fallbackContext: PaperSimTradeContext,
): PaperSimPendingFundOrder | null {
  if (!value || typeof value !== "object") return null;
  const symbol = stringValue(value.symbol).trim();
  const confirmDate = stringValue(value.confirmDate).trim();
  const submittedDate = stringValue(value.submittedDate);
  const referenceNav = positiveNumber(value.referenceNav, 0);
  if (!symbol || !confirmDate) return null;
  return {
    id: stringValue(value.id, `pfund-${Date.now()}-${symbol}`),
    submittedAt: stringValue(value.submittedAt, new Date().toISOString()),
    submittedDate,
    submittedAfterCutoff: Boolean(value.submittedAfterCutoff),
    cutoffTime: stringValue(value.cutoffTime, DEFAULT_FUND_EXECUTION_POLICY.cutoffTime),
    navDate: stringValue(value.navDate, submittedDate || confirmDate),
    navCapturedDate: stringValue(value.navCapturedDate, value.submittedAfterCutoff ? "" : submittedDate),
    navSource: stringValue(value.navSource),
    confirmDate,
    cashArrivalDate: stringValue(value.cashArrivalDate, confirmDate),
    settlementStage: value.settlementStage === "cash-pending"
      ? "cash-pending"
      : value.settlementStage === "replacement-paused"
        ? "replacement-paused"
        : "nav-pending",
    settledGross: positiveNumber(value.settledGross, 0),
    settledFee: positiveNumber(value.settledFee, 0),
    settledQuantity: positiveNumber(value.settledQuantity, 0),
    cashCredited: Boolean(value.cashCredited),
    symbol: symbolKey(symbol),
    name: stringValue(value.name, symbolKey(symbol)),
    side: value.side === "SELL" ? "SELL" : "BUY",
    requestedNotional: positiveNumber(value.requestedNotional, 0),
    referenceNav,
    confirmedNav: positiveNumber(value.confirmedNav, value.submittedAfterCutoff ? 0 : referenceNav),
    buyFeeRate: numberValue(value.buyFeeRate, DEFAULT_FUND_EXECUTION_POLICY.defaultBuyFeeRate),
    sellFeeRate: numberValue(value.sellFeeRate, DEFAULT_FUND_EXECUTION_POLICY.defaultSellFeeRate),
    reservedCash: positiveNumber(value.reservedCash, 0),
    reservedQuantity: positiveNumber(value.reservedQuantity, 0),
    orderKey: stringValue(value.orderKey),
    source: stringValue(value.source),
    profileKey: stringValue(value.profileKey, fallbackContext.profileKey),
    profileName: stringValue(value.profileName, fallbackContext.profileName),
    strategyKey: stringValue(value.strategyKey, fallbackContext.strategyKey),
    strategyName: stringValue(value.strategyName, fallbackContext.strategyName),
    decisionState: stringValue(value.decisionState),
    decisionDetail: stringValue(value.decisionDetail),
    targetWeight: stringValue(value.targetWeight),
    scalingPolicyKey: stringValue(value.scalingPolicyKey),
    strategyInstanceKey: stringValue(value.strategyInstanceKey),
    trancheIndex: Math.max(0, Math.round(numberValue(value.trancheIndex, 0))),
    replacementLink: normalizeReplacementOrderLink(value.replacementLink),
  };
}

function normalizeReplacementOrderLink(value: ReplacementOrderLink | null | undefined): ReplacementOrderLink | null {
  if (!value || typeof value !== "object") return null;
  const id = stringValue(value.id);
  const sourceSymbol = symbolKey(stringValue(value.sourceSymbol));
  const targetSymbol = symbolKey(stringValue(value.targetSymbol));
  if (!id || !sourceSymbol || !targetSymbol) return null;
  return {
    id,
    stage: value.stage === "subscribe" ? "subscribe" : "redeem",
    sourceSymbol,
    targetSymbol,
    targetName: stringValue(value.targetName, targetSymbol),
    remainingBuyAmount: positiveNumber(value.remainingBuyAmount, 0),
    batchAmount: positiveNumber(value.batchAmount, 0),
    sellFeeRatePct: positiveNumber(value.sellFeeRatePct, 0),
  };
}

function normalizePaperTrade(
  value: PaperSimTrade | null | undefined,
  fallbackContext: PaperSimTradeContext,
): PaperSimTrade | null {
  if (!value || typeof value !== "object") return null;
  const symbol = stringValue(value.symbol).trim();
  if (!symbol) return null;
  const side = value.side === "SELL" ? "SELL" : "BUY";
  return {
    id: stringValue(value.id, `ptrade-${Date.now()}-${symbol}`),
    at: stringValue(value.at, new Date().toISOString()),
    runDate: stringValue(value.runDate),
    symbol: symbolKey(symbol),
    name: stringValue(value.name, symbolKey(symbol)),
    side,
    quantity: positiveNumber(value.quantity, 0),
    price: positiveNumber(value.price, 0),
    notional: positiveNumber(value.notional, 0),
    fee: positiveNumber(value.fee, 0),
    commission: positiveNumber(value.commission, positiveNumber(value.fee, 0)),
    stampDuty: positiveNumber(value.stampDuty, 0),
    transferFee: positiveNumber(value.transferFee, 0),
    slippage: positiveNumber(value.slippage, 0),
    realizedPnl: numberValue(value.realizedPnl, 0),
    orderKey: stringValue(value.orderKey),
    source: stringValue(value.source),
    ruleLabel: stringValue(value.ruleLabel, "通用模拟"),
    ruleNote: stringValue(value.ruleNote),
    profileKey: stringValue(value.profileKey, fallbackContext.profileKey),
    profileName: stringValue(value.profileName, fallbackContext.profileName),
    strategyKey: stringValue(value.strategyKey, fallbackContext.strategyKey),
    strategyName: stringValue(value.strategyName, fallbackContext.strategyName),
    decisionState: stringValue(value.decisionState),
    decisionDetail: stringValue(value.decisionDetail),
    targetWeight: stringValue(value.targetWeight),
    scalingPolicyKey: stringValue(value.scalingPolicyKey),
    strategyInstanceKey: stringValue(value.strategyInstanceKey),
    trancheIndex: Math.max(0, Math.round(numberValue(value.trancheIndex, 0))),
    replacementLink: normalizeReplacementOrderLink(value.replacementLink),
  };
}

function normalizePaperSnapshot(value: PaperSimSnapshot | null | undefined): PaperSimSnapshot | null {
  if (!value || typeof value !== "object") return null;
  return {
    id: stringValue(value.id, `psnap-${Date.now()}`),
    at: stringValue(value.at, new Date().toISOString()),
    runDate: stringValue(value.runDate),
    equity: positiveNumber(value.equity, 0),
    cash: numberValue(value.cash, 0),
    positionValue: positiveNumber(value.positionValue, 0),
    pnl: numberValue(value.pnl, 0),
    pnlPct: numberValue(value.pnlPct, 0),
    drawdownPct: numberValue(value.drawdownPct, 0),
    previousEquity: positiveNumber(value.previousEquity, positiveNumber(value.equity, 0)),
    dailyPnl: numberValue(value.dailyPnl, 0),
    dailyPnlPct: numberValue(value.dailyPnlPct, 0),
    marketPnl: numberValue(value.marketPnl, 0),
    executionPnl: numberValue(value.executionPnl, 0),
    feePnl: numberValue(value.feePnl, 0),
    otherPnl: numberValue(value.otherPnl, 0),
    benchmarkSymbol: stringValue(value.benchmarkSymbol),
    benchmarkAvailable: Boolean(value.benchmarkAvailable),
    benchmarkDailyReturnPct: numberValue(value.benchmarkDailyReturnPct, 0),
    benchmarkReturnPct: numberValue(value.benchmarkReturnPct, 0),
    excessDailyReturnPct: numberValue(value.excessDailyReturnPct, 0),
    excessReturnPct: numberValue(value.excessReturnPct, numberValue(value.pnlPct, 0)),
    cumulativeFees: positiveNumber(value.cumulativeFees, 0),
    feeDragPct: numberValue(value.feeDragPct, 0),
    tradeCount: Math.max(0, Math.round(numberValue(value.tradeCount, 0))),
    skippedCount: Math.max(0, Math.round(numberValue(value.skippedCount, 0))),
    summary: stringValue(value.summary),
  };
}

export function symbolKey(symbol: string) {
  return symbol.trim().toUpperCase();
}

function stringValue(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function numberValue(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function positiveNumber(value: unknown, fallback: number) {
  const number = numberValue(value, fallback);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

export function firstPositiveNumber(...values: Array<number | null | undefined>) {
  return values.find((value) => typeof value === "number" && Number.isFinite(value) && value > 0) ?? null;
}
