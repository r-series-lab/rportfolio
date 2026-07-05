import type {
  ActionGate,
  DamageScore,
  ExposureRange,
  IntelligenceDriver,
  MarketAnalysisReport,
  MarketInternals,
  PositionAdvice,
  RiskVectorItem,
  SignalQuality,
  StateConfidence,
  StateTransitionMatrix,
  StateTransitionOutcome,
} from "./types";

type IntelligenceTone = IntelligenceDriver["tone"];

export type EnhancedMarketAnalysisReport = MarketAnalysisReport & {
  damageScore: DamageScore;
  riskVector: RiskVectorItem[];
  signalQuality: SignalQuality;
  stateConfidence: StateConfidence;
  stateTransitionMatrix: StateTransitionMatrix;
};

export function enhanceMarketAnalysisReport(report: MarketAnalysisReport): EnhancedMarketAnalysisReport {
  const riskVector = hasRiskVector(report.riskVector) ? report.riskVector : deriveRiskVector(report);
  const baseStateConfidence = report.stateConfidence ?? deriveStateConfidence(report, riskVector);
  const signalQuality = report.signalQuality ?? deriveSignalQuality(report, baseStateConfidence, riskVector);
  const stateConfidence = calibrateStateConfidence(baseStateConfidence, signalQuality);
  const damageScore = report.damageScore ?? deriveDamageScore(report, riskVector);
  const stateTransitionMatrix = report.stateTransitionMatrix ?? deriveStateTransitionMatrix(report, stateConfidence, damageScore, riskVector);
  const positionAdvice = report.positionAdvice.map((advice) =>
    adjustPositionAdviceForIntelligence(advice, stateConfidence, damageScore, riskVector, signalQuality),
  );

  return {
    ...report,
    riskVector,
    signalQuality,
    stateConfidence,
    damageScore,
    stateTransitionMatrix,
    decisionFrame: {
      ...report.decisionFrame,
      riskVector,
      signalQuality,
      stateConfidence,
      damageScore,
      stateTransitionMatrix,
    },
    positionAdvice,
  };
}

export function deriveRiskVector(report: MarketAnalysisReport): RiskVectorItem[] {
  const systemic = factorScore(report, "systemic", axisScore(report, "risk", 45));
  const volatility = factorScore(report, "volatility", 35);
  const heat = factorScore(report, "heat", Math.max(report.score, 45));
  const structureStrength = factorScore(report, "structure", axisScore(report, "trend", 55));
  const internalPressure = internalPressureScore(report.marketInternals);
  const structure = clamp(Math.round(Math.max(100 - structureStrength, internalPressure * 0.9, report.portfolioProfile?.weightedRiskScore ?? 0)), 0, 100);

  return [
    riskVectorItem("system", "系统风险", systemic, "宏观/指数级压力与中期趋势破坏风险。", [
      factorDetail(report, "systemic"),
      report.structure.invalidation,
    ]),
    riskVectorItem("structure", "结构风险", structure, "广度、相对弱势、持仓集中与结构破坏风险。", [
      report.marketInternals.summary,
      `持仓风险 ${report.portfolioProfile?.weightedRiskScore ?? "—"}/100`,
    ]),
    riskVectorItem("heat", "过热风险", heat, "涨幅、乖离和拥挤交易带来的追高风险。", [
      factorDetail(report, "heat"),
      report.reasons.find((item) => /热|拥挤|RSI|涨幅/u.test(item.text))?.text ?? "未发现显著过热原因。",
    ]),
    riskVectorItem("volatility", "波动风险", volatility, "波动率、恐慌和价格噪声风险。", [
      factorDetail(report, "volatility"),
      signalDetail(report.marketInternals, "gap_failure"),
    ]),
  ];
}

