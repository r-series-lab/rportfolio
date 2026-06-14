import type { HoldingRecord } from "./holdings";
import type { FundProfileSeed, ProfileSummary } from "./types";

type ProfileSymbolConfig = {
  symbol: string;
  yahooSymbol: string;
  label: string;
  role: string;
  weight: number;
  sector: string;
  style: string;
  exposure: string;
};

type TechnicalColumnConfig = {
  key: string;
  label: string;
  metric: string;
  format: string;
  align: "right" | "left";
  period?: number;
  leftPeriod?: number;
  rightPeriod?: number;
  tone?: string;
};

type RuleConfig = {
  type: string;
  points: number;
  reason: string;
  symbol?: string;
  other?: string;
  symbols?: string[];
  period?: number;
  days?: number;
  threshold?: number;
  maxThreshold?: number;
  buffer?: number;
};

type DimensionConfig = {
  key: string;
  label: string;
  factor: string;
  weight: number;
  rules: RuleConfig[];
};

type FundProfileTemplate = {
  market: string;
  benchmark: string;
  benchmarkName: string;
  baseCurrency: string;
  symbols: ProfileSymbolConfig[];
  dimensions: DimensionConfig[];
};

export function buildFundProfileContentFromHolding(
  holding: HoldingRecord,
  seed: FundProfileSeed,
  profiles: ProfileSummary[],
) {
  const fundName = cleanText(seed.name) || cleanText(holding.name) || `基金 ${seed.code}`;
  const template = fundTemplateFor(seed, holding);
  const profileKey = profileKeyFor(holding, seed, profiles);
  const stockWeight = seed.stockWeight ?? seed.latestStockPosition;
  const holdingsAsOf = seed.assetAllocationAsOf ?? seed.navDate ?? "";
  const notes = fundNotes(seed, holding);
  const profile = {
    key: profileKey,
    name: `${fundName} Profile`,
    market: template.market,
    benchmark: template.benchmark,
    description: `${fundName}（${seed.code}）${seed.fundType ? ` · ${seed.fundType}` : ""}，由持仓列表联动生成的基金观察 Profile。`,
    fund: {
      code: seed.code,
      name: fundName,
      fundType: normalizeFundType(seed.fundType),
      manager: seed.manager,
      issuer: seed.issuer,
      navSymbol: seed.navSymbol || seed.code,
      holdingsAsOf,
      holdingsSource: `${seed.sourceName || holdingQuoteSource(holding)} · ${seed.fetchedAt.slice(0, 10)}`,
      notes,
    },
    mandate: {
      mandateType: "基金持仓联动监控",
      baseCurrency: template.baseCurrency,
      benchmarkName: template.benchmarkName,
      objective: `围绕 ${fundName} 的净值、主题代理和系统风险做轻量监控；持仓页负责真实份额，Profile 负责分析视角。`,
      timeHorizon: "3-12 个月状态跟踪，短线只作为加减仓触发参考。",
      riskBudget: fundRiskBudget(seed),
      maxDrawdown: seed.fundType.includes("债") ? "5%-12%" : "12%-25%",
      targetGrossExposure: stockWeight == null ? "按基金原始仓位观察，不自动推导加仓比例。" : `${Math.round(stockWeight)}% 附近，以公开披露/估算仓位为参考。`,
      rebalanceCadence: "日度评分，触发式调整",
      liquidity: "以基金份额流动性和代理资产实时状态共同确认",
      riskScoreLimit: seed.fundType.includes("债") ? 55 : 65,
      constraints: [
        { key: "public_data_lag", label: "公开资料滞后", value: "季报/公开估算可能滞后，保存前核对最新披露", tone: "caution" },
        { key: "no_chasing", label: "不追高", value: "主题过热或基准跌破 MA20 时不新增追高", tone: "caution" },
        { key: "risk_first", label: "风险优先", value: "系统压力高于风险上限时先控制新增申购", tone: "negative" },
      ],
      notes: [
        `持仓关联：${holding.symbol} · ${holding.name}`,
        `主题标签：${seed.topicLabels.length ? seed.topicLabels.join(" / ") : "公开资料"}`,
        "Profile 的代理篮子用于风险监控，不等同于基金真实持仓穿透。",
      ],
    },
    symbols: template.symbols,
    technicalColumns: technicalColumnsFor(template.benchmark),
    dimensions: template.dimensions,
  };

  return JSON.stringify(profile, null, 2);
}

