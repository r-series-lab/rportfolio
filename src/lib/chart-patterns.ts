import type {
  ChartPattern,
  PatternAnalysis,
  PatternPoint,
  PriceActionAnalysis,
  PriceActionSnapshot,
  PriceBar,
  TechnicalRow,
} from "./types";

export type PatternAnalysisInput = {
  asOf: string;
  patternAnalysis?: PatternAnalysis;
  priceAction?: PriceActionAnalysis | null;
  priceBarsBySymbol?: Record<string, PriceBar[]> | null;
  technicalRows: TechnicalRow[];
};

type SwingPoint = PatternPoint & {
  index: number;
  kind: "high" | "low";
};

export function derivePatternAnalysis(input: PatternAnalysisInput, priceAction = input.priceAction): PatternAnalysis {
  const technicalBySymbol = new Map(input.technicalRows.map((row) => [symbolKey(row.symbol), row]));
  const barPatterns = Object.entries(input.priceBarsBySymbol ?? {}).flatMap(([symbol, bars]) =>
    patternsFromBars(symbol, bars, technicalBySymbol.get(symbolKey(symbol)), input.asOf),
  );
  const snapshotPatterns = (priceAction?.snapshots ?? [])
    .map((snapshot) => patternFromSnapshot(snapshot, technicalBySymbol.get(symbolKey(snapshot.symbol)), input.asOf))
    .filter((pattern): pattern is ChartPattern => Boolean(pattern));
  const existing = input.patternAnalysis?.patterns ?? [];
  const patterns = uniquePatterns([...barPatterns, ...snapshotPatterns, ...existing])
    .sort(comparePatterns)
    .slice(0, 8);
  const dominant = patterns[0] ?? null;

  return {
    summary: dominant
      ? `${dominant.symbolLabel}：${dominant.label}，置信度 ${dominant.confidence}%。${dominant.implication}`
      : "暂无足够价格结构，继续等待行情序列或关键均线触发。",
    dominant,
    patterns,
  };
}

function patternsFromBars(symbol: string, rawBars: PriceBar[], row: TechnicalRow | undefined, asOf: string) {
  const bars = normalizeBars(rawBars);
  if (bars.length < 18) return [];

  const patterns = [
    doubleTopPattern(symbol, bars, row, asOf),
    doubleBottomPattern(symbol, bars, row, asOf),
    breakoutPattern(symbol, bars, row, asOf),
    breakdownPattern(symbol, bars, row, asOf),
    compressionPattern(symbol, bars, row, asOf),
  ];
  return patterns.filter((pattern): pattern is ChartPattern => Boolean(pattern));
}

