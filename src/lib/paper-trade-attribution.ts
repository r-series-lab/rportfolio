import {
  normalizePaperSimState,
  paperTradePerformanceFor,
  type PaperSimState,
  type PaperSimTrade,
} from "./paper-sim";
import type { LabTone } from "./strategy-engine";

export type PaperTradeAttributionRow = {
  id: string;
  symbol: string;
  runDate: string;
  netPnl: number;
  holdingPnl: number;
  feeDrag: number;
  slippageDrag: number;
  returnPct: number;
  positionSharePct: number;
  decisionDetail: string;
};

export type PaperTradeAttributionSummary = {
  sampleCount: number;
  ready: boolean;
  netPnl: number;
  holdingPnl: number;
  feeDrag: number;
  slippageDrag: number;
  averageFeeBps: number;
  averageSlippageBps: number;
  largeLossSharePct: number;
  driverKey: "collecting" | "position-size" | "holding" | "slippage" | "fees" | "healthy";
  primaryDriver: string;
  recommendation: string;
  tone: LabTone;
  latest: PaperTradeAttributionRow | null;
};

export function paperTradeAttributionFor(state: PaperSimState): PaperTradeAttributionSummary {
  const normalized = normalizePaperSimState(state);
  const performance = paperTradePerformanceFor(normalized);
  const rows = normalized.trades
    .filter(isRealizedExit)
    .map((trade) => attributionRow(trade, normalized.initialCapital));
  const netPnl = sum(rows.map((row) => row.netPnl));
  const holdingPnl = sum(rows.map((row) => row.holdingPnl));
  const feeDrag = sum(rows.map((row) => row.feeDrag));
  const slippageDrag = sum(rows.map((row) => row.slippageDrag));
  const averageFeeBps = average(normalized.trades.filter(isRealizedExit).map((trade) => bps(trade.fee, trade.notional)));
  const averageSlippageBps = average(normalized.trades.filter(isRealizedExit).map((trade) => bps(trade.slippage, trade.notional)));
  const totalLoss = Math.abs(sum(rows.filter((row) => row.netPnl < 0).map((row) => row.netPnl)));
  const largeLoss = Math.abs(sum(rows.filter((row) => row.netPnl < 0 && row.positionSharePct >= 15).map((row) => row.netPnl)));
  const largeLossSharePct = totalLoss > 0 ? (largeLoss / totalLoss) * 100 : 0;
  const verdict = attributionVerdict({
    averageFeeBps,
    averageSlippageBps,
    feeDrag,
    holdingPnl,
    largeLossSharePct,
    performanceReady: performance.ready,
    sampleCount: rows.length,
  });

  return {
    sampleCount: rows.length,
    ready: performance.ready,
    netPnl,
    holdingPnl,
    feeDrag,
    slippageDrag,
    averageFeeBps,
    averageSlippageBps,
    largeLossSharePct,
    ...verdict,
    latest: rows[0] ?? null,
  };
}

function attributionRow(trade: PaperSimTrade, initialCapital: number): PaperTradeAttributionRow {
  const holdingPnl = trade.realizedPnl + trade.fee + trade.slippage;
  const costBasis = Math.max(0.01, trade.notional - (trade.realizedPnl + trade.fee));
  return {
    id: trade.id,
    symbol: trade.symbol,
    runDate: trade.runDate,
    netPnl: trade.realizedPnl,
    holdingPnl,
    feeDrag: -trade.fee,
    slippageDrag: -trade.slippage,
    returnPct: (trade.realizedPnl / costBasis) * 100,
    positionSharePct: initialCapital > 0 ? (trade.notional / initialCapital) * 100 : 0,
    decisionDetail: trade.decisionDetail || trade.ruleNote || trade.ruleLabel,
  };
}

function attributionVerdict({
  averageFeeBps,
  averageSlippageBps,
  feeDrag,
  holdingPnl,
  largeLossSharePct,
  performanceReady,
  sampleCount,
}: {
  averageFeeBps: number;
  averageSlippageBps: number;
  feeDrag: number;
  holdingPnl: number;
  largeLossSharePct: number;
  performanceReady: boolean;
  sampleCount: number;
}): Pick<PaperTradeAttributionSummary, "driverKey" | "primaryDriver" | "recommendation" | "tone"> {
  if (!performanceReady) {
    return {
      driverKey: "collecting",
      primaryDriver: "等待有效样本",
      recommendation: `已归因 ${sampleCount}/10 笔；满 10 笔后再给参数调整建议。`,
      tone: "neutral",
    };
  }
  if (largeLossSharePct >= 50) {
    return {
      driverKey: "position-size",
      primaryDriver: "大仓位亏损拖累",
      recommendation: "下一轮将单次新增仓位限制为账户权益 5%，同一标的至少分 2 批执行，并继续服从 Profile 仓位上限。",
      tone: "negative",
    };
  }
  if (holdingPnl <= 0) {
    return {
      driverKey: "holding",
      primaryDriver: "持有结果为负",
      recommendation: "先暂停放大仓位；只执行触发条件完整的建议，失效条件出现后的下一交易日优先减仓。",
      tone: "negative",
    };
  }
  if (averageSlippageBps > 20) {
    return {
      driverKey: "slippage",
      primaryDriver: "退出滑点偏高",
      recommendation: "A 股与 ETF 优先使用限价，单笔拆成 2–3 批；价格偏离计划价超过 20 bps 时不追价。",
      tone: "caution",
    };
  }
  const executionCost = Math.abs(feeDrag);
  if (averageFeeBps > 15 || executionCost > Math.max(1, holdingPnl) * 0.2) {
    return {
      driverKey: "fees",
      primaryDriver: "交易费用侵蚀",
      recommendation: "合并同方向小额委托；预估费用高于成交额 15 bps 时延后执行，避免短周期反复调仓。",
      tone: "caution",
    };
  }
  return {
    driverKey: "healthy",
    primaryDriver: "持有结果有效",
    recommendation: "保持当前规则并继续扩样，不提高单笔仓位；达到下一可信度等级后再调整策略参数。",
    tone: "positive",
  };
}

function isRealizedExit(trade: PaperSimTrade) {
  return trade.side === "SELL" && trade.quantity > 0 && trade.notional > 0 && Number.isFinite(trade.realizedPnl);
}

function bps(value: number, notional: number) {
  return notional > 0 ? (Math.abs(value) / notional) * 10_000 : 0;
}

function average(values: number[]) {
  const finite = values.filter(Number.isFinite);
  return finite.length ? sum(finite) / finite.length : 0;
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}