function profileKeyFor(holding: HoldingRecord, seed: FundProfileSeed, profiles: ProfileSummary[]) {
  const linkedKey = cleanText(holding.profileKey);
  if (linkedKey && !profiles.some((profile) => profile.key === linkedKey && profile.builtin)) {
    return linkedKey;
  }

  const baseKey = `cn-fund-${seed.code}`;
  const conflict = profiles.find((profile) => profile.key === baseKey);
  if (!conflict || !conflict.builtin) return baseKey;
  for (let index = 2; index < 100; index += 1) {
    const next = `${baseKey}-${index}`;
    if (!profiles.some((profile) => profile.key === next)) return next;
  }
  return `${baseKey}-${Date.now().toString(36)}`;
}

function fundTemplateFor(seed: FundProfileSeed, holding: HoldingRecord): FundProfileTemplate {
  if (isOffshoreTechFund(seed, holding)) {
    return offshoreTechTemplate(seed);
  }
  return aShareTemplate(seed);
}

function isOffshoreTechFund(seed: FundProfileSeed, holding: HoldingRecord) {
  const text = `${seed.name} ${seed.fundType} ${seed.topicLabels.join(" ")} ${holding.name}`;
  return /QDII|海外|全球|港股|美股|数字|互联网|科技|AI|人工智能|软件|云/u.test(text);
}

