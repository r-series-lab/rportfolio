import type {
  AssetStatus,
  PriceActionAnalysis,
  PriceActionSignal,
  PriceActionSnapshot,
  StructureAnalysis,
  TechnicalRow,
} from "./types";

type PriceActionInput = {
  assetStatuses?: AssetStatus[];
  structure?: StructureAnalysis | null;
  technicalRows: TechnicalRow[];
};

type NumericInput = number | null | undefined;

export function analyzePriceAction({
  assetStatuses = [],
  structure = null,
  technicalRows,
}: PriceActionInput): PriceActionAnalysis {
  const assetBySymbol = new Map(assetStatuses.map((asset) => [symbolKey(asset.symbol), asset]));
  const snapshots = technicalRows.map((row) => snapshotFor(row, assetBySymbol.get(symbolKey(row.symbol)) ?? null));
  const signals = snapshots.flatMap((snapshot) => snapshot.signals);
  const primarySignal = signals.sort(compareSignals)[0] ?? null;
  const score = snapshots.length
    ? Math.round(snapshots.reduce((sum, item) => sum + item.score, 0) / snapshots.length)
    : 50;
  const tone = scoreTone(score, primarySignal?.tone);
  const label = score >= 72
    ? "结构可交易"
    : score >= 58
      ? "结构待确认"
      : score >= 42
        ? "结构偏弱"
        : "结构防守";
  const riskCount = snapshots.filter((item) => item.tone === "negative").length;
  const cautionCount = snapshots.filter((item) => item.tone === "caution").length;
  const structureNote = structure?.trend ? `组合结构：${asSentence(structure.trend)}` : "";
  const summary = snapshots.length
    ? `${label} ${score}/100，${snapshots.length} 个标的中 ${riskCount} 个破位、${cautionCount} 个需要确认。${primarySignal ? `主信号：${primarySignal.symbol} ${primarySignal.label}。` : ""}${structureNote}`
    : "缺少技术行，暂时无法生成价格行为分析。";

  return {
    score,
    label,
    tone,
    summary,
    primarySignal,
    snapshots,
  };
}

export function priceActionForSymbol(analysis: PriceActionAnalysis | null | undefined, symbol: string) {
  const key = symbolKey(symbol);
  return analysis?.snapshots.find((snapshot) => symbolKey(snapshot.symbol) === key) ?? null;
}

export function topPriceActionSignals(analysis: PriceActionAnalysis | null | undefined, limit = 6) {
  return [...(analysis?.snapshots.flatMap((snapshot) => snapshot.signals) ?? [])]
    .sort(compareSignals)
    .slice(0, limit);
}