export function deriveStateConfidence(report: MarketAnalysisReport, riskVector = deriveRiskVector(report)): StateConfidence {
  const gates = report.positionAdvice.flatMap((advice) => advice.gates ?? []);
  const blocked = gates.filter((gate) => gate.status === "block").length;
  const watched = gates.filter((gate) => gate.status === "watch").length;
  const passed = gates.filter((gate) => gate.status === "pass").length;
  const total = Math.max(1, gates.length);
  const passRatio = passed / total;
  const internalPressure = internalPressureScore(report.marketInternals);
  const riskLikeState = isRiskLikeProtocol(report);
  const breadthScore = riskLikeState
    ? clamp(Math.round(44 + internalPressure * 0.5), 25, 90)
    : clamp(Math.round(84 - internalPressure * 0.45), 25, 90);
  const relativeWeakness = report.marketInternals.relativeWeaknessRatio ?? (riskVector.find((item) => item.key === "structure")?.score ?? 50);
  const crossAssetScore = riskLikeState
    ? clamp(Math.round(42 + relativeWeakness * 0.52), 25, 88)
    : clamp(Math.round(82 - relativeWeakness * 0.38), 25, 88);
  const validation = report.backtest?.stateValidation;
  const sampleCount = validation?.effectiveSampleCount ?? validation?.sampleCount ?? 0;
  const rawSampleCount = validation?.rawSampleCount ?? sampleCount;
  const durationScore = clamp(Math.round(42 + Math.sqrt(sampleCount) * 7), 36, 82);
  const failedReboundSignal = report.marketInternals.signals.find((signal) => signal.key.includes("gap") || /失败|反抽/u.test(signal.label));
  const failedReboundScore = !failedReboundSignal || failedReboundSignal.tone === "positive" ? 52 : riskLikeState ? 76 : 44;
  const ruleScore = clamp(Math.round(54 + passRatio * 28 - watched * 3.5 - blocked * 12), 25, 88);

  const drivers: IntelligenceDriver[] = [
    driver("triggered_rules", "规则一致性", ruleScore, `通过 ${passed}/${total} 个动作门；观察 ${watched}，卡住 ${blocked}。`, "confidence"),
    driver("breadth", "广度确认", breadthScore, report.marketInternals.scopeLabel, "confidence"),
    driver("cross_asset_confirmation", "跨资产确认", crossAssetScore, `相对弱势样本 ${report.marketInternals.relativeWeaknessSampleSize}，结构压力 ${Math.round(relativeWeakness)}。`, "confidence"),
    driver("duration", "样本稳定性", durationScore, `有效样本 n=${sampleCount || "—"}（原始 ${rawSampleCount || "—"}），已降低连续重叠样本的影响。`, "confidence"),
    driver("failed_rebound", "失败反抽", failedReboundScore, failedReboundSignal?.detail ?? "未发现失败反抽或缺口失败。", "confidence"),
  ];
  const score = clamp(
    Math.round(ruleScore * 0.28 + breadthScore * 0.24 + crossAssetScore * 0.22 + durationScore * 0.16 + failedReboundScore * 0.1),
    0,
    100,
  );
  const weakDrivers = drivers
    .filter((item) => item.score < 58)
    .sort((left, right) => left.score - right.score)
    .slice(0, 2)
    .map((item) => item.label)
    .join("、");

  return {
    score,
    label: confidenceLabel(score),
    tone: confidenceTone(score),
    summary: weakDrivers
      ? `状态置信 ${score}/100，主要受 ${weakDrivers} 约束。`
      : `状态置信 ${score}/100，规则、广度与跨资产确认基本一致。`,
    drivers,
  };
}

