import type { HoldingRecord, HoldingRole } from "./holdings";
import { isHoldingRecord } from "./holdings";
import { isCashHolding } from "./position-plan";
import {
  DEFAULT_PORTFOLIO_VALUATION_SETTINGS,
  holdingCostValueInBase,
  holdingMarketValueInBase,
  type PortfolioValuationSettings,
} from "./portfolio-valuation";
import type { LightStatus, PortfolioHolding, PortfolioProfile } from "./types";

export function portfolioProfileFromHoldings(
  storedHoldings: HoldingRecord[],
  fallback: PortfolioProfile,
  marketRiskScore: number,
  valuation: Partial<PortfolioValuationSettings> = DEFAULT_PORTFOLIO_VALUATION_SETTINGS,
): PortfolioProfile {
  const localHoldings = storedHoldings.filter(isHoldingRecord);
  if (!localHoldings.length) {
    return fallback;
  }

  const realHoldings = localHoldings.filter((holding) => holding.role === "real");
  const realMarketValue = realHoldings.reduce((sum, holding) => sum + (holdingMarketValueInBase(holding, valuation) ?? 0), 0);
  const portfolioHoldings = localHoldings
    .map((holding) => portfolioHoldingFromLocal(holding, realMarketValue, valuation))
    .sort((left, right) => {
      const kindOrder = assetKindOrder(left.assetKind);
      const rightKindOrder = assetKindOrder(right.assetKind);
      if (kindOrder !== rightKindOrder) return kindOrder - rightKindOrder;
      return right.weight - left.weight;
    });
  const healthHoldings = portfolioHoldings.filter((holding) => holding.assetKind === "holding" && holding.weight > 0);
  const cashWeight = round1(
    portfolioHoldings
      .filter((holding) => holding.assetKind === "cash")
      .reduce((sum, holding) => sum + holding.weight, 0),
  );

  if (!healthHoldings.length) {
    return {
      ...fallback,
      cashWeight,
      summary: cashWeight > 0 ? "本地持仓只包含现金，暂不覆盖风险仓位健康度。" : "本地持仓只包含代理或观察资产，暂不覆盖持仓健康度。",
    };
  }

  const totalWeight = round1(healthHoldings.reduce((sum, item) => sum + item.weight, 0));
  const healthScore = Math.round(
    healthHoldings.reduce((sum, item) => sum + item.healthScore * item.weight, 0) / Math.max(1, totalWeight),
  );
  const sectorExposure = exposureGroup("sector", healthHoldings);
  const styleExposure = exposureGroup("style", healthHoldings);
  const exposureBreakdown = exposureGroup("exposure", healthHoldings);
  const topHolding = [...healthHoldings].sort((left, right) => right.weight - left.weight)[0];
  const topSector = sectorExposure[0];
  const topStyle = styleExposure[0];
  const topExposure = exposureBreakdown[0];
  const concentrationScore = clamp(
    (topHolding?.weight ?? 0) * 1.2 + (topSector?.weight ?? 0) * 0.62 + Math.max(0, (topStyle?.weight ?? 0) - 45) * 0.72,
    0,
    100,
  );
  const weightedRiskScore = Math.round((100 - healthScore) * 0.5 + concentrationScore * 0.22 + marketRiskScore * 0.28);
  const roleCounts = countRoles(localHoldings);
  const maxTargetDriftValue = maxTargetDrift(localHoldings, realMarketValue, valuation);

  return {
    totalWeight,
    cashWeight,
    healthScore,
    healthLabel: healthLabel(healthScore),
    healthTone: healthTone(healthScore),
    concentrationScore: Math.round(concentrationScore),
    concentrationLabel: concentrationLabel(concentrationScore),
    concentrationTone: concentrationToneFor(concentrationScore),
    topHoldingWeight: topHolding?.weight ?? 0,
    topHolding: topHolding?.label ?? "-",
    topSector: topSector ? `${topSector.label} ${topSector.weight}%` : "-",
    topStyle: topStyle ? `${topStyle.label} ${topStyle.weight}%` : "-",
    topExposure: topExposure ? `${topExposure.label} ${topExposure.weight}%` : "-",
    weightedRiskScore,
    summary: `已接入本地持仓：真实 ${roleCounts.real}、代理 ${roleCounts.proxy}、观察 ${roleCounts.watch}。`,
    holdings: portfolioHoldings,
    sectorExposure,
    styleExposure,
    exposureBreakdown,
    actions: [
      {
        key: "local_holdings_linked",
        label: "本地持仓",
        tone: "positive",
        detail: `组合分析已使用本地持仓计算健康度；代理和观察资产不计入仓位健康度。`,
      },
      {
        key: "local_concentration",
        label: "集中风险",
        tone: concentrationToneFor(concentrationScore),
        detail: topSector
          ? `${topSector.label} 权重 ${topSector.weight}%，新增仓位前先检查目标权重和风险门。`
          : "本地持仓暂未形成明显集中暴露。",
      },
      {
        key: "local_target_drift",
        label: "目标偏离",
        tone: targetDriftTone(maxTargetDriftValue),
        detail: targetDriftDetail(maxTargetDriftValue),
      },
    ],
  };
}