function snapshotFor(row: TechnicalRow, asset: AssetStatus | null): PriceActionSnapshot {
  const close = positiveNumber(row.close);
  const ma20 = positiveNumber(row.ma20);
  const ma50 = positiveNumber(row.ma50);
  const ma200 = positiveNumber(row.ma200);
  const rsi = finiteNumber(row.rsi14);
  const kdjJ = finiteNumber(row.kdjJ);
  const macd = finiteNumber(row.macd);
  const macdSignal = finiteNumber(row.macdSignal);
  const macdHistogram = finiteNumber(row.macdHistogram);
  const volumeRatio = finiteNumber(row.volumeRatio);
  const return20d = finiteNumber(row.return20d) ?? 0;
  const change1d = finiteNumber(row.change1d) ?? 0;
  const inverseRiskProxy = isInverseRiskProxy(row, asset);
  const ma20Gap = close && ma20 ? percentGap(close, ma20) : null;
  const ma50Gap = close && ma50 ? percentGap(close, ma50) : null;
  const support = firstPositive(ma20, ma50, close ? close * 0.96 : null);
  const resistance = close
    ? close * (return20d > 12 ? 1.025 : return20d > 4 ? 1.045 : 1.07)
    : firstPositive(ma20, ma50, ma200);
  const invalidation = firstPositive(ma50, ma20 ? ma20 * 0.975 : null, close ? close * 0.93 : null);
  const signals = buildSignals({
    asset,
    change1d,
    close,
    invalidation,
    inverseRiskProxy,
    kdjJ,
    ma20,
    ma20Gap,
    ma50,
    ma50Gap,
    macd,
    macdHistogram,
    macdSignal,
    resistance,
    return20d,
    row,
    rsi,
    support,
    volumeRatio,
  });
  const structureScore = inverseRiskProxy
    ? inverseRiskStructureScoreFor({ close, ma20, ma50, return20d })
    : structureScoreFor({ close, ma20, ma50, ma200, ma20Gap, ma50Gap, return20d });
  const momentumScore = inverseRiskProxy
    ? inverseRiskMomentumScoreFor({ change1d, rsi, return20d, volumeRatio })
    : momentumScoreFor({ kdjJ, macdHistogram, rsi, return20d, volumeRatio });
  const riskScore = inverseRiskProxy
    ? inverseRiskScoreFor({ change1d, close, ma20, ma50, rsi, return20d, volumeRatio })
    : riskScoreFor({ close, ma20, ma50, ma20Gap, ma50Gap, rsi, return20d, volumeRatio });
  const score = clamp(Math.round(structureScore * 0.44 + momentumScore * 0.3 + (100 - riskScore) * 0.26), 0, 100);
  const phase = phaseFor({ close, inverseRiskProxy, kdjJ, ma20, ma20Gap, ma50, return20d, riskScore, rsi, score, signals, volumeRatio });
  const tone = phaseTone(phase, score);

  return {
    symbol: row.symbol,
    label: row.label || asset?.label || row.symbol,
    phase,
    phaseLabel: phaseLabel(phase),
    tone,
    score,
    structureScore,
    momentumScore,
    riskScore,
    support: priceLabel(support),
    resistance: priceLabel(resistance),
    invalidation: priceLabel(invalidation),
    entryTrigger: entryTriggerFor(phase, ma20, resistance),
    summary: summaryFor(phase, score, signals),
    signals,
  };
}

type SignalInput = {
  asset: AssetStatus | null;
  change1d: number;
  close: number | null;
  invalidation: number | null;
  inverseRiskProxy: boolean;
  kdjJ: number | null;
  ma20: number | null;
  ma20Gap: number | null;
  ma50: number | null;
  ma50Gap: number | null;
  macd: number | null;
  macdHistogram: number | null;
  macdSignal: number | null;
  resistance: number | null;
  return20d: number;
  row: TechnicalRow;
  rsi: number | null;
  support: number | null;
  volumeRatio: number | null;
};

