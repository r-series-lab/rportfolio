import { fetchProfileSummaries, importProfileConfig } from "./analysis";
import type { HoldingRecord } from "./holdings";

export const REQUESTED_FUND_SEED_STORAGE_KEY = "rportfolio.requestedFundSeeds.20260611.018147.017437";

type MergeRequestedFundHoldingsResult = {
  holdings: HoldingRecord[];
  addedSymbols: string[];
};

const REQUESTED_FUND_HOLDINGS: HoldingRecord[] = [
  {
    id: "requested-018147-fund",
    symbol: "018147",
    name: "建信新兴市场优选混合(QDII)C",
    market: "CN",
    currency: "CNY",
    role: "real",
    assetType: "fund",
    quoteSource: "eastmoney_tiantian",
    profileKey: "cn-fund-018147",
    quantity: 2800,
    costPrice: 2.4,
    currentPrice: 2.495,
    targetMinWeight: 2,
    targetWeight: 5,
    targetMaxWeight: 7,
    notes: "按 2026-06-11 请求补充的 QDII 新兴市场基金持仓，仓位和价格用于整体效果预览，后续可手动调整。",
  },
  {
    id: "requested-017437-fund",
    symbol: "017437",
    name: "华宝纳斯达克精选股票发起式(QDII)C",
    market: "CN",
    currency: "CNY",
    role: "real",
    assetType: "fund",
    quoteSource: "eastmoney_tiantian",
    profileKey: "cn-fund-017437",
    quantity: 3600,
    costPrice: 2.36,
    currentPrice: 2.4755,
    targetMinWeight: 3,
    targetWeight: 6,
    targetMaxWeight: 9,
    notes: "按 2026-06-11 请求补充的纳斯达克主动基金持仓，仓位和价格用于整体效果预览，后续可手动调整。",
  },
];

const TECHNICAL_COLUMNS = [
  { key: "close", label: "收盘", metric: "close", format: "number", align: "right" },
  { key: "change1d", label: "1D", metric: "change_1d", format: "percent", tone: "signed", align: "right" },
  { key: "return10d", label: "10D", metric: "return", period: 10, format: "percent", tone: "signed", align: "right" },
  { key: "return20d", label: "20D", metric: "return", period: 20, format: "percent", tone: "signed", align: "right" },
  { key: "rsi14", label: "RSI", metric: "rsi", period: 14, format: "number1", align: "right" },
  { key: "ma20_50", label: "MA20/50", metric: "ma_pair", leftPeriod: 20, rightPeriod: 50, format: "pair0", align: "right" },
  { key: "volumeRatio", label: "量比", metric: "volume_ratio", format: "ratio", align: "right" },
];