export function deriveSignalQuality(
  report: MarketAnalysisReport,
  stateConfidence = deriveStateConfidence(report),
  riskVector = deriveRiskVector(report),
): SignalQuality {
  const holdings = report.portfolioProfile?.holdings ?? [];
  const weightedHoldings = holdings.filter((item) => item.weight > 0);
  const totalWeight = report.portfolioProfile?.totalWeight ?? 0;
  const weightCoverage = totalWeight >= 85 && totalWeight <= 105 ? 88 : totalWeight >= 65 ? 66 : totalWeight > 0 ? 48 : 28;
  const breadthCoverage = clamp(34 + Math.min(weightedHoldings.length, 8) * 6 + Math.min(report.technicalRows.length, 8) * 3, 25, 92);
  const profileCoverage = clamp(Math.round(weightCoverage * 0.55 + breadthCoverage * 0.45), 0, 100);

  const sourceScore = report.source === "sample" ? 42 : report.source === "csv" ? 58 : report.source === "auto" ? 72 : 76;
  const fundFreshness = report.profileFund?.freshnessTone === "negative"
    ? 34
    : report.profileFund?.freshnessTone === "caution"
      ? 52
      : report.profileFund?.freshnessTone === "positive"
        ? 78
        : 66;
  const dataCoverage = clamp(Math.round(sourceScore * 0.58 + fundFreshness * 0.42), 0, 100);

  const validation = report.backtest?.stateValidation;
  const stateSamples = validation?.effectiveSampleCount ?? validation?.sampleCount ?? 0;
  const rawStateSamples = validation?.rawSampleCount ?? stateSamples;
  const independenceRatio = rawStateSamples > 0 ? stateSamples / rawStateSamples : 0;
  const protocolSamples = report.backtest?.protocolValidation?.sampleCount ?? 0;
  const exactSamples = report.backtest?.stateValidation?.exactSampleCount ?? 0;
  const sampleScore = clamp(Math.round(26 + Math.sqrt(stateSamples + protocolSamples) * 6 + Math.min(exactSamples, 16) * 1.2), 22, 92);
  const qualityLabel = report.backtest?.stateValidation?.sampleQualityLabel ?? report.backtest?.stateValidation?.confidence;
  const sampleQualityBonus = /高/u.test(qualityLabel ?? "") ? 8 : /低/u.test(qualityLabel ?? "") ? -10 : 0;
  const independencePenalty = independenceRatio > 0 && independenceRatio < 0.35
    ? 12
    : independenceRatio > 0 && independenceRatio < 0.55
      ? 6
      : 0;
  const backtestDepth = clamp(sampleScore + sampleQualityBonus - independencePenalty, 0, 100);

  const rules = report.backtest?.ruleSet;
  const ruleCount = (rules?.stateRules.length ?? 0) + (rules?.actionRules.length ?? 0) + (rules?.profileRules.length ?? 0);
  const gates = report.positionAdvice.flatMap((advice) => advice.gates ?? []);
  const gateCount = gates.length;
  const blockedGates = gates.filter((gate) => gate.status === "block").length;
  const ruleCompleteness = clamp(Math.round(38 + Math.min(ruleCount, 12) * 3 + Math.min(gateCount, 12) * 2.4 - blockedGates * 4), 25, 92);

  const riskScores = riskVector.map((item) => item.score);
  const riskSpread = riskScores.length ? Math.max(...riskScores) - Math.min(...riskScores) : 0;
  const consistency = clamp(Math.round(stateConfidence.score * 0.74 + Math.max(0, 78 - riskSpread) * 0.26), 0, 100);

  const drivers: IntelligenceDriver[] = [
    driver("profile_coverage", "Profile 覆盖", profileCoverage, `已配置 ${weightedHoldings.length} 个带权重资产，总权重 ${Math.round(totalWeight)}%。`, "confidence"),
    driver("data_coverage", "数据来源", dataCoverage, `${report.sourceLabel || report.source}；${report.profileFund?.freshnessLabel ?? "Profile 数据新鲜度未单独声明"}。`, "confidence"),
    driver("backtest_depth", "回测样本", backtestDepth, `有效状态样本 n=${stateSamples || "—"} / 原始 ${rawStateSamples || "—"}，协议样本 n=${protocolSamples || "—"}。`, "confidence"),
    driver("rule_completeness", "规则完整度", ruleCompleteness, `规则 ${ruleCount} 条，动作门 ${gateCount} 个，阻断 ${blockedGates} 个。`, "confidence"),
    driver("signal_consistency", "信号一致性", consistency, `状态置信 ${stateConfidence.score}/100，风险向量分歧 ${riskSpread}。`, "confidence"),
  ];
  const score = clamp(
    Math.round(profileCoverage * 0.24 + dataCoverage * 0.18 + backtestDepth * 0.22 + ruleCompleteness * 0.18 + consistency * 0.18),
    0,
    100,
  );
  const weakDrivers = drivers
    .filter((item) => item.score < 58)
    .sort((left, right) => left.score - right.score)
    .slice(0, 2)
    .map((item) => item.label)
    .join("、");

  return {
    score,
    label: signalQualityLabel(score),
    tone: confidenceTone(score),
    effect: signalQualityEffect(score),
    summary: weakDrivers
      ? `信号质量 ${score}/100，优先复核 ${weakDrivers}。`
      : `信号质量 ${score}/100，Profile、回测和动作门基本可用。`,
    drivers,
  };
}