function patternFromSnapshot(snapshot: PriceActionSnapshot, row: TechnicalRow | undefined, asOf: string): ChartPattern | null {
  const close = finiteNumber(row?.close);
  const support = numericLevel(snapshot.support);
  const resistance = numericLevel(snapshot.resistance);
  const invalidation = numericLevel(snapshot.invalidation) ?? support;
  const date = asOf || new Date().toISOString().slice(0, 10);
  const common = {
    symbol: snapshot.symbol,
    symbolLabel: snapshot.label,
    detail: snapshot.summary,
    points: proxyPoints(date, close, support, resistance, invalidation),
  };

  if (snapshot.phase === "breakdown") {
    return {
      ...common,
      key: `pa-${snapshot.symbol}-support-break`,
      label: "支撑破位",
      direction: "bearish",
      status: "confirmed",
      statusLabel: "已确认",
      phase: snapshot.phase,
      phaseLabel: snapshot.phaseLabel,
      tone: "negative",
      confidence: clamp(Math.round(snapshot.riskScore * 0.72 + snapshot.score * 0.18), 58, 92),
      neckline: snapshot.invalidation,
      confirmation: `收盘低于 ${snapshot.support} 或 MA50 后仍未修复。`,
      invalidation: snapshot.entryTrigger,
      action: "新增买入等待修复，已有仓位复核止损和仓位上限。",
      implication: "中短期结构转弱，交易动作应从进攻切回防守确认。",
    };
  }

  if (snapshot.phase === "exhaustion") {
    return {
      ...common,
      key: `pa-${snapshot.symbol}-exhaustion`,
      label: "动能衰竭",
      direction: "bearish",
      status: "forming",
      statusLabel: "形成中",
      phase: snapshot.phase,
      phaseLabel: snapshot.phaseLabel,
      tone: "caution",
      confidence: clamp(Math.round(snapshot.riskScore * 0.55 + snapshot.momentumScore * 0.3), 52, 88),
      neckline: snapshot.resistance,
      confirmation: "RSI/KDJ 高位后放量回落或跌破短期均线。",
      invalidation: `缩量回踩后继续站稳 ${snapshot.support}`,
      action: "不追高，等待热度降温或回踩确认。",
      implication: "趋势尚未必然结束，但新增仓位的赔率正在下降。",
    };
  }

  if (snapshot.phase === "range-compression") {
    return {
      ...common,
      key: `pa-${snapshot.symbol}-range-compression`,
      label: "箱体压缩",
      direction: "neutral",
      status: "watch",
      statusLabel: "观察中",
      phase: snapshot.phase,
      phaseLabel: snapshot.phaseLabel,
      tone: "neutral",
      confidence: clamp(snapshot.score, 45, 74),
      neckline: snapshot.resistance,
      confirmation: snapshot.entryTrigger,
      invalidation: `有效跌破 ${snapshot.support}`,
      action: "等待放量选择方向，避免在箱体中间频繁交易。",
      implication: "波动收敛，下一次突破或跌破会比当前位置更有信息量。",
    };
  }

  if (snapshot.phase === "pullback-hold") {
    return {
      ...common,
      key: `pa-${snapshot.symbol}-pullback-hold`,
      label: "回踩承接",
      direction: "bullish",
      status: snapshot.tone === "positive" ? "confirmed" : "forming",
      statusLabel: snapshot.tone === "positive" ? "已确认" : "形成中",
      phase: snapshot.phase,
      phaseLabel: snapshot.phaseLabel,
      tone: snapshot.tone === "positive" ? "positive" : "caution",
      confidence: clamp(snapshot.score, 52, 86),
      neckline: snapshot.support,
      confirmation: snapshot.entryTrigger,
      invalidation: snapshot.invalidation,
      action: "可用小仓试探，失效位必须前置。",
      implication: "回踩没有破坏趋势，是比追高更健康的入场观察点。",
    };
  }

  if (snapshot.phase === "trend-continuation") {
    return {
      ...common,
      key: `pa-${snapshot.symbol}-trend-continuation`,
      label: "趋势延续",
      direction: "bullish",
      status: "confirmed",
      statusLabel: "已确认",
      phase: snapshot.phase,
      phaseLabel: snapshot.phaseLabel,
      tone: snapshot.tone === "positive" ? "positive" : "caution",
      confidence: clamp(Math.round(snapshot.score * 0.9 + snapshot.structureScore * 0.1), 58, 90),
      neckline: snapshot.support,
      confirmation: snapshot.entryTrigger,
      invalidation: snapshot.invalidation,
      action: "顺势持有，新增仓位等待回踩或放量确认。",
      implication: "价格保持在核心均线上方，趋势仍可作为主线处理。",
    };
  }

  if (snapshot.phase === "risk-cooling" || snapshot.phase === "risk-heating") {
    const cooling = snapshot.phase === "risk-cooling";
    return {
      ...common,
      key: `pa-${snapshot.symbol}-${cooling ? "risk-cooling" : "risk-heating"}`,
      label: cooling ? "风险降温" : "风险升温",
      direction: cooling ? "bullish" : "bearish",
      status: cooling ? "confirmed" : "forming",
      statusLabel: cooling ? "已确认" : "形成中",
      phase: snapshot.phase,
      phaseLabel: snapshot.phaseLabel,
      tone: cooling ? "positive" : "negative",
      confidence: cooling
        ? clamp(Math.round(snapshot.score * 0.72), 48, 66)
        : clamp(snapshot.riskScore, 54, 88),
      neckline: snapshot.support,
      confirmation: snapshot.entryTrigger,
      invalidation: snapshot.invalidation,
      action: cooling ? "风险门可以放松一点，但仍等待权益资产自身确认。" : "收紧新增权益仓位，等待风险代理回落。",
      implication: cooling ? "恐慌代理下行，外部压力下降。" : "恐慌代理抬升，权益信号需要降权。",
    };
  }

  return null;
}