export function localHoldingsCounts(storedHoldings: HoldingRecord[]) {
  return countRoles(storedHoldings.filter(isHoldingRecord));
}

function portfolioHoldingFromLocal(
  holding: HoldingRecord,
  realMarketValue: number,
  valuation: Partial<PortfolioValuationSettings>,
): PortfolioHolding {
  const value = holdingMarketValueInBase(holding, valuation) ?? 0;
  const costValue = holdingCostValueInBase(holding, valuation) ?? 0;
  const pnlPct = costValue > 0 ? ((value - costValue) / costValue) * 100 : null;
  const weight = holding.role === "real" && realMarketValue > 0 ? (value / realMarketValue) * 100 : 0;
  const cash = isCashHolding(holding);
  const drift = holding.role === "real" && !cash && holding.targetWeight > 0 ? Math.abs(weight - holding.targetWeight) : 0;
  const healthScore = cash ? 82 : holding.role === "real" ? localHealthScore(pnlPct, drift, holding.currentPrice > 0) : 58;
  const status = statusForHealth(healthScore);
  const kind = assetKindForHolding(holding);

  return {
    symbol: holding.symbol,
    label: holding.name,
    assetKind: kind,
    weight: round1(weight),
    sector: inferSector(holding),
    style: styleForRole(holding.role),
    exposure: exposureForHolding(holding),
    status,
    statusLabel: statusLabel(status),
    healthScore,
    healthTone: healthTone(healthScore),
    contributionRisk: Math.round(((100 - healthScore) * weight) / 100),
    return20d: pnlPct === null ? null : round1(pnlPct),
    ma20Gap: null,
    note: noteForHolding(holding, pnlPct, drift),
  };
}

function localHealthScore(pnlPct: number | null, drift: number, hasPrice: boolean) {
  const pnlLift = pnlPct === null ? -6 : clamp(pnlPct * 0.9, -24, 18);
  const driftPenalty = clamp(drift * 0.35, 0, 18);
  const pricePenalty = hasPrice ? 0 : 20;
  return Math.round(clamp(68 + pnlLift - driftPenalty - pricePenalty, 0, 100));
}

function inferSector(holding: HoldingRecord) {
  if (isCashHolding(holding)) return "现金";
  const text = `${holding.symbol} ${holding.name}`.toUpperCase();
  if (/(SMH|SOXX|NVDA|AMD|半导体|芯片)/u.test(text)) return "半导体";
  if (/(QQQ|XLK|科技|SOFTWARE|AI|人工智能)/u.test(text)) return "科技";
  if (/(SPY|VOO|IVV|沪深|中证|宽基|标普|纳指)/u.test(text)) return "宽基";
  if (/(IWM|小盘|RUSSELL)/u.test(text)) return "小盘";
  if (/(TLT|BOND|债|国债)/u.test(text)) return "债券";
  if (/(GLD|GOLD|黄金|商品|COMMODITY)/u.test(text)) return "商品";
  return holding.role === "real" ? "自定义" : holding.role === "proxy" ? "代理" : "观察";
}

function styleForRole(role: HoldingRole) {
  if (role === "real") return "真实";
  if (role === "proxy") return "代理";
  return "观察";
}

function exposureForHolding(holding: HoldingRecord) {
  if (isCashHolding(holding)) return holding.currency.toUpperCase();
  if (holding.role === "proxy") return "代理资产";
  if (holding.role === "watch") return "观察资产";
  return holding.market.toUpperCase();
}