function buildSignals(input: SignalInput): PriceActionSignal[] {
  const signals: PriceActionSignal[] = [];
  const { close, ma20, ma20Gap, ma50, ma50Gap, return20d, row } = input;
  const symbol = row.symbol;
  const symbolLabel = row.label || input.asset?.label || row.symbol;
  const add = (signal: Omit<PriceActionSignal, "symbol" | "symbolLabel">) => {
    signals.push({ ...signal, symbol, symbolLabel });
  };

  if (input.inverseRiskProxy) {
    if (close && ma20 && ma50 && close < ma20 && close < ma50) {
      add({
        key: `${symbol}:risk-proxy-cooling`,
        label: "恐慌降温",
        category: "risk",
        direction: "bullish",
        tone: "positive",
        strength: clamp(Math.round(60 + Math.abs(return20d) * 0.8 + Math.abs(ma50Gap ?? 0) * 1.2), 54, 88),
        level: priceLabel(ma50),
        condition: `低于 MA50 ${priceLabel(ma50)}`,
        invalidation: `重新升破 MA20 ${priceLabel(ma20)}`,
        detail: "风险代理价格走弱，代表外部恐慌压力下降，可作为权益风险门的正向确认。",
        ruleType: "risk_proxy_cooling",
      });
    }

    if (close && ma20 && (close > ma20 || return20d > 8 || input.change1d > 5)) {
      add({
        key: `${symbol}:risk-proxy-heating`,
        label: "恐慌升温",
        category: "risk",
        direction: "bearish",
        tone: "negative",
        strength: clamp(Math.round(62 + Math.max(0, return20d) * 0.9 + Math.max(0, input.change1d) * 1.5), 55, 94),
        level: priceLabel(ma20),
        condition: `升破或接近 MA20 ${priceLabel(ma20)}`,
        invalidation: `重新跌回 MA50 ${priceLabel(ma50)}`,
        detail: "风险代理抬升，代表市场避险压力升高，新增权益仓位需要收紧。",
        ruleType: "risk_proxy_heating",
      });
    }

    if (Math.abs(input.return20d) <= 3 && close && ma20 && ma50) {
      add({
        key: `${symbol}:risk-proxy-range`,
        label: "恐慌横盘",
        category: "risk",
        direction: "neutral",
        tone: "neutral",
        strength: clamp(Math.round(58 - Math.abs(input.return20d) * 2), 42, 70),
        level: `${priceLabel(Math.min(ma20, ma50))} - ${priceLabel(Math.max(ma20, ma50))}`,
        condition: "风险代理波动收敛",
        invalidation: `有效升破 ${priceLabel(Math.max(ma20, ma50))}`,
        detail: "风险代理暂未给出明确方向，权益信号需要等待其他资产确认。",
        ruleType: "range_compression",
      });
    }

    return signals.sort(compareSignals);
  }

  if (close && ma20 && ma50 && close > ma20 && close > ma50) {
    add({
      key: `${symbol}:trend-continuation`,
      label: "趋势延续",
      category: "trend",
      direction: "bullish",
      tone: return20d > 12 ? "caution" : "positive",
      strength: clamp(Math.round(62 + Math.max(0, ma20Gap ?? 0) * 1.4 + Math.max(0, return20d) * 0.5), 55, 92),
      level: priceLabel(ma20),
      condition: `收盘保持在 MA20 ${priceLabel(ma20)} 上方`,
      invalidation: `跌破 MA50 ${priceLabel(ma50)}`,
      detail: return20d > 12 ? "趋势仍强，但短线涨幅偏大，新增仓位需要等回踩或量能确认。" : "价格位于 MA20/MA50 上方，趋势结构可继续跟踪。",
      ruleType: "trend_continuation",
    });
  }

  if (close && ma20 && ma50 && close >= ma50 && ma20Gap != null && Math.abs(ma20Gap) <= 2.2) {
    add({
      key: `${symbol}:pullback-hold`,
      label: "回踩确认",
      category: "support",
      direction: "bullish",
      tone: return20d >= -2 ? "positive" : "caution",
      strength: clamp(Math.round(68 - Math.abs(ma20Gap) * 5 + Math.max(0, return20d) * 0.3), 42, 86),
      level: priceLabel(ma20),
      condition: `回踩 MA20 ${priceLabel(ma20)} 不破`,
      invalidation: `连续收盘跌破 MA50 ${priceLabel(ma50)}`,
      detail: "价格贴近短期均线，适合观察支撑有效性，而不是直接追涨。",
      ruleType: "pullback_hold_ma",
    });
  }

  if (close && ma20 && ma50 && (close < ma50 || (ma20Gap != null && ma20Gap < -3 && (ma50Gap ?? 0) < 0))) {
    add({
      key: `${symbol}:support-lost`,
      label: "支撑破位",
      category: "risk",
      direction: "bearish",
      tone: "negative",
      strength: clamp(Math.round(64 + Math.abs(Math.min(ma50Gap ?? 0, ma20Gap ?? 0)) * 1.8), 55, 95),
      level: priceLabel(input.invalidation),
      condition: `收盘低于 MA50 ${priceLabel(ma50)}`,
      invalidation: `重新站回 MA20 ${priceLabel(ma20)}`,
      detail: "中短期结构转弱，新增买入应等待修复，已有仓位优先复核止损线。",
      ruleType: "support_lost",
    });
  }

  if ((input.rsi ?? 0) >= 75 || (input.kdjJ ?? 0) >= 90) {
    add({
      key: `${symbol}:momentum-exhaustion`,
      label: "动能过热",
      category: "momentum",
      direction: "neutral",
      tone: "caution",
      strength: clamp(Math.round(Math.max(input.rsi ?? 0, input.kdjJ ?? 0) - 6), 55, 96),
      level: `RSI ${numberLabel(input.rsi)} / KDJ-J ${numberLabel(input.kdjJ)}`,
      condition: "RSI 或 KDJ-J 进入高位",
      invalidation: "热度回落后仍保持 MA20 上方",
      detail: "短线情绪偏热，适合防追高或拆成更小的试探单。",
      ruleType: "momentum_exhaustion",
    });
  }

  if (input.macdHistogram != null && input.macd != null && input.macdSignal != null && input.macd > input.macdSignal && input.macdHistogram > 0) {
    add({
      key: `${symbol}:macd-confirmation`,
      label: "动能确认",
      category: "momentum",
      direction: "bullish",
      tone: "positive",
      strength: clamp(Math.round(58 + Math.min(24, input.macdHistogram * 6)), 52, 86),
      level: `MACD ${numberLabel(input.macd)} / Signal ${numberLabel(input.macdSignal)}`,
      condition: "MACD 位于 Signal 上方且柱体为正",
      invalidation: "MACD 柱体重新转负",
      detail: "动能和价格方向同向，可作为趋势或回踩后的确认项。",
      ruleType: "macd_confirmation",
    });
  }

  if (input.volumeRatio != null && input.volumeRatio >= 1.45) {
    const bearish = input.change1d < 0 || (input.rsi ?? 0) >= 78;
    add({
      key: `${symbol}:volume-expansion`,
      label: bearish ? "高位放量" : "放量确认",
      category: "volume",
      direction: bearish ? "bearish" : "bullish",
      tone: bearish ? "caution" : "positive",
      strength: clamp(Math.round(52 + input.volumeRatio * 18), 55, 88),
      level: `${numberLabel(input.volumeRatio)}x`,
      condition: "成交量明显高于近期均值",
      invalidation: bearish ? "放量后收复前高且回撤缩量" : "放量后重新跌回突破位",
      detail: bearish ? "放量伴随回落或高热，可能是分歧放大。" : "放量配合价格强势，可提高突破可信度。",
      ruleType: bearish ? "distribution_volume" : "volume_breakout",
    });
  }

  if (Math.abs(input.return20d) <= 3 && (input.volumeRatio == null || input.volumeRatio <= 1.08) && close && ma20 && ma50) {
    add({
      key: `${symbol}:range-compression`,
      label: "箱体压缩",
      category: "resistance",
      direction: "neutral",
      tone: "neutral",
      strength: clamp(Math.round(62 - Math.abs(input.return20d) * 2), 45, 72),
      level: `${priceLabel(Math.min(ma20, ma50))} - ${priceLabel(Math.max(ma20, ma50))}`,
      condition: "20日涨跌幅收窄且量能不高",
      invalidation: `有效跌破 ${priceLabel(Math.min(ma20, ma50))}`,
      detail: "波动收敛，下一步更适合等方向突破或跌破后再行动。",
      ruleType: "range_compression",
    });
  }

  return signals.sort(compareSignals);
}

