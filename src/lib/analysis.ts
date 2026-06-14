import { invoke } from "@tauri-apps/api/core";
import { enhanceMarketAnalysisReport } from "./decision-intelligence";
import type {
  AssetStatus,
  DataSourceSummary,
  DecisionFrame,
  DecisionMetricContext,
  FactorScore,
  FundProfileSeed,
  MarketInternals,
  MarketAnalysisReport,
  MarketState,
  OpportunityScore,
  PatternAnalysis,
  ProfileConfigBundle,
  ProfileMandate,
  PortfolioProfile,
  PositionAdvice,
  ProfileValidationReport,
  ProfileSummary,
  RiskLevel,
  ScoreMarketRequest,
  StructureAnalysis,
  TechnicalColumn,
  TechnicalRow,
} from "./types";

export async function fetchMarketAnalysisReport(
  request: ScoreMarketRequest,
): Promise<MarketAnalysisReport> {
  if ("__TAURI_INTERNALS__" in window) {
    const report = await invoke<MarketAnalysisReport>("score_market", { request });
    return enhanceMarketAnalysisReport(report);
  }

  await new Promise((resolve) => window.setTimeout(resolve, 280));
  return enhanceMarketAnalysisReport(sampleReport(request));
}

export async function fetchProfileSummaries(): Promise<ProfileSummary[]> {
  if ("__TAURI_INTERNALS__" in window) {
    return invoke<ProfileSummary[]>("list_profiles");
  }

  return allProfileSummaries();
}

export async function exportProfileConfig(profile: string): Promise<ProfileConfigBundle> {
  if ("__TAURI_INTERNALS__" in window) {
    return invoke<ProfileConfigBundle>("export_profile_config", { profile });
  }

  const summary = allProfileSummaries().find((item) => item.key === profile) ?? PROFILE_SUMMARIES[0];
  const json =
    window.localStorage.getItem(profileStorageKey(summary.key)) ??
    window.localStorage.getItem(legacyProfileStorageKey(summary.key)) ??
    JSON.stringify(sampleProfileConfig(summary), null, 2);
  return {
    key: summary.key,
    name: summary.name,
    market: summary.market,
    description: summary.description,
    builtin: summary.builtin,
    path: null,
    json,
  };
}

export async function importProfileConfig(content: string): Promise<ProfileSummary> {
  if ("__TAURI_INTERNALS__" in window) {
    return invoke<ProfileSummary>("import_profile_config", { content });
  }

  const parsed = JSON.parse(content) as Partial<ProfileSummary>;
  if (!parsed.key || !parsed.name || !parsed.market) {
    throw new Error("Profile JSON 必须包含 key、name、market。");
  }
  const summary: ProfileSummary = {
    key: parsed.key,
    name: parsed.name,
    market: parsed.market,
    description: typeof parsed.description === "string" ? parsed.description : "",
    builtin: false,
  };
  window.localStorage.setItem(profileStorageKey(summary.key), JSON.stringify(parsed, null, 2));
  const existing = window.localStorage.getItem(CUSTOM_PROFILE_STORAGE_KEY);
  const custom = existing ? (JSON.parse(existing) as ProfileSummary[]) : [];
  const next = [summary, ...custom.filter((item) => item.key !== summary.key)];
  window.localStorage.setItem(CUSTOM_PROFILE_STORAGE_KEY, JSON.stringify(next));
  return summary;
}

export async function lookupFundProfileSeed(code: string): Promise<FundProfileSeed> {
  const normalized = code.trim();
  if ("__TAURI_INTERNALS__" in window) {
    return invoke<FundProfileSeed>("lookup_fund_profile_seed", { code: normalized });
  }

  await new Promise((resolve) => window.setTimeout(resolve, 240));
  return previewFundProfileSeed(normalized);
}

export async function validateProfileConfig(content: string): Promise<ProfileValidationReport> {
  if ("__TAURI_INTERNALS__" in window) {
    return invoke<ProfileValidationReport>("validate_profile_config", { content });
  }

  return validateProfileConfigPreview(content);
}

export async function fetchDataSourceSummaries(): Promise<DataSourceSummary[]> {
  if ("__TAURI_INTERNALS__" in window) {
    return invoke<DataSourceSummary[]>("list_data_sources");
  }

  return DATA_SOURCE_SUMMARIES;
}

const DATA_SOURCE_SUMMARIES: DataSourceSummary[] = [
  { key: "auto", name: "自动", description: "优先 CSV，其次 Stooq，失败后 Yahoo/FRED 或示例。", requiresConfig: false },
  { key: "stooq", name: "Stooq 历史页", description: "抓取公开历史页表格并分页拼接。", requiresConfig: false },
  { key: "hybrid", name: "免费混合", description: "Yahoo + FRED 宏观覆盖。", requiresConfig: false },
  { key: "yahoo", name: "Yahoo", description: "Yahoo Finance 非官方 chart 接口。", requiresConfig: false },
  { key: "csv", name: "本地 CSV", description: "读取 profile dataDir/csvPath。", requiresConfig: true },
  { key: "sample", name: "示例", description: "离线演示数据。", requiresConfig: false },
];

const PROFILE_SUMMARIES: ProfileSummary[] = [
  { key: "us-core", name: "美股核心风险", market: "us", description: "SPY / QQQ / SMH / NVDA / IWM / VIX", builtin: true },
  { key: "global-risk", name: "全球风险", market: "global", description: "股债汇与避险资产", builtin: true },
  { key: "ai-semiconductor", name: "AI 半导体", market: "us", description: "AI 硬件链拥挤度", builtin: true },
  { key: "korea-ai-risk", name: "韩国 AI 风险", market: "kr", description: "韩国 AI 与全球半导体前置信号", builtin: true },
  { key: "a-share-risk", name: "A股风险模板", market: "cn", description: "A股指数和宽度模板", builtin: true },
  { key: "hk-tech", name: "港股科技", market: "hk", description: "恒生科技和港股龙头", builtin: true },
];

const CUSTOM_PROFILE_STORAGE_KEY = "rportfolio.customProfiles";
const LEGACY_CUSTOM_PROFILE_STORAGE_KEY = "rmarket.customProfiles";

function previewFundProfileSeed(code: string): FundProfileSeed {
  const normalized = /^\d{6}$/.test(code) ? code : code.trim().toUpperCase();
  return {
    code: normalized,
    name: `基金 ${normalized}`,
    fundType: "基金",
    manager: "",
    issuer: "",
    navSymbol: normalized,
    navDate: "",
    nav: null,
    estimateNav: null,
    estimateChange: null,
    estimateTime: null,
    return1m: null,
    return3m: null,
    return6m: null,
    return1y: null,
    latestStockPosition: null,
    assetAllocationAsOf: "",
    stockWeight: null,
    bondWeight: null,
    cashWeight: null,
    netAsset: null,
    topicLabels: [],
    sourceName: "Web 预览示例",
    sourceUrl: `https://fund.eastmoney.com/${normalized}.html`,
    fetchedAt: new Date().toISOString(),
    warnings: ["当前是 Web 预览模式；Tauri App 内会读取公开接口。"],
  };
}

function profileStorageKey(key: string) {
  return `rportfolio.profile.${key}`;
}

function legacyProfileStorageKey(key: string) {
  return `rmarket.profile.${key}`;
}

function allProfileSummaries() {
  let custom: ProfileSummary[] = [];
  try {
    const current = window.localStorage.getItem(CUSTOM_PROFILE_STORAGE_KEY);
    const legacy = window.localStorage.getItem(LEGACY_CUSTOM_PROFILE_STORAGE_KEY);
    const currentCustom = current ? (JSON.parse(current) as ProfileSummary[]) : [];
    const legacyCustom = legacy ? (JSON.parse(legacy) as ProfileSummary[]) : [];
    const seen = new Set<string>();
    custom = [...currentCustom, ...legacyCustom].filter((item) => {
      if (seen.has(item.key)) return false;
      seen.add(item.key);
      return true;
    });
  } catch {
    custom = [];
  }
  const builtInKeys = new Set(PROFILE_SUMMARIES.map((item) => item.key));
  return [...PROFILE_SUMMARIES, ...custom.filter((item) => !builtInKeys.has(item.key))];
}

