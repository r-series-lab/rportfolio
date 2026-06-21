import { fetchProfileSummaries, importProfileConfig } from "./analysis";
import type { HoldingRecord } from "./holdings";

export const REQUESTED_FUND_SEED_STORAGE_KEY = "rportfolio.requestedFundSeeds.20260615.018147.017437.007950.019305.012349";

type MergeRequestedFundHoldingsResult = {
  holdings: HoldingRecord[];
  addedSymbols: string[];
};

const RESEARCH_TARGET_BANDS: Record<string, { min: number; target: number; max: number; note: string }> = {
  "CASH-CNY": { min: 15, target: 25, max: 35, note: "研究版现金缓冲：保留防守现金，但允许逐步部署超配现金。" },
  "016702": { min: 8, target: 12, max: 16, note: "研究版目标带：海外数字经济/AI 主题仓位。" },
  "018147": { min: 6, target: 10, max: 14, note: "研究版目标带：新兴市场 QDII 卫星仓位。" },
  "017437": { min: 9, target: 14, max: 18, note: "研究版目标带：纳斯达克主动权益仓位。" },
  "007950": { min: 7, target: 11, max: 15, note: "研究版目标带：A 股量化增强仓位。" },
  "019305": { min: 11, target: 16, max: 20, note: "研究版目标带：标普 500 海外核心仓位。" },
  "012349": { min: 7, target: 12, max: 16, note: "研究版目标带：恒生科技高波动主题仓位。" },
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
    targetMinWeight: 6,
    targetWeight: 10,
    targetMaxWeight: 14,
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
    targetMinWeight: 9,
    targetWeight: 14,
    targetMaxWeight: 18,
    notes: "按 2026-06-11 请求补充的纳斯达克主动基金持仓，仓位和价格用于整体效果预览，后续可手动调整。",
  },
  {
    id: "requested-007950-fund",
    symbol: "007950",
    name: "招商量化精选股票C",
    market: "CN",
    currency: "CNY",
    role: "real",
    assetType: "fund",
    quoteSource: "eastmoney_tiantian",
    profileKey: "cn-fund-007950",
    quantity: 1800,
    costPrice: 3.44,
    currentPrice: 3.5729,
    targetMinWeight: 7,
    targetWeight: 11,
    targetMaxWeight: 15,
    notes: "按 2026-06-15 请求补充的 A 股量化股票基金持仓，仓位和价格用于整体效果预览，后续可手动调整。",
  },
  {
    id: "requested-019305-fund",
    symbol: "019305",
    name: "摩根标普500指数(QDII)人民币C",
    market: "CN",
    currency: "CNY",
    role: "real",
    assetType: "fund",
    quoteSource: "eastmoney_tiantian",
    profileKey: "cn-fund-019305",
    quantity: 4500,
    costPrice: 1.56,
    currentPrice: 1.6375,
    targetMinWeight: 11,
    targetWeight: 16,
    targetMaxWeight: 20,
    notes: "按 2026-06-15 请求补充的标普 500 QDII 指数基金持仓，仓位和价格用于整体效果预览，后续可手动调整。",
  },
  {
    id: "requested-012349-fund",
    symbol: "012349",
    name: "天弘恒生科技ETF联接(QDII)C",
    market: "CN",
    currency: "CNY",
    role: "real",
    assetType: "fund",
    quoteSource: "eastmoney_tiantian",
    profileKey: "cn-fund-012349",
    quantity: 11000,
    costPrice: 0.71,
    currentPrice: 0.637,
    targetMinWeight: 7,
    targetWeight: 12,
    targetMaxWeight: 16,
    notes: "按 2026-06-15 请求补充的恒生科技 ETF 联接 QDII 持仓，仓位和价格用于整体效果预览，后续可手动调整。",
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
        "研究版目标权重 10%，先按 6%-14% 的新兴市场卫星仓位观察。",
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
      riskScoreLimit: 85,
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
        "研究版目标权重 14%，先按 9%-18% 的纳斯达克成长仓位观察。",
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
      riskScoreLimit: 85,
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
  profileContent({
    key: "cn-fund-007950",
    name: "招商量化精选股票C Profile",
    market: "cn",
    benchmark: "CSI500",
    description: "招商量化精选股票C（007950）· 股票型，由 2026-06-15 本地持仓补充生成的基金观察 Profile。",
    fund: {
      code: "007950",
      name: "招商量化精选股票C",
      fundType: "股票型",
      manager: "王平",
      issuer: "招商基金",
      navSymbol: "007950",
      holdingsAsOf: "2026-03-31",
      holdingsSource: "东方财富 / 天天基金公开资料 · 2026-06-15",
      notes: [
        "公开资料显示该基金为 A 股主动量化股票基金，实际持仓会随模型和调仓节奏变化。",
        "研究版目标权重 11%，先按 7%-15% 的 A 股量化增强仓位观察。",
        "Profile 的代理篮子用于风格和风险监控，不等同于基金真实持仓穿透。",
      ],
    },
    mandate: {
      mandateType: "基金持仓联动监控",
      baseCurrency: "CNY",
      benchmarkName: "中证500 / A股量化风格代理篮子",
      objective: "围绕 007950 的中盘量化、成长风格和 A 股系统风险做轻量监控；持仓页负责真实份额，Profile 负责分析视角。",
      timeHorizon: "短期 0-2 周看买点确认；中期 2-12 周看目标带；长期 3-12 个月看风格轮动和风险预算。",
      riskBudget: "量化股票基金受市场宽度和中小盘风格影响较大，新增申购需要同时满足中证500趋势修复、成长不过热和避险压力下降。",
      maxDrawdown: "12%-25%",
      targetGrossExposure: "A 股股票型基金，按 7%-15% 目标带控制新增节奏。",
      rebalanceCadence: "日度评分，触发式调整",
      liquidity: "以基金份额流动性、净值更新和代理资产状态共同确认",
      riskScoreLimit: 85,
      constraints: [
        { key: "midcap_trend", label: "中盘趋势", value: "中证500 跌破 MA20/MA50 时不提高仓位", tone: "caution" },
        { key: "style_confirmation", label: "风格确认", value: "中证1000、创业板相对沪深300 转弱时控制新增", tone: "caution" },
        { key: "risk_first", label: "风险优先", value: "沪深300 跌破长期均线或权益相对债券走弱时先控制新增申购", tone: "negative" },
      ],
      notes: [
        "持仓关联：007950 · 招商量化精选股票C",
        "公开资料会滞后，后续建议用官方季报或导入持仓修正代理篮子。",
      ],
    },
    symbols: [
      { symbol: "CSI500", yahooSymbol: "510500.SS", label: "中证500ETF", role: "benchmark", weight: 30, sector: "中盘", style: "量化增强", exposure: "A股" },
      { symbol: "CSI300", yahooSymbol: "510300.SS", label: "沪深300ETF", role: "large_cap", weight: 20, sector: "宽基", style: "核心", exposure: "A股" },
      { symbol: "CSI1000", yahooSymbol: "159845.SZ", label: "中证1000ETF", role: "breadth", weight: 16, sector: "小盘", style: "风险偏好", exposure: "A股" },
      { symbol: "CHINEXT", yahooSymbol: "159915.SZ", label: "创业板ETF", role: "growth", weight: 12, sector: "成长", style: "成长", exposure: "A股" },
      { symbol: "STAR50", yahooSymbol: "588000.SS", label: "科创50ETF", role: "growth", weight: 8, sector: "科技", style: "高弹性", exposure: "A股" },
      { symbol: "CNYBOND", yahooSymbol: "511010.SS", label: "国债ETF", role: "safe_haven", weight: 8, sector: "债券", style: "防守", exposure: "A股" },
      { symbol: "ASHR", yahooSymbol: "ASHR", label: "离岸A股ETF", role: "offshore", weight: 6, sector: "离岸A股", style: "外资风险偏好", exposure: "海外" },
    ],
    dimensions: [
      {
        key: "midcap_trend",
        label: "中盘趋势",
        factor: "trend",
        weight: 35,
        rules: [
          { type: "close_below_ma", symbol: "CSI500", period: 20, points: 7, reason: "中证500 跌破 MA20，007950 短线新增需要等待确认" },
          { type: "close_below_ma", symbol: "CSI500", period: 50, points: 12, reason: "中证500 跌破 MA50，量化中盘风格中期承压" },
          { type: "return_below_relative", symbol: "CSI500", other: "CSI300", days: 20, buffer: 3, points: 7, reason: "中证500 明显弱于沪深300，量化中盘风格确认不足" },
        ],
      },
      {
        key: "smallcap_heat",
        label: "小盘拥挤",
        factor: "heat",
        weight: 25,
        rules: [
          { type: "rsi_above", symbol: "CSI1000", period: 14, threshold: 75, points: 8, reason: "中证1000 RSI {rsi}，小盘风格短线过热" },
          { type: "return_above", symbol: "CSI1000", days: 20, threshold: 16, points: 8, reason: "中证1000 20 日涨幅过快，追高赔率下降" },
          { type: "return_above", symbol: "CHINEXT", days: 20, threshold: 18, points: 7, reason: "创业板 20 日涨幅过快，成长风格交易拥挤" },
        ],
      },
      {
        key: "breadth_confirmation",
        label: "宽度确认",
        factor: "structure",
        weight: 20,
        rules: [
          { type: "relative_strength_declined", symbol: "CSI1000", other: "CSI300", days: 5, points: 6, reason: "中证1000 相对沪深300 走弱，市场宽度不足" },
          { type: "relative_strength_declined", symbol: "CHINEXT", other: "CSI300", days: 5, points: 6, reason: "创业板相对沪深300 走弱，成长风格确认不足" },
          { type: "close_below_ma", symbol: "STAR50", period: 50, points: 6, reason: "科创50 跌破 MA50，科技成长扩散不足" },
        ],
      },
      {
        key: "defense_guard",
        label: "防守压力",
        factor: "systemic",
        weight: 20,
        rules: [
          { type: "close_below_ma", symbol: "CSI300", period: 200, points: 10, reason: "沪深300 跌破 MA200，A 股长期风险上升" },
          { type: "relative_strength_declined", symbol: "CSI500", other: "CNYBOND", days: 5, points: 7, reason: "中证500 相对国债 ETF 连续走弱，权益风险偏好下降" },
          { type: "relative_strength_declined", symbol: "ASHR", other: "CNYBOND", days: 5, points: 5, reason: "离岸 A 股相对防守资产走弱，外资风险偏好降温" },
        ],
      },
    ],
  }),
  profileContent({
    key: "cn-fund-019305",
    name: "摩根标普500指数(QDII)人民币C Profile",
    market: "global",
    benchmark: "SPY",
    description: "摩根标普500指数(QDII)人民币C（019305）· QDII-指数型，由 2026-06-15 本地持仓补充生成的基金观察 Profile。",
    fund: {
      code: "019305",
      name: "摩根标普500指数(QDII)人民币C",
      fundType: "QDII-指数型",
      manager: "张军",
      issuer: "摩根基金",
      navSymbol: "019305",
      holdingsAsOf: "2026-03-31",
      holdingsSource: "东方财富 / 天天基金公开资料 · 2026-06-15",
      notes: [
        "公开资料显示该基金跟踪标普 500 指数，主要暴露为美股大盘核心资产。",
        "研究版目标权重 16%，先按 11%-20% 的海外核心权益仓位观察。",
        "Profile 的代理篮子用于趋势和系统风险监控，不等同于基金真实持仓穿透。",
      ],
    },
    mandate: {
      mandateType: "基金持仓联动监控",
      baseCurrency: "CNY",
      benchmarkName: "S&P 500 / 美股核心权益代理篮子",
      objective: "围绕 019305 的标普 500 趋势、美股龙头确认和系统压力做轻量监控；持仓页负责真实份额，Profile 负责分析视角。",
      timeHorizon: "短期 0-2 周看买点确认；中期 2-12 周看目标带；长期 3-12 个月看海外核心权益配置。",
      riskBudget: "标普 500 属于海外核心权益，新增申购需要同时满足 SPY 趋势修复、龙头未显著转弱和 VIX 压力下降。",
      maxDrawdown: "12%-24%",
      targetGrossExposure: "海外核心权益 QDII，按 11%-20% 目标带控制新增节奏。",
      rebalanceCadence: "日度评分，触发式调整",
      liquidity: "以基金份额流动性、净值更新和代理资产状态共同确认",
      riskScoreLimit: 85,
      constraints: [
        { key: "sp500_trend", label: "标普趋势", value: "SPY 跌破 MA20/MA50 时不提高仓位", tone: "caution" },
        { key: "mega_cap_confirmation", label: "龙头确认", value: "NVDA、MSFT、AAPL 等龙头转弱时控制新增", tone: "caution" },
        { key: "risk_first", label: "风险优先", value: "VIX 高压或标普相对黄金走弱时先控制新增申购", tone: "negative" },
      ],
      notes: [
        "持仓关联：019305 · 摩根标普500指数(QDII)人民币C",
        "公开资料会滞后，后续建议用官方季报或导入持仓修正代理篮子。",
      ],
    },
    symbols: [
      { symbol: "SPY", yahooSymbol: "SPY", label: "标普500", role: "benchmark", weight: 35, sector: "美股核心", style: "宽基", exposure: "海外" },
      { symbol: "QQQ", yahooSymbol: "QQQ", label: "纳斯达克100", role: "growth", weight: 16, sector: "美股科技", style: "成长", exposure: "海外" },
      { symbol: "IWM", yahooSymbol: "IWM", label: "罗素2000", role: "breadth", weight: 10, sector: "小盘", style: "风险偏好", exposure: "海外" },
      { symbol: "NVDA", yahooSymbol: "NVDA", label: "英伟达", role: "leader", weight: 9, sector: "AI 硬件", style: "龙头", exposure: "个股" },
      { symbol: "MSFT", yahooSymbol: "MSFT", label: "微软", role: "leader", weight: 8, sector: "软件", style: "质量成长", exposure: "个股" },
      { symbol: "AAPL", yahooSymbol: "AAPL", label: "苹果", role: "leader", weight: 8, sector: "消费科技", style: "龙头", exposure: "个股" },
      { symbol: "TLT", yahooSymbol: "TLT", label: "美债", role: "rates", weight: 6, sector: "利率", style: "防守", exposure: "海外" },
      { symbol: "GLD", yahooSymbol: "GLD", label: "黄金", role: "safe_haven", weight: 8, sector: "黄金", style: "防守", exposure: "避险" },
      { symbol: "VIX", yahooSymbol: "^VIX", label: "恐慌", role: "volatility", weight: 0, sector: "波动率", style: "对冲", exposure: "观察" },
    ],
    dimensions: [
      {
        key: "sp500_trend",
        label: "标普趋势",
        factor: "trend",
        weight: 35,
        rules: [
          { type: "close_below_ma", symbol: "SPY", period: 20, points: 7, reason: "SPY 跌破 MA20，019305 短线新增需要等待确认" },
          { type: "close_below_ma", symbol: "SPY", period: 50, points: 12, reason: "SPY 跌破 MA50，标普 500 中期趋势承压" },
          { type: "return_below_relative", symbol: "SPY", other: "QQQ", days: 20, buffer: 4, points: 6, reason: "SPY 明显弱于 QQQ，美股核心宽基确认不足" },
        ],
      },
      {
        key: "market_breadth",
        label: "市场宽度",
        factor: "structure",
        weight: 25,
        rules: [
          { type: "relative_strength_declined", symbol: "IWM", other: "SPY", days: 5, points: 7, reason: "罗素2000 相对 SPY 走弱，美股宽度不足" },
          { type: "close_below_ma", symbol: "IWM", period: 50, points: 7, reason: "罗素2000 跌破 MA50，小盘风险偏好承压" },
          { type: "relative_strength_declined", symbol: "QQQ", other: "SPY", days: 5, points: 6, reason: "纳指相对 SPY 走弱，成长权重确认不足" },
        ],
      },
      {
        key: "mega_cap_confirmation",
        label: "龙头确认",
        factor: "momentum",
        weight: 20,
        rules: [
          { type: "close_below_ma", symbol: "NVDA", period: 50, points: 8, reason: "英伟达跌破 MA50，美股科技龙头确认不足" },
          { type: "close_below_ma", symbol: "MSFT", period: 50, points: 6, reason: "微软跌破 MA50，质量成长权重承压" },
          { type: "close_below_ma", symbol: "AAPL", period: 50, points: 6, reason: "苹果跌破 MA50，消费科技权重承压" },
        ],
      },
      {
        key: "systemic_guard",
        label: "系统压力",
        factor: "systemic",
        weight: 20,
        rules: [
          { type: "close_gte", symbol: "VIX", threshold: 20, maxThreshold: 25, points: 7, reason: "VIX {close}，海外风险偏好降温" },
          { type: "close_gte", symbol: "VIX", threshold: 25, points: 12, reason: "VIX {close}，高波动压制美股估值" },
          { type: "relative_strength_declined", symbol: "SPY", other: "GLD", days: 5, points: 6, reason: "SPY 相对黄金连续走弱，避险切换升温" },
        ],
      },
    ],
  }),
  profileContent({
    key: "cn-fund-012349",
    name: "天弘恒生科技ETF联接(QDII)C Profile",
    market: "hk",
    benchmark: "HSTECH",
    description: "天弘恒生科技ETF联接(QDII)C（012349）· QDII-联接基金，由 2026-06-15 本地持仓补充生成的基金观察 Profile。",
    fund: {
      code: "012349",
      name: "天弘恒生科技ETF联接(QDII)C",
      fundType: "QDII-联接基金",
      manager: "胡超",
      issuer: "天弘基金",
      navSymbol: "012349",
      holdingsAsOf: "2026-03-31",
      holdingsSource: "东方财富 / 天天基金公开资料 · 2026-06-15",
      notes: [
        "公开资料显示该基金为恒生科技 ETF 联接 QDII，主要暴露为港股科技与中概互联网。",
        "研究版目标权重 12%，先按 7%-16% 的高波动港股科技主题仓位观察。",
        "Profile 的代理篮子用于风险监控，不等同于基金真实持仓穿透。",
      ],
    },
    mandate: {
      mandateType: "基金持仓联动监控",
      baseCurrency: "CNY",
      benchmarkName: "恒生科技 / 港股科技代理篮子",
      objective: "围绕 012349 的恒生科技趋势、中概互联网确认和海外系统压力做轻量监控；持仓页负责真实份额，Profile 负责分析视角。",
      timeHorizon: "短期 0-2 周看买点确认；中期 2-12 周看目标带；长期 3-12 个月看主题风险预算。",
      riskBudget: "恒生科技波动高且受美元流动性、互联网龙头和港股风险偏好影响，新增申购需要先确认趋势修复。",
      maxDrawdown: "18%-35%",
      targetGrossExposure: "高波动港股科技 QDII，按 7%-16% 目标带控制新增节奏。",
      rebalanceCadence: "日度评分，触发式调整",
      liquidity: "以基金份额流动性、净值更新和代理资产状态共同确认",
      riskScoreLimit: 85,
      constraints: [
        { key: "hk_tech_trend", label: "恒科趋势", value: "恒生科技跌破 MA20/MA50 时不提高仓位", tone: "caution" },
        { key: "internet_confirmation", label: "互联网确认", value: "KWEB、腾讯、阿里转弱时控制新增", tone: "caution" },
        { key: "risk_first", label: "风险优先", value: "VIX 高压或恒科相对黄金走弱时先控制新增申购", tone: "negative" },
      ],
      notes: [
        "持仓关联：012349 · 天弘恒生科技ETF联接(QDII)C",
        "公开资料会滞后，后续建议用官方季报或导入持仓修正代理篮子。",
      ],
    },
    symbols: [
      { symbol: "HSTECH", yahooSymbol: "3033.HK", label: "恒生科技ETF", role: "benchmark", weight: 35, sector: "港股科技", style: "成长", exposure: "港股" },
      { symbol: "KWEB", yahooSymbol: "KWEB", label: "中概互联网", role: "theme", weight: 16, sector: "互联网", style: "主题", exposure: "海外中概" },
      { symbol: "BABA", yahooSymbol: "BABA", label: "阿里巴巴", role: "leader", weight: 10, sector: "电商云", style: "龙头", exposure: "个股" },
      { symbol: "TENCENT", yahooSymbol: "0700.HK", label: "腾讯控股", role: "leader", weight: 10, sector: "互联网平台", style: "龙头", exposure: "港股" },
      { symbol: "MEITUAN", yahooSymbol: "3690.HK", label: "美团", role: "leader", weight: 8, sector: "本地生活", style: "成长", exposure: "港股" },
      { symbol: "JD", yahooSymbol: "JD", label: "京东", role: "leader", weight: 7, sector: "电商", style: "周期成长", exposure: "个股" },
      { symbol: "ACWI", yahooSymbol: "ACWI", label: "全球股市", role: "global", weight: 6, sector: "全球宽基", style: "核心", exposure: "全球" },
      { symbol: "GLD", yahooSymbol: "GLD", label: "黄金", role: "safe_haven", weight: 8, sector: "黄金", style: "防守", exposure: "避险" },
      { symbol: "VIX", yahooSymbol: "^VIX", label: "恐慌", role: "volatility", weight: 0, sector: "波动率", style: "对冲", exposure: "观察" },
    ],
    dimensions: [
      {
        key: "hk_tech_trend",
        label: "恒科趋势",
        factor: "trend",
        weight: 35,
        rules: [
          { type: "close_below_ma", symbol: "HSTECH", period: 20, points: 8, reason: "恒生科技跌破 MA20，012349 短线新增需要等待确认" },
          { type: "close_below_ma", symbol: "HSTECH", period: 50, points: 13, reason: "恒生科技跌破 MA50，港股科技中期趋势承压" },
          { type: "return_below_relative", symbol: "HSTECH", other: "ACWI", days: 20, buffer: 4, points: 7, reason: "恒生科技明显弱于全球股市，主题确认不足" },
        ],
      },
      {
        key: "internet_confirmation",
        label: "互联网确认",
        factor: "momentum",
        weight: 25,
        rules: [
          { type: "close_below_ma", symbol: "KWEB", period: 50, points: 8, reason: "KWEB 跌破 MA50，中概互联网主线承压" },
          { type: "relative_strength_declined", symbol: "TENCENT", other: "HSTECH", days: 5, points: 6, reason: "腾讯相对恒生科技走弱，权重确认不足" },
          { type: "relative_strength_declined", symbol: "BABA", other: "HSTECH", days: 5, points: 6, reason: "阿里相对恒生科技走弱，平台龙头确认不足" },
        ],
      },
      {
        key: "rebound_heat",
        label: "反弹拥挤",
        factor: "heat",
        weight: 20,
        rules: [
          { type: "rsi_above", symbol: "HSTECH", period: 14, threshold: 74, points: 8, reason: "恒生科技 RSI {rsi}，短线反弹过热" },
          { type: "return_above", symbol: "KWEB", days: 20, threshold: 22, points: 8, reason: "中概互联网 20 日涨幅过快，主题追高赔率下降" },
          { type: "return_above", symbol: "MEITUAN", days: 20, threshold: 24, points: 6, reason: "美团 20 日涨幅过快，高弹性龙头交易拥挤" },
        ],
      },
      {
        key: "systemic_guard",
        label: "系统压力",
        factor: "systemic",
        weight: 20,
        rules: [
          { type: "close_gte", symbol: "VIX", threshold: 20, maxThreshold: 25, points: 7, reason: "VIX {close}，海外风险偏好降温" },
          { type: "close_gte", symbol: "VIX", threshold: 25, points: 12, reason: "VIX {close}，高波动压制港股科技估值" },
          { type: "relative_strength_declined", symbol: "HSTECH", other: "GLD", days: 5, points: 7, reason: "恒生科技相对黄金连续走弱，避险切换升温" },
        ],
      },
    ],
  }),
];

export function mergeRequestedFundHoldings(current: HoldingRecord[]): MergeRequestedFundHoldingsResult {
  const existingSymbols = new Set(current.map((holding) => holding.symbol));
  const missing = REQUESTED_FUND_HOLDINGS.filter((holding) => !existingSymbols.has(holding.symbol));
  return {
    holdings: applyResearchTargetBands(missing.length ? [...current, ...missing] : current),
    addedSymbols: missing.map((holding) => holding.symbol),
  };
}

export function applyResearchTargetBands(current: HoldingRecord[]) {
  return current.map((holding) => {
    const band = RESEARCH_TARGET_BANDS[holding.symbol];
    if (!band) return holding;
    const nextNotes = holding.notes?.includes("研究版目标带")
      ? holding.notes
      : [holding.notes, band.note].filter(Boolean).join(" ");
    return {
      ...holding,
      targetMinWeight: band.min,
      targetWeight: band.target,
      targetMaxWeight: band.max,
      notes: nextNotes,
    };
  });
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
