import { normalizePaperSimState, paperTradePerformanceFor, type PaperSimState, type PaperSimTrade } from "./paper-sim";
import { paperTradeAttributionFor } from "./paper-trade-attribution";
import type { LabTone } from "./strategy-engine";

export type PaperExperimentMetrics = {
  tradeCount: number;
  netPnl: number;
  winRatePct: number;
  payoffRatio: number | null;
  worstTradePnl: number;
};

export type PaperStrategyExperiment = {
  ready: boolean;
  variantLabel: string;
  changeSummary: string;
  assumption: string;
  baseline: PaperExperimentMetrics;
  candidate: PaperExperimentMetrics;
  pnlDelta: number;
  worstLossImprovement: number;
  preferred: "A" | "B" | "hold";
  verdict: string;
  tone: LabTone;
};

type ReplaySample = {
  active: boolean;
  pnl: number;
};

export function paperStrategyExperimentFor(state: PaperSimState): PaperStrategyExperiment {
  const normalized = normalizePaperSimState(state);
  const performance = paperTradePerformanceFor(normalized);
  const attribution = paperTradeAttributionFor(normalized);
  const exits = normalized.trades.filter(isRealizedExit);
  const baselineSamples = exits.map((trade) => ({ active: true, pnl: trade.realizedPnl }));
  const variant = experimentVariant(attribution.driverKey);
  const candidateSamples = exits.map((trade) => replayTrade(trade, normalized.initialCapital, variant.key));
  const baseline = metricsFor(baselineSamples);
  const candidate = metricsFor(candidateSamples);
  const pnlDelta = candidate.netPnl - baseline.netPnl;
  const worstLossImprovement = Math.abs(Math.min(0, baseline.worstTradePnl))
    - Math.abs(Math.min(0, candidate.worstTradePnl));

  if (!performance.ready) {
    return {
      ready: false,
      ...variant,
      baseline,
      candidate,
      pnlDelta,
      worstLossImprovement,
      preferred: "hold",
      verdict: `${performance.sampleCount}/${performance.requiredSamples} 笔后启用`,
      tone: "neutral",
    };
  }

  if (variant.key === "hold") {
    return {
      ready: true,
      ...variant,
      baseline,
      candidate,
      pnlDelta,
      worstLossImprovement,
      preferred: "A",
      verdict: "保持 A 参数",
      tone: "positive",
    };
  }

  if (candidate.tradeCount < performance.requiredSamples) {
    return {
      ready: true,
      ...variant,
      baseline,
      candidate,
      pnlDelta,
      worstLossImprovement,
      preferred: "hold",
      verdict: `B 仅 ${candidate.tradeCount} 笔，暂不选择`,
      tone: "neutral",
    };
  }

  const materialPnlImprovement = pnlDelta > Math.max(1, Math.abs(baseline.netPnl) * 0.03);
  const materialRiskImprovement = worstLossImprovement > Math.max(1, Math.abs(baseline.worstTradePnl) * 0.1);
  const acceptablePnlCost = candidate.netPnl >= baseline.netPnl - Math.max(1, Math.abs(baseline.netPnl) * 0.05);
  const preferB = materialPnlImprovement || materialRiskImprovement && acceptablePnlCost;

  return {
    ready: true,
    ...variant,
    baseline,
    candidate,
    pnlDelta,
    worstLossImprovement,
    preferred: preferB ? "B" : "A",
    verdict: preferB ? "B 值得继续模拟" : "A 暂时更优",
    tone: preferB ? "positive" : pnlDelta < 0 ? "caution" : "neutral",
  };
}