function structureScoreFor({
  close,
  ma20,
  ma50,
  ma200,
  ma20Gap,
  ma50Gap,
  return20d,
}: Pick<SignalInput, "close" | "ma20" | "ma50" | "ma20Gap" | "ma50Gap" | "return20d"> & { ma200: number | null }) {
  let score = 48 + clamp(return20d * 1.1, -18, 22);
  if (close && ma20 && close > ma20) score += 10;
  if (close && ma50 && close > ma50) score += 12;
  if (ma20 && ma50 && ma20 > ma50) score += 8;
  if (close && ma200 && close > ma200) score += 5;
  if ((ma20Gap ?? 0) > 10) score -= 7;
  if ((ma50Gap ?? 0) < -3) score -= 10;
  return clamp(Math.round(score), 0, 100);
}

function momentumScoreFor({
  kdjJ,
  macdHistogram,
  rsi,
  return20d,
  volumeRatio,
}: Pick<SignalInput, "kdjJ" | "macdHistogram" | "rsi" | "return20d" | "volumeRatio">) {
  let score = 50 + clamp(return20d * 0.9, -16, 18);
  if (macdHistogram != null) score += clamp(macdHistogram * 4, -12, 12);
  if (rsi != null) score += rsi >= 45 && rsi <= 68 ? 8 : rsi >= 75 || rsi <= 30 ? -8 : 0;
  if (kdjJ != null) score += kdjJ >= 90 ? -8 : kdjJ >= 45 && kdjJ <= 78 ? 5 : 0;
  if (volumeRatio != null && volumeRatio >= 1.3 && return20d > 0) score += 5;
  return clamp(Math.round(score), 0, 100);
}