function doubleTopPattern(symbol: string, bars: PriceBar[], row: TechnicalRow | undefined, asOf: string): ChartPattern | null {
  const highs = swings(bars, "high");
  const pair = matchingSwingPair(highs, 0.035, "high");
  if (!pair) return null;
  const [left, right] = pair;
  const gap = Math.abs(right.price - left.price) / Math.max(left.price, right.price);
  const between = bars.slice(left.index, right.index + 1);
  const neckline = minBy(between, (bar) => bar.low);
  if (!neckline) return null;
  const latest = bars[bars.length - 1];
  const confirmed = latest.close < neckline.low * 0.995;
  const confidence = clamp(Math.round((confirmed ? 74 : 58) + (0.035 - gap) * 420), 52, 90);
  return {
    key: `bars-${symbol}-double-top`,
    label: "双顶",
    symbol,
    symbolLabel: row?.label || symbol,
    direction: "bearish",
    status: confirmed ? "confirmed" : "forming",
    statusLabel: confirmed ? "已确认" : "形成中",
    phase: "distribution_watch",
    phaseLabel: confirmed ? "跌破颈线" : "形成中，等待确认",
    tone: confirmed ? "negative" : "caution",
    confidence,
    neckline: priceLabel(neckline.low),
    confirmation: `收盘跌破颈线 ${priceLabel(neckline.low)}，且最好伴随放量。`,
    invalidation: `重新突破右顶 ${priceLabel(right.price)}`,
    action: confirmed ? "降低风险仓位，等待反抽不过颈线。" : "不追高，等待是否跌破颈线。",
    implication: confirmed ? "上方两次冲高失败，结构已经转弱。" : "上方抛压开始清晰，跌破颈线后风险显著放大。",
    detail: `两个高点价差 ${(gap * 100).toFixed(1)}%。`,
    points: [
      { label: "高点1", date: left.date, price: left.price },
      { label: "颈线", date: neckline.date || asOf, price: neckline.low },
      { label: "高点2", date: right.date, price: right.price },
    ],
  };
}

function doubleBottomPattern(symbol: string, bars: PriceBar[], row: TechnicalRow | undefined, asOf: string): ChartPattern | null {
  const lows = swings(bars, "low");
  const pair = matchingSwingPair(lows, 0.04, "low");
  if (!pair) return null;
  const [left, right] = pair;
  const gap = Math.abs(right.price - left.price) / Math.max(left.price, right.price);
  const between = bars.slice(left.index, right.index + 1);
  const neckline = maxBy(between, (bar) => bar.high);
  if (!neckline) return null;
  const latest = bars[bars.length - 1];
  const confirmed = latest.close > neckline.high * 1.005;
  const confidence = clamp(Math.round((confirmed ? 74 : 56) + (0.04 - gap) * 360), 50, 88);
  return {
    key: `bars-${symbol}-double-bottom`,
    label: "双底",
    symbol,
    symbolLabel: row?.label || symbol,
    direction: "bullish",
    status: confirmed ? "confirmed" : "forming",
    statusLabel: confirmed ? "已确认" : "形成中",
    phase: "base_reversal",
    phaseLabel: confirmed ? "突破颈线" : "形成中，等待确认",
    tone: confirmed ? "positive" : "caution",
    confidence,
    neckline: priceLabel(neckline.high),
    confirmation: `收盘突破颈线 ${priceLabel(neckline.high)}。`,
    invalidation: `跌破右底 ${priceLabel(right.price)}`,
    action: confirmed ? "可做小仓右侧确认，失效位放在右底下方。" : "等待突破颈线，不提前重仓。",
    implication: confirmed ? "两次下探承接有效，趋势有修复机会。" : "底部雏形出现，但还缺突破确认。",
    detail: `两个低点价差 ${(gap * 100).toFixed(1)}%。`,
    points: [
      { label: "低点1", date: left.date, price: left.price },
      { label: "颈线", date: neckline.date || asOf, price: neckline.high },
      { label: "低点2", date: right.date, price: right.price },
    ],
  };
}