function offshoreTechTemplate(seed: FundProfileSeed): FundProfileTemplate {
  const qdiiName = cleanText(seed.name) || `基金 ${seed.code}`;
  return {
    market: "global",
    benchmark: "QQQ",
    benchmarkName: "纳斯达克100 / 海外数字经济代理篮子",
    baseCurrency: "CNY",
    symbols: [
      { symbol: "QQQ", yahooSymbol: "QQQ", label: "纳斯达克100", role: "benchmark", weight: 35, sector: "美股科技", style: "成长", exposure: "海外" },
      { symbol: "KWEB", yahooSymbol: "KWEB", label: "中概互联网", role: "theme", weight: 16, sector: "互联网", style: "主题", exposure: "海外中概" },
      { symbol: "HSTECH", yahooSymbol: "3033.HK", label: "恒生科技ETF", role: "theme", weight: 14, sector: "港股科技", style: "成长", exposure: "港股" },
      { symbol: "ACWI", yahooSymbol: "ACWI", label: "全球股市", role: "global", weight: 10, sector: "全球宽基", style: "核心", exposure: "全球" },
      { symbol: "SMH", yahooSymbol: "SMH", label: "半导体", role: "sector", weight: 10, sector: "半导体", style: "成长", exposure: "美股" },
      { symbol: "NVDA", yahooSymbol: "NVDA", label: "AI 龙头", role: "leader", weight: 8, sector: "AI 硬件", style: "龙头", exposure: "个股" },
      { symbol: "VIX", yahooSymbol: "^VIX", label: "恐慌", role: "volatility", weight: 0, sector: "波动率", style: "对冲", exposure: "观察" },
      { symbol: "GLD", yahooSymbol: "GLD", label: "黄金", role: "safe_haven", weight: 7, sector: "黄金", style: "防守", exposure: "避险" },
    ],
    dimensions: [
      {
        key: "global_tech_trend",
        label: "海外科技趋势",
        factor: "trend",
        weight: 35,
        rules: [
          { type: "close_below_ma", symbol: "QQQ", period: 20, points: 6, reason: `${qdiiName} 代理基准 QQQ 跌破 MA20，短线趋势转弱` },
          { type: "close_below_ma", symbol: "QQQ", period: 50, points: 12, reason: `${qdiiName} 代理基准 QQQ 跌破 MA50，中期趋势承压` },
          { type: "return_below_relative", symbol: "QQQ", other: "ACWI", days: 20, buffer: 4, points: 7, reason: "纳指明显弱于全球股市，科技成长风格走弱" },
        ],
      },
      {
        key: "digital_theme_heat",
        label: "数字经济拥挤",
        factor: "heat",
        weight: 25,
        rules: [
          { type: "rsi_above", symbol: "QQQ", period: 14, threshold: 75, points: 8, reason: "QQQ RSI {rsi}，海外科技短线过热" },
          { type: "return_above", symbol: "KWEB", days: 20, threshold: 22, points: 8, reason: "中概互联网 20 日涨幅过快，主题追高赔率下降" },
          { type: "return_above", symbol: "HSTECH", days: 20, threshold: 20, points: 7, reason: "恒生科技 20 日涨幅过快，港股科技交易拥挤" },
        ],
      },
      {
        key: "leader_confirmation",
        label: "龙头确认",
        factor: "momentum",
        weight: 20,
        rules: [
          { type: "close_below_ma", symbol: "NVDA", period: 50, points: 8, reason: "AI 龙头跌破 MA50，海外科技风险外溢" },
          { type: "relative_strength_declined", symbol: "SMH", other: "QQQ", days: 5, points: 6, reason: "半导体相对 QQQ 连续走弱，AI 主线确认不足" },
          { type: "relative_strength_declined", symbol: "KWEB", other: "QQQ", days: 5, points: 6, reason: "中概互联网相对 QQQ 走弱，数字经济扩散不足" },
        ],
      },
      {
        key: "systemic_guard",
        label: "系统压力",
        factor: "systemic",
        weight: 20,
        rules: [
          { type: "close_gte", symbol: "VIX", threshold: 20, maxThreshold: 25, points: 7, reason: "VIX {close}，海外风险偏好降温" },
          { type: "close_gte", symbol: "VIX", threshold: 25, points: 12, reason: "VIX {close}，高波动压制科技估值" },
          { type: "relative_strength_declined", symbol: "ACWI", other: "GLD", days: 5, points: 6, reason: "全球股市相对黄金连续走弱，避险切换升温" },
        ],
      },
    ],
  };
}