function riskScoreFor({
  close,
  ma20,
  ma50,
  ma20Gap,
  ma50Gap,
  rsi,
  return20d,
  volumeRatio,
}: Pick<SignalInput, "close" | "ma20" | "ma50" | "ma20Gap" | "ma50Gap" | "rsi" | "return20d" | "volumeRatio">) {
  let score = 35;
  if (close && ma20 && close < ma20) score += 10;
  if (close && ma50 && close < ma50) score += 18;
  if ((ma50Gap ?? 0) < -5) score += 10;
  if ((ma20Gap ?? 0) > 10) score += 8;
  if ((rsi ?? 50) >= 78 || (rsi ?? 50) <= 28) score += 10;
  if (return20d > 16 || return20d < -10) score += 8;
  if ((volumeRatio ?? 0) >= 1.55) score += 6;
  return clamp(Math.round(score), 0, 100);
}

function inverseRiskStructureScoreFor({
  close,
  ma20,
  ma50,
  return20d,
}: Pick<SignalInput, "close" | "ma20" | "ma50" | "return20d">) {
  let score = 52 + clamp(-return20d * 1.25, -18, 24);
  if (close && ma20 && close < ma20) score += 12;
  if (close && ma50 && close < ma50) score += 14;
  if (ma20 && ma50 && ma20 < ma50) score += 6;
  if (return20d > 8) score -= 18;
  return clamp(Math.round(score), 0, 100);
}

function inverseRiskMomentumScoreFor({
  change1d,
  rsi,
  return20d,
  volumeRatio,
}: Pick<SignalInput, "change1d" | "rsi" | "return20d" | "volumeRatio">) {
  let score = 52 + clamp(-return20d * 0.95, -16, 18);
  if (change1d < 0) score += 6;
  if (change1d > 4) score -= 12;
  if (rsi != null) score += rsi <= 55 ? 6 : rsi >= 68 ? -10 : 0;
  if (volumeRatio != null && volumeRatio >= 1.4 && change1d > 0) score -= 8;
  return clamp(Math.round(score), 0, 100);
}

function inverseRiskScoreFor({
  change1d,
  close,
  ma20,
  ma50,
  rsi,
  return20d,
  volumeRatio,
}: Pick<SignalInput, "change1d" | "close" | "ma20" | "ma50" | "rsi" | "return20d" | "volumeRatio">) {
  let score = 34;
  if (close && ma20 && close > ma20) score += 15;
  if (close && ma50 && close > ma50) score += 18;
  if (return20d > 8) score += 14;
  if (change1d > 4) score += 10;
  if ((rsi ?? 50) >= 68) score += 10;
  if ((volumeRatio ?? 0) >= 1.5 && change1d > 0) score += 8;
  if (close && ma20 && close < ma20 && return20d < 0) score -= 8;
  return clamp(Math.round(score), 0, 100);
}

function phaseFor({
  close,
  inverseRiskProxy,
  kdjJ,
  ma20,
  ma20Gap,
  ma50,
  return20d,
  riskScore,
  rsi,
  score,
  signals,
  volumeRatio,
}: {
  close: number | null;
  inverseRiskProxy: boolean;
  kdjJ: number | null;
  ma20: number | null;
  ma20Gap: number | null;
  ma50: number | null;
  return20d: number;
  riskScore: number;
  rsi: number | null;
  score: number;
  signals: PriceActionSignal[];
  volumeRatio: number | null;
}): PriceActionSnapshot["phase"] {
  if (inverseRiskProxy) {
    if (signals.some((signal) => signal.ruleType === "risk_proxy_heating") || riskScore >= 68) return "risk-heating";
    if (signals.some((signal) => signal.ruleType === "risk_proxy_cooling")) return "risk-cooling";
    if (signals.some((signal) => signal.ruleType === "range_compression")) return "range-compression";
    return "breakout-watch";
  }
  if (signals.some((signal) => signal.ruleType === "support_lost") || riskScore >= 68) return "breakdown";
  if ((rsi ?? 0) >= 78 || (kdjJ ?? 0) >= 95 || (return20d > 16 && (volumeRatio ?? 0) >= 1.3)) return "exhaustion";
  if (signals.some((signal) => signal.ruleType === "range_compression")) return "range-compression";
  if (close && ma20 && ma50 && close > ma20 && close > ma50 && score >= 68) return "trend-continuation";
  if (ma20Gap != null && Math.abs(ma20Gap) <= 2.2) return "pullback-hold";
  return "breakout-watch";
}