function breakoutPattern(symbol: string, bars: PriceBar[], row: TechnicalRow | undefined, asOf: string): ChartPattern | null {
  const latest = bars[bars.length - 1];
  const prior = bars.slice(-21, -1);
  if (prior.length < 12) return null;
  const resistance = Math.max(...prior.map((bar) => bar.high));
  const avgVolume = average(prior.map((bar) => bar.volume ?? 0).filter((value) => value > 0));
  const volumeOk = !avgVolume || (latest.volume ?? 0) >= avgVolume * 1.18;
  if (latest.close <= resistance * 1.006 || !volumeOk) return null;
  return {
    key: `bars-${symbol}-breakout`,
    label: "放量突破",
    symbol,
    symbolLabel: row?.label || symbol,
    direction: "bullish",
    status: "confirmed",
    statusLabel: "已确认",
    phase: "breakout",
    phaseLabel: "突破确认",
    tone: "positive",
    confidence: clamp(Math.round(70 + Math.min(18, percentGap(latest.close, resistance) * 2)), 62, 88),
    neckline: priceLabel(resistance),
    confirmation: `收盘突破前高 ${priceLabel(resistance)}。`,
    invalidation: `跌回突破位 ${priceLabel(resistance)} 下方`,
    action: "等待回踩突破位不破，或用小仓确认突破质量。",
    implication: "价格脱离前期压力区，趋势可能进入新一段。",
    detail: `突破幅度 ${percentGap(latest.close, resistance).toFixed(1)}%。`,
    points: [
      { label: "压力", date: asOf, price: resistance },
      { label: "突破", date: latest.date || asOf, price: latest.close },
    ],
  };
}

function breakdownPattern(symbol: string, bars: PriceBar[], row: TechnicalRow | undefined, asOf: string): ChartPattern | null {
  const latest = bars[bars.length - 1];
  const prior = bars.slice(-21, -1);
  if (prior.length < 12) return null;
  const support = Math.min(...prior.map((bar) => bar.low));
  if (latest.close >= support * 0.994) return null;
  return {
    key: `bars-${symbol}-breakdown`,
    label: "区间跌破",
    symbol,
    symbolLabel: row?.label || symbol,
    direction: "bearish",
    status: "confirmed",
    statusLabel: "已确认",
    phase: "breakdown",
    phaseLabel: "跌破确认",
    tone: "negative",
    confidence: clamp(Math.round(70 + Math.min(18, Math.abs(percentGap(latest.close, support)) * 2)), 62, 90),
    neckline: priceLabel(support),
    confirmation: `收盘跌破前低 ${priceLabel(support)}。`,
    invalidation: `重新收复 ${priceLabel(support)}`,
    action: "先防守，等待反抽确认是否重新站回区间。",
    implication: "价格离开原支撑区，短线卖压占优。",
    detail: `跌破幅度 ${Math.abs(percentGap(latest.close, support)).toFixed(1)}%。`,
    points: [
      { label: "支撑", date: asOf, price: support },
      { label: "跌破", date: latest.date || asOf, price: latest.close },
    ],
  };
}

function compressionPattern(symbol: string, bars: PriceBar[], row: TechnicalRow | undefined, asOf: string): ChartPattern | null {
  if (bars.length < 28) return null;
  const recent = bars.slice(-8);
  const previous = bars.slice(-24, -8);
  const recentRange = average(recent.map((bar) => percentRange(bar)));
  const previousRange = average(previous.map((bar) => percentRange(bar)));
  if (!previousRange || recentRange > previousRange * 0.68) return null;
  const low = Math.min(...recent.map((bar) => bar.low));
  const high = Math.max(...recent.map((bar) => bar.high));
  return {
    key: `bars-${symbol}-compression`,
    label: "波动压缩",
    symbol,
    symbolLabel: row?.label || symbol,
    direction: "neutral",
    status: "watch",
    statusLabel: "观察中",
    phase: "range_compression",
    phaseLabel: "等待方向",
    tone: "neutral",
    confidence: clamp(Math.round(66 - recentRange * 1.6), 48, 78),
    neckline: `${priceLabel(low)} - ${priceLabel(high)}`,
    confirmation: `放量突破 ${priceLabel(high)} 或跌破 ${priceLabel(low)}。`,
    invalidation: "缩量横盘继续延长，信号有效性下降。",
    action: "不在区间中间交易，等方向选择。",
    implication: "波动明显收敛，下一次方向选择会更关键。",
    detail: `近期日内振幅 ${recentRange.toFixed(1)}%，此前 ${previousRange.toFixed(1)}%。`,
    points: [
      { label: "下沿", date: asOf, price: low },
      { label: "上沿", date: asOf, price: high },
    ],
  };
}

function normalizeBars(bars: PriceBar[]) {
  return bars
    .filter((bar) =>
      Number.isFinite(bar.open)
      && Number.isFinite(bar.high)
      && Number.isFinite(bar.low)
      && Number.isFinite(bar.close)
      && bar.high >= bar.low,
    )
    .sort((left, right) => left.date.localeCompare(right.date));
}