function calibrateStateConfidence(stateConfidence: StateConfidence, signalQuality: SignalQuality): StateConfidence {
  const cut = signalQuality.score < 42 ? 14 : signalQuality.score < 58 ? 8 : signalQuality.score < 72 ? 3 : 0;
  if (cut <= 0) {
    return {
      ...stateConfidence,
      drivers: mergeDrivers(stateConfidence.drivers, signalQualityDriver(signalQuality)),
    };
  }
  const score = clamp(stateConfidence.score - cut, 0, 100);
  return {
    ...stateConfidence,
    score,
    label: confidenceLabel(score),
    tone: confidenceTone(score),
    summary: `${stateConfidence.summary} ${signalQuality.summary} 已因信号质量下调 ${cut} 分。`,
    drivers: mergeDrivers(stateConfidence.drivers, signalQualityDriver(signalQuality)),
  };
}

export function deriveDamageScore(report: MarketAnalysisReport, riskVector = deriveRiskVector(report)): DamageScore {
  const breadthDamage = report.marketInternals.breadthAdvancingRatio == null
    ? 48
    : clamp(Math.round(100 - report.marketInternals.breadthAdvancingRatio), 0, 100);
  const relativeWeakness = clamp(Math.round(report.marketInternals.relativeWeaknessRatio ?? 45), 0, 100);
  const coreBreakdown = coreBreakdownScore(report);
  const failedReboundSignal = report.marketInternals.signals.find((signal) => signal.key.includes("gap") || /失败|反抽/u.test(signal.label));
  const failedRebound = !failedReboundSignal || failedReboundSignal.tone === "positive" ? 18 : failedReboundSignal.tone === "negative" ? 78 : 58;
  const concentration = clamp(Math.round(report.portfolioProfile?.concentrationScore ?? report.portfolioProfile?.weightedRiskScore ?? 45), 0, 100);
  const structureRisk = riskVector.find((item) => item.key === "structure")?.score ?? 50;

  const drivers: IntelligenceDriver[] = [
    driver("breadth_damage", "广度损伤", breadthDamage, report.marketInternals.breadthAdvancingRatio == null ? "缺少广度数据。" : `上涨占比 ${report.marketInternals.breadthAdvancingRatio}%。`),
    driver("relative_weakness", "相对弱势", relativeWeakness, report.marketInternals.highBetaOrder || "未发现高 beta 链条弱势排序。"),
    driver("core_breakdown", "核心破位", coreBreakdown, coreBreakdownDetail(report)),
    driver("failed_rebound", "失败反抽", failedRebound, failedReboundSignal?.detail ?? "未发现失败反抽或缺口失败。"),
    driver("concentration", "集中损伤", concentration, `集中度 ${concentration}/100，结构风险 ${structureRisk}/100。`),
  ];
  const score = clamp(
    Math.round(breadthDamage * 0.26 + relativeWeakness * 0.22 + coreBreakdown * 0.22 + failedRebound * 0.12 + concentration * 0.18),
    0,
    100,
  );
  const topDrivers = drivers
    .filter((item) => item.score >= 55)
    .sort((left, right) => right.score - left.score)
    .slice(0, 2)
    .map((item) => item.label)
    .join("、");

  return {
    score,
    label: damageLabel(score),
    tone: riskTone(score),
    effect: damageEffect(score),
    summary: topDrivers
      ? `内部损伤 ${score}/100，主要来自 ${topDrivers}。`
      : `内部损伤 ${score}/100，趋势内部仍相对可控。`,
    drivers,
  };
}