function experimentVariant(driverKey: ReturnType<typeof paperTradeAttributionFor>["driverKey"]): {
  key: "position-cap" | "loss-cap" | "slippage-cap" | "small-order-filter" | "hold";
  variantLabel: string;
  changeSummary: string;
  assumption: string;
} {
  if (driverKey === "position-size") {
    return {
      key: "position-cap",
      variantLabel: "单笔上限 5%",
      changeSummary: "B 将每笔退出对应的投入规模压到初始权益 5%，收益与亏损按实际回报率同比缩放。",
      assumption: "仅改变仓位，不改变买卖时点；用于验证集中仓位是否放大亏损。",
    };
  }
  if (driverKey === "holding") {
    return {
      key: "loss-cap",
      variantLabel: "单笔止损 5%",
      changeSummary: "B 将单笔已实现亏损限制为成本基数的 5%。",
      assumption: "假设止损价可成交且没有跳空；真实执行结果可能更差。",
    };
  }
  if (driverKey === "slippage") {
    return {
      key: "slippage-cap",
      variantLabel: "滑点上限 20bps",
      changeSummary: "B 使用限价与拆单，将退出滑点按成交额最多计 20 bps。",
      assumption: "只回补超出 20 bps 的历史滑点，不假设获得更好的市场价格。",
    };
  }
  if (driverKey === "fees") {
    return {
      key: "small-order-filter",
      variantLabel: "过滤权益 1% 小单",
      changeSummary: "B 不执行成交额低于初始权益 1% 的小额退出，验证频繁小单是否值得。",
      assumption: "被过滤交易按未发生处理，不模拟其后续替代交易。",
    };
  }
  return {
    key: "hold",
    variantLabel: "保持当前参数",
    changeSummary: "当前归因未发现值得立即调整的单一参数。",
    assumption: "继续积累样本，避免为了优化历史结果而过拟合。",
  };
}

function replayTrade(
  trade: PaperSimTrade,
  initialCapital: number,
  variant: ReturnType<typeof experimentVariant>["key"],
): ReplaySample {
  if (variant === "position-cap") {
    const cap = Math.max(0, initialCapital * 0.05);
    const scale = trade.notional > 0 && cap > 0 ? Math.min(1, cap / trade.notional) : 1;
    return { active: true, pnl: trade.realizedPnl * scale };
  }
  if (variant === "loss-cap") {
    const costBasis = Math.max(0.01, trade.notional - (trade.realizedPnl + trade.fee));
    return { active: true, pnl: Math.max(trade.realizedPnl, -costBasis * 0.05) };
  }
  if (variant === "slippage-cap") {
    const cappedSlippage = trade.notional * 0.002;
    const recoveredSlippage = Math.max(0, trade.slippage - cappedSlippage);
    return { active: true, pnl: trade.realizedPnl + recoveredSlippage };
  }
  if (variant === "small-order-filter") {
    const minimumNotional = Math.max(0, initialCapital * 0.01);
    return { active: trade.notional >= minimumNotional, pnl: trade.realizedPnl };
  }
  return { active: true, pnl: trade.realizedPnl };
}

function metricsFor(samples: ReplaySample[]): PaperExperimentMetrics {
  const active = samples.filter((sample) => sample.active);
  const wins = active.filter((sample) => sample.pnl > 0.005);
  const losses = active.filter((sample) => sample.pnl < -0.005);
  const grossProfit = sum(wins.map((sample) => sample.pnl));
  const grossLoss = Math.abs(sum(losses.map((sample) => sample.pnl)));
  const averageWin = wins.length ? grossProfit / wins.length : null;
  const averageLoss = losses.length ? grossLoss / losses.length : null;
  return {
    tradeCount: active.length,
    netPnl: sum(active.map((sample) => sample.pnl)),
    winRatePct: active.length ? (wins.length / active.length) * 100 : 0,
    payoffRatio: averageWin !== null && averageLoss !== null && averageLoss > 0 ? averageWin / averageLoss : null,
    worstTradePnl: active.length ? Math.min(...active.map((sample) => sample.pnl)) : 0,
  };
}

function isRealizedExit(trade: PaperSimTrade) {
  return trade.side === "SELL" && trade.quantity > 0 && trade.notional > 0 && Number.isFinite(trade.realizedPnl);
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}