function validateProfileConfigPreview(content: string): ProfileValidationReport {
  const errors: ProfileValidationReport["errors"] = [];
  const warnings: ProfileValidationReport["warnings"] = [];
  const stats: ProfileValidationReport["stats"] = {
    symbols: 0,
    weightedSymbols: 0,
    totalWeight: 0,
    dimensions: 0,
    dimensionWeight: 0,
    rules: 0,
  };

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(content) as Record<string, unknown>;
  } catch (error) {
    errors.push(issue("error", "json", "$", error instanceof Error ? error.message : "Profile JSON 解析失败。"));
    return finishValidation(errors, warnings, stats);
  }

  const symbols = Array.isArray(parsed.symbols) ? parsed.symbols.map(asRecord) : [];
  const dimensions = Array.isArray(parsed.dimensions) ? parsed.dimensions.map(asRecord) : [];
  const symbolSet = new Set<string>();
  stats.symbols = symbols.length;
  stats.dimensions = dimensions.length;

  if (!parsed.key) errors.push(issue("error", "profile", "key", "key 不能为空。"));
  if (!parsed.name) errors.push(issue("error", "profile", "name", "name 不能为空。"));
  if (!parsed.market) errors.push(issue("error", "profile", "market", "market 不能为空。"));
  if (!parsed.benchmark) errors.push(issue("error", "profile", "benchmark", "benchmark 不能为空。"));

  for (const [index, symbol] of symbols.entries()) {
    const value = String(symbol.symbol ?? "").trim().toUpperCase();
    const weight = Number(symbol.weight ?? 0);
    if (!value) errors.push(issue("error", "symbols", `symbols[${index}].symbol`, "symbol 不能为空。"));
    if (symbolSet.has(value)) errors.push(issue("error", "symbols", `symbols[${index}].symbol`, `${value} 重复出现。`));
    symbolSet.add(value);
    if (Number.isFinite(weight) && weight > 0) {
      stats.weightedSymbols += 1;
      stats.totalWeight += weight;
    }
    if (!Number.isFinite(weight) || weight < 0) {
      errors.push(issue("error", "symbols", `symbols[${index}].weight`, `${value} weight 需要是非负数字。`));
    }
  }

  const benchmark = String(parsed.benchmark ?? "").trim().toUpperCase();
  if (benchmark && !symbolSet.has(benchmark)) {
    errors.push(issue("error", "profile", "benchmark", `benchmark ${benchmark} 不在 symbols 中。`));
  }
  if (stats.totalWeight > 100) {
    warnings.push(issue("warning", "symbols", "symbols[].weight", `正权重合计 ${stats.totalWeight.toFixed(1)}%，请确认是否为杠杆或超配。`));
  }

  const fund = asRecord(parsed.fund);
  const fundConfigured = [
    fund.code,
    fund.name,
    fund.fundType,
    fund.manager,
    fund.issuer,
    fund.navSymbol,
    fund.holdingsAsOf,
    fund.holdingsSource,
  ].some((value) => String(value ?? "").trim());
  if (fundConfigured) {
    const holdingsAsOf = String(fund.holdingsAsOf ?? "").trim();
    if (!String(fund.code ?? "").trim()) {
      warnings.push(issue("warning", "fund", "fund.code", "基金代码为空，产品身份较弱。"));
    }
    if (!String(fund.name ?? "").trim()) {
      warnings.push(issue("warning", "fund", "fund.name", "基金名称为空，界面会回退到 Profile 名称。"));
    }
    if (!String(fund.navSymbol ?? "").trim()) {
      warnings.push(issue("warning", "fund", "fund.navSymbol", "未配置净值/交易 symbol，买点会主要由持仓穿透和基准推导。"));
    }
    if (!String(fund.holdingsSource ?? "").trim()) {
      warnings.push(issue("warning", "fund", "fund.holdingsSource", "持仓来源为空，数据可信度难以审计。"));
    }
    if (!holdingsAsOf) {
      warnings.push(issue("warning", "fund", "fund.holdingsAsOf", "持仓披露日为空，基金持仓可能滞后。"));
    } else if (!/^\d{4}-\d{2}-\d{2}$/.test(holdingsAsOf) || Number.isNaN(Date.parse(`${holdingsAsOf}T00:00:00Z`))) {
      errors.push(issue("error", "fund", "fund.holdingsAsOf", "持仓披露日需要使用 YYYY-MM-DD。"));
    }
  }

  for (const [dimensionIndex, dimension] of dimensions.entries()) {
    const weight = Number(dimension.weight ?? 0);
    stats.dimensionWeight += Number.isFinite(weight) ? weight : 0;
    const rules = Array.isArray(dimension.rules) ? dimension.rules.map(asRecord) : [];
    stats.rules += rules.length;
    if (!rules.length) {
      warnings.push(issue("warning", "dimensions", `dimensions[${dimensionIndex}].rules`, `${String(dimension.key ?? "")} 没有规则。`));
    }
    for (const [ruleIndex, rule] of rules.entries()) {
      const path = `dimensions[${dimensionIndex}].rules[${ruleIndex}]`;
      const type = String(rule.type ?? "");
      const points = Number(rule.points ?? 0);
      if (!type) errors.push(issue("error", "rules", `${path}.type`, "rule type 不能为空。"));
      if (!Number.isFinite(points) || points < 0 || points > 100) {
        errors.push(issue("error", "rules", `${path}.points`, "points 需要是 0-100。"));
      }
      for (const key of ["symbol", "other"] as const) {
        const value = String(rule[key] ?? "").trim().toUpperCase();
        if (value && !symbolSet.has(value)) {
          errors.push(issue("error", "rules", `${path}.${key}`, `规则引用了未知 symbol ${value}。`));
        }
      }
      const ruleSymbols = Array.isArray(rule.symbols) ? rule.symbols.map(String) : [];
      for (const [symbolIndex, symbol] of ruleSymbols.entries()) {
        const value = symbol.trim().toUpperCase();
        if (value && !symbolSet.has(value)) {
          errors.push(issue("error", "rules", `${path}.symbols[${symbolIndex}]`, `规则引用了未知 symbol ${value}。`));
        }
      }
    }
  }

  if (stats.dimensionWeight <= 0 || stats.dimensionWeight > 100) {
    errors.push(issue("error", "dimensions", "dimensions[].weight", "维度权重合计需要在 1-100。"));
  } else if (stats.dimensionWeight !== 100) {
    warnings.push(issue("warning", "dimensions", "dimensions[].weight", `维度权重合计 ${stats.dimensionWeight}，100 更容易解释。`));
  }

  stats.totalWeight = Math.round(stats.totalWeight * 100) / 100;
  return finishValidation(errors, warnings, stats);
}

function issue(severity: string, scope: string, path: string, message: string) {
  return { severity, scope, path, message };
}