export function deriveStateTransitionMatrix(
  report: MarketAnalysisReport,
  stateConfidence = deriveStateConfidence(report),
  damageScore = deriveDamageScore(report),
  riskVector = deriveRiskVector(report),
): StateTransitionMatrix {
  const protocol = report.decisionFrame.protocolState;
  const riskByKey = new Map(riskVector.map((item) => [item.key, item.score]));
  const protocolRow = report.backtest.protocolValidation.rows.find((row) => row.protocolState === protocol);
  const weights = transitionSeed(protocol);
  const currentKey = currentTransitionKey(protocol);
  const systemRisk = riskByKey.get("system") ?? 45;
  const structureRisk = riskByKey.get("structure") ?? 45;
  const heatRisk = riskByKey.get("heat") ?? report.score;
  const volatilityRisk = riskByKey.get("volatility") ?? 45;
  const winRate = protocolRow?.winRate20Pct ?? 50;
  const medianReturn = protocolRow?.medianReturn20Pct ?? 0;
  const ma50Break = protocolRow?.ma50BreakRate20Pct ?? 18;

  addWeight(weights, currentKey, (stateConfidence.score - 55) * 0.16);
  addWeight(weights, "trend_recovery", (winRate - 50) * 0.18 + medianReturn * 1.25 - damageScore.score * 0.08 - systemRisk * 0.04);
  addWeight(weights, "range_watch", Math.max(0, heatRisk - 52) * 0.12 + Math.max(0, 58 - stateConfidence.score) * 0.11);
  addWeight(weights, "keep_watch", Math.max(0, structureRisk - 45) * 0.1 + Math.max(0, heatRisk - 60) * 0.08);
  addWeight(weights, "trend_breakdown", damageScore.score * 0.13 + structureRisk * 0.12 + ma50Break * 0.16 - Math.max(0, winRate - 52) * 0.12);
  addWeight(weights, "defensive_mode", Math.max(0, systemRisk - 45) * 0.14 + Math.max(0, volatilityRisk - 55) * 0.12 + Math.max(0, damageScore.score - 62) * 0.12);

  const outcomes = normalizeTransitionWeights(weights).map((item) => ({
    ...item,
    summary: transitionSummary(item, report, protocolRow?.sampleCount ?? report.backtest.stateValidation.sampleCount),
  }));
  const top = [...outcomes].sort((left, right) => right.probability - left.probability).slice(0, 2);

  return {
    horizonDays: 20,
    sourceStateKey: report.backtest.stateValidation.stateKey,
    sourceStateLabel: report.decisionFrame.stateLabel || report.backtest.stateValidation.stateLabel,
    confidenceLabel: stateConfidence.label,
    summary: `未来 20 日更偏向 ${top[0]?.label ?? "继续观察"} ${top[0]?.probability ?? 0}%；次选 ${top[1]?.label ?? "区间震荡"} ${top[1]?.probability ?? 0}%。基于当前风险向量、状态置信和同协议回测估计。`,
    outcomes,
  };
}

function adjustPositionAdviceForIntelligence(
  advice: PositionAdvice,
  stateConfidence: StateConfidence,
  damageScore: DamageScore,
  riskVector: RiskVectorItem[],
  signalQuality: SignalQuality,
): PositionAdvice {
  const structureRisk = riskVector.find((item) => item.key === "structure")?.score ?? 0;
  const confidenceCut = stateConfidence.score < 45 ? 8 : stateConfidence.score < 58 ? 4 : 0;
  const damageCut = damageScore.score >= 76 ? 16 : damageScore.score >= 64 ? 11 : damageScore.score >= 52 ? 7 : damageScore.score >= 42 ? 3 : 0;
  const structureCut = structureRisk >= 76 ? 6 : structureRisk >= 64 ? 3 : 0;
  const qualityCut = signalQuality.score < 42 ? 10 : signalQuality.score < 58 ? 6 : signalQuality.score < 72 ? 3 : 0;
  const capCut = horizonAdjustedCut(advice.horizonKey, confidenceCut + damageCut + structureCut + qualityCut);
  const currentRange = shrinkRange(advice.currentRange ?? null, capCut);
  const addRange = shrinkRange(advice.addRange ?? null, Math.max(0, Math.round(capCut * 0.6)));
  const nextConfidenceScore = clamp(
    Math.round(Math.min(advice.confidenceScore, stateConfidence.score + 10, signalQuality.score + 14) - Math.max(0, damageScore.score - 58) * 0.18),
    25,
    92,
  );
  const intelligenceGates = [
    signalQualityGate(signalQuality),
    stateConfidenceGate(stateConfidence),
    damageGate(damageScore),
  ];
  const gates = mergeGates(advice.gates, intelligenceGates);
  const capNote = capCut > 0 ? `信号质量、内部损伤和状态置信已二次裁剪上限 ${capCut}pct。` : "信号质量和内部损伤未触发额外仓位裁剪。";

  return {
    ...advice,
    currentRange,
    addRange,
    maxCap: currentRange ? currentRange.max : advice.maxCap,
    damageScore: damageScore.score,
    damageLabel: damageScore.label,
    confidenceScore: nextConfidenceScore,
    confidenceLabel: confidenceLabel(nextConfidenceScore),
    confidenceTone: confidenceTone(nextConfidenceScore),
    confidenceReason: `${signalQuality.summary} ${stateConfidence.summary} ${damageScore.summary} ${capNote}`,
    gates,
    rangeNote: advice.rangeNote ? `${advice.rangeNote} ${capNote}` : capNote,
  };
}