function phaseLabel(phase: PriceActionSnapshot["phase"]) {
  if (phase === "trend-continuation") return "趋势延续";
  if (phase === "pullback-hold") return "回踩确认";
  if (phase === "breakout-watch") return "突破观察";
  if (phase === "range-compression") return "箱体压缩";
  if (phase === "breakdown") return "结构破位";
  if (phase === "exhaustion") return "动能过热";
  if (phase === "risk-cooling") return "风险降温";
  if (phase === "risk-heating") return "风险升温";
  return "等待数据";
}

function phaseTone(phase: PriceActionSnapshot["phase"], score: number): PriceActionSnapshot["tone"] {
  if (phase === "risk-cooling") return "positive";
  if (phase === "risk-heating") return "negative";
  if (phase === "breakdown") return "negative";
  if (phase === "exhaustion" || phase === "range-compression" || phase === "breakout-watch") return "caution";
  if (score >= 68) return "positive";
  if (score >= 48) return "caution";
  return "negative";
}

function entryTriggerFor(phase: PriceActionSnapshot["phase"], ma20: number | null, resistance: number | null) {
  if (phase === "trend-continuation") return `回踩 ${priceLabel(ma20)} 不破或放量突破 ${priceLabel(resistance)}`;
  if (phase === "pullback-hold") return `MA20 ${priceLabel(ma20)} 附近企稳后再确认`;
  if (phase === "range-compression") return `放量突破 ${priceLabel(resistance)} 后再行动`;
  if (phase === "breakdown") return `重新站回 MA20 ${priceLabel(ma20)}`;
  if (phase === "exhaustion") return "等待热度降温后仍不跌破短期均线";
  if (phase === "risk-cooling") return `风险代理保持在 MA20 ${priceLabel(ma20)} 下方`;
  if (phase === "risk-heating") return `风险代理重新跌回 MA20 ${priceLabel(ma20)} 下方`;
  return `突破 ${priceLabel(resistance)} 且回踩不破`;
}

function summaryFor(phase: PriceActionSnapshot["phase"], score: number, signals: PriceActionSignal[]) {
  const primary = signals[0];
  const primaryText = primary ? `${primary.label} ${primary.strength}/100` : "缺少显著信号";
  return `${phaseLabel(phase)}，价格行为评分 ${score}/100；${primaryText}。`;
}

function compareSignals(left: PriceActionSignal, right: PriceActionSignal) {
  const priority = signalPriority(right.tone) - signalPriority(left.tone);
  if (priority !== 0) return priority;
  return right.strength - left.strength;
}

function signalPriority(tone: string) {
  if (tone === "negative") return 4;
  if (tone === "caution") return 3;
  if (tone === "positive") return 2;
  return 1;
}

function scoreTone(score: number, primaryTone: string | undefined): PriceActionAnalysis["tone"] {
  if (primaryTone === "negative" && score < 58) return "negative";
  if (score >= 72) return "positive";
  if (score >= 48) return "caution";
  return "negative";
}

function percentGap(value: number, base: number) {
  return ((value - base) / base) * 100;
}

function firstPositive(...values: Array<number | null | undefined>) {
  return values.find((value): value is number => Boolean(value && Number.isFinite(value) && value > 0)) ?? null;
}

function positiveNumber(value: NumericInput) {
  return value != null && Number.isFinite(value) && value > 0 ? value : null;
}

function finiteNumber(value: NumericInput) {
  return value != null && Number.isFinite(value) ? value : null;
}

function priceLabel(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value) || value <= 0) return "—";
  if (value >= 1000) return value.toFixed(0);
  if (value >= 100) return value.toFixed(1);
  return value.toFixed(2);
}

function numberLabel(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) ? "—" : value.toFixed(1);
}

function isInverseRiskProxy(row: TechnicalRow, asset: AssetStatus | null) {
  const text = `${row.symbol} ${row.label} ${row.note} ${asset?.label ?? ""} ${asset?.note ?? ""}`.toUpperCase();
  return /VIX|VOLATILITY|恐慌|波动率/u.test(text);
}

function asSentence(value: string) {
  const text = value.trim();
  if (!text) return "";
  return /[。.!?！？]$/u.test(text) ? text : `${text}。`;
}

function symbolKey(value: string) {
  return value.trim().toUpperCase();
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