function finishValidation(
  errors: ProfileValidationReport["errors"],
  warnings: ProfileValidationReport["warnings"],
  stats: ProfileValidationReport["stats"],
): ProfileValidationReport {
  const valid = errors.length === 0;
  return {
    valid,
    summary: valid
      ? warnings.length
        ? `校验通过但有 ${warnings.length} 个提醒：${stats.symbols} 个 symbols，${stats.rules} 条规则。`
        : `校验通过：${stats.symbols} 个 symbols，${stats.dimensions} 个维度，${stats.rules} 条规则。`
      : `校验失败：${errors.length} 个错误，${warnings.length} 个提醒。`,
    errors,
    warnings,
    stats,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function sampleProfileConfig(summary: ProfileSummary) {
  return {
    key: summary.key,
    name: summary.name,
    market: summary.market,
    benchmark: summary.market === "hk" ? "HSTECH" : "SPY",
    description: summary.description,
    mandate: {
      mandateType: "主动风险监控",
      baseCurrency: summary.market === "hk" ? "HKD" : summary.market === "cn" ? "CNY" : "USD",
      benchmarkName: summary.market === "hk" ? "HSTECH" : "SPY / QQQ Blend",
      objective: summary.description,
      timeHorizon: "3-12 个月状态跟踪",
      riskBudget: "中高波动，按 Trend / Risk / Edge 控制新增仓位。",
      maxDrawdown: "12%-18%",
      targetGrossExposure: "60%-85%",
      rebalanceCadence: "日度评分，触发式调整",
      liquidity: "ETF 与高流动性核心资产优先",
      riskScoreLimit: 65,
      constraints: [
        { key: "edge_gate", label: "赔率闸门", value: "Edge < 55 不扩仓", tone: "caution" },
      ],
      notes: ["Mandate 用于约束 Profile 语义，不替代人工投资适当性判断。"],
    },
    copy: {
      states: {
        risk_diffusion_watch: {
          badge: "等待内部修复",
          note: "这是 Profile 可覆盖文案示例；导入到桌面端后会写入自定义 Profile。",
          guidance: ["先看广度和高 beta 链条是否修复，再恢复短线进攻仓位。"],
          advice: [
            {
              horizonKey: "short",
              action: "停止追价，等内部修复",
              entryTrigger: "上涨家数回到 50% 以上，且高 beta 链条不再弱于基准。",
            },
          ],
        },
      },
    },
    symbols: [],
    technicalColumns: [],
    dimensions: [],
  };
}

const PREVIEW_COLUMNS: TechnicalColumn[] = [
  { key: "close", label: "收盘", align: "right" },
  { key: "change1d", label: "1D", align: "right" },
  { key: "return20d", label: "20D", align: "right" },
  { key: "rsi14", label: "RSI", align: "right" },
  { key: "ma20_50", label: "MA20/50", align: "right" },
  { key: "ma200", label: "MA200", align: "right" },
  { key: "macd", label: "MACD", align: "right" },
  { key: "volumeRatio", label: "量比", align: "right" },
];

const PROFILE_COLUMNS: Record<string, TechnicalColumn[]> = {
  "ai-semiconductor": [
    { key: "close", label: "收盘", align: "right" },
    { key: "change1d", label: "1D", align: "right" },
    { key: "return10d", label: "10D", align: "right" },
    { key: "return20d", label: "20D", align: "right" },
    { key: "rsi14", label: "RSI", align: "right" },
    { key: "ma20_50", label: "MA20/50", align: "right" },
    { key: "volumeRatio", label: "量比", align: "right" },
  ],
  "korea-ai-risk": [
    { key: "close", label: "收盘", align: "right" },
    { key: "change1d", label: "1D", align: "right" },
    { key: "return5d", label: "5D", align: "right" },
    { key: "return10d", label: "10D", align: "right" },
    { key: "return20d", label: "20D", align: "right" },
    { key: "rsi14", label: "RSI", align: "right" },
    { key: "ma20_50", label: "MA20/50", align: "right" },
    { key: "macd", label: "MACD", align: "right" },
    { key: "volumeRatio", label: "量比", align: "right" },
  ],
  "global-risk": [
    { key: "close", label: "收盘", align: "right" },
    { key: "change1d", label: "1D", align: "right" },
    { key: "return10d", label: "10D", align: "right" },
    { key: "return20d", label: "20D", align: "right" },
    { key: "rsi14", label: "RSI", align: "right" },
    { key: "ma50", label: "MA50", align: "right" },
    { key: "macd", label: "MACD", align: "right" },
  ],
  "a-share-risk": [
    { key: "close", label: "收盘", align: "right" },
    { key: "change1d", label: "1D", align: "right" },
    { key: "return10d", label: "5D", align: "right" },
    { key: "return20d", label: "20D", align: "right" },
    { key: "rsi14", label: "RSI", align: "right" },
    { key: "ma20_50", label: "MA20/50", align: "right" },
    { key: "volumeRatio", label: "量比", align: "right" },
  ],
  "hk-tech": [
    { key: "close", label: "收盘", align: "right" },
    { key: "change1d", label: "1D", align: "right" },
    { key: "return10d", label: "10D", align: "right" },
    { key: "return20d", label: "20D", align: "right" },
    { key: "rsi14", label: "RSI", align: "right" },
    { key: "ma20_50", label: "MA20/50", align: "right" },
    { key: "macd", label: "MACD", align: "right" },
  ],
};

function sampleReport(request: ScoreMarketRequest): MarketAnalysisReport {
  const asOf = request.asOf || new Date().toISOString().slice(0, 10);
  const preview = previewFromDate(asOf);
  const profile = allProfileSummaries().find((item) => item.key === request.profile) ?? PROFILE_SUMMARIES[0];
  const technicalColumns = PROFILE_COLUMNS[profile.key] ?? PREVIEW_COLUMNS;
  const technicalRows = sampleTechnicalRows(preview);
  const marketState = sampleMarketState(preview.score);
  const opportunityScores = sampleOpportunityScores(profile.key, preview.score, marketState.key);
  const factorScores = sampleFactorScores(preview.score, opportunityScores);
  const structure = sampleStructure();
  const positionAdvice = samplePositionAdvice(preview.score, opportunityScores, marketState);
  const decisionFrame = sampleDecisionFrame(marketState, factorScores, opportunityScores, positionAdvice, structure);
  const assetStatuses: AssetStatus[] = [
    { symbol: "SPY", label: "大盘", assetKind: "holding", status: "yellow", statusLabel: "黄灯", close: vary(522.18, preview.priceShift), change1d: vary(-0.42, preview.changeShift, 2), note: "回踩 MA20" },
    { symbol: "QQQ", label: "科技", assetKind: "holding", status: "yellow", statusLabel: "黄灯", close: vary(457.33, preview.priceShift), change1d: vary(0.18, preview.changeShift, 2), note: "短线过热" },
    { symbol: "SMH", label: "半导体", assetKind: "holding", status: "red", statusLabel: "红灯", close: vary(267.8, preview.priceShift), change1d: vary(-1.34, preview.changeShift, 2), note: "交易拥挤" },
    { symbol: "NVDA", label: "AI 龙头", assetKind: "holding", status: "red", statusLabel: "红灯", close: vary(928.44, preview.priceShift), change1d: vary(-0.76, preview.changeShift, 2), note: "高位滞涨" },
    { symbol: "IWM", label: "小盘", assetKind: "holding", status: "yellow", statusLabel: "黄灯", close: vary(204.72, preview.priceShift), change1d: vary(-1.08, preview.changeShift, 2), note: "相对走弱" },
    { symbol: "VIX", label: "恐慌", assetKind: "observer", status: "green", statusLabel: "绿灯", close: vary(17.9, -preview.priceShift, 1), change1d: vary(2.1, -preview.changeShift, 2), note: "正常区间" },
  ];
  const portfolioProfile = samplePortfolioProfile(assetStatuses, technicalRows, preview.score);

  return {
    generatedAt: new Date().toISOString(),
    source: request.source ?? "sample",
    sourceLabel: request.source === "csv" ? "本地 CSV 预览" : "示例数据",
    providerNote: request.source === "csv" ? "浏览器预览模式使用示例数据；桌面端会读取 profile 配置的 CSV。" : "",
    profileKey: profile.key,
    profileName: profile.name,
    profileMarket: profile.market,
    asOf,
    score: preview.score,
    level: preview.level,
    summary: preview.summary,
    marketState,
    decisionFrame,
    decisionMetricContexts: sampleDecisionMetricContexts(decisionFrame),
    statusMetrics: sampleStatusMetrics(marketState, opportunityScores),
    marketInternals: sampleMarketInternals(),
    factorScores,
    opportunityScores,
    structure,
    patternAnalysis: samplePatternAnalysis(),
    assetStatuses,
    technicalColumns,
    technicalRows,
    sectorStrength: [
      { symbol: "SPY", label: "大盘", return20d: 3.2, relativeToSpy: 0, status: "neutral" },
      { symbol: "QQQ", label: "科技", return20d: 8.6, relativeToSpy: 5.4, status: "strong" },
      { symbol: "SMH", label: "半导体", return20d: 24.6, relativeToSpy: 21.4, status: "strong" },
      { symbol: "NVDA", label: "AI 龙头", return20d: 19.1, relativeToSpy: 15.9, status: "strong" },
      { symbol: "IWM", label: "小盘", return20d: -2.1, relativeToSpy: -5.3, status: "weak" },
    ],
    dimensionScores: [
      { key: "spy", label: "SPY 大盘趋势", factor: "trend", weight: 25, score: 5, rawScore: 5, triggers: ["SPY MACD 处在空头区间"] },
      { key: "qqq", label: "QQQ 科技股", factor: "momentum", weight: 20, score: 8, rawScore: 8, triggers: ["QQQ RSI 78，科技股短线过热"] },
      { key: "smh", label: "SMH 半导体", factor: "heat", weight: 20, score: 20, rawScore: 30, triggers: ["SMH RSI 81，半导体极度过热", "SMH 20 日涨幅超过 25%"] },
      { key: "nvda", label: "NVDA AI 龙头", factor: "momentum", weight: 15, score: 15, rawScore: 25, triggers: ["NVDA 高位放量滞涨", "NVDA RSI 77"] },
      { key: "iwm", label: "IWM 市场广度", factor: "structure", weight: 10, score: 10, rawScore: 13, triggers: ["IWM/SPY 相对强度下降"] },
      { key: "vix", label: "VIX 恐慌", factor: "systemic", weight: 10, score: 0, rawScore: 0, triggers: [] },
    ],
    reasons: [
      { dimension: "SMH 半导体", text: "SMH RSI 81，半导体极度过热", points: 12 },
      { dimension: "NVDA AI 龙头", text: "NVDA 高位放量滞涨，AI 主线分歧上升", points: 12 },
      { dimension: "IWM 市场广度", text: "IWM/SPY 连续下降，市场广度走弱", points: 5 },
    ],
    supportEvidence: [
      { key: "trend", label: "趋势未破", tone: "positive", text: "SPY/QQQ 仍在 MA20/MA50 上方，不追高不等于看空。" },
      { key: "leader", label: "龙头仍强", tone: "positive", text: "NVDA 仍站上 MA20，AI 主线尚未明显破位。" },
      { key: "external", label: "外部确认", tone: "positive", text: "SMH 仍在短期趋势上方，外部确认尚未明显破位。" },
    ],
    guidance: [
      "主趋势仍在，但确认资产已经进入 MA20 回踩验证，当前重点是能否重新站稳。",
      "已有仓位可以观察，新增仓位等确认资产收复 MA20 或基准回踩不破。",
    ],
    positionAdvice,
    portfolioProfile,
    profileMandate: sampleProfileMandate(profile, portfolioProfile),
    profileFund: null,
    backtest: {
      date: asOf,
      score: preview.score,
      spyClose: vary(522.18, preview.priceShift),
      benchmarkSymbol: profile.key === "hk-tech" ? "HSTECH" : "SPY",
      benchmarkClose: vary(522.18, preview.priceShift),
      forwardReturns: [
        { days: 5, available: true, endDate: addDays(asOf, 5), returnPct: vary(-1.24, preview.returnShift, 2) },
        { days: 10, available: true, endDate: addDays(asOf, 10), returnPct: vary(0.62, preview.returnShift, 2) },
        { days: 20, available: true, endDate: addDays(asOf, 20), returnPct: vary(2.18, preview.returnShift, 2) },
      ],
      stateValidation: {
        stateKey: "strong_trend_pullback_watch",
        stateLabel: "强趋势回踩观察",
        sampleCount: 28,
        matchMode: "同状态",
        verdict: "历史样本更支持“持有等待回踩”：20D 中位收益 +2.6%，但中途回撤 -4.8%，追高性价比一般。",
        tone: "caution",
        confidence: "中",
        horizonStats: [
          { days: 5, sampleCount: 28, medianReturnPct: -0.6, averageReturnPct: -0.2, winRatePct: 46.4, medianMaxDrawdownPct: -3.1, ma20BreakRatePct: 42.9, ma50BreakRatePct: 7.1 },
          { days: 10, sampleCount: 28, medianReturnPct: 0.8, averageReturnPct: 1.1, winRatePct: 57.1, medianMaxDrawdownPct: -4.2, ma20BreakRatePct: 57.1, ma50BreakRatePct: 10.7 },
          { days: 20, sampleCount: 28, medianReturnPct: 2.6, averageReturnPct: 2.9, winRatePct: 64.3, medianMaxDrawdownPct: -4.8, ma20BreakRatePct: 71.4, ma50BreakRatePct: 17.9 },
          { days: 60, sampleCount: 28, medianReturnPct: 5.9, averageReturnPct: 6.4, winRatePct: 67.9, medianMaxDrawdownPct: -7.6, ma20BreakRatePct: 89.3, ma50BreakRatePct: 35.7 },
        ],
        eventStats: [
          { key: "ma20_pullback", label: "回踩 MA20", value: "71%", tone: "positive", detail: "未来 20 日内触及 MA20 附近的历史概率。" },
          { key: "early_drawdown", label: "追高回撤", value: "54%", tone: "caution", detail: "未来 10 日内先出现 3% 以上回撤的概率。" },
          { key: "ma50_break", label: "跌破 MA50", value: "18%", tone: "negative", detail: "未来 20 日内跌破 MA50 的概率。" },
        ],
      },
      protocolValidation: {
        currentProtocol: "observe",
        currentLabel: "观察",
        sampleCount: 116,
        verdict: "当前为观察协议；历史 20D 中位收益 1.4%，中位回撤 -4.7%，重点验证等待确认是否比追价更优。",
        tone: "caution",
        rows: [
          {
            protocolState: "healthy",
            label: "健康",
            permission: "允许分批",
            sampleCount: 24,
            medianReturn20Pct: 3.2,
            winRate20Pct: 66.7,
            medianMaxDrawdown20Pct: -3.6,
            ma50BreakRate20Pct: 8.3,
            tone: "positive",
            summary: "历史健康态 20D 中位收益 3.2%，胜率 67%，用于验证允许分批是否有赔率。",
          },
          {
            protocolState: "observe",
            label: "观察",
            permission: "等待确认",
            sampleCount: 52,
            medianReturn20Pct: 1.4,
            winRate20Pct: 55.8,
            medianMaxDrawdown20Pct: -4.7,
            ma50BreakRate20Pct: 17.3,
            tone: "caution",
            summary: "观察态 20D 中位收益 1.4%，中位回撤 -4.7%，用于验证等待确认是否必要。",
          },
          {
            protocolState: "broken",
            label: "破坏",
            permission: "停止加仓",
            sampleCount: 28,
            medianReturn20Pct: -2.1,
            winRate20Pct: 39.3,
            medianMaxDrawdown20Pct: -6.2,
            ma50BreakRate20Pct: 46.4,
            tone: "negative",
            summary: "破坏态 20D 中位收益 -2.1%，中位回撤 -6.2%，用于验证禁止扩仓纪律。",
          },
          {
            protocolState: "panic",
            label: "高风险",
            permission: "主动降风险",
            sampleCount: 12,
            medianReturn20Pct: -3.6,
            winRate20Pct: 33.3,
            medianMaxDrawdown20Pct: -8.8,
            ma50BreakRate20Pct: 58.3,
            tone: "negative",
            summary: "高风险态 20D 中位收益 -3.6%，中位回撤 -8.8%，用于验证主动降风险。",
          },
        ],
      },
      ruleSet: {
        stateRules: [
          { key: "state_identity", label: "强趋势回踩观察", condition: "trend >= 70 且确认资产跌破 MA20", action: "每日用当日及之前数据重新识别状态。", tone: "caution" },
          { key: "hot_state_threshold", label: "过热状态门槛", condition: "heat >= 90 进入极度过热", action: "限制短线追高仓位，等待 MA20/MA50 动作线。", tone: "caution" },
        ],
        actionRules: [
          { key: "entry_ma20", label: "观察加仓", condition: "low <= MA20 * 1.01", action: "进入回踩观察区。", tone: "positive" },
          { key: "reduce_ma20", label: "短线减仓", condition: "close < MA20 连续 2 日", action: "下调短线仓位。", tone: "caution" },
        ],
        profileRules: [
          { key: "confirmation_pullback", label: "确认资产回踩约束", condition: "growth/sector/breadth 跌破 MA20 但未跌破 MA50", action: "状态降为回踩观察；2 日无法收复再减仓。", tone: "caution" },
        ],
      },
    },
    policyNote: "风险评分用于监控和执行参考，不输出自动买卖点。",
  };
}

function sampleMarketState(score: number): MarketState {
  if (score >= 82) {
    return {
      key: "high_level_digest",
      label: "高位消化",
      tone: "caution",
      summary: "趋势仍强，但短线过热明显，优先等待回踩和动量降温。",
    };
  }
  return {
    key: "strong_trend_pullback_watch",
    label: "强趋势回踩观察",
    tone: "caution",
    summary: "主趋势未破、系统风险低，但确认资产已进入 MA20 回踩验证，先看能否快速收复。",
  };
}

function sampleStatusMetrics(marketState: MarketState, opportunities: OpportunityScore[]) {
  const shortScore = opportunities.find((item) => item.horizonKey === "short")?.score ?? 50;
  const [opportunityTone, opportunityStatus] = sampleOpportunityStatus(shortScore);
  const isPullback = marketState.key === "strong_trend_pullback_watch";
  const opportunityValue = isPullback && shortScore >= 62 ? "小仓试探" : opportunityStatus;

  return [
    { key: "chase_risk", label: "追高风险", value: "中高", tone: "caution", detail: "确认资产已回踩 MA20，新增追高需要等重新站稳。" },
    { key: "systemic_risk", label: "系统压力", value: "低", tone: "positive", detail: "系统压力 18/100，尚未进入崩盘压力区。" },
    { key: "volatility_risk", label: "波动恐慌", value: "低", tone: "positive", detail: "波动恐慌 22/100，没有进入恐慌环境。" },
    { key: "opportunity_quality", label: "短线买点", value: opportunityValue, tone: opportunityTone, detail: `交易分 ${shortScore}/100，状态为${marketState.label}。` },
  ];
}

function sampleMarketInternals(): MarketInternals {
  return {
    summary: "监控广度 / 高Beta弱势已触发，风险开始从单点向结构扩散。",
    tone: "negative",
    scopeLabel: "监控篮子 n=6，相对弱势 n=4",
    breadthSampleSize: 6,
    relativeWeaknessSampleSize: 4,
    breadthAdvancingRatio: 33,
    relativeWeaknessRatio: 50,
    highBetaOrder: "5D SMH < QQQ < SPY",
    signals: [
      {
        key: "breadth_collapse",
        label: "监控广度",
        value: "33% 上涨",
        tone: "negative",
        status: "Breadth Collapse",
        detail: "非波动率资产中 2 / 6 个单日上涨；低于 35% 时视为 Breadth Collapse。",
      },
      {
        key: "relative_weakness_expansion",
        label: "高Beta弱势",
        value: "5D SMH < QQQ < SPY",
        tone: "caution",
        status: "Relative Weakness",
        detail: "确认资产中 2 / 4 个弱于基准或跌破 MA20；高 beta 链：5D SMH < QQQ < SPY。",
      },
      {
        key: "gap_failure",
        label: "缺口失败",
        value: "未触发",
        tone: "positive",
        status: "无失败缺口",
        detail: "未发现核心龙头高开后收跌的失败缺口。",
      },
    ],
  };
}

function sampleFactorScores(score: number, opportunities: OpportunityScore[]): FactorScore[] {
  const heat = clamp(score + 8, 0, 100);
  const shortScore = opportunities.find((item) => item.horizonKey === "short")?.score ?? 50;
  const [opportunityTone, opportunityStatus] = sampleOpportunityStatus(shortScore);
  return [
    makeSampleFactor("trend", "趋势", 82, "positive", "强趋势", "价格站上中短期均线，主趋势仍在。"),
    makeSampleFactor("momentum", "动量", 78, "positive", "动量强", "RSI 与 20 日涨幅显示主线速度偏快。"),
    makeSampleFactor("heat", "过热", heat, "caution", "明显过热", "乖离和涨幅偏高，新增仓位需要等待回踩。"),
    makeSampleFactor("systemic", "系统风险", 18, "positive", "系统稳定", "宏观和趋势破位压力还没有进入高压区。"),
    makeSampleFactor("volatility", "波动恐慌", 22, "positive", "波动低", "波动没有进入恐慌环境，但低波动不等于买点好。"),
    makeSampleFactor("opportunity", "交易分", shortScore, opportunityTone, opportunityStatus, "趋势强会加分，但过热、分化和系统压力会压低交易分。"),
    makeSampleFactor("structure", "结构", 72, "positive", "结构强", "MA20/MA50 结构仍可用，等待回踩确认。"),
  ];
}

function sampleOpportunityScores(profileKey: string, score: number, marketStateKey: string): OpportunityScore[] {
  const heat = clamp(score + 8, 0, 100);
  const heatPenalty = Math.max(0, heat - 72) * 0.55;
  const profileBias = sampleProfileOpportunityBias(profileKey);
  const stateCap = marketStateKey === "high_level_digest" ? 52 : marketStateKey === "strong_trend_pullback_watch" ? 66 : 78;
  const short = Math.min(clamp(Math.round(68 + profileBias - heatPenalty), 28, 78), stateCap);
  const medium = clamp(Math.round(short * 0.34 + 72 * 0.46 + (100 - heat) * 0.2), 40, 78);
  const long = clamp(Math.round(72 + profileBias * 0.25 - Math.max(0, heat - 86) * 0.18), 50, 82);
  const [shortTone, shortStatus] = sampleOpportunityStatus(short);
  const [mediumTone, mediumStatus] = sampleOpportunityStatus(medium);
  const [longTone, longStatus] = sampleOpportunityStatus(long);

  return [
    { horizonKey: "short", horizonLabel: "短线机会", score: short, tone: shortTone, status: shortStatus, detail: "确认资产回踩 MA20 后，重点看能否快速收复。" },
    { horizonKey: "medium", horizonLabel: "中线机会", score: medium, tone: mediumTone, status: mediumStatus, detail: "更看重 MA20/MA50 结构和回踩后的趋势质量。" },
    { horizonKey: "long", horizonLabel: "长期配置", score: long, tone: longTone, status: longStatus, detail: "更看重系统风险和长期趋势，不把短线回踩等同于长期看空。" },
  ];
}

function sampleProfileOpportunityBias(profileKey: string) {
  if (profileKey === "us-core") return 4;
  if (profileKey === "global-risk") return -2;
  if (profileKey === "hk-tech") return -3;
  if (profileKey === "a-share-risk") return -4;
  if (profileKey === "ai-semiconductor" || profileKey === "korea-ai-risk") return -7;
  return 0;
}

function sampleOpportunityStatus(score: number): [OpportunityScore["tone"], string] {
  if (score >= 72) return ["positive", "允许分批"];
  if (score >= 62) return ["positive", "小仓试探"];
  if (score >= 55) return ["neutral", "持有观察"];
  if (score >= 40) return ["caution", "等待确认"];
  return ["negative", "禁止追高"];
}

function sampleDecisionFrame(
  marketState: MarketState,
  factors: FactorScore[],
  opportunities: OpportunityScore[],
  positionAdvice: PositionAdvice[],
  structure: StructureAnalysis,
): DecisionFrame {
  const trend = factorScore(factors, "trend", 50);
  const structureScore = factorScore(factors, "structure", 50);
  const systemic = factorScore(factors, "systemic", 50);
  const volatility = factorScore(factors, "volatility", 50);
  const isHot = marketState.key === "high_level_digest";
  const rawEdge = opportunities.find((item) => item.horizonKey === "short")?.score ?? 50;
  const edge = Math.min(rawEdge, isHot ? 52 : marketState.key === "strong_trend_pullback_watch" ? 66 : 78);
  const trendScore = Math.min(Math.round(trend * 0.62 + structureScore * 0.38), isHot ? 82 : 72);
  const riskScore = Math.max(systemic, volatility, isHot ? 58 : 52);
  const [permission, permissionTone] = sampleDecisionPermission(marketState, trendScore, riskScore, edge);
  const trendStatus = isHot ? "强趋势过热" : "回踩观察";
  const riskStatus = riskScore >= 55 ? "风险中高" : "风险中";
  const edgeStatus = edge >= 72 ? "好" : edge >= 55 ? "中" : "一般";
  const shortAction = positionAdvice.find((item) => item.horizonKey === "short")?.action ?? "等待确认";
  const protocolState =
    permission === "小仓试探" ? "probe" : isHot || edge < 55 || (marketState.key === "strong_trend_pullback_watch" && edge < 62) ? "observe" : "healthy";
  const needsEntryCondition = protocolState === "observe" || permission === "小仓试探";
  const conditionLabel = permission === "小仓试探" ? "试探条件" : protocolState === "observe" ? "确认条件" : "失效条件";
  const condition =
    needsEntryCondition
      ? positionAdvice.find((item) => item.horizonKey === "short")?.entryTrigger ?? "等待结构重新确认。"
      : structure.invalidation;

  return {
    protocolState,
    stateLabel: marketState.label,
    actionLabel: shortAction,
    permission,
    permissionTone,
    badgeLabel: null,
    conditionLabel,
    condition,
    summary: `${trendStatus}，${riskStatus}，赔率${edgeStatus}；${permission}。`,
    note: null,
    trend: {
      key: "trend",
      label: "Trend",
      score: trendScore,
      status: trendStatus,
      tone: isHot ? "positive" : "neutral",
      detail: marketState.summary,
    },
    risk: {
      key: "risk",
      label: "Risk",
      score: riskScore,
      status: riskStatus,
      tone: riskScore >= 55 ? "caution" : "neutral",
      detail: "系统压力低，但结构回踩抬高追高风险。",
    },
    edge: {
      key: "edge",
      label: "Edge",
      score: edge,
      status: edgeStatus,
      tone: "caution",
      detail: "趋势强会加分，但回踩确认前新增仓位赔率一般。",
    },
    invalidation: structure.invalidation,
  };
}

function sampleDecisionPermission(
  marketState: MarketState,
  trendScore: number,
  riskScore: number,
  edge: number,
): [DecisionFrame["permission"], DecisionFrame["permissionTone"]] {
  if (marketState.key === "risk_diffusion_breakdown") return ["停止加仓", "negative"];
  if (trendScore <= 40 && riskScore >= 70) return ["主动降风险", "negative"];
  if (riskScore >= 80 && edge <= 45) return ["主动降风险", "negative"];
  if (riskScore >= 72 && edge <= 45) return ["停止加仓", "negative"];
  if (riskScore >= 75) return ["主动降风险", "negative"];
  if (marketState.key === "high_level_digest" || marketState.key === "strong_trend_hot" || marketState.key === "strong_trend_extreme_hot") return ["禁止追高", "caution"];
  if (trendScore >= 70 && riskScore < 55 && edge >= 72) return ["允许分批", "positive"];
  if (trendScore >= 66 && riskScore < 58 && edge >= 62) return ["小仓试探", "positive"];
  if (edge >= 55) return ["持有观察", "neutral"];
  return ["等待确认", "caution"];
}

function factorScore(factors: FactorScore[], key: string, fallback: number) {
  return factors.find((item) => item.key === key)?.score ?? fallback;
}

function sampleDecisionMetricContexts(frame: DecisionFrame): DecisionMetricContext[] {
  return [
    {
      key: "trend",
      label: "Trend",
      value: frame.trend.score,
      percentile: 72,
      percentileLabel: "P72",
      sampleLabel: "近120日",
      scope: "MA20/MA50/MA200 + 结构",
      tone: frame.trend.tone,
      detail: "趋势用于判断持有基础；新增动作还要看风险和机会是否同步达标。",
    },
    {
      key: "risk",
      label: "Risk",
      value: frame.risk.score,
      percentile: 64,
      percentileLabel: "P64",
      sampleLabel: "近120日",
      scope: "规则压力 / 系统 / 波动 / 过热",
      tone: frame.risk.tone,
      detail: "风险用于裁剪动作强度；高风险优先降级为等待、停止加仓或主动降风险。",
    },
    {
      key: "edge",
      label: "Edge",
      value: frame.edge.score,
      percentile: 36,
      percentileLabel: "P36",
      sampleLabel: "近120日",
      scope: "趋势 / 结构 / 过热 / 风险裁剪",
      tone: frame.edge.tone,
      detail: "机会用于判断新增仓位赔率；试探区只小仓验证，高分区才允许分批。",
    },
  ];
}

function makeSampleFactor(
  key: string,
  label: string,
  score: number,
  tone: FactorScore["tone"],
  status: string,
  detail: string,
): FactorScore {
  return {
    key,
    label,
    score,
    pressure: ["heat", "systemic", "volatility"].includes(key) ? score : 100 - score,
    tone,
    status,
    detail,
  };
}

function sampleStructure(): StructureAnalysis {
  return {
    trend: "结构状态：突破加速，等待回踩确认。",
    support: "MA20 444.60 / MA50 429.20",
    resistance: "60日高点 472.80，当前回撤 3.2%",
    invalidation: "跌破 MA50 429.20 且无法快速收复",
    actionMap: [
      { key: "current", label: "当前", value: "457.33", tone: "caution", action: "远离 MA20，不追高", detail: "相对 MA20 +8.1%。" },
      { key: "wait_confirm_ma20", label: "加仓观察", value: "科技 / 半导体", tone: "caution", action: "重新站回 MA20", detail: "回踩已经发生，重点观察确认资产能否重新站回 MA20，或基准回踩 MA20 不破。" },
      { key: "reduce_ma20", label: "减仓观察", value: "444.60", tone: "caution", action: "跌破 MA20 后 2 日不收复", detail: "短线动量降温，等待无法收复确认后再降低仓位。" },
      { key: "defense_ma50", label: "防守", value: "429.20", tone: "negative", action: "跌破 MA50", detail: "中期结构转弱，转入防守管理。" },
    ],
    signals: [
      { key: "ma_stack", label: "均线结构", value: "MA20 > MA50", tone: "positive", detail: "短中期均线排列仍向上。" },
      { key: "extension", label: "乖离", value: "+8.1%", tone: "caution", detail: "远离 MA20，短线不适合追高。" },
      { key: "pullback", label: "回撤", value: "-3.2%", tone: "neutral", detail: "尚未进入充分回踩区。" },
      { key: "leader", label: "核心标的", value: "站上 MA20", tone: "positive", detail: "龙头仍确认主线。" },
    ],
  };
}

function samplePatternAnalysis(): PatternAnalysis {
  const dominant = {
    key: "qqq_head_shoulders_top",
    label: "头肩顶",
    symbol: "QQQ",
    symbolLabel: "科技",
    direction: "bearish",
    status: "forming",
    statusLabel: "形成中",
    phase: "distribution_watch",
    phaseLabel: "形成中，等待确认",
    tone: "caution",
    confidence: 68,
    neckline: "438.20",
    confirmation: "收盘跌破颈线 438.20，且最好伴随量能放大。",
    invalidation: "重新站上右肩 462.60 后，头肩顶形态失效。",
    action: "不新增追高，盯住颈线和右肩失效位。",
    implication: "右肩已形成，跌破颈线前先降低追高动作。",
    detail: "左肩 459.80，头部 472.80，右肩 462.60；颈线来自两个回撤低点。",
    points: [
      { label: "左肩", date: "2026-03-18", price: 459.8 },
      { label: "颈线1", date: "2026-03-27", price: 436.4 },
      { label: "头部", date: "2026-04-10", price: 472.8 },
      { label: "颈线2", date: "2026-04-23", price: 440.1 },
      { label: "右肩", date: "2026-05-06", price: 462.6 },
    ],
  };

  return {
    summary: `${dominant.symbolLabel}：${dominant.label}，置信度 ${dominant.confidence}%。${dominant.implication}`,
    dominant,
    patterns: [
      dominant,
      {
        key: "smh_double_top",
        label: "双顶",
        symbol: "SMH",
        symbolLabel: "半导体",
        direction: "bearish",
        status: "watch",
        statusLabel: "观察中",
        phase: "distribution_watch",
        phaseLabel: "形成中，等待确认",
        tone: "neutral",
        confidence: 54,
        neckline: "251.40",
        confirmation: "收盘跌破双顶颈线 251.40。",
        invalidation: "重新突破右顶 270.20 后，双顶形态失效。",
        action: "不新增追高，盯住颈线和右肩失效位。",
        implication: "上方抛压开始清晰，跌破颈线后短期仓位应更保守。",
        detail: "两个高点价差 1.4%，中间回撤 6.8%。",
        points: [
          { label: "高点1", date: "2026-04-14", price: 274.1 },
          { label: "颈线", date: "2026-04-25", price: 251.4 },
          { label: "高点2", date: "2026-05-07", price: 270.2 },
        ],
      },
    ],
  };
}

function samplePositionAdvice(_score: number, opportunities: OpportunityScore[], marketState: MarketState): PositionAdvice[] {
  const shortScore = opportunities.find((item) => item.horizonKey === "short")?.score ?? 50;
  const isProbe = marketState.key === "strong_trend_pullback_watch" && shortScore >= 62;
  const shortAdvice = isProbe
    ? makeSampleAdvice("short", "短期", "确认后小仓试探", "0%~+5%", "35%~50%", "increase", "主趋势仍在，回踩后赔率修复，可用小仓验证动作线。")
    : makeSampleAdvice("short", "短期", shortScore >= 55 ? "持有观察，等确认" : "等待确认", "0%~-5%", "30%~45%", "caution", "主趋势仍在，但确认资产已进入 MA20 回踩验证。");

  return [
    shortAdvice,
    makeSampleAdvice("medium", "中期", "核心持有，等站稳", "0%~+5%", "50%~65%", "hold", "中期趋势没有破坏，但科技/板块确认不足时不急于提高仓位上限。"),
    makeSampleAdvice("long", "长期", "核心持有", "0%", "60%~80%", "hold", "长期趋势未破时保留核心配置，短线验证期避免频繁加仓。"),
  ];
}

function samplePortfolioProfile(
  assets: AssetStatus[],
  rows: TechnicalRow[],
  riskScore: number,
): PortfolioProfile {
  const meta: Record<string, { weight: number; sector: string; style: string; exposure: string }> = {
    SPY: { weight: 35, sector: "宽基", style: "核心", exposure: "美股" },
    QQQ: { weight: 25, sector: "科技", style: "成长", exposure: "美股" },
    SMH: { weight: 15, sector: "半导体", style: "主题", exposure: "美股" },
    NVDA: { weight: 10, sector: "半导体", style: "龙头", exposure: "个股" },
    IWM: { weight: 10, sector: "小盘", style: "风险偏好", exposure: "美股" },
  };
  const statusHealth: Record<string, number> = { green: 88, yellow: 60, red: 32 };
  const holdings = assets
    .filter((asset) => (meta[asset.symbol]?.weight ?? 0) > 0)
    .map((asset) => {
      const row = rows.find((item) => item.symbol === asset.symbol);
      const weight = meta[asset.symbol].weight;
      const return20d = row?.return20d ?? null;
      const ma20Gap = row?.ma20 && row.ma20 > 0 ? (asset.close / row.ma20 - 1) * 100 : null;
      const healthScore = clamp(
        (statusHealth[asset.status] ?? 55)
          + Math.max(-8, Math.min(6, (return20d ?? 0) * 0.4))
          + Math.max(-6, Math.min(4, (ma20Gap ?? 0) * 0.3)),
        0,
        100,
      );

      return {
        symbol: asset.symbol,
        label: asset.label,
        assetKind: asset.assetKind ?? "holding",
        weight,
        sector: meta[asset.symbol].sector,
        style: meta[asset.symbol].style,
        exposure: meta[asset.symbol].exposure,
        status: asset.status,
        statusLabel: asset.statusLabel,
        healthScore: Math.round(healthScore),
        healthTone: healthTone(healthScore),
        contributionRisk: Math.round(((100 - healthScore) * weight) / 100),
        return20d,
        ma20Gap: ma20Gap === null ? null : Math.round(ma20Gap * 10) / 10,
        note: asset.note,
      };
    });

  const totalWeight = holdings.reduce((sum, item) => sum + item.weight, 0);
  const healthScore =
    totalWeight > 0
      ? Math.round(holdings.reduce((sum, item) => sum + item.healthScore * item.weight, 0) / totalWeight)
      : 0;
  const sectorExposure = sampleExposure("sector", holdings);
  const styleExposure = sampleExposure("style", holdings);
  const exposureBreakdown = sampleExposure("exposure", holdings);
  const topHolding = [...holdings].sort((left, right) => right.weight - left.weight)[0];
  const topSector = sectorExposure[0];
  const topStyle = styleExposure[0];
  const topExposure = exposureBreakdown[0];
  const concentrationScore = clamp(
    (topHolding?.weight ?? 0) * 1.3 + (topSector?.weight ?? 0) * 0.7 + Math.max(0, (topStyle?.weight ?? 0) - 45) * 0.8,
    0,
    100,
  );
  const concentrationTone = concentrationToneFor(concentrationScore);

  return {
    totalWeight,
    cashWeight: Math.max(0, 100 - totalWeight),
    healthScore,
    healthLabel: healthLabel(healthScore),
    healthTone: healthTone(healthScore),
    concentrationScore: Math.round(concentrationScore),
    concentrationLabel: concentrationLabel(concentrationScore),
    concentrationTone,
    topHoldingWeight: topHolding?.weight ?? 0,
    topHolding: topHolding?.label ?? "-",
    topSector: topSector ? `${topSector.label} ${topSector.weight}%` : "-",
    topStyle: topStyle ? `${topStyle.label} ${topStyle.weight}%` : "-",
    topExposure: topExposure ? `${topExposure.label} ${topExposure.weight}%` : "-",
    weightedRiskScore: Math.round((100 - healthScore) * 0.55 + riskScore * 0.45),
    summary: `持仓健康度 ${healthScore}/100，${topSector?.label ?? "主线"} 暴露最高；这是现有仓位状态，不代表新增买点。`,
    holdings,
    sectorExposure,
    styleExposure,
    exposureBreakdown,
    actions: [
      {
        key: "rebalance_hot_sector",
        label: "集中风险",
        tone: concentrationTone,
        detail: topSector ? `${topSector.label} 权重 ${topSector.weight}%，新增仓位优先等回踩确认。` : "暂未发现明显集中项。",
      },
      {
        key: "protect_weak_holding",
        label: "持仓健康度",
        tone: healthTone(healthScore),
        detail: "红灯持仓先看 MA20/MA50 收复，未修复前不提高持仓风险预算。",
      },
    ],
  };
}

function sampleProfileMandate(
  profile: ProfileSummary,
  portfolio: PortfolioProfile,
): ProfileMandate {
  const limit = 65;
  const riskAlignment =
    portfolio.weightedRiskScore > limit
      ? `超预算 ${portfolio.weightedRiskScore}>${limit}`
      : portfolio.weightedRiskScore >= limit - 8
        ? `接近预算 ${portfolio.weightedRiskScore}/${limit}`
        : `预算内 ${portfolio.weightedRiskScore}/${limit}`;
  const riskAlignmentTone =
    portfolio.weightedRiskScore > limit ? "negative" : portfolio.weightedRiskScore >= limit - 8 ? "caution" : "positive";

  return {
    objective: profile.description || "以 Profile 定义的市场、规则和持仓权重进行风险监控。",
    mandateType: "主动风险监控",
    baseCurrency: profile.market === "hk" ? "HKD" : profile.market === "cn" ? "CNY" : "USD",
    benchmarkName: profile.market === "hk" ? "HSTECH" : "SPY / QQQ Blend",
    timeHorizon: "3-12 个月状态跟踪",
    riskBudget: "中高波动，按 Trend / Risk / Edge 控制新增仓位。",
    maxDrawdown: "12%-18%",
    targetGrossExposure: "60%-85%",
    rebalanceCadence: "日度评分，触发式调整",
    liquidity: "ETF 与高流动性核心资产优先",
    riskScoreLimit: limit,
    riskAlignment,
    riskAlignmentTone,
    constraints: [
      {
        key: "edge_gate",
        label: "赔率闸门",
        value: "Edge < 55 不扩仓",
        tone: "caution",
      },
      {
        key: "drawdown_budget",
        label: "回撤预算",
        value: "破 MA50 后压低中期仓位",
        tone: "negative",
      },
      {
        key: "concentration",
        label: "集中度",
        value: portfolio.concentrationLabel,
        tone: portfolio.concentrationTone,
      },
    ],
    notes: ["Mandate 用于约束 Profile 语义，不替代人工投资适当性判断。"],
    summary: `${profile.description || profile.name}；基准 ${profile.market === "hk" ? "HSTECH" : "SPY / QQQ Blend"}，风险预算 ${riskAlignment}。`,
  };
}

function sampleExposure(
  kind: PortfolioProfile["sectorExposure"][number]["kind"],
  holdings: PortfolioProfile["holdings"],
) {
  const field = kind === "sector" ? "sector" : kind === "style" ? "style" : "exposure";
  const totals = holdings.reduce<Record<string, number>>((acc, holding) => {
    const key = holding[field];
    acc[key] = (acc[key] ?? 0) + holding.weight;
    return acc;
  }, {});

  return Object.entries(totals)
    .map(([label, weight]) => ({
      key: label.toLowerCase(),
      label,
      kind,
      weight,
      tone: exposureTone(weight),
      status: weight >= 45 ? "集中" : weight >= 30 ? "偏高" : "分散",
    }))
    .sort((left, right) => right.weight - left.weight);
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

function makeSampleAdvice(
  horizonKey: string,
  horizonLabel: string,
  action: string,
  adjustment: string,
  targetPosition: string,
  tone: PositionAdvice["tone"],
  rationale: string,
): PositionAdvice {
  const gates = sampleAdviceGates(horizonKey);
  const blocked = gates.filter((gate) => gate.status === "block").length;
  const watched = gates.filter((gate) => gate.status === "watch").length;
  const confidenceScore = Math.max(38, Math.min(86, 72 - blocked * 16 - watched * 5 + (horizonKey === "long" ? 6 : 0)));
  const currentRange = sampleRangeFromText(targetPosition);
  const addRange = sampleRangeFromText(adjustment);
  const gateReason = blocked
    ? `${blocked} 项风险门卡住`
    : watched
      ? `${watched} 项风险门观察`
      : "风险门通过";
  return {
    horizonKey,
    horizonLabel,
    action,
    adjustment,
    targetPosition,
    currentRange,
    addRange,
    maxCap: currentRange ? Math.max(0, Math.min(100, currentRange.max)) : null,
    rangeMeaning: "Profile 风险仓位上限，不是单只资产目标带",
    rangeNote: "这是组合/主题层风险预算上限；持仓页的目标带是单资产仓位约束，实际动作取两者更严格的一侧。",
    damageScore: 0,
    damageLabel: "结构可控",
    tone,
    confidenceScore,
    confidenceLabel: confidenceScore >= 75 ? "高置信" : confidenceScore >= 58 ? "中置信" : "低置信",
    confidenceTone: confidenceScore >= 75 ? "positive" : confidenceScore >= 58 ? "neutral" : "caution",
    confidenceReason: `动作置信来自规则门控通过度：${gateReason}。它不是胜率，提升它需要更多确认信号通过、样本质量提高或 Profile 数据更完整。`,
    gates,
    rationale,
    entryTrigger: "回踩 MA20/MA50 后企稳，且过热评分降至 65 以下。",
    riskTrigger: "跌破 MA50 且无法快速收复，或核心标的放量走弱。",
  };
}

function sampleAdviceGates(horizonKey: string): PositionAdvice["gates"] {
  const edgeStatus = horizonKey === "short" ? "watch" : "pass";
  return [
    {
      key: "edge",
      label: "赔率",
      status: edgeStatus,
      triggered: edgeStatus !== "pass",
      effect: edgeStatus === "pass" ? "allow" : "cap_add",
      tone: edgeStatus === "pass" ? "positive" : "caution",
      detail: `${horizonKey === "short" ? "短期" : horizonKey === "medium" ? "中期" : "长期"}赔率仍需确认，新增仓位不应脱离触发条件。`,
    },
    {
      key: "structure",
      label: "趋势结构",
      status: "watch",
      triggered: true,
      effect: "cap_add",
      tone: "caution",
      detail: "主趋势未破，但确认资产正在回踩验证。",
    },
    {
      key: "heat",
      label: "拥挤度",
      status: horizonKey === "long" ? "pass" : "watch",
      triggered: horizonKey !== "long",
      effect: horizonKey === "long" ? "allow" : "cooldown",
      tone: horizonKey === "long" ? "positive" : "caution",
      detail: "短中期需要等过热评分降温，长期配置不把短线拥挤等同于看空。",
    },
    {
      key: "budget",
      label: "风险预算",
      status: "pass",
      triggered: false,
      effect: "allow",
      tone: "positive",
      detail: "当前仍在 Profile 风险预算内。",
    },
  ];
}

function sampleRangeFromText(value: string) {
  const numbers = Array.from(value.matchAll(/[+-]?\d+/g)).map((match) => Number(match[0]));
  if (!numbers.length) return null;
  const [first, second = first] = numbers;
  const min = Math.min(first, second);
  const max = Math.max(first, second);
  const signed = value.includes("+") || value.includes("-");
  const display =
    min === max
      ? formatRangePercent(min, signed)
      : `${formatRangePercent(min, signed)}~${formatRangePercent(max, signed)}`;
  return { min, max, display };
}

function formatRangePercent(value: number, signed: boolean) {
  if (signed && value > 0) return `+${value}%`;
  return `${value}%`;
}

type PreviewTechnicalRow = Omit<TechnicalRow, "cells">;

function sampleTechnicalRows(preview: ReturnType<typeof previewFromDate>): TechnicalRow[] {
  const rows: PreviewTechnicalRow[] = [
    { symbol: "SPY", label: "大盘", close: vary(522.18, preview.priceShift), change1d: vary(-0.42, preview.changeShift, 2), return10d: vary(1.8, preview.returnShift, 2), return20d: vary(3.2, preview.returnShift, 2), rsi14: vary(63.2, preview.rsiShift, 1), ma20: vary(520.4, preview.priceShift * 0.8), ma50: vary(510.2, preview.priceShift * 0.5), ma200: 478.9, macd: vary(4.2, preview.changeShift, 1), macdSignal: 4.8, volumeRatio: 1.12, status: "yellow", note: "回踩 MA20" },
    { symbol: "QQQ", label: "科技", close: vary(457.33, preview.priceShift), change1d: vary(0.18, preview.changeShift, 2), return10d: vary(5.7, preview.returnShift, 2), return20d: vary(8.6, preview.returnShift, 2), rsi14: vary(78.1, preview.rsiShift, 1), ma20: vary(444.6, preview.priceShift * 0.8), ma50: vary(429.2, preview.priceShift * 0.5), ma200: 398.7, macd: vary(7.1, preview.changeShift, 1), macdSignal: 6.8, volumeRatio: 0.94, status: "yellow", note: "短线过热" },
    { symbol: "SMH", label: "半导体", close: vary(267.8, preview.priceShift), change1d: vary(-1.34, preview.changeShift, 2), return10d: vary(13.8, preview.returnShift, 2), return20d: vary(24.6, preview.returnShift, 2), rsi14: vary(81.4, preview.rsiShift, 1), ma20: vary(247.1, preview.priceShift * 0.8), ma50: vary(228.7, preview.priceShift * 0.5), ma200: 192.2, macd: vary(9.3, preview.changeShift, 1), macdSignal: 8.4, volumeRatio: 1.46, status: "red", note: "交易拥挤" },
    { symbol: "NVDA", label: "AI 龙头", close: vary(928.44, preview.priceShift), change1d: vary(-0.76, preview.changeShift, 2), return10d: vary(9.4, preview.returnShift, 2), return20d: vary(19.1, preview.returnShift, 2), rsi14: vary(76.8, preview.rsiShift, 1), ma20: vary(886.1, preview.priceShift * 0.8), ma50: vary(842.9, preview.priceShift * 0.5), ma200: 695.4, macd: vary(35.4, preview.changeShift, 1), macdSignal: 31.8, volumeRatio: 1.58, status: "red", note: "高位滞涨" },
    { symbol: "IWM", label: "小盘", close: vary(204.72, preview.priceShift), change1d: vary(-1.08, preview.changeShift, 2), return10d: vary(-1.6, preview.returnShift, 2), return20d: vary(-2.1, preview.returnShift, 2), rsi14: vary(42.2, preview.rsiShift, 1), ma20: vary(208.4, preview.priceShift * 0.8), ma50: vary(212.1, preview.priceShift * 0.5), ma200: 201.6, macd: vary(-1.3, preview.changeShift, 1), macdSignal: -0.8, volumeRatio: 1.22, status: "yellow", note: "相对走弱" },
    { symbol: "VIX", label: "恐慌", close: vary(17.9, -preview.priceShift, 1), change1d: vary(2.1, -preview.changeShift, 2), return10d: vary(-4.1, -preview.returnShift, 2), return20d: vary(-8.2, -preview.returnShift, 2), rsi14: vary(48.4, -preview.rsiShift, 1), ma20: 18.2, ma50: 17.4, ma200: 16.8, macd: vary(-0.2, -preview.changeShift, 1), macdSignal: -0.1, volumeRatio: null, status: "green", note: "正常区间" },
  ];

  return rows.map((row) => ({
    ...row,
    cells: [
      { key: "close", display: row.close.toFixed(2), value: row.close, tone: "neutral" },
      { key: "change1d", display: formatSigned(row.change1d), value: row.change1d, tone: tone(row.change1d) },
      { key: "return10d", display: formatSigned(row.return10d), value: row.return10d, tone: tone(row.return10d) },
      { key: "return20d", display: formatSigned(row.return20d), value: row.return20d, tone: tone(row.return20d) },
      { key: "rsi14", display: row.rsi14?.toFixed(1) ?? "-", value: row.rsi14, tone: "neutral" },
      { key: "ma20_50", display: `${row.ma20?.toFixed(0) ?? "-"} / ${row.ma50?.toFixed(0) ?? "-"}`, value: null, tone: "neutral" },
      { key: "ma50", display: row.ma50?.toFixed(0) ?? "-", value: row.ma50, tone: "neutral" },
      { key: "ma200", display: row.ma200?.toFixed(0) ?? "-", value: row.ma200, tone: "neutral" },
      { key: "macd", display: row.macd?.toFixed(1) ?? "-", value: row.macd, tone: "neutral" },
      { key: "volumeRatio", display: row.volumeRatio === null ? "-" : `${row.volumeRatio.toFixed(2)}x`, value: row.volumeRatio, tone: "neutral" },
    ],
  }));
}

function formatSigned(value: number | null) {
  if (value === null) {
    return "-";
  }
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function tone(value: number | null) {
  if (value === null || value === 0) {
    return "neutral";
  }
  return value > 0 ? "positive" : "negative";
}

function previewFromDate(asOf: string) {
  const seed = dateSeed(asOf);
  const score = clamp(60 + (seed % 25), 0, 100);
  const level = levelForScore(score);

  return {
    score,
    level,
    summary: `${level.label}`,
    priceShift: ((seed % 17) - 8) * 0.42,
    changeShift: ((seed % 9) - 4) * 0.16,
    returnShift: ((seed % 13) - 6) * 0.38,
    rsiShift: ((seed % 11) - 5) * 0.7,
  };
}

function dateSeed(value: string): number {
  return Array.from(value).reduce((sum, char) => sum + char.charCodeAt(0), 0);
}

function levelForScore(score: number): RiskLevel {
  if (score <= 25) {
    return { key: "green", label: "绿色，风险较低", color: "#8dbb9e" };
  }
  if (score <= 45) {
    return { key: "yellow", label: "无恐慌，但不宜追", color: "#d1be72" };
  }
  if (score <= 65) {
    return { key: "orange", label: "橙色，风险偏高", color: "#c89a6b" };
  }
  if (score <= 80) {
    return { key: "red", label: "红色，明显危险", color: "#cf8588" };
  }
  return { key: "crimson", label: "深红，高风险环境", color: "#b76876" };
}

function vary(value: number, delta: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round((value + delta) * factor) / factor;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function addDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}