function transitionSeed(protocol: string) {
  const seed = new Map<string, number>();
  const values = protocol === "healthy"
    ? [48, 22, 16, 9, 5]
    : protocol === "broken"
      ? [12, 20, 25, 29, 14]
      : protocol === "panic"
        ? [8, 15, 18, 27, 32]
        : [28, 26, 25, 15, 6];
  TRANSITION_DEFINITIONS.forEach((item, index) => seed.set(item.key, values[index]));
  return seed;
}

function currentTransitionKey(protocol: string) {
  if (protocol === "healthy") return "trend_recovery";
  if (protocol === "broken") return "trend_breakdown";
  if (protocol === "panic") return "defensive_mode";
  return "keep_watch";
}

function addWeight(weights: Map<string, number>, key: string, delta: number) {
  weights.set(key, (weights.get(key) ?? 0) + delta);
}

function normalizeTransitionWeights(weights: Map<string, number>): Array<Omit<StateTransitionOutcome, "summary">> {
  const clipped = TRANSITION_DEFINITIONS.map((definition) => ({
    ...definition,
    raw: clamp(weights.get(definition.key) ?? 0, 3, 78),
  }));
  const total = clipped.reduce((sum, item) => sum + item.raw, 0) || 1;
  const scaled = clipped.map((item) => {
    const exact = (item.raw / total) * 100;
    return {
      ...item,
      probability: Math.floor(exact),
      remainder: exact - Math.floor(exact),
    };
  });
  let remainder = 100 - scaled.reduce((sum, item) => sum + item.probability, 0);
  for (const item of [...scaled].sort((left, right) => right.remainder - left.remainder)) {
    if (remainder <= 0) break;
    item.probability += 1;
    remainder -= 1;
  }
  return scaled
    .map((item) => ({
      key: item.key,
      label: item.label,
      tone: item.tone,
      probability: item.probability,
    }))
    .sort((left, right) => right.probability - left.probability);
}

function transitionSummary(item: Omit<StateTransitionOutcome, "summary">, report: MarketAnalysisReport, sampleCount: number) {
  const state = report.decisionFrame.stateLabel;
  if (item.key === "trend_recovery") {
    return `${state} 后回到趋势扩张或确认买点的概率估计；同协议样本 n=${sampleCount}。`;
  }
  if (item.key === "range_watch") {
    return "结构没有明显破坏，但方向暂时不够清晰，适合按区间和触发条件管理。";
  }
  if (item.key === "keep_watch") {
    return "当前协议继续有效，重点看确认条件和内部损伤是否改善。";
  }
  if (item.key === "trend_breakdown") {
    return "趋势或内部结构继续受损，仓位上限和新增动作需要继续收紧。";
  }
  return "系统压力或波动风险抬升时，优先保护本金和降低组合波动。";
}

const TRANSITION_DEFINITIONS: Array<Omit<StateTransitionOutcome, "probability" | "summary">> = [
  { key: "trend_recovery", label: "回归趋势", tone: "positive" },
  { key: "range_watch", label: "区间震荡", tone: "neutral" },
  { key: "keep_watch", label: "继续观察", tone: "caution" },
  { key: "trend_breakdown", label: "趋势破坏", tone: "negative" },
  { key: "defensive_mode", label: "防守模式", tone: "negative" },
];