const REQUESTED_FUND_PROFILE_CONTENTS = [
  profileContent({
    key: "cn-fund-018147",
    name: "建信新兴市场优选混合(QDII)C Profile",
    market: "global",
    benchmark: "EEM",
    description: "建信新兴市场优选混合(QDII)C（018147）· QDII-混合，由 2026-06-11 本地持仓补充生成的基金观察 Profile。",
    fund: {
      code: "018147",
      name: "建信新兴市场优选混合(QDII)C",
      fundType: "QDII-混合",
      manager: "",
      issuer: "建信基金",
      navSymbol: "018147",
      holdingsAsOf: "2026-03-31",
      holdingsSource: "东方财富 / 天天基金公开资料 · 2026-06-11",
      notes: [
        "公开资料显示该基金为 QDII 新兴市场主题，细分持仓需以后续披露或手动导入为准。",
        "持仓目标权重 5%，建议先作为 2%-7% 的观察仓位。",
        "Profile 的代理篮子用于风险监控，不等同于基金真实持仓穿透。",
      ],
    },
    mandate: {
      mandateType: "基金持仓联动监控",
      baseCurrency: "CNY",
      benchmarkName: "MSCI 新兴市场代理篮子",
      objective: "围绕 018147 的新兴市场、海外半导体和系统风险做轻量监控；持仓页负责真实份额，Profile 负责分析视角。",
      timeHorizon: "短期 0-2 周看买点确认；中期 2-12 周看目标带；长期 3-12 个月看风险预算。",
      riskBudget: "新兴市场基金波动和汇率风险更高，新增申购需要同时满足 EEM 趋势修复、半导体不过热和 VIX 压力下降。",
      maxDrawdown: "12%-25%",
      targetGrossExposure: "高权益 QDII，按公开披露和目标带控制新增节奏。",
      rebalanceCadence: "日度评分，触发式调整",
      liquidity: "以基金份额流动性、净值更新和代理资产状态共同确认",
      riskScoreLimit: 65,
      constraints: [
        { key: "em_volatility", label: "新兴市场波动", value: "EEM 跌破 MA50 或明显弱于 ACWI 时不提高仓位", tone: "caution" },
        { key: "theme_heat", label: "主题过热", value: "半导体代理 20 日涨幅过快时降低追买冲动", tone: "caution" },
        { key: "risk_first", label: "风险优先", value: "VIX 高压或避险切换时先控制新增申购", tone: "negative" },
      ],
      notes: [
        "持仓关联：018147 · 建信新兴市场优选混合(QDII)C",
        "公开资料会滞后，后续建议用官方季报或导入持仓修正代理篮子。",
      ],
    },
    symbols: [
      { symbol: "EEM", yahooSymbol: "EEM", label: "新兴市场", role: "benchmark", weight: 24, sector: "新兴市场", style: "核心", exposure: "全球" },
      { symbol: "VWO", yahooSymbol: "VWO", label: "新兴市场宽基", role: "global", weight: 16, sector: "新兴市场", style: "宽基", exposure: "全球" },
      { symbol: "TSM", yahooSymbol: "TSM", label: "台积电", role: "leader", weight: 14, sector: "半导体", style: "龙头", exposure: "个股" },
      { symbol: "SMH", yahooSymbol: "SMH", label: "半导体", role: "theme", weight: 12, sector: "半导体", style: "成长", exposure: "美股" },
      { symbol: "NVDA", yahooSymbol: "NVDA", label: "AI 龙头", role: "leader", weight: 10, sector: "AI 硬件", style: "龙头", exposure: "个股" },
      { symbol: "EWY", yahooSymbol: "EWY", label: "韩国权益", role: "region", weight: 8, sector: "韩国", style: "周期成长", exposure: "新兴市场" },
      { symbol: "FXI", yahooSymbol: "FXI", label: "中国大盘", role: "region", weight: 8, sector: "中国", style: "价值成长", exposure: "新兴市场" },
      { symbol: "GLD", yahooSymbol: "GLD", label: "黄金", role: "safe_haven", weight: 8, sector: "黄金", style: "防守", exposure: "避险" },
      { symbol: "VIX", yahooSymbol: "^VIX", label: "恐慌", role: "volatility", weight: 0, sector: "波动率", style: "对冲", exposure: "观察" },
    ],
    dimensions: [
      {
        key: "em_trend",
        label: "新兴市场趋势",
        factor: "trend",
        weight: 35,
        rules: [
          { type: "close_below_ma", symbol: "EEM", period: 20, points: 7, reason: "EEM 跌破 MA20，018147 短线新增需要等待确认" },
          { type: "close_below_ma", symbol: "EEM", period: 50, points: 12, reason: "EEM 跌破 MA50，新兴市场中期趋势承压" },
          { type: "return_below_relative", symbol: "EEM", other: "VWO", days: 20, buffer: 3, points: 6, reason: "EEM 明显弱于 VWO，区域结构确认不足" },
        ],
      },
      {
        key: "semiconductor_heat",
        label: "半导体热度",
        factor: "heat",
        weight: 25,
        rules: [
          { type: "rsi_above", symbol: "SMH", period: 14, threshold: 75, points: 8, reason: "SMH RSI {rsi}，海外半导体短线过热" },
          { type: "return_above", symbol: "SMH", days: 20, threshold: 18, points: 8, reason: "SMH 20 日涨幅过快，新增追高赔率下降" },
          { type: "relative_strength_declined", symbol: "TSM", other: "SMH", days: 5, points: 6, reason: "台积电相对半导体 ETF 走弱，权重确认不足" },
        ],
      },
      {
        key: "regional_breadth",
        label: "区域宽度",
        factor: "structure",
        weight: 20,
        rules: [
          { type: "relative_strength_declined", symbol: "EWY", other: "EEM", days: 5, points: 6, reason: "韩国权益相对新兴市场走弱，区域扩散不足" },
          { type: "relative_strength_declined", symbol: "FXI", other: "EEM", days: 5, points: 6, reason: "中国大盘相对新兴市场走弱，区域支撑不足" },
        ],
      },
      {
        key: "systemic_guard",
        label: "系统压力",
        factor: "systemic",
        weight: 20,
        rules: [
          { type: "close_gte", symbol: "VIX", threshold: 20, maxThreshold: 25, points: 7, reason: "VIX {close}，海外风险偏好降温" },
          { type: "close_gte", symbol: "VIX", threshold: 25, points: 12, reason: "VIX {close}，高波动压制新兴市场估值" },
          { type: "relative_strength_declined", symbol: "EEM", other: "GLD", days: 5, points: 6, reason: "新兴市场相对黄金连续走弱，避险切换升温" },
        ],
      },
    ],
  }),
  profileContent({
    key: "cn-fund-017437",
    name: "华宝纳斯达克精选股票发起式(QDII)C Profile",
    market: "global",
    benchmark: "QQQ",
    description: "华宝纳斯达克精选股票发起式(QDII)C（017437）· QDII-股票，由 2026-06-11 本地持仓补充生成的基金观察 Profile。",
    fund: {
      code: "017437",
      name: "华宝纳斯达克精选股票发起式(QDII)C",
      fundType: "QDII-股票",
      manager: "",
      issuer: "华宝基金",
      navSymbol: "017437",
      holdingsAsOf: "2026-03-31",
      holdingsSource: "东方财富 / 天天基金公开资料 · 2026-06-11",
      notes: [
        "公开资料显示该基金为纳斯达克精选 QDII 主动基金，细分持仓需以后续披露或手动导入为准。",
        "持仓目标权重 6%，建议先作为 3%-9% 的主题仓位。",
        "Profile 的代理篮子用于风险监控，不等同于基金真实持仓穿透。",
      ],
    },
    mandate: {
      mandateType: "基金持仓联动监控",
      baseCurrency: "CNY",
      benchmarkName: "纳斯达克100 / 美股科技代理篮子",
      objective: "围绕 017437 的纳斯达克成长股、AI 龙头和系统压力做轻量监控；持仓页负责真实份额，Profile 负责分析视角。",
      timeHorizon: "短期 0-2 周看买点确认；中期 2-12 周看目标带；长期 3-12 个月看风险预算。",
      riskBudget: "纳斯达克主动基金波动较高，新增申购需要同时满足 QQQ 趋势修复、AI 主线不过热和 VIX 压力下降。",
      maxDrawdown: "15%-28%",
      targetGrossExposure: "高权益 QDII，按公开披露和目标带控制新增节奏。",
      rebalanceCadence: "日度评分，触发式调整",
      liquidity: "以基金份额流动性、净值更新和代理资产状态共同确认",
      riskScoreLimit: 65,
      constraints: [
        { key: "nasdaq_trend", label: "纳指趋势", value: "QQQ 跌破 MA20/MA50 时不提高仓位", tone: "caution" },
        { key: "leader_confirmation", label: "龙头确认", value: "NVDA、MSFT、AAPL 等龙头转弱时控制新增", tone: "caution" },
        { key: "risk_first", label: "风险优先", value: "VIX 高压或黄金相对走强时先控制新增申购", tone: "negative" },
      ],
      notes: [
        "持仓关联：017437 · 华宝纳斯达克精选股票发起式(QDII)C",
        "公开资料会滞后，后续建议用官方季报或导入持仓修正代理篮子。",
      ],
    },
    symbols: [
      { symbol: "QQQ", yahooSymbol: "QQQ", label: "纳斯达克100", role: "benchmark", weight: 30, sector: "美股科技", style: "成长", exposure: "海外" },
      { symbol: "NVDA", yahooSymbol: "NVDA", label: "英伟达", role: "leader", weight: 12, sector: "AI 硬件", style: "龙头", exposure: "个股" },
      { symbol: "MSFT", yahooSymbol: "MSFT", label: "微软", role: "leader", weight: 10, sector: "软件", style: "质量成长", exposure: "个股" },
      { symbol: "AAPL", yahooSymbol: "AAPL", label: "苹果", role: "leader", weight: 10, sector: "消费科技", style: "龙头", exposure: "个股" },
      { symbol: "AVGO", yahooSymbol: "AVGO", label: "博通", role: "leader", weight: 9, sector: "半导体", style: "AI 基建", exposure: "个股" },
      { symbol: "SMH", yahooSymbol: "SMH", label: "半导体", role: "theme", weight: 9, sector: "半导体", style: "成长", exposure: "美股" },
      { symbol: "IGV", yahooSymbol: "IGV", label: "软件", role: "theme", weight: 8, sector: "软件", style: "成长", exposure: "美股" },
      { symbol: "GLD", yahooSymbol: "GLD", label: "黄金", role: "safe_haven", weight: 6, sector: "黄金", style: "防守", exposure: "避险" },
      { symbol: "ACWI", yahooSymbol: "ACWI", label: "全球股市", role: "global", weight: 6, sector: "全球宽基", style: "核心", exposure: "全球" },
      { symbol: "VIX", yahooSymbol: "^VIX", label: "恐慌", role: "volatility", weight: 0, sector: "波动率", style: "对冲", exposure: "观察" },
    ],
    dimensions: [
      {
        key: "nasdaq_trend",
        label: "纳指趋势",
        factor: "trend",
        weight: 35,
        rules: [
          { type: "close_below_ma", symbol: "QQQ", period: 20, points: 7, reason: "QQQ 跌破 MA20，017437 短线新增需要等待确认" },
          { type: "close_below_ma", symbol: "QQQ", period: 50, points: 12, reason: "QQQ 跌破 MA50，纳斯达克中期趋势承压" },
          { type: "return_below_relative", symbol: "QQQ", other: "ACWI", days: 20, buffer: 4, points: 7, reason: "纳指明显弱于全球股市，成长风格走弱" },
        ],
      },
      {
        key: "ai_heat",
        label: "AI 拥挤",
        factor: "heat",
        weight: 25,
        rules: [
          { type: "rsi_above", symbol: "QQQ", period: 14, threshold: 75, points: 8, reason: "QQQ RSI {rsi}，纳指短线过热" },
          { type: "return_above", symbol: "SMH", days: 20, threshold: 18, points: 8, reason: "半导体 20 日涨幅过快，AI 交易拥挤" },
          { type: "return_above", symbol: "NVDA", days: 20, threshold: 22, points: 8, reason: "英伟达 20 日涨幅过快，追高赔率下降" },
        ],
      },
      {
        key: "leader_confirmation",
        label: "龙头确认",
        factor: "momentum",
        weight: 20,
        rules: [
          { type: "close_below_ma", symbol: "NVDA", period: 50, points: 8, reason: "英伟达跌破 MA50，AI 主线确认不足" },
          { type: "close_below_ma", symbol: "MSFT", period: 50, points: 6, reason: "微软跌破 MA50，软件权重承压" },
          { type: "relative_strength_declined", symbol: "SMH", other: "QQQ", days: 5, points: 6, reason: "半导体相对 QQQ 连续走弱，成长主线扩散不足" },
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
          { type: "relative_strength_declined", symbol: "QQQ", other: "GLD", days: 5, points: 6, reason: "纳指相对黄金连续走弱，避险切换升温" },
        ],
      },
    ],
  }),
];