function aShareTemplate(seed: FundProfileSeed): FundProfileTemplate {
  const theme = themeSymbolFor(seed);
  const symbols = theme
    ? [
        { symbol: "CSI300", yahooSymbol: "510300.SS", label: "沪深300ETF", role: "benchmark", weight: 35, sector: "宽基", style: "核心", exposure: "A股" },
        { ...theme, weight: 20 },
        { symbol: "SSE50", yahooSymbol: "510050.SS", label: "上证50ETF", role: "large_cap", weight: 12, sector: "大盘蓝筹", style: "价值", exposure: "A股" },
        { symbol: "CHINEXT", yahooSymbol: "159915.SZ", label: "创业板ETF", role: "growth", weight: 12, sector: "成长", style: "成长", exposure: "A股" },
        { symbol: "STAR50", yahooSymbol: "588000.SS", label: "科创50ETF", role: "growth", weight: 8, sector: "科技", style: "成长", exposure: "A股" },
        { symbol: "CSI1000", yahooSymbol: "159845.SZ", label: "中证1000ETF", role: "breadth", weight: 8, sector: "小盘", style: "风险偏好", exposure: "A股" },
        { symbol: "ASHR", yahooSymbol: "ASHR", label: "海外A股ETF", role: "offshore", weight: 5, sector: "离岸A股", style: "外资", exposure: "离岸" },
      ]
    : [
        { symbol: "CSI300", yahooSymbol: "510300.SS", label: "沪深300ETF", role: "benchmark", weight: 35, sector: "宽基", style: "核心", exposure: "A股" },
        { symbol: "SSE50", yahooSymbol: "510050.SS", label: "上证50ETF", role: "large_cap", weight: 20, sector: "大盘蓝筹", style: "价值", exposure: "A股" },
        { symbol: "CHINEXT", yahooSymbol: "159915.SZ", label: "创业板ETF", role: "growth", weight: 18, sector: "成长", style: "成长", exposure: "A股" },
        { symbol: "STAR50", yahooSymbol: "588000.SS", label: "科创50ETF", role: "growth", weight: 12, sector: "科技", style: "成长", exposure: "A股" },
        { symbol: "CSI1000", yahooSymbol: "159845.SZ", label: "中证1000ETF", role: "breadth", weight: 10, sector: "小盘", style: "风险偏好", exposure: "A股" },
        { symbol: "ASHR", yahooSymbol: "ASHR", label: "海外A股ETF", role: "offshore", weight: 5, sector: "离岸A股", style: "外资", exposure: "离岸" },
      ];
  const themeSymbol = theme?.symbol ?? "CHINEXT";
  const themeLabel = theme?.label ?? "成长风格";

  return {
    market: "cn",
    benchmark: "CSI300",
    benchmarkName: "沪深300 / 原基金业绩比较基准需人工核对",
    baseCurrency: "CNY",
    symbols,
    dimensions: [
      {
        key: "fund_trend",
        label: "基金基准趋势",
        factor: "trend",
        weight: 35,
        rules: [
          { type: "close_below_ma", symbol: "CSI300", period: 20, points: 8, reason: "沪深300 跌破 MA20，基金新增申购需要等待修复" },
          { type: "close_below_ma", symbol: "CSI300", period: 50, points: 12, reason: "沪深300 跌破 MA50，中期趋势承压" },
          { type: "close_below_ma", symbol: "CSI300", period: 200, points: 14, reason: "沪深300 跌破 MA200，长期风险升高" },
        ],
      },
      {
        key: "theme_heat",
        label: "主题拥挤",
        factor: "heat",
        weight: 25,
        rules: [
          { type: "rsi_above", symbol: themeSymbol, period: 14, threshold: 75, points: 9, reason: `${themeLabel} RSI {rsi}，主题短线过热` },
          { type: "return_above", symbol: themeSymbol, days: 20, threshold: 18, points: 8, reason: `${themeLabel} 20 日涨幅过快，新增追高赔率下降` },
        ],
      },
      {
        key: "market_breadth",
        label: "市场宽度",
        factor: "structure",
        weight: 20,
        rules: [
          { type: "relative_strength_declined", symbol: "CSI1000", other: "CSI300", days: 5, points: 8, reason: "中证1000 相对沪深300 连续走弱，风险偏好收缩" },
          { type: "relative_strength_declined", symbol: "CHINEXT", other: "CSI300", days: 5, points: 6, reason: "创业板相对沪深300 连续走弱，成长风格确认不足" },
        ],
      },
      {
        key: "systemic_guard",
        label: "系统压力",
        factor: "systemic",
        weight: 20,
        rules: [
          { type: "close_below_ma", symbol: "ASHR", period: 50, points: 7, reason: "海外A股ETF 跌破 MA50，外部确认不足" },
          { type: "return_below_relative", symbol: "ASHR", other: "CSI300", days: 20, buffer: 4, points: 6, reason: "海外A股ETF 明显弱于沪深300，离岸情绪偏弱" },
        ],
      },
    ],
  };
}