function hasRiskVector(value: MarketAnalysisReport["riskVector"]): value is RiskVectorItem[] {
  return Array.isArray(value) && value.length >= 4 && value.every((item) => typeof item.score === "number");
}

function riskVectorItem(key: RiskVectorItem["key"], label: string, score: number, detail: string, drivers: string[]): RiskVectorItem {
  return {
    key,
    label,
    score: clamp(Math.round(score), 0, 100),
    status: riskStatus(score),
    tone: riskTone(score),
    detail,
    drivers: drivers.filter(Boolean).slice(0, 3),
  };
}

function driver(key: string, label: string, score: number, detail: string, mode: "risk" | "confidence" = "risk"): IntelligenceDriver {
  const nextScore = clamp(Math.round(score), 0, 100);
  return {
    key,
    label,
    score: nextScore,
    tone: mode === "confidence" ? confidenceTone(nextScore) : riskTone(nextScore),
    detail,
  };
}

function mergeDrivers(drivers: IntelligenceDriver[], next: IntelligenceDriver) {
  return drivers.some((item) => item.key === next.key) ? drivers.map((item) => (item.key === next.key ? next : item)) : [...drivers, next];
}

function signalQualityDriver(signalQuality: SignalQuality): IntelligenceDriver {
  return driver("signal_quality", "信号质量", signalQuality.score, signalQuality.summary, "confidence");
}

function signalQualityGate(signalQuality: SignalQuality): ActionGate {
  const status = signalQuality.score >= 62 ? "pass" : signalQuality.score >= 48 ? "watch" : "block";
  return {
    key: "signal_quality",
    label: "信号质量",
    status,
    triggered: status !== "pass",
    effect: status === "pass" ? "allow" : status === "watch" ? "cap_add" : "block_add",
    tone: status === "pass" ? "positive" : status === "watch" ? "caution" : "negative",
    detail: signalQuality.summary,
  };
}

function stateConfidenceGate(stateConfidence: StateConfidence): ActionGate {
  const status = stateConfidence.score >= 58 ? "pass" : stateConfidence.score >= 45 ? "watch" : "block";
  return {
    key: "state_confidence",
    label: "状态置信",
    status,
    triggered: status !== "pass",
    effect: status === "pass" ? "allow" : status === "watch" ? "cap_add" : "block_add",
    tone: status === "pass" ? "positive" : status === "watch" ? "caution" : "negative",
    detail: stateConfidence.summary,
  };
}

function damageGate(damageScore: DamageScore): ActionGate {
  const status = damageScore.score < 45 ? "pass" : damageScore.score < 70 ? "watch" : "block";
  return {
    key: "damage_score",
    label: "内部损伤",
    status,
    triggered: status !== "pass",
    effect: damageScore.effect,
    tone: status === "pass" ? "positive" : status === "watch" ? "caution" : "negative",
    detail: damageScore.summary,
  };
}

function mergeGates(gates: ActionGate[], nextGates: ActionGate[]) {
  const nextByKey = new Map(nextGates.map((gate) => [gate.key, gate]));
  const merged = gates.map((gate) => nextByKey.get(gate.key) ?? gate);
  for (const gate of nextGates) {
    if (!gates.some((item) => item.key === gate.key)) {
      merged.push(gate);
    }
  }
  return merged;
}

function shrinkRange(range: ExposureRange | null, cut: number): ExposureRange | null {
  if (!range || cut <= 0) return range;
  const max = clamp(Math.round(range.max - cut), 0, 100);
  const min = clamp(Math.min(range.min, max), 0, 100);
  return {
    min,
    max,
    display: min === max ? `${max}%` : `${min}%~${max}%`,
  };
}

function horizonAdjustedCut(horizonKey: string, cut: number) {
  if (cut <= 0) return 0;
  if (horizonKey === "long") return Math.round(cut * 0.45);
  if (horizonKey === "medium") return Math.round(cut * 0.72);
  return cut;
}

function isRiskLikeProtocol(report: MarketAnalysisReport) {
  const protocol = report.decisionFrame.protocolState;
  return protocol === "observe" || protocol === "broken" || protocol === "panic" || report.decisionFrame.permissionTone === "caution" || report.decisionFrame.permissionTone === "negative";
}