function swings(bars: PriceBar[], kind: "high" | "low", windowSize = 2): SwingPoint[] {
  const points: SwingPoint[] = [];
  for (let index = windowSize; index < bars.length - windowSize; index += 1) {
    const bar = bars[index];
    const range = bars.slice(index - windowSize, index + windowSize + 1);
    const value = kind === "high" ? bar.high : bar.low;
    const extreme = kind === "high"
      ? Math.max(...range.map((item) => item.high))
      : Math.min(...range.map((item) => item.low));
    if (value === extreme) {
      points.push({ index, kind, label: kind === "high" ? "高点" : "低点", date: bar.date, price: value });
    }
  }
  return points;
}

function matchingSwingPair(points: SwingPoint[], tolerance: number, kind: "high" | "low"): [SwingPoint, SwingPoint] | null {
  const candidates: Array<{ left: SwingPoint; right: SwingPoint; score: number }> = [];
  for (let leftIndex = 0; leftIndex < points.length - 1; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < points.length; rightIndex += 1) {
      const left = points[leftIndex];
      const right = points[rightIndex];
      if (right.index - left.index < 3) continue;
      const gap = Math.abs(right.price - left.price) / Math.max(left.price, right.price);
      if (gap > tolerance) continue;
      const levelScore = kind === "high"
        ? (left.price + right.price) / 2
        : -(left.price + right.price) / 2;
      const recencyScore = right.index * 0.08;
      const symmetryScore = (tolerance - gap) * 100;
      candidates.push({ left, right, score: levelScore + recencyScore + symmetryScore });
    }
  }
  const best = candidates.sort((left, right) => right.score - left.score)[0];
  return best ? [best.left, best.right] : null;
}

function uniquePatterns(patterns: ChartPattern[]) {
  const seen = new Set<string>();
  const unique: ChartPattern[] = [];
  for (const pattern of patterns) {
    const key = pattern.key || `${pattern.symbol}-${pattern.label}-${pattern.neckline ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(pattern);
  }
  return unique;
}

function comparePatterns(left: ChartPattern, right: ChartPattern) {
  const statusWeight = (pattern: ChartPattern) => pattern.status === "confirmed" ? 12 : pattern.status === "forming" ? 7 : 3;
  const toneWeight = (pattern: ChartPattern) => pattern.tone === "negative" ? 8 : pattern.tone === "caution" ? 6 : pattern.tone === "positive" ? 5 : 2;
  return (right.confidence + statusWeight(right) + toneWeight(right)) - (left.confidence + statusWeight(left) + toneWeight(left));
}

function proxyPoints(date: string, close: number | null, support: number | null, resistance: number | null, invalidation: number | null): PatternPoint[] {
  return [
    support ? { label: "支撑", date: offsetDate(date, -10), price: support } : null,
    close ? { label: "当前", date, price: close } : null,
    resistance ? { label: "压力", date: offsetDate(date, -5), price: resistance } : null,
    invalidation ? { label: "失效", date: offsetDate(date, -2), price: invalidation } : null,
  ].filter((point): point is PatternPoint => Boolean(point));
}

function numericLevel(value: string | null | undefined) {
  if (!value) return null;
  const match = value.match(/[+-]?\d+(?:\.\d+)?/);
  return match ? finiteNumber(Number(match[0])) : null;
}

function priceLabel(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return null;
  if (value >= 1000) return value.toFixed(0);
  if (value >= 100) return value.toFixed(1);
  return value.toFixed(2);
}

function percentGap(value: number, base: number) {
  return base === 0 ? 0 : ((value - base) / base) * 100;
}

function percentRange(bar: PriceBar) {
  return bar.close === 0 ? 0 : ((bar.high - bar.low) / bar.close) * 100;
}

function average(values: number[]) {
  const valid = values.filter((value) => Number.isFinite(value));
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : 0;
}

function minBy<T>(items: T[], getter: (item: T) => number) {
  return items.reduce<T | null>((best, item) => best == null || getter(item) < getter(best) ? item : best, null);
}

function maxBy<T>(items: T[], getter: (item: T) => number) {
  return items.reduce<T | null>((best, item) => best == null || getter(item) > getter(best) ? item : best, null);
}

function finiteNumber(value: number | null | undefined) {
  return value != null && Number.isFinite(value) ? value : null;
}

function offsetDate(date: string, days: number) {
  const time = Date.parse(`${date || new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(time)) return date;
  return new Date(time + days * 86_400_000).toISOString().slice(0, 10);
}

function symbolKey(value: string) {
  return value.trim().toUpperCase();
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