function themeSymbolFor(seed: FundProfileSeed): ProfileSymbolConfig | null {
  const text = `${seed.name} ${seed.topicLabels.join(" ")}`;
  if (/消费|食品|饮料/u.test(text)) {
    return { symbol: "CONSUMPTION", yahooSymbol: "159928.SZ", label: "消费ETF", role: "theme", weight: 0, sector: "消费", style: "主题", exposure: "A股" };
  }
  if (/医药|医疗|生物/u.test(text)) {
    return { symbol: "HEALTHCARE", yahooSymbol: "512010.SS", label: "医药ETF", role: "theme", weight: 0, sector: "医药", style: "防御成长", exposure: "A股" };
  }
  if (/半导体|芯片|集成电路/u.test(text)) {
    return { symbol: "SEMICONDUCTOR_CN", yahooSymbol: "512480.SS", label: "半导体ETF", role: "theme", weight: 0, sector: "半导体", style: "成长", exposure: "A股" };
  }
  if (/新能源|电池|光伏|车/u.test(text)) {
    return { symbol: "NEWENERGY", yahooSymbol: "515030.SS", label: "新能源车ETF", role: "theme", weight: 0, sector: "新能源", style: "成长", exposure: "A股" };
  }
  return null;
}

function technicalColumnsFor(benchmark: string): TechnicalColumnConfig[] {
  return [
    { key: "close", label: "收盘", metric: "close", format: "number", align: "right" },
    { key: "change1d", label: "1D", metric: "change_1d", format: "percent", tone: "signed", align: "right" },
    { key: "return10d", label: "10D", metric: "return", period: 10, format: "percent", tone: "signed", align: "right" },
    { key: "return20d", label: "20D", metric: "return", period: 20, format: "percent", tone: "signed", align: "right" },
    { key: "rsi14", label: "RSI", metric: "rsi", period: 14, format: "number1", align: "right" },
    { key: `${benchmark.toLowerCase()}Ma`, label: "MA20/50", metric: "ma_pair", leftPeriod: 20, rightPeriod: 50, format: "pair0", align: "right" },
    { key: "volumeRatio", label: "量比", metric: "volume_ratio", format: "ratio", align: "right" },
  ];
}

function fundNotes(seed: FundProfileSeed, holding: HoldingRecord) {
  const details = [
    seed.nav == null ? "" : `最新净值 ${seed.nav}${seed.navDate ? `（${seed.navDate}）` : ""}`,
    seed.estimateChange == null ? "" : `估值变化 ${seed.estimateChange}%${seed.estimateTime ? `（${seed.estimateTime}）` : ""}`,
    seed.stockWeight == null ? "" : `股票仓位 ${seed.stockWeight}%`,
    seed.latestStockPosition == null ? "" : `仓位测算 ${seed.latestStockPosition}%`,
    holding.targetWeight > 0 ? `持仓目标权重 ${holding.targetWeight}%` : "",
    `公开资料源：${seed.sourceName || holdingQuoteSource(holding)}；${seed.sourceUrl}`,
    seed.warnings.length ? `数据提示：${seed.warnings.join("；")}` : "",
  ].filter(Boolean);
  return details;
}

function fundRiskBudget(seed: FundProfileSeed) {
  const stockWeight = seed.stockWeight ?? seed.latestStockPosition;
  if (seed.fundType.includes("债")) {
    return "以回撤控制和久期/信用风险为主，风险升高时先降低新增申购节奏。";
  }
  if (stockWeight != null && stockWeight >= 85) {
    return "高股票仓位基金，新增申购需要同时满足基准趋势修复、主题不过热和系统压力下降。";
  }
  return "按 Trend / Risk / Edge 管控新增仓位，公开资料只做基金画像，不替代真实持仓确认。";
}

function normalizeFundType(value: string) {
  const text = cleanText(value);
  if (/债|货币/u.test(text)) return text || "fixed_income";
  if (/指数|ETF|联接/u.test(text)) return text || "index_fund";
  if (/QDII|海外|全球|港股|美股/u.test(text)) return text || "qdii";
  if (/混合/u.test(text)) return text || "balanced";
  return text || "active_equity";
}

function holdingQuoteSource(holding: HoldingRecord) {
  return holding.quoteSource === "eastmoney_tiantian" ? "东方财富 / 天天基金" : "持仓列表";
}

function cleanText(value: string | undefined) {
  return (value ?? "").trim();
}