export function mergeRequestedFundHoldings(current: HoldingRecord[]): MergeRequestedFundHoldingsResult {
  const existingSymbols = new Set(current.map((holding) => holding.symbol));
  const missing = REQUESTED_FUND_HOLDINGS.filter((holding) => !existingSymbols.has(holding.symbol));
  return {
    holdings: missing.length ? [...current, ...missing] : current,
    addedSymbols: missing.map((holding) => holding.symbol),
  };
}

export async function importRequestedFundProfiles() {
  const existingProfiles = await fetchProfileSummaries().catch(() => []);
  const existingKeys = new Set(existingProfiles.map((profile) => profile.key));
  const importedKeys: string[] = [];

  for (const profile of REQUESTED_FUND_PROFILE_CONTENTS) {
    if (existingKeys.has(profile.key)) continue;
    const imported = await importProfileConfig(profile.content);
    importedKeys.push(imported.key);
    existingKeys.add(imported.key);
  }

  return importedKeys;
}

function profileContent(profile: {
  key: string;
  name: string;
  market: string;
  benchmark: string;
  description: string;
  fund: Record<string, unknown>;
  mandate: Record<string, unknown>;
  symbols: Array<Record<string, unknown>>;
  dimensions: Array<Record<string, unknown>>;
}) {
  return {
    key: profile.key,
    content: JSON.stringify(
      {
        key: profile.key,
        name: profile.name,
        market: profile.market,
        benchmark: profile.benchmark,
        description: profile.description,
        fund: profile.fund,
        mandate: profile.mandate,
        symbols: profile.symbols,
        technicalColumns: TECHNICAL_COLUMNS,
        dimensions: profile.dimensions,
      },
      null,
      2,
    ),
  };
}