function internalPressureScore(internals: MarketInternals) {
  const breadthDamage = internals.breadthAdvancingRatio == null ? 45 : 100 - internals.breadthAdvancingRatio;
  const relativeWeakness = internals.relativeWeaknessRatio ?? 45;
  const signalPressure = internals.signals.reduce((sum, signal) => sum + (signal.tone === "negative" ? 78 : signal.tone === "caution" ? 58 : signal.tone === "neutral" ? 42 : 18), 0) / Math.max(1, internals.signals.length);
  return clamp(Math.round(breadthDamage * 0.42 + relativeWeakness * 0.32 + signalPressure * 0.26), 0, 100);
}

function coreBreakdownScore(report: MarketAnalysisReport) {
  const statuses = [...report.assetStatuses.map((asset) => asset.status), ...report.technicalRows.map((row) => row.status)];
  if (!statuses.length) return 45;
  const pressure = statuses.reduce((sum, status) => sum + (status === "red" ? 88 : status === "yellow" ? 58 : status === "green" ? 18 : 42), 0) / statuses.length;
  const breakdownNotes = report.technicalRows.filter((row) => /跌破|走弱|弱|承压|压力|回落|分歧|滞涨/u.test(row.note)).length;
  return clamp(Math.round(pressure + breakdownNotes * 4), 0, 100);
}

function coreBreakdownDetail(report: MarketAnalysisReport) {
  const weakRows = report.technicalRows
    .filter((row) => row.status === "red" || /跌破|走弱|弱|承压|压力|回落|分歧|滞涨/u.test(row.note))
    .slice(0, 3)
    .map((row) => `${row.symbol} ${row.note}`);
  return weakRows.length ? weakRows.join("；") : "核心标的未出现明显破位。";
}

function factorScore(report: MarketAnalysisReport, key: string, fallback: number) {
  return report.factorScores.find((item) => item.key === key)?.score ?? fallback;
}

function factorDetail(report: MarketAnalysisReport, key: string) {
  return report.factorScores.find((item) => item.key === key)?.detail ?? `${key} 暂无细分说明。`;
}

function axisScore(report: MarketAnalysisReport, key: string, fallback: number) {
  if (key === "trend") return report.decisionFrame.trend?.score ?? fallback;
  if (key === "risk") return report.decisionFrame.risk?.score ?? fallback;
  if (key === "edge") return report.decisionFrame.edge?.score ?? fallback;
  return fallback;
}

function signalDetail(internals: MarketInternals, key: string) {
  return internals.signals.find((signal) => signal.key === key)?.detail ?? "未发现对应内部信号。";
}

function riskStatus(score: number) {
  if (score >= 76) return "很高";
  if (score >= 60) return "高";
  if (score >= 38) return "中";
  return "低";
}

function riskTone(score: number): IntelligenceTone {
  if (score >= 76) return "negative";
  if (score >= 55) return "caution";
  if (score >= 34) return "neutral";
  return "positive";
}

function confidenceLabel(score: number) {
  if (score >= 76) return "高置信";
  if (score >= 58) return "中置信";
  if (score >= 42) return "低置信";
  return "不稳定";
}

function confidenceTone(score: number): IntelligenceTone {
  if (score >= 76) return "positive";
  if (score >= 58) return "neutral";
  if (score >= 42) return "caution";
  return "negative";
}

function signalQualityLabel(score: number) {
  if (score >= 76) return "高质量";
  if (score >= 58) return "可用";
  if (score >= 42) return "需复核";
  return "低可信";
}

function signalQualityEffect(score: number): SignalQuality["effect"] {
  if (score >= 76) return "trust";
  if (score >= 58) return "verify";
  if (score >= 42) return "limit";
  return "insufficient";
}

function damageLabel(score: number) {
  if (score >= 76) return "重损伤";
  if (score >= 58) return "扩散损伤";
  if (score >= 42) return "轻损伤";
  return "结构可控";
}

function damageEffect(score: number): DamageScore["effect"] {
  if (score >= 82) return "reduce_risk";
  if (score >= 70) return "block_add";
  if (score >= 45) return "cap_add";
  return "allow";
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