function noteForHolding(holding: HoldingRecord, pnlPct: number | null, drift: number) {
  if (isCashHolding(holding)) return "现金缓冲，不参与风险仓位健康度";
  if (holding.role !== "real") return holding.role === "proxy" ? "代理资产不计入健康度" : "观察资产不计入健康度";
  if (holding.targetWeight > 0 && drift >= 12) return "偏离目标权重较大";
  if (pnlPct !== null && pnlPct < -8) return "账面亏损较大";
  if (pnlPct !== null && pnlPct > 12) return "盈利扩张，注意回撤";
  return holding.notes || "本地持仓";
}

function exposureGroup(kind: "sector" | "style" | "exposure", holdings: PortfolioHolding[]) {
  const totals = holdings.reduce<Record<string, number>>((acc, holding) => {
    const key = kind === "sector" ? holding.sector : kind === "style" ? holding.style : holding.exposure;
    acc[key] = (acc[key] ?? 0) + holding.weight;
    return acc;
  }, {});

  return Object.entries(totals)
    .filter(([, weight]) => weight > 0)
    .map(([label, weight]) => ({
      key: `${kind}-${label}`,
      label,
      kind,
      weight: round1(weight),
      tone: exposureTone(weight),
      status: weight >= 45 ? "集中" : weight >= 30 ? "偏高" : "分散",
    }))
    .sort((left, right) => right.weight - left.weight);
}

function targetDriftTone(maxDrift: number) {
  if (maxDrift >= 20) return "negative";
  if (maxDrift >= 10) return "caution";
  return "neutral";
}

function targetDriftDetail(maxDrift: number) {
  if (maxDrift === 0) return "未设置目标权重，暂不计算目标偏离。";
  if (maxDrift >= 20) return `最大目标偏离 ${round1(maxDrift)}%，先校准目标仓位再扩大风险。`;
  return `最大目标偏离 ${round1(maxDrift)}%，仓位结构仍可控。`;
}

function maxTargetDrift(
  holdings: HoldingRecord[],
  realMarketValue: number,
  valuation: Partial<PortfolioValuationSettings>,
) {
  return holdings.reduce((max, holding) => {
    if (holding.role !== "real" || isCashHolding(holding) || holding.targetWeight <= 0 || realMarketValue <= 0) return max;
    const weight = ((holdingMarketValueInBase(holding, valuation) ?? 0) / realMarketValue) * 100;
    return Math.max(max, Math.abs(weight - holding.targetWeight));
  }, 0);
}

function countRoles(holdings: HoldingRecord[]) {
  return holdings.reduce(
    (acc, holding) => {
      acc[holding.role] += 1;
      return acc;
    },
    { proxy: 0, real: 0, watch: 0 },
  );
}

function assetKindForHolding(holding: HoldingRecord) {
  if (isCashHolding(holding)) return "cash";
  if (holding.role === "real") return "holding";
  if (holding.role === "proxy") return "proxy";
  return "observer";
}

function assetKindOrder(kind: PortfolioHolding["assetKind"]) {
  if (kind === "holding") return 0;
  if (kind === "cash") return 1;
  if (kind === "proxy") return 2;
  return 3;
}

function statusForHealth(score: number): LightStatus {
  if (score >= 70) return "green";
  if (score >= 45) return "yellow";
  return "red";
}

function statusLabel(status: LightStatus) {
  if (status === "green") return "绿灯";
  if (status === "yellow") return "黄灯";
  return "红灯";
}

function healthLabel(score: number) {
  if (score >= 78) return "健康";
  if (score >= 62) return "可持有";
  if (score >= 45) return "需观察";
  return "偏脆弱";
}

function healthTone(score: number) {
  if (score >= 75) return "positive";
  if (score >= 58) return "neutral";
  if (score >= 42) return "caution";
  return "negative";
}

function concentrationLabel(score: number) {
  if (score >= 75) return "过度集中";
  if (score >= 55) return "偏集中";
  if (score >= 35) return "中等";
  return "分散";
}

function concentrationToneFor(score: number) {
  if (score >= 75) return "negative";
  if (score >= 55) return "caution";
  if (score >= 35) return "neutral";
  return "positive";
}

function exposureTone(weight: number) {
  if (weight >= 50) return "negative";
  if (weight >= 35) return "caution";
  if (weight >= 20) return "neutral";
  return "positive";
}

function round1(value: number) {
  return Math.round(value * 10) / 10;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
