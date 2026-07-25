use chrono::{Datelike, Duration, NaiveDate, TimeZone, Utc, Weekday};
use csv::StringRecord;
use reqwest::header::{HeaderMap, HeaderValue, ACCEPT, ACCEPT_LANGUAGE, REFERER, USER_AGENT};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration as StdDuration;

const HISTORY_RANGE: &str = "2y";
const MIN_DAILY_BARS: usize = 220;
const PRICE_BAR_LOOKBACK: usize = 90;
const BACKTEST_SAMPLE_SPACING_DAYS: usize = 5;
const DEFAULT_PROFILE_KEY: &str = "us-core";
const QBOT_ADAPTER_SCRIPT: &str = include_str!("../adapters/qbot_adapter.py");
const VNPY_ADAPTER_SCRIPT: &str = include_str!("../adapters/vnpy_adapter.py");
const YAHOO_USER_AGENT: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36";
const YAHOO_CHART_HOSTS: [&str; 2] = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"];
const FRED_GRAPH_CSV_URL: &str = "https://fred.stlouisfed.org/graph/fredgraph.csv";
const EASTMONEY_KLINE_URL: &str = "https://push2his.eastmoney.com/api/qt/stock/kline/get";
const SINA_KLINE_URL: &str =
    "https://quotes.sina.cn/cn/api/openapi.php/CN_MarketDataService.getKLineData";
const STOOQ_HISTORY_URL: &str = "https://stooq.com/q/d/";
const STOOQ_ROWS_PER_PAGE: usize = 40;
const STOOQ_MAX_PAGES: usize = 8;
const AUTO_PROVIDER_TIMEOUT: StdDuration = StdDuration::from_secs(4);
const CHINA_PROVIDER_TIMEOUT: StdDuration = StdDuration::from_secs(20);
const HTTP_REQUEST_TIMEOUT: StdDuration = StdDuration::from_secs(4);
const HTTP_CONNECT_TIMEOUT: StdDuration = StdDuration::from_secs(2);
const SUPPORTED_RULE_TYPES: &[&str] = &[
    "close_below_ma",
    "volume_break_ma",
    "ma_below_ma",
    "macd_bullish",
    "macd_bearish",
    "macd_cross_up",
    "macd_cross_down",
    "kdj_bullish",
    "kdj_bearish",
    "kdj_cross_up",
    "kdj_cross_down",
    "kdj_above",
    "kdj_below",
    "rsi_above",
    "volume_ratio_above",
    "volume_ratio_below",
    "trend_continuation",
    "pullback_hold_ma",
    "volume_breakout",
    "support_lost",
    "range_compression",
    "risk_proxy_cooling",
    "risk_proxy_heating",
    "momentum_exhaustion",
    "distribution_volume",
    "macd_confirmation",
    "distance_above_ma",
    "return_above",
    "long_bearish_volume_candle",
    "high_volume_stalling",
    "pullback_from_period_high",
    "upper_shadow_reversal",
    "single_day_drop_volume",
    "flow_turn_negative",
    "underperformed_for",
    "relative_strength_declined",
    "below_ma_while_other_above_ma",
    "single_day_drop_vs",
    "return_below_relative",
    "breadth_below_ma_ratio",
    "close_lt",
    "close_gte",
];
const SUPPORTED_TECHNICAL_METRICS: &[&str] = &[
    "close",
    "change_1d",
    "return",
    "rsi",
    "ma_distance",
    "ma",
    "ma_pair",
    "macd",
    "macd_signal",
    "macd_histogram",
    "kdj",
    "kdj_k",
    "kdj_d",
    "kdj_j",
    "volume_ratio",
    "flow",
];
const SUPPORTED_ASSET_KINDS: &[&str] = &["holding", "observer", "proxy", "benchmark"];
const BUILTIN_PROFILES: [(&str, &str); 6] = [
    ("us-core", include_str!("../profiles/us-core.json")),
    ("global-risk", include_str!("../profiles/global-risk.json")),
    (
        "ai-semiconductor",
        include_str!("../profiles/ai-semiconductor.json"),
    ),
    (
        "korea-ai-risk",
        include_str!("../profiles/korea-ai-risk.json"),
    ),
    (
        "a-share-risk",
        include_str!("../profiles/a-share-risk.json"),
    ),
    ("hk-tech", include_str!("../profiles/hk-tech.json")),
];

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScoreMarketRequest {
    pub source: Option<String>,
    pub as_of: Option<String>,
    pub profile: Option<String>,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileSummary {
    pub key: String,
    pub name: String,
    pub market: String,
    pub description: String,
    pub builtin: bool,
    pub schema_version: u16,
    pub profile_version: String,
    pub parent_profile: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DataSourceSummary {
    pub key: String,
    pub name: String,
    pub description: String,
    pub requires_config: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileMandate {
    pub objective: String,
    pub mandate_type: String,
    pub base_currency: String,
    pub benchmark_name: String,
    pub time_horizon: String,
    pub risk_budget: String,
    pub max_drawdown: String,
    pub target_gross_exposure: String,
    pub rebalance_cadence: String,
    pub liquidity: String,
    pub risk_score_limit: Option<u8>,
    pub risk_alignment: String,
    pub risk_alignment_tone: String,
    pub constraints: Vec<MandateConstraint>,
    pub notes: Vec<String>,
    pub summary: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileFund {
    pub enabled: bool,
    pub code: String,
    pub name: String,
    pub fund_type: String,
    pub manager: String,
    pub issuer: String,
    pub nav_symbol: String,
    pub holdings_as_of: String,
    pub holdings_source: String,
    pub holdings_age_days: Option<i64>,
    pub freshness_label: String,
    pub freshness_tone: String,
    pub summary: String,
    pub notes: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MandateConstraint {
    pub key: String,
    pub label: String,
    pub value: String,
    pub tone: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileConfigBundle {
    pub key: String,
    pub name: String,
    pub market: String,
    pub description: String,
    pub builtin: bool,
    pub path: Option<String>,
    pub json: String,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FundHoldingSeed {
    pub symbol: String,
    pub name: String,
    pub weight: f64,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FundNavPoint {
    pub date: String,
    pub nav: f64,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FundRedemptionFeeTier {
    pub label: String,
    pub min_days: Option<u32>,
    pub max_days_exclusive: Option<u32>,
    pub rate: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FundProfileSeed {
    pub code: String,
    pub name: String,
    pub fund_type: String,
    pub manager: String,
    pub issuer: String,
    pub nav_symbol: String,
    pub nav_date: Option<String>,
    pub nav: Option<f64>,
    pub estimate_nav: Option<f64>,
    pub estimate_change: Option<f64>,
    pub estimate_time: Option<String>,
    pub return_1m: Option<f64>,
    pub return_3m: Option<f64>,
    pub return_6m: Option<f64>,
    pub return_1y: Option<f64>,
    pub latest_stock_position: Option<f64>,
    pub asset_allocation_as_of: Option<String>,
    pub stock_weight: Option<f64>,
    pub bond_weight: Option<f64>,
    pub cash_weight: Option<f64>,
    pub net_asset: Option<f64>,
    pub purchase_status: String,
    pub purchase_open: Option<bool>,
    pub purchase_limit: Option<f64>,
    pub redemption_open: Option<bool>,
    pub holdings_as_of: Option<String>,
    pub top_holdings: Vec<FundHoldingSeed>,
    pub nav_history: Vec<FundNavPoint>,
    pub redemption_fee_schedule: Vec<FundRedemptionFeeTier>,
    pub topic_labels: Vec<String>,
    pub source_name: String,
    pub source_url: String,
    pub fetched_at: String,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FundNavLookup {
    pub code: String,
    pub requested_date: String,
    pub nav_date: String,
    pub nav: f64,
    pub exact: bool,
    pub source_name: String,
    pub source_url: String,
    pub fetched_at: String,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HoldingRecord {
    pub id: String,
    #[serde(default)]
    pub account_id: Option<String>,
    pub symbol: String,
    pub name: String,
    pub market: String,
    pub currency: String,
    pub role: String,
    #[serde(default)]
    pub asset_type: Option<String>,
    #[serde(default)]
    pub quote_source: Option<String>,
    #[serde(default)]
    pub profile_key: Option<String>,
    pub quantity: f64,
    pub cost_price: f64,
    pub current_price: f64,
    #[serde(default)]
    pub quote_as_of: Option<String>,
    #[serde(default)]
    pub confirmed_nav: Option<f64>,
    #[serde(default)]
    pub confirmed_nav_as_of: Option<String>,
    #[serde(default)]
    pub fund_purchase_status: Option<String>,
    #[serde(default)]
    pub fund_purchase_open: Option<bool>,
    #[serde(default)]
    pub fund_purchase_limit: Option<f64>,
    #[serde(default)]
    pub fund_redemption_open: Option<bool>,
    #[serde(default)]
    pub fund_trade_status_as_of: Option<String>,
    #[serde(default)]
    pub fund_holdings_as_of: Option<String>,
    #[serde(default)]
    pub fund_top_holdings: Vec<FundHoldingSeed>,
    #[serde(default)]
    pub fund_nav_history: Vec<FundNavPoint>,
    #[serde(default)]
    pub fund_redemption_fee_schedule: Vec<FundRedemptionFeeTier>,
    #[serde(default)]
    pub target_min_weight: Option<f64>,
    pub target_weight: f64,
    #[serde(default)]
    pub target_max_weight: Option<f64>,
    pub notes: String,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TradeRecord {
    pub id: String,
    #[serde(default)]
    pub account_id: Option<String>,
    #[serde(default)]
    pub decision_id: Option<String>,
    #[serde(default)]
    pub order_id: Option<String>,
    pub symbol: String,
    pub name: String,
    pub side: String,
    pub trade_date: String,
    pub quantity: f64,
    pub price: f64,
    pub fee: f64,
    pub currency: String,
    pub notes: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrokerBridgeProbeRequest {
    pub bridge: Option<String>,
    pub qbot_path: Option<String>,
    pub vnpy_path: Option<String>,
    pub python: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrokerBridgeStatus {
    pub bridge: String,
    pub label: String,
    pub path: String,
    pub path_exists: bool,
    pub adapter_exists: bool,
    pub python_ok: bool,
    pub command_available: bool,
    pub route_label: String,
    pub summary: String,
    pub warnings: Vec<String>,
    pub capabilities: Vec<String>,
    pub command_preview: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuantOrderRouteRequest {
    pub bridge: String,
    pub broker_mode: String,
    pub symbol: String,
    pub name: String,
    pub side: String,
    pub quantity: String,
    pub limit: String,
    pub amount: String,
    pub weight: String,
    pub strategy: String,
    pub platform: String,
    pub trade_type: String,
    pub risk_override: bool,
    pub allow_live: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuantOrderRouteResult {
    pub accepted: bool,
    pub submitted: bool,
    pub bridge: String,
    pub route: String,
    pub status: String,
    pub order_ref: String,
    pub message: String,
    pub warnings: Vec<String>,
    pub command_preview: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrderCommandRequest {
    pub bridge: String,
    pub broker_mode: String,
    pub order_id: Option<String>,
    pub order_ref: Option<String>,
    pub current_status: Option<String>,
    pub symbol: String,
    pub name: String,
    pub side: String,
    pub quantity: String,
    pub limit: String,
    pub amount: String,
    pub weight: String,
    pub strategy: String,
    pub platform: String,
    pub trade_type: String,
    pub risk_override: bool,
    pub allow_live: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrderCommandResult {
    pub accepted: bool,
    pub submitted: bool,
    pub bridge: String,
    pub route: String,
    pub status: String,
    pub order_ref: String,
    pub message: String,
    pub warnings: Vec<String>,
    pub command_preview: Vec<String>,
    pub action: String,
    pub order_id: String,
    pub event_label: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrokerAccountSyncRequest {
    pub bridge: String,
    pub broker_mode: String,
    pub platform: String,
    pub trade_type: String,
    pub strategy: String,
    pub risk_override: bool,
    pub allow_live: Option<bool>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrokerAccountSnapshot {
    #[serde(default)]
    pub accepted: bool,
    #[serde(default)]
    pub bridge: String,
    #[serde(default)]
    pub route: String,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub account_id: String,
    #[serde(default)]
    pub account_name: String,
    #[serde(default)]
    pub currency: String,
    #[serde(default)]
    pub cash: f64,
    #[serde(default)]
    pub available_cash: Option<f64>,
    #[serde(default)]
    pub settled_cash: Option<f64>,
    #[serde(default)]
    pub pending_settlement: Option<f64>,
    #[serde(default)]
    pub market_value: f64,
    #[serde(default)]
    pub equity: f64,
    #[serde(default)]
    pub positions: Vec<Value>,
    #[serde(default)]
    pub orders: Vec<Value>,
    #[serde(default)]
    pub trades: Vec<Value>,
    #[serde(default)]
    pub warnings: Vec<String>,
    #[serde(default)]
    pub command_preview: Vec<String>,
    #[serde(default)]
    pub synced_at: String,
    #[serde(default)]
    pub message: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketQuoteRequest {
    pub bridge: String,
    pub broker_mode: String,
    pub symbol: String,
    pub name: String,
    pub market: String,
    pub asset_type: Option<String>,
    pub reference_price: Option<f64>,
    pub platform: String,
    pub trade_type: String,
    pub strategy: String,
    pub risk_override: bool,
    pub allow_live: Option<bool>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketQuoteSnapshot {
    #[serde(default)]
    pub accepted: bool,
    #[serde(default)]
    pub bridge: String,
    #[serde(default)]
    pub route: String,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub symbol: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub market: String,
    #[serde(default)]
    pub asset_type: String,
    #[serde(default)]
    pub bid: Option<f64>,
    #[serde(default)]
    pub ask: Option<f64>,
    #[serde(default)]
    pub last: Option<f64>,
    #[serde(default)]
    pub nav: Option<f64>,
    #[serde(default)]
    pub indicative_nav: Option<f64>,
    #[serde(default)]
    pub premium_discount_pct: Option<f64>,
    #[serde(default)]
    pub session: String,
    #[serde(default)]
    pub source: String,
    #[serde(default)]
    pub tradable_volume: Option<f64>,
    #[serde(default)]
    pub currency: String,
    #[serde(default)]
    pub warnings: Vec<String>,
    #[serde(default)]
    pub command_preview: Vec<String>,
    #[serde(default)]
    pub synced_at: String,
    #[serde(default)]
    pub message: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RealtimeAssetQuoteRequest {
    pub symbol: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub market: String,
    #[serde(default)]
    pub reference_price: Option<f64>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RealtimeAssetQuotePoint {
    pub time: String,
    pub price: f64,
    pub volume: f64,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RealtimeAssetQuoteSnapshot {
    pub accepted: bool,
    pub symbol: String,
    pub name: String,
    pub market: String,
    pub source: String,
    pub source_label: String,
    pub status: String,
    pub session: String,
    pub last: Option<f64>,
    pub previous_close: Option<f64>,
    pub open: Option<f64>,
    pub high: Option<f64>,
    pub low: Option<f64>,
    pub volume: Option<f64>,
    pub change: Option<f64>,
    pub change_pct: Option<f64>,
    pub bid: Option<f64>,
    pub ask: Option<f64>,
    pub spread_bps: Option<f64>,
    pub synced_at: String,
    pub message: String,
    pub warnings: Vec<String>,
    pub points: Vec<RealtimeAssetQuotePoint>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrderAuditExportRequest {
    pub format: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrderAuditExportResult {
    pub path: String,
    pub format: String,
    pub orders: usize,
    pub events: usize,
    pub exported_at: String,
    pub summary: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BrokerAdapterResponse {
    #[serde(default)]
    accepted: bool,
    #[serde(default)]
    submitted: bool,
    #[serde(default)]
    status: String,
    #[serde(default)]
    order_ref: String,
    #[serde(default)]
    message: String,
    #[serde(default)]
    event_label: String,
    #[serde(default)]
    warnings: Vec<String>,
    #[serde(default)]
    command_preview: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileValidationReport {
    pub valid: bool,
    pub summary: String,
    pub errors: Vec<ProfileValidationIssue>,
    pub warnings: Vec<ProfileValidationIssue>,
    pub stats: ProfileValidationStats,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileValidationIssue {
    pub severity: String,
    pub scope: String,
    pub path: String,
    pub message: String,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileValidationStats {
    pub symbols: usize,
    pub weighted_symbols: usize,
    pub total_weight: f64,
    pub dimensions: usize,
    pub dimension_weight: u16,
    pub rules: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketAnalysisReport {
    pub generated_at: String,
    pub source: String,
    pub source_label: String,
    pub provider_note: String,
    pub profile_schema_version: u16,
    pub profile_version: String,
    pub parent_profile: Option<String>,
    pub profile_key: String,
    pub profile_name: String,
    pub profile_market: String,
    pub as_of: String,
    pub score: u8,
    pub level: RiskLevel,
    pub summary: String,
    pub market_state: MarketState,
    pub decision_frame: DecisionFrame,
    pub decision_metric_contexts: Vec<DecisionMetricContext>,
    pub status_metrics: Vec<StatusMetric>,
    pub market_internals: MarketInternals,
    pub factor_scores: Vec<FactorScore>,
    pub opportunity_scores: Vec<OpportunityScore>,
    pub structure: StructureAnalysis,
    pub pattern_analysis: PatternAnalysis,
    pub price_bars_by_symbol: BTreeMap<String, Vec<PriceBar>>,
    pub asset_statuses: Vec<AssetStatus>,
    pub technical_columns: Vec<TechnicalColumn>,
    pub technical_rows: Vec<TechnicalRow>,
    pub sector_strength: Vec<SectorStrengthRow>,
    pub dimension_scores: Vec<DimensionScore>,
    pub reasons: Vec<RiskReason>,
    pub support_evidence: Vec<SupportEvidence>,
    pub guidance: Vec<String>,
    pub position_advice: Vec<PositionAdvice>,
    pub portfolio_profile: PortfolioProfile,
    pub profile_mandate: ProfileMandate,
    pub profile_fund: Option<ProfileFund>,
    pub profile_calibration_status: ProfileCalibrationStatus,
    pub recommendation_performance: RecommendationPerformanceSummary,
    pub calibration_action: ProfileCalibrationAction,
    pub execution_policy: ProfileExecutionPolicy,
    pub backtest: BacktestSummary,
    pub policy_note: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RiskLevel {
    pub key: String,
    pub label: String,
    pub color: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketState {
    pub key: String,
    pub label: String,
    pub tone: String,
    pub summary: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DecisionAxis {
    pub key: String,
    pub label: String,
    pub score: u8,
    pub status: String,
    pub tone: String,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DecisionFrame {
    pub protocol_state: String,
    pub state_label: String,
    pub action_label: String,
    pub permission: String,
    pub permission_tone: String,
    pub badge_label: Option<String>,
    pub condition_label: String,
    pub condition: String,
    pub summary: String,
    pub note: Option<String>,
    pub trend: DecisionAxis,
    pub risk: DecisionAxis,
    pub edge: DecisionAxis,
    pub invalidation: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DecisionMetricContext {
    pub key: String,
    pub label: String,
    pub value: u8,
    pub percentile: Option<u8>,
    pub percentile_label: String,
    pub sample_label: String,
    pub scope: String,
    pub tone: String,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FactorScore {
    pub key: String,
    pub label: String,
    pub score: u8,
    pub pressure: u8,
    pub tone: String,
    pub status: String,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusMetric {
    pub key: String,
    pub label: String,
    pub value: String,
    pub tone: String,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketInternals {
    pub summary: String,
    pub tone: String,
    pub scope_label: String,
    pub breadth_sample_size: usize,
    pub relative_weakness_sample_size: usize,
    pub breadth_advancing_ratio: Option<f64>,
    pub relative_weakness_ratio: Option<f64>,
    pub high_beta_order: String,
    pub signals: Vec<MarketInternalSignal>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketInternalSignal {
    pub key: String,
    pub label: String,
    pub value: String,
    pub tone: String,
    pub status: String,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpportunityScore {
    pub horizon_key: String,
    pub horizon_label: String,
    pub score: u8,
    pub tone: String,
    pub status: String,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StructureAnalysis {
    pub trend: String,
    pub support: String,
    pub resistance: String,
    pub invalidation: String,
    pub action_map: Vec<ActionLine>,
    pub signals: Vec<StructureSignal>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionLine {
    pub key: String,
    pub label: String,
    pub value: String,
    pub tone: String,
    pub action: String,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StructureSignal {
    pub key: String,
    pub label: String,
    pub value: String,
    pub tone: String,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PatternAnalysis {
    pub summary: String,
    pub dominant: Option<ChartPattern>,
    pub patterns: Vec<ChartPattern>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChartPattern {
    pub key: String,
    pub label: String,
    pub symbol: String,
    pub symbol_label: String,
    pub direction: String,
    pub status: String,
    pub status_label: String,
    pub phase: String,
    pub phase_label: String,
    pub tone: String,
    pub confidence: u8,
    pub neckline: Option<String>,
    pub confirmation: String,
    pub invalidation: String,
    pub action: String,
    pub implication: String,
    pub detail: String,
    pub points: Vec<PatternPoint>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PatternPoint {
    pub label: String,
    pub date: String,
    pub price: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PriceBar {
    pub date: String,
    pub open: f64,
    pub high: f64,
    pub low: f64,
    pub close: f64,
    pub volume: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetStatus {
    pub symbol: String,
    pub label: String,
    pub asset_kind: String,
    pub status: String,
    pub status_label: String,
    pub close: f64,
    pub change_1d: Option<f64>,
    pub note: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TechnicalRow {
    pub symbol: String,
    pub label: String,
    pub cells: Vec<TechnicalCell>,
    pub close: f64,
    pub change_1d: Option<f64>,
    pub return_10d: Option<f64>,
    pub return_20d: Option<f64>,
    pub rsi_14: Option<f64>,
    pub ma_20: Option<f64>,
    pub ma_50: Option<f64>,
    pub ma_200: Option<f64>,
    pub macd: Option<f64>,
    pub macd_signal: Option<f64>,
    pub macd_histogram: Option<f64>,
    pub kdj_k: Option<f64>,
    pub kdj_d: Option<f64>,
    pub kdj_j: Option<f64>,
    pub volume_ratio: Option<f64>,
    pub status: String,
    pub note: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TechnicalColumn {
    pub key: String,
    pub label: String,
    pub align: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TechnicalCell {
    pub key: String,
    pub display: String,
    pub value: Option<f64>,
    pub tone: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SectorStrengthRow {
    pub symbol: String,
    pub label: String,
    pub return_20d: Option<f64>,
    pub relative_to_spy: Option<f64>,
    pub status: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DimensionScore {
    pub key: String,
    pub label: String,
    pub factor: String,
    pub weight: u8,
    pub score: u8,
    pub raw_score: u8,
    pub triggers: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RiskReason {
    pub dimension: String,
    pub text: String,
    pub points: u8,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SupportEvidence {
    pub key: String,
    pub label: String,
    pub tone: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PositionAdvice {
    pub horizon_key: String,
    pub horizon_label: String,
    pub action: String,
    pub adjustment: String,
    pub target_position: String,
    pub current_range: Option<ExposureRange>,
    pub add_range: Option<ExposureRange>,
    pub max_cap: Option<u8>,
    pub range_meaning: String,
    pub range_note: String,
    pub damage_score: u8,
    pub damage_label: String,
    pub tone: String,
    pub confidence_score: u8,
    pub confidence_label: String,
    pub confidence_tone: String,
    pub gates: Vec<ActionGate>,
    pub rationale: String,
    pub entry_trigger: String,
    pub risk_trigger: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionGate {
    pub key: String,
    pub label: String,
    pub status: String,
    pub triggered: bool,
    pub effect: String,
    pub tone: String,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExposureRange {
    pub min: i16,
    pub max: i16,
    pub display: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PortfolioHolding {
    pub symbol: String,
    pub label: String,
    pub asset_kind: String,
    pub weight: f64,
    pub sector: String,
    pub style: String,
    pub exposure: String,
    pub status: String,
    pub status_label: String,
    pub health_score: u8,
    pub health_tone: String,
    pub contribution_risk: f64,
    pub return_20d: Option<f64>,
    pub ma20_gap: Option<f64>,
    pub note: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PortfolioExposure {
    pub key: String,
    pub label: String,
    pub kind: String,
    pub weight: f64,
    pub tone: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PortfolioAction {
    pub key: String,
    pub label: String,
    pub tone: String,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PortfolioProfile {
    pub total_weight: f64,
    pub cash_weight: f64,
    pub health_score: u8,
    pub health_label: String,
    pub health_tone: String,
    pub concentration_score: u8,
    pub concentration_label: String,
    pub concentration_tone: String,
    pub top_holding_weight: f64,
    pub top_holding: String,
    pub top_sector: String,
    pub top_style: String,
    pub top_exposure: String,
    pub weighted_risk_score: u8,
    pub summary: String,
    pub holdings: Vec<PortfolioHolding>,
    pub sector_exposure: Vec<PortfolioExposure>,
    pub style_exposure: Vec<PortfolioExposure>,
    pub exposure_breakdown: Vec<PortfolioExposure>,
    pub actions: Vec<PortfolioAction>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BacktestSummary {
    pub date: String,
    pub score: u8,
    pub spy_close: f64,
    pub benchmark_symbol: String,
    pub benchmark_close: f64,
    pub forward_returns: Vec<ForwardReturn>,
    pub state_validation: StateValidation,
    pub protocol_validation: ProtocolValidation,
    pub rule_set: BacktestRuleSet,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForwardReturn {
    pub days: u16,
    pub available: bool,
    pub end_date: Option<String>,
    pub return_pct: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StateValidation {
    pub state_key: String,
    pub state_label: String,
    pub sample_count: usize,
    pub raw_sample_count: usize,
    pub effective_sample_count: usize,
    pub sample_spacing_days: usize,
    pub exact_sample_count: usize,
    pub similar_sample_count: usize,
    pub match_mode: String,
    pub sample_quality_label: String,
    pub sample_quality_tone: String,
    pub sample_note: String,
    pub verdict: String,
    pub tone: String,
    pub confidence: String,
    pub horizon_stats: Vec<BacktestHorizonStat>,
    pub event_stats: Vec<BacktestEventStat>,
    pub replay_samples: Vec<StateReplaySample>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StateReplaySample {
    pub date: String,
    pub exact_state_match: bool,
    pub path_returns_pct: Vec<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtocolValidation {
    pub current_protocol: String,
    pub current_label: String,
    pub sample_count: usize,
    pub verdict: String,
    pub tone: String,
    pub rows: Vec<ProtocolValidationRow>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtocolValidationRow {
    pub protocol_state: String,
    pub label: String,
    pub permission: String,
    pub sample_count: usize,
    pub median_return_20_pct: Option<f64>,
    pub average_return_ci_low_20_pct: Option<f64>,
    pub average_return_ci_high_20_pct: Option<f64>,
    pub return_p25_20_pct: Option<f64>,
    pub return_p75_20_pct: Option<f64>,
    pub win_rate_20_pct: Option<f64>,
    pub median_max_drawdown_20_pct: Option<f64>,
    pub tail_loss_rate_20_pct: Option<f64>,
    pub severe_drawdown_rate_20_pct: Option<f64>,
    pub ma50_break_rate_20_pct: Option<f64>,
    pub tone: String,
    pub summary: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BacktestHorizonStat {
    pub days: u16,
    pub sample_count: usize,
    pub median_return_pct: Option<f64>,
    pub average_return_pct: Option<f64>,
    pub average_return_ci_low_pct: Option<f64>,
    pub average_return_ci_high_pct: Option<f64>,
    pub return_p25_pct: Option<f64>,
    pub return_p75_pct: Option<f64>,
    pub win_rate_pct: Option<f64>,
    pub median_max_drawdown_pct: Option<f64>,
    pub tail_loss_rate_pct: Option<f64>,
    pub severe_drawdown_rate_pct: Option<f64>,
    pub ma20_break_rate_pct: Option<f64>,
    pub ma50_break_rate_pct: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BacktestEventStat {
    pub key: String,
    pub label: String,
    pub value: String,
    pub tone: String,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BacktestRuleSet {
    pub state_rules: Vec<BacktestRule>,
    pub action_rules: Vec<BacktestRule>,
    pub profile_rules: Vec<BacktestRule>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BacktestRule {
    pub key: String,
    pub label: String,
    pub condition: String,
    pub action: String,
    pub tone: String,
}

#[derive(Debug, Clone)]
pub struct AppError {
    pub code: String,
    pub message: String,
    pub exit_code: i32,
}

impl AppError {
    pub fn invalid(message: impl Into<String>) -> Self {
        Self {
            code: "invalid_arguments".to_string(),
            message: message.into(),
            exit_code: 2,
        }
    }

    pub fn fetch(message: impl Into<String>) -> Self {
        Self {
            code: "data_fetch_failed".to_string(),
            message: message.into(),
            exit_code: 4,
        }
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self {
            code: "internal_error".to_string(),
            message: message.into(),
            exit_code: 1,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Candle {
    date: NaiveDate,
    open: f64,
    high: f64,
    low: f64,
    close: f64,
    volume: f64,
    flow: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct LoadedMarketData {
    source: String,
    source_label: String,
    provider_note: String,
    series: HashMap<String, Vec<Candle>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MarketDataCacheSnapshot {
    version: u8,
    saved_at: String,
    profile_key: String,
    data: LoadedMarketData,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AnalysisProfile {
    #[serde(default = "default_profile_schema_version")]
    schema_version: u16,
    #[serde(default = "default_profile_version")]
    profile_version: String,
    #[serde(default)]
    extends: Option<String>,
    key: String,
    name: String,
    market: String,
    benchmark: String,
    description: Option<String>,
    #[serde(default)]
    data_dir: Option<String>,
    #[serde(skip)]
    base_dir: Option<PathBuf>,
    symbols: Vec<ProfileSymbol>,
    technical_columns: Vec<TechnicalColumnConfig>,
    dimensions: Vec<DimensionConfig>,
    #[serde(default)]
    mandate: ProfileMandateConfig,
    #[serde(default)]
    fund: ProfileFundConfig,
    #[serde(default)]
    calibration: ProfileCalibration,
    #[serde(default)]
    calibration_meta: ProfileCalibrationMeta,
    #[serde(default)]
    execution_policy: ProfileExecutionPolicy,
    #[serde(default)]
    copy: ProfileCopyConfig,
}

fn default_profile_schema_version() -> u16 {
    1
}

fn default_profile_version() -> String {
    "1.0.0".to_string()
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct ProfileCalibrationMeta {
    method: Option<String>,
    calibrated_at: Option<String>,
    training_start: Option<String>,
    training_end: Option<String>,
    validation_start: Option<String>,
    validation_end: Option<String>,
    data_signature: Option<String>,
    objective: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ProfileExecutionPolicy {
    pub quote_warn_age_seconds: u64,
    pub quote_block_age_seconds: u64,
    pub etf_warn_spread_bps: f64,
    pub etf_block_spread_bps: f64,
    pub etf_warn_premium_discount_pct: f64,
    pub etf_block_premium_discount_pct: f64,
    pub fund_warn_holdings_age_days: i64,
    pub fund_block_holdings_age_days: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileCalibrationStatus {
    pub stage: String,
    pub label: String,
    pub tone: String,
    pub execution_grade: bool,
    pub method: String,
    pub training_window: String,
    pub validation_window: String,
    pub data_signature: String,
    pub objective: String,
    pub effective_sample_count: usize,
    pub summary: String,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecommendationPerformanceSummary {
    pub profile_key: String,
    pub label: String,
    pub tone: String,
    pub summary: String,
    pub evaluated_records: usize,
    pub raw_evaluated_outcomes: usize,
    pub effective_evaluated_outcomes: usize,
    pub pending_outcomes: usize,
    pub insufficient_outcomes: usize,
    pub horizons: Vec<RecommendationPerformanceSlice>,
    pub directions: Vec<RecommendationPerformanceSlice>,
    pub market_states: Vec<RecommendationPerformanceSlice>,
    pub priorities: Vec<RecommendationPerformanceSlice>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecommendationPerformanceSlice {
    pub key: String,
    pub label: String,
    pub sample_count: usize,
    pub correct_count: usize,
    pub hit_rate_pct: Option<f64>,
    pub average_signed_return_pct: Option<f64>,
    pub average_excess_return_pct: Option<f64>,
    pub average_max_adverse_pct: Option<f64>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileCalibrationAction {
    pub key: String,
    pub label: String,
    pub tone: String,
    pub action: String,
    pub rationale: String,
    pub next_review: String,
    pub minimum_sample_count: usize,
    pub current_sample_count: usize,
    pub proposals: Vec<ProfileParameterProposal>,
    pub evidence: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileParameterProposal {
    pub key: String,
    pub label: String,
    pub path: String,
    pub current_value: String,
    pub proposed_value: String,
    pub expected_effect: String,
    pub reason: String,
    pub sample_count: usize,
    pub confidence: String,
    pub directly_applicable: bool,
}

impl Default for ProfileExecutionPolicy {
    fn default() -> Self {
        Self {
            quote_warn_age_seconds: 30,
            quote_block_age_seconds: 120,
            etf_warn_spread_bps: 35.0,
            etf_block_spread_bps: 100.0,
            etf_warn_premium_discount_pct: 0.8,
            etf_block_premium_discount_pct: 2.0,
            fund_warn_holdings_age_days: 120,
            fund_block_holdings_age_days: 180,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct ProfileCalibration {
    leader_roles: Vec<String>,
    confirmation_roles: Vec<String>,
    expansion_structure_min: u8,
    divergence_min_confirmations: usize,
    divergence_weak_ratio: f64,
    divergence_max_systemic: u8,
    pullback_structure_min: u8,
    pullback_max_systemic: u8,
    hot_state_heat_min: u8,
    extreme_heat_min: u8,
    hot_trading_cap: u8,
    hot_medium_cap: u8,
    hot_long_cap: u8,
    hot_short_min: u8,
    hot_short_max: u8,
    hot_medium_min: u8,
    hot_medium_max: u8,
    hot_long_min: u8,
    hot_long_max: u8,
    trading_score_cap: u8,
    medium_score_cap: u8,
    long_score_cap: u8,
    divergence_trading_cap: u8,
    divergence_medium_cap: u8,
    divergence_long_cap: u8,
    pullback_trading_cap: u8,
    pullback_medium_cap: u8,
    severe_trading_cap: u8,
    severe_medium_cap: u8,
    severe_long_cap: u8,
}

impl Default for ProfileCalibration {
    fn default() -> Self {
        Self {
            leader_roles: vec!["leader".to_string()],
            confirmation_roles: vec![
                "leader".to_string(),
                "growth".to_string(),
                "sector".to_string(),
                "breadth".to_string(),
                "theme".to_string(),
                "core".to_string(),
                "confirmation".to_string(),
            ],
            expansion_structure_min: 65,
            divergence_min_confirmations: 3,
            divergence_weak_ratio: 0.5,
            divergence_max_systemic: 65,
            pullback_structure_min: 55,
            pullback_max_systemic: 55,
            hot_state_heat_min: 65,
            extreme_heat_min: 90,
            hot_trading_cap: 55,
            hot_medium_cap: 70,
            hot_long_cap: 75,
            hot_short_min: 20,
            hot_short_max: 35,
            hot_medium_min: 40,
            hot_medium_max: 55,
            hot_long_min: 45,
            hot_long_max: 65,
            trading_score_cap: 100,
            medium_score_cap: 100,
            long_score_cap: 100,
            divergence_trading_cap: 45,
            divergence_medium_cap: 65,
            divergence_long_cap: 75,
            pullback_trading_cap: 45,
            pullback_medium_cap: 65,
            severe_trading_cap: 30,
            severe_medium_cap: 45,
            severe_long_cap: 60,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProfileSymbol {
    symbol: String,
    yahoo_symbol: Option<String>,
    stooq_symbol: Option<String>,
    fred_symbol: Option<String>,
    csv_path: Option<String>,
    label: String,
    role: Option<String>,
    asset_kind: Option<String>,
    weight: Option<f64>,
    sector: Option<String>,
    style: Option<String>,
    exposure: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct ProfileMandateConfig {
    objective: Option<String>,
    mandate_type: Option<String>,
    base_currency: Option<String>,
    benchmark_name: Option<String>,
    time_horizon: Option<String>,
    risk_budget: Option<String>,
    max_drawdown: Option<String>,
    target_gross_exposure: Option<String>,
    rebalance_cadence: Option<String>,
    liquidity: Option<String>,
    risk_score_limit: Option<u8>,
    constraints: Vec<ProfileMandateConstraintConfig>,
    notes: Vec<String>,
}

impl Default for ProfileMandateConfig {
    fn default() -> Self {
        Self {
            objective: None,
            mandate_type: None,
            base_currency: None,
            benchmark_name: None,
            time_horizon: None,
            risk_budget: None,
            max_drawdown: None,
            target_gross_exposure: None,
            rebalance_cadence: None,
            liquidity: None,
            risk_score_limit: None,
            constraints: Vec::new(),
            notes: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct ProfileMandateConstraintConfig {
    key: Option<String>,
    label: String,
    value: String,
    tone: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct ProfileFundConfig {
    code: Option<String>,
    name: Option<String>,
    fund_type: Option<String>,
    manager: Option<String>,
    issuer: Option<String>,
    nav_symbol: Option<String>,
    holdings_as_of: Option<String>,
    holdings_source: Option<String>,
    notes: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct ProfileCopyConfig {
    states: HashMap<String, ProfileStateCopy>,
}

impl Default for ProfileCopyConfig {
    fn default() -> Self {
        Self {
            states: HashMap::new(),
        }
    }
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct ProfileStateCopy {
    summary: Option<String>,
    badge: Option<String>,
    note: Option<String>,
    guidance: Option<Vec<String>>,
    advice: Option<Vec<ProfileAdviceCopy>>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct ProfileAdviceCopy {
    horizon_key: String,
    horizon_label: Option<String>,
    action: Option<String>,
    adjustment: Option<String>,
    target_position: Option<String>,
    tone: Option<String>,
    rationale: Option<String>,
    entry_trigger: Option<String>,
    risk_trigger: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TechnicalColumnConfig {
    key: String,
    label: String,
    metric: String,
    format: Option<String>,
    tone: Option<String>,
    align: Option<String>,
    period: Option<u16>,
    left_period: Option<u16>,
    right_period: Option<u16>,
    line: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DimensionConfig {
    key: String,
    label: String,
    factor: Option<String>,
    weight: u8,
    rules: Vec<RuleConfig>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuleConfig {
    #[serde(rename = "type")]
    rule_type: String,
    symbol: Option<String>,
    symbols: Option<Vec<String>>,
    other: Option<String>,
    period: Option<u16>,
    left_period: Option<u16>,
    right_period: Option<u16>,
    days: Option<u16>,
    threshold: Option<f64>,
    max_threshold: Option<f64>,
    tolerance_pct: Option<f64>,
    return20d_abs_max: Option<f64>,
    volume_max: Option<f64>,
    volume_threshold: Option<f64>,
    buffer: Option<f64>,
    multiplier: Option<f64>,
    change_lte: Option<f64>,
    volume_ratio_gt: Option<f64>,
    line: Option<String>,
    points: u8,
    reason: String,
}

#[derive(Debug, Clone, Copy)]
struct KdjValue {
    k: f64,
    d: f64,
    j: f64,
}

#[derive(Debug, Clone)]
struct IndicatorSnapshot {
    candle: Candle,
    previous_close: Option<f64>,
    moving_averages: HashMap<u16, f64>,
    returns: HashMap<u16, f64>,
    rsi_values: HashMap<u16, f64>,
    rsi_14: Option<f64>,
    macd: Option<f64>,
    macd_signal: Option<f64>,
    previous_macd: Option<f64>,
    previous_macd_signal: Option<f64>,
    kdj_values: HashMap<u16, KdjValue>,
    previous_kdj_values: HashMap<u16, KdjValue>,
    volume_avg_20: Option<f64>,
    highs: HashMap<u16, f64>,
    high_60: Option<f64>,
}

impl IndicatorSnapshot {
    fn change_1d(&self) -> Option<f64> {
        self.previous_close
            .filter(|value| *value > 0.0)
            .map(|previous| percent(self.candle.close / previous - 1.0))
    }

    fn volume_ratio(&self) -> Option<f64> {
        self.volume_avg_20
            .filter(|average| *average > 0.0)
            .map(|average| self.candle.volume / average)
    }

    fn ma(&self, period: u16) -> Option<f64> {
        self.moving_averages.get(&period).copied()
    }

    fn return_for(&self, days: u16) -> Option<f64> {
        self.returns.get(&days).copied()
    }

    fn rsi(&self, period: u16) -> Option<f64> {
        self.rsi_values.get(&period).copied()
    }

    fn macd_histogram(&self) -> Option<f64> {
        self.macd
            .zip(self.macd_signal)
            .map(|(macd, signal)| macd - signal)
    }

    fn kdj(&self, period: u16) -> Option<KdjValue> {
        self.kdj_values.get(&period).copied()
    }

    fn previous_kdj(&self, period: u16) -> Option<KdjValue> {
        self.previous_kdj_values.get(&period).copied()
    }

    fn high(&self, period: u16) -> Option<f64> {
        self.highs.get(&period).copied()
    }
}

#[derive(Debug)]
struct DimensionDraft {
    key: String,
    label: String,
    factor: String,
    weight: u8,
    raw_score: u8,
    triggers: Vec<String>,
    reasons: Vec<RiskReason>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SwingKind {
    High,
    Low,
}

#[derive(Debug, Clone)]
struct SwingPoint {
    index: usize,
    date: NaiveDate,
    price: f64,
    kind: SwingKind,
}

#[derive(Debug, Clone)]
struct LeaderConfirmation {
    leader_count: usize,
    weak_count: usize,
    below_ma20_count: usize,
    below_ma50_count: usize,
    weak_labels: Vec<String>,
    confirmation_count: usize,
    confirmation_weak_count: usize,
    confirmation_below_ma20_count: usize,
    confirmation_below_ma50_count: usize,
    confirmation_weak_labels: Vec<String>,
    divergent: bool,
    severe: bool,
}

#[derive(Debug, Clone)]
struct HistoricalStateSample {
    index: usize,
    exact_state_match: bool,
}

impl DimensionDraft {
    fn new(
        key: impl Into<String>,
        label: impl Into<String>,
        factor: impl Into<String>,
        weight: u8,
    ) -> Self {
        Self {
            key: key.into(),
            label: label.into(),
            factor: factor.into(),
            weight,
            raw_score: 0,
            triggers: Vec::new(),
            reasons: Vec::new(),
        }
    }

    fn add(&mut self, points: u8, text: impl Into<String>) {
        let text = text.into();
        self.raw_score = self.raw_score.saturating_add(points);
        self.triggers.push(text.clone());
        self.reasons.push(RiskReason {
            dimension: self.label.clone(),
            text,
            points,
        });
    }

    fn finish(self) -> (DimensionScore, Vec<RiskReason>) {
        (
            DimensionScore {
                key: self.key,
                label: self.label,
                factor: self.factor,
                weight: self.weight,
                score: self.raw_score.min(self.weight),
                raw_score: self.raw_score,
                triggers: self.triggers,
            },
            self.reasons,
        )
    }
}

pub fn list_profiles() -> Result<Vec<ProfileSummary>, AppError> {
    let mut profiles: Vec<ProfileSummary> = BUILTIN_PROFILES
        .iter()
        .map(|(_, content)| {
            let profile = parse_profile(content, None)?;
            Ok(profile_summary(profile, true))
        })
        .collect::<Result<_, AppError>>()?;
    let mut known_keys = profiles
        .iter()
        .map(|profile| profile.key.clone())
        .collect::<Vec<_>>();

    for path in custom_profile_paths() {
        let Ok(profile) = load_profile_file(&path) else {
            continue;
        };
        if known_keys.iter().any(|key| key == &profile.key) {
            continue;
        }
        known_keys.push(profile.key.clone());
        profiles.push(profile_summary(profile, false));
    }

    Ok(profiles)
}

pub fn list_data_sources() -> Vec<DataSourceSummary> {
    vec![
        DataSourceSummary {
            key: "auto".to_string(),
            name: "自动".to_string(),
            description: "优先使用 profile 配置的 CSV；A 股随后使用东方财富并校验核心基准，其他情况按 Stooq、免费混合源、示例数据降级。".to_string(),
            requires_config: false,
        },
        DataSourceSummary {
            key: "china".to_string(),
            name: "A股免费多源".to_string(),
            description: "境内标的优先东方财富前复权日线，异常时降级新浪；离岸标的使用 Yahoo，核心基准执行第二来源交叉校验。".to_string(),
            requires_config: false,
        },
        DataSourceSummary {
            key: "stooq".to_string(),
            name: "Stooq 历史页".to_string(),
            description: "抓取 Stooq 公开历史页表格并按分页拼接；不需要 CSV apikey，但受页面访问限制影响。".to_string(),
            requires_config: false,
        },
        DataSourceSummary {
            key: "hybrid".to_string(),
            name: "免费混合".to_string(),
            description: "股票/ETF 使用 Yahoo，VIX 和利率等宏观序列优先用 FRED 免费 CSV 覆盖。".to_string(),
            requires_config: false,
        },
        DataSourceSummary {
            key: "yahoo".to_string(),
            name: "Yahoo".to_string(),
            description: "Yahoo Finance 非官方 chart 接口，适合本地低频监控。".to_string(),
            requires_config: false,
        },
        DataSourceSummary {
            key: "csv".to_string(),
            name: "本地 CSV".to_string(),
            description: "读取 profile 中的 dataDir 或 symbol.csvPath，适合 AkShare/TuShare/供应商导出的日线。".to_string(),
            requires_config: true,
        },
        DataSourceSummary {
            key: "sample".to_string(),
            name: "示例".to_string(),
            description: "离线确定性样例，用于演示和无网络兜底。".to_string(),
            requires_config: false,
        },
    ]
}

pub async fn lookup_fund_profile_seed(code: String) -> Result<FundProfileSeed, AppError> {
    let code = code.trim();
    if !code.chars().all(|char| char.is_ascii_digit()) || code.len() != 6 {
        return Err(AppError::invalid("基金代码需要是 6 位数字"));
    }

    let client = market_client_builder()
        .default_headers(eastmoney_headers())
        .build()
        .map_err(|error| AppError::internal(format!("fund lookup client build failed: {error}")))?;
    let search_url = format!(
        "https://fundsuggest.eastmoney.com/FundSearch/api/FundSearchAPI.ashx?m=1&key={code}"
    );
    let search_text = fetch_text(&client, &search_url).await?;
    let search_value: Value = serde_json::from_str(&search_text)
        .map_err(|error| AppError::fetch(format!("基金搜索结果解析失败：{error}")))?;
    let item = search_value
        .get("Datas")
        .and_then(Value::as_array)
        .and_then(|items| {
            items
                .iter()
                .find(|item| {
                    value_text(item.get("CODE")).as_deref() == Some(code)
                        || value_text(item.get("_id")).as_deref() == Some(code)
                })
                .or_else(|| items.first())
        })
        .ok_or_else(|| AppError::fetch(format!("未找到基金代码 {code} 的公开资料")))?;
    let base = item.get("FundBaseInfo").unwrap_or(item);
    let mut warnings = Vec::new();
    let name = value_text(base.get("SHORTNAME"))
        .or_else(|| value_text(base.get("NAME")))
        .or_else(|| value_text(item.get("NAME")))
        .unwrap_or_else(|| format!("基金 {code}"));
    let fund_type = value_text(base.get("FTYPE")).unwrap_or_else(|| "基金".to_string());
    let issuer = value_text(base.get("JJGS")).unwrap_or_default();
    let mut manager = value_text(base.get("JJJL")).unwrap_or_default();
    let mut nav_date = value_text(base.get("FSRQ"));
    let mut nav = value_number(base.get("DWJZ"));
    let topic_labels = item
        .get("ZTJJInfo")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| value_text(item.get("TTYPENAME")))
                .filter(|value| !value.trim().is_empty())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    let mut estimate_nav = None;
    let mut estimate_change = None;
    let mut estimate_time = None;
    let gz_url = format!("https://fundgz.1234567.com.cn/js/{code}.js");
    match fetch_text(&client, &gz_url).await {
        Ok(text) => {
            if let Some(value) = parse_jsonp_payload(&text) {
                nav_date = value_text(value.get("jzrq")).or(nav_date);
                nav = value_number(value.get("dwjz")).or(nav);
                estimate_nav = value_number(value.get("gsz"));
                estimate_change = value_number(value.get("gszzl"));
                estimate_time = value_text(value.get("gztime"));
            } else {
                warnings.push("实时估值接口返回格式未识别。".to_string());
            }
        }
        Err(error) => warnings.push(format!("实时估值读取失败：{}", error.message)),
    }

    let mut return_1m = None;
    let mut return_3m = None;
    let mut return_6m = None;
    let mut return_1y = None;
    let mut latest_stock_position = None;
    let mut asset_allocation_as_of = None;
    let mut stock_weight = None;
    let mut bond_weight = None;
    let mut cash_weight = None;
    let mut net_asset = None;
    let mut purchase_status = String::new();
    let mut purchase_open = None;
    let mut purchase_limit = None;
    let mut redemption_open = None;
    let mut holdings_as_of = None;
    let mut top_holdings = Vec::new();
    let mut nav_history = Vec::new();
    let mut redemption_fee_schedule = Vec::new();
    let detail_url = format!("https://fund.eastmoney.com/pingzhongdata/{code}.js");
    match fetch_text(&client, &detail_url).await {
        Ok(text) => {
            return_1m =
                js_string_var(&text, "syl_1y").and_then(|value| parse_percent_number(&value));
            return_3m =
                js_string_var(&text, "syl_3y").and_then(|value| parse_percent_number(&value));
            return_6m =
                js_string_var(&text, "syl_6y").and_then(|value| parse_percent_number(&value));
            return_1y =
                js_string_var(&text, "syl_1n").and_then(|value| parse_percent_number(&value));
            if manager.trim().is_empty() {
                manager = js_value_var(&text, "Data_currentFundManager")
                    .and_then(|value| value.as_array().and_then(|items| items.first().cloned()))
                    .and_then(|item| value_text(item.get("name")))
                    .unwrap_or_default();
            }
            latest_stock_position = js_value_var(&text, "Data_fundSharesPositions")
                .and_then(|value| value.as_array().and_then(|items| items.last().cloned()))
                .and_then(|row| row.as_array().and_then(|items| value_number(items.get(1))));
            nav_history = js_value_var(&text, "Data_netWorthTrend")
                .and_then(|value| value.as_array().cloned())
                .map(|trend| fund_nav_history(&trend, 130))
                .unwrap_or_default();
            if let Some(allocation) = js_value_var(&text, "Data_assetAllocation") {
                asset_allocation_as_of = allocation
                    .get("categories")
                    .and_then(Value::as_array)
                    .and_then(|items| items.last())
                    .and_then(|item| value_text(Some(item)));
                stock_weight = asset_allocation_latest(&allocation, "股票");
                bond_weight = asset_allocation_latest(&allocation, "债券");
                cash_weight = asset_allocation_latest(&allocation, "现金");
                net_asset = asset_allocation_latest(&allocation, "净资产");
            } else {
                warnings.push("资产配置数据未识别。".to_string());
            }
        }
        Err(error) => warnings.push(format!("详情数据读取失败：{}", error.message)),
    }

    let fund_page_url = format!("https://fund.eastmoney.com/{code}.html");
    match fetch_text(&client, &fund_page_url).await {
        Ok(text) => {
            let status = parse_fund_transaction_status(&text);
            purchase_status = status.label;
            purchase_open = status.purchase_open;
            purchase_limit = status.purchase_limit;
            redemption_open = status.redemption_open;
            if purchase_open.is_none() {
                warnings.push("基金申购状态未识别，生成交易票前需要人工复核。".to_string());
            }
        }
        Err(error) => warnings.push(format!("基金交易状态读取失败：{}", error.message)),
    }

    let holdings_url = format!(
        "https://fundf10.eastmoney.com/FundArchivesDatas.aspx?type=jjcc&code={code}&topline=10"
    );
    match fetch_text(&client, &holdings_url).await {
        Ok(text) => {
            let snapshot = parse_fund_top_holdings(&text);
            holdings_as_of = snapshot.as_of;
            top_holdings = snapshot.holdings;
            if top_holdings.is_empty() {
                warnings
                    .push("基金最新季报未返回股票前十大持仓，重合度将使用规则型估计。".to_string());
            }
        }
        Err(error) => warnings.push(format!("基金季报持仓读取失败：{}", error.message)),
    }

    let fee_url = format!("https://fundf10.eastmoney.com/jjfl_{code}.html");
    match fetch_text(&client, &fee_url).await {
        Ok(text) => {
            redemption_fee_schedule = parse_fund_redemption_fees(&text);
            if redemption_fee_schedule.is_empty() {
                warnings.push("基金赎回费率表未识别，替换计划只能输出草案。".to_string());
            }
        }
        Err(error) => warnings.push(format!("基金赎回费率读取失败：{}", error.message)),
    }

    Ok(FundProfileSeed {
        code: code.to_string(),
        name,
        fund_type,
        manager,
        issuer,
        nav_symbol: code.to_string(),
        nav_date,
        nav: nav.map(|value| round(value, 4)),
        estimate_nav: estimate_nav.map(|value| round(value, 4)),
        estimate_change: estimate_change.map(|value| round(value, 2)),
        estimate_time,
        return_1m: return_1m.map(|value| round(value, 2)),
        return_3m: return_3m.map(|value| round(value, 2)),
        return_6m: return_6m.map(|value| round(value, 2)),
        return_1y: return_1y.map(|value| round(value, 2)),
        latest_stock_position: latest_stock_position.map(|value| round(value, 2)),
        asset_allocation_as_of,
        stock_weight: stock_weight.map(|value| round(value, 2)),
        bond_weight: bond_weight.map(|value| round(value, 2)),
        cash_weight: cash_weight.map(|value| round(value, 2)),
        net_asset: net_asset.map(|value| round(value, 2)),
        purchase_status,
        purchase_open,
        purchase_limit: purchase_limit.map(|value| round(value, 2)),
        redemption_open,
        holdings_as_of,
        top_holdings,
        nav_history,
        redemption_fee_schedule,
        topic_labels,
        source_name: "东方财富公开基金资料".to_string(),
        source_url: fund_page_url,
        fetched_at: Utc::now().to_rfc3339(),
        warnings,
    })
}

pub async fn lookup_fund_nav(code: String, date: String) -> Result<FundNavLookup, AppError> {
    let code = code.trim();
    if !code.chars().all(|char| char.is_ascii_digit()) || code.len() != 6 {
        return Err(AppError::invalid("基金代码需要是 6 位数字"));
    }
    let requested = NaiveDate::parse_from_str(date.trim(), "%Y-%m-%d")
        .map_err(|_| AppError::invalid("净值日期需要使用 YYYY-MM-DD"))?;
    let client = market_client_builder()
        .default_headers(eastmoney_headers())
        .build()
        .map_err(|error| AppError::internal(format!("fund nav client build failed: {error}")))?;
    let source_url = format!("https://fund.eastmoney.com/pingzhongdata/{code}.js");
    let text = fetch_text(&client, &source_url).await?;
    let trend = js_value_var(&text, "Data_netWorthTrend")
        .and_then(|value| value.as_array().cloned())
        .ok_or_else(|| AppError::fetch(format!("基金 {code} 的历史净值数据未识别")))?;
    let point = fund_nav_point_for_date(&trend, requested);
    let (nav_date, nav) = point.ok_or_else(|| {
        AppError::fetch(format!(
            "基金 {code} 未找到 {} 的确认净值",
            requested.format("%Y-%m-%d")
        ))
    })?;
    Ok(FundNavLookup {
        code: code.to_string(),
        requested_date: requested.format("%Y-%m-%d").to_string(),
        nav_date: nav_date.format("%Y-%m-%d").to_string(),
        nav: round(nav, 4),
        exact: true,
        source_name: "东方财富公开基金历史净值".to_string(),
        source_url,
        fetched_at: Utc::now().to_rfc3339(),
    })
}

fn fund_nav_point_for_date(trend: &[Value], requested: NaiveDate) -> Option<(NaiveDate, f64)> {
    trend.iter().find_map(|item| {
        let raw_timestamp = value_number(item.get("x"))?;
        let timestamp = if raw_timestamp.abs() < 10_000_000_000.0 {
            (raw_timestamp * 1000.0) as i64
        } else {
            raw_timestamp as i64
        };
        let nav_date = Utc.timestamp_millis_opt(timestamp).single()?.date_naive();
        if nav_date != requested {
            return None;
        }
        value_number(item.get("y")).map(|nav| (nav_date, nav))
    })
}

fn fund_nav_history(trend: &[Value], limit: usize) -> Vec<FundNavPoint> {
    let mut points = trend
        .iter()
        .filter_map(|item| {
            let raw_timestamp = value_number(item.get("x"))?;
            let timestamp = if raw_timestamp.abs() < 10_000_000_000.0 {
                (raw_timestamp * 1000.0) as i64
            } else {
                raw_timestamp as i64
            };
            let date = Utc.timestamp_millis_opt(timestamp).single()?.date_naive();
            let nav = value_number(item.get("y"))?;
            (nav > 0.0).then_some(FundNavPoint {
                date: date.format("%Y-%m-%d").to_string(),
                nav: round(nav, 4),
            })
        })
        .collect::<Vec<_>>();
    points.sort_by(|left, right| left.date.cmp(&right.date));
    points.dedup_by(|left, right| left.date == right.date);
    if points.len() > limit {
        points.drain(0..points.len() - limit);
    }
    points
}

pub fn export_profile_config(profile: &str) -> Result<ProfileConfigBundle, AppError> {
    let (content, path, builtin) = profile_source_content(profile)?;
    let value = parse_profile_json_value(&content)?;
    let json = serde_json::to_string_pretty(&value)
        .map_err(|error| AppError::internal(format!("profile export failed: {error}")))?;
    let parsed = parse_profile(
        &json,
        path.as_ref()
            .and_then(|item| item.parent().map(Path::to_path_buf)),
    )?;

    Ok(ProfileConfigBundle {
        key: parsed.key,
        name: parsed.name,
        market: parsed.market,
        description: parsed.description.unwrap_or_default(),
        builtin,
        path: path.map(|item| item.display().to_string()),
        json,
    })
}

pub fn import_profile_config(content: &str) -> Result<ProfileSummary, AppError> {
    let value = parse_profile_json_value(content)?;
    let json = serde_json::to_string_pretty(&value)
        .map_err(|error| AppError::internal(format!("profile import failed: {error}")))?;
    let profile = parse_profile(&json, None)?;

    if BUILTIN_PROFILES.iter().any(|(key, _)| *key == profile.key) {
        return Err(AppError::invalid(format!(
            "profile key '{}' conflicts with a built-in profile; use a unique key",
            profile.key
        )));
    }

    let dir = writable_profile_dir()?;
    fs::create_dir_all(&dir)
        .map_err(|error| AppError::invalid(format!("profile directory create failed: {error}")))?;
    let path = dir.join(format!("{}.json", safe_profile_filename(&profile.key)));
    fs::write(&path, json)
        .map_err(|error| AppError::invalid(format!("profile import write failed: {error}")))?;

    Ok(profile_summary(profile, false))
}

fn profile_summary(profile: AnalysisProfile, builtin: bool) -> ProfileSummary {
    ProfileSummary {
        key: profile.key,
        name: profile.name,
        market: profile.market,
        description: profile.description.unwrap_or_default(),
        builtin,
        schema_version: profile.schema_version,
        profile_version: profile.profile_version,
        parent_profile: profile.extends,
    }
}

pub fn validate_profile_config(content: &str) -> ProfileValidationReport {
    let mut report = ProfileValidationReport::new();
    let source_value = match parse_profile_json_value(content) {
        Ok(value) => value,
        Err(error) => {
            report.error("json", "$", error.message);
            return report.finish();
        }
    };
    let value = match resolve_profile_json_value(source_value, None) {
        Ok(value) => value,
        Err(error) => {
            report.error("inheritance", "extends", error.message);
            return report.finish();
        }
    };
    let mut profile: AnalysisProfile = match serde_json::from_value(value) {
        Ok(profile) => profile,
        Err(error) => {
            report.error("schema", "$", format!("profile parse failed: {error}"));
            return report.finish();
        }
    };
    profile.base_dir = None;

    if let Err(error) = validate_profile(profile.clone()) {
        report.error("profile", "$", error.message);
    }

    validate_profile_semantics(&profile, &mut report);
    report.finish()
}

pub fn load_holdings_from_path(path: &Path) -> Result<Vec<HoldingRecord>, AppError> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    let content = fs::read_to_string(path)
        .map_err(|error| AppError::internal(format!("holdings file read failed: {error}")))?;
    let holdings: Vec<HoldingRecord> = serde_json::from_str(&content)
        .map_err(|error| AppError::invalid(format!("holdings json parse failed: {error}")))?;
    normalize_holdings(holdings)
}

pub fn save_holdings_to_path(
    path: &Path,
    holdings: Vec<HoldingRecord>,
) -> Result<Vec<HoldingRecord>, AppError> {
    let holdings = normalize_holdings(holdings)?;
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|error| {
            AppError::internal(format!("holdings directory create failed: {error}"))
        })?;
    }
    let json = serde_json::to_string_pretty(&holdings)
        .map_err(|error| AppError::internal(format!("holdings serialize failed: {error}")))?;
    let temp_path = path.with_extension("json.tmp");
    fs::write(&temp_path, json)
        .map_err(|error| AppError::internal(format!("holdings temp write failed: {error}")))?;
    fs::rename(&temp_path, path)
        .map_err(|error| AppError::internal(format!("holdings file replace failed: {error}")))?;
    Ok(holdings)
}

pub fn load_trades_from_path(path: &Path) -> Result<Vec<TradeRecord>, AppError> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    let content = fs::read_to_string(path)
        .map_err(|error| AppError::internal(format!("trades file read failed: {error}")))?;
    let trades: Vec<TradeRecord> = serde_json::from_str(&content)
        .map_err(|error| AppError::invalid(format!("trades json parse failed: {error}")))?;
    normalize_trades(trades)
}

pub fn save_trades_to_path(
    path: &Path,
    trades: Vec<TradeRecord>,
) -> Result<Vec<TradeRecord>, AppError> {
    let trades = normalize_trades(trades)?;
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|error| {
            AppError::internal(format!("trades directory create failed: {error}"))
        })?;
    }
    let json = serde_json::to_string_pretty(&trades)
        .map_err(|error| AppError::internal(format!("trades serialize failed: {error}")))?;
    let temp_path = path.with_extension("json.tmp");
    fs::write(&temp_path, json)
        .map_err(|error| AppError::internal(format!("trades temp write failed: {error}")))?;
    fs::rename(&temp_path, path)
        .map_err(|error| AppError::internal(format!("trades file replace failed: {error}")))?;
    Ok(trades)
}

const ACCOUNT_STORE_VERSION: u16 = 2;
const PERFORMANCE_LEDGER_VERSION: u16 = 1;
const STATEMENT_IMPORT_LEDGER_VERSION: u16 = 1;
const DATA_BACKUP_SCHEMA_VERSION: u16 = 1;
const DATA_STORE_FILES: [(&str, &str); 10] = [
    ("accounts", "accounts.json"),
    ("holdings", "holdings.json"),
    ("trades", "trades.json"),
    ("orders", "orders.json"),
    ("recommendations", "recommendations.json"),
    ("monitor", "monitor.json"),
    ("riskPolicy", "risk-policy.json"),
    ("paperSim", "paper-sim.json"),
    ("performanceLedger", "performance-ledger.json"),
    ("statementImports", "statement-imports.json"),
];

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountStoreSnapshot {
    pub version: u16,
    pub updated_at: String,
    pub accounts: Vec<Value>,
    pub broker_snapshots: Vec<Value>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PerformanceLedgerSnapshot {
    pub version: u16,
    pub updated_at: String,
    pub snapshots: Vec<Value>,
    pub cash_flows: Vec<Value>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatementImportLedgerSnapshot {
    pub version: u16,
    pub updated_at: String,
    pub batches: Vec<Value>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DataBackupSummary {
    pub id: String,
    pub created_at: String,
    pub reason: String,
    pub schema_version: u16,
    pub files: Vec<String>,
    pub bytes: u64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DataRestoreResult {
    pub backup_id: String,
    pub pre_restore_backup_id: String,
    pub restored_files: usize,
    pub restored_at: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DataStoreDiagnostic {
    pub key: String,
    pub file: String,
    pub present: bool,
    pub bytes: u64,
    pub records: usize,
    pub version: u64,
    pub readable: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DataDiagnostics {
    pub schema_version: u16,
    pub generated_at: String,
    pub stores: Vec<DataStoreDiagnostic>,
    pub backups: usize,
}

pub fn load_accounts_from_path(path: &Path) -> Result<AccountStoreSnapshot, AppError> {
    if !path.exists() {
        return Ok(empty_account_store());
    }
    let content = fs::read_to_string(path)
        .map_err(|error| AppError::internal(format!("accounts file read failed: {error}")))?;
    let value: Value = serde_json::from_str(&content)
        .map_err(|error| AppError::invalid(format!("accounts json parse failed: {error}")))?;
    normalize_account_store(value)
}

pub fn save_accounts_to_path(
    path: &Path,
    snapshot: AccountStoreSnapshot,
) -> Result<AccountStoreSnapshot, AppError> {
    let snapshot = normalize_account_store(
        serde_json::to_value(snapshot)
            .map_err(|error| AppError::internal(format!("accounts serialize failed: {error}")))?,
    )?;
    write_json_atomically(path, &snapshot, "accounts")?;
    Ok(snapshot)
}

pub fn load_performance_ledger_from_path(
    path: &Path,
) -> Result<PerformanceLedgerSnapshot, AppError> {
    if !path.exists() {
        return Ok(empty_performance_ledger());
    }
    let content = fs::read_to_string(path).map_err(|error| {
        AppError::internal(format!("performance ledger file read failed: {error}"))
    })?;
    let value: Value = serde_json::from_str(&content).map_err(|error| {
        AppError::invalid(format!("performance ledger json parse failed: {error}"))
    })?;
    normalize_performance_ledger(value)
}

pub fn save_performance_ledger_to_path(
    path: &Path,
    snapshot: PerformanceLedgerSnapshot,
) -> Result<PerformanceLedgerSnapshot, AppError> {
    let snapshot =
        normalize_performance_ledger(serde_json::to_value(snapshot).map_err(|error| {
            AppError::internal(format!("performance ledger serialize failed: {error}"))
        })?)?;
    write_json_atomically(path, &snapshot, "performance ledger")?;
    Ok(snapshot)
}

pub fn load_statement_imports_from_path(
    path: &Path,
) -> Result<StatementImportLedgerSnapshot, AppError> {
    if !path.exists() {
        return Ok(empty_statement_import_ledger());
    }
    let content = fs::read_to_string(path).map_err(|error| {
        AppError::internal(format!("statement imports file read failed: {error}"))
    })?;
    let value: Value = serde_json::from_str(&content).map_err(|error| {
        AppError::invalid(format!("statement imports json parse failed: {error}"))
    })?;
    normalize_statement_import_ledger(value)
}

pub fn save_statement_imports_to_path(
    path: &Path,
    snapshot: StatementImportLedgerSnapshot,
) -> Result<StatementImportLedgerSnapshot, AppError> {
    let snapshot =
        normalize_statement_import_ledger(serde_json::to_value(snapshot).map_err(|error| {
            AppError::internal(format!("statement imports serialize failed: {error}"))
        })?)?;
    write_json_atomically(path, &snapshot, "statement imports")?;
    Ok(snapshot)
}

pub fn create_data_backup_in_dir(
    app_data_dir: &Path,
    reason: &str,
) -> Result<DataBackupSummary, AppError> {
    let backups_dir = app_data_dir.join("backups");
    fs::create_dir_all(&backups_dir)
        .map_err(|error| AppError::internal(format!("backup directory create failed: {error}")))?;
    let backup_id = next_backup_id(&backups_dir);
    let backup_dir = backups_dir.join(&backup_id);
    fs::create_dir_all(&backup_dir)
        .map_err(|error| AppError::internal(format!("backup create failed: {error}")))?;
    let mut files = Vec::new();
    let mut bytes = 0_u64;
    for (_, file_name) in DATA_STORE_FILES {
        let source = app_data_dir.join(file_name);
        if !source.is_file() {
            continue;
        }
        let target = backup_dir.join(file_name);
        let copied = fs::copy(&source, &target).map_err(|error| {
            AppError::internal(format!("backup copy failed for {file_name}: {error}"))
        })?;
        files.push(file_name.to_string());
        bytes += copied;
    }
    let summary = DataBackupSummary {
        id: backup_id,
        created_at: Utc::now().to_rfc3339(),
        reason: normalize_backup_reason(reason),
        schema_version: DATA_BACKUP_SCHEMA_VERSION,
        files,
        bytes,
    };
    write_json_atomically(
        &backup_dir.join("manifest.json"),
        &summary,
        "backup manifest",
    )?;
    Ok(summary)
}

pub fn list_data_backups_in_dir(app_data_dir: &Path) -> Result<Vec<DataBackupSummary>, AppError> {
    let backups_dir = app_data_dir.join("backups");
    if !backups_dir.exists() {
        return Ok(Vec::new());
    }
    let entries = fs::read_dir(&backups_dir)
        .map_err(|error| AppError::internal(format!("backup directory read failed: {error}")))?;
    let mut backups = entries
        .filter_map(Result::ok)
        .filter_map(|entry| fs::read_to_string(entry.path().join("manifest.json")).ok())
        .filter_map(|content| serde_json::from_str::<DataBackupSummary>(&content).ok())
        .collect::<Vec<_>>();
    backups.sort_by(|left, right| right.created_at.cmp(&left.created_at));
    Ok(backups)
}

pub fn restore_data_backup_in_dir(
    app_data_dir: &Path,
    backup_id: &str,
) -> Result<DataRestoreResult, AppError> {
    validate_backup_id(backup_id)?;
    let backup_dir = app_data_dir.join("backups").join(backup_id);
    let manifest_path = backup_dir.join("manifest.json");
    let content = fs::read_to_string(&manifest_path)
        .map_err(|error| AppError::invalid(format!("backup manifest unavailable: {error}")))?;
    let manifest: DataBackupSummary = serde_json::from_str(&content)
        .map_err(|error| AppError::invalid(format!("backup manifest invalid: {error}")))?;
    if manifest.id != backup_id || manifest.schema_version != DATA_BACKUP_SCHEMA_VERSION {
        return Err(AppError::invalid(
            "backup manifest identity or schema is invalid",
        ));
    }
    let allowed_files = manifest
        .files
        .iter()
        .cloned()
        .collect::<std::collections::HashSet<_>>();
    if allowed_files
        .iter()
        .any(|file| !DATA_STORE_FILES.iter().any(|(_, known)| known == file))
    {
        return Err(AppError::invalid(
            "backup manifest contains an unsupported file",
        ));
    }
    let protection = create_data_backup_in_dir(app_data_dir, "pre-restore")?;
    let mut restored_files = 0;
    for (_, file_name) in DATA_STORE_FILES {
        let target = app_data_dir.join(file_name);
        if allowed_files.contains(file_name) {
            copy_file_atomically(&backup_dir.join(file_name), &target)?;
            restored_files += 1;
        } else if target.exists() {
            fs::remove_file(&target).map_err(|error| {
                AppError::internal(format!("restore could not remove {file_name}: {error}"))
            })?;
        }
    }
    Ok(DataRestoreResult {
        backup_id: backup_id.to_string(),
        pre_restore_backup_id: protection.id,
        restored_files,
        restored_at: Utc::now().to_rfc3339(),
    })
}

pub fn data_diagnostics_for_dir(app_data_dir: &Path) -> Result<DataDiagnostics, AppError> {
    let stores = DATA_STORE_FILES
        .iter()
        .map(|(key, file_name)| store_diagnostic(app_data_dir, key, file_name))
        .collect::<Vec<_>>();
    let backups = list_data_backups_in_dir(app_data_dir)?.len();
    Ok(DataDiagnostics {
        schema_version: DATA_BACKUP_SCHEMA_VERSION,
        generated_at: Utc::now().to_rfc3339(),
        stores,
        backups,
    })
}

fn empty_account_store() -> AccountStoreSnapshot {
    AccountStoreSnapshot {
        version: ACCOUNT_STORE_VERSION,
        updated_at: String::new(),
        accounts: Vec::new(),
        broker_snapshots: Vec::new(),
    }
}

fn empty_performance_ledger() -> PerformanceLedgerSnapshot {
    PerformanceLedgerSnapshot {
        version: PERFORMANCE_LEDGER_VERSION,
        updated_at: String::new(),
        snapshots: Vec::new(),
        cash_flows: Vec::new(),
    }
}

fn empty_statement_import_ledger() -> StatementImportLedgerSnapshot {
    StatementImportLedgerSnapshot {
        version: STATEMENT_IMPORT_LEDGER_VERSION,
        updated_at: String::new(),
        batches: Vec::new(),
    }
}

fn normalize_statement_import_ledger(
    value: Value,
) -> Result<StatementImportLedgerSnapshot, AppError> {
    let mut object = value
        .as_object()
        .cloned()
        .ok_or_else(|| AppError::invalid("statement imports storage must be a JSON object"))?;
    let updated_at = object
        .remove("updatedAt")
        .and_then(|value| value.as_str().map(str::to_string))
        .unwrap_or_default();
    let batches = object
        .remove("batches")
        .and_then(|value| value.as_array().cloned())
        .unwrap_or_default()
        .into_iter()
        .enumerate()
        .map(|(index, value)| normalize_statement_import_batch(index, value))
        .collect::<Result<Vec<_>, _>>()?;
    Ok(StatementImportLedgerSnapshot {
        version: STATEMENT_IMPORT_LEDGER_VERSION,
        updated_at,
        batches,
    })
}

fn normalize_statement_import_batch(index: usize, value: Value) -> Result<Value, AppError> {
    let batch = value.as_object().ok_or_else(|| {
        AppError::invalid(format!(
            "statement import batches[{index}] must be an object"
        ))
    })?;
    let id = batch
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim();
    let checksum = batch
        .get("checksum")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim();
    let imported_at = batch
        .get("importedAt")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if id.is_empty()
        || checksum.is_empty()
        || chrono::DateTime::parse_from_rfc3339(imported_at).is_err()
    {
        return Err(AppError::invalid(format!(
            "statement import batches[{index}] has invalid identity or timestamp"
        )));
    }
    Ok(value)
}

fn normalize_performance_ledger(value: Value) -> Result<PerformanceLedgerSnapshot, AppError> {
    let mut object = value
        .as_object()
        .cloned()
        .ok_or_else(|| AppError::invalid("performance ledger storage must be a JSON object"))?;
    let updated_at = object
        .remove("updatedAt")
        .and_then(|value| value.as_str().map(str::to_string))
        .unwrap_or_default();
    let snapshots = object
        .remove("snapshots")
        .and_then(|value| value.as_array().cloned())
        .unwrap_or_default()
        .into_iter()
        .enumerate()
        .map(|(index, snapshot)| normalize_performance_snapshot(index, snapshot))
        .collect::<Result<Vec<_>, _>>()?;
    let cash_flows = object
        .remove("cashFlows")
        .and_then(|value| value.as_array().cloned())
        .unwrap_or_default()
        .into_iter()
        .enumerate()
        .map(|(index, cash_flow)| normalize_performance_cash_flow(index, cash_flow))
        .collect::<Result<Vec<_>, _>>()?;
    Ok(PerformanceLedgerSnapshot {
        version: PERFORMANCE_LEDGER_VERSION,
        updated_at,
        snapshots,
        cash_flows,
    })
}

fn normalize_performance_snapshot(index: usize, value: Value) -> Result<Value, AppError> {
    let snapshot = value.as_object().ok_or_else(|| {
        AppError::invalid(format!("performance snapshots[{index}] must be an object"))
    })?;
    let date = snapshot
        .get("date")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let currency = snapshot
        .get("baseCurrency")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let portfolio_value = snapshot
        .get("portfolioValue")
        .and_then(Value::as_f64)
        .unwrap_or_default();
    if !valid_date_key(date)
        || !matches!(currency, "CNY" | "USD")
        || !portfolio_value.is_finite()
        || portfolio_value <= 0.0
    {
        return Err(AppError::invalid(format!(
            "performance snapshots[{index}] has invalid date, currency, or value"
        )));
    }
    Ok(value)
}

fn normalize_performance_cash_flow(index: usize, value: Value) -> Result<Value, AppError> {
    let cash_flow = value.as_object().ok_or_else(|| {
        AppError::invalid(format!("performance cashFlows[{index}] must be an object"))
    })?;
    let id = cash_flow
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim();
    let date = cash_flow
        .get("date")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let currency = cash_flow
        .get("currency")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let base_currency = cash_flow
        .get("baseCurrency")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let base_amount = cash_flow
        .get("baseAmount")
        .and_then(Value::as_f64)
        .unwrap_or_default();
    if id.is_empty()
        || !valid_date_key(date)
        || !matches!(currency, "CNY" | "USD")
        || !matches!(base_currency, "CNY" | "USD")
        || !base_amount.is_finite()
        || base_amount == 0.0
    {
        return Err(AppError::invalid(format!(
            "performance cashFlows[{index}] has invalid identity, date, currency, or amount"
        )));
    }
    Ok(value)
}

fn valid_date_key(value: &str) -> bool {
    chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d").is_ok()
}

fn normalize_account_store(value: Value) -> Result<AccountStoreSnapshot, AppError> {
    let (updated_at, raw_accounts, raw_snapshots) = match value {
        Value::Array(snapshots) => (String::new(), Vec::new(), snapshots),
        Value::Object(mut object) => {
            let updated_at = object
                .remove("updatedAt")
                .and_then(|value| value.as_str().map(str::to_string))
                .unwrap_or_default();
            let accounts = object
                .remove("accounts")
                .and_then(|value| value.as_array().cloned())
                .unwrap_or_default();
            let snapshots = object
                .remove("brokerSnapshots")
                .or_else(|| object.remove("snapshots"))
                .and_then(|value| value.as_array().cloned())
                .unwrap_or_default();
            (updated_at, accounts, snapshots)
        }
        _ => {
            return Err(AppError::invalid(
                "accounts storage must be a JSON object or legacy snapshot array",
            ))
        }
    };
    let accounts = raw_accounts
        .into_iter()
        .enumerate()
        .map(|(index, account)| normalize_account_value(index, account))
        .collect::<Result<Vec<_>, _>>()?;
    let broker_snapshots = raw_snapshots
        .into_iter()
        .filter(|snapshot| snapshot.is_object())
        .take(24)
        .collect();
    Ok(AccountStoreSnapshot {
        version: ACCOUNT_STORE_VERSION,
        updated_at,
        accounts,
        broker_snapshots,
    })
}

fn normalize_account_value(index: usize, value: Value) -> Result<Value, AppError> {
    let mut account = value
        .as_object()
        .cloned()
        .ok_or_else(|| AppError::invalid(format!("accounts[{index}] must be an object")))?;
    let id = account
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_string();
    if id.is_empty() {
        return Err(AppError::invalid(format!(
            "accounts[{index}].id cannot be empty"
        )));
    }
    let currency = account
        .get("currency")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_ascii_uppercase();
    if !matches!(currency.as_str(), "CNY" | "USD") {
        return Err(AppError::invalid(format!(
            "accounts[{index}].currency must be CNY or USD"
        )));
    }
    let legacy_cash = account.get("cash").and_then(Value::as_f64).unwrap_or(0.0);
    let settled_cash = account
        .get("settledCash")
        .and_then(Value::as_f64)
        .unwrap_or(legacy_cash);
    let available_cash = account
        .get("availableCash")
        .and_then(Value::as_f64)
        .unwrap_or(legacy_cash.max(settled_cash));
    let pending_settlement = account
        .get("pendingSettlement")
        .and_then(Value::as_f64)
        .unwrap_or(0.0);
    for (field, amount, allow_negative) in [
        ("settledCash", settled_cash, false),
        ("availableCash", available_cash, false),
        ("pendingSettlement", pending_settlement, true),
    ] {
        if !amount.is_finite() || (!allow_negative && amount < 0.0) {
            return Err(AppError::invalid(format!(
                "accounts[{index}].{field} is invalid"
            )));
        }
    }
    account.insert("id".to_string(), Value::String(id));
    account.insert("currency".to_string(), Value::String(currency));
    account.insert("settledCash".to_string(), json_number(settled_cash));
    account.insert("availableCash".to_string(), json_number(available_cash));
    account.insert(
        "pendingSettlement".to_string(),
        json_number(pending_settlement),
    );
    account.remove("cash");
    Ok(Value::Object(account))
}

fn write_json_atomically<T: Serialize>(
    path: &Path,
    value: &T,
    label: &str,
) -> Result<(), AppError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            AppError::internal(format!("{label} directory create failed: {error}"))
        })?;
    }
    let content = serde_json::to_string_pretty(value)
        .map_err(|error| AppError::internal(format!("{label} serialize failed: {error}")))?;
    let temp_path = path.with_extension("json.tmp");
    fs::write(&temp_path, content)
        .map_err(|error| AppError::internal(format!("{label} temp write failed: {error}")))?;
    fs::rename(&temp_path, path)
        .map_err(|error| AppError::internal(format!("{label} replace failed: {error}")))?;
    Ok(())
}

fn copy_file_atomically(source: &Path, target: &Path) -> Result<(), AppError> {
    let file_name = target
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("data file");
    if !source.is_file() {
        return Err(AppError::invalid(format!(
            "backup file missing: {file_name}"
        )));
    }
    let temp_path = target.with_extension("json.restore.tmp");
    fs::copy(source, &temp_path).map_err(|error| {
        AppError::internal(format!("restore copy failed for {file_name}: {error}"))
    })?;
    fs::rename(&temp_path, target).map_err(|error| {
        AppError::internal(format!("restore replace failed for {file_name}: {error}"))
    })?;
    Ok(())
}

fn next_backup_id(backups_dir: &Path) -> String {
    let base = format!("backup-{}", Utc::now().format("%Y%m%dT%H%M%S%3fZ"));
    if !backups_dir.join(&base).exists() {
        return base;
    }
    (2..1000)
        .map(|suffix| format!("{base}-{suffix}"))
        .find(|candidate| !backups_dir.join(candidate).exists())
        .unwrap_or_else(|| format!("{base}-overflow"))
}

fn validate_backup_id(backup_id: &str) -> Result<(), AppError> {
    let valid = backup_id.starts_with("backup-")
        && backup_id.len() <= 80
        && backup_id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'));
    if valid {
        Ok(())
    } else {
        Err(AppError::invalid("backup id is invalid"))
    }
}

fn normalize_backup_reason(reason: &str) -> String {
    if reason.trim() == "pre-restore" {
        "pre-restore".to_string()
    } else {
        "manual".to_string()
    }
}

fn store_diagnostic(app_data_dir: &Path, key: &str, file_name: &str) -> DataStoreDiagnostic {
    let path = app_data_dir.join(file_name);
    let bytes = fs::metadata(&path)
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    let value = fs::read_to_string(&path)
        .ok()
        .and_then(|content| serde_json::from_str::<Value>(&content).ok());
    let records = value.as_ref().map(diagnostic_record_count).unwrap_or(0);
    let version = value
        .as_ref()
        .and_then(|item| item.get("version"))
        .and_then(Value::as_u64)
        .unwrap_or(0);
    DataStoreDiagnostic {
        key: key.to_string(),
        file: file_name.to_string(),
        present: path.is_file(),
        bytes,
        records,
        version,
        readable: !path.exists() || value.is_some(),
    }
}

fn diagnostic_record_count(value: &Value) -> usize {
    if let Some(items) = value.as_array() {
        return items.len();
    }
    if value.get("snapshots").is_some() || value.get("cashFlows").is_some() {
        return value
            .get("snapshots")
            .and_then(Value::as_array)
            .map(Vec::len)
            .unwrap_or(0)
            + value
                .get("cashFlows")
                .and_then(Value::as_array)
                .map(Vec::len)
                .unwrap_or(0);
    }
    ["accounts", "orders", "records", "batches"]
        .iter()
        .find_map(|key| value.get(key).and_then(Value::as_array).map(Vec::len))
        .or_else(|| value.as_object().map(|_| 1))
        .unwrap_or(0)
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct OrderStoreSnapshot {
    version: u16,
    updated_at: String,
    orders: Vec<Value>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct MonitorStoreSnapshot {
    version: u16,
    updated_at: String,
    snapshot: Option<Value>,
    records: Vec<Value>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct RiskPolicyStoreSnapshot {
    version: u16,
    updated_at: String,
    policy: Value,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PaperSimStoreSnapshot {
    version: u16,
    updated_at: String,
    state: Value,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct RecommendationStoreSnapshot {
    version: u16,
    updated_at: String,
    records: Vec<Value>,
}

pub fn load_orders_from_path(path: &Path) -> Result<Vec<Value>, AppError> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    let content = fs::read_to_string(path)
        .map_err(|error| AppError::internal(format!("orders file read failed: {error}")))?;
    let value: Value = serde_json::from_str(&content)
        .map_err(|error| AppError::invalid(format!("orders json parse failed: {error}")))?;
    order_values_from_storage_value(value)
}

pub fn save_orders_to_path(path: &Path, orders: Vec<Value>) -> Result<Vec<Value>, AppError> {
    let orders = normalize_order_values(orders);
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|error| {
            AppError::internal(format!("orders directory create failed: {error}"))
        })?;
    }
    let snapshot = OrderStoreSnapshot {
        version: 1,
        updated_at: Utc::now().to_rfc3339(),
        orders: orders.clone(),
    };
    let json = serde_json::to_string_pretty(&snapshot)
        .map_err(|error| AppError::internal(format!("orders serialize failed: {error}")))?;
    let temp_path = path.with_extension("json.tmp");
    fs::write(&temp_path, json)
        .map_err(|error| AppError::internal(format!("orders temp write failed: {error}")))?;
    fs::rename(&temp_path, path)
        .map_err(|error| AppError::internal(format!("orders file replace failed: {error}")))?;
    Ok(orders)
}

pub fn load_recommendations_from_path(path: &Path) -> Result<Vec<Value>, AppError> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    let content = fs::read_to_string(path).map_err(|error| {
        AppError::internal(format!("recommendations file read failed: {error}"))
    })?;
    let value: Value = serde_json::from_str(&content).map_err(|error| {
        AppError::invalid(format!("recommendations json parse failed: {error}"))
    })?;
    Ok(value
        .get("records")
        .and_then(Value::as_array)
        .cloned()
        .or_else(|| value.as_array().cloned())
        .unwrap_or_default())
}

pub fn save_recommendations_to_path(
    path: &Path,
    records: Vec<Value>,
) -> Result<Vec<Value>, AppError> {
    let records = records
        .into_iter()
        .filter(|record| record.get("id").and_then(Value::as_str).is_some())
        .rev()
        .take(5_000)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<Vec<_>>();
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|error| {
            AppError::internal(format!("recommendations directory create failed: {error}"))
        })?;
    }
    let snapshot = RecommendationStoreSnapshot {
        version: 1,
        updated_at: Utc::now().to_rfc3339(),
        records: records.clone(),
    };
    let json = serde_json::to_string_pretty(&snapshot).map_err(|error| {
        AppError::internal(format!("recommendations serialize failed: {error}"))
    })?;
    let temp_path = path.with_extension("json.tmp");
    fs::write(&temp_path, json).map_err(|error| {
        AppError::internal(format!("recommendations temp write failed: {error}"))
    })?;
    fs::rename(&temp_path, path).map_err(|error| {
        AppError::internal(format!("recommendations file replace failed: {error}"))
    })?;
    Ok(records)
}

fn evaluate_recommendation_records(
    path: &Path,
    profile: &AnalysisProfile,
    series: &HashMap<String, Vec<Candle>>,
    requested_as_of: Option<&str>,
) -> Result<(), AppError> {
    let mut records = load_recommendations_from_path(path)?;
    if records.is_empty() {
        return Ok(());
    }
    let cutoff = requested_as_of
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| {
            NaiveDate::parse_from_str(value, "%Y-%m-%d")
                .map_err(|_| AppError::invalid("asOf must use YYYY-MM-DD"))
        })
        .transpose()?;
    let benchmark_series = series_for_symbol(series, &profile.benchmark);
    let mut changed = false;

    for record in &mut records {
        let Some(object) = record.as_object_mut() else {
            continue;
        };
        if object.get("schemaVersion").and_then(Value::as_u64) != Some(2)
            || object.get("profileKey").and_then(Value::as_str) != Some(profile.key.as_str())
        {
            continue;
        }
        let Some(reference_price) = object
            .get("referencePrice")
            .and_then(Value::as_f64)
            .filter(|value| value.is_finite() && *value > 0.0)
        else {
            continue;
        };
        let Some(symbol) = object.get("symbol").and_then(Value::as_str) else {
            continue;
        };
        let Some(anchor_date) = object
            .get("asOf")
            .and_then(Value::as_str)
            .and_then(|value| NaiveDate::parse_from_str(value, "%Y-%m-%d").ok())
        else {
            continue;
        };
        let Some(symbol_series) = series_for_symbol(series, symbol) else {
            continue;
        };
        let Some(anchor_index) = candle_index_on_or_before(symbol_series, anchor_date) else {
            continue;
        };
        let side = object
            .get("side")
            .and_then(Value::as_str)
            .unwrap_or("BUY")
            .trim()
            .to_ascii_uppercase();
        let decision_type = object
            .get("decisionType")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .trim()
            .to_ascii_lowercase();
        let inverse_outcome = side == "SELL"
            || matches!(
                decision_type.as_str(),
                "reduce" | "wait" | "blocked" | "config"
            );
        let Some(outcomes) = object.get_mut("outcomes").and_then(Value::as_array_mut) else {
            continue;
        };

        for outcome in outcomes {
            let Some(outcome_object) = outcome.as_object_mut() else {
                continue;
            };
            if outcome_object.get("status").and_then(Value::as_str) != Some("pending") {
                continue;
            }
            let Some(horizon) = outcome_object
                .get("horizonDays")
                .and_then(Value::as_u64)
                .map(|value| value as usize)
                .filter(|value| *value > 0)
            else {
                continue;
            };
            let target_index = anchor_index.saturating_add(horizon);
            let Some(target) = symbol_series.get(target_index) else {
                continue;
            };
            if cutoff.is_some_and(|date| target.date > date) {
                continue;
            }

            let raw_return = percent(target.close / reference_price - 1.0);
            let signed_return = if inverse_outcome {
                -raw_return
            } else {
                raw_return
            };
            let adverse_return = symbol_series[anchor_index + 1..=target_index]
                .iter()
                .map(|candle| percent(candle.close / reference_price - 1.0))
                .map(|value| if inverse_outcome { -value } else { value })
                .fold(0.0_f64, f64::min);
            let benchmark_return = benchmark_series.and_then(|benchmark| {
                let start = candle_index_on_or_before(benchmark, anchor_date)?;
                let start_close = benchmark.get(start)?.close;
                let end = candle_index_on_or_before(benchmark, target.date)?;
                let end_close = benchmark.get(end)?.close;
                (start_close > 0.0).then_some(percent(end_close / start_close - 1.0))
            });
            let signed_benchmark =
                benchmark_return.map(|value| if inverse_outcome { -value } else { value });
            let excess_return = signed_benchmark.map(|value| signed_return - value);
            let avoided_loss = if inverse_outcome {
                Some((-raw_return).max(0.0))
            } else {
                None
            };

            outcome_object.insert("status".to_string(), Value::String("evaluated".to_string()));
            outcome_object.insert(
                "evaluatedAt".to_string(),
                Value::String(Utc::now().to_rfc3339()),
            );
            outcome_object.insert("evaluationPrice".to_string(), json_number(target.close));
            outcome_object.insert("returnPct".to_string(), json_number(round(raw_return, 4)));
            outcome_object.insert(
                "signedReturnPct".to_string(),
                json_number(round(signed_return, 4)),
            );
            outcome_object.insert(
                "benchmarkReturnPct".to_string(),
                optional_json_number(benchmark_return.map(|value| round(value, 4))),
            );
            outcome_object.insert(
                "excessReturnPct".to_string(),
                optional_json_number(excess_return.map(|value| round(value, 4))),
            );
            outcome_object.insert(
                "maxDrawdownPct".to_string(),
                json_number(round(adverse_return, 4)),
            );
            outcome_object.insert(
                "avoidedLossPct".to_string(),
                optional_json_number(avoided_loss.map(|value| round(value, 4))),
            );
            outcome_object.insert("wasCorrect".to_string(), Value::Bool(signed_return > 0.0));
            outcome_object.insert(
                "note".to_string(),
                Value::String(format!("已按 {} 个交易日评估至 {}。", horizon, target.date)),
            );
            changed = true;
        }
    }

    if changed {
        save_recommendations_to_path(path, records)?;
    }
    Ok(())
}

fn series_for_symbol<'a>(
    series: &'a HashMap<String, Vec<Candle>>,
    symbol: &str,
) -> Option<&'a Vec<Candle>> {
    series.get(symbol).or_else(|| {
        series
            .iter()
            .find(|(key, _)| key.eq_ignore_ascii_case(symbol))
            .map(|(_, candles)| candles)
    })
}

fn candle_index_on_or_before(series: &[Candle], date: NaiveDate) -> Option<usize> {
    series.iter().rposition(|candle| candle.date <= date)
}

fn json_number(value: f64) -> Value {
    serde_json::Number::from_f64(value)
        .map(Value::Number)
        .unwrap_or(Value::Null)
}

fn optional_json_number(value: Option<f64>) -> Value {
    value.map(json_number).unwrap_or(Value::Null)
}

#[derive(Debug, Clone)]
struct RecommendationPerformanceObservation {
    horizon_days: usize,
    side: String,
    market_state: String,
    priority: Option<String>,
    correct: bool,
    signed_return_pct: f64,
    excess_return_pct: Option<f64>,
    max_adverse_pct: Option<f64>,
}

fn recommendation_performance_for(
    path: &Path,
    profile_key: &str,
) -> Result<RecommendationPerformanceSummary, AppError> {
    let records = load_recommendations_from_path(path)?;
    let mut deduplicated = BTreeMap::<String, RecommendationPerformanceObservation>::new();
    let mut evaluated_records = BTreeMap::<String, bool>::new();
    let mut raw_evaluated_outcomes = 0;
    let mut pending_outcomes = 0;
    let mut insufficient_outcomes = 0;

    for record in records {
        if record.get("profileKey").and_then(Value::as_str) != Some(profile_key) {
            continue;
        }
        let record_id = record
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        let as_of = record
            .get("asOf")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let symbol = record
            .get("symbol")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let side = record
            .get("side")
            .and_then(Value::as_str)
            .unwrap_or("BUY")
            .trim()
            .to_ascii_uppercase();
        let market_state = record
            .get("marketState")
            .and_then(Value::as_str)
            .unwrap_or("unknown")
            .to_string();
        let priority = record
            .get("priority")
            .and_then(Value::as_str)
            .map(|value| value.trim().to_ascii_uppercase())
            .filter(|value| matches!(value.as_str(), "P1" | "P2" | "P3"));
        let Some(outcomes) = record.get("outcomes").and_then(Value::as_array) else {
            continue;
        };
        for outcome in outcomes {
            match outcome
                .get("status")
                .and_then(Value::as_str)
                .unwrap_or("pending")
            {
                "pending" => {
                    pending_outcomes += 1;
                    continue;
                }
                "insufficient" => {
                    insufficient_outcomes += 1;
                    continue;
                }
                "evaluated" => {}
                _ => continue,
            }
            let Some(horizon_days) = outcome
                .get("horizonDays")
                .and_then(Value::as_u64)
                .map(|value| value as usize)
            else {
                continue;
            };
            let Some(signed_return_pct) = outcome
                .get("signedReturnPct")
                .and_then(Value::as_f64)
                .filter(|value| value.is_finite())
            else {
                continue;
            };
            raw_evaluated_outcomes += 1;
            evaluated_records.insert(record_id.clone(), true);
            let key = format!(
                "{}|{}|{}|{}",
                as_of,
                symbol.trim().to_ascii_uppercase(),
                side,
                horizon_days
            );
            deduplicated.insert(
                key,
                RecommendationPerformanceObservation {
                    horizon_days,
                    side: side.clone(),
                    market_state: market_state.clone(),
                    priority: priority.clone(),
                    correct: outcome
                        .get("wasCorrect")
                        .and_then(Value::as_bool)
                        .unwrap_or(signed_return_pct > 0.0),
                    signed_return_pct,
                    excess_return_pct: outcome
                        .get("excessReturnPct")
                        .and_then(Value::as_f64)
                        .filter(|value| value.is_finite()),
                    max_adverse_pct: outcome
                        .get("maxDrawdownPct")
                        .and_then(Value::as_f64)
                        .filter(|value| value.is_finite()),
                },
            );
        }
    }

    let observations = deduplicated.into_values().collect::<Vec<_>>();
    let mut horizon_groups = BTreeMap::<usize, Vec<&RecommendationPerformanceObservation>>::new();
    let mut direction_groups =
        BTreeMap::<String, Vec<&RecommendationPerformanceObservation>>::new();
    let mut state_groups = BTreeMap::<String, Vec<&RecommendationPerformanceObservation>>::new();
    let mut priority_groups = BTreeMap::<String, Vec<&RecommendationPerformanceObservation>>::new();
    for observation in &observations {
        horizon_groups
            .entry(observation.horizon_days)
            .or_default()
            .push(observation);
        direction_groups
            .entry(observation.side.clone())
            .or_default()
            .push(observation);
        state_groups
            .entry(observation.market_state.clone())
            .or_default()
            .push(observation);
        if let Some(priority) = &observation.priority {
            priority_groups
                .entry(priority.clone())
                .or_default()
                .push(observation);
        }
    }

    let horizons = horizon_groups
        .into_iter()
        .map(|(days, items)| performance_slice(days.to_string(), format!("{days} 日"), &items))
        .collect::<Vec<_>>();
    let directions = direction_groups
        .into_iter()
        .map(|(side, items)| {
            let label = match side.as_str() {
                "SELL" => "降低风险",
                "HOLD" => "继续持有",
                "WAIT" => "等待触发",
                "BLOCKED" => "风险阻断",
                "CONFIG" => "等待配置",
                _ => "增加风险",
            };
            performance_slice(side, label.to_string(), &items)
        })
        .collect::<Vec<_>>();
    let mut market_states = state_groups
        .into_iter()
        .map(|(state, items)| {
            performance_slice(
                state.clone(),
                market_state_performance_label(&state),
                &items,
            )
        })
        .collect::<Vec<_>>();
    market_states.sort_by(|left, right| right.sample_count.cmp(&left.sample_count));
    market_states.truncate(6);
    let priorities = ["P1", "P2", "P3"]
        .into_iter()
        .filter_map(|priority| {
            priority_groups.get(priority).map(|items| {
                performance_slice(
                    priority.to_string(),
                    priority_performance_label(priority).to_string(),
                    items,
                )
            })
        })
        .collect::<Vec<_>>();

    let reference = horizons
        .iter()
        .find(|slice| slice.key == "20")
        .or_else(|| horizons.iter().max_by_key(|slice| slice.sample_count));
    let (label, tone, summary) = recommendation_performance_label(reference);

    Ok(RecommendationPerformanceSummary {
        profile_key: profile_key.to_string(),
        label,
        tone,
        summary,
        evaluated_records: evaluated_records.len(),
        raw_evaluated_outcomes,
        effective_evaluated_outcomes: observations.len(),
        pending_outcomes,
        insufficient_outcomes,
        horizons,
        directions,
        market_states,
        priorities,
    })
}

fn priority_performance_label(priority: &str) -> &'static str {
    match priority {
        "P1" => "P1 今日复核",
        "P2" => "P2 计划执行",
        "P3" => "P3 等待触发",
        _ => "未分级",
    }
}

fn empty_recommendation_performance(profile_key: &str) -> RecommendationPerformanceSummary {
    RecommendationPerformanceSummary {
        profile_key: profile_key.to_string(),
        label: "等待真实结果".to_string(),
        tone: "neutral".to_string(),
        summary: "尚无到期的建议结果；不会用历史回测替代真实样本外记录。".to_string(),
        ..RecommendationPerformanceSummary::default()
    }
}

fn performance_slice(
    key: String,
    label: String,
    observations: &[&RecommendationPerformanceObservation],
) -> RecommendationPerformanceSlice {
    let sample_count = observations.len();
    let correct_count = observations.iter().filter(|item| item.correct).count();
    RecommendationPerformanceSlice {
        key,
        label,
        sample_count,
        correct_count,
        hit_rate_pct: (sample_count > 0)
            .then_some(round(correct_count as f64 / sample_count as f64 * 100.0, 1)),
        average_signed_return_pct: average_numbers(
            observations.iter().map(|item| Some(item.signed_return_pct)),
        ),
        average_excess_return_pct: average_numbers(
            observations.iter().map(|item| item.excess_return_pct),
        ),
        average_max_adverse_pct: average_numbers(
            observations.iter().map(|item| item.max_adverse_pct),
        ),
    }
}

fn average_numbers(values: impl Iterator<Item = Option<f64>>) -> Option<f64> {
    let values = values
        .flatten()
        .filter(|value| value.is_finite())
        .collect::<Vec<_>>();
    (!values.is_empty()).then_some(round(values.iter().sum::<f64>() / values.len() as f64, 3))
}

fn recommendation_performance_label(
    reference: Option<&RecommendationPerformanceSlice>,
) -> (String, String, String) {
    let Some(reference) = reference else {
        return (
            "等待真实结果".to_string(),
            "neutral".to_string(),
            "尚无到期的建议结果；不会用历史回测替代真实样本外记录。".to_string(),
        );
    };
    let hit_rate = reference.hit_rate_pct.unwrap_or(0.0);
    let average_return = reference.average_signed_return_pct.unwrap_or(0.0);
    if reference.sample_count < 20 {
        return (
            "样本积累中".to_string(),
            "caution".to_string(),
            format!(
                "{}结果有效 n={}，命中率和收益仅作观察，不用于自动调参。",
                reference.label, reference.sample_count
            ),
        );
    }
    if hit_rate < 45.0 || average_return <= 0.0 {
        return (
            "需要再校准".to_string(),
            "negative".to_string(),
            format!(
                "{}有效 n={}，命中率 {:.1}%，平均方向收益 {:.2}%。",
                reference.label, reference.sample_count, hit_rate, average_return
            ),
        );
    }
    if hit_rate >= 55.0 && average_return > 0.0 {
        return (
            "初步有效".to_string(),
            "positive".to_string(),
            format!(
                "{}有效 n={}，命中率 {:.1}%，平均方向收益 {:.2}%；仍需持续监测。",
                reference.label, reference.sample_count, hit_rate, average_return
            ),
        );
    }
    (
        "稳定性观察".to_string(),
        "caution".to_string(),
        format!(
            "{}有效 n={}，命中率 {:.1}%，平均方向收益 {:.2}%。",
            reference.label, reference.sample_count, hit_rate, average_return
        ),
    )
}

fn market_state_performance_label(key: &str) -> String {
    match key {
        "risk_diffusion_watch" => "风险扩散".to_string(),
        "confirmed_pullback" => "回撤确认".to_string(),
        "trend_breakdown" => "趋势破坏".to_string(),
        "healthy_trend" => "健康趋势".to_string(),
        "hot_trend" => "趋势过热".to_string(),
        "panic" => "恐慌状态".to_string(),
        "unknown" | "" => "状态未知".to_string(),
        other => other.replace('_', " "),
    }
}

fn calibration_action_for(
    profile: &AnalysisProfile,
    performance: &RecommendationPerformanceSummary,
) -> ProfileCalibrationAction {
    const MINIMUM_SAMPLE_COUNT: usize = 20;
    const MINIMUM_SEGMENT_COUNT: usize = 12;

    let horizon_5 = performance.horizons.iter().find(|item| item.key == "5");
    let horizon_20 = performance.horizons.iter().find(|item| item.key == "20");
    let horizon_60 = performance.horizons.iter().find(|item| item.key == "60");
    let buy = performance.directions.iter().find(|item| item.key == "BUY");
    let risk_diffusion = performance
        .market_states
        .iter()
        .find(|item| item.key == "risk_diffusion_watch");
    let current_sample_count = horizon_20
        .map(|item| item.sample_count)
        .or_else(|| {
            performance
                .horizons
                .iter()
                .map(|item| item.sample_count)
                .max()
        })
        .unwrap_or(0);
    let mut evidence = performance
        .horizons
        .iter()
        .map(performance_evidence_line)
        .collect::<Vec<_>>();
    evidence.extend(performance.directions.iter().map(performance_evidence_line));

    if current_sample_count < MINIMUM_SAMPLE_COUNT {
        let missing = MINIMUM_SAMPLE_COUNT.saturating_sub(current_sample_count);
        return ProfileCalibrationAction {
            key: "collect".to_string(),
            label: "保持参数".to_string(),
            tone: "neutral".to_string(),
            action: format!(
                "保持当前 Profile，不调整参数；再积累 {missing} 个去重的 20 日结果后复核。"
            ),
            rationale: "样本不足时调参容易追随短期噪声，当前最实用的动作是继续记录而不是改变阈值。"
                .to_string(),
            next_review: format!("20 日有效样本达到 {MINIMUM_SAMPLE_COUNT} 个时"),
            minimum_sample_count: MINIMUM_SAMPLE_COUNT,
            current_sample_count,
            proposals: Vec::new(),
            evidence,
        };
    }

    let mut proposals = Vec::new();
    if slice_is_weak(buy, MINIMUM_SEGMENT_COUNT) {
        let current = profile.calibration.expansion_structure_min;
        let proposed = current.saturating_add(5).min(90);
        if proposed > current {
            proposals.push(ProfileParameterProposal {
                key: "raise-expansion-confirmation".to_string(),
                label: "提高新增仓位确认门槛".to_string(),
                path: "calibration.expansionStructureMin".to_string(),
                current_value: current.to_string(),
                proposed_value: proposed.to_string(),
                expected_effect: "减少结构证据不足时的买入，优先提高准确率，代价是降低出手频率。"
                    .to_string(),
                reason: "增加风险方向的真实结果偏弱。".to_string(),
                sample_count: buy.map(|item| item.sample_count).unwrap_or(0),
                confidence: proposal_confidence(buy.map(|item| item.sample_count).unwrap_or(0)),
                directly_applicable: true,
            });
        }
    }

    if slice_is_weak(risk_diffusion, MINIMUM_SEGMENT_COUNT) {
        let current = profile.calibration.divergence_trading_cap;
        let proposed = current.saturating_sub(5).max(20);
        if proposed < current {
            proposals.push(ProfileParameterProposal {
                key: "tighten-divergence-cap".to_string(),
                label: "下调风险扩散状态短线仓位上限".to_string(),
                path: "calibration.divergenceTradingCap".to_string(),
                current_value: format!("{current}%"),
                proposed_value: format!("{proposed}%"),
                expected_effect: "风险扩散时少承担短线暴露，降低错误加仓和尾部损失。".to_string(),
                reason: "风险扩散状态的样本外方向收益或命中率偏弱。".to_string(),
                sample_count: risk_diffusion.map(|item| item.sample_count).unwrap_or(0),
                confidence: proposal_confidence(
                    risk_diffusion.map(|item| item.sample_count).unwrap_or(0),
                ),
                directly_applicable: true,
            });
        }
    }

    if short_weak_medium_valid(horizon_5, horizon_20, MINIMUM_SEGMENT_COUNT) {
        proposals.push(ProfileParameterProposal {
            key: "stage-entry".to_string(),
            label: "新增动作改为三批执行".to_string(),
            path: "execution.staging".to_string(),
            current_value: "一次生成计划金额".to_string(),
            proposed_value: "首批 1/3，确认后再执行后两批".to_string(),
            expected_effect: "保留中期方向，同时降低短线择时误差。".to_string(),
            reason: "5 日表现弱、20 日表现仍有效，问题更像执行时点而不是方向。".to_string(),
            sample_count: horizon_5.map(|item| item.sample_count).unwrap_or(0),
            confidence: proposal_confidence(horizon_5.map(|item| item.sample_count).unwrap_or(0)),
            directly_applicable: false,
        });
    }

    if long_weak_medium_valid(horizon_60, horizon_20, MINIMUM_SEGMENT_COUNT) {
        let current = profile.calibration.long_score_cap;
        let proposed = current.saturating_sub(5).max(40);
        if proposed < current {
            proposals.push(ProfileParameterProposal {
                key: "tighten-long-cap".to_string(),
                label: "下调长期仓位评分上限".to_string(),
                path: "calibration.longScoreCap".to_string(),
                current_value: current.to_string(),
                proposed_value: proposed.to_string(),
                expected_effect: "避免把中期有效信号机械延长为长期重仓。".to_string(),
                reason: "20 日方向有效，但 60 日方向收益转弱。".to_string(),
                sample_count: horizon_60.map(|item| item.sample_count).unwrap_or(0),
                confidence: proposal_confidence(
                    horizon_60.map(|item| item.sample_count).unwrap_or(0),
                ),
                directly_applicable: true,
            });
        }
    }

    if !proposals.is_empty() {
        let direct_count = proposals
            .iter()
            .filter(|item| item.directly_applicable)
            .count();
        let action = if direct_count > 0 {
            format!(
                "先试运行 {} 项收紧方案，不直接覆盖当前 Profile；通过 walk-forward 对比后再人工确认。",
                direct_count
            )
        } else {
            "保持 Profile 参数；立即把新增计划改为三批执行，首批不超过计划金额 1/3。".to_string()
        };
        return ProfileCalibrationAction {
            key: "candidate".to_string(),
            label: "生成收紧候选".to_string(),
            tone: "caution".to_string(),
            action,
            rationale:
                "真实样本已达到最低门槛，但任何参数变更仍需与当前版本做同窗口对比，不能直接上线。"
                    .to_string(),
            next_review: "完成候选参数 walk-forward 对比后".to_string(),
            minimum_sample_count: MINIMUM_SAMPLE_COUNT,
            current_sample_count,
            proposals,
            evidence,
        };
    }

    let horizon_20_good = slice_is_strong(horizon_20, MINIMUM_SAMPLE_COUNT);
    ProfileCalibrationAction {
        key: if horizon_20_good { "hold" } else { "review" }.to_string(),
        label: if horizon_20_good {
            "保持参数"
        } else {
            "暂停扩张"
        }
        .to_string(),
        tone: if horizon_20_good {
            "positive"
        } else {
            "caution"
        }
        .to_string(),
        action: if horizon_20_good {
            "保持当前参数，不提高仓位上限；每新增 10 个去重的 20 日结果复核一次。".to_string()
        } else {
            "保持当前参数，暂停提高仓位上限；先检查方向与市场状态分组，不做全局调参。".to_string()
        },
        rationale: if horizon_20_good {
            "当前 20 日样本的命中率与平均方向收益同时为正，尚无收紧或放宽参数的必要。".to_string()
        } else {
            "总样本达到门槛，但没有单一分组提供足够证据支持具体参数修改。".to_string()
        },
        next_review: format!("20 日有效样本达到 {} 个时", current_sample_count + 10),
        minimum_sample_count: MINIMUM_SAMPLE_COUNT,
        current_sample_count,
        proposals,
        evidence,
    }
}

fn slice_is_weak(slice: Option<&RecommendationPerformanceSlice>, minimum_count: usize) -> bool {
    slice.is_some_and(|item| {
        item.sample_count >= minimum_count
            && (item.hit_rate_pct.unwrap_or(0.0) < 45.0
                || item.average_signed_return_pct.unwrap_or(0.0) <= 0.0)
    })
}

fn slice_is_strong(slice: Option<&RecommendationPerformanceSlice>, minimum_count: usize) -> bool {
    slice.is_some_and(|item| {
        item.sample_count >= minimum_count
            && item.hit_rate_pct.unwrap_or(0.0) >= 55.0
            && item.average_signed_return_pct.unwrap_or(0.0) > 0.0
    })
}

fn short_weak_medium_valid(
    short: Option<&RecommendationPerformanceSlice>,
    medium: Option<&RecommendationPerformanceSlice>,
    minimum_count: usize,
) -> bool {
    slice_is_weak(short, minimum_count)
        && medium.is_some_and(|item| {
            item.sample_count >= minimum_count
                && item.hit_rate_pct.unwrap_or(0.0) >= 50.0
                && item.average_signed_return_pct.unwrap_or(0.0) > 0.0
        })
}

fn long_weak_medium_valid(
    long: Option<&RecommendationPerformanceSlice>,
    medium: Option<&RecommendationPerformanceSlice>,
    minimum_count: usize,
) -> bool {
    slice_is_weak(long, minimum_count)
        && medium.is_some_and(|item| {
            item.sample_count >= minimum_count
                && item.average_signed_return_pct.unwrap_or(0.0) > 0.0
        })
}

fn performance_evidence_line(slice: &RecommendationPerformanceSlice) -> String {
    format!(
        "{}：n={}，命中率 {}，平均方向收益 {}。",
        slice.label,
        slice.sample_count,
        slice
            .hit_rate_pct
            .map(|value| format!("{value:.1}%"))
            .unwrap_or_else(|| "—".to_string()),
        slice
            .average_signed_return_pct
            .map(|value| format!("{value:+.2}%"))
            .unwrap_or_else(|| "—".to_string())
    )
}

fn proposal_confidence(sample_count: usize) -> String {
    if sample_count >= 40 {
        "较高".to_string()
    } else if sample_count >= 20 {
        "中等".to_string()
    } else {
        "初步".to_string()
    }
}

pub fn load_monitor_state_from_path(path: &Path) -> Result<Value, AppError> {
    if !path.exists() {
        return Ok(default_monitor_state());
    }
    let content = fs::read_to_string(path)
        .map_err(|error| AppError::internal(format!("monitor file read failed: {error}")))?;
    let value: Value = serde_json::from_str(&content)
        .map_err(|error| AppError::invalid(format!("monitor json parse failed: {error}")))?;
    Ok(normalize_monitor_state_value(value))
}

pub fn save_monitor_state_to_path(path: &Path, state: Value) -> Result<Value, AppError> {
    let normalized = normalize_monitor_state_value(state);
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|error| {
            AppError::internal(format!("monitor directory create failed: {error}"))
        })?;
    }
    let snapshot = MonitorStoreSnapshot {
        version: 1,
        updated_at: Utc::now().to_rfc3339(),
        snapshot: normalized
            .get("snapshot")
            .cloned()
            .filter(|value| !value.is_null()),
        records: normalized
            .get("records")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default(),
    };
    let json = serde_json::to_string_pretty(&snapshot)
        .map_err(|error| AppError::internal(format!("monitor serialize failed: {error}")))?;
    let temp_path = path.with_extension("json.tmp");
    fs::write(&temp_path, json)
        .map_err(|error| AppError::internal(format!("monitor temp write failed: {error}")))?;
    fs::rename(&temp_path, path)
        .map_err(|error| AppError::internal(format!("monitor file replace failed: {error}")))?;
    Ok(normalized)
}

pub fn load_risk_policy_from_path(path: &Path) -> Result<Value, AppError> {
    if !path.exists() {
        return Ok(default_risk_policy_value());
    }
    let content = fs::read_to_string(path)
        .map_err(|error| AppError::internal(format!("risk policy file read failed: {error}")))?;
    let value: Value = serde_json::from_str(&content)
        .map_err(|error| AppError::invalid(format!("risk policy json parse failed: {error}")))?;
    Ok(risk_policy_from_storage_value(value))
}

pub fn save_risk_policy_to_path(path: &Path, policy: Value) -> Result<Value, AppError> {
    let normalized = normalize_risk_policy_value(policy);
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|error| {
            AppError::internal(format!("risk policy directory create failed: {error}"))
        })?;
    }
    let snapshot = RiskPolicyStoreSnapshot {
        version: 1,
        updated_at: Utc::now().to_rfc3339(),
        policy: normalized.clone(),
    };
    let json = serde_json::to_string_pretty(&snapshot)
        .map_err(|error| AppError::internal(format!("risk policy serialize failed: {error}")))?;
    let temp_path = path.with_extension("json.tmp");
    fs::write(&temp_path, json)
        .map_err(|error| AppError::internal(format!("risk policy temp write failed: {error}")))?;
    fs::rename(&temp_path, path)
        .map_err(|error| AppError::internal(format!("risk policy file replace failed: {error}")))?;
    Ok(normalized)
}

pub fn load_paper_sim_from_path(path: &Path) -> Result<Value, AppError> {
    if !path.exists() {
        return Ok(default_paper_sim_state());
    }
    let content = fs::read_to_string(path)
        .map_err(|error| AppError::internal(format!("paper sim file read failed: {error}")))?;
    let value: Value = serde_json::from_str(&content)
        .map_err(|error| AppError::invalid(format!("paper sim json parse failed: {error}")))?;
    Ok(paper_sim_from_storage_value(value))
}

pub fn save_paper_sim_to_path(path: &Path, state: Value) -> Result<Value, AppError> {
    let normalized = normalize_paper_sim_state_value(state);
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|error| {
            AppError::internal(format!("paper sim directory create failed: {error}"))
        })?;
    }
    let snapshot = PaperSimStoreSnapshot {
        version: 5,
        updated_at: Utc::now().to_rfc3339(),
        state: normalized.clone(),
    };
    let json = serde_json::to_string_pretty(&snapshot)
        .map_err(|error| AppError::internal(format!("paper sim serialize failed: {error}")))?;
    let temp_path = path.with_extension("json.tmp");
    fs::write(&temp_path, json)
        .map_err(|error| AppError::internal(format!("paper sim temp write failed: {error}")))?;
    fs::rename(&temp_path, path)
        .map_err(|error| AppError::internal(format!("paper sim file replace failed: {error}")))?;
    Ok(normalized)
}

pub fn export_order_audit_from_paths(
    orders_path: &Path,
    export_dir: &Path,
    request: OrderAuditExportRequest,
) -> Result<OrderAuditExportResult, AppError> {
    export_order_audit_from_paths_with_policy(orders_path, None, export_dir, request)
}

pub fn export_order_audit_from_paths_with_policy(
    orders_path: &Path,
    risk_policy_path: Option<&Path>,
    export_dir: &Path,
    request: OrderAuditExportRequest,
) -> Result<OrderAuditExportResult, AppError> {
    let orders = load_orders_from_path(orders_path)?;
    let risk_policy = risk_policy_path
        .map(load_risk_policy_from_path)
        .transpose()?;
    let format = normalize_audit_format(request.format);
    fs::create_dir_all(export_dir).map_err(|error| {
        AppError::internal(format!("order audit directory create failed: {error}"))
    })?;
    let exported_at = Utc::now();
    let events = count_order_events(&orders);
    let path = export_dir.join(format!(
        "order-audit-{}.{}",
        exported_at.format("%Y%m%d-%H%M%S"),
        format
    ));

    if format == "csv" {
        write_order_audit_csv(&path, &orders)?;
    } else {
        write_order_audit_json(
            &path,
            &orders,
            risk_policy,
            exported_at.to_rfc3339(),
            events,
        )?;
    }

    Ok(OrderAuditExportResult {
        path: path.display().to_string(),
        format,
        orders: orders.len(),
        events,
        exported_at: exported_at.to_rfc3339(),
        summary: format!("已导出 {} 条委托、{} 条事件", orders.len(), events),
    })
}

fn order_values_from_storage_value(value: Value) -> Result<Vec<Value>, AppError> {
    match value {
        Value::Array(orders) => Ok(normalize_order_values(orders)),
        Value::Object(mut object) => {
            let orders = object.remove("orders").ok_or_else(|| {
                AppError::invalid("orders storage object is missing orders array".to_string())
            })?;
            match orders {
                Value::Array(orders) => Ok(normalize_order_values(orders)),
                _ => Err(AppError::invalid(
                    "orders storage field orders must be an array".to_string(),
                )),
            }
        }
        _ => Err(AppError::invalid(
            "orders storage must be an array or snapshot object".to_string(),
        )),
    }
}

fn normalize_order_values(orders: Vec<Value>) -> Vec<Value> {
    orders
        .into_iter()
        .filter(|value| value.is_object())
        .take(200)
        .collect()
}

fn normalize_monitor_state_value(value: Value) -> Value {
    let (snapshot, records) = match value {
        Value::Object(mut object) => {
            let has_store_shape = object.contains_key("snapshot") || object.contains_key("records");
            if has_store_shape {
                let snapshot = object.remove("snapshot").filter(|value| value.is_object());
                let records = object
                    .remove("records")
                    .and_then(|value| value.as_array().cloned())
                    .unwrap_or_default();
                (snapshot, normalize_monitor_records(records))
            } else {
                (Some(Value::Object(object)), Vec::new())
            }
        }
        _ => (None, Vec::new()),
    };
    serde_json::json!({
        "version": 1,
        "updatedAt": Utc::now().to_rfc3339(),
        "snapshot": snapshot,
        "records": records,
    })
}

fn normalize_monitor_records(records: Vec<Value>) -> Vec<Value> {
    records
        .into_iter()
        .filter(|value| value.is_object())
        .take(500)
        .collect()
}

fn default_monitor_state() -> Value {
    serde_json::json!({
        "version": 1,
        "updatedAt": Utc::now().to_rfc3339(),
        "snapshot": null,
        "records": [],
    })
}

fn risk_policy_from_storage_value(value: Value) -> Value {
    match value {
        Value::Object(mut object) => {
            let policy = object
                .remove("policy")
                .filter(Value::is_object)
                .unwrap_or(Value::Object(object));
            normalize_risk_policy_value(policy)
        }
        _ => default_risk_policy_value(),
    }
}

fn normalize_risk_policy_value(value: Value) -> Value {
    let object = value.as_object();
    let single_caps = object
        .and_then(|item| item.get("singleOrderCaps"))
        .and_then(Value::as_object);
    let loss_brake = object
        .and_then(|item| item.get("lossBrake"))
        .and_then(Value::as_object);
    serde_json::json!({
        "version": 2,
        "updatedAt": object
            .and_then(|item| item.get("updatedAt"))
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .unwrap_or("")
            .to_string(),
        "maxDailyOrders": risk_i64(object.and_then(|item| item.get("maxDailyOrders")), 8, 0, 200),
        "cooldownMinutes": risk_f64(object.and_then(|item| item.get("cooldownMinutes")), 30.0, 0.0, 1440.0),
        "requireLiveConfirmation": object
            .and_then(|item| item.get("requireLiveConfirmation"))
            .and_then(Value::as_bool)
            .unwrap_or(true),
        "singleOrderCaps": {
            "etfPct": risk_f64(single_caps.and_then(|item| item.get("etfPct")), 5.0, 0.1, 50.0),
            "fundPct": risk_f64(single_caps.and_then(|item| item.get("fundPct")), 4.0, 0.1, 50.0),
            "leveragedEtfPct": risk_f64(single_caps.and_then(|item| item.get("leveragedEtfPct")), 1.0, 0.1, 20.0),
            "otherPct": risk_f64(single_caps.and_then(|item| item.get("otherPct")), 2.0, 0.1, 50.0),
            "stockPct": risk_f64(single_caps.and_then(|item| item.get("stockPct")), 3.0, 0.1, 50.0),
        },
        "lossBrake": {
            "etfDailyDropBlockPct": risk_f64(loss_brake.and_then(|item| item.get("etfDailyDropBlockPct")), 7.0, 0.0, 50.0),
            "etfDailyDropWarnPct": risk_f64(loss_brake.and_then(|item| item.get("etfDailyDropWarnPct")), 4.0, 0.0, 50.0),
            "leveragedEtfDailyDropBlockPct": risk_f64(loss_brake.and_then(|item| item.get("leveragedEtfDailyDropBlockPct")), 4.0, 0.0, 50.0),
            "portfolioDailyLossPct": risk_f64(loss_brake.and_then(|item| item.get("portfolioDailyLossPct")), 3.5, 0.0, 50.0),
        },
    })
}

fn default_risk_policy_value() -> Value {
    normalize_risk_policy_value(serde_json::json!({}))
}

fn paper_sim_from_storage_value(value: Value) -> Value {
    match value {
        Value::Object(mut object) => {
            let state = object
                .remove("state")
                .filter(Value::is_object)
                .unwrap_or(Value::Object(object));
            normalize_paper_sim_state_value(state)
        }
        _ => default_paper_sim_state(),
    }
}

fn normalize_paper_sim_state_value(value: Value) -> Value {
    let mut object = match value {
        Value::Object(object) => object,
        _ => return default_paper_sim_state(),
    };
    object.insert("version".to_string(), serde_json::json!(5));
    insert_default_bool(&mut object, "active", false);
    insert_default_string(&mut object, "accountId", "paper-sim");
    insert_default_string(&mut object, "experimentName", "自动模拟实验");
    insert_default_string(&mut object, "profileKey", "");
    insert_default_string(&mut object, "profileName", "");
    insert_default_string(&mut object, "strategyKey", "");
    insert_default_string(&mut object, "strategyName", "");
    insert_default_string(&mut object, "presetKey", "");
    insert_default_string(&mut object, "presetLabel", "");
    insert_default_string(&mut object, "currency", "CNY");
    insert_default_number(&mut object, "initialCapital", 0.0);
    insert_default_number(&mut object, "cash", 0.0);
    insert_default_string(&mut object, "startedAt", "");
    insert_default_string(&mut object, "updatedAt", &Utc::now().to_rfc3339());
    insert_default_string(&mut object, "lastRunDate", "");
    insert_default_string(&mut object, "nextRunHint", "等待启动");
    normalize_object_array_field(&mut object, "positions", 500);
    normalize_object_array_field(&mut object, "pendingFundOrders", 200);
    normalize_object_array_field(&mut object, "trades", 500);
    normalize_object_array_field(&mut object, "snapshots", 260);
    Value::Object(object)
}

fn default_paper_sim_state() -> Value {
    normalize_paper_sim_state_value(serde_json::json!({
        "version": 5,
        "active": false,
        "accountId": "paper-sim",
        "experimentName": "自动模拟实验",
        "profileKey": "",
        "profileName": "",
        "strategyKey": "",
        "strategyName": "",
        "presetKey": "",
        "presetLabel": "",
        "currency": "CNY",
        "initialCapital": 0,
        "cash": 0,
        "positions": [],
        "pendingFundOrders": [],
        "trades": [],
        "snapshots": [],
        "startedAt": "",
        "updatedAt": Utc::now().to_rfc3339(),
        "lastRunDate": "",
        "nextRunHint": "等待启动",
    }))
}

fn normalize_object_array_field(
    object: &mut serde_json::Map<String, Value>,
    key: &str,
    limit: usize,
) {
    let values = object
        .remove(key)
        .and_then(|value| value.as_array().cloned())
        .unwrap_or_default()
        .into_iter()
        .filter(Value::is_object)
        .take(limit)
        .collect();
    object.insert(key.to_string(), Value::Array(values));
}

fn insert_default_string(object: &mut serde_json::Map<String, Value>, key: &str, fallback: &str) {
    let valid = object.get(key).and_then(Value::as_str).is_some();
    if !valid {
        object.insert(key.to_string(), Value::String(fallback.to_string()));
    }
}

fn insert_default_bool(object: &mut serde_json::Map<String, Value>, key: &str, fallback: bool) {
    if !object.get(key).and_then(Value::as_bool).is_some() {
        object.insert(key.to_string(), Value::Bool(fallback));
    }
}

fn insert_default_number(object: &mut serde_json::Map<String, Value>, key: &str, fallback: f64) {
    let valid = object
        .get(key)
        .and_then(Value::as_f64)
        .filter(|value| value.is_finite())
        .is_some();
    if !valid {
        object.insert(key.to_string(), serde_json::json!(fallback));
    }
}

fn risk_f64(value: Option<&Value>, fallback: f64, min: f64, max: f64) -> f64 {
    value
        .and_then(Value::as_f64)
        .filter(|candidate| candidate.is_finite())
        .map(|candidate| candidate.clamp(min, max))
        .unwrap_or(fallback)
}

fn risk_i64(value: Option<&Value>, fallback: i64, min: i64, max: i64) -> i64 {
    value
        .and_then(Value::as_i64)
        .map(|candidate| candidate.clamp(min, max))
        .unwrap_or(fallback)
}

fn normalize_audit_format(format: Option<String>) -> String {
    match format
        .unwrap_or_else(|| "json".to_string())
        .trim()
        .to_lowercase()
        .as_str()
    {
        "csv" => "csv".to_string(),
        _ => "json".to_string(),
    }
}

fn count_order_events(orders: &[Value]) -> usize {
    orders
        .iter()
        .map(|order| {
            order
                .get("events")
                .and_then(Value::as_array)
                .map(Vec::len)
                .unwrap_or(0)
        })
        .sum()
}

fn write_order_audit_json(
    path: &Path,
    orders: &[Value],
    risk_policy: Option<Value>,
    exported_at: String,
    events: usize,
) -> Result<(), AppError> {
    let payload = serde_json::json!({
        "version": 1,
        "exportedAt": exported_at,
        "summary": {
            "orders": orders.len(),
            "events": events,
        },
        "riskPolicy": risk_policy,
        "orders": orders,
    });
    let json = serde_json::to_string_pretty(&payload).map_err(|error| {
        AppError::internal(format!("order audit json serialize failed: {error}"))
    })?;
    atomic_write(path, json.as_bytes(), "order audit json")
}

fn write_order_audit_csv(path: &Path, orders: &[Value]) -> Result<(), AppError> {
    let mut writer = csv::Writer::from_writer(Vec::new());
    writer
        .write_record([
            "account_id",
            "decision_id",
            "order_id",
            "intent_key",
            "symbol",
            "name",
            "side",
            "status",
            "route_status",
            "broker",
            "route",
            "order_ref",
            "source_kind",
            "source_label",
            "profile_key",
            "profile_name",
            "strategy_key",
            "strategy_name",
            "preset_key",
            "preset_label",
            "amount",
            "weight",
            "quantity",
            "limit",
            "state",
            "created_at",
            "created_iso",
            "updated_at",
            "updated_iso",
            "submitted_at",
            "filled_at",
            "last_error",
            "warnings",
            "event_key",
            "event_at",
            "event_time",
            "event_type",
            "event_status",
            "event_label",
            "event_detail",
        ])
        .map_err(|error| AppError::internal(format!("order audit csv header failed: {error}")))?;

    for order in orders {
        let events = order.get("events").and_then(Value::as_array);
        if let Some(events) = events.filter(|items| !items.is_empty()) {
            for event in events {
                write_order_audit_csv_row(&mut writer, order, Some(event))?;
            }
        } else {
            write_order_audit_csv_row(&mut writer, order, None)?;
        }
    }

    let bytes = writer
        .into_inner()
        .map_err(|error| AppError::internal(format!("order audit csv finalize failed: {error}")))?;
    atomic_write(path, &bytes, "order audit csv")
}

fn write_order_audit_csv_row(
    writer: &mut csv::Writer<Vec<u8>>,
    order: &Value,
    event: Option<&Value>,
) -> Result<(), AppError> {
    writer
        .write_record([
            value_field(order, "accountId"),
            value_field(order, "decisionId"),
            value_field(order, "id"),
            value_field(order, "intentKey"),
            value_field(order, "symbol"),
            value_field(order, "name"),
            value_field(order, "side"),
            value_field(order, "status"),
            value_field(order, "routeStatus"),
            value_field(order, "broker"),
            value_field(order, "route"),
            value_field(order, "orderRef"),
            value_field(order, "sourceKind"),
            value_field(order, "sourceLabel"),
            value_field(order, "profileKey"),
            value_field(order, "profileName"),
            value_field(order, "strategyKey"),
            value_field(order, "strategyName"),
            value_field(order, "presetKey"),
            value_field(order, "presetLabel"),
            value_field(order, "amount"),
            value_field(order, "weight"),
            value_field(order, "quantity"),
            value_field(order, "limit"),
            value_field(order, "state"),
            value_field(order, "createdAt"),
            value_field(order, "createdIso"),
            value_field(order, "updatedAt"),
            value_field(order, "updatedIso"),
            value_field(order, "submittedAt"),
            value_field(order, "filledAt"),
            value_field(order, "lastError"),
            warnings_field(order),
            event
                .map(|value| value_field(value, "key"))
                .unwrap_or_default(),
            event
                .map(|value| value_field(value, "at"))
                .unwrap_or_default(),
            event
                .map(|value| value_field(value, "time"))
                .unwrap_or_default(),
            event
                .map(|value| value_field(value, "type"))
                .unwrap_or_default(),
            event
                .map(|value| value_field(value, "status"))
                .unwrap_or_default(),
            event
                .map(|value| value_field(value, "label"))
                .unwrap_or_default(),
            event
                .map(|value| value_field(value, "detail"))
                .unwrap_or_default(),
        ])
        .map_err(|error| AppError::internal(format!("order audit csv row failed: {error}")))
}

fn atomic_write(path: &Path, bytes: &[u8], label: &str) -> Result<(), AppError> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|error| {
            AppError::internal(format!("{label} directory create failed: {error}"))
        })?;
    }
    let temp_path = path.with_extension(format!(
        "{}.tmp",
        path.extension()
            .and_then(|extension| extension.to_str())
            .unwrap_or("tmp")
    ));
    fs::write(&temp_path, bytes)
        .map_err(|error| AppError::internal(format!("{label} temp write failed: {error}")))?;
    fs::rename(&temp_path, path)
        .map_err(|error| AppError::internal(format!("{label} file replace failed: {error}")))
}

fn value_field(value: &Value, key: &str) -> String {
    value.get(key).map(value_to_cell).unwrap_or_default()
}

fn warnings_field(order: &Value) -> String {
    order
        .get("warnings")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .map(value_to_cell)
                .collect::<Vec<_>>()
                .join(" | ")
        })
        .unwrap_or_default()
}

fn value_to_cell(value: &Value) -> String {
    match value {
        Value::Null => String::new(),
        Value::String(text) => text.clone(),
        Value::Bool(value) => value.to_string(),
        Value::Number(value) => value.to_string(),
        _ => serde_json::to_string(value).unwrap_or_default(),
    }
}

pub fn probe_broker_bridge(request: BrokerBridgeProbeRequest) -> Vec<BrokerBridgeStatus> {
    let bridge = request.bridge.as_deref().map(normalize_bridge_key);
    let qbot_path = request
        .qbot_path
        .filter(|value| !value.trim().is_empty())
        .or_else(|| std::env::var("RPORTFOLIO_QBOT_PATH").ok())
        .unwrap_or_else(|| default_bridge_workspace("Qbot"));
    let vnpy_path = request
        .vnpy_path
        .filter(|value| !value.trim().is_empty())
        .or_else(|| std::env::var("RPORTFOLIO_VNPY_PATH").ok())
        .unwrap_or_else(|| default_bridge_workspace("vnpy"));
    let python = request
        .python
        .filter(|value| !value.trim().is_empty())
        .or_else(|| std::env::var("RPORTFOLIO_PYTHON").ok())
        .unwrap_or_else(|| "python3".to_string());
    let python_ok = python_available(&python);

    let mut statuses = Vec::new();
    if bridge.as_deref().is_none() || bridge.as_deref() == Some("qbot") {
        statuses.push(qbot_bridge_status(&qbot_path, &python, python_ok));
    }
    if bridge.as_deref().is_none() || bridge.as_deref() == Some("vnpy") {
        statuses.push(vnpy_bridge_status(&vnpy_path, &python, python_ok));
    }
    statuses
}

pub fn route_quant_order(request: QuantOrderRouteRequest) -> QuantOrderRouteResult {
    let bridge = normalize_bridge_key(&request.bridge);
    let live_enabled = broker_live_enabled(request.allow_live);
    let status = probe_broker_bridge(BrokerBridgeProbeRequest {
        bridge: Some(bridge.clone()),
        qbot_path: None,
        vnpy_path: None,
        python: None,
    })
    .into_iter()
    .next();

    if bridge == "local-paper" {
        return QuantOrderRouteResult {
            accepted: true,
            submitted: false,
            bridge,
            route: "Local Paper".to_string(),
            status: "queued".to_string(),
            order_ref: order_ref("paper", &request.symbol),
            message: format!(
                "Local Paper queued {} {} @ {}",
                request.side, request.symbol, request.limit
            ),
            warnings: Vec::new(),
            command_preview: Vec::new(),
        };
    }

    let Some(status) = status else {
        return QuantOrderRouteResult {
            accepted: false,
            submitted: false,
            bridge,
            route: "unknown".to_string(),
            status: "missing_bridge".to_string(),
            order_ref: order_ref("missing", &request.symbol),
            message: "bridge is not supported".to_string(),
            warnings: vec!["只支持 local-paper、qbot、vnpy。".to_string()],
            command_preview: Vec::new(),
        };
    };

    let mut warnings = status.warnings.clone();
    let mut command_preview = status.command_preview.clone();
    command_preview.push(format!(
        "order {} {} qty={} limit={} amount={} weight={} strategy={}",
        request.side,
        request.symbol,
        request.quantity,
        request.limit,
        request.amount,
        request.weight,
        request.strategy
    ));

    if !status.command_available {
        return QuantOrderRouteResult {
            accepted: false,
            submitted: false,
            bridge,
            route: status.route_label,
            status: "missing_adapter".to_string(),
            order_ref: order_ref("adapter", &request.symbol),
            message: format!("{} adapter is not ready", status.label),
            warnings,
            command_preview,
        };
    }

    if !live_enabled {
        warnings.push(
            "Rust command 已经完成桥接路由；设置 RPORTFOLIO_BROKER_LIVE=1 并补齐账户配置后可放开真实提交。"
                .to_string(),
        );
        return QuantOrderRouteResult {
            accepted: true,
            submitted: false,
            bridge,
            route: status.route_label,
            status: if request.risk_override {
                "prepared_override".to_string()
            } else {
                "prepared".to_string()
            },
            order_ref: order_ref("prepared", &request.symbol),
            message: format!(
                "{} prepared {} {} via {}",
                request.broker_mode, request.side, request.symbol, request.platform
            ),
            warnings,
            command_preview,
        };
    }

    warnings.push(
        "Live flag 已开启，但当前版本只完成 adapter handoff；真实成交回报需要下一步接入账户回调。"
            .to_string(),
    );
    QuantOrderRouteResult {
        accepted: true,
        submitted: false,
        bridge,
        route: status.route_label,
        status: "ready_to_submit".to_string(),
        order_ref: order_ref("live", &request.symbol),
        message: format!(
            "live adapter ready for {} {} {}",
            request.trade_type, request.side, request.symbol
        ),
        warnings,
        command_preview,
    }
}

pub fn prepare_order(request: OrderCommandRequest) -> OrderCommandResult {
    let route = route_quant_order(route_request_from_order_command(&request));
    command_result_from_route("prepareOrder", &request, route)
}

pub fn submit_order(request: OrderCommandRequest) -> OrderCommandResult {
    broker_order_command("submitOrder", request)
}

pub fn cancel_order(request: OrderCommandRequest) -> OrderCommandResult {
    broker_order_command("cancelOrder", request)
}

pub fn sync_order_status(request: OrderCommandRequest) -> OrderCommandResult {
    broker_order_command("syncOrderStatus", request)
}

pub fn sync_account(request: BrokerAccountSyncRequest) -> BrokerAccountSnapshot {
    let bridge = normalize_bridge_key(&request.bridge);
    if bridge == "local-paper" {
        return BrokerAccountSnapshot {
            accepted: true,
            bridge,
            route: "Local Paper".to_string(),
            status: "synced".to_string(),
            account_id: "local-paper".to_string(),
            account_name: "本地模拟账户".to_string(),
            currency: "CNY".to_string(),
            synced_at: Utc::now().to_rfc3339(),
            message: "Local Paper account snapshot is local-only; use order center for simulated lifecycle.".to_string(),
            ..BrokerAccountSnapshot::default()
        };
    }

    let status = probe_broker_bridge(BrokerBridgeProbeRequest {
        bridge: Some(bridge.clone()),
        qbot_path: None,
        vnpy_path: None,
        python: None,
    })
    .into_iter()
    .next();

    let Some(status) = status else {
        return BrokerAccountSnapshot {
            accepted: false,
            bridge,
            route: "unknown".to_string(),
            status: "missing_bridge".to_string(),
            synced_at: Utc::now().to_rfc3339(),
            message: "bridge is not supported".to_string(),
            warnings: vec!["只支持 local-paper、qbot、vnpy。".to_string()],
            ..BrokerAccountSnapshot::default()
        };
    };

    let mut warnings = status.warnings.clone();
    let mut command_preview = status.command_preview.clone();
    command_preview.push(format!(
        "syncAccount platform={} tradeType={} strategy={}",
        request.platform, request.trade_type, request.strategy
    ));

    if !status.command_available {
        return BrokerAccountSnapshot {
            accepted: false,
            bridge,
            route: status.route_label,
            status: "missing_adapter".to_string(),
            synced_at: Utc::now().to_rfc3339(),
            message: format!("{} adapter is not ready", status.label),
            warnings,
            command_preview,
            ..BrokerAccountSnapshot::default()
        };
    }

    match run_account_adapter(&request, &bridge, &status.route_label) {
        Ok(mut snapshot) => {
            snapshot.accepted = snapshot.accepted || snapshot.status == "synced";
            if snapshot.bridge.trim().is_empty() {
                snapshot.bridge = bridge;
            }
            if snapshot.route.trim().is_empty() {
                snapshot.route = status.route_label;
            }
            if snapshot.status.trim().is_empty() {
                snapshot.status = "synced".to_string();
            }
            if snapshot.synced_at.trim().is_empty() {
                snapshot.synced_at = Utc::now().to_rfc3339();
            }
            if snapshot.settled_cash.is_none() {
                snapshot.settled_cash = Some(snapshot.cash);
            }
            if snapshot.available_cash.is_none() {
                snapshot.available_cash = Some(snapshot.cash);
            }
            if snapshot.pending_settlement.is_none() {
                snapshot.pending_settlement = Some(0.0);
            }
            if snapshot.message.trim().is_empty() {
                snapshot.message = format!(
                    "{} account sync complete: {} positions, {} orders, {} trades",
                    status.label,
                    snapshot.positions.len(),
                    snapshot.orders.len(),
                    snapshot.trades.len()
                );
            }
            warnings.extend(snapshot.warnings.clone());
            command_preview.extend(snapshot.command_preview.clone());
            snapshot.warnings = warnings;
            snapshot.command_preview = command_preview;
            snapshot
        }
        Err(message) => {
            warnings.push(message.clone());
            BrokerAccountSnapshot {
                accepted: false,
                bridge,
                route: status.route_label,
                status: "adapter_error".to_string(),
                synced_at: Utc::now().to_rfc3339(),
                message,
                warnings,
                command_preview,
                ..BrokerAccountSnapshot::default()
            }
        }
    }
}

pub fn sync_market_quote(request: MarketQuoteRequest) -> MarketQuoteSnapshot {
    let bridge = normalize_bridge_key(&request.bridge);
    if bridge == "local-paper" {
        return local_paper_market_quote(&request, bridge);
    }

    let status = probe_broker_bridge(BrokerBridgeProbeRequest {
        bridge: Some(bridge.clone()),
        qbot_path: None,
        vnpy_path: None,
        python: None,
    })
    .into_iter()
    .next();

    let Some(status) = status else {
        return MarketQuoteSnapshot {
            accepted: false,
            bridge,
            route: "unknown".to_string(),
            status: "missing_bridge".to_string(),
            symbol: request.symbol,
            name: request.name,
            market: request.market,
            asset_type: request.asset_type.unwrap_or_default(),
            synced_at: Utc::now().to_rfc3339(),
            message: "bridge is not supported".to_string(),
            warnings: vec!["只支持 local-paper、qbot、vnpy。".to_string()],
            ..MarketQuoteSnapshot::default()
        };
    };

    let mut warnings = status.warnings.clone();
    let mut command_preview = status.command_preview.clone();
    command_preview.push(format!(
        "syncMarketQuote symbol={} market={} tradeType={} strategy={}",
        request.symbol, request.market, request.trade_type, request.strategy
    ));

    if !status.command_available {
        return MarketQuoteSnapshot {
            accepted: false,
            bridge,
            route: status.route_label,
            status: "missing_adapter".to_string(),
            symbol: request.symbol,
            name: request.name,
            market: request.market,
            asset_type: request.asset_type.unwrap_or_default(),
            synced_at: Utc::now().to_rfc3339(),
            message: format!("{} market data adapter is not ready", status.label),
            warnings,
            command_preview,
            ..MarketQuoteSnapshot::default()
        };
    }

    match run_market_quote_adapter(&request, &bridge, &status.route_label) {
        Ok(mut quote) => {
            quote.accepted = quote.accepted || quote.status == "synced";
            if quote.bridge.trim().is_empty() {
                quote.bridge = bridge;
            }
            if quote.route.trim().is_empty() {
                quote.route = status.route_label;
            }
            if quote.status.trim().is_empty() {
                quote.status = "synced".to_string();
            }
            if quote.symbol.trim().is_empty() {
                quote.symbol = request.symbol;
            }
            if quote.name.trim().is_empty() {
                quote.name = request.name;
            }
            if quote.market.trim().is_empty() {
                quote.market = request.market;
            }
            if quote.asset_type.trim().is_empty() {
                quote.asset_type = request.asset_type.unwrap_or_default();
            }
            if quote.synced_at.trim().is_empty() {
                quote.synced_at = Utc::now().to_rfc3339();
            }
            if quote.message.trim().is_empty() {
                quote.message =
                    format!("{} market quote synced for {}", status.label, quote.symbol);
            }
            warnings.extend(quote.warnings.clone());
            command_preview.extend(quote.command_preview.clone());
            quote.warnings = warnings;
            quote.command_preview = command_preview;
            quote
        }
        Err(message) => {
            warnings.push(message.clone());
            MarketQuoteSnapshot {
                accepted: false,
                bridge,
                route: status.route_label,
                status: "adapter_error".to_string(),
                symbol: request.symbol,
                name: request.name,
                market: request.market,
                asset_type: request.asset_type.unwrap_or_default(),
                synced_at: Utc::now().to_rfc3339(),
                message,
                warnings,
                command_preview,
                ..MarketQuoteSnapshot::default()
            }
        }
    }
}

pub async fn sync_realtime_asset_quote(
    request: RealtimeAssetQuoteRequest,
) -> RealtimeAssetQuoteSnapshot {
    let symbol = request.symbol.trim().to_uppercase();
    if symbol.is_empty() {
        return fallback_realtime_asset_quote(request, "symbol is required");
    }
    let yahoo_symbol = realtime_yahoo_symbol(&symbol, &request.market);
    let mut headers = HeaderMap::new();
    headers.insert(
        ACCEPT,
        HeaderValue::from_static("application/json,text/plain,*/*"),
    );
    headers.insert(ACCEPT_LANGUAGE, HeaderValue::from_static("en-US,en;q=0.9"));
    headers.insert(
        REFERER,
        HeaderValue::from_static("https://finance.yahoo.com/"),
    );
    let client = match market_client_builder()
        .user_agent(YAHOO_USER_AGENT)
        .default_headers(headers)
        .build()
    {
        Ok(client) => client,
        Err(error) => return fallback_realtime_asset_quote(request, &error.to_string()),
    };

    let encoded_symbol = encode_url_path_segment(&yahoo_symbol);
    let mut last_error = None;
    for host in YAHOO_CHART_HOSTS {
        let url = format!("https://{host}/v8/finance/chart/{encoded_symbol}");
        let response = match client
            .get(&url)
            .query(&[
                ("range", "1d"),
                ("interval", "1m"),
                ("includePrePost", "true"),
            ])
            .send()
            .await
        {
            Ok(response) => response,
            Err(error) => {
                last_error = Some(error.to_string());
                continue;
            }
        };
        let response = match response.error_for_status() {
            Ok(response) => response,
            Err(error) => {
                last_error = Some(error.to_string());
                continue;
            }
        };
        let value: Value = match response.json().await {
            Ok(value) => value,
            Err(error) => {
                last_error = Some(error.to_string());
                continue;
            }
        };
        match parse_yahoo_realtime_quote(&value, &request, &symbol, &yahoo_symbol) {
            Ok(snapshot) => return snapshot,
            Err(error) => {
                last_error = Some(error.message);
                continue;
            }
        }
    }

    fallback_realtime_asset_quote(
        request,
        &last_error.unwrap_or_else(|| "Yahoo realtime quote unavailable".to_string()),
    )
}

fn broker_order_command(action: &str, request: OrderCommandRequest) -> OrderCommandResult {
    let bridge = normalize_bridge_key(&request.bridge);
    if bridge == "local-paper" {
        return local_paper_order_command(action, &request, bridge);
    }

    let status = probe_broker_bridge(BrokerBridgeProbeRequest {
        bridge: Some(bridge.clone()),
        qbot_path: None,
        vnpy_path: None,
        python: None,
    })
    .into_iter()
    .next();

    let Some(status) = status else {
        return order_command_result(OrderCommandResultInput {
            accepted: false,
            action,
            bridge,
            command_preview: Vec::new(),
            event_label: "通道缺失",
            message: "bridge is not supported".to_string(),
            order_ref: command_order_ref(&request, "missing"),
            request: &request,
            route: "unknown".to_string(),
            status: "missing_bridge".to_string(),
            submitted: false,
            warnings: vec!["只支持 local-paper、qbot、vnpy。".to_string()],
        });
    };

    let mut warnings = status.warnings.clone();
    let mut command_preview = status.command_preview.clone();
    command_preview.push(order_command_preview(action, &request));

    if !status.command_available {
        return order_command_result(OrderCommandResultInput {
            accepted: false,
            action,
            bridge,
            command_preview,
            event_label: "通道未就绪",
            message: format!("{} adapter is not ready", status.label),
            order_ref: command_order_ref(&request, "adapter"),
            request: &request,
            route: status.route_label,
            status: "missing_adapter".to_string(),
            submitted: false,
            warnings,
        });
    }

    if action != "syncOrderStatus" && !broker_live_enabled(request.allow_live) {
        warnings.push(
            "提交/撤单命令已进入 Rust command；设置 RPORTFOLIO_BROKER_LIVE=1 并补齐账户配置后才会放给真实 adapter。"
                .to_string(),
        );
        return order_command_result(OrderCommandResultInput {
            accepted: false,
            action,
            bridge,
            command_preview,
            event_label: "实盘未启用",
            message: format!("{} live command is not enabled", status.label),
            order_ref: command_order_ref(&request, "disabled"),
            request: &request,
            route: status.route_label,
            status: "live_disabled".to_string(),
            submitted: false,
            warnings,
        });
    }

    match run_broker_adapter(action, &request, &bridge, &status.route_label) {
        Ok(adapter) => {
            warnings.extend(adapter.warnings.clone());
            command_preview.extend(adapter.command_preview.clone());
            order_command_result(OrderCommandResultInput {
                accepted: adapter.accepted,
                action,
                bridge,
                command_preview,
                event_label: if adapter.event_label.is_empty() {
                    adapter_event_label(action, &adapter.status, adapter.accepted)
                } else {
                    &adapter.event_label
                },
                message: if adapter.message.is_empty() {
                    format!("{} adapter command completed", status.label)
                } else {
                    adapter.message
                },
                order_ref: if adapter.order_ref.is_empty() {
                    command_order_ref(&request, adapter_ref_prefix(action))
                } else {
                    adapter.order_ref
                },
                request: &request,
                route: status.route_label,
                status: if adapter.status.is_empty() {
                    adapter_status_fallback(action, adapter.accepted)
                } else {
                    adapter.status
                },
                submitted: adapter.submitted,
                warnings,
            })
        }
        Err(message) => {
            warnings.push(message.clone());
            order_command_result(OrderCommandResultInput {
                accepted: false,
                action,
                bridge,
                command_preview,
                event_label: "adapter 调用失败",
                message,
                order_ref: command_order_ref(&request, "adapter-error"),
                request: &request,
                route: status.route_label,
                status: "adapter_error".to_string(),
                submitted: false,
                warnings,
            })
        }
    }
}

struct OrderCommandResultInput<'a> {
    accepted: bool,
    action: &'a str,
    bridge: String,
    command_preview: Vec<String>,
    event_label: &'a str,
    message: String,
    order_ref: String,
    request: &'a OrderCommandRequest,
    route: String,
    status: String,
    submitted: bool,
    warnings: Vec<String>,
}

fn command_result_from_route(
    action: &str,
    request: &OrderCommandRequest,
    route: QuantOrderRouteResult,
) -> OrderCommandResult {
    let event_label = match route.status.as_str() {
        "queued" => "已排队",
        "prepared" | "prepared_override" => "已预备",
        "ready_to_submit" => "通道就绪",
        "submitted" => "已提交",
        "missing_adapter" | "missing_bridge" | "route_error" => "路由失败",
        _ => "命令回写",
    };
    order_command_result(OrderCommandResultInput {
        accepted: route.accepted,
        action,
        bridge: route.bridge,
        command_preview: route.command_preview,
        event_label,
        message: route.message,
        order_ref: route.order_ref,
        request,
        route: route.route,
        status: route.status,
        submitted: route.submitted,
        warnings: route.warnings,
    })
}

fn local_paper_order_command(
    action: &str,
    request: &OrderCommandRequest,
    bridge: String,
) -> OrderCommandResult {
    let status = match action {
        "submitOrder" => "submitted".to_string(),
        "cancelOrder" => "cancelled".to_string(),
        "syncOrderStatus" => request
            .current_status
            .as_ref()
            .filter(|value| !value.trim().is_empty())
            .cloned()
            .unwrap_or_else(|| "queued".to_string()),
        _ => "queued".to_string(),
    };
    let (event_label, message, prefix, submitted) = match action {
        "submitOrder" => (
            "已提交",
            format!("Local Paper submitted {} {}", request.side, request.symbol),
            "paper-submit",
            true,
        ),
        "cancelOrder" => (
            "已撤单",
            format!("Local Paper cancelled {} {}", request.side, request.symbol),
            "paper-cancel",
            false,
        ),
        "syncOrderStatus" => (
            "状态同步",
            format!("Local Paper synced {} {}", request.side, request.symbol),
            "paper-sync",
            false,
        ),
        _ => (
            "已排队",
            format!("Local Paper queued {} {}", request.side, request.symbol),
            "paper",
            false,
        ),
    };

    order_command_result(OrderCommandResultInput {
        accepted: true,
        action,
        bridge,
        command_preview: Vec::new(),
        event_label,
        message,
        order_ref: command_order_ref(request, prefix),
        request,
        route: "Local Paper".to_string(),
        status,
        submitted,
        warnings: Vec::new(),
    })
}

fn local_paper_market_quote(request: &MarketQuoteRequest, bridge: String) -> MarketQuoteSnapshot {
    let reference = request.reference_price.unwrap_or_default();
    let (bid, ask, last) = if reference.is_finite() && reference > 0.0 {
        (
            Some(round_price(reference * 0.999)),
            Some(round_price(reference * 1.001)),
            Some(round_price(reference)),
        )
    } else {
        (None, None, None)
    };
    MarketQuoteSnapshot {
        accepted: true,
        bridge,
        route: "Local Paper".to_string(),
        status: "synced".to_string(),
        symbol: request.symbol.clone(),
        name: request.name.clone(),
        market: request.market.clone(),
        asset_type: request.asset_type.clone().unwrap_or_default(),
        bid,
        ask,
        last,
        session: "unknown".to_string(),
        source: "local-paper".to_string(),
        synced_at: Utc::now().to_rfc3339(),
        message: "Local Paper quote uses current holding/reference price for limit protection."
            .to_string(),
        ..MarketQuoteSnapshot::default()
    }
}

fn order_command_result(input: OrderCommandResultInput<'_>) -> OrderCommandResult {
    OrderCommandResult {
        accepted: input.accepted,
        submitted: input.submitted,
        bridge: input.bridge,
        route: input.route,
        status: input.status,
        order_ref: input.order_ref,
        message: input.message,
        warnings: input.warnings,
        command_preview: input.command_preview,
        action: input.action.to_string(),
        order_id: input
            .request
            .order_id
            .as_ref()
            .filter(|value| !value.trim().is_empty())
            .cloned()
            .unwrap_or_else(|| order_ref("order", &input.request.symbol)),
        event_label: input.event_label.to_string(),
    }
}

fn route_request_from_order_command(request: &OrderCommandRequest) -> QuantOrderRouteRequest {
    QuantOrderRouteRequest {
        bridge: request.bridge.clone(),
        broker_mode: request.broker_mode.clone(),
        symbol: request.symbol.clone(),
        name: request.name.clone(),
        side: request.side.clone(),
        quantity: request.quantity.clone(),
        limit: request.limit.clone(),
        amount: request.amount.clone(),
        weight: request.weight.clone(),
        strategy: request.strategy.clone(),
        platform: request.platform.clone(),
        trade_type: request.trade_type.clone(),
        risk_override: request.risk_override,
        allow_live: request.allow_live,
    }
}

fn broker_live_enabled(allow_live: Option<bool>) -> bool {
    allow_live.unwrap_or(false)
        && std::env::var("RPORTFOLIO_BROKER_LIVE")
            .map(|value| value == "1" || value.eq_ignore_ascii_case("true"))
            .unwrap_or(false)
}

fn command_order_ref(request: &OrderCommandRequest, prefix: &str) -> String {
    request
        .order_ref
        .as_ref()
        .filter(|value| !value.trim().is_empty())
        .cloned()
        .unwrap_or_else(|| order_ref(prefix, &request.symbol))
}

fn order_command_preview(action: &str, request: &OrderCommandRequest) -> String {
    format!(
        "{} {} {} qty={} limit={} amount={} weight={} strategy={} ref={}",
        action,
        request.side,
        request.symbol,
        request.quantity,
        request.limit,
        request.amount,
        request.weight,
        request.strategy,
        command_order_ref(request, "preview")
    )
}

fn run_broker_adapter(
    action: &str,
    request: &OrderCommandRequest,
    bridge: &str,
    route_label: &str,
) -> Result<BrokerAdapterResponse, String> {
    let script = adapter_script_for(bridge)
        .ok_or_else(|| format!("unsupported broker adapter bridge: {bridge}"))?;
    let python = resolved_python();
    let workspace_path = resolved_bridge_path(bridge);
    let payload = serde_json::json!({
        "action": action,
        "bridge": bridge,
        "route": route_label,
        "workspacePath": workspace_path,
        "generatedAt": Utc::now().to_rfc3339(),
        "request": request,
    });
    let payload_text = serde_json::to_string(&payload)
        .map_err(|error| format!("cannot serialize broker adapter payload: {error}"))?;
    let mut command = Command::new(&python);
    command
        .arg("-c")
        .arg(script)
        .arg(action)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let workspace = PathBuf::from(&workspace_path);
    if workspace.exists() {
        command.current_dir(&workspace);
        command.env("PYTHONPATH", python_path_with_workspace(&workspace_path));
    }

    let mut child = command
        .spawn()
        .map_err(|error| format!("cannot start {bridge} adapter with {python}: {error}"))?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(payload_text.as_bytes())
            .map_err(|error| format!("cannot write broker adapter payload: {error}"))?;
    }
    let output = child
        .wait_with_output()
        .map_err(|error| format!("cannot read broker adapter output: {error}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

    if !output.status.success() {
        return Err(if stderr.is_empty() {
            format!("{bridge} adapter exited with {}", output.status)
        } else {
            stderr
        });
    }

    let mut response = parse_adapter_response(&stdout)?;
    if !stderr.is_empty() {
        response.warnings.push(stderr);
    }
    Ok(response)
}

fn run_account_adapter(
    request: &BrokerAccountSyncRequest,
    bridge: &str,
    route_label: &str,
) -> Result<BrokerAccountSnapshot, String> {
    let script = adapter_script_for(bridge)
        .ok_or_else(|| format!("unsupported broker adapter bridge: {bridge}"))?;
    let python = resolved_python();
    let workspace_path = resolved_bridge_path(bridge);
    let payload = serde_json::json!({
        "action": "syncAccount",
        "bridge": bridge,
        "route": route_label,
        "workspacePath": workspace_path,
        "generatedAt": Utc::now().to_rfc3339(),
        "request": request,
    });
    let payload_text = serde_json::to_string(&payload)
        .map_err(|error| format!("cannot serialize account sync payload: {error}"))?;
    let mut command = Command::new(&python);
    command
        .arg("-c")
        .arg(script)
        .arg("syncAccount")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let workspace = PathBuf::from(&workspace_path);
    if workspace.exists() {
        command.current_dir(&workspace);
        command.env("PYTHONPATH", python_path_with_workspace(&workspace_path));
    }

    let mut child = command
        .spawn()
        .map_err(|error| format!("cannot start {bridge} account adapter with {python}: {error}"))?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(payload_text.as_bytes())
            .map_err(|error| format!("cannot write account adapter payload: {error}"))?;
    }
    let output = child
        .wait_with_output()
        .map_err(|error| format!("cannot read account adapter output: {error}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

    if !output.status.success() {
        return Err(if stderr.is_empty() {
            format!("{bridge} account adapter exited with {}", output.status)
        } else {
            stderr
        });
    }

    let mut snapshot = parse_account_snapshot(&stdout)?;
    if !stderr.is_empty() {
        snapshot.warnings.push(stderr);
    }
    Ok(snapshot)
}

fn run_market_quote_adapter(
    request: &MarketQuoteRequest,
    bridge: &str,
    route_label: &str,
) -> Result<MarketQuoteSnapshot, String> {
    let script = adapter_script_for(bridge)
        .ok_or_else(|| format!("unsupported market data adapter bridge: {bridge}"))?;
    let python = resolved_python();
    let workspace_path = resolved_bridge_path(bridge);
    let payload = serde_json::json!({
        "action": "syncMarketQuote",
        "bridge": bridge,
        "route": route_label,
        "workspacePath": workspace_path,
        "generatedAt": Utc::now().to_rfc3339(),
        "request": request,
    });
    let payload_text = serde_json::to_string(&payload)
        .map_err(|error| format!("cannot serialize market quote payload: {error}"))?;
    let mut command = Command::new(&python);
    command
        .arg("-c")
        .arg(script)
        .arg("syncMarketQuote")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let workspace = PathBuf::from(&workspace_path);
    if workspace.exists() {
        command.current_dir(&workspace);
        command.env("PYTHONPATH", python_path_with_workspace(&workspace_path));
    }

    let mut child = command.spawn().map_err(|error| {
        format!("cannot start {bridge} market data adapter with {python}: {error}")
    })?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(payload_text.as_bytes())
            .map_err(|error| format!("cannot write market quote payload: {error}"))?;
    }
    let output = child
        .wait_with_output()
        .map_err(|error| format!("cannot read market data adapter output: {error}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

    if !output.status.success() {
        return Err(if stderr.is_empty() {
            format!("{bridge} market data adapter exited with {}", output.status)
        } else {
            stderr
        });
    }

    let mut quote = parse_market_quote_snapshot(&stdout)?;
    if !stderr.is_empty() {
        quote.warnings.push(stderr);
    }
    Ok(quote)
}

fn adapter_script_for(bridge: &str) -> Option<&'static str> {
    match bridge {
        "qbot" => Some(QBOT_ADAPTER_SCRIPT),
        "vnpy" => Some(VNPY_ADAPTER_SCRIPT),
        _ => None,
    }
}

fn parse_adapter_response(stdout: &str) -> Result<BrokerAdapterResponse, String> {
    let trimmed = stdout.trim();
    if trimmed.is_empty() {
        return Err("broker adapter returned empty output".to_string());
    }
    if let Ok(response) = serde_json::from_str::<BrokerAdapterResponse>(trimmed) {
        return Ok(response);
    }
    for line in trimmed.lines().rev() {
        let candidate = line.trim();
        if candidate.starts_with('{') {
            if let Ok(response) = serde_json::from_str::<BrokerAdapterResponse>(candidate) {
                return Ok(response);
            }
        }
    }
    Err(format!(
        "broker adapter returned non-JSON output: {trimmed}"
    ))
}

fn parse_account_snapshot(stdout: &str) -> Result<BrokerAccountSnapshot, String> {
    let trimmed = stdout.trim();
    if trimmed.is_empty() {
        return Err("account adapter returned empty output".to_string());
    }
    if let Ok(response) = serde_json::from_str::<BrokerAccountSnapshot>(trimmed) {
        return Ok(response);
    }
    for line in trimmed.lines().rev() {
        let candidate = line.trim();
        if candidate.starts_with('{') {
            if let Ok(response) = serde_json::from_str::<BrokerAccountSnapshot>(candidate) {
                return Ok(response);
            }
        }
    }
    Err(format!(
        "account adapter returned non-JSON output: {trimmed}"
    ))
}

fn parse_market_quote_snapshot(stdout: &str) -> Result<MarketQuoteSnapshot, String> {
    let trimmed = stdout.trim();
    if trimmed.is_empty() {
        return Err("market data adapter returned empty output".to_string());
    }
    if let Ok(response) = serde_json::from_str::<MarketQuoteSnapshot>(trimmed) {
        return Ok(response);
    }
    for line in trimmed.lines().rev() {
        let candidate = line.trim();
        if candidate.starts_with('{') {
            if let Ok(response) = serde_json::from_str::<MarketQuoteSnapshot>(candidate) {
                return Ok(response);
            }
        }
    }
    Err(format!(
        "market data adapter returned non-JSON output: {trimmed}"
    ))
}

fn adapter_event_label(action: &str, status: &str, accepted: bool) -> &'static str {
    if !accepted {
        return "命令失败";
    }
    match status {
        "submitted" => "已提交",
        "ready_to_submit" => "等待成交回报",
        "ready_to_cancel" => "撤单已发送",
        "cancelled" => "已撤单",
        "partially_filled" => "部分成交",
        "filled" => "已成交",
        "synced" => "状态同步",
        _ if action == "syncOrderStatus" => "状态同步",
        _ if action == "cancelOrder" => "撤单已发送",
        _ if action == "submitOrder" => "已提交",
        _ => "命令回写",
    }
}

fn adapter_status_fallback(action: &str, accepted: bool) -> String {
    if !accepted {
        return "adapter_error".to_string();
    }
    match action {
        "submitOrder" => "submitted".to_string(),
        "cancelOrder" => "ready_to_cancel".to_string(),
        "syncOrderStatus" => "synced".to_string(),
        _ => "prepared".to_string(),
    }
}

fn adapter_ref_prefix(action: &str) -> &'static str {
    match action {
        "submitOrder" => "live",
        "cancelOrder" => "cancel",
        "syncOrderStatus" => "sync",
        _ => "adapter",
    }
}

fn resolved_bridge_path(bridge: &str) -> String {
    if bridge == "qbot" {
        std::env::var("RPORTFOLIO_QBOT_PATH")
            .ok()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| default_bridge_workspace("Qbot"))
    } else {
        std::env::var("RPORTFOLIO_VNPY_PATH")
            .ok()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| default_bridge_workspace("vnpy"))
    }
}

fn default_bridge_workspace(folder: &str) -> String {
    let documents_dir =
        dirs::document_dir().or_else(|| dirs::home_dir().map(|home| home.join("Documents")));
    default_bridge_workspace_from(documents_dir, folder)
        .to_string_lossy()
        .into_owned()
}

fn default_bridge_workspace_from(documents_dir: Option<PathBuf>, folder: &str) -> PathBuf {
    documents_dir
        .unwrap_or_else(|| PathBuf::from("Documents"))
        .join(folder)
}

fn resolved_python() -> String {
    std::env::var("RPORTFOLIO_PYTHON")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "python3".to_string())
}

fn python_path_with_workspace(workspace_path: &str) -> String {
    match std::env::var("PYTHONPATH") {
        Ok(existing) if !existing.trim().is_empty() => {
            format!("{workspace_path}:{}", existing.trim())
        }
        _ => workspace_path.to_string(),
    }
}

fn qbot_bridge_status(path: &str, python: &str, python_ok: bool) -> BrokerBridgeStatus {
    let root = PathBuf::from(path);
    let path_exists = root.exists();
    let trade_engine = root.join("qbot/engine/trade/trade_engine.py");
    let command = std::env::var("RPORTFOLIO_QBOT_COMMAND")
        .ok()
        .filter(|value| !value.trim().is_empty());
    let adapter_exists = command.is_some() || trade_engine.exists();
    let mut warnings = Vec::new();
    if !path_exists {
        warnings.push(format!("Qbot 路径不存在：{path}"));
    } else if command.is_none() {
        warnings.push(
            "Qbot 本地仓库未暴露可调用交易入口；设置 RPORTFOLIO_QBOT_COMMAND 后可接收 rPortfolio JSON 委托。"
                .to_string(),
        );
        if !trade_engine.exists() {
            warnings.push("未找到 qbot/engine/trade/trade_engine.py。".to_string());
        }
    }
    if !python_ok {
        warnings.push(format!("Python 不可用：{python}"));
    }
    let command_available = path_exists && command.is_some() && python_ok;
    BrokerBridgeStatus {
        bridge: "qbot".to_string(),
        label: "Qbot Adapter".to_string(),
        path: path.to_string(),
        path_exists,
        adapter_exists,
        python_ok,
        command_available,
        route_label: "Qbot Bridge".to_string(),
        summary: if command_available {
            "Qbot command adapter ready".to_string()
        } else if adapter_exists {
            "Qbot workspace detected, command adapter pending".to_string()
        } else {
            "Qbot adapter not ready".to_string()
        },
        warnings,
        capabilities: vec![
            "trader_opts".to_string(),
            "login".to_string(),
            "get_positions".to_string(),
            "start_trade".to_string(),
        ],
        command_preview: if let Some(command) = command {
            vec![
                format!("cd {}", root.display()),
                format!("{command} < rportfolio-order.json"),
            ]
        } else {
            vec![
                format!("cd {}", root.display()),
                "export RPORTFOLIO_QBOT_COMMAND='python path/to/qbot_order_adapter.py'".to_string(),
            ]
        },
    }
}

fn vnpy_bridge_status(path: &str, python: &str, python_ok: bool) -> BrokerBridgeStatus {
    let root = PathBuf::from(path);
    let path_exists = root.exists();
    let gateway = root.join("vnpy/trader/gateway.py");
    let engine = root.join("vnpy/trader/engine.py");
    let adapter_exists = gateway.exists() && engine.exists();
    let mut warnings = Vec::new();
    if !path_exists {
        warnings.push(format!("vn.py 路径不存在：{path}"));
    } else if !adapter_exists {
        warnings.push("vn.py 工作区不完整：缺少 vnpy/trader/gateway.py 或 engine.py。".to_string());
    } else if std::env::var("RPORTFOLIO_VNPY_GATEWAY_MODULE")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .is_none()
        || std::env::var("RPORTFOLIO_VNPY_GATEWAY_CLASS")
            .ok()
            .filter(|value| !value.trim().is_empty())
            .is_none()
    {
        warnings.push(
            "vn.py 核心可用；真实提交需设置 RPORTFOLIO_VNPY_GATEWAY_MODULE / RPORTFOLIO_VNPY_GATEWAY_CLASS 和连接配置。"
                .to_string(),
        );
    }
    if !python_ok {
        warnings.push(format!("Python 不可用：{python}"));
    }
    let command_available = path_exists && adapter_exists && python_ok;
    BrokerBridgeStatus {
        bridge: "vnpy".to_string(),
        label: "vn.py Gateway".to_string(),
        path: path.to_string(),
        path_exists,
        adapter_exists,
        python_ok,
        command_available,
        route_label: "vn.py Gateway".to_string(),
        summary: if command_available {
            "vn.py gateway adapter ready".to_string()
        } else {
            "vn.py adapter not ready".to_string()
        },
        warnings,
        capabilities: vec![
            "EventEngine".to_string(),
            "MainEngine".to_string(),
            "BaseGateway".to_string(),
            "send_order".to_string(),
        ],
        command_preview: vec![
            format!("cd {}", root.display()),
            format!("{python} -c \"from vnpy.trader.gateway import BaseGateway\""),
        ],
    }
}

fn normalize_bridge_key(value: &str) -> String {
    match value.trim().to_lowercase().as_str() {
        "qbot-bridge" | "qbot_trade_engine" | "qbot-trade-engine" | "qbot" => "qbot".to_string(),
        "live-gateway" | "vn.py" | "vnpy-gateway" | "vnpy" => "vnpy".to_string(),
        "paper" | "local" | "local-paper" | "local_paper" => "local-paper".to_string(),
        other => other.to_string(),
    }
}

fn python_available(python: &str) -> bool {
    Command::new(python)
        .arg("--version")
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

fn order_ref(prefix: &str, symbol: &str) -> String {
    let cleaned = symbol
        .chars()
        .filter(|value| value.is_ascii_alphanumeric())
        .collect::<String>();
    format!("{}-{}-{}", prefix, cleaned, Utc::now().timestamp_millis())
}

fn round_price(value: f64) -> f64 {
    round(value, 4)
}

pub async fn score_market(request: ScoreMarketRequest) -> Result<MarketAnalysisReport, AppError> {
    let (profile, loaded) = load_analysis_inputs(&request).await?;
    build_report(loaded, request.as_of, profile)
}

pub async fn score_market_and_evaluate_recommendations(
    request: ScoreMarketRequest,
    recommendations_path: &Path,
) -> Result<MarketAnalysisReport, AppError> {
    let (profile, loaded) = load_analysis_inputs(&request).await?;
    if loaded.source != "sample" {
        evaluate_recommendation_records(
            recommendations_path,
            &profile,
            &loaded.series,
            request.as_of.as_deref(),
        )?;
    }
    let recommendation_performance =
        recommendation_performance_for(recommendations_path, &profile.key)?;
    let calibration_action = calibration_action_for(&profile, &recommendation_performance);
    let mut report = build_report(loaded, request.as_of, profile)?;
    report.recommendation_performance = recommendation_performance;
    report.calibration_action = calibration_action;
    Ok(report)
}

async fn load_analysis_inputs(
    request: &ScoreMarketRequest,
) -> Result<(AnalysisProfile, LoadedMarketData), AppError> {
    let profile = load_profile(request.profile.as_deref())?;
    let source = request
        .source
        .clone()
        .unwrap_or_else(|| "auto".to_string())
        .trim()
        .to_lowercase();
    let loaded = load_market_data(&source, &profile).await?;
    Ok((profile, loaded))
}

fn load_profile(profile: Option<&str>) -> Result<AnalysisProfile, AppError> {
    let requested = profile
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(DEFAULT_PROFILE_KEY);

    if looks_like_path(requested) {
        return load_profile_file(Path::new(requested));
    }

    if let Some(content) = BUILTIN_PROFILES
        .iter()
        .find(|(key, _)| *key == requested)
        .map(|(_, content)| *content)
    {
        return parse_profile(content, None);
    }

    for path in custom_profile_paths() {
        let Ok(profile) = load_profile_file(&path) else {
            continue;
        };
        if profile.key == requested {
            return Ok(profile);
        }
    }

    Err(AppError::invalid(format!("unknown profile '{requested}'")))
}

fn profile_source_content(profile: &str) -> Result<(String, Option<PathBuf>, bool), AppError> {
    let requested = profile.trim();
    let requested = if requested.is_empty() {
        DEFAULT_PROFILE_KEY
    } else {
        requested
    };

    if looks_like_path(requested) {
        let path = PathBuf::from(requested);
        let content = fs::read_to_string(&path)
            .map_err(|error| AppError::invalid(format!("profile file read failed: {error}")))?;
        return Ok((content, Some(path), false));
    }

    if let Some(content) = BUILTIN_PROFILES
        .iter()
        .find(|(key, _)| *key == requested)
        .map(|(_, content)| *content)
    {
        return Ok((content.to_string(), None, true));
    }

    for path in custom_profile_paths() {
        let Ok(content) = fs::read_to_string(&path) else {
            continue;
        };
        let Ok(profile) = parse_profile(&content, path.parent().map(Path::to_path_buf)) else {
            continue;
        };
        if profile.key == requested {
            return Ok((content, Some(path), false));
        }
    }

    Err(AppError::invalid(format!("unknown profile '{requested}'")))
}

fn parse_profile_json_value(content: &str) -> Result<Value, AppError> {
    serde_json::from_str(content)
        .map_err(|error| AppError::invalid(format!("profile json parse failed: {error}")))
}

fn resolve_profile_json_value(value: Value, base_dir: Option<&Path>) -> Result<Value, AppError> {
    let mut stack = Vec::new();
    resolve_profile_json_value_inner(value, base_dir, &mut stack)
}

fn resolve_profile_json_value_inner(
    child: Value,
    base_dir: Option<&Path>,
    stack: &mut Vec<String>,
) -> Result<Value, AppError> {
    let child_key = child
        .get("key")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("<anonymous>")
        .to_string();
    if stack.iter().any(|item| item == &child_key) {
        return Err(AppError::invalid(format!(
            "profile inheritance cycle detected: {} -> {child_key}",
            stack.join(" -> ")
        )));
    }
    stack.push(child_key);

    let parent_ref = child
        .get("extends")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let result = if let Some(parent_ref) = parent_ref {
        let (parent_content, parent_base_dir) = raw_profile_source(&parent_ref, base_dir)?;
        let parent_value = parse_profile_json_value(&parent_content)?;
        let mut resolved_parent =
            resolve_profile_json_value_inner(parent_value, parent_base_dir.as_deref(), stack)?;
        merge_profile_value(&mut resolved_parent, &child);
        Ok(resolved_parent)
    } else {
        Ok(child)
    };

    stack.pop();
    result
}

fn raw_profile_source(
    requested: &str,
    base_dir: Option<&Path>,
) -> Result<(String, Option<PathBuf>), AppError> {
    if looks_like_path(requested) {
        let requested_path = PathBuf::from(requested);
        let path = if requested_path.is_absolute() {
            requested_path
        } else {
            base_dir
                .map(|dir| dir.join(&requested_path))
                .unwrap_or(requested_path)
        };
        let content = fs::read_to_string(&path)
            .map_err(|error| AppError::invalid(format!("parent profile read failed: {error}")))?;
        return Ok((content, path.parent().map(Path::to_path_buf)));
    }

    if let Some(content) = BUILTIN_PROFILES
        .iter()
        .find(|(key, _)| *key == requested)
        .map(|(_, content)| *content)
    {
        return Ok((content.to_string(), None));
    }

    for path in custom_profile_paths() {
        let Ok(content) = fs::read_to_string(&path) else {
            continue;
        };
        let Ok(value) = parse_profile_json_value(&content) else {
            continue;
        };
        if value.get("key").and_then(Value::as_str) == Some(requested) {
            return Ok((content, path.parent().map(Path::to_path_buf)));
        }
    }

    Err(AppError::invalid(format!(
        "unknown parent profile '{requested}'"
    )))
}

fn merge_profile_value(base: &mut Value, overlay: &Value) {
    match (base, overlay) {
        (Value::Object(base_map), Value::Object(overlay_map)) => {
            for (key, overlay_value) in overlay_map {
                match base_map.get_mut(key) {
                    Some(base_value) => merge_profile_value(base_value, overlay_value),
                    None => {
                        base_map.insert(key.clone(), overlay_value.clone());
                    }
                }
            }
        }
        (base_value, overlay_value) => *base_value = overlay_value.clone(),
    }
}

fn looks_like_path(value: &str) -> bool {
    value.ends_with(".json")
        || value.contains('/')
        || value.contains('\\')
        || Path::new(value).exists()
}

fn parse_profile(content: &str, base_dir: Option<PathBuf>) -> Result<AnalysisProfile, AppError> {
    let value = parse_profile_json_value(content)?;
    let resolved = resolve_profile_json_value(value, base_dir.as_deref())?;
    let mut profile: AnalysisProfile = serde_json::from_value(resolved)
        .map_err(|error| AppError::invalid(format!("profile parse failed: {error}")))?;
    profile.base_dir = base_dir;
    validate_profile(profile)
}

fn load_profile_file(path: &Path) -> Result<AnalysisProfile, AppError> {
    let base_dir = path.parent().map(Path::to_path_buf);
    let content = fs::read_to_string(path)
        .map_err(|error| AppError::invalid(format!("profile file read failed: {error}")))?;
    parse_profile(&content, base_dir)
}

fn custom_profile_paths() -> Vec<PathBuf> {
    custom_profile_dirs()
        .into_iter()
        .filter_map(|dir| fs::read_dir(dir).ok())
        .flat_map(|entries| entries.filter_map(Result::ok))
        .map(|entry| entry.path())
        .filter(|path| path.extension().and_then(|value| value.to_str()) == Some("json"))
        .collect()
}

fn custom_profile_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Some(value) = std::env::var_os("RPORTFOLIO_PROFILE_DIR") {
        dirs.extend(std::env::split_paths(&value));
    }
    if let Some(home) = std::env::var_os("HOME") {
        let home = PathBuf::from(home);
        dirs.push(home.join(".rportfolio").join("profiles"));
        dirs.push(home.join(".rmarket").join("profiles"));
    }
    if let Some(value) = std::env::var_os("RMARKET_PROFILE_DIR") {
        dirs.extend(std::env::split_paths(&value));
    }
    dirs
}

fn writable_profile_dir() -> Result<PathBuf, AppError> {
    custom_profile_dirs()
        .into_iter()
        .next()
        .ok_or_else(|| AppError::invalid("cannot resolve profile directory; HOME is not set"))
}

fn safe_profile_filename(key: &str) -> String {
    let name = key
        .trim()
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_') {
                ch
            } else {
                '_'
            }
        })
        .collect::<String>();
    if name.is_empty() {
        "profile".to_string()
    } else {
        name
    }
}

fn normalize_holdings(holdings: Vec<HoldingRecord>) -> Result<Vec<HoldingRecord>, AppError> {
    holdings
        .into_iter()
        .enumerate()
        .map(|(index, holding)| normalize_holding(index, holding))
        .collect()
}

fn normalize_trades(trades: Vec<TradeRecord>) -> Result<Vec<TradeRecord>, AppError> {
    trades
        .into_iter()
        .enumerate()
        .map(|(index, trade)| normalize_trade(index, trade))
        .collect()
}

fn normalize_holding(index: usize, mut holding: HoldingRecord) -> Result<HoldingRecord, AppError> {
    holding.id = holding.id.trim().to_string();
    holding.account_id = holding
        .account_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    holding.symbol = holding.symbol.trim().to_ascii_uppercase();
    holding.name = holding.name.trim().to_string();
    holding.market = holding.market.trim().to_ascii_uppercase();
    holding.currency = holding.currency.trim().to_ascii_uppercase();
    holding.role = holding.role.trim().to_ascii_lowercase();
    holding.asset_type = holding
        .asset_type
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_ascii_lowercase);
    holding.quote_source = holding
        .quote_source
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    holding.profile_key = holding
        .profile_key
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    holding.quote_as_of = holding
        .quote_as_of
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    holding.confirmed_nav_as_of = holding
        .confirmed_nav_as_of
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    holding.fund_purchase_status = holding
        .fund_purchase_status
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    holding.fund_trade_status_as_of = holding
        .fund_trade_status_as_of
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    holding.fund_holdings_as_of = holding
        .fund_holdings_as_of
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    holding.notes = holding.notes.trim().to_string();

    if holding.id.is_empty() {
        holding.id = format!("holding-{}-{}", index + 1, holding.symbol);
    }
    if holding.symbol.is_empty() {
        return Err(AppError::invalid(format!(
            "holdings[{index}].symbol cannot be empty"
        )));
    }
    if holding.name.is_empty() {
        return Err(AppError::invalid(format!(
            "holdings[{index}].name cannot be empty"
        )));
    }
    if !matches!(holding.role.as_str(), "real" | "proxy" | "watch") {
        return Err(AppError::invalid(format!(
            "holdings[{index}].role must be one of real, proxy, watch"
        )));
    }
    for (field, value) in [
        ("quantity", holding.quantity),
        ("costPrice", holding.cost_price),
        ("currentPrice", holding.current_price),
        ("targetWeight", holding.target_weight),
    ] {
        if !value.is_finite() || value < 0.0 {
            return Err(AppError::invalid(format!(
                "holdings[{index}].{field} must be a non-negative finite number"
            )));
        }
    }
    if holding
        .confirmed_nav
        .is_some_and(|value| !value.is_finite() || value <= 0.0)
    {
        return Err(AppError::invalid(format!(
            "holdings[{index}].confirmedNav must be a positive finite number"
        )));
    }
    if holding.target_weight > 100.0 {
        return Err(AppError::invalid(format!(
            "holdings[{index}].targetWeight cannot exceed 100"
        )));
    }
    for (field, value) in [
        ("targetMinWeight", holding.target_min_weight),
        ("targetMaxWeight", holding.target_max_weight),
    ] {
        if let Some(value) = value {
            if !value.is_finite() || value < 0.0 {
                return Err(AppError::invalid(format!(
                    "holdings[{index}].{field} must be a non-negative finite number"
                )));
            }
            if value > 100.0 {
                return Err(AppError::invalid(format!(
                    "holdings[{index}].{field} cannot exceed 100"
                )));
            }
        }
    }
    holding.target_min_weight = holding.target_min_weight.filter(|value| *value > 0.0);
    holding.target_max_weight = holding.target_max_weight.filter(|value| *value > 0.0);
    if holding.target_weight == 0.0
        && (holding.target_min_weight.is_some() || holding.target_max_weight.is_some())
    {
        return Err(AppError::invalid(format!(
            "holdings[{index}] targetWeight is required when targetMinWeight or targetMaxWeight is set"
        )));
    }
    if let Some(min_weight) = holding.target_min_weight {
        if min_weight > holding.target_weight {
            return Err(AppError::invalid(format!(
                "holdings[{index}].targetMinWeight cannot exceed targetWeight"
            )));
        }
    }
    if let Some(max_weight) = holding.target_max_weight {
        if max_weight < holding.target_weight {
            return Err(AppError::invalid(format!(
                "holdings[{index}].targetMaxWeight cannot be lower than targetWeight"
            )));
        }
    }
    if holding.role == "real" && (holding.quantity == 0.0 || holding.current_price == 0.0) {
        return Err(AppError::invalid(format!(
            "holdings[{index}] real holding requires quantity and currentPrice"
        )));
    }
    Ok(holding)
}

fn normalize_trade(index: usize, mut trade: TradeRecord) -> Result<TradeRecord, AppError> {
    trade.id = trade.id.trim().to_string();
    trade.account_id = trade
        .account_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    trade.decision_id = trade
        .decision_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    trade.order_id = trade
        .order_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    trade.symbol = trade.symbol.trim().to_ascii_uppercase();
    trade.name = trade.name.trim().to_string();
    trade.side = trade.side.trim().to_ascii_lowercase();
    trade.trade_date = trade.trade_date.trim().to_string();
    trade.currency = trade.currency.trim().to_ascii_uppercase();
    trade.notes = trade.notes.trim().to_string();

    if trade.id.is_empty() {
        trade.id = format!("trade-{}-{}", index + 1, trade.symbol);
    }
    if trade.symbol.is_empty() {
        return Err(AppError::invalid(format!(
            "trades[{index}].symbol cannot be empty"
        )));
    }
    if trade.name.is_empty() {
        return Err(AppError::invalid(format!(
            "trades[{index}].name cannot be empty"
        )));
    }
    if !matches!(trade.side.as_str(), "buy" | "sell") {
        return Err(AppError::invalid(format!(
            "trades[{index}].side must be one of buy, sell"
        )));
    }
    if NaiveDate::parse_from_str(&trade.trade_date, "%Y-%m-%d").is_err() {
        return Err(AppError::invalid(format!(
            "trades[{index}].tradeDate must use YYYY-MM-DD"
        )));
    }
    for (field, value) in [
        ("quantity", trade.quantity),
        ("price", trade.price),
        ("fee", trade.fee),
    ] {
        if !value.is_finite() || value < 0.0 {
            return Err(AppError::invalid(format!(
                "trades[{index}].{field} must be a non-negative finite number"
            )));
        }
    }
    if trade.quantity == 0.0 || trade.price == 0.0 {
        return Err(AppError::invalid(format!(
            "trades[{index}] requires quantity and price"
        )));
    }
    Ok(trade)
}

fn validate_profile(profile: AnalysisProfile) -> Result<AnalysisProfile, AppError> {
    if profile.key.trim().is_empty() {
        return Err(AppError::invalid("profile key cannot be empty"));
    }
    if profile.name.trim().is_empty() {
        return Err(AppError::invalid("profile name cannot be empty"));
    }
    if profile.market.trim().is_empty() {
        return Err(AppError::invalid("profile market cannot be empty"));
    }
    if profile.benchmark.trim().is_empty() {
        return Err(AppError::invalid("profile benchmark cannot be empty"));
    }
    if profile.symbols.is_empty() {
        return Err(AppError::invalid("profile must define at least one symbol"));
    }
    if !profile
        .symbols
        .iter()
        .any(|item| item.symbol == profile.benchmark)
    {
        return Err(AppError::invalid(format!(
            "profile benchmark '{}' is not in symbols",
            profile.benchmark
        )));
    }
    if profile.symbols.iter().any(|item| {
        item.weight
            .is_some_and(|weight| !weight.is_finite() || weight < 0.0)
    }) {
        return Err(AppError::invalid(
            "profile symbol weights must be finite non-negative percentages",
        ));
    }
    if let Some(symbol) = profile.symbols.iter().find(|item| {
        item.asset_kind
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_ascii_lowercase)
            .is_some_and(|kind| !SUPPORTED_ASSET_KINDS.contains(&kind.as_str()))
    }) {
        return Err(AppError::invalid(format!(
            "profile symbol '{}' has unsupported assetKind",
            symbol.symbol
        )));
    }
    let total_weight = profile
        .dimensions
        .iter()
        .map(|dimension| dimension.weight as u16)
        .sum::<u16>();
    if total_weight == 0 || total_weight > 100 {
        return Err(AppError::invalid(
            "profile dimension weights must sum to 1..=100",
        ));
    }
    Ok(profile)
}

impl ProfileValidationReport {
    fn new() -> Self {
        Self {
            valid: false,
            summary: "Profile 尚未校验。".to_string(),
            errors: Vec::new(),
            warnings: Vec::new(),
            stats: ProfileValidationStats::default(),
        }
    }

    fn error(
        &mut self,
        scope: impl Into<String>,
        path: impl Into<String>,
        message: impl Into<String>,
    ) {
        self.errors.push(ProfileValidationIssue {
            severity: "error".to_string(),
            scope: scope.into(),
            path: path.into(),
            message: message.into(),
        });
    }

    fn warning(
        &mut self,
        scope: impl Into<String>,
        path: impl Into<String>,
        message: impl Into<String>,
    ) {
        self.warnings.push(ProfileValidationIssue {
            severity: "warning".to_string(),
            scope: scope.into(),
            path: path.into(),
            message: message.into(),
        });
    }

    fn finish(mut self) -> Self {
        self.valid = self.errors.is_empty();
        self.summary = if self.valid {
            if self.warnings.is_empty() {
                format!(
                    "校验通过：{} 个 symbols，{} 个维度，{} 条规则。",
                    self.stats.symbols, self.stats.dimensions, self.stats.rules
                )
            } else {
                format!(
                    "校验通过但有 {} 个提醒：{} 个 symbols，{} 条规则。",
                    self.warnings.len(),
                    self.stats.symbols,
                    self.stats.rules
                )
            }
        } else {
            format!(
                "校验失败：{} 个错误，{} 个提醒。",
                self.errors.len(),
                self.warnings.len()
            )
        };
        self
    }
}

fn validate_profile_semantics(profile: &AnalysisProfile, report: &mut ProfileValidationReport) {
    let mut symbol_counts: HashMap<String, usize> = HashMap::new();
    let mut symbol_set = HashMap::new();
    let mut total_weight = 0.0;
    let mut weighted_symbols = 0usize;
    let mut dimension_counts: HashMap<String, usize> = HashMap::new();

    validate_profile_metadata(profile, report);

    for (index, symbol) in profile.symbols.iter().enumerate() {
        let path = format!("symbols[{index}]");
        if symbol.symbol.trim().is_empty() {
            report.error("symbols", path.clone(), "symbol cannot be empty");
        }
        if symbol.label.trim().is_empty() {
            report.warning(
                "symbols",
                path.clone(),
                "label is empty; UI will fall back poorly",
            );
        }
        if let Some(weight) = symbol.weight {
            if weight > 0.0 {
                weighted_symbols += 1;
                total_weight += weight;
            }
        }
        validate_symbol_asset_kind(symbol, &path, report);
        *symbol_counts.entry(symbol.symbol.clone()).or_insert(0) += 1;
        symbol_set.insert(symbol.symbol.clone(), index);
    }

    for (symbol, count) in symbol_counts {
        if count > 1 {
            report.error(
                "symbols",
                "symbols",
                format!("symbol '{symbol}' appears {count} times"),
            );
        }
    }

    if total_weight > 100.0 {
        report.warning(
            "symbols",
            "symbols[].weight",
            format!("positive symbol weights sum to {total_weight:.1}%; this implies leverage or overweight exposure"),
        );
    }

    let dimension_weight = profile
        .dimensions
        .iter()
        .map(|dimension| dimension.weight as u16)
        .sum::<u16>();
    let rule_count = profile
        .dimensions
        .iter()
        .map(|dimension| dimension.rules.len())
        .sum::<usize>();

    report.stats = ProfileValidationStats {
        symbols: profile.symbols.len(),
        weighted_symbols,
        total_weight: round(total_weight, 2),
        dimensions: profile.dimensions.len(),
        dimension_weight,
        rules: rule_count,
    };

    if dimension_weight != 100 {
        report.warning(
            "dimensions",
            "dimensions[].weight",
            format!("dimension weights sum to {dimension_weight}; 100 is easier to interpret"),
        );
    }

    validate_technical_columns(&profile.technical_columns, report);
    validate_calibration_config(&profile.calibration, report);

    for (dimension_index, dimension) in profile.dimensions.iter().enumerate() {
        let dimension_path = format!("dimensions[{dimension_index}]");
        if dimension.key.trim().is_empty() {
            report.error(
                "dimensions",
                format!("{dimension_path}.key"),
                "dimension key cannot be empty",
            );
        }
        if dimension.label.trim().is_empty() {
            report.warning(
                "dimensions",
                format!("{dimension_path}.label"),
                "dimension label is empty; UI explanation will be weak",
            );
        }
        *dimension_counts.entry(dimension.key.clone()).or_insert(0) += 1;
        if dimension.rules.is_empty() {
            report.warning(
                "dimensions",
                format!("{dimension_path}.rules"),
                format!("dimension '{}' has no rules", dimension.key),
            );
        }
        for (rule_index, rule) in dimension.rules.iter().enumerate() {
            let rule_path = format!("{dimension_path}.rules[{rule_index}]");
            validate_rule_config(rule, &symbol_set, &rule_path, report);
        }
    }

    for (dimension, count) in dimension_counts {
        if count > 1 {
            report.error(
                "dimensions",
                "dimensions[].key",
                format!("dimension '{dimension}' appears {count} times"),
            );
        }
    }

    validate_fund_config(&profile.fund, report);
    validate_execution_policy(&profile.execution_policy, report);
}

fn validate_execution_policy(
    policy: &ProfileExecutionPolicy,
    report: &mut ProfileValidationReport,
) {
    if policy.quote_warn_age_seconds == 0
        || policy.quote_warn_age_seconds >= policy.quote_block_age_seconds
    {
        report.error(
            "executionPolicy",
            "executionPolicy.quoteWarnAgeSeconds",
            "quoteWarnAgeSeconds must be greater than 0 and lower than quoteBlockAgeSeconds",
        );
    }
    if policy.etf_warn_spread_bps <= 0.0
        || policy.etf_warn_spread_bps >= policy.etf_block_spread_bps
    {
        report.error(
            "executionPolicy",
            "executionPolicy.etfWarnSpreadBps",
            "etfWarnSpreadBps must be greater than 0 and lower than etfBlockSpreadBps",
        );
    }
    if policy.etf_warn_premium_discount_pct <= 0.0
        || policy.etf_warn_premium_discount_pct >= policy.etf_block_premium_discount_pct
    {
        report.error(
            "executionPolicy",
            "executionPolicy.etfWarnPremiumDiscountPct",
            "etfWarnPremiumDiscountPct must be greater than 0 and lower than etfBlockPremiumDiscountPct",
        );
    }
    if policy.fund_warn_holdings_age_days <= 0
        || policy.fund_warn_holdings_age_days >= policy.fund_block_holdings_age_days
    {
        report.error(
            "executionPolicy",
            "executionPolicy.fundWarnHoldingsAgeDays",
            "fundWarnHoldingsAgeDays must be greater than 0 and lower than fundBlockHoldingsAgeDays",
        );
    }
}

fn validate_profile_metadata(profile: &AnalysisProfile, report: &mut ProfileValidationReport) {
    if !matches!(profile.schema_version, 1 | 2) {
        report.error(
            "profile",
            "schemaVersion",
            format!(
                "unsupported schemaVersion {}; expected 1 or 2",
                profile.schema_version
            ),
        );
    } else if profile.schema_version == 1 {
        report.warning(
            "profile",
            "schemaVersion",
            "legacy Profile v1 is supported; migrate to v2 before automated calibration",
        );
    }

    if profile.profile_version.trim().is_empty() {
        report.error(
            "profile",
            "profileVersion",
            "profileVersion cannot be empty",
        );
    }

    if profile.schema_version < 2 {
        return;
    }

    let meta = &profile.calibration_meta;
    if meta
        .method
        .as_deref()
        .map(str::trim)
        .unwrap_or_default()
        .is_empty()
    {
        report.warning(
            "calibration",
            "calibrationMeta.method",
            "v2 Profile should declare whether calibration is manual, walk-forward, or imported",
        );
    }
    if meta
        .data_signature
        .as_deref()
        .map(str::trim)
        .unwrap_or_default()
        .is_empty()
    {
        report.warning(
            "calibration",
            "calibrationMeta.dataSignature",
            "v2 Profile should record a data signature before comparing parameter performance",
        );
    }
    validate_optional_date(
        meta.calibrated_at.as_deref(),
        "calibrationMeta.calibratedAt",
        report,
    );
    let training_start = validate_optional_date(
        meta.training_start.as_deref(),
        "calibrationMeta.trainingStart",
        report,
    );
    let training_end = validate_optional_date(
        meta.training_end.as_deref(),
        "calibrationMeta.trainingEnd",
        report,
    );
    let validation_start = validate_optional_date(
        meta.validation_start.as_deref(),
        "calibrationMeta.validationStart",
        report,
    );
    let validation_end = validate_optional_date(
        meta.validation_end.as_deref(),
        "calibrationMeta.validationEnd",
        report,
    );

    if training_start
        .zip(training_end)
        .is_some_and(|(start, end)| start > end)
    {
        report.error(
            "calibration",
            "calibrationMeta.trainingEnd",
            "trainingEnd must not be earlier than trainingStart",
        );
    }
    if validation_start
        .zip(validation_end)
        .is_some_and(|(start, end)| start > end)
    {
        report.error(
            "calibration",
            "calibrationMeta.validationEnd",
            "validationEnd must not be earlier than validationStart",
        );
    }
    if training_end
        .zip(validation_start)
        .is_some_and(|(train_end, validate_start)| validate_start <= train_end)
    {
        report.warning(
            "calibration",
            "calibrationMeta.validationStart",
            "validation window overlaps the training window; keep an out-of-sample boundary",
        );
    }
    if meta
        .objective
        .as_deref()
        .map(str::trim)
        .unwrap_or_default()
        .is_empty()
    {
        report.warning(
            "calibration",
            "calibrationMeta.objective",
            "v2 Profile should declare a calibration objective including return, drawdown, turnover, and tail risk",
        );
    }
}

fn validate_optional_date(
    value: Option<&str>,
    path: &str,
    report: &mut ProfileValidationReport,
) -> Option<NaiveDate> {
    let value = value.map(str::trim).filter(|value| !value.is_empty())?;
    match NaiveDate::parse_from_str(value, "%Y-%m-%d") {
        Ok(date) => Some(date),
        Err(_) => {
            report.error("calibration", path, "date must use YYYY-MM-DD");
            None
        }
    }
}

fn validate_symbol_asset_kind(
    symbol: &ProfileSymbol,
    path: &str,
    report: &mut ProfileValidationReport,
) {
    if let Some(raw_kind) = symbol.asset_kind.as_deref().map(str::trim) {
        if raw_kind.is_empty() {
            report.warning(
                "symbols",
                format!("{path}.assetKind"),
                "assetKind is empty; it will be inferred",
            );
        } else {
            let normalized = raw_kind.to_ascii_lowercase();
            if !SUPPORTED_ASSET_KINDS.contains(&normalized.as_str()) {
                report.error(
                    "symbols",
                    format!("{path}.assetKind"),
                    format!(
                        "assetKind must be one of {}",
                        SUPPORTED_ASSET_KINDS.join(", ")
                    ),
                );
            }
        }
    }

    let kind = asset_kind_for(symbol);
    let weight = symbol.weight.unwrap_or(0.0);
    if matches!(kind, "observer" | "proxy") && weight > 0.0 {
        report.warning(
            "symbols",
            format!("{path}.weight"),
            format!(
                "{} is assetKind '{kind}' but has positive weight {weight:.1}%; it will not participate in portfolio health",
                symbol.symbol
            ),
        );
    }
    if kind == "holding" && weight == 0.0 && symbol.weight.is_some() {
        report.warning(
            "symbols",
            format!("{path}.weight"),
            format!(
                "{} is a holding with weight 0%; set assetKind to observer/proxy if it is only a signal input",
                symbol.symbol
            ),
        );
    }
    if is_volatility_symbol(symbol) && kind == "holding" {
        report.warning(
            "symbols",
            format!("{path}.assetKind"),
            format!(
                "{} looks like a volatility observer; verify before treating it as a portfolio holding",
                symbol.symbol
            ),
        );
    }
    if kind == "proxy"
        && symbol.yahoo_symbol.is_none()
        && symbol.stooq_symbol.is_none()
        && symbol.fred_symbol.is_none()
        && symbol.csv_path.is_none()
    {
        report.warning(
            "symbols",
            format!("{path}.assetKind"),
            "proxy assets should usually declare yahooSymbol, stooqSymbol, fredSymbol, or csvPath",
        );
    }
}

fn validate_technical_columns(
    columns: &[TechnicalColumnConfig],
    report: &mut ProfileValidationReport,
) {
    let mut column_counts: HashMap<String, usize> = HashMap::new();
    for (index, column) in columns.iter().enumerate() {
        let path = format!("technicalColumns[{index}]");
        if column.key.trim().is_empty() {
            report.error(
                "technicalColumns",
                format!("{path}.key"),
                "technical column key cannot be empty",
            );
        }
        if column.label.trim().is_empty() {
            report.warning(
                "technicalColumns",
                format!("{path}.label"),
                "technical column label is empty",
            );
        }
        if !SUPPORTED_TECHNICAL_METRICS.contains(&column.metric.as_str()) {
            report.error(
                "technicalColumns",
                format!("{path}.metric"),
                format!("unsupported metric '{}'", column.metric),
            );
        }
        if matches!(
            column.metric.as_str(),
            "return" | "rsi" | "ma_distance" | "ma" | "kdj" | "kdj_k" | "kdj_d" | "kdj_j"
        ) && column.period.is_some_and(|period| period == 0)
        {
            report.error(
                "technicalColumns",
                format!("{path}.period"),
                "period must be greater than 0",
            );
        }
        if column.metric == "kdj"
            && column
                .line
                .as_deref()
                .is_some_and(|line| !is_kdj_line(line))
        {
            report.error(
                "technicalColumns",
                format!("{path}.line"),
                "kdj line must be one of k, d, or j",
            );
        }
        if column.metric == "ma_pair" {
            if column.left_period.is_some_and(|period| period == 0)
                || column.right_period.is_some_and(|period| period == 0)
            {
                report.error(
                    "technicalColumns",
                    format!("{path}.leftPeriod"),
                    "ma_pair periods must be greater than 0",
                );
            }
            if column.left_period.is_none() || column.right_period.is_none() {
                report.warning(
                    "technicalColumns",
                    format!("{path}.leftPeriod"),
                    "ma_pair will default to 20/50; explicit leftPeriod/rightPeriod is clearer",
                );
            }
        }
        if let Some(format) = column.format.as_deref() {
            if !matches!(
                format,
                "number" | "number0" | "number1" | "percent" | "pair0" | "ratio"
            ) {
                report.warning(
                    "technicalColumns",
                    format!("{path}.format"),
                    format!("unknown display format '{format}'; it will render as a number"),
                );
            }
        }
        if column.tone.as_deref().is_some_and(|tone| tone != "signed") {
            report.warning(
                "technicalColumns",
                format!("{path}.tone"),
                "only tone='signed' has special meaning",
            );
        }
        *column_counts.entry(column.key.clone()).or_insert(0) += 1;
    }

    for (key, count) in column_counts {
        if count > 1 {
            report.error(
                "technicalColumns",
                "technicalColumns[].key",
                format!("technical column '{key}' appears {count} times"),
            );
        }
    }
}

fn validate_calibration_config(
    calibration: &ProfileCalibration,
    report: &mut ProfileValidationReport,
) {
    if !(0.0..=1.0).contains(&calibration.divergence_weak_ratio)
        || calibration.divergence_weak_ratio == 0.0
    {
        report.error(
            "calibration",
            "calibration.divergenceWeakRatio",
            "divergenceWeakRatio must be in (0, 1]",
        );
    }
    validate_range_order(
        calibration.hot_short_min,
        calibration.hot_short_max,
        "calibration.hotShortMin",
        "calibration.hotShortMax",
        report,
    );
    validate_range_order(
        calibration.hot_medium_min,
        calibration.hot_medium_max,
        "calibration.hotMediumMin",
        "calibration.hotMediumMax",
        report,
    );
    validate_range_order(
        calibration.hot_long_min,
        calibration.hot_long_max,
        "calibration.hotLongMin",
        "calibration.hotLongMax",
        report,
    );
}

fn validate_range_order(
    min: u8,
    max: u8,
    min_path: &str,
    max_path: &str,
    report: &mut ProfileValidationReport,
) {
    if min > max {
        report.error(
            "calibration",
            max_path,
            format!("{max_path} must be greater than or equal to {min_path}"),
        );
    }
}

fn validate_fund_config(fund: &ProfileFundConfig, report: &mut ProfileValidationReport) {
    let configured = [
        fund.code.as_deref(),
        fund.name.as_deref(),
        fund.fund_type.as_deref(),
        fund.manager.as_deref(),
        fund.issuer.as_deref(),
        fund.nav_symbol.as_deref(),
        fund.holdings_as_of.as_deref(),
        fund.holdings_source.as_deref(),
    ]
    .iter()
    .any(|value| value.map(str::trim).is_some_and(|item| !item.is_empty()));

    if !configured {
        return;
    }

    if fund.code.as_deref().map(str::trim).unwrap_or("").is_empty() {
        report.warning(
            "fund",
            "fund.code",
            "fund code is empty; import/export can still work but product identity is weak",
        );
    }
    if fund.name.as_deref().map(str::trim).unwrap_or("").is_empty() {
        report.warning(
            "fund",
            "fund.name",
            "fund name is empty; UI will fall back to profile name",
        );
    }
    if fund
        .nav_symbol
        .as_deref()
        .map(str::trim)
        .unwrap_or("")
        .is_empty()
    {
        report.warning(
            "fund",
            "fund.navSymbol",
            "navSymbol is empty; short/long buy point will be inferred from holdings and benchmark only",
        );
    }
    if fund
        .holdings_source
        .as_deref()
        .map(str::trim)
        .unwrap_or("")
        .is_empty()
    {
        report.warning(
            "fund",
            "fund.holdingsSource",
            "holdings source is empty; data provenance is unclear",
        );
    }

    let Some(raw_date) = fund
        .holdings_as_of
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        report.warning(
            "fund",
            "fund.holdingsAsOf",
            "holdingsAsOf is empty; fund holdings may be stale or impossible to audit",
        );
        return;
    };

    match NaiveDate::parse_from_str(raw_date, "%Y-%m-%d") {
        Ok(date) => {
            let today = Utc::now().date_naive();
            let age = (today - date).num_days();
            if age < 0 {
                report.warning(
                    "fund",
                    "fund.holdingsAsOf",
                    format!("holdingsAsOf {raw_date} is later than today; check disclosure date"),
                );
            } else if age > 120 {
                report.warning(
                    "fund",
                    "fund.holdingsAsOf",
                    format!("holdingsAsOf is {age} days old; short-term analysis should rely more on nav/benchmark and live holdings proxies"),
                );
            }
        }
        Err(_) => report.error(
            "fund",
            "fund.holdingsAsOf",
            "holdingsAsOf must use YYYY-MM-DD",
        ),
    }
}

fn validate_rule_config(
    rule: &RuleConfig,
    symbol_set: &HashMap<String, usize>,
    path: &str,
    report: &mut ProfileValidationReport,
) {
    if !SUPPORTED_RULE_TYPES.contains(&rule.rule_type.as_str()) {
        report.error(
            "rules",
            format!("{path}.type"),
            format!("unsupported rule type '{}'", rule.rule_type),
        );
    }
    if rule.points > 100 {
        report.error(
            "rules",
            format!("{path}.points"),
            format!("rule points {} exceeds 100", rule.points),
        );
    }
    if rule.points == 0 {
        report.warning(
            "rules",
            format!("{path}.points"),
            "rule points is 0; the rule can trigger but will not change score",
        );
    }
    if rule.reason.trim().is_empty() {
        report.warning(
            "rules",
            format!("{path}.reason"),
            "rule reason is empty; triggered reasons will be hard to explain",
        );
    }
    if rule.line.as_deref().is_some_and(|line| !is_kdj_line(line)) {
        report.error(
            "rules",
            format!("{path}.line"),
            "KDJ line must be one of k, d, or j",
        );
    }
    validate_positive_period(rule.period, format!("{path}.period"), report);
    validate_positive_period(rule.left_period, format!("{path}.leftPeriod"), report);
    validate_positive_period(rule.right_period, format!("{path}.rightPeriod"), report);
    validate_positive_period(rule.days, format!("{path}.days"), report);
    validate_threshold_order(
        rule.threshold,
        rule.max_threshold,
        format!("{path}.threshold"),
        format!("{path}.maxThreshold"),
        report,
    );

    if rule_requires_symbol(&rule.rule_type) && rule.symbol.as_deref().unwrap_or("").is_empty() {
        report.error(
            "rules",
            format!("{path}.symbol"),
            format!("rule type '{}' requires symbol", rule.rule_type),
        );
    }
    if rule_requires_other(&rule.rule_type) && rule.other.as_deref().unwrap_or("").is_empty() {
        report.error(
            "rules",
            format!("{path}.other"),
            format!("rule type '{}' requires other", rule.rule_type),
        );
    }
    if rule.rule_type == "breadth_below_ma_ratio"
        && rule.symbols.as_ref().map(Vec::is_empty).unwrap_or(true)
    {
        report.error(
            "rules",
            format!("{path}.symbols"),
            "breadth_below_ma_ratio requires symbols",
        );
    }

    if let Some(symbol) = &rule.symbol {
        validate_rule_symbol(symbol, symbol_set, format!("{path}.symbol"), report);
    }
    if let Some(other) = &rule.other {
        validate_rule_symbol(other, symbol_set, format!("{path}.other"), report);
    }
    if let Some(symbols) = &rule.symbols {
        for (index, symbol) in symbols.iter().enumerate() {
            validate_rule_symbol(
                symbol,
                symbol_set,
                format!("{path}.symbols[{index}]"),
                report,
            );
        }
    }
}

fn validate_positive_period(
    value: Option<u16>,
    path: String,
    report: &mut ProfileValidationReport,
) {
    if value.is_some_and(|period| period == 0) {
        report.error("rules", path, "period/days value must be greater than 0");
    }
}

fn validate_threshold_order(
    threshold: Option<f64>,
    max_threshold: Option<f64>,
    threshold_path: String,
    max_threshold_path: String,
    report: &mut ProfileValidationReport,
) {
    if threshold
        .zip(max_threshold)
        .is_some_and(|(threshold, max)| threshold > max)
    {
        let message =
            format!("{max_threshold_path} must be greater than or equal to {threshold_path}");
        report.error("rules", max_threshold_path, message);
    }
}

fn validate_rule_symbol(
    symbol: &str,
    symbol_set: &HashMap<String, usize>,
    path: String,
    report: &mut ProfileValidationReport,
) {
    if symbol.trim().is_empty() {
        return;
    }
    if !symbol_set.contains_key(symbol) {
        report.error(
            "rules",
            path,
            format!("rule references unknown symbol '{symbol}'"),
        );
    }
}

fn rule_requires_symbol(rule_type: &str) -> bool {
    !matches!(rule_type, "breadth_below_ma_ratio")
}

fn rule_requires_other(rule_type: &str) -> bool {
    matches!(
        rule_type,
        "underperformed_for"
            | "relative_strength_declined"
            | "below_ma_while_other_above_ma"
            | "single_day_drop_vs"
            | "return_below_relative"
    )
}

async fn load_market_data(
    source: &str,
    profile: &AnalysisProfile,
) -> Result<LoadedMarketData, AppError> {
    match source {
        "sample" => Ok(load_sample_data(
            profile,
            "示例数据",
            "离线示例数据，用于无网络或演示时验证评分模型。",
        )),
        "csv" => load_csv_data(profile),
        "stooq" => fetch_stooq_data(profile).await,
        "china" => fetch_china_data_with_cache(profile).await,
        "yahoo" => fetch_yahoo_data(profile).await,
        "hybrid" => fetch_hybrid_data(profile).await,
        "auto" | "" => {
            let mut errors = Vec::new();
            if profile_has_csv(profile) {
                match load_csv_data(profile) {
                    Ok(data) => return Ok(data),
                    Err(error) => errors.push(format!("CSV: {}", error.message)),
                }
            }
            if profile.market.eq_ignore_ascii_case("cn") {
                match tokio::time::timeout(
                    CHINA_PROVIDER_TIMEOUT,
                    fetch_china_data_with_cache(profile),
                )
                .await
                {
                    Ok(Ok(data)) => return Ok(data),
                    Ok(Err(error)) => errors.push(format!("A股免费多源: {}", error.message)),
                    Err(_) => errors.push("A股免费多源: 请求超时".to_string()),
                }
            }
            match tokio::time::timeout(AUTO_PROVIDER_TIMEOUT, fetch_stooq_data(profile)).await {
                Ok(Ok(data)) => return Ok(data),
                Ok(Err(error)) => errors.push(format!("Stooq: {}", error.message)),
                Err(_) => errors.push("Stooq: 请求超时".to_string()),
            }
            match tokio::time::timeout(AUTO_PROVIDER_TIMEOUT, fetch_hybrid_data(profile)).await {
                Ok(Ok(data)) => return Ok(data),
                Ok(Err(error)) => errors.push(format!("免费混合: {}", error.message)),
                Err(_) => errors.push("免费混合: 请求超时".to_string()),
            }
            let note = format!(
                "自动数据源获取失败，已切换为离线示例数据。原始错误：{}",
                errors.join("；")
            );
            Ok(load_sample_data(profile, "示例数据（自动兜底）", &note))
        }
        other => Err(AppError::invalid(format!(
            "unsupported source '{other}', use auto, china, stooq, hybrid, yahoo, csv, or sample"
        ))),
    }
}

fn market_client_builder() -> reqwest::ClientBuilder {
    reqwest::Client::builder()
        .connect_timeout(HTTP_CONNECT_TIMEOUT)
        .timeout(HTTP_REQUEST_TIMEOUT)
}

fn eastmoney_headers() -> HeaderMap {
    let mut headers = HeaderMap::new();
    headers.insert(
        ACCEPT,
        HeaderValue::from_static("application/json,text/javascript,*/*"),
    );
    headers.insert(
        ACCEPT_LANGUAGE,
        HeaderValue::from_static("zh-CN,zh;q=0.9,en;q=0.7"),
    );
    headers.insert(
        REFERER,
        HeaderValue::from_static("https://fund.eastmoney.com/"),
    );
    headers.insert(USER_AGENT, HeaderValue::from_static(YAHOO_USER_AGENT));
    headers
}

async fn fetch_text(client: &reqwest::Client, url: &str) -> Result<String, AppError> {
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|error| AppError::fetch(format!("{url} request failed: {error}")))?;
    let status = response.status();
    if !status.is_success() {
        return Err(AppError::fetch(format!("{url} returned HTTP {status}")));
    }
    response
        .text()
        .await
        .map_err(|error| AppError::fetch(format!("{url} body read failed: {error}")))
}

fn parse_jsonp_payload(content: &str) -> Option<Value> {
    let start = content.find('(')? + 1;
    let end = content.rfind(')')?;
    serde_json::from_str(content[start..end].trim()).ok()
}

fn value_text(value: Option<&Value>) -> Option<String> {
    match value? {
        Value::String(text) => {
            let trimmed = text.trim();
            (!trimmed.is_empty()).then(|| trimmed.to_string())
        }
        Value::Number(number) => Some(number.to_string()),
        _ => None,
    }
}

fn value_number(value: Option<&Value>) -> Option<f64> {
    match value? {
        Value::Number(number) => number.as_f64(),
        Value::String(text) => parse_percent_number(text),
        _ => None,
    }
}

fn parse_percent_number(value: &str) -> Option<f64> {
    let normalized = value.trim().trim_end_matches('%').replace(',', "");
    if normalized.is_empty() || normalized == "--" || normalized == "-" {
        return None;
    }
    normalized.parse::<f64>().ok()
}

fn js_string_var(script: &str, name: &str) -> Option<String> {
    let value = js_var_source(script, name)?;
    let trimmed = value.trim_start();
    if !trimmed.starts_with('"') {
        return None;
    }
    let mut escaped = false;
    for (index, char) in trimmed[1..].char_indices() {
        if escaped {
            escaped = false;
            continue;
        }
        if char == '\\' {
            escaped = true;
            continue;
        }
        if char == '"' {
            let source = &trimmed[..index + 2];
            return serde_json::from_str(source).ok();
        }
    }
    None
}

fn js_value_var(script: &str, name: &str) -> Option<Value> {
    let value = js_var_source(script, name)?;
    let trimmed = value.trim_start();
    let source = js_json_source(trimmed)?;
    serde_json::from_str(source).ok()
}

fn js_var_source<'a>(script: &'a str, name: &str) -> Option<&'a str> {
    let marker = format!("var {name}");
    let marker_index = script.find(&marker)?;
    let after_marker = &script[marker_index + marker.len()..];
    let equals_index = after_marker.find('=')?;
    Some(&after_marker[equals_index + 1..])
}

fn js_json_source(source: &str) -> Option<&str> {
    let first = source.chars().next()?;
    if first != '[' && first != '{' {
        return None;
    }
    let mut depth = 0_i32;
    let mut in_string = false;
    let mut escaped = false;
    for (index, char) in source.char_indices() {
        if in_string {
            if escaped {
                escaped = false;
            } else if char == '\\' {
                escaped = true;
            } else if char == '"' {
                in_string = false;
            }
            continue;
        }
        match char {
            '"' => in_string = true,
            '[' | '{' => depth += 1,
            ']' | '}' => {
                depth -= 1;
                if depth == 0 {
                    return Some(&source[..=index]);
                }
            }
            _ => {}
        }
    }
    None
}

fn asset_allocation_latest(allocation: &Value, label: &str) -> Option<f64> {
    allocation
        .get("series")
        .and_then(Value::as_array)?
        .iter()
        .find(|item| {
            value_text(item.get("name"))
                .as_deref()
                .is_some_and(|name| name.contains(label))
        })
        .and_then(|item| item.get("data"))
        .and_then(Value::as_array)
        .and_then(|items| items.last())
        .and_then(|item| value_number(Some(item)))
}

fn profile_has_csv(profile: &AnalysisProfile) -> bool {
    profile
        .data_dir
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty())
        || profile.symbols.iter().any(|item| {
            item.csv_path
                .as_deref()
                .is_some_and(|value| !value.trim().is_empty())
        })
}

fn load_csv_data(profile: &AnalysisProfile) -> Result<LoadedMarketData, AppError> {
    let mut series = HashMap::new();

    for item in &profile.symbols {
        let path = csv_path_for_symbol(profile, item).ok_or_else(|| {
            AppError::invalid(format!(
                "{} missing csvPath and profile dataDir is not configured",
                item.symbol
            ))
        })?;
        let candles = read_csv_candles(&path)?;
        if candles.len() < MIN_DAILY_BARS {
            return Err(AppError::invalid(format!(
                "{} CSV returned only {} daily bars",
                item.symbol,
                candles.len()
            )));
        }
        series.insert(item.symbol.clone(), candles);
    }

    Ok(LoadedMarketData {
        source: "csv".to_string(),
        source_label: "本地 CSV".to_string(),
        provider_note:
            "本地 CSV 数据源已启用；可由 AkShare、TuShare、交易所文件或付费供应商导出生成。"
                .to_string(),
        series,
    })
}

fn csv_path_for_symbol(profile: &AnalysisProfile, item: &ProfileSymbol) -> Option<PathBuf> {
    if let Some(path) = item
        .csv_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return Some(resolve_profile_path(profile, path));
    }

    let data_dir = profile
        .data_dir
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())?;
    Some(resolve_profile_path(profile, data_dir).join(format!("{}.csv", item.symbol)))
}

fn resolve_profile_path(profile: &AnalysisProfile, value: &str) -> PathBuf {
    let path = Path::new(value);
    if path.is_absolute() {
        path.to_path_buf()
    } else if let Some(base_dir) = &profile.base_dir {
        base_dir.join(path)
    } else {
        path.to_path_buf()
    }
}

fn read_csv_candles(path: &Path) -> Result<Vec<Candle>, AppError> {
    let mut reader = csv::ReaderBuilder::new()
        .flexible(true)
        .from_path(path)
        .map_err(|error| {
            AppError::invalid(format!("CSV open failed for {}: {error}", path.display()))
        })?;
    let headers = reader
        .headers()
        .map_err(|error| {
            AppError::invalid(format!(
                "CSV header read failed for {}: {error}",
                path.display()
            ))
        })?
        .clone();
    let date_index = csv_column_index(
        &headers,
        &[
            "date",
            "datetime",
            "time",
            "timestamp",
            "trade_date",
            "日期",
        ],
    )
    .ok_or_else(|| AppError::invalid(format!("CSV {} missing date column", path.display())))?;
    let open_index = csv_column_index(&headers, &["open", "open_price", "开盘"])
        .ok_or_else(|| AppError::invalid(format!("CSV {} missing open column", path.display())))?;
    let high_index = csv_column_index(&headers, &["high", "high_price", "最高"])
        .ok_or_else(|| AppError::invalid(format!("CSV {} missing high column", path.display())))?;
    let low_index = csv_column_index(&headers, &["low", "low_price", "最低"])
        .ok_or_else(|| AppError::invalid(format!("CSV {} missing low column", path.display())))?;
    let close_index = csv_column_index(&headers, &["close", "close_price", "adj_close", "收盘"])
        .ok_or_else(|| AppError::invalid(format!("CSV {} missing close column", path.display())))?;
    let volume_index = csv_column_index(&headers, &["volume", "vol", "成交量"]);
    let flow_index = csv_column_index(
        &headers,
        &[
            "flow",
            "net_flow",
            "net_inflow",
            "foreign_flow",
            "foreign_net_buy",
            "foreign_net_buying",
            "foreign_net_inflow",
            "外资净买入",
            "外资净流入",
            "净流入",
        ],
    );

    let mut candles = Vec::new();
    for (row_index, record) in reader.records().enumerate() {
        let record = record.map_err(|error| {
            AppError::invalid(format!(
                "CSV record read failed in {} at row {}: {error}",
                path.display(),
                row_index + 2
            ))
        })?;
        let date = parse_csv_date(record.get(date_index)).ok_or_else(|| {
            AppError::invalid(format!(
                "CSV {} row {} has invalid date",
                path.display(),
                row_index + 2
            ))
        })?;
        let open = parse_csv_number(record.get(open_index))
            .ok_or_else(|| csv_number_error(path, row_index + 2, "open"))?;
        let high = parse_csv_number(record.get(high_index))
            .ok_or_else(|| csv_number_error(path, row_index + 2, "high"))?;
        let low = parse_csv_number(record.get(low_index))
            .ok_or_else(|| csv_number_error(path, row_index + 2, "low"))?;
        let close = parse_csv_number(record.get(close_index))
            .ok_or_else(|| csv_number_error(path, row_index + 2, "close"))?;
        let volume = volume_index
            .and_then(|index| parse_csv_number(record.get(index)))
            .unwrap_or(0.0);
        let flow = flow_index.and_then(|index| parse_csv_number(record.get(index)));

        candles.push(Candle {
            date,
            open,
            high,
            low,
            close,
            volume,
            flow,
        });
    }

    candles.sort_by_key(|candle| candle.date);
    candles.dedup_by_key(|candle| candle.date);

    if candles.is_empty() {
        return Err(AppError::invalid(format!(
            "CSV {} returned no usable candles",
            path.display()
        )));
    }

    Ok(candles)
}

fn csv_number_error(path: &Path, row: usize, field: &str) -> AppError {
    AppError::invalid(format!(
        "CSV {} row {} has invalid {field}",
        path.display(),
        row
    ))
}

fn csv_column_index(headers: &StringRecord, aliases: &[&str]) -> Option<usize> {
    headers.iter().position(|header| {
        let normalized = normalize_csv_header(header);
        aliases
            .iter()
            .any(|alias| normalized == normalize_csv_header(alias))
    })
}

fn normalize_csv_header(value: &str) -> String {
    value
        .trim()
        .to_ascii_lowercase()
        .chars()
        .filter(|char| !matches!(char, ' ' | '_' | '-' | '.'))
        .collect()
}

fn parse_csv_date(value: Option<&str>) -> Option<NaiveDate> {
    let value = value?.trim();
    if value.is_empty() {
        return None;
    }

    ["%Y-%m-%d", "%Y/%m/%d", "%Y%m%d", "%d/%m/%Y"]
        .iter()
        .find_map(|format| NaiveDate::parse_from_str(value, format).ok())
}

fn parse_csv_number(value: Option<&str>) -> Option<f64> {
    let value = value?.trim();
    if value.is_empty()
        || matches!(
            value.to_ascii_lowercase().as_str(),
            "null" | "nan" | "none" | "."
        )
    {
        return None;
    }
    let normalized = value.replace(',', "").replace('%', "");
    normalized.parse::<f64>().ok()
}

async fn fetch_hybrid_data(profile: &AnalysisProfile) -> Result<LoadedMarketData, AppError> {
    let mut data = fetch_yahoo_data(profile).await?;
    let (overlays, failures) = overlay_fred_data(profile, &mut data.series).await;

    data.source = "hybrid".to_string();
    data.source_label = hybrid_source_label(profile, &overlays);
    data.provider_note = hybrid_provider_note(profile, &overlays, &failures);

    Ok(data)
}

async fn fetch_china_data_with_cache(
    profile: &AnalysisProfile,
) -> Result<LoadedMarketData, AppError> {
    match fetch_china_data(profile).await {
        Ok(data) => {
            let _ = save_market_data_cache(profile, &data);
            Ok(data)
        }
        Err(fetch_error) => match load_market_data_cache(profile) {
            Ok(mut cached) => {
                cached.provider_note = format!(
                    "{} 实时读取失败，已使用最近有效缓存兜底；原始错误：{}",
                    cached.provider_note, fetch_error.message
                );
                Ok(cached)
            }
            Err(_) => Err(fetch_error),
        },
    }
}

fn save_market_data_cache(
    profile: &AnalysisProfile,
    data: &LoadedMarketData,
) -> Result<(), AppError> {
    let path = market_data_cache_path(&profile.key);
    let snapshot = MarketDataCacheSnapshot {
        version: 1,
        saved_at: Utc::now().to_rfc3339(),
        profile_key: profile.key.clone(),
        data: data.clone(),
    };
    let content = serde_json::to_vec(&snapshot)
        .map_err(|error| AppError::internal(format!("market cache serialize failed: {error}")))?;
    atomic_write(&path, &content, "market cache")
}

fn load_market_data_cache(profile: &AnalysisProfile) -> Result<LoadedMarketData, AppError> {
    let path = market_data_cache_path(&profile.key);
    let content = fs::read(&path)
        .map_err(|error| AppError::fetch(format!("market cache read failed: {error}")))?;
    let snapshot: MarketDataCacheSnapshot = serde_json::from_slice(&content)
        .map_err(|error| AppError::fetch(format!("market cache parse failed: {error}")))?;
    if snapshot.version != 1
        || snapshot.profile_key != profile.key
        || snapshot.data.source != "china"
    {
        return Err(AppError::fetch("market cache identity mismatch"));
    }
    let latest = snapshot
        .data
        .series
        .values()
        .filter_map(|candles| candles.last().map(|candle| candle.date))
        .max()
        .ok_or_else(|| AppError::fetch("market cache has no daily rows"))?;
    let age_days = Utc::now()
        .date_naive()
        .signed_duration_since(latest)
        .num_days();
    if age_days < -1 {
        return Err(AppError::fetch(format!(
            "market cache date is in the future: {latest}"
        )));
    }
    if age_days > 7 {
        return Err(AppError::fetch(format!(
            "market cache is stale: latest {latest}"
        )));
    }
    if profile.symbols.iter().any(|item| {
        snapshot
            .data
            .series
            .get(&item.symbol)
            .is_none_or(|candles| candles.len() < MIN_DAILY_BARS)
    }) {
        return Err(AppError::fetch(
            "market cache does not cover the full Profile",
        ));
    }
    Ok(snapshot.data)
}

fn market_data_cache_path(profile_key: &str) -> PathBuf {
    let base = std::env::var_os("RPORTFOLIO_CACHE_DIR")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("XDG_CACHE_HOME").map(PathBuf::from))
        .or_else(|| {
            std::env::var_os("HOME")
                .map(PathBuf::from)
                .map(|home| home.join("Library").join("Caches"))
        })
        .unwrap_or_else(std::env::temp_dir)
        .join("rportfolio");
    let safe_key = profile_key
        .chars()
        .map(|char| {
            if char.is_ascii_alphanumeric() || char == '-' {
                char
            } else {
                '_'
            }
        })
        .collect::<String>();
    base.join(format!("market-{safe_key}-china.json"))
}

async fn fetch_china_data(profile: &AnalysisProfile) -> Result<LoadedMarketData, AppError> {
    if !profile.market.eq_ignore_ascii_case("cn") {
        return Err(AppError::invalid(
            "A股免费多源仅适用于 market=cn 的 Profile",
        ));
    }
    let eastmoney_client = market_client_builder()
        .default_headers(eastmoney_headers())
        .build()
        .map_err(|error| AppError::internal(format!("Eastmoney client build failed: {error}")))?;
    let sina_client = market_client_builder()
        .user_agent(YAHOO_USER_AGENT)
        .build()
        .map_err(|error| AppError::internal(format!("Sina client build failed: {error}")))?;
    let mut yahoo_headers = HeaderMap::new();
    yahoo_headers.insert(
        ACCEPT,
        HeaderValue::from_static("application/json,text/plain,*/*"),
    );
    yahoo_headers.insert(ACCEPT_LANGUAGE, HeaderValue::from_static("en-US,en;q=0.9"));
    yahoo_headers.insert(
        REFERER,
        HeaderValue::from_static("https://finance.yahoo.com/"),
    );
    let yahoo_client = market_client_builder()
        .user_agent(YAHOO_USER_AGENT)
        .default_headers(yahoo_headers)
        .build()
        .map_err(|error| AppError::internal(format!("Yahoo client build failed: {error}")))?;

    let mut series = HashMap::new();
    let mut domestic_count = 0usize;
    let mut eastmoney_available = true;
    let mut domestic_providers = HashMap::<String, String>::new();
    let mut sina_fallbacks = Vec::new();
    for item in &profile.symbols {
        if let Some(secid) = eastmoney_secid_for_item(item) {
            let eastmoney_result = if eastmoney_available {
                fetch_eastmoney_daily_symbol(&eastmoney_client, &secid, &item.symbol).await
            } else {
                Err(AppError::fetch(
                    "Eastmoney disabled after an earlier request failure",
                ))
            };
            let (candles, provider) = match eastmoney_result {
                Ok(candles) if candles.len() >= MIN_DAILY_BARS => {
                    (candles, "eastmoney".to_string())
                }
                Ok(_) | Err(_) => {
                    eastmoney_available = false;
                    let sina_symbol = sina_symbol_for_item(item).ok_or_else(|| {
                        AppError::fetch(format!("{} has no Sina exchange mapping", item.symbol))
                    })?;
                    let candles =
                        fetch_sina_daily_symbol(&sina_client, &sina_symbol, &item.symbol).await?;
                    sina_fallbacks.push(item.symbol.clone());
                    (candles, "sina".to_string())
                }
            };
            if candles.len() < MIN_DAILY_BARS {
                return Err(AppError::fetch(format!(
                    "{}={} returned only {} China daily bars",
                    item.symbol,
                    secid,
                    candles.len()
                )));
            }
            domestic_count += 1;
            domestic_providers.insert(item.symbol.clone(), provider);
            series.insert(item.symbol.clone(), candles);
        } else {
            let yahoo_symbol = item.yahoo_symbol.as_deref().unwrap_or(&item.symbol);
            let candles = fetch_yahoo_symbol_once(&yahoo_client, yahoo_symbol).await?;
            if candles.len() < MIN_DAILY_BARS {
                return Err(AppError::fetch(format!(
                    "{} returned only {} Yahoo daily bars",
                    item.symbol,
                    candles.len()
                )));
            }
            series.insert(item.symbol.clone(), candles);
        }
    }
    if domestic_count == 0 {
        return Err(AppError::invalid(
            "A股免费多源没有找到 .SS/.SZ/.BJ 的境内标的映射",
        ));
    }

    let cross_check = china_benchmark_cross_check(
        profile,
        &series,
        &domestic_providers,
        &sina_client,
        &yahoo_client,
    )
    .await;
    let fallback_note = if sina_fallbacks.is_empty() {
        "境内标的使用东方财富前复权日线。".to_string()
    } else {
        format!(
            "东方财富不可用，{} 已降级到新浪未复权日线；涉及 {}。",
            sina_fallbacks.len(),
            sina_fallbacks.join(" / ")
        )
    };
    Ok(LoadedMarketData {
        source: "china".to_string(),
        source_label: "A股免费多源".to_string(),
        provider_note: format!("{fallback_note} 离岸标的使用 Yahoo。{cross_check}"),
        series,
    })
}

async fn fetch_eastmoney_daily_symbol(
    client: &reqwest::Client,
    secid: &str,
    app_symbol: &str,
) -> Result<Vec<Candle>, AppError> {
    let response = client
        .get(EASTMONEY_KLINE_URL)
        .query(&[
            ("secid", secid),
            ("klt", "101"),
            ("fqt", "1"),
            ("lmt", "1000"),
            ("end", "20500101"),
            ("fields1", "f1,f2,f3,f4,f5,f6"),
            ("fields2", "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61"),
        ])
        .send()
        .await
        .map_err(|error| {
            AppError::fetch(format!(
                "Eastmoney request failed for {app_symbol}: {error}"
            ))
        })?
        .error_for_status()
        .map_err(|error| {
            AppError::fetch(format!("Eastmoney status failed for {app_symbol}: {error}"))
        })?;
    let value: Value = response.json().await.map_err(|error| {
        AppError::fetch(format!("Eastmoney JSON failed for {app_symbol}: {error}"))
    })?;
    parse_eastmoney_daily_klines(&value, app_symbol)
}

fn parse_eastmoney_daily_klines(value: &Value, app_symbol: &str) -> Result<Vec<Candle>, AppError> {
    let rows = value
        .pointer("/data/klines")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            AppError::fetch(format!(
                "Eastmoney response missing klines for {app_symbol}"
            ))
        })?;
    let mut by_date = BTreeMap::new();
    for row in rows {
        let Some(row) = row.as_str() else { continue };
        let fields = row.split(',').collect::<Vec<_>>();
        if fields.len() < 6 {
            continue;
        }
        let Ok(date) = NaiveDate::parse_from_str(fields[0], "%Y-%m-%d") else {
            continue;
        };
        let Some(open) = parse_csv_number(Some(fields[1])) else {
            continue;
        };
        let Some(close) = parse_csv_number(Some(fields[2])) else {
            continue;
        };
        let Some(high) = parse_csv_number(Some(fields[3])) else {
            continue;
        };
        let Some(low) = parse_csv_number(Some(fields[4])) else {
            continue;
        };
        let Some(volume) = parse_csv_number(Some(fields[5])) else {
            continue;
        };
        if open <= 0.0 || close <= 0.0 || high < open.max(close) || low > open.min(close) {
            continue;
        }
        by_date.insert(
            date,
            Candle {
                date,
                open,
                high,
                low,
                close,
                volume,
                flow: None,
            },
        );
    }
    if by_date.is_empty() {
        return Err(AppError::fetch(format!(
            "Eastmoney returned no usable daily rows for {app_symbol}"
        )));
    }
    Ok(by_date.into_values().collect())
}

async fn fetch_sina_daily_symbol(
    client: &reqwest::Client,
    sina_symbol: &str,
    app_symbol: &str,
) -> Result<Vec<Candle>, AppError> {
    let response = client
        .get(SINA_KLINE_URL)
        .query(&[
            ("symbol", sina_symbol),
            ("scale", "240"),
            ("ma", "no"),
            ("datalen", "1023"),
        ])
        .send()
        .await
        .map_err(|error| AppError::fetch(format!("Sina request failed for {app_symbol}: {error}")))?
        .error_for_status()
        .map_err(|error| {
            AppError::fetch(format!("Sina status failed for {app_symbol}: {error}"))
        })?;
    let value: Value = response
        .json()
        .await
        .map_err(|error| AppError::fetch(format!("Sina JSON failed for {app_symbol}: {error}")))?;
    parse_sina_daily_klines(&value, app_symbol)
}

fn parse_sina_daily_klines(value: &Value, app_symbol: &str) -> Result<Vec<Candle>, AppError> {
    let rows = value
        .pointer("/result/data")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            AppError::fetch(format!("Sina response missing daily rows for {app_symbol}"))
        })?;
    let mut by_date = BTreeMap::new();
    for row in rows {
        let Some(date) = row
            .get("day")
            .and_then(Value::as_str)
            .and_then(|value| NaiveDate::parse_from_str(value, "%Y-%m-%d").ok())
        else {
            continue;
        };
        let number = |key: &str| {
            row.get(key)
                .and_then(Value::as_str)
                .and_then(|value| parse_csv_number(Some(value)))
        };
        let (Some(open), Some(high), Some(low), Some(close), Some(volume)) = (
            number("open"),
            number("high"),
            number("low"),
            number("close"),
            number("volume"),
        ) else {
            continue;
        };
        if open <= 0.0 || close <= 0.0 || high < open.max(close) || low > open.min(close) {
            continue;
        }
        by_date.insert(
            date,
            Candle {
                date,
                open,
                high,
                low,
                close,
                volume,
                flow: None,
            },
        );
    }
    if by_date.is_empty() {
        return Err(AppError::fetch(format!(
            "Sina returned no usable daily rows for {app_symbol}"
        )));
    }
    Ok(by_date.into_values().collect())
}

fn eastmoney_secid_for_item(item: &ProfileSymbol) -> Option<String> {
    let symbol = item.yahoo_symbol.as_deref().unwrap_or(&item.symbol).trim();
    let upper = symbol.to_ascii_uppercase();
    for (suffix, market) in [(".SS", "1"), (".SZ", "0"), (".BJ", "0")] {
        if upper.ends_with(suffix) {
            let code = &symbol[..symbol.len().saturating_sub(suffix.len())];
            if code.len() == 6 && code.chars().all(|char| char.is_ascii_digit()) {
                return Some(format!("{market}.{code}"));
            }
        }
    }
    None
}

fn sina_symbol_for_item(item: &ProfileSymbol) -> Option<String> {
    let symbol = item.yahoo_symbol.as_deref().unwrap_or(&item.symbol).trim();
    let upper = symbol.to_ascii_uppercase();
    for (suffix, market) in [(".SS", "sh"), (".SZ", "sz"), (".BJ", "bj")] {
        if upper.ends_with(suffix) {
            let code = &symbol[..symbol.len().saturating_sub(suffix.len())];
            if code.len() == 6 && code.chars().all(|char| char.is_ascii_digit()) {
                return Some(format!("{market}{code}"));
            }
        }
    }
    None
}

async fn china_benchmark_cross_check(
    profile: &AnalysisProfile,
    series: &HashMap<String, Vec<Candle>>,
    domestic_providers: &HashMap<String, String>,
    sina_client: &reqwest::Client,
    yahoo_client: &reqwest::Client,
) -> String {
    let Some(item) = profile
        .symbols
        .iter()
        .find(|item| item.symbol == profile.benchmark)
    else {
        return "交叉校验未完成：Profile 未配置基准标的。".to_string();
    };
    if eastmoney_secid_for_item(item).is_none() {
        return "交叉校验未完成：核心基准不是境内证券。".to_string();
    }
    let primary_provider = domestic_providers
        .get(&item.symbol)
        .map(String::as_str)
        .unwrap_or("unknown");
    let (secondary_label, secondary) = if primary_provider == "eastmoney" {
        let Some(sina_symbol) = sina_symbol_for_item(item) else {
            return "交叉校验未完成：核心基准缺少新浪映射。".to_string();
        };
        match fetch_sina_daily_symbol(sina_client, &sina_symbol, &item.symbol).await {
            Ok(candles) => ("新浪", candles),
            Err(error) => {
                return format!("交叉校验未完成：新浪基准数据不可用（{}）。", error.message)
            }
        }
    } else {
        let yahoo_symbol = item.yahoo_symbol.as_deref().unwrap_or(&item.symbol);
        match fetch_yahoo_symbol_once(yahoo_client, yahoo_symbol).await {
            Ok(candles) => ("Yahoo", candles),
            Err(error) => {
                return format!(
                    "交叉校验未完成：Yahoo 基准数据不可用（{}）。",
                    error.message
                )
            }
        }
    };
    let Some(primary) = series.get(&item.symbol) else {
        return "一致性异常：东方财富基准序列缺失。".to_string();
    };
    let Some((date, primary_close, secondary_close)) = latest_common_close(primary, &secondary)
    else {
        return "交叉校验未完成：两个来源没有共同交易日。".to_string();
    };
    let difference_pct = ((primary_close / secondary_close) - 1.0).abs() * 100.0;
    if difference_pct > 2.0 {
        format!(
            "一致性异常：{} 在 {} 的境内主源/{} 收盘价差 {:.2}%，已阻断风险加仓。",
            item.symbol, date, secondary_label, difference_pct
        )
    } else {
        format!(
            "核心基准交叉校验通过：{} 在 {} 的双源收盘价差 {:.2}%。",
            item.symbol, date, difference_pct
        )
    }
}

fn latest_common_close(primary: &[Candle], secondary: &[Candle]) -> Option<(NaiveDate, f64, f64)> {
    let secondary_by_date = secondary
        .iter()
        .map(|candle| (candle.date, candle.close))
        .collect::<HashMap<_, _>>();
    primary.iter().rev().find_map(|candle| {
        secondary_by_date
            .get(&candle.date)
            .copied()
            .map(|secondary_close| (candle.date, candle.close, secondary_close))
    })
}

#[derive(Debug, Clone)]
struct StooqSymbolPlan {
    app_symbol: String,
    stooq_symbol: String,
    first_page: StooqHistoryPage,
}

#[derive(Debug, Clone)]
struct StooqHistoryPage {
    candles: Vec<Candle>,
    page_count: usize,
    limit_exceeded: bool,
}

async fn fetch_stooq_data(profile: &AnalysisProfile) -> Result<LoadedMarketData, AppError> {
    let mut headers = HeaderMap::new();
    headers.insert(ACCEPT, HeaderValue::from_static("text/html,*/*"));
    headers.insert(ACCEPT_LANGUAGE, HeaderValue::from_static("en-US,en;q=0.9"));
    headers.insert(REFERER, HeaderValue::from_static("https://stooq.com/"));
    let client = market_client_builder()
        .user_agent(YAHOO_USER_AGENT)
        .default_headers(headers)
        .build()
        .map_err(|error| AppError::internal(error.to_string()))?;
    let mut plans = Vec::new();

    for item in &profile.symbols {
        let stooq_symbol = stooq_symbol_for_item(item);
        let first_page = fetch_stooq_history_page(&client, &stooq_symbol, 1).await?;
        if first_page.limit_exceeded {
            return Err(AppError::fetch(
                "Stooq daily site hits limit exceeded; try Yahoo/FRED or CSV",
            ));
        }
        let available_bars = stooq_available_bars(&first_page);
        if available_bars < MIN_DAILY_BARS {
            return Err(AppError::fetch(format!(
                "{}={} has only about {} daily bars on Stooq",
                item.symbol, stooq_symbol, available_bars
            )));
        }
        if first_page.candles.is_empty() {
            return Err(AppError::fetch(format!(
                "{}={} returned no usable Stooq history rows",
                item.symbol, stooq_symbol
            )));
        }
        plans.push(StooqSymbolPlan {
            app_symbol: item.symbol.clone(),
            stooq_symbol,
            first_page,
        });
    }

    let mut series = HashMap::new();
    for plan in plans {
        let mut by_date = BTreeMap::new();
        for candle in plan.first_page.candles {
            by_date.insert(candle.date, candle);
        }

        let page_limit = plan.first_page.page_count.min(STOOQ_MAX_PAGES).max(1);
        for page in 2..=page_limit {
            if by_date.len() >= MIN_DAILY_BARS {
                break;
            }
            let next_page = fetch_stooq_history_page(&client, &plan.stooq_symbol, page).await?;
            if next_page.limit_exceeded {
                return Err(AppError::fetch(
                    "Stooq daily site hits limit exceeded while stitching history pages",
                ));
            }
            for candle in next_page.candles {
                by_date.insert(candle.date, candle);
            }
        }

        let candles = by_date.into_values().collect::<Vec<_>>();
        if candles.len() < MIN_DAILY_BARS {
            return Err(AppError::fetch(format!(
                "{}={} returned only {} daily bars after paging",
                plan.app_symbol,
                plan.stooq_symbol,
                candles.len()
            )));
        }
        series.insert(plan.app_symbol, candles);
    }

    Ok(LoadedMarketData {
        source: "stooq".to_string(),
        source_label: stooq_source_label(profile),
        provider_note: stooq_provider_note(profile),
        series,
    })
}

async fn fetch_stooq_history_page(
    client: &reqwest::Client,
    stooq_symbol: &str,
    page: usize,
) -> Result<StooqHistoryPage, AppError> {
    let page_string = page.to_string();
    let response = client
        .get(STOOQ_HISTORY_URL)
        .query(&[("s", stooq_symbol), ("i", "d"), ("l", &page_string)])
        .send()
        .await
        .map_err(|error| {
            AppError::fetch(format!("Stooq request failed for {stooq_symbol}: {error}"))
        })?
        .error_for_status()
        .map_err(|error| {
            AppError::fetch(format!(
                "Stooq returned an error for {stooq_symbol}: {error}"
            ))
        })?;
    let content = response.text().await.map_err(|error| {
        AppError::fetch(format!(
            "Stooq response read failed for {stooq_symbol}: {error}"
        ))
    })?;

    parse_stooq_history_page(&content, stooq_symbol)
}

fn stooq_available_bars(page: &StooqHistoryPage) -> usize {
    if page.page_count == 0 || page.candles.is_empty() {
        return page.candles.len();
    }
    (page.page_count.saturating_sub(1) * STOOQ_ROWS_PER_PAGE) + page.candles.len()
}

fn parse_stooq_history_page(
    content: &str,
    stooq_symbol: &str,
) -> Result<StooqHistoryPage, AppError> {
    let limit_exceeded = stooq_limit_exceeded(content);
    if limit_exceeded {
        return Ok(StooqHistoryPage {
            candles: Vec::new(),
            page_count: 0,
            limit_exceeded: true,
        });
    }

    let Some(table) = stooq_history_table(content) else {
        return Ok(StooqHistoryPage {
            candles: Vec::new(),
            page_count: 0,
            limit_exceeded: false,
        });
    };

    let mut candles = Vec::new();
    let mut rest = table;
    while let Some(row_start) = rest.find("<tr") {
        let row_and_after = &rest[row_start..];
        let Some(row_end) = row_and_after.find("</tr>") else {
            break;
        };
        let row = &row_and_after[..row_end + "</tr>".len()];
        let cells = extract_html_cells(row);
        if let Some(candle) = stooq_candle_from_cells(&cells) {
            candles.push(candle);
        }
        rest = &row_and_after[row_end + "</tr>".len()..];
    }

    candles.sort_by_key(|candle| candle.date);
    candles.dedup_by_key(|candle| candle.date);
    if candles.is_empty() && content.contains("Historical values") {
        return Err(AppError::fetch(format!(
            "Stooq history table for {stooq_symbol} contained no usable rows"
        )));
    }

    Ok(StooqHistoryPage {
        candles,
        page_count: stooq_page_count(content),
        limit_exceeded: false,
    })
}

fn stooq_limit_exceeded(content: &str) -> bool {
    let lower = content.to_ascii_lowercase();
    lower.contains("exceeded the daily site hits limit")
        || lower.contains("the data has been hidden")
        || lower.contains("unlock access")
}

fn stooq_history_table(content: &str) -> Option<&str> {
    let id_index = content
        .find("id=fth1")
        .or_else(|| content.find("id=\"fth1\""))?;
    let table_start = content[..id_index].rfind("<table").unwrap_or(id_index);
    let after_start = &content[table_start..];
    let table_end = after_start.find("</table>")? + "</table>".len();
    Some(&after_start[..table_end])
}

fn extract_html_cells(row: &str) -> Vec<String> {
    let mut cells = Vec::new();
    let mut rest = row;
    while let Some(cell_start) = rest.find("<td") {
        let cell_and_after = &rest[cell_start..];
        let Some(open_end) = cell_and_after.find('>') else {
            break;
        };
        let cell_body_and_after = &cell_and_after[open_end + 1..];
        let Some(close_start) = cell_body_and_after.find("</td>") else {
            break;
        };
        cells.push(clean_html_text(&cell_body_and_after[..close_start]));
        rest = &cell_body_and_after[close_start + "</td>".len()..];
    }
    cells
}

fn clean_html_text(value: &str) -> String {
    let mut plain = String::new();
    let mut in_tag = false;
    for ch in value.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => plain.push(ch),
            _ => {}
        }
    }

    let decoded = plain
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#039;", "'");
    decoded.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[derive(Debug, Default, PartialEq)]
struct FundTransactionStatus {
    label: String,
    purchase_open: Option<bool>,
    purchase_limit: Option<f64>,
    redemption_open: Option<bool>,
}

#[derive(Debug, Default, PartialEq)]
struct FundHoldingsSnapshot {
    as_of: Option<String>,
    holdings: Vec<FundHoldingSeed>,
}

fn parse_fund_top_holdings(content: &str) -> FundHoldingsSnapshot {
    let as_of = first_iso_date(content);
    let Some(body_start) = content.find("<tbody>") else {
        return FundHoldingsSnapshot {
            as_of,
            holdings: Vec::new(),
        };
    };
    let after_start = &content[body_start + "<tbody>".len()..];
    let body = after_start
        .find("</tbody>")
        .map(|end| &after_start[..end])
        .unwrap_or(after_start);
    let mut holdings = Vec::new();
    let mut rest = body;
    while let Some(row_start) = rest.find("<tr") {
        let row_and_after = &rest[row_start..];
        let Some(row_end) = row_and_after.find("</tr>") else {
            break;
        };
        let row = &row_and_after[..row_end + "</tr>".len()];
        let cells = extract_html_cells(row);
        if cells.len() >= 7 {
            let symbol = cells[1].trim().to_ascii_uppercase();
            let name = cells[2].trim().to_string();
            let weight = parse_percent_number(&cells[6]);
            if !symbol.is_empty() && !name.is_empty() {
                if let Some(weight) = weight.filter(|value| *value > 0.0) {
                    holdings.push(FundHoldingSeed {
                        symbol,
                        name,
                        weight: round(weight, 2),
                    });
                }
            }
        }
        rest = &row_and_after[row_end + "</tr>".len()..];
        if holdings.len() >= 10 {
            break;
        }
    }
    FundHoldingsSnapshot { as_of, holdings }
}

fn parse_fund_redemption_fees(content: &str) -> Vec<FundRedemptionFeeTier> {
    let Some(marker) = content
        .find("name=\"shfl\"")
        .or_else(|| content.find("赎回费率"))
    else {
        return Vec::new();
    };
    let after_marker = &content[marker..];
    let Some(body_start) = after_marker.find("<tbody>") else {
        return Vec::new();
    };
    let after_start = &after_marker[body_start + "<tbody>".len()..];
    let body = after_start
        .find("</tbody>")
        .map(|end| &after_start[..end])
        .unwrap_or(after_start);
    let mut tiers = Vec::new();
    let mut rest = body;
    while let Some(row_start) = rest.find("<tr") {
        let row_and_after = &rest[row_start..];
        let Some(row_end) = row_and_after.find("</tr>") else {
            break;
        };
        let cells = extract_html_cells(&row_and_after[..row_end + "</tr>".len()]);
        if cells.len() >= 2 {
            let label = cells[0].trim().to_string();
            if let Some(rate) = parse_percent_number(&cells[1]) {
                let (min_days, max_days_exclusive) = parse_holding_day_range(&label);
                tiers.push(FundRedemptionFeeTier {
                    label,
                    min_days,
                    max_days_exclusive,
                    rate: round(rate, 4),
                });
            }
        }
        rest = &row_and_after[row_end + "</tr>".len()..];
    }
    tiers
}

fn parse_holding_day_range(label: &str) -> (Option<u32>, Option<u32>) {
    let numbers = unsigned_numbers(label);
    if numbers.is_empty() {
        return (None, None);
    }
    let has_lower = label.contains("大于等于") || label.contains('≥') || label.contains('≤');
    let has_upper = label.contains("小于") || label.contains('＜') || label.contains('<');
    if has_lower && has_upper && numbers.len() >= 2 {
        return (Some(numbers[0]), Some(numbers[1]));
    }
    if has_upper || label.contains("以内") {
        return (Some(0), Some(numbers[0]));
    }
    if has_lower || label.contains("以上") {
        return (Some(numbers[0]), None);
    }
    (None, None)
}

fn unsigned_numbers(value: &str) -> Vec<u32> {
    let mut numbers = Vec::new();
    let mut current = String::new();
    for character in value.chars() {
        if character.is_ascii_digit() {
            current.push(character);
        } else if !current.is_empty() {
            if let Ok(number) = current.parse::<u32>() {
                numbers.push(number);
            }
            current.clear();
        }
    }
    if !current.is_empty() {
        if let Ok(number) = current.parse::<u32>() {
            numbers.push(number);
        }
    }
    numbers
}

fn first_iso_date(content: &str) -> Option<String> {
    let bytes = content.as_bytes();
    for start in 0..bytes.len().saturating_sub(9) {
        let value = &bytes[start..start + 10];
        if value[0..4].iter().all(u8::is_ascii_digit)
            && value[4] == b'-'
            && value[5..7].iter().all(u8::is_ascii_digit)
            && value[7] == b'-'
            && value[8..10].iter().all(u8::is_ascii_digit)
        {
            return String::from_utf8(value.to_vec()).ok();
        }
    }
    None
}

fn parse_fund_transaction_status(content: &str) -> FundTransactionStatus {
    let Some(start) = content.find("交易状态") else {
        return FundTransactionStatus::default();
    };
    let excerpt = content[start..].chars().take(4_000).collect::<String>();
    let mut plain = clean_html_text(&excerpt);
    for marker in ["购买手续费", "申购费率", "赎回费率", "基金转换"] {
        if let Some(index) = plain.find(marker) {
            plain.truncate(index);
        }
    }

    let purchase_open = if plain.contains("暂停申购")
        || plain.contains("暂停购买")
        || plain.contains("封闭期")
    {
        Some(false)
    } else if plain.contains("开放申购") || plain.contains("开放购买") || plain.contains("限大额")
    {
        Some(true)
    } else {
        None
    };
    let redemption_open = if plain.contains("暂停赎回") {
        Some(false)
    } else if plain.contains("开放赎回") {
        Some(true)
    } else {
        None
    };
    let purchase_limit = ["单日累计购买上限", "单日申购上限", "单日累计申购上限"]
        .iter()
        .find_map(|marker| parse_chinese_money_after(&plain, marker));
    let purchase_label = match (purchase_open, purchase_limit) {
        (Some(false), _) => "暂停申购".to_string(),
        (Some(true), Some(limit)) => format!("限购 {}", format_cny_amount(limit)),
        (Some(true), None) => "开放申购".to_string(),
        (None, _) => "申购待确认".to_string(),
    };
    let redemption_label = match redemption_open {
        Some(true) => "开放赎回",
        Some(false) => "暂停赎回",
        None => "赎回待确认",
    };

    FundTransactionStatus {
        label: format!("{purchase_label} · {redemption_label}"),
        purchase_open,
        purchase_limit,
        redemption_open,
    }
}

fn parse_chinese_money_after(content: &str, marker: &str) -> Option<f64> {
    let after = content.split_once(marker)?.1;
    let number_start = after.find(|ch: char| ch.is_ascii_digit())?;
    let raw_numeric = after[number_start..]
        .chars()
        .take_while(|ch| ch.is_ascii_digit() || *ch == '.' || *ch == ',')
        .collect::<String>();
    let numeric = raw_numeric.replace(',', "");
    let value = numeric.parse::<f64>().ok()?;
    let suffix = &after[number_start + raw_numeric.len()..];
    let multiplier = if suffix.trim_start().starts_with("亿元") {
        100_000_000.0
    } else if suffix.trim_start().starts_with("万元") {
        10_000.0
    } else {
        1.0
    };
    Some(value * multiplier)
}

fn format_cny_amount(value: f64) -> String {
    if value >= 10_000.0 && value % 10_000.0 == 0.0 {
        format!("¥{}万/日", value / 10_000.0)
    } else if value.fract() == 0.0 {
        format!("¥{value:.0}/日")
    } else {
        format!("¥{value:.2}/日")
    }
}

fn stooq_candle_from_cells(cells: &[String]) -> Option<Candle> {
    if cells.len() < 6 {
        return None;
    }
    let date = parse_stooq_date(cells.get(1)?)?;
    let open = parse_csv_number(cells.get(2).map(String::as_str))?;
    let high = parse_csv_number(cells.get(3).map(String::as_str))?;
    let low = parse_csv_number(cells.get(4).map(String::as_str))?;
    let close = parse_csv_number(cells.get(5).map(String::as_str))?;
    let volume = cells
        .get(8)
        .and_then(|value| parse_csv_number(Some(value.as_str())))
        .unwrap_or(0.0);

    Some(Candle {
        date,
        open,
        high,
        low,
        close,
        volume,
        flow: None,
    })
}

fn parse_stooq_date(value: &str) -> Option<NaiveDate> {
    let parts = value.split_whitespace().collect::<Vec<_>>();
    if parts.len() != 3 {
        return None;
    }
    let day = parts[0].parse::<u32>().ok()?;
    let month = month_number(parts[1])?;
    let year = parts[2].parse::<i32>().ok()?;
    NaiveDate::from_ymd_opt(year, month, day)
}

fn month_number(value: &str) -> Option<u32> {
    let month = value.to_ascii_lowercase();
    match month.as_str() {
        "jan" | "january" | "sty" => Some(1),
        "feb" | "february" | "lut" => Some(2),
        "mar" | "march" => Some(3),
        "apr" | "april" | "kwi" => Some(4),
        "may" | "maj" => Some(5),
        "jun" | "june" | "cze" => Some(6),
        "jul" | "july" | "lip" => Some(7),
        "aug" | "august" | "sie" => Some(8),
        "sep" | "sept" | "september" | "wrz" => Some(9),
        "oct" | "october" | "paź" | "paz" => Some(10),
        "nov" | "november" | "lis" => Some(11),
        "dec" | "december" | "gru" => Some(12),
        _ => None,
    }
}

fn stooq_page_count(content: &str) -> usize {
    let mut max_page = 0;
    let mut rest = content;
    while let Some(index) = rest.find("&l=") {
        let after = &rest[index + 3..];
        let digits = after
            .chars()
            .take_while(|ch| ch.is_ascii_digit())
            .collect::<String>();
        if let Ok(page) = digits.parse::<usize>() {
            max_page = max_page.max(page);
        }
        rest = after;
    }
    max_page.max(1)
}

fn stooq_symbol_for_item(item: &ProfileSymbol) -> String {
    if let Some(symbol) = item
        .stooq_symbol
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return symbol.to_ascii_lowercase();
    }

    item.yahoo_symbol
        .as_deref()
        .or(Some(item.symbol.as_str()))
        .map(infer_stooq_symbol)
        .unwrap_or_else(|| item.symbol.to_ascii_lowercase())
}

fn infer_stooq_symbol(symbol: &str) -> String {
    let value = symbol.trim();
    let upper = value.to_ascii_uppercase();
    match upper.as_str() {
        "DX-Y.NYB" => return "dx.f".to_string(),
        "KRW=X" => return "usdkrw".to_string(),
        "^KS11" => return "^kospi".to_string(),
        _ => {}
    }

    if upper.starts_with('^') {
        return upper.to_ascii_lowercase();
    }
    if upper.ends_with(".HK") {
        return format!("{}.hk", &value[..value.len().saturating_sub(3)]).to_ascii_lowercase();
    }
    if upper.ends_with(".KS") {
        return format!("{}.kr", &value[..value.len().saturating_sub(3)]).to_ascii_lowercase();
    }
    if upper.ends_with(".SS") || upper.ends_with(".SZ") {
        return format!("{}.cn", &value[..value.len().saturating_sub(3)]).to_ascii_lowercase();
    }
    if upper.ends_with(".US") {
        return value.to_ascii_lowercase();
    }
    if upper.contains('.') || upper.contains('=') {
        return value.to_ascii_lowercase();
    }
    format!("{}.us", value.to_ascii_lowercase())
}

fn stooq_source_label(profile: &AnalysisProfile) -> String {
    if profile
        .symbols
        .iter()
        .any(|item| item.symbol == profile.benchmark && stooq_symbol_differs(item))
    {
        "Stooq HTML · Proxy".to_string()
    } else {
        "Stooq HTML".to_string()
    }
}

fn stooq_provider_note(profile: &AnalysisProfile) -> String {
    let mut note = format!(
        "Stooq 历史页表格源已启用：每个 symbol 先验证至少 {} 条日线，再抓取最多 {} 页并按日期拼接。Stooq 页面存在日访问限制，限流时建议切回 Yahoo/FRED 或本地 CSV。",
        MIN_DAILY_BARS, STOOQ_MAX_PAGES
    );
    let mappings = profile
        .symbols
        .iter()
        .filter(|item| stooq_symbol_differs(item))
        .map(|item| format!("{}={}", item.symbol, stooq_symbol_for_item(item)))
        .collect::<Vec<_>>();
    if !mappings.is_empty() {
        note.push_str(" Stooq 映射：");
        note.push_str(&mappings.join("；"));
        note.push('。');
    }
    note
}

fn stooq_symbol_differs(item: &ProfileSymbol) -> bool {
    stooq_symbol_for_item(item) != item.symbol.to_ascii_lowercase()
}

async fn overlay_fred_data(
    profile: &AnalysisProfile,
    series: &mut HashMap<String, Vec<Candle>>,
) -> (Vec<String>, Vec<String>) {
    let fred_symbols = profile
        .symbols
        .iter()
        .filter_map(|item| {
            item.fred_symbol
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(|fred_symbol| (item, fred_symbol.to_string()))
        })
        .collect::<Vec<_>>();

    if fred_symbols.is_empty() {
        return (Vec::new(), Vec::new());
    }

    let client = match market_client_builder().user_agent(YAHOO_USER_AGENT).build() {
        Ok(client) => client,
        Err(error) => return (Vec::new(), vec![format!("FRED client: {error}")]),
    };
    let mut overlays = Vec::new();
    let mut failures = Vec::new();

    for (item, fred_symbol) in fred_symbols {
        match fetch_fred_symbol(&client, &fred_symbol).await {
            Ok(candles) if candles.len() >= MIN_DAILY_BARS => {
                series.insert(item.symbol.clone(), candles);
                overlays.push(format!("{}={}", item.symbol, fred_symbol));
            }
            Ok(candles) => failures.push(format!(
                "{}={} only {} daily bars",
                item.symbol,
                fred_symbol,
                candles.len()
            )),
            Err(error) => failures.push(format!(
                "{}={}: {}",
                item.symbol, fred_symbol, error.message
            )),
        }
    }

    (overlays, failures)
}

async fn fetch_fred_symbol(
    client: &reqwest::Client,
    fred_symbol: &str,
) -> Result<Vec<Candle>, AppError> {
    let response = client
        .get(FRED_GRAPH_CSV_URL)
        .query(&[("id", fred_symbol)])
        .send()
        .await
        .map_err(|error| {
            AppError::fetch(format!("FRED request failed for {fred_symbol}: {error}"))
        })?
        .error_for_status()
        .map_err(|error| {
            AppError::fetch(format!("FRED returned an error for {fred_symbol}: {error}"))
        })?;
    let content = response.text().await.map_err(|error| {
        AppError::fetch(format!(
            "FRED response read failed for {fred_symbol}: {error}"
        ))
    })?;

    parse_fred_csv(&content, fred_symbol)
}

fn parse_fred_csv(content: &str, fred_symbol: &str) -> Result<Vec<Candle>, AppError> {
    let mut reader = csv::ReaderBuilder::new()
        .flexible(true)
        .from_reader(content.as_bytes());
    let headers = reader
        .headers()
        .map_err(|error| {
            AppError::fetch(format!(
                "FRED CSV header read failed for {fred_symbol}: {error}"
            ))
        })?
        .clone();
    let date_index = csv_column_index(&headers, &["observation_date", "date"])
        .ok_or_else(|| AppError::fetch(format!("FRED CSV missing date for {fred_symbol}")))?;
    let value_index = headers
        .iter()
        .position(|header| header.trim().eq_ignore_ascii_case(fred_symbol))
        .or_else(|| (headers.len() > 1).then_some(1))
        .ok_or_else(|| AppError::fetch(format!("FRED CSV missing value for {fred_symbol}")))?;
    let mut candles = Vec::new();

    for record in reader.records() {
        let record = record.map_err(|error| {
            AppError::fetch(format!(
                "FRED CSV row read failed for {fred_symbol}: {error}"
            ))
        })?;
        let Some(date) = parse_csv_date(record.get(date_index)) else {
            continue;
        };
        let Some(close) = parse_csv_number(record.get(value_index)) else {
            continue;
        };
        candles.push(Candle {
            date,
            open: close,
            high: close,
            low: close,
            close,
            volume: 0.0,
            flow: None,
        });
    }

    candles.sort_by_key(|candle| candle.date);
    candles.dedup_by_key(|candle| candle.date);

    if candles.is_empty() {
        return Err(AppError::fetch(format!(
            "FRED returned no usable observations for {fred_symbol}"
        )));
    }

    Ok(candles)
}

fn hybrid_source_label(profile: &AnalysisProfile, overlays: &[String]) -> String {
    if overlays.is_empty() {
        return yahoo_source_label(profile);
    }

    if profile
        .symbols
        .iter()
        .any(|item| item.symbol == profile.benchmark && yahoo_symbol_differs(item))
    {
        "Yahoo/FRED · Proxy".to_string()
    } else {
        "Yahoo/FRED".to_string()
    }
}

fn hybrid_provider_note(
    profile: &AnalysisProfile,
    overlays: &[String],
    failures: &[String],
) -> String {
    let mut note = yahoo_provider_note(profile);

    if !overlays.is_empty() {
        note.push_str(" FRED 覆盖：");
        note.push_str(&overlays.join("；"));
        note.push('。');
    }

    if !failures.is_empty() {
        note.push_str(" FRED 覆盖失败，已保留 Yahoo 数据：");
        note.push_str(&failures.join("；"));
        note.push('。');
    }

    note
}

async fn fetch_yahoo_data(profile: &AnalysisProfile) -> Result<LoadedMarketData, AppError> {
    let mut headers = HeaderMap::new();
    headers.insert(
        ACCEPT,
        HeaderValue::from_static("application/json,text/plain,*/*"),
    );
    headers.insert(ACCEPT_LANGUAGE, HeaderValue::from_static("en-US,en;q=0.9"));
    headers.insert(
        REFERER,
        HeaderValue::from_static("https://finance.yahoo.com/"),
    );
    let client = market_client_builder()
        .user_agent(YAHOO_USER_AGENT)
        .default_headers(headers)
        .build()
        .map_err(|error| AppError::internal(error.to_string()))?;
    let mut series = HashMap::new();

    for item in &profile.symbols {
        let yahoo_symbol = item.yahoo_symbol.as_deref().unwrap_or(&item.symbol);
        let candles = fetch_yahoo_symbol(&client, yahoo_symbol).await?;
        if candles.len() < MIN_DAILY_BARS {
            return Err(AppError::fetch(format!(
                "{} returned only {} daily bars",
                item.symbol,
                candles.len()
            )));
        }
        series.insert(item.symbol.clone(), candles);
    }

    Ok(LoadedMarketData {
        source: "yahoo".to_string(),
        source_label: yahoo_source_label(profile),
        provider_note: yahoo_provider_note(profile),
        series,
    })
}

async fn fetch_yahoo_symbol(
    client: &reqwest::Client,
    yahoo_symbol: &str,
) -> Result<Vec<Candle>, AppError> {
    let encoded_symbol = encode_url_path_segment(yahoo_symbol);
    let mut last_error = None;

    for host in YAHOO_CHART_HOSTS {
        let url = format!("https://{host}/v8/finance/chart/{encoded_symbol}");
        for _ in 0..3 {
            let response = match client
                .get(&url)
                .query(&[
                    ("range", HISTORY_RANGE),
                    ("interval", "1d"),
                    ("includePrePost", "false"),
                ])
                .send()
                .await
            {
                Ok(response) => response,
                Err(error) => {
                    last_error = Some(error.to_string());
                    continue;
                }
            };
            let response = match response.error_for_status() {
                Ok(response) => response,
                Err(error) => {
                    last_error = Some(error.to_string());
                    continue;
                }
            };
            let value: Value = match response.json().await {
                Ok(value) => value,
                Err(error) => {
                    last_error = Some(error.to_string());
                    continue;
                }
            };
            match parse_yahoo_chart(&value, yahoo_symbol) {
                Ok(candles) => return Ok(candles),
                Err(error) => {
                    last_error = Some(error.message);
                    continue;
                }
            }
        }
    }

    Err(AppError::fetch(last_error.unwrap_or_else(|| {
        format!("Yahoo request failed for {yahoo_symbol}")
    })))
}

async fn fetch_yahoo_symbol_once(
    client: &reqwest::Client,
    yahoo_symbol: &str,
) -> Result<Vec<Candle>, AppError> {
    let encoded_symbol = encode_url_path_segment(yahoo_symbol);
    let url = format!(
        "https://{}/v8/finance/chart/{encoded_symbol}",
        YAHOO_CHART_HOSTS[0]
    );
    let response = client
        .get(&url)
        .query(&[
            ("range", HISTORY_RANGE),
            ("interval", "1d"),
            ("includePrePost", "false"),
        ])
        .send()
        .await
        .map_err(|error| {
            AppError::fetch(format!("Yahoo request failed for {yahoo_symbol}: {error}"))
        })?
        .error_for_status()
        .map_err(|error| {
            AppError::fetch(format!("Yahoo status failed for {yahoo_symbol}: {error}"))
        })?;
    let value: Value = response.json().await.map_err(|error| {
        AppError::fetch(format!("Yahoo JSON failed for {yahoo_symbol}: {error}"))
    })?;
    parse_yahoo_chart(&value, yahoo_symbol)
}

fn yahoo_source_label(profile: &AnalysisProfile) -> String {
    if profile
        .symbols
        .iter()
        .any(|item| item.symbol == profile.benchmark && yahoo_symbol_differs(item))
    {
        "Yahoo Finance · Proxy".to_string()
    } else {
        "Yahoo Finance".to_string()
    }
}

fn yahoo_provider_note(profile: &AnalysisProfile) -> String {
    let mut note = "本地工具默认使用 Yahoo Finance 非官方 chart 接口；正式长期运行建议接入 Alpha Vantage、Polygon 或 Twelve Data。".to_string();
    let mappings = profile
        .symbols
        .iter()
        .filter(|item| yahoo_symbol_differs(item))
        .map(|item| {
            format!(
                "{}={}",
                item.symbol,
                item.yahoo_symbol.as_deref().unwrap_or(&item.symbol)
            )
        })
        .collect::<Vec<_>>();

    if !mappings.is_empty() {
        note.push_str(" Yahoo 映射：");
        note.push_str(&mappings.join("；"));
        note.push('。');
    }

    note
}

fn yahoo_symbol_differs(item: &ProfileSymbol) -> bool {
    item.yahoo_symbol
        .as_deref()
        .is_some_and(|symbol| symbol != item.symbol)
}

fn encode_url_path_segment(value: &str) -> String {
    let mut encoded = String::new();
    for byte in value.bytes() {
        let keep = byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~');
        if keep {
            encoded.push(byte as char);
        } else {
            encoded.push_str(&format!("%{byte:02X}"));
        }
    }
    encoded
}

fn parse_yahoo_chart(value: &Value, yahoo_symbol: &str) -> Result<Vec<Candle>, AppError> {
    if !value
        .pointer("/chart/error")
        .map(|error| error.is_null())
        .unwrap_or(true)
    {
        return Err(AppError::fetch(format!(
            "Yahoo returned an error for {yahoo_symbol}"
        )));
    }

    let result = value.pointer("/chart/result/0").ok_or_else(|| {
        AppError::fetch(format!("Yahoo response missing result for {yahoo_symbol}"))
    })?;
    let timestamps = result
        .get("timestamp")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            AppError::fetch(format!(
                "Yahoo response missing timestamps for {yahoo_symbol}"
            ))
        })?;
    let quote = result.pointer("/indicators/quote/0").ok_or_else(|| {
        AppError::fetch(format!(
            "Yahoo response missing quote data for {yahoo_symbol}"
        ))
    })?;
    let opens = quote
        .get("open")
        .and_then(Value::as_array)
        .ok_or_else(|| AppError::fetch("Yahoo response missing opens"))?;
    let highs = quote
        .get("high")
        .and_then(Value::as_array)
        .ok_or_else(|| AppError::fetch("Yahoo response missing highs"))?;
    let lows = quote
        .get("low")
        .and_then(Value::as_array)
        .ok_or_else(|| AppError::fetch("Yahoo response missing lows"))?;
    let closes = quote
        .get("close")
        .and_then(Value::as_array)
        .ok_or_else(|| AppError::fetch("Yahoo response missing closes"))?;
    let volumes = quote
        .get("volume")
        .and_then(Value::as_array)
        .ok_or_else(|| AppError::fetch("Yahoo response missing volumes"))?;

    let mut candles = Vec::new();
    for index in 0..timestamps.len() {
        let timestamp = timestamps.get(index).and_then(Value::as_i64);
        let Some(timestamp) = timestamp else {
            continue;
        };
        let Some(open) = number_at(opens, index) else {
            continue;
        };
        let Some(high) = number_at(highs, index) else {
            continue;
        };
        let Some(low) = number_at(lows, index) else {
            continue;
        };
        let Some(close) = number_at(closes, index) else {
            continue;
        };
        let date = Utc
            .timestamp_opt(timestamp, 0)
            .single()
            .ok_or_else(|| AppError::fetch("Yahoo returned an invalid timestamp"))?
            .date_naive();
        let volume = number_at(volumes, index).unwrap_or(0.0);

        candles.push(Candle {
            date,
            open,
            high,
            low,
            close,
            volume,
            flow: None,
        });
    }

    candles.sort_by_key(|candle| candle.date);
    candles.dedup_by_key(|candle| candle.date);

    if candles.is_empty() {
        return Err(AppError::fetch(format!(
            "Yahoo returned no usable candles for {yahoo_symbol}"
        )));
    }

    Ok(candles)
}

fn parse_yahoo_realtime_quote(
    value: &Value,
    request: &RealtimeAssetQuoteRequest,
    symbol: &str,
    yahoo_symbol: &str,
) -> Result<RealtimeAssetQuoteSnapshot, AppError> {
    if !value
        .pointer("/chart/error")
        .map(|error| error.is_null())
        .unwrap_or(true)
    {
        return Err(AppError::fetch(format!(
            "Yahoo returned an error for {yahoo_symbol}"
        )));
    }

    let result = value.pointer("/chart/result/0").ok_or_else(|| {
        AppError::fetch(format!("Yahoo response missing result for {yahoo_symbol}"))
    })?;
    let meta = result.get("meta").unwrap_or(&Value::Null);
    let timestamps = result
        .get("timestamp")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            AppError::fetch(format!(
                "Yahoo response missing realtime timestamps for {yahoo_symbol}"
            ))
        })?;
    let quote = result.pointer("/indicators/quote/0").ok_or_else(|| {
        AppError::fetch(format!(
            "Yahoo response missing realtime quote data for {yahoo_symbol}"
        ))
    })?;
    let closes = quote
        .get("close")
        .and_then(Value::as_array)
        .ok_or_else(|| AppError::fetch("Yahoo response missing realtime closes"))?;
    let opens = quote.get("open").and_then(Value::as_array);
    let highs = quote.get("high").and_then(Value::as_array);
    let lows = quote.get("low").and_then(Value::as_array);
    let volumes = quote.get("volume").and_then(Value::as_array);

    let mut points = Vec::new();
    let mut open = None;
    let mut high = None;
    let mut low = None;
    let mut volume = 0.0;

    for index in 0..timestamps.len().min(closes.len()) {
        let Some(timestamp) = timestamps.get(index).and_then(Value::as_i64) else {
            continue;
        };
        let Some(price) = number_at(closes, index) else {
            continue;
        };
        let time = Utc
            .timestamp_opt(timestamp, 0)
            .single()
            .ok_or_else(|| AppError::fetch("Yahoo returned an invalid realtime timestamp"))?
            .to_rfc3339();
        let open_value = number_at_optional(opens, index).unwrap_or(price);
        let high_value = number_at_optional(highs, index).unwrap_or(price);
        let low_value = number_at_optional(lows, index).unwrap_or(price);
        let volume_value = number_at_optional(volumes, index).unwrap_or(0.0);
        if open.is_none() {
            open = Some(open_value);
        }
        high = Some(match high {
            Some(current) if current > high_value => current,
            _ => high_value,
        });
        low = Some(match low {
            Some(current) if current < low_value => current,
            _ => low_value,
        });
        volume += volume_value;
        points.push(RealtimeAssetQuotePoint {
            time,
            price,
            volume: volume_value,
        });
    }

    let last =
        field_f64(meta, "regularMarketPrice").or_else(|| points.last().map(|point| point.price));
    if points.is_empty() && last.is_none() {
        return Err(AppError::fetch(format!(
            "Yahoo returned no usable realtime prices for {yahoo_symbol}"
        )));
    }
    let previous_close = field_f64(meta, "regularMarketPreviousClose")
        .or_else(|| field_f64(meta, "chartPreviousClose"));
    let change = match (last, previous_close) {
        (Some(last), Some(previous)) => Some(last - previous),
        _ => None,
    };
    let change_pct = match (change, previous_close) {
        (Some(change), Some(previous)) if previous.abs() > f64::EPSILON => {
            Some(change / previous * 100.0)
        }
        _ => None,
    };
    let (bid, ask, spread_bps) = realtime_spread(last, &request.market);
    let session = meta
        .get("marketState")
        .and_then(Value::as_str)
        .unwrap_or("unknown")
        .to_lowercase();
    let mut warnings = Vec::new();
    if yahoo_symbol != symbol {
        warnings.push(format!("Yahoo 映射：{symbol}={yahoo_symbol}。"));
    }
    warnings.push(
        "Yahoo 图表接口不提供完整 Level-2 盘口；买一/卖一为最新价附近的保护性代理值。".to_string(),
    );

    Ok(RealtimeAssetQuoteSnapshot {
        accepted: true,
        symbol: symbol.to_string(),
        name: request.name.trim().to_string(),
        market: request.market.trim().to_string(),
        source: "yahoo-chart".to_string(),
        source_label: "Yahoo 1m".to_string(),
        status: "synced".to_string(),
        session,
        last,
        previous_close,
        open,
        high,
        low,
        volume: if volume > 0.0 { Some(volume) } else { None },
        change,
        change_pct,
        bid,
        ask,
        spread_bps,
        synced_at: Utc::now().to_rfc3339(),
        message: format!("Yahoo 1m quote synced for {symbol}"),
        warnings,
        points,
    })
}

fn fallback_realtime_asset_quote(
    request: RealtimeAssetQuoteRequest,
    reason: &str,
) -> RealtimeAssetQuoteSnapshot {
    let symbol = request.symbol.trim().to_uppercase();
    let reference = request
        .reference_price
        .filter(|value| value.is_finite() && *value > 0.0);
    let (bid, ask, spread_bps) = realtime_spread(reference, &request.market);
    RealtimeAssetQuoteSnapshot {
        accepted: false,
        symbol,
        name: request.name.trim().to_string(),
        market: request.market.trim().to_string(),
        source: "reference".to_string(),
        source_label: "本地参考价".to_string(),
        status: "fallback".to_string(),
        session: "unknown".to_string(),
        last: reference,
        previous_close: reference,
        open: reference,
        high: reference,
        low: reference,
        volume: None,
        change: Some(0.0).filter(|_| reference.is_some()),
        change_pct: Some(0.0).filter(|_| reference.is_some()),
        bid,
        ask,
        spread_bps,
        synced_at: Utc::now().to_rfc3339(),
        message: "实时行情未就绪，已回退到本地参考价。".to_string(),
        warnings: vec![reason.to_string()],
        points: reference.map(fallback_realtime_points).unwrap_or_default(),
    }
}

fn fallback_realtime_points(reference: f64) -> Vec<RealtimeAssetQuotePoint> {
    let now = Utc::now();
    (0..32)
        .map(|index| {
            let progress = index as f64 / 31.0;
            let drift = (progress - 0.5) * reference * 0.003;
            let wave = (progress * std::f64::consts::TAU * 1.4).sin() * reference * 0.0018;
            RealtimeAssetQuotePoint {
                time: (now - Duration::minutes((31 - index) as i64)).to_rfc3339(),
                price: reference + drift + wave,
                volume: 0.0,
            }
        })
        .collect()
}

fn realtime_yahoo_symbol(symbol: &str, market: &str) -> String {
    let symbol = symbol.trim().to_uppercase();
    if symbol.contains('.') || symbol.contains('=') || symbol.starts_with('^') {
        return symbol;
    }
    let market = market.trim().to_uppercase();
    if market == "HK" && symbol.chars().all(|char| char.is_ascii_digit()) {
        return format!("{symbol}.HK");
    }
    if market == "CN" && symbol.len() == 6 && symbol.chars().all(|char| char.is_ascii_digit()) {
        let suffix = if symbol.starts_with('6') || symbol.starts_with('9') {
            "SS"
        } else {
            "SZ"
        };
        return format!("{symbol}.{suffix}");
    }
    symbol
}

fn realtime_spread(last: Option<f64>, market: &str) -> (Option<f64>, Option<f64>, Option<f64>) {
    let Some(last) = last.filter(|value| value.is_finite() && *value > 0.0) else {
        return (None, None, None);
    };
    let spread_bps = match market.trim().to_uppercase().as_str() {
        "US" => 2.0,
        "HK" => 6.0,
        "CN" => 8.0,
        _ => 5.0,
    };
    let half_spread = last * spread_bps / 20_000.0;
    (
        Some(last - half_spread),
        Some(last + half_spread),
        Some(spread_bps),
    )
}

fn number_at_optional(values: Option<&Vec<Value>>, index: usize) -> Option<f64> {
    values.and_then(|values| number_at(values, index))
}

fn field_f64(value: &Value, key: &str) -> Option<f64> {
    value.get(key).and_then(Value::as_f64)
}

fn number_at(values: &[Value], index: usize) -> Option<f64> {
    values.get(index).and_then(Value::as_f64)
}

fn load_sample_data(
    profile: &AnalysisProfile,
    source_label: &str,
    provider_note: &str,
) -> LoadedMarketData {
    let mut series = HashMap::new();

    for (index, item) in profile.symbols.iter().enumerate() {
        let candles = if is_volatility_symbol(item) {
            sample_vix_series()
        } else {
            sample_series_for_symbol(item, index)
        };
        series.insert(item.symbol.clone(), candles);
    }

    LoadedMarketData {
        source: "sample".to_string(),
        source_label: source_label.to_string(),
        provider_note: provider_note.to_string(),
        series,
    }
}

fn sample_series_for_symbol(item: &ProfileSymbol, index: usize) -> Vec<Candle> {
    let seed = symbol_seed(&item.symbol) as f64;
    let role = item.role.as_deref().unwrap_or_default();
    let base = match role {
        "leader" => 180.0 + seed % 720.0,
        "rates" => 28.0 + seed % 16.0,
        "macro" => 88.0 + seed % 35.0,
        "credit" | "safe_haven" => 75.0 + seed % 65.0,
        _ => 120.0 + seed % 430.0,
    };
    let trend_rate = match role {
        "leader" | "growth" | "sector" => 0.20 + (seed % 11.0) / 80.0,
        "breadth" => 0.06,
        "credit" => 0.03,
        "safe_haven" => 0.02,
        _ => 0.10 + (seed % 9.0) / 110.0,
    };
    let wave_size = match role {
        "leader" | "growth" => 0.035,
        "sector" => 0.028,
        "macro" | "rates" => 0.014,
        _ => 0.022,
    };
    let late_pressure = match role {
        "leader" if index % 2 == 0 => 0.070,
        "growth" | "sector" => 0.045,
        "breadth" => -0.050,
        "credit" => -0.025,
        _ => ((seed % 7.0) - 3.0) / 120.0,
    };
    let volume = 5_000_000.0 + (seed % 60.0) * 1_200_000.0;

    sample_equity_series(base, trend_rate, wave_size, late_pressure, volume, seed)
}

fn symbol_seed(value: &str) -> u64 {
    value.bytes().fold(0_u64, |sum, byte| {
        sum.wrapping_mul(31).wrapping_add(byte as u64)
    })
}

fn sample_trading_dates(len: usize) -> Vec<NaiveDate> {
    let mut dates = Vec::with_capacity(len);
    let mut date = Utc::now().date_naive();

    while dates.len() < len {
        if !matches!(date.weekday(), Weekday::Sat | Weekday::Sun) {
            dates.push(date);
        }
        date -= Duration::days(1);
    }

    dates.reverse();
    dates
}

fn sample_equity_series(
    base: f64,
    trend_rate: f64,
    wave_size: f64,
    late_pressure: f64,
    base_volume: f64,
    phase_seed: f64,
) -> Vec<Candle> {
    let dates = sample_trading_dates(420);
    let len = dates.len() as f64;
    let mut previous = base;
    let phase = phase_seed / 17.0;

    dates
        .into_iter()
        .enumerate()
        .map(|(index, date)| {
            let x = index as f64;
            let trend = 1.0 + trend_rate * (x / len);
            let wave = (x / 17.0).sin() * wave_size + (x / 47.0).cos() * wave_size * 0.55;
            let daily_texture =
                (x * 1.37 + phase).sin() * 0.008 + (x * 0.73 + phase / 3.0).cos() * 0.005;
            let pressure_window = ((x - (len - 34.0)) / 34.0).clamp(0.0, 1.0);
            let pressure = late_pressure * pressure_window.powf(1.7);
            let close = (base * trend * (1.0 + wave + daily_texture + pressure)).max(2.0);
            let open = previous * (1.0 + (x / 11.0).sin() * 0.004);
            let high = open.max(close) * (1.0 + 0.006 + wave.abs() * 0.08);
            let low = open.min(close) * (1.0 - 0.006 - wave.abs() * 0.08);
            let volume_spike = if index > 390 { 0.45 } else { 0.0 };
            let volume = base_volume * (1.0 + (x / 9.0).sin().abs() * 0.38 + volume_spike);
            previous = close;

            Candle {
                date,
                open,
                high,
                low,
                close,
                volume,
                flow: None,
            }
        })
        .collect()
}

fn sample_vix_series() -> Vec<Candle> {
    sample_trading_dates(420)
        .into_iter()
        .enumerate()
        .map(|(index, date)| {
            let x = index as f64;
            let late = if index > 392 {
                ((index - 392) as f64 / 28.0).powf(1.4) * 5.2
            } else {
                0.0
            };
            let close =
                (16.0 + (x / 15.0).sin() * 2.6 + (x / 43.0).cos() * 1.4 + late).clamp(9.0, 42.0);
            Candle {
                date,
                open: close * 0.98,
                high: close * 1.06,
                low: close * 0.94,
                close,
                volume: 0.0,
                flow: None,
            }
        })
        .collect()
}

fn build_report(
    loaded: LoadedMarketData,
    requested_as_of: Option<String>,
    profile: AnalysisProfile,
) -> Result<MarketAnalysisReport, AppError> {
    let benchmark = profile.benchmark.as_str();
    let benchmark_series = loaded
        .series
        .get(benchmark)
        .ok_or_else(|| AppError::internal(format!("{benchmark} series is missing")))?;
    let requested_date = match requested_as_of
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(value) => Some(
            NaiveDate::parse_from_str(value, "%Y-%m-%d")
                .map_err(|_| AppError::invalid("asOf must use YYYY-MM-DD"))?,
        ),
        None => None,
    };
    let spy_index = match requested_date {
        Some(date) => find_index_on_or_before(benchmark_series, date)
            .ok_or_else(|| AppError::invalid("asOf is earlier than available history"))?,
        None => benchmark_series
            .len()
            .checked_sub(1)
            .ok_or_else(|| AppError::internal(format!("{benchmark} series is empty")))?,
    };

    if spy_index < 220 {
        return Err(AppError::invalid(
            "asOf does not have enough lookback data for MA200 and indicators",
        ));
    }

    let as_of_date = benchmark_series[spy_index].date;
    let mut indexes = HashMap::new();
    let mut snapshots = HashMap::new();

    for item in &profile.symbols {
        let candles = loaded
            .series
            .get(&item.symbol)
            .ok_or_else(|| AppError::internal(format!("{} series is missing", item.symbol)))?;
        let index = find_index_on_or_before(candles, as_of_date).ok_or_else(|| {
            AppError::internal(format!("{} has no candle for report date", item.symbol))
        })?;
        if index < 220 {
            return Err(AppError::invalid(format!(
                "{} does not have enough lookback data for {}",
                item.symbol, as_of_date
            )));
        }
        indexes.insert(item.symbol.clone(), index);
        snapshots.insert(item.symbol.clone(), snapshot_at(candles, index));
    }

    let (dimensions, mut reasons, score) =
        score_snapshot(&profile, &loaded.series, &indexes, &snapshots)?;

    reasons.sort_by(|left, right| right.points.cmp(&left.points));
    reasons.truncate(6);

    let level = risk_level(score);
    let technical_columns = technical_columns(&profile);
    let technical_rows = technical_rows(&profile, &snapshots);
    let asset_statuses = asset_statuses(&profile, &snapshots);
    let sector_strength = sector_strength(&profile, &snapshots);
    let benchmark_snapshot = snapshots
        .get(benchmark)
        .ok_or_else(|| AppError::internal(format!("{benchmark} snapshot is missing")))?;
    let market_internals = market_internals_for(&profile, &snapshots);
    let mut factor_scores = factor_scores_for(&dimensions, benchmark_snapshot, &market_internals);
    let leader_confirmation = leader_confirmation_for(&profile, &snapshots, benchmark_snapshot);
    let opportunity_scores = opportunity_scores_for(
        &profile.calibration,
        &factor_scores,
        leader_confirmation.as_ref(),
        &market_internals,
    );
    calibrate_opportunity_factor(&mut factor_scores, &opportunity_scores);
    let structure = structure_analysis(&profile, &snapshots, leader_confirmation.as_ref());
    let pattern_analysis = pattern_analysis(&profile, &loaded.series, &indexes);
    let price_bars_by_symbol =
        price_bars_by_symbol(&profile, &loaded.series, &indexes, PRICE_BAR_LOOKBACK);
    let market_state = market_state_for_with_context(
        &profile.calibration,
        &factor_scores,
        leader_confirmation.as_ref(),
        &market_internals,
    );
    let status_metrics = status_metrics_for(
        &market_state,
        &factor_scores,
        &opportunity_scores,
        score,
        &market_internals,
    );
    let backtest = backtest_summary(
        &profile,
        &loaded.series,
        benchmark_series,
        spy_index,
        score,
        &market_state,
        &factor_scores,
        leader_confirmation.as_ref(),
        &market_internals,
    );
    let summary = report_summary(score, &level, &market_state);
    let guidance = guidance_for(&profile, &market_state);
    let support_evidence = support_evidence_for(&profile, &snapshots);
    let position_advice = position_advice_for(
        &profile,
        &market_state,
        &factor_scores,
        &structure,
        &pattern_analysis,
        leader_confirmation.as_ref(),
        &dimensions,
    );
    let portfolio_profile = portfolio_profile_for(&profile, &snapshots, score);
    let profile_mandate = profile_mandate_for(&profile, &portfolio_profile);
    let profile_fund = profile_fund_for(&profile, as_of_date);
    let profile_calibration_status =
        profile_calibration_status_for(&profile, &backtest.state_validation, &loaded.source);
    let decision_frame = decision_frame_for(
        &market_state,
        &factor_scores,
        &opportunity_scores,
        &position_advice,
        &structure,
        score,
        &profile.copy,
    );
    let decision_metric_contexts =
        decision_metric_contexts_for(benchmark_series, spy_index, &decision_frame);
    let recommendation_performance = empty_recommendation_performance(&profile.key);
    let calibration_action = calibration_action_for(&profile, &recommendation_performance);

    Ok(MarketAnalysisReport {
        generated_at: Utc::now().to_rfc3339(),
        source: loaded.source,
        source_label: loaded.source_label,
        provider_note: loaded.provider_note,
        profile_schema_version: profile.schema_version,
        profile_version: profile.profile_version.clone(),
        parent_profile: profile.extends.clone(),
        profile_key: profile.key,
        profile_name: profile.name,
        profile_market: profile.market,
        as_of: as_of_date.to_string(),
        score,
        level,
        summary,
        market_state,
        decision_frame,
        decision_metric_contexts,
        status_metrics,
        market_internals,
        factor_scores,
        opportunity_scores,
        structure,
        pattern_analysis,
        price_bars_by_symbol,
        asset_statuses,
        technical_columns,
        technical_rows,
        sector_strength,
        dimension_scores: dimensions,
        reasons,
        support_evidence,
        guidance,
        position_advice,
        portfolio_profile,
        profile_mandate,
        profile_fund,
        profile_calibration_status,
        recommendation_performance,
        calibration_action,
        execution_policy: profile.execution_policy.clone(),
        backtest,
        policy_note:
            "风险评分和形态识别用于监控和执行参考，不输出自动买卖点；仓位区间按风险资产敞口理解。"
                .to_string(),
    })
}

fn score_snapshot(
    profile: &AnalysisProfile,
    series: &HashMap<String, Vec<Candle>>,
    indexes: &HashMap<String, usize>,
    snapshots: &HashMap<String, IndicatorSnapshot>,
) -> Result<(Vec<DimensionScore>, Vec<RiskReason>, u8), AppError> {
    let mut dimensions = Vec::new();
    let mut reasons = Vec::new();

    for draft in score_dimensions(profile, series, indexes, snapshots)? {
        let (dimension, dimension_reasons) = draft.finish();
        dimensions.push(dimension);
        reasons.extend(dimension_reasons);
    }

    let score = dimensions
        .iter()
        .map(|item| item.score)
        .sum::<u8>()
        .min(100);

    Ok((dimensions, reasons, score))
}

fn score_dimensions(
    profile: &AnalysisProfile,
    series: &HashMap<String, Vec<Candle>>,
    indexes: &HashMap<String, usize>,
    snapshots: &HashMap<String, IndicatorSnapshot>,
) -> Result<Vec<DimensionDraft>, AppError> {
    let mut dimensions = Vec::new();

    for dimension in &profile.dimensions {
        let factor = dimension
            .factor
            .clone()
            .unwrap_or_else(|| infer_dimension_factor(dimension));
        let mut draft =
            DimensionDraft::new(&dimension.key, &dimension.label, factor, dimension.weight);
        for rule in &dimension.rules {
            if evaluate_rule(rule, series, indexes, snapshots)? {
                draft.add(rule.points, render_reason(rule, snapshots));
            }
        }
        dimensions.push(draft);
    }

    Ok(dimensions)
}

fn infer_dimension_factor(dimension: &DimensionConfig) -> String {
    let mut text = format!("{} {}", dimension.key, dimension.label).to_lowercase();
    for rule in &dimension.rules {
        text.push(' ');
        text.push_str(&rule.rule_type.to_lowercase());
        text.push(' ');
        text.push_str(&rule.reason.to_lowercase());
    }

    if contains_any(
        &text,
        &[
            "heat",
            "crowd",
            "overheat",
            "rsi_above",
            "kdj_above",
            "volume_ratio_above",
            "return_above",
            "distance_above_ma",
            "过热",
            "拥挤",
            "涨幅",
            "乖离",
        ],
    ) {
        "heat".to_string()
    } else if contains_any(
        &text,
        &[
            "volatility",
            "vix",
            "fx",
            "rates",
            "credit",
            "dollar",
            "pressure",
            "safe_haven",
            "波动",
            "恐慌",
            "韩元",
            "美元",
            "利率",
            "信用",
            "避险",
            "压力",
        ],
    ) {
        "systemic".to_string()
    } else if contains_any(
        &text,
        &[
            "breadth",
            "broad",
            "confirmation",
            "relative",
            "reversal",
            "macd_bearish",
            "macd_cross_down",
            "kdj_bearish",
            "kdj_cross_down",
            "supply_chain",
            "structure",
            "广度",
            "宽度",
            "确认",
            "相对",
            "反转",
            "结构",
        ],
    ) {
        "structure".to_string()
    } else if contains_any(
        &text,
        &[
            "leader",
            "momentum",
            "macd_bullish",
            "macd_cross_up",
            "kdj_bullish",
            "kdj_cross_up",
            "growth",
            "divergence",
            "ai",
            "semiconductor",
            "科技",
            "成长",
            "龙头",
            "分歧",
            "半导体",
        ],
    ) {
        "momentum".to_string()
    } else {
        "trend".to_string()
    }
}

fn evaluate_rule(
    rule: &RuleConfig,
    series: &HashMap<String, Vec<Candle>>,
    indexes: &HashMap<String, usize>,
    snapshots: &HashMap<String, IndicatorSnapshot>,
) -> Result<bool, AppError> {
    let symbol = rule.symbol.as_deref().unwrap_or_default();
    let other = rule.other.as_deref().unwrap_or_default();
    let snapshot = || get_snapshot(snapshots, symbol);
    let other_snapshot = || get_snapshot(snapshots, other);

    let matched = match rule.rule_type.as_str() {
        "close_below_ma" => {
            let snapshot = snapshot()?;
            below(
                snapshot.candle.close,
                snapshot.ma(rule.period.unwrap_or(20)),
            )
        }
        "volume_break_ma" => {
            let snapshot = snapshot()?;
            below(
                snapshot.candle.close,
                snapshot.ma(rule.period.unwrap_or(50)),
            ) && snapshot.change_1d().unwrap_or(0.0) < 0.0
                && snapshot.volume_ratio().unwrap_or(0.0) > rule.volume_ratio_gt.unwrap_or(1.3)
        }
        "ma_below_ma" => {
            let snapshot = snapshot()?;
            below_option(
                snapshot.ma(rule.left_period.unwrap_or(20)),
                snapshot.ma(rule.right_period.unwrap_or(50)),
            )
        }
        "macd_bullish" => macd_bullish(snapshot()?),
        "macd_bearish" => macd_bearish(snapshot()?),
        "macd_cross_up" => macd_cross_up(snapshot()?),
        "macd_cross_down" => macd_cross_down(snapshot()?),
        "kdj_bullish" => kdj_bullish(snapshot()?, rule),
        "kdj_bearish" => kdj_bearish(snapshot()?, rule),
        "kdj_cross_up" => kdj_cross_up(snapshot()?, rule),
        "kdj_cross_down" => kdj_cross_down(snapshot()?, rule),
        "kdj_above" => kdj_above(snapshot()?, rule),
        "kdj_below" => kdj_below(snapshot()?, rule),
        "rsi_above" => {
            let snapshot = snapshot()?;
            let value = snapshot.rsi(rule.period.unwrap_or(14)).unwrap_or(0.0);
            value > rule.threshold.unwrap_or(70.0)
                && rule.max_threshold.map(|max| value <= max).unwrap_or(true)
        }
        "volume_ratio_above" => snapshot()?
            .volume_ratio()
            .map(|value| value > rule.threshold.unwrap_or(1.3))
            .unwrap_or(false),
        "volume_ratio_below" => snapshot()?
            .volume_ratio()
            .map(|value| value < rule.threshold.unwrap_or(0.65))
            .unwrap_or(false),
        "trend_continuation" => trend_continuation(snapshot()?),
        "pullback_hold_ma" => pullback_hold_ma(snapshot()?, rule),
        "volume_breakout" => volume_breakout(snapshot()?, rule),
        "support_lost" => support_lost(snapshot()?, rule),
        "range_compression" => range_compression(snapshot()?, rule),
        "risk_proxy_cooling" => is_risk_proxy_symbol(symbol) && risk_proxy_cooling(snapshot()?),
        "risk_proxy_heating" => {
            is_risk_proxy_symbol(symbol) && risk_proxy_heating(snapshot()?, rule)
        }
        "momentum_exhaustion" => momentum_exhaustion(snapshot()?, rule),
        "distribution_volume" => distribution_volume(snapshot()?, rule),
        "macd_confirmation" => macd_confirmation(snapshot()?),
        "distance_above_ma" => {
            let snapshot = snapshot()?;
            ma_distance(snapshot, rule.period.unwrap_or(20))
                .map(|value| {
                    value > rule.threshold.unwrap_or(8.0)
                        && rule.max_threshold.map(|max| value <= max).unwrap_or(true)
                })
                .unwrap_or(false)
        }
        "return_above" => {
            let snapshot = snapshot()?;
            snapshot
                .return_for(rule.days.unwrap_or(20))
                .map(|value| value > rule.threshold.unwrap_or(0.0))
                .unwrap_or(false)
                && rule
                    .max_threshold
                    .map(|max| snapshot.return_for(rule.days.unwrap_or(20)).unwrap_or(0.0) <= max)
                    .unwrap_or(true)
        }
        "long_bearish_volume_candle" => long_bearish_volume_candle(snapshot()?),
        "high_volume_stalling" => high_volume_stalling(snapshot()?),
        "pullback_from_period_high" => {
            let snapshot = snapshot()?;
            pullback_from_period_high(snapshot, rule.period.unwrap_or(60))
                .map(|value| {
                    value >= rule.threshold.unwrap_or(6.0)
                        && rule.max_threshold.map(|max| value <= max).unwrap_or(true)
                })
                .unwrap_or(false)
        }
        "upper_shadow_reversal" => upper_shadow_reversal(snapshot()?, rule),
        "single_day_drop_volume" => {
            let snapshot = snapshot()?;
            snapshot.change_1d().unwrap_or(0.0) <= rule.change_lte.unwrap_or(-5.0)
                && snapshot.volume_ratio().unwrap_or(0.0) > rule.volume_ratio_gt.unwrap_or(1.5)
        }
        "flow_turn_negative" => flow_turn_negative(
            series,
            indexes,
            symbol,
            rule.days.unwrap_or(5) as usize,
            rule.threshold.unwrap_or(0.0),
            rule.buffer.unwrap_or(0.0),
        ),
        "underperformed_for" => underperformed_for(
            series,
            indexes,
            symbol,
            other,
            rule.days.unwrap_or(5) as usize,
        ),
        "relative_strength_declined" => relative_strength_declined(
            series,
            indexes,
            symbol,
            other,
            rule.days.unwrap_or(5) as usize,
        ),
        "below_ma_while_other_above_ma" => {
            let snapshot = snapshot()?;
            let other_snapshot = other_snapshot()?;
            let period = rule.period.unwrap_or(50);
            below(snapshot.candle.close, snapshot.ma(period))
                && !below(other_snapshot.candle.close, other_snapshot.ma(period))
        }
        "single_day_drop_vs" => {
            let snapshot = snapshot()?;
            let other_snapshot = other_snapshot()?;
            let change = snapshot.change_1d().unwrap_or(0.0);
            let other_change = other_snapshot.change_1d().unwrap_or(0.0);
            change < 0.0
                && (other_change >= 0.0
                    || change.abs() > other_change.abs() * rule.multiplier.unwrap_or(1.5))
        }
        "return_below_relative" => {
            let snapshot = snapshot()?;
            let other_snapshot = other_snapshot()?;
            let days = rule.days.unwrap_or(20);
            match (snapshot.return_for(days), other_snapshot.return_for(days)) {
                (Some(left), Some(right)) => left < right - rule.buffer.unwrap_or(0.0),
                _ => false,
            }
        }
        "breadth_below_ma_ratio" => breadth_below_ma_ratio(rule, snapshots)?,
        "close_lt" => {
            let snapshot = snapshot()?;
            snapshot.candle.close < rule.threshold.unwrap_or(f64::MIN)
                && rule
                    .max_threshold
                    .map(|max| snapshot.candle.close <= max)
                    .unwrap_or(true)
        }
        "close_gte" => {
            let snapshot = snapshot()?;
            snapshot.candle.close >= rule.threshold.unwrap_or(f64::MAX)
                && rule
                    .max_threshold
                    .map(|max| snapshot.candle.close < max)
                    .unwrap_or(true)
        }
        other => {
            return Err(AppError::invalid(format!(
                "unsupported rule type '{other}' in profile"
            )));
        }
    };

    Ok(matched)
}

fn render_reason(rule: &RuleConfig, snapshots: &HashMap<String, IndicatorSnapshot>) -> String {
    let mut text = rule.reason.clone();
    let symbol = rule.symbol.as_deref().unwrap_or_default();
    let snapshot = snapshots.get(symbol);
    let rsi = snapshot
        .and_then(|item| item.rsi(rule.period.unwrap_or(14)))
        .map(|value| format!("{value:.0}"))
        .unwrap_or_else(|| "-".to_string());
    let close = snapshot
        .map(|item| format!("{:.1}", item.candle.close))
        .unwrap_or_else(|| "-".to_string());
    let change = snapshot
        .and_then(IndicatorSnapshot::change_1d)
        .map(|value| format!("{value:.1}%"))
        .unwrap_or_else(|| "-".to_string());
    let days = rule
        .days
        .unwrap_or(rule.period.unwrap_or_default())
        .to_string();
    let threshold = rule
        .threshold
        .map(|value| format_threshold(value))
        .unwrap_or_else(|| "-".to_string());
    let upper_shadow = snapshot
        .map(upper_shadow_share)
        .map(|value| format!("{value:.0}%"))
        .unwrap_or_else(|| "-".to_string());
    let pullback = snapshot
        .map(pullback_from_high)
        .map(|value| format!("{value:.1}%"))
        .unwrap_or_else(|| "-".to_string());
    let ma_distance_text = snapshot
        .and_then(|item| ma_distance(item, rule.period.unwrap_or(20)))
        .map(|value| format!("{value:+.1}%"))
        .unwrap_or_else(|| "-".to_string());
    let period_pullback = snapshot
        .and_then(|item| pullback_from_period_high(item, rule.period.unwrap_or(60)))
        .map(|value| format!("{value:.1}%"))
        .unwrap_or_else(|| "-".to_string());
    let breadth = breadth_below_ma_ratio_value(rule, snapshots)
        .map(|value| format!("{value:.0}%"))
        .unwrap_or_else(|| "-".to_string());
    let flow = snapshot
        .and_then(|item| item.candle.flow)
        .map(|value| format_threshold(value))
        .unwrap_or_else(|| "-".to_string());
    let macd = snapshot
        .and_then(|item| item.macd)
        .map(|value| format!("{value:.2}"))
        .unwrap_or_else(|| "-".to_string());
    let macd_signal = snapshot
        .and_then(|item| item.macd_signal)
        .map(|value| format!("{value:.2}"))
        .unwrap_or_else(|| "-".to_string());
    let macd_histogram = snapshot
        .and_then(IndicatorSnapshot::macd_histogram)
        .map(|value| format!("{value:+.2}"))
        .unwrap_or_else(|| "-".to_string());
    let volume_ratio = snapshot
        .and_then(IndicatorSnapshot::volume_ratio)
        .map(|value| format!("{value:.2}x"))
        .unwrap_or_else(|| "-".to_string());
    let kdj = snapshot.and_then(|item| item.kdj(rule.period.unwrap_or(9)));
    let kdj_k = kdj
        .map(|value| format!("{:.1}", value.k))
        .unwrap_or_else(|| "-".to_string());
    let kdj_d = kdj
        .map(|value| format!("{:.1}", value.d))
        .unwrap_or_else(|| "-".to_string());
    let kdj_j = kdj
        .map(|value| format!("{:.1}", value.j))
        .unwrap_or_else(|| "-".to_string());

    for (token, value) in [
        ("{symbol}", symbol.to_string()),
        ("{rsi}", rsi),
        ("{close}", close),
        ("{change}", change),
        ("{days}", days),
        ("{threshold}", threshold),
        ("{upperShadow}", upper_shadow),
        ("{pullback}", pullback),
        ("{maDistance}", ma_distance_text),
        ("{periodPullback}", period_pullback),
        ("{breadth}", breadth),
        ("{flow}", flow),
        ("{macd}", macd),
        ("{macdSignal}", macd_signal),
        ("{macdHistogram}", macd_histogram),
        ("{volumeRatio}", volume_ratio),
        ("{kdjK}", kdj_k),
        ("{kdjD}", kdj_d),
        ("{kdjJ}", kdj_j),
    ] {
        text = text.replace(token, &value);
    }
    text
}

fn format_threshold(value: f64) -> String {
    if value.fract().abs() < f64::EPSILON {
        format!("{value:.0}")
    } else {
        format!("{value:.1}")
    }
}

fn technical_columns(profile: &AnalysisProfile) -> Vec<TechnicalColumn> {
    profile
        .technical_columns
        .iter()
        .map(|column| TechnicalColumn {
            key: column.key.clone(),
            label: column.label.clone(),
            align: column.align.clone().unwrap_or_else(|| "right".to_string()),
        })
        .collect()
}

fn technical_rows(
    profile: &AnalysisProfile,
    snapshots: &HashMap<String, IndicatorSnapshot>,
) -> Vec<TechnicalRow> {
    profile
        .symbols
        .iter()
        .filter_map(|item| {
            let snapshot = snapshots.get(&item.symbol)?;
            let status = asset_status_key(snapshot, item);
            Some(TechnicalRow {
                symbol: item.symbol.clone(),
                label: item.label.clone(),
                cells: technical_cells(snapshot, &profile.technical_columns),
                close: round(snapshot.candle.close, 2),
                change_1d: snapshot.change_1d().map(|value| round(value, 2)),
                return_10d: snapshot.return_for(10).map(|value| round(value, 2)),
                return_20d: snapshot.return_for(20).map(|value| round(value, 2)),
                rsi_14: snapshot.rsi(14).map(|value| round(value, 1)),
                ma_20: snapshot.ma(20).map(|value| round(value, 2)),
                ma_50: snapshot.ma(50).map(|value| round(value, 2)),
                ma_200: snapshot.ma(200).map(|value| round(value, 2)),
                macd: snapshot.macd.map(|value| round(value, 2)),
                macd_signal: snapshot.macd_signal.map(|value| round(value, 2)),
                macd_histogram: snapshot.macd_histogram().map(|value| round(value, 2)),
                kdj_k: snapshot.kdj(9).map(|value| round(value.k, 1)),
                kdj_d: snapshot.kdj(9).map(|value| round(value.d, 1)),
                kdj_j: snapshot.kdj(9).map(|value| round(value.j, 1)),
                volume_ratio: snapshot.volume_ratio().map(|value| round(value, 2)),
                status: status.to_string(),
                note: technical_note(snapshot, item),
            })
        })
        .collect()
}

fn price_bars_by_symbol(
    profile: &AnalysisProfile,
    series: &HashMap<String, Vec<Candle>>,
    indexes: &HashMap<String, usize>,
    lookback: usize,
) -> BTreeMap<String, Vec<PriceBar>> {
    let mut bars_by_symbol = BTreeMap::new();
    let window = lookback.max(1);

    for item in &profile.symbols {
        let Some(candles) = series.get(&item.symbol) else {
            continue;
        };
        let Some(end_index) = indexes.get(&item.symbol).copied() else {
            continue;
        };
        if candles.is_empty() || end_index >= candles.len() {
            continue;
        }

        let start = (end_index + 1).saturating_sub(window);
        let bars = candles[start..=end_index]
            .iter()
            .map(|candle| PriceBar {
                date: candle.date.to_string(),
                open: round(candle.open, 4),
                high: round(candle.high, 4),
                low: round(candle.low, 4),
                close: round(candle.close, 4),
                volume: (candle.volume > 0.0).then(|| round(candle.volume, 0)),
            })
            .collect::<Vec<_>>();

        if !bars.is_empty() {
            bars_by_symbol.insert(item.symbol.clone(), bars);
        }
    }

    bars_by_symbol
}

fn technical_cells(
    snapshot: &IndicatorSnapshot,
    columns: &[TechnicalColumnConfig],
) -> Vec<TechnicalCell> {
    columns
        .iter()
        .map(|column| {
            let cell_value = technical_cell_value(snapshot, column);
            let display = format_cell_value(&cell_value, column);
            let value = match cell_value {
                CellValue::Number(value) => Some(round(value, 4)),
                CellValue::Pair(_, _) | CellValue::Empty => None,
            };
            TechnicalCell {
                key: column.key.clone(),
                display,
                value,
                tone: cell_tone(cell_value.primary(), column),
            }
        })
        .collect()
}

#[derive(Debug, Clone, Copy)]
enum CellValue {
    Number(f64),
    Pair(Option<f64>, Option<f64>),
    Empty,
}

impl CellValue {
    fn primary(self) -> Option<f64> {
        match self {
            CellValue::Number(value) => Some(value),
            CellValue::Pair(left, _) => left,
            CellValue::Empty => None,
        }
    }
}

fn technical_cell_value(snapshot: &IndicatorSnapshot, column: &TechnicalColumnConfig) -> CellValue {
    match column.metric.as_str() {
        "close" => CellValue::Number(snapshot.candle.close),
        "change_1d" => snapshot
            .change_1d()
            .map(CellValue::Number)
            .unwrap_or(CellValue::Empty),
        "return" => snapshot
            .return_for(column.period.unwrap_or(20))
            .map(CellValue::Number)
            .unwrap_or(CellValue::Empty),
        "rsi" => snapshot
            .rsi(column.period.unwrap_or(14))
            .map(CellValue::Number)
            .unwrap_or(CellValue::Empty),
        "ma_distance" => ma_distance(snapshot, column.period.unwrap_or(20))
            .map(CellValue::Number)
            .unwrap_or(CellValue::Empty),
        "ma" => snapshot
            .ma(column.period.unwrap_or(20))
            .map(CellValue::Number)
            .unwrap_or(CellValue::Empty),
        "ma_pair" => CellValue::Pair(
            snapshot.ma(column.left_period.unwrap_or(20)),
            snapshot.ma(column.right_period.unwrap_or(50)),
        ),
        "macd" => snapshot
            .macd
            .map(CellValue::Number)
            .unwrap_or(CellValue::Empty),
        "macd_signal" => snapshot
            .macd_signal
            .map(CellValue::Number)
            .unwrap_or(CellValue::Empty),
        "macd_histogram" => snapshot
            .macd_histogram()
            .map(CellValue::Number)
            .unwrap_or(CellValue::Empty),
        "kdj" => snapshot
            .kdj(column.period.unwrap_or(9))
            .map(|value| CellValue::Number(kdj_line_value(value, column.line.as_deref())))
            .unwrap_or(CellValue::Empty),
        "kdj_k" => snapshot
            .kdj(column.period.unwrap_or(9))
            .map(|value| CellValue::Number(value.k))
            .unwrap_or(CellValue::Empty),
        "kdj_d" => snapshot
            .kdj(column.period.unwrap_or(9))
            .map(|value| CellValue::Number(value.d))
            .unwrap_or(CellValue::Empty),
        "kdj_j" => snapshot
            .kdj(column.period.unwrap_or(9))
            .map(|value| CellValue::Number(value.j))
            .unwrap_or(CellValue::Empty),
        "volume_ratio" => snapshot
            .volume_ratio()
            .map(CellValue::Number)
            .unwrap_or(CellValue::Empty),
        "flow" => snapshot
            .candle
            .flow
            .map(CellValue::Number)
            .unwrap_or(CellValue::Empty),
        _ => CellValue::Empty,
    }
}

fn format_cell_value(value: &CellValue, column: &TechnicalColumnConfig) -> String {
    match *value {
        CellValue::Number(value) => format_number_for(value, column.format.as_deref()),
        CellValue::Pair(left, right) => match (left, right) {
            (Some(left), Some(right)) => format!(
                "{} / {}",
                format_number_for(left, column.format.as_deref()),
                format_number_for(right, column.format.as_deref())
            ),
            _ => "-".to_string(),
        },
        CellValue::Empty => "-".to_string(),
    }
}

fn format_number_for(value: f64, format: Option<&str>) -> String {
    match format.unwrap_or("number") {
        "percent" => format!("{value:+.2}%"),
        "number0" | "pair0" => format!("{value:.0}"),
        "number1" => format!("{value:.1}"),
        "ratio" => format!("{value:.2}x"),
        _ => format!("{value:.2}"),
    }
}

fn cell_tone(value: Option<f64>, column: &TechnicalColumnConfig) -> String {
    if column.tone.as_deref() != Some("signed") {
        return "neutral".to_string();
    }
    match value {
        Some(value) if value > 0.0 => "positive".to_string(),
        Some(value) if value < 0.0 => "negative".to_string(),
        _ => "neutral".to_string(),
    }
}

fn asset_statuses(
    profile: &AnalysisProfile,
    snapshots: &HashMap<String, IndicatorSnapshot>,
) -> Vec<AssetStatus> {
    profile
        .symbols
        .iter()
        .filter_map(|item| {
            let snapshot = snapshots.get(&item.symbol)?;
            let status = asset_status_key(snapshot, item);
            Some(AssetStatus {
                symbol: item.symbol.clone(),
                label: item.label.clone(),
                asset_kind: asset_kind_for(item).to_string(),
                status: status.to_string(),
                status_label: status_label(status).to_string(),
                close: round(snapshot.candle.close, 2),
                change_1d: snapshot.change_1d().map(|value| round(value, 2)),
                note: technical_note(snapshot, item),
            })
        })
        .collect()
}

fn sector_strength(
    profile: &AnalysisProfile,
    snapshots: &HashMap<String, IndicatorSnapshot>,
) -> Vec<SectorStrengthRow> {
    let benchmark_return = snapshots
        .get(&profile.benchmark)
        .and_then(|snapshot| snapshot.return_for(20));

    profile
        .symbols
        .iter()
        .filter(|item| !is_volatility_symbol(item))
        .filter_map(|item| {
            let snapshot = snapshots.get(&item.symbol)?;
            let return_20d = snapshot.return_for(20);
            let relative = match (return_20d, benchmark_return) {
                (Some(symbol_return), Some(benchmark_return)) => {
                    Some(symbol_return - benchmark_return)
                }
                _ => None,
            };
            let status = match relative {
                Some(value) if value >= 3.0 => "strong",
                Some(value) if value <= -3.0 => "weak",
                Some(_) => "neutral",
                None => "unknown",
            };

            Some(SectorStrengthRow {
                symbol: item.symbol.clone(),
                label: item.label.clone(),
                return_20d: return_20d.map(|value| round(value, 2)),
                relative_to_spy: relative.map(|value| round(value, 2)),
                status: status.to_string(),
            })
        })
        .collect()
}

fn market_internals_for(
    profile: &AnalysisProfile,
    snapshots: &HashMap<String, IndicatorSnapshot>,
) -> MarketInternals {
    let investable = profile
        .symbols
        .iter()
        .filter(|item| !is_volatility_symbol(item))
        .filter_map(|item| snapshots.get(&item.symbol).map(|snapshot| (item, snapshot)))
        .collect::<Vec<_>>();
    let breadth_sample_size = investable.len();
    let advancing_count = investable
        .iter()
        .filter(|(_, snapshot)| snapshot.change_1d().unwrap_or(0.0) > 0.0)
        .count();
    let breadth_advancing_ratio = pct_rate(advancing_count, investable.len());
    let breadth_active =
        investable.len() >= 4 && breadth_advancing_ratio.is_some_and(|ratio| ratio < 35.0);

    let mut signals = Vec::new();
    signals.push(MarketInternalSignal {
        key: "breadth_collapse".to_string(),
        label: "监控广度".to_string(),
        value: breadth_advancing_ratio
            .map(|ratio| format!("{ratio:.0}% 上涨"))
            .unwrap_or_else(|| "样本不足".to_string()),
        tone: if breadth_active {
            "negative"
        } else if breadth_advancing_ratio.is_some_and(|ratio| ratio < 50.0) {
            "caution"
        } else {
            "positive"
        }
        .to_string(),
        status: if breadth_active {
            "Breadth Collapse"
        } else if breadth_advancing_ratio.is_some_and(|ratio| ratio < 50.0) {
            "广度收缩"
        } else {
            "广度正常"
        }
        .to_string(),
        detail: format!(
            "非波动率资产中 {} / {} 个单日上涨；低于 35% 时视为 Breadth Collapse。",
            advancing_count,
            investable.len()
        ),
    });

    let benchmark_return_20 = snapshots
        .get(&profile.benchmark)
        .and_then(|snapshot| snapshot.return_for(20));
    let benchmark_return_5 = snapshots
        .get(&profile.benchmark)
        .and_then(|snapshot| snapshot.return_for(5));
    let relative_watch = profile
        .symbols
        .iter()
        .filter(|item| item.symbol != profile.benchmark && !is_volatility_symbol(item))
        .filter(|item| {
            item.role.as_deref().is_some_and(|role| {
                role_matches(&profile.calibration.confirmation_roles, role)
                    || role_matches(&profile.calibration.leader_roles, role)
            })
        })
        .filter_map(|item| snapshots.get(&item.symbol).map(|snapshot| (item, snapshot)))
        .collect::<Vec<_>>();
    let relative_weakness_sample_size = relative_watch.len();
    let relative_weak_count = relative_watch
        .iter()
        .filter(|(_, snapshot)| {
            let below_ma20 = below(snapshot.candle.close, snapshot.ma(20));
            let weak_20 = match (snapshot.return_for(20), benchmark_return_20) {
                (Some(left), Some(right)) => left <= right - 3.0,
                _ => false,
            };
            let weak_5 = match (snapshot.return_for(5), benchmark_return_5) {
                (Some(left), Some(right)) => left <= right - 1.5,
                _ => false,
            };
            below_ma20 || weak_20 || weak_5
        })
        .count();
    let relative_weakness_ratio = pct_rate(relative_weak_count, relative_watch.len());
    let high_beta_order = high_beta_order_for(profile, snapshots);
    let high_beta_failed = high_beta_order.as_ref().is_some_and(|(_, failed)| *failed);
    let relative_active = relative_watch.len() >= 3
        && (relative_weakness_ratio.is_some_and(|ratio| ratio >= 50.0) || high_beta_failed);
    let high_beta_text = high_beta_order
        .as_ref()
        .map(|(text, _)| text.clone())
        .unwrap_or_else(|| "未配置高 beta 链".to_string());
    signals.push(MarketInternalSignal {
        key: "relative_weakness_expansion".to_string(),
        label: "高Beta弱势".to_string(),
        value: if high_beta_failed {
            high_beta_text.clone()
        } else {
            relative_weakness_ratio
                .map(|ratio| format!("{ratio:.0}% 走弱"))
                .unwrap_or_else(|| "样本不足".to_string())
        },
        tone: if relative_active && high_beta_failed {
            "negative"
        } else if relative_active {
            "caution"
        } else {
            "positive"
        }
        .to_string(),
        status: if relative_active {
            "Relative Weakness"
        } else {
            "相对正常"
        }
        .to_string(),
        detail: format!(
            "确认资产中 {} / {} 个弱于基准或跌破 MA20；高 beta 链：{}。",
            relative_weak_count,
            relative_watch.len(),
            high_beta_text
        ),
    });

    let gap_failure_labels = gap_failure_labels(profile, snapshots);
    let gap_active = !gap_failure_labels.is_empty();
    signals.push(MarketInternalSignal {
        key: "gap_failure".to_string(),
        label: "缺口失败".to_string(),
        value: if gap_active {
            short_label_list(&gap_failure_labels)
        } else {
            "未触发".to_string()
        },
        tone: if gap_failure_labels.len() >= 2 {
            "negative"
        } else if gap_active {
            "caution"
        } else {
            "positive"
        }
        .to_string(),
        status: if gap_active {
            "Gap Failure"
        } else {
            "无失败缺口"
        }
        .to_string(),
        detail: if gap_active {
            format!(
                "{} 出现高开低走，说明龙头承接不足。",
                short_label_list(&gap_failure_labels)
            )
        } else {
            "未发现核心龙头高开后收跌的失败缺口。".to_string()
        },
    });

    let active_labels = signals
        .iter()
        .filter(|signal| internal_signal_is_active(signal))
        .map(|signal| signal.label.clone())
        .collect::<Vec<_>>();
    let tone = if signals.iter().any(|signal| signal.tone == "negative") {
        "negative"
    } else if signals.iter().any(|signal| signal.tone == "caution") {
        "caution"
    } else {
        "positive"
    };
    let summary = if active_labels.is_empty() {
        "内部广度、相对强弱和龙头缺口暂未显示扩散压力。".to_string()
    } else {
        format!(
            "{} 已触发，风险开始从单点向结构扩散。",
            active_labels.join(" / ")
        )
    };

    MarketInternals {
        summary,
        tone: tone.to_string(),
        scope_label: format!(
            "监控篮子 n={}，相对弱势 n={}",
            breadth_sample_size, relative_weakness_sample_size
        ),
        breadth_sample_size,
        relative_weakness_sample_size,
        breadth_advancing_ratio,
        relative_weakness_ratio,
        high_beta_order: high_beta_text,
        signals,
    }
}

fn high_beta_order_for(
    profile: &AnalysisProfile,
    snapshots: &HashMap<String, IndicatorSnapshot>,
) -> Option<(String, bool)> {
    let benchmark = profile
        .symbols
        .iter()
        .find(|item| item.symbol == profile.benchmark)?;
    let growth = profile
        .symbols
        .iter()
        .find(|item| item.role.as_deref() == Some("growth"))?;
    let sector = profile
        .symbols
        .iter()
        .find(|item| item.role.as_deref() == Some("sector"))?;
    let benchmark_return = snapshots.get(&benchmark.symbol)?.return_for(5)?;
    let growth_return = snapshots.get(&growth.symbol)?.return_for(5)?;
    let sector_return = snapshots.get(&sector.symbol)?.return_for(5)?;
    let failed = sector_return < growth_return && growth_return < benchmark_return;
    Some((
        format!(
            "5D {} < {} < {}",
            sector.symbol, growth.symbol, benchmark.symbol
        ),
        failed,
    ))
}

fn gap_failure_labels(
    profile: &AnalysisProfile,
    snapshots: &HashMap<String, IndicatorSnapshot>,
) -> Vec<String> {
    profile
        .symbols
        .iter()
        .filter(|item| {
            item.role
                .as_deref()
                .is_some_and(|role| role_matches(&profile.calibration.leader_roles, role))
        })
        .filter_map(|item| {
            let snapshot = snapshots.get(&item.symbol)?;
            let previous = snapshot.previous_close.filter(|value| *value > 0.0)?;
            let gap = percent(snapshot.candle.open / previous - 1.0);
            let intraday = percent(snapshot.candle.close / snapshot.candle.open - 1.0);
            let change = snapshot.change_1d().unwrap_or(0.0);
            if gap >= 0.5 && intraday < -0.6 && change <= 0.0 {
                Some(item.label.clone())
            } else {
                None
            }
        })
        .collect()
}

fn internal_signal_is_active(signal: &MarketInternalSignal) -> bool {
    match signal.key.as_str() {
        "breadth_collapse" => signal.status == "Breadth Collapse",
        "relative_weakness_expansion" => signal.status == "Relative Weakness",
        "gap_failure" => signal.status == "Gap Failure",
        _ => matches!(signal.tone.as_str(), "caution" | "negative"),
    }
}

fn market_internal_signal_active(internals: &MarketInternals, key: &str) -> bool {
    internals
        .signals
        .iter()
        .any(|signal| signal.key == key && internal_signal_is_active(signal))
}

fn market_internal_pressure_count(internals: &MarketInternals) -> usize {
    internals
        .signals
        .iter()
        .filter(|signal| internal_signal_is_active(signal))
        .count()
}

fn internal_structure_penalty(internals: &MarketInternals) -> i16 {
    let mut penalty = 0;
    if market_internal_signal_active(internals, "breadth_collapse") {
        penalty += 12;
    }
    if market_internal_signal_active(internals, "relative_weakness_expansion") {
        penalty += 10;
    }
    if market_internal_signal_active(internals, "gap_failure") {
        penalty += 4;
    }
    penalty
}

fn internal_momentum_penalty(internals: &MarketInternals) -> i16 {
    let mut penalty = 0;
    if market_internal_signal_active(internals, "relative_weakness_expansion") {
        penalty += 6;
    }
    if market_internal_signal_active(internals, "gap_failure") {
        penalty += 10;
    }
    penalty
}

fn internal_systemic_pressure(internals: &MarketInternals) -> u8 {
    let count = market_internal_pressure_count(internals);
    if count >= 2 {
        65
    } else if market_internal_signal_active(internals, "breadth_collapse") {
        58
    } else if market_internal_signal_active(internals, "relative_weakness_expansion") {
        55
    } else if market_internal_signal_active(internals, "gap_failure") {
        48
    } else {
        0
    }
}

fn portfolio_profile_for(
    profile: &AnalysisProfile,
    snapshots: &HashMap<String, IndicatorSnapshot>,
    risk_score: u8,
) -> PortfolioProfile {
    let weights_are_explicit = profile
        .symbols
        .iter()
        .any(|item| item.weight.is_some_and(|weight| weight > 0.0));
    let default_weight = if weights_are_explicit {
        0.0
    } else {
        let investable_count = profile
            .symbols
            .iter()
            .filter(|item| !is_volatility_symbol(item))
            .count()
            .max(1);
        100.0 / investable_count as f64
    };

    let mut holdings = profile
        .symbols
        .iter()
        .filter_map(|item| {
            let weight = item.weight.unwrap_or(default_weight);
            if weight <= 0.0 || !asset_participates_in_portfolio(item) {
                return None;
            }
            let snapshot = snapshots.get(&item.symbol)?;
            let status = asset_status_key(snapshot, item);
            let health_score = holding_health_score(snapshot, status);
            let ma20_gap = ma_distance(snapshot, 20).map(|value| round(value, 1));

            Some(PortfolioHolding {
                symbol: item.symbol.clone(),
                label: item.label.clone(),
                asset_kind: asset_kind_for(item).to_string(),
                weight: round(weight, 2),
                sector: portfolio_sector(item),
                style: portfolio_style(item),
                exposure: portfolio_exposure(item),
                status: status.to_string(),
                status_label: status_label(status).to_string(),
                health_score,
                health_tone: portfolio_health_tone(health_score).to_string(),
                contribution_risk: round(
                    (100_u8.saturating_sub(health_score)) as f64 * weight / 100.0,
                    1,
                ),
                return_20d: snapshot.return_for(20).map(|value| round(value, 2)),
                ma20_gap,
                note: technical_note(snapshot, item),
            })
        })
        .collect::<Vec<_>>();

    holdings.sort_by(|left, right| right.weight.total_cmp(&left.weight));

    let total_weight = round(holdings.iter().map(|item| item.weight).sum::<f64>(), 2);
    let health_score = if total_weight > 0.0 {
        bounded_score(
            (holdings
                .iter()
                .map(|item| item.health_score as f64 * item.weight)
                .sum::<f64>()
                / total_weight)
                .round() as i16,
        )
    } else {
        0
    };
    let sector_exposure = portfolio_exposure_group(&holdings, "sector");
    let style_exposure = portfolio_exposure_group(&holdings, "style");
    let exposure_breakdown = portfolio_exposure_group(&holdings, "exposure");
    let top_holding = holdings.first();
    let top_sector = sector_exposure.first();
    let top_style = style_exposure.first();
    let top_exposure = exposure_breakdown.first();
    let concentration_score = portfolio_concentration_score(
        top_holding.map(|item| item.weight).unwrap_or(0.0),
        top_sector.map(|item| item.weight).unwrap_or(0.0),
        top_style.map(|item| item.weight).unwrap_or(0.0),
        total_weight,
        &holdings,
    );
    let health_label = portfolio_health_label(health_score).to_string();
    let health_tone = portfolio_health_tone(health_score).to_string();
    let concentration_label = portfolio_concentration_label(concentration_score).to_string();
    let concentration_tone = portfolio_concentration_tone(concentration_score).to_string();
    let weighted_risk_score = bounded_score(
        ((100_u8.saturating_sub(health_score)) as f64 * 0.55 + risk_score as f64 * 0.45).round()
            as i16,
    );
    let top_sector_text = exposure_text(top_sector);
    let top_style_text = exposure_text(top_style);
    let top_exposure_text = exposure_text(top_exposure);
    let top_holding_label = top_holding
        .map(|item| item.label.clone())
        .unwrap_or_else(|| "-".to_string());
    let actions = portfolio_actions(
        &holdings,
        top_sector,
        top_style,
        health_score,
        concentration_score,
    );

    PortfolioProfile {
        total_weight,
        cash_weight: round((100.0 - total_weight).max(0.0), 2),
        health_score,
        health_label: health_label.clone(),
        health_tone,
        concentration_score,
        concentration_label,
        concentration_tone,
        top_holding_weight: top_holding.map(|item| item.weight).unwrap_or(0.0),
        top_holding: top_holding_label,
        top_sector: top_sector_text,
        top_style: top_style_text,
        top_exposure: top_exposure_text,
        weighted_risk_score,
        summary: format!(
            "持仓健康度 {}/100（{}），{} 暴露最高；这是现有持仓状态，不代表新增买点。",
            health_score,
            health_label,
            top_sector
                .map(|item| item.label.as_str())
                .unwrap_or("核心资产")
        ),
        holdings,
        sector_exposure,
        style_exposure,
        exposure_breakdown,
        actions,
    }
}

fn profile_calibration_status_for(
    profile: &AnalysisProfile,
    validation: &StateValidation,
    source: &str,
) -> ProfileCalibrationStatus {
    let meta = &profile.calibration_meta;
    let method = meta
        .method
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("未声明")
        .to_string();
    let method_key = method.to_ascii_lowercase();
    let has_validation_window = meta.validation_start.is_some() && meta.validation_end.is_some();
    let has_training_window = meta.training_start.is_some() && meta.training_end.is_some();
    let has_signature = meta
        .data_signature
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty());
    let calibrated_method = method_key.contains("walk-forward")
        || method_key.contains("walk_forward")
        || method_key.contains("imported");
    let sample_source = source.eq_ignore_ascii_case("sample");
    let enough_samples = validation.effective_sample_count >= 30;
    let execution_grade = profile.schema_version >= 2
        && calibrated_method
        && has_validation_window
        && has_signature
        && enough_samples
        && !sample_source;

    let mut warnings = Vec::new();
    if profile.schema_version < 2 {
        warnings.push("仍是 Profile v1，缺少可审计校准元数据。".to_string());
    }
    if !calibrated_method {
        warnings.push("当前参数属于人工基线，尚未完成 walk-forward 样本外校准。".to_string());
    }
    if !has_training_window {
        warnings.push("未声明训练窗口。".to_string());
    }
    if !has_validation_window {
        warnings.push("未声明独立验证窗口。".to_string());
    }
    if !has_signature {
        warnings.push("缺少数据签名，无法确认校准数据版本。".to_string());
    }
    if !enough_samples {
        warnings.push(format!(
            "有效独立样本仅 {} 个，暂不足以作为稳定胜率依据。",
            validation.effective_sample_count
        ));
    }
    if sample_source {
        warnings.push("当前使用演示数据，不可升级为执行级证据。".to_string());
    }

    let (stage, label, tone) = if execution_grade {
        ("validated", "样本外已验证", "positive")
    } else if method_key.contains("manual") {
        ("manual-baseline", "人工基线", "caution")
    } else if profile.schema_version < 2 {
        ("legacy", "旧版配置", "neutral")
    } else {
        ("evidence-gap", "校准证据不足", "caution")
    };
    let summary = if execution_grade {
        format!(
            "独立验证窗口与数据签名完整，当前状态样本有效 n={}。",
            validation.effective_sample_count
        )
    } else {
        warnings
            .first()
            .cloned()
            .unwrap_or_else(|| "校准证据尚未达到执行级。".to_string())
    };

    ProfileCalibrationStatus {
        stage: stage.to_string(),
        label: label.to_string(),
        tone: tone.to_string(),
        execution_grade,
        method,
        training_window: profile_window_label(
            meta.training_start.as_deref(),
            meta.training_end.as_deref(),
        ),
        validation_window: profile_window_label(
            meta.validation_start.as_deref(),
            meta.validation_end.as_deref(),
        ),
        data_signature: meta
            .data_signature
            .clone()
            .unwrap_or_else(|| "未记录".to_string()),
        objective: meta
            .objective
            .clone()
            .unwrap_or_else(|| "未声明".to_string()),
        effective_sample_count: validation.effective_sample_count,
        summary,
        warnings,
    }
}

fn profile_window_label(start: Option<&str>, end: Option<&str>) -> String {
    match (
        start.map(str::trim).filter(|value| !value.is_empty()),
        end.map(str::trim).filter(|value| !value.is_empty()),
    ) {
        (Some(start), Some(end)) => format!("{start} → {end}"),
        (Some(start), None) => format!("{start} → 未声明"),
        (None, Some(end)) => format!("未声明 → {end}"),
        (None, None) => "未声明".to_string(),
    }
}

fn profile_mandate_for(profile: &AnalysisProfile, portfolio: &PortfolioProfile) -> ProfileMandate {
    let mandate = &profile.mandate;
    let objective = mandate.objective.clone().unwrap_or_else(|| {
        profile
            .description
            .clone()
            .unwrap_or_else(|| "以 Profile 定义的市场、规则和持仓权重进行风险监控。".to_string())
    });
    let mandate_type = mandate
        .mandate_type
        .clone()
        .unwrap_or_else(|| "主动风险监控".to_string());
    let base_currency = mandate
        .base_currency
        .clone()
        .unwrap_or_else(|| default_currency_for_market(&profile.market).to_string());
    let benchmark_name = mandate
        .benchmark_name
        .clone()
        .unwrap_or_else(|| profile.benchmark.clone());
    let time_horizon = mandate
        .time_horizon
        .clone()
        .unwrap_or_else(|| "中短期状态跟踪 + 长期核心配置".to_string());
    let risk_budget = mandate
        .risk_budget
        .clone()
        .unwrap_or_else(|| "以趋势、系统风险、赔率和持仓健康度共同约束。".to_string());
    let max_drawdown = mandate
        .max_drawdown
        .clone()
        .unwrap_or_else(|| "未设置".to_string());
    let target_gross_exposure = mandate
        .target_gross_exposure
        .clone()
        .unwrap_or_else(|| format!("{:.0}% 风险资产基准权重", portfolio.total_weight));
    let rebalance_cadence = mandate
        .rebalance_cadence
        .clone()
        .unwrap_or_else(|| "日度评分，触发式调整".to_string());
    let liquidity = mandate
        .liquidity
        .clone()
        .unwrap_or_else(|| "优先使用 Profile 内可持续跟踪资产".to_string());

    let (risk_alignment, risk_alignment_tone) = match mandate.risk_score_limit {
        Some(limit) if portfolio.weighted_risk_score > limit => (
            format!("超预算 {}>{}", portfolio.weighted_risk_score, limit),
            "negative".to_string(),
        ),
        Some(limit) if portfolio.weighted_risk_score >= limit.saturating_sub(8) => (
            format!("接近预算 {}/{}", portfolio.weighted_risk_score, limit),
            "caution".to_string(),
        ),
        Some(limit) => (
            format!("预算内 {}/{}", portfolio.weighted_risk_score, limit),
            "positive".to_string(),
        ),
        None => ("未设上限".to_string(), "neutral".to_string()),
    };

    let mut constraints = mandate
        .constraints
        .iter()
        .enumerate()
        .filter_map(|(index, item)| {
            if item.label.trim().is_empty() || item.value.trim().is_empty() {
                return None;
            }
            Some(MandateConstraint {
                key: item
                    .key
                    .clone()
                    .filter(|value| !value.trim().is_empty())
                    .unwrap_or_else(|| format!("constraint_{index}")),
                label: item.label.trim().to_string(),
                value: item.value.trim().to_string(),
                tone: item.tone.clone().unwrap_or_else(|| "neutral".to_string()),
            })
        })
        .collect::<Vec<_>>();

    if constraints.is_empty() {
        constraints.push(MandateConstraint {
            key: "risk_budget".to_string(),
            label: "风险预算".to_string(),
            value: risk_alignment.clone(),
            tone: risk_alignment_tone.clone(),
        });
        constraints.push(MandateConstraint {
            key: "concentration".to_string(),
            label: "集中度".to_string(),
            value: portfolio.concentration_label.clone(),
            tone: portfolio.concentration_tone.clone(),
        });
    }

    let notes = if mandate.notes.is_empty() {
        vec!["Mandate 用于约束 Profile 语义，不替代人工投资适当性判断。".to_string()]
    } else {
        mandate.notes.clone()
    };
    let summary = format!(
        "{}；基准 {}，风险预算 {}。",
        objective, benchmark_name, risk_alignment
    );

    ProfileMandate {
        objective,
        mandate_type,
        base_currency,
        benchmark_name,
        time_horizon,
        risk_budget,
        max_drawdown,
        target_gross_exposure,
        rebalance_cadence,
        liquidity,
        risk_score_limit: mandate.risk_score_limit,
        risk_alignment,
        risk_alignment_tone,
        constraints,
        notes,
        summary,
    }
}

fn profile_fund_for(profile: &AnalysisProfile, as_of: NaiveDate) -> Option<ProfileFund> {
    let fund = &profile.fund;
    let configured = [
        fund.code.as_deref(),
        fund.name.as_deref(),
        fund.fund_type.as_deref(),
        fund.manager.as_deref(),
        fund.issuer.as_deref(),
        fund.nav_symbol.as_deref(),
        fund.holdings_as_of.as_deref(),
        fund.holdings_source.as_deref(),
    ]
    .iter()
    .any(|value| value.map(str::trim).is_some_and(|item| !item.is_empty()));

    if !configured {
        return None;
    }

    let code = non_empty_copy(fund.code.as_deref()).unwrap_or_else(|| profile.key.clone());
    let name = non_empty_copy(fund.name.as_deref()).unwrap_or_else(|| profile.name.clone());
    let fund_type =
        non_empty_copy(fund.fund_type.as_deref()).unwrap_or_else(|| "fund_profile".to_string());
    let manager = non_empty_copy(fund.manager.as_deref()).unwrap_or_else(|| "未设置".to_string());
    let issuer = non_empty_copy(fund.issuer.as_deref()).unwrap_or_else(|| "未设置".to_string());
    let nav_symbol = non_empty_copy(fund.nav_symbol.as_deref()).unwrap_or_default();
    let holdings_as_of = non_empty_copy(fund.holdings_as_of.as_deref()).unwrap_or_default();
    let holdings_source =
        non_empty_copy(fund.holdings_source.as_deref()).unwrap_or_else(|| "手工维护".to_string());

    let (holdings_age_days, freshness_label, freshness_tone) = if holdings_as_of.is_empty() {
        (None, "未设披露日".to_string(), "caution".to_string())
    } else {
        match NaiveDate::parse_from_str(&holdings_as_of, "%Y-%m-%d") {
            Ok(date) => {
                let age = (as_of - date).num_days();
                if age < 0 {
                    (
                        Some(age),
                        "披露日晚于评分日".to_string(),
                        "negative".to_string(),
                    )
                } else if age <= 45 {
                    (
                        Some(age),
                        format!("披露较新 {age}D"),
                        "positive".to_string(),
                    )
                } else if age <= 100 {
                    (Some(age), format!("披露可用 {age}D"), "neutral".to_string())
                } else {
                    (Some(age), format!("披露偏旧 {age}D"), "caution".to_string())
                }
            }
            Err(_) => (None, "披露日无效".to_string(), "negative".to_string()),
        }
    };

    let mut notes = fund.notes.clone();
    if holdings_as_of.is_empty() {
        notes.push("基金持仓披露日缺失，持仓穿透只能作为近似参考。".to_string());
    } else if matches!(freshness_tone.as_str(), "caution" | "negative") {
        notes
            .push("基金持仓可能滞后，短线买点应更多参考净值、基准和核心持仓实时状态。".to_string());
    }
    if nav_symbol.is_empty() {
        notes
            .push("未配置基金净值/交易 symbol，当前买点主要由持仓穿透和基准状态推导。".to_string());
    }
    if notes.is_empty() {
        notes.push(
            "基金层用于解释持仓来源和披露时效，评分仍由 Profile 规则与行情数据计算。".to_string(),
        );
    }

    let summary = format!(
        "{}（{}）：{}，持仓来源 {}。",
        name, code, freshness_label, holdings_source
    );

    Some(ProfileFund {
        enabled: true,
        code,
        name,
        fund_type,
        manager,
        issuer,
        nav_symbol,
        holdings_as_of,
        holdings_source,
        holdings_age_days,
        freshness_label,
        freshness_tone,
        summary,
        notes,
    })
}

fn default_currency_for_market(market: &str) -> &'static str {
    match market {
        "hk" => "HKD",
        "cn" => "CNY",
        "kr" => "KRW",
        "global" => "USD",
        _ => "USD",
    }
}

fn holding_health_score(snapshot: &IndicatorSnapshot, status: &str) -> u8 {
    let base = match status {
        "green" => 88.0,
        "yellow" => 60.0,
        "red" => 32.0,
        _ => 55.0,
    };
    let return_adjust = snapshot.return_for(20).unwrap_or(0.0).clamp(-20.0, 15.0) * 0.35;
    let ma_adjust = ma_distance(snapshot, 20).unwrap_or(0.0).clamp(-18.0, 12.0) * 0.30;
    let macd_adjust = if macd_bearish(snapshot) { -5.0 } else { 2.0 };
    bounded_score((base + return_adjust + ma_adjust + macd_adjust).round() as i16)
}

fn portfolio_exposure_group(holdings: &[PortfolioHolding], kind: &str) -> Vec<PortfolioExposure> {
    let mut weights = BTreeMap::<String, f64>::new();
    for holding in holdings {
        let label = match kind {
            "sector" => &holding.sector,
            "style" => &holding.style,
            _ => &holding.exposure,
        };
        *weights.entry(label.clone()).or_default() += holding.weight;
    }

    let mut rows = weights
        .into_iter()
        .map(|(label, weight)| PortfolioExposure {
            key: slug_key(&label),
            label,
            kind: kind.to_string(),
            weight: round(weight, 2),
            tone: portfolio_exposure_tone(weight).to_string(),
            status: portfolio_exposure_status(weight).to_string(),
        })
        .collect::<Vec<_>>();
    rows.sort_by(|left, right| right.weight.total_cmp(&left.weight));
    rows
}

fn portfolio_concentration_score(
    top_holding_weight: f64,
    top_sector_weight: f64,
    top_style_weight: f64,
    total_weight: f64,
    holdings: &[PortfolioHolding],
) -> u8 {
    let normalized_hhi = if total_weight > 0.0 {
        holdings
            .iter()
            .map(|item| {
                let normalized = item.weight / total_weight;
                normalized * normalized
            })
            .sum::<f64>()
            * 100.0
    } else {
        0.0
    };
    let score = (top_holding_weight - 12.0).max(0.0) * 2.1
        + (top_sector_weight - 35.0).max(0.0) * 1.35
        + (top_style_weight - 45.0).max(0.0) * 0.85
        + (normalized_hhi - 18.0).max(0.0) * 1.6;
    bounded_score(score.round() as i16)
}

fn portfolio_actions(
    holdings: &[PortfolioHolding],
    top_sector: Option<&PortfolioExposure>,
    top_style: Option<&PortfolioExposure>,
    health_score: u8,
    concentration_score: u8,
) -> Vec<PortfolioAction> {
    let weakest = holdings
        .iter()
        .filter(|item| item.status != "green")
        .max_by(|left, right| left.contribution_risk.total_cmp(&right.contribution_risk));
    let mut actions = Vec::new();

    if let Some(sector) = top_sector {
        actions.push(PortfolioAction {
            key: "sector_concentration".to_string(),
            label: "组合暴露".to_string(),
            tone: portfolio_concentration_tone(concentration_score).to_string(),
            detail: format!(
                "{} 权重 {:.0}%，{}。新增仓位优先等回踩确认或转向低相关暴露。",
                sector.label, sector.weight, sector.status
            ),
        });
    }

    if let Some(weak) = weakest {
        actions.push(PortfolioAction {
            key: "weak_holding_budget".to_string(),
            label: "持仓健康度".to_string(),
            tone: portfolio_health_tone(health_score).to_string(),
            detail: format!(
                "{} 贡献风险 {:.1}，先看能否修复 MA20/MA50，再决定是否恢复权重。",
                weak.label, weak.contribution_risk
            ),
        });
    }

    if let Some(style) = top_style {
        actions.push(PortfolioAction {
            key: "style_balance".to_string(),
            label: "风格暴露".to_string(),
            tone: portfolio_exposure_tone(style.weight).to_string(),
            detail: format!(
                "{} 风格权重 {:.0}%，再平衡时优先避免同方向继续叠加。",
                style.label, style.weight
            ),
        });
    }

    if actions.is_empty() {
        actions.push(PortfolioAction {
            key: "portfolio_ok".to_string(),
            label: "组合动作".to_string(),
            tone: "positive".to_string(),
            detail: "当前组合没有明显集中项，按原计划跟踪健康度和市场状态即可。".to_string(),
        });
    }

    actions.truncate(3);
    actions
}

fn portfolio_sector(item: &ProfileSymbol) -> String {
    item.sector
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| role_label(item.role.as_deref().unwrap_or("core")))
}

fn portfolio_style(item: &ProfileSymbol) -> String {
    item.style
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| style_label(item.role.as_deref().unwrap_or("core")))
}

fn portfolio_exposure(item: &ProfileSymbol) -> String {
    item.exposure
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| exposure_label(item.role.as_deref().unwrap_or("core")))
}

fn role_label(role: &str) -> String {
    match role {
        "benchmark" | "index" | "global" => "宽基".to_string(),
        "growth" => "科技".to_string(),
        "sector" | "theme" => "主题".to_string(),
        "leader" => "龙头".to_string(),
        "breadth" => "小盘".to_string(),
        "rates" => "利率".to_string(),
        "credit" => "信用".to_string(),
        "safe_haven" => "避险".to_string(),
        "fx" | "macro" => "宏观".to_string(),
        "supply_chain" => "供应链".to_string(),
        _ => "核心".to_string(),
    }
}

fn style_label(role: &str) -> String {
    match role {
        "growth" | "leader" | "sector" | "theme" | "supply_chain" => "成长".to_string(),
        "breadth" => "风险偏好".to_string(),
        "safe_haven" | "credit" | "rates" => "防守".to_string(),
        "macro" | "fx" => "宏观".to_string(),
        _ => "核心".to_string(),
    }
}

fn exposure_label(role: &str) -> String {
    match role {
        "safe_haven" => "避险资产".to_string(),
        "credit" => "信用".to_string(),
        "rates" => "利率".to_string(),
        "fx" | "macro" => "宏观".to_string(),
        "leader" => "个股".to_string(),
        _ => "风险资产".to_string(),
    }
}

fn portfolio_health_label(score: u8) -> &'static str {
    match score {
        78..=100 => "健康",
        62..=77 => "可持有",
        45..=61 => "需观察",
        _ => "偏脆弱",
    }
}

fn portfolio_health_tone(score: u8) -> &'static str {
    match score {
        75..=100 => "positive",
        58..=74 => "neutral",
        42..=57 => "caution",
        _ => "negative",
    }
}

fn portfolio_concentration_label(score: u8) -> &'static str {
    match score {
        75..=100 => "过度集中",
        55..=74 => "偏集中",
        35..=54 => "中等",
        _ => "分散",
    }
}

fn portfolio_concentration_tone(score: u8) -> &'static str {
    match score {
        75..=100 => "negative",
        55..=74 => "caution",
        35..=54 => "neutral",
        _ => "positive",
    }
}

fn portfolio_exposure_status(weight: f64) -> &'static str {
    if weight >= 50.0 {
        "高度集中"
    } else if weight >= 35.0 {
        "偏高"
    } else {
        "可控"
    }
}

fn portfolio_exposure_tone(weight: f64) -> &'static str {
    if weight >= 50.0 {
        "negative"
    } else if weight >= 35.0 {
        "caution"
    } else if weight >= 20.0 {
        "neutral"
    } else {
        "positive"
    }
}

fn exposure_text(exposure: Option<&PortfolioExposure>) -> String {
    exposure
        .map(|item| format!("{} {:.0}%", item.label, item.weight))
        .unwrap_or_else(|| "-".to_string())
}

fn slug_key(value: &str) -> String {
    value
        .trim()
        .to_lowercase()
        .chars()
        .map(|char| if char.is_whitespace() { '_' } else { char })
        .collect()
}

fn backtest_summary(
    profile: &AnalysisProfile,
    series: &HashMap<String, Vec<Candle>>,
    benchmark_series: &[Candle],
    benchmark_index: usize,
    score: u8,
    state: &MarketState,
    factors: &[FactorScore],
    leader: Option<&LeaderConfirmation>,
    internals: &MarketInternals,
) -> BacktestSummary {
    let forward_returns = [5_u16, 10, 20]
        .into_iter()
        .map(|days| {
            let future_index = benchmark_index + days as usize;
            match benchmark_series.get(future_index) {
                Some(future) => ForwardReturn {
                    days,
                    available: true,
                    end_date: Some(future.date.to_string()),
                    return_pct: Some(round(
                        percent(future.close / benchmark_series[benchmark_index].close - 1.0),
                        2,
                    )),
                },
                None => ForwardReturn {
                    days,
                    available: false,
                    end_date: None,
                    return_pct: None,
                },
            }
        })
        .collect();

    BacktestSummary {
        date: benchmark_series[benchmark_index].date.to_string(),
        score,
        spy_close: round(benchmark_series[benchmark_index].close, 2),
        benchmark_symbol: profile.benchmark.clone(),
        benchmark_close: round(benchmark_series[benchmark_index].close, 2),
        forward_returns,
        state_validation: state_validation_for(
            profile,
            series,
            benchmark_series,
            benchmark_index,
            state,
            factors,
        ),
        protocol_validation: protocol_validation_for(
            profile,
            series,
            benchmark_series,
            benchmark_index,
            score,
            state,
            factors,
            leader,
            internals,
        ),
        rule_set: backtest_rule_set_for(state, factors, leader, &profile.calibration, internals),
    }
}

fn state_validation_for(
    profile: &AnalysisProfile,
    series: &HashMap<String, Vec<Candle>>,
    benchmark_series: &[Candle],
    benchmark_index: usize,
    state: &MarketState,
    current_factors: &[FactorScore],
) -> StateValidation {
    let (samples, raw_sample_count) = historical_state_samples(
        profile,
        series,
        benchmark_series,
        benchmark_index,
        state,
        current_factors,
    );
    let exact_count = samples
        .iter()
        .filter(|sample| sample.exact_state_match)
        .count();
    let similar_count = samples.len().saturating_sub(exact_count);
    let match_mode = if exact_count >= 8 {
        "同状态".to_string()
    } else if samples.is_empty() {
        "样本不足".to_string()
    } else {
        "相似状态".to_string()
    };
    let (sample_quality_label, sample_quality_tone, sample_note) =
        sample_quality(samples.len(), exact_count, &match_mode);
    let sample_note = format!(
        "{} 原始匹配 {} 条，按 {} 个交易日间隔聚类后有效样本 {} 条。",
        sample_note,
        raw_sample_count,
        BACKTEST_SAMPLE_SPACING_DAYS,
        samples.len(),
    );
    let horizon_stats = [5_u16, 10, 20, 60]
        .into_iter()
        .map(|days| backtest_horizon_stat(benchmark_series, &samples, days))
        .collect::<Vec<_>>();
    let event_stats = backtest_event_stats(benchmark_series, &samples);
    let replay_samples = state_replay_samples(benchmark_series, &samples, 20);
    let (tone, confidence, verdict) = validation_verdict(
        state,
        &horizon_stats,
        &event_stats,
        samples.len(),
        &match_mode,
    );

    StateValidation {
        state_key: state.key.clone(),
        state_label: state.label.clone(),
        sample_count: samples.len(),
        raw_sample_count,
        effective_sample_count: samples.len(),
        sample_spacing_days: BACKTEST_SAMPLE_SPACING_DAYS,
        exact_sample_count: exact_count,
        similar_sample_count: similar_count,
        match_mode,
        sample_quality_label,
        sample_quality_tone,
        sample_note,
        verdict,
        tone,
        confidence,
        horizon_stats,
        event_stats,
        replay_samples,
    }
}

fn protocol_validation_for(
    profile: &AnalysisProfile,
    series: &HashMap<String, Vec<Candle>>,
    benchmark_series: &[Candle],
    benchmark_index: usize,
    score: u8,
    state: &MarketState,
    factors: &[FactorScore],
    leader: Option<&LeaderConfirmation>,
    internals: &MarketInternals,
) -> ProtocolValidation {
    let current_opportunities =
        opportunity_scores_for(&profile.calibration, factors, leader, internals);
    let current_risk = decision_risk_score(state, factors, score);
    let current_edge = decision_edge_score(state, &current_opportunities, factors);
    let current_protocol = protocol_state_for(state, factors, current_risk, current_edge);
    let protocol_samples =
        historical_protocol_samples(profile, series, benchmark_series, benchmark_index);
    let rows = ["healthy", "probe", "observe", "broken", "panic"]
        .into_iter()
        .map(|protocol| {
            let samples = protocol_samples
                .get(protocol)
                .cloned()
                .unwrap_or_else(Vec::new);
            protocol_validation_row(protocol, benchmark_series, &samples)
        })
        .collect::<Vec<_>>();
    let sample_count = rows.iter().map(|row| row.sample_count).sum();
    let current_row = rows
        .iter()
        .find(|row| row.protocol_state == current_protocol)
        .cloned();
    let (tone, verdict) = protocol_validation_verdict(current_protocol, current_row.as_ref());

    ProtocolValidation {
        current_protocol: current_protocol.to_string(),
        current_label: protocol_label(current_protocol).to_string(),
        sample_count,
        verdict,
        tone,
        rows,
    }
}

fn historical_protocol_samples(
    profile: &AnalysisProfile,
    series: &HashMap<String, Vec<Candle>>,
    benchmark_series: &[Candle],
    benchmark_index: usize,
) -> HashMap<String, Vec<HistoricalStateSample>> {
    const MIN_LOOKBACK: usize = 220;
    const MAX_HORIZON: usize = 60;
    let Some(last_index) = benchmark_index.checked_sub(MAX_HORIZON) else {
        return HashMap::new();
    };
    if last_index < MIN_LOOKBACK {
        return HashMap::new();
    }

    let mut by_protocol: HashMap<String, Vec<HistoricalStateSample>> = HashMap::new();
    for index in MIN_LOOKBACK..=last_index {
        let date = benchmark_series[index].date;
        let Some(future) = benchmark_series.get(index + MAX_HORIZON) else {
            continue;
        };
        if !profile_validation_sample_allowed(profile, date, future.date) {
            continue;
        }
        let Some((indexes, snapshots)) = context_at_date(profile, series, date) else {
            continue;
        };
        let Ok((dimensions, _, historical_score)) =
            score_snapshot(profile, series, &indexes, &snapshots)
        else {
            continue;
        };
        let Some(benchmark_snapshot) = snapshots.get(&profile.benchmark) else {
            continue;
        };
        let internals = market_internals_for(profile, &snapshots);
        let mut factors = factor_scores_for(&dimensions, benchmark_snapshot, &internals);
        let leader = leader_confirmation_for(profile, &snapshots, benchmark_snapshot);
        let opportunities =
            opportunity_scores_for(&profile.calibration, &factors, leader.as_ref(), &internals);
        calibrate_opportunity_factor(&mut factors, &opportunities);
        let historical_state = market_state_for_with_context(
            &profile.calibration,
            &factors,
            leader.as_ref(),
            &internals,
        );
        let risk_score = decision_risk_score(&historical_state, &factors, historical_score);
        let edge_score = decision_edge_score(&historical_state, &opportunities, &factors);
        let protocol = protocol_state_for(&historical_state, &factors, risk_score, edge_score);
        by_protocol
            .entry(protocol.to_string())
            .or_default()
            .push(HistoricalStateSample {
                index,
                exact_state_match: true,
            });
    }
    by_protocol
        .into_iter()
        .map(|(protocol, samples)| {
            (
                protocol,
                cluster_historical_samples(samples, BACKTEST_SAMPLE_SPACING_DAYS),
            )
        })
        .collect()
}

fn protocol_validation_row(
    protocol: &str,
    benchmark_series: &[Candle],
    samples: &[HistoricalStateSample],
) -> ProtocolValidationRow {
    let stat_20 = backtest_horizon_stat(benchmark_series, samples, 20);
    let tone = protocol_row_tone(protocol, &stat_20);
    let summary = protocol_row_summary(protocol, &stat_20);

    ProtocolValidationRow {
        protocol_state: protocol.to_string(),
        label: protocol_label(protocol).to_string(),
        permission: protocol_permission(protocol).to_string(),
        sample_count: stat_20.sample_count,
        median_return_20_pct: stat_20.median_return_pct,
        average_return_ci_low_20_pct: stat_20.average_return_ci_low_pct,
        average_return_ci_high_20_pct: stat_20.average_return_ci_high_pct,
        return_p25_20_pct: stat_20.return_p25_pct,
        return_p75_20_pct: stat_20.return_p75_pct,
        win_rate_20_pct: stat_20.win_rate_pct,
        median_max_drawdown_20_pct: stat_20.median_max_drawdown_pct,
        tail_loss_rate_20_pct: stat_20.tail_loss_rate_pct,
        severe_drawdown_rate_20_pct: stat_20.severe_drawdown_rate_pct,
        ma50_break_rate_20_pct: stat_20.ma50_break_rate_pct,
        tone: tone.to_string(),
        summary,
    }
}

fn protocol_row_tone(protocol: &str, stat: &BacktestHorizonStat) -> &'static str {
    if stat.sample_count < 8 {
        return "neutral";
    }
    let median_return = stat.median_return_pct.unwrap_or(0.0);
    let win_rate = stat.win_rate_pct.unwrap_or(0.0);
    let drawdown = stat.median_max_drawdown_pct.unwrap_or(0.0);
    let ma50_break = stat.ma50_break_rate_pct.unwrap_or(0.0);

    match protocol {
        "healthy" => {
            if median_return >= 1.0 && win_rate >= 52.0 && drawdown > -6.0 {
                "positive"
            } else if median_return < 0.0 || ma50_break >= 30.0 {
                "caution"
            } else {
                "neutral"
            }
        }
        "probe" => {
            if median_return >= 0.5 && drawdown > -5.5 {
                "positive"
            } else {
                "caution"
            }
        }
        "observe" => {
            if median_return < -1.0 || ma50_break >= 35.0 {
                "negative"
            } else {
                "caution"
            }
        }
        "broken" | "panic" => {
            if median_return < 0.0 || ma50_break >= 35.0 || drawdown <= -6.0 {
                "negative"
            } else {
                "caution"
            }
        }
        _ => "neutral",
    }
}

fn protocol_row_summary(protocol: &str, stat: &BacktestHorizonStat) -> String {
    if stat.sample_count < 8 {
        return "样本不足，暂不把该协议当作强验证。".to_string();
    }
    let median_return = stat.median_return_pct.unwrap_or(0.0);
    let win_rate = stat.win_rate_pct.unwrap_or(0.0);
    let drawdown = stat.median_max_drawdown_pct.unwrap_or(0.0);
    match protocol {
        "healthy" => format!(
            "历史健康态 20D 中位收益 {:.1}%，胜率 {:.0}%，用于验证允许分批是否有赔率。",
            median_return, win_rate
        ),
        "probe" => format!(
            "试探态 20D 中位收益 {:.1}%，中位回撤 {:.1}%，用于验证小仓试探是否优于纯等待。",
            median_return, drawdown
        ),
        "observe" => format!(
            "观察态 20D 中位收益 {:.1}%，中位回撤 {:.1}%，用于验证等待确认是否必要。",
            median_return, drawdown
        ),
        "broken" => format!(
            "破坏态 20D 中位收益 {:.1}%，中位回撤 {:.1}%，用于验证禁止扩仓纪律。",
            median_return, drawdown
        ),
        "panic" => format!(
            "高风险态 20D 中位收益 {:.1}%，中位回撤 {:.1}%，用于验证主动降风险。",
            median_return, drawdown
        ),
        _ => "协议样本已记录。".to_string(),
    }
}

fn protocol_validation_verdict(
    current_protocol: &str,
    row: Option<&ProtocolValidationRow>,
) -> (String, String) {
    let Some(row) = row else {
        return (
            "neutral".to_string(),
            "当前协议缺少历史样本，先按实时状态机执行，不把回测当作强证据。".to_string(),
        );
    };
    if row.sample_count < 8 {
        return (
            "neutral".to_string(),
            format!(
                "{} 历史样本不足，当前协议只作为风控语言，不作为统计结论。",
                row.label
            ),
        );
    }
    let median_return = row.median_return_20_pct.unwrap_or(0.0);
    let drawdown = row.median_max_drawdown_20_pct.unwrap_or(0.0);
    let text = match current_protocol {
        "healthy" => format!(
            "当前为健康协议；历史 20D 中位收益 {:.1}%，中位回撤 {:.1}%，用于校验是否允许分批进攻。",
            median_return, drawdown
        ),
        "probe" => format!(
            "当前为试探协议；历史 20D 中位收益 {:.1}%，中位回撤 {:.1}%，用于校验小仓验证是否优于纯等待。",
            median_return, drawdown
        ),
        "observe" => format!(
            "当前为观察协议；历史 20D 中位收益 {:.1}%，中位回撤 {:.1}%，重点验证等待确认是否比追价更优。",
            median_return, drawdown
        ),
        "broken" => format!(
            "当前为破坏协议；历史 20D 中位收益 {:.1}%，中位回撤 {:.1}%，用于校验停止加仓的纪律。",
            median_return, drawdown
        ),
        "panic" => format!(
            "当前为高风险协议；历史 20D 中位收益 {:.1}%，中位回撤 {:.1}%，用于校验主动降风险。",
            median_return, drawdown
        ),
        _ => "当前协议已进入横向回测表，可与其他状态协议对照。".to_string(),
    };
    (row.tone.clone(), text)
}

fn protocol_label(protocol: &str) -> &'static str {
    match protocol {
        "healthy" => "健康",
        "probe" => "试探",
        "observe" => "观察",
        "broken" => "破坏",
        "panic" => "高风险",
        _ => "未知",
    }
}

fn protocol_permission(protocol: &str) -> &'static str {
    match protocol {
        "healthy" => "允许分批",
        "probe" => "小仓试探",
        "observe" => "等待确认",
        "broken" => "停止加仓",
        "panic" => "主动降风险",
        _ => "人工复核",
    }
}

fn historical_state_samples(
    profile: &AnalysisProfile,
    series: &HashMap<String, Vec<Candle>>,
    benchmark_series: &[Candle],
    benchmark_index: usize,
    state: &MarketState,
    current_factors: &[FactorScore],
) -> (Vec<HistoricalStateSample>, usize) {
    const MIN_LOOKBACK: usize = 220;
    const MAX_HORIZON: usize = 60;
    let Some(last_index) = benchmark_index.checked_sub(MAX_HORIZON) else {
        return (Vec::new(), 0);
    };
    if last_index < MIN_LOOKBACK {
        return (Vec::new(), 0);
    }

    let mut exact = Vec::new();
    let mut similar = Vec::new();

    for index in MIN_LOOKBACK..=last_index {
        let date = benchmark_series[index].date;
        let Some(future) = benchmark_series.get(index + MAX_HORIZON) else {
            continue;
        };
        if !profile_validation_sample_allowed(profile, date, future.date) {
            continue;
        }
        let Some((indexes, snapshots)) = context_at_date(profile, series, date) else {
            continue;
        };
        let Ok((dimensions, _, _)) = score_snapshot(profile, series, &indexes, &snapshots) else {
            continue;
        };
        let Some(benchmark_snapshot) = snapshots.get(&profile.benchmark) else {
            continue;
        };
        let internals = market_internals_for(profile, &snapshots);
        let factors = factor_scores_for(&dimensions, benchmark_snapshot, &internals);
        let leader = leader_confirmation_for(profile, &snapshots, benchmark_snapshot);
        let historical_state = market_state_for_with_context(
            &profile.calibration,
            &factors,
            leader.as_ref(),
            &internals,
        );
        let exact_state_match = historical_state.key == state.key;

        if exact_state_match {
            exact.push(HistoricalStateSample {
                index,
                exact_state_match: true,
            });
        } else if similar_factor_match(current_factors, &factors) {
            similar.push(HistoricalStateSample {
                index,
                exact_state_match: false,
            });
        }
    }

    let clustered_exact = cluster_historical_samples(exact.clone(), BACKTEST_SAMPLE_SPACING_DAYS);
    if clustered_exact.len() >= 8 {
        (clustered_exact, exact.len())
    } else {
        let raw_sample_count = exact.len() + similar.len();
        exact.extend(similar);
        (
            cluster_historical_samples(exact, BACKTEST_SAMPLE_SPACING_DAYS),
            raw_sample_count,
        )
    }
}

fn cluster_historical_samples(
    samples: Vec<HistoricalStateSample>,
    spacing_days: usize,
) -> Vec<HistoricalStateSample> {
    let mut sorted = samples;
    sorted.sort_by_key(|sample| sample.index);
    let mut clustered: Vec<HistoricalStateSample> = Vec::new();
    for sample in sorted {
        let keep = clustered
            .last()
            .is_none_or(|previous| sample.index.saturating_sub(previous.index) >= spacing_days);
        if keep {
            clustered.push(sample);
        }
    }
    clustered
}

fn state_replay_samples(
    benchmark_series: &[Candle],
    samples: &[HistoricalStateSample],
    horizon_days: usize,
) -> Vec<StateReplaySample> {
    samples
        .iter()
        .filter_map(|sample| {
            let entry = benchmark_series.get(sample.index)?;
            if entry.close <= 0.0 {
                return None;
            }
            let end_index = sample.index.checked_add(horizon_days)?;
            let path = benchmark_series.get(sample.index..=end_index)?;
            Some(StateReplaySample {
                date: entry.date.to_string(),
                exact_state_match: sample.exact_state_match,
                path_returns_pct: path
                    .iter()
                    .map(|candle| round(percent(candle.close / entry.close - 1.0), 4))
                    .collect(),
            })
        })
        .collect()
}

fn profile_validation_sample_allowed(
    profile: &AnalysisProfile,
    sample_date: NaiveDate,
    horizon_end_date: NaiveDate,
) -> bool {
    let meta = &profile.calibration_meta;
    let validation_start = meta
        .validation_start
        .as_deref()
        .and_then(|value| NaiveDate::parse_from_str(value, "%Y-%m-%d").ok());
    let validation_end = meta
        .validation_end
        .as_deref()
        .and_then(|value| NaiveDate::parse_from_str(value, "%Y-%m-%d").ok());
    validation_start.is_none_or(|start| sample_date >= start)
        && validation_end.is_none_or(|end| horizon_end_date <= end)
}

fn context_at_date(
    profile: &AnalysisProfile,
    series: &HashMap<String, Vec<Candle>>,
    date: NaiveDate,
) -> Option<(HashMap<String, usize>, HashMap<String, IndicatorSnapshot>)> {
    let mut indexes = HashMap::new();
    let mut snapshots = HashMap::new();

    for symbol in &profile.symbols {
        let candles = series.get(&symbol.symbol)?;
        let index = find_index_on_or_before(candles, date)?;
        if index < 220 {
            return None;
        }
        indexes.insert(symbol.symbol.clone(), index);
        snapshots.insert(symbol.symbol.clone(), snapshot_at(candles, index));
    }

    Some((indexes, snapshots))
}

fn similar_factor_match(current: &[FactorScore], candidate: &[FactorScore]) -> bool {
    let keys = ["trend", "heat", "systemic", "structure"];
    keys.iter().all(|key| {
        let current_value = factor_value(current, key);
        let candidate_value = factor_value(candidate, key);
        let tolerance = match *key {
            "heat" => 22,
            "systemic" => 25,
            _ => 18,
        };
        current_value.abs_diff(candidate_value) <= tolerance
    })
}

fn backtest_horizon_stat(
    benchmark_series: &[Candle],
    samples: &[HistoricalStateSample],
    days: u16,
) -> BacktestHorizonStat {
    let mut returns = Vec::new();
    let mut drawdowns = Vec::new();
    let mut ma20_breaks = 0;
    let mut ma50_breaks = 0;
    let mut tail_losses = 0;
    let mut severe_drawdowns = 0;

    for sample in samples {
        let future_index = sample.index + days as usize;
        let Some(future) = benchmark_series.get(future_index) else {
            continue;
        };
        let entry = benchmark_series[sample.index].close;
        if entry <= 0.0 {
            continue;
        }

        let forward_return = percent(future.close / entry - 1.0);
        let max_drawdown = max_drawdown_after(benchmark_series, sample.index, future_index);
        if forward_return <= -5.0 {
            tail_losses += 1;
        }
        if max_drawdown <= -8.0 {
            severe_drawdowns += 1;
        }
        returns.push(forward_return);
        drawdowns.push(max_drawdown);
        if broke_ma_after(benchmark_series, sample.index, future_index, 20) {
            ma20_breaks += 1;
        }
        if broke_ma_after(benchmark_series, sample.index, future_index, 50) {
            ma50_breaks += 1;
        }
    }

    let sample_count = returns.len();
    let (ci_low, ci_high) = average_confidence_interval_90(&returns);
    BacktestHorizonStat {
        days,
        sample_count,
        median_return_pct: median_rounded(returns.clone()),
        average_return_pct: average_rounded(&returns),
        average_return_ci_low_pct: ci_low,
        average_return_ci_high_pct: ci_high,
        return_p25_pct: quantile_rounded(&returns, 0.25),
        return_p75_pct: quantile_rounded(&returns, 0.75),
        win_rate_pct: pct_rate(
            returns.iter().filter(|value| **value > 0.0).count(),
            sample_count,
        ),
        median_max_drawdown_pct: median_rounded(drawdowns),
        tail_loss_rate_pct: pct_rate(tail_losses, sample_count),
        severe_drawdown_rate_pct: pct_rate(severe_drawdowns, sample_count),
        ma20_break_rate_pct: pct_rate(ma20_breaks, sample_count),
        ma50_break_rate_pct: pct_rate(ma50_breaks, sample_count),
    }
}

fn backtest_event_stats(
    benchmark_series: &[Candle],
    samples: &[HistoricalStateSample],
) -> Vec<BacktestEventStat> {
    let sample_count = samples.len();
    let ma20_touch_rate = pct_rate(
        samples
            .iter()
            .filter(|sample| touched_ma_after(benchmark_series, sample.index, 20, 20, 1.0))
            .count(),
        sample_count,
    );
    let early_drawdown_rate = pct_rate(
        samples
            .iter()
            .filter(|sample| max_drawdown_after_days(benchmark_series, sample.index, 10) <= -3.0)
            .count(),
        sample_count,
    );
    let ma50_break_rate = pct_rate(
        samples
            .iter()
            .filter(|sample| broke_ma_after_days(benchmark_series, sample.index, 20, 50))
            .count(),
        sample_count,
    );

    vec![
        make_backtest_event(
            "ma20_pullback",
            "回踩 MA20",
            ma20_touch_rate,
            "positive",
            "未来 20 日内触及 MA20 附近的历史概率，用来验证等待回踩是否有意义。",
        ),
        make_backtest_event(
            "early_drawdown",
            "追高回撤",
            early_drawdown_rate,
            "caution",
            "未来 10 日内先出现 3% 以上回撤的概率，越高越不适合追。",
        ),
        make_backtest_event(
            "ma50_break",
            "跌破 MA50",
            ma50_break_rate,
            "negative",
            "未来 20 日内跌破 MA50 的概率，用来评估中期风控压力。",
        ),
    ]
}

fn make_backtest_event(
    key: &str,
    label: &str,
    value: Option<f64>,
    base_tone: &str,
    detail: &str,
) -> BacktestEventStat {
    let tone = match value {
        Some(value) if key == "ma50_break" && value >= 35.0 => "negative",
        Some(value) if key == "early_drawdown" && value >= 45.0 => "caution",
        Some(value) if key == "ma20_pullback" && value >= 50.0 => "positive",
        Some(_) => base_tone,
        None => "neutral",
    };

    BacktestEventStat {
        key: key.to_string(),
        label: label.to_string(),
        value: value
            .map(|item| format!("{:.0}%", item))
            .unwrap_or_else(|| "样本不足".to_string()),
        tone: tone.to_string(),
        detail: detail.to_string(),
    }
}

fn validation_verdict(
    state: &MarketState,
    horizon_stats: &[BacktestHorizonStat],
    event_stats: &[BacktestEventStat],
    sample_count: usize,
    match_mode: &str,
) -> (String, String, String) {
    if sample_count < 8 {
        return (
            "neutral".to_string(),
            "低".to_string(),
            "历史相似样本偏少，先把当前结论视为观察信号，暂不做强验证。".to_string(),
        );
    }

    let stat_5 = horizon_stats.iter().find(|item| item.days == 5);
    let stat_20 = horizon_stats.iter().find(|item| item.days == 20);
    let return_5 = stat_5
        .and_then(|item| item.median_return_pct)
        .unwrap_or(0.0);
    let return_20 = stat_20
        .and_then(|item| item.median_return_pct)
        .unwrap_or(0.0);
    let drawdown_20 = stat_20
        .and_then(|item| item.median_max_drawdown_pct)
        .unwrap_or(0.0);
    let pullback_rate = event_stats
        .iter()
        .find(|item| item.key == "ma20_pullback")
        .and_then(|item| item.value.trim_end_matches('%').parse::<f64>().ok())
        .unwrap_or(0.0);
    let confidence = if sample_count >= 30 {
        "中高"
    } else if match_mode == "同状态" {
        "中"
    } else {
        "中低"
    };

    if matches!(
        state.key.as_str(),
        "high_level_digest" | "strong_trend_hot" | "strong_trend_extreme_hot"
    ) {
        let verdict = if return_20 >= 0.0 && (return_5 <= return_20 || drawdown_20 <= -3.0) {
            format!(
                "历史样本更支持“持有等待回踩”：20D 中位收益 {:.1}%，但中途回撤 {:.1}%，追高性价比一般。",
                return_20, drawdown_20
            )
        } else {
            format!(
                "历史样本显示过热后的收益分布不稳定：5D {:.1}%，20D {:.1}%，需要严格等动作线。",
                return_5, return_20
            )
        };
        return ("caution".to_string(), confidence.to_string(), verdict);
    }

    if state.key == "trend_repair_leader_divergence" {
        return (
            "caution".to_string(),
            confidence.to_string(),
            format!(
                "历史样本显示指数修复后仍要看龙头确认；MA20 回踩概率约 {:.0}%，适合降低仓位上限。",
                pullback_rate
            ),
        );
    }
    if state.key == "strong_trend_divergence" {
        return (
            "caution".to_string(),
            confidence.to_string(),
            format!(
                "历史样本显示强趋势分化后收益更依赖弱资产能否修复；20D 中位收益 {:.1}%，中位回撤 {:.1}%，适合持有不追。",
                return_20, drawdown_20
            ),
        );
    }
    if state.key == "strong_trend_pullback_watch" {
        return (
            "caution".to_string(),
            confidence.to_string(),
            format!(
                "历史样本显示强趋势回踩后重点看 MA20 收复；MA20 回踩概率约 {:.0}%，适合持有观察而不是激进追高。",
                pullback_rate
            ),
        );
    }
    if state.key == "risk_diffusion_breakdown" {
        return (
            "negative".to_string(),
            confidence.to_string(),
            format!(
                "历史样本显示扩散破位阶段回撤风险抬升；20D 中位收益 {:.1}%，中位回撤 {:.1}%，适合先压低仓位上限。",
                return_20, drawdown_20
            ),
        );
    }
    if state.key == "risk_diffusion_watch" {
        return (
            "caution".to_string(),
            confidence.to_string(),
            format!(
                "历史样本显示风险扩散阶段的短线赔率下降；20D 中位收益 {:.1}%，中位回撤 {:.1}%，更适合等内部修复。",
                return_20, drawdown_20
            ),
        );
    }

    let tone = if return_20 >= 0.0 {
        "positive"
    } else {
        "caution"
    };
    (
        tone.to_string(),
        confidence.to_string(),
        format!(
            "历史{}样本的 20D 中位收益 {:.1}%，中位回撤 {:.1}%，可作为当前状态的初步校验。",
            match_mode, return_20, drawdown_20
        ),
    )
}

fn max_drawdown_after(series: &[Candle], start_index: usize, end_index: usize) -> f64 {
    let entry = series[start_index].close;
    if entry <= 0.0 || end_index <= start_index {
        return 0.0;
    }
    let min_low = series[start_index + 1..=end_index]
        .iter()
        .map(|candle| candle.low)
        .fold(entry, f64::min);
    round(percent(min_low / entry - 1.0), 2)
}

fn max_drawdown_after_days(series: &[Candle], start_index: usize, days: u16) -> f64 {
    let end_index = (start_index + days as usize).min(series.len().saturating_sub(1));
    max_drawdown_after(series, start_index, end_index)
}

fn broke_ma_after(series: &[Candle], start_index: usize, end_index: usize, period: usize) -> bool {
    if end_index <= start_index {
        return false;
    }
    (start_index + 1..=end_index).any(|index| {
        sma_close_at(series, index, period).is_some_and(|average| series[index].close < average)
    })
}

fn broke_ma_after_days(series: &[Candle], start_index: usize, days: u16, period: usize) -> bool {
    let end_index = (start_index + days as usize).min(series.len().saturating_sub(1));
    broke_ma_after(series, start_index, end_index, period)
}

fn touched_ma_after(
    series: &[Candle],
    start_index: usize,
    days: u16,
    period: usize,
    buffer_pct: f64,
) -> bool {
    let end_index = (start_index + days as usize).min(series.len().saturating_sub(1));
    if end_index <= start_index {
        return false;
    }
    (start_index + 1..=end_index).any(|index| {
        sma_close_at(series, index, period)
            .is_some_and(|average| series[index].low <= average * (1.0 + buffer_pct / 100.0))
    })
}

fn median_rounded(mut values: Vec<f64>) -> Option<f64> {
    if values.is_empty() {
        return None;
    }
    values.sort_by(|left, right| left.total_cmp(right));
    let middle = values.len() / 2;
    let median = if values.len() % 2 == 0 {
        (values[middle - 1] + values[middle]) / 2.0
    } else {
        values[middle]
    };
    Some(round(median, 2))
}

fn quantile_rounded(values: &[f64], quantile: f64) -> Option<f64> {
    if values.is_empty() {
        return None;
    }
    let mut sorted = values.to_vec();
    sorted.sort_by(|left, right| left.total_cmp(right));
    let rank = quantile.clamp(0.0, 1.0) * (sorted.len().saturating_sub(1) as f64);
    let lower = rank.floor() as usize;
    let upper = rank.ceil() as usize;
    if lower == upper {
        return Some(round(sorted[lower], 2));
    }
    let weight = rank - lower as f64;
    Some(round(
        sorted[lower] * (1.0 - weight) + sorted[upper] * weight,
        2,
    ))
}

fn average_rounded(values: &[f64]) -> Option<f64> {
    if values.is_empty() {
        return None;
    }
    Some(round(values.iter().sum::<f64>() / values.len() as f64, 2))
}

fn average_confidence_interval_90(values: &[f64]) -> (Option<f64>, Option<f64>) {
    if values.len() < 8 {
        return (None, None);
    }
    let mean = values.iter().sum::<f64>() / values.len() as f64;
    let variance = values
        .iter()
        .map(|value| (value - mean).powi(2))
        .sum::<f64>()
        / (values.len() - 1) as f64;
    let standard_error = variance.sqrt() / (values.len() as f64).sqrt();
    let margin = 1.64 * standard_error;
    (Some(round(mean - margin, 2)), Some(round(mean + margin, 2)))
}

fn pct_rate(count: usize, total: usize) -> Option<f64> {
    if total == 0 {
        None
    } else {
        Some(round(count as f64 / total as f64 * 100.0, 1))
    }
}

fn sample_quality(
    sample_count: usize,
    exact_count: usize,
    match_mode: &str,
) -> (String, String, String) {
    if sample_count < 8 {
        return (
            "低".to_string(),
            "neutral".to_string(),
            "历史样本少于 8 个，只能作为观察信息，不能当作统计结论。".to_string(),
        );
    }

    let exact_ratio = exact_count as f64 / sample_count as f64;
    let (label, tone) = if sample_count >= 60 && exact_ratio >= 0.7 {
        ("高", "positive")
    } else if sample_count >= 30 && exact_ratio >= 0.5 {
        ("中高", "positive")
    } else if sample_count >= 20 || exact_ratio >= 0.5 {
        ("中", "caution")
    } else {
        ("中低", "caution")
    };
    let note = if match_mode == "相似状态" {
        format!(
            "同状态样本 {} 个不足 8，已补入相似状态样本；总样本 {} 个，结论需要降权使用。",
            exact_count, sample_count
        )
    } else {
        format!(
            "同状态样本 {} 个，总样本 {} 个；样本质量主要由数量和同状态占比决定。",
            exact_count, sample_count
        )
    };

    (label.to_string(), tone.to_string(), note)
}

fn backtest_rule_set_for(
    state: &MarketState,
    factors: &[FactorScore],
    leader: Option<&LeaderConfirmation>,
    calibration: &ProfileCalibration,
    internals: &MarketInternals,
) -> BacktestRuleSet {
    BacktestRuleSet {
        state_rules: state_rules_for(state, factors, calibration),
        action_rules: action_rules_for(state, calibration),
        profile_rules: profile_rules_for(leader, calibration, internals),
    }
}

fn state_rules_for(
    state: &MarketState,
    factors: &[FactorScore],
    calibration: &ProfileCalibration,
) -> Vec<BacktestRule> {
    let trend = factor_value(factors, "trend");
    let heat = factor_value(factors, "heat");
    let systemic = factor_value(factors, "systemic");
    let structure = factor_value(factors, "structure");
    vec![
        BacktestRule {
            key: "state_identity".to_string(),
            label: state.label.clone(),
            condition: format!(
                "trend={trend}, heat={heat}, systemic={systemic}, structure={structure}"
            ),
            action: "每日只使用当日及之前数据重新识别状态。".to_string(),
            tone: state.tone.clone(),
        },
        BacktestRule {
            key: "hot_state_threshold".to_string(),
            label: "过热状态门槛".to_string(),
            condition: "trend >= 70 且 heat >= 70；heat >= 90 进入极度过热。".to_string(),
            action: "限制短线追高仓位，等待 MA20/MA50 动作线。".to_string(),
            tone: "caution".to_string(),
        },
        BacktestRule {
            key: "pullback_watch_threshold".to_string(),
            label: "回踩观察门槛".to_string(),
            condition: format!(
                "trend >= 70，structure >= {}，systemic < {}，且确认资产跌破 MA20 但未跌破 MA50。",
                calibration.pullback_structure_min, calibration.pullback_max_systemic
            ),
            action: "状态从强趋势扩张降为强趋势回踩观察，新增仓位等待重新站稳。".to_string(),
            tone: "caution".to_string(),
        },
        BacktestRule {
            key: "risk_diffusion_threshold".to_string(),
            label: "风险扩散门槛".to_string(),
            condition: "Breadth Collapse、Relative Weakness Expansion、Gap Failure 至少两项触发。"
                .to_string(),
            action: "状态降为风险扩散观察；新增仓位等待广度或高 beta 链条修复。".to_string(),
            tone: "caution".to_string(),
        },
        BacktestRule {
            key: "defensive_threshold".to_string(),
            label: "防守状态门槛".to_string(),
            condition: "systemic >= 75，或 trend < 35 且 structure < 45。".to_string(),
            action: "优先降低风险资产暴露。".to_string(),
            tone: "negative".to_string(),
        },
    ]
}

fn action_rules_for(state: &MarketState, calibration: &ProfileCalibration) -> Vec<BacktestRule> {
    let short_cap = match state.key.as_str() {
        "high_level_digest" | "strong_trend_extreme_hot" | "strong_trend_hot" => {
            "短线目标仓位 20%-35%".to_string()
        }
        "strong_trend_divergence" => {
            format!("短线目标仓位上限 {}%", calibration.divergence_trading_cap)
        }
        "trend_repair_leader_divergence" => {
            format!("短线目标仓位上限 {}%", calibration.divergence_trading_cap)
        }
        "strong_trend_pullback_watch" => {
            format!("短线目标仓位上限 {}%", calibration.pullback_trading_cap)
        }
        "risk_diffusion_breakdown" => "短线目标仓位 10%-25%，停止加仓".to_string(),
        "risk_diffusion_watch" => "短线目标仓位 20%-35%".to_string(),
        "strong_trend_expansion" | "strong_trend_healthy" => "短线目标仓位 35%-50%".to_string(),
        "risk_release" | "defensive_breakdown" => "短线目标仓位 0%-15%".to_string(),
        "trend_breakdown" => "短线目标仓位 10%-25%".to_string(),
        _ => "短线目标仓位按状态区间中值执行".to_string(),
    };

    vec![
        BacktestRule {
            key: "entry_ma20".to_string(),
            label: "观察加仓".to_string(),
            condition: "low <= MA20 * 1.01 且 close >= MA20 * 0.99。".to_string(),
            action: format!("进入回踩观察区；{short_cap}。"),
            tone: "positive".to_string(),
        },
        BacktestRule {
            key: "reduce_ma20".to_string(),
            label: "短线减仓".to_string(),
            condition: "close < MA20 连续 2 日，或跌破 MA20 后 3 日内无法收复。".to_string(),
            action: "下调短线仓位，等待重新站回 MA20。".to_string(),
            tone: "caution".to_string(),
        },
        BacktestRule {
            key: "defend_ma50".to_string(),
            label: "中期防守".to_string(),
            condition: "close < MA50 且 3 日内无法收复。".to_string(),
            action: "降低中期核心仓位，直到趋势结构修复。".to_string(),
            tone: "negative".to_string(),
        },
        BacktestRule {
            key: "long_ma200".to_string(),
            label: "长期失效".to_string(),
            condition: "close < MA200。".to_string(),
            action: "长期配置进入防守，不再按普通回踩处理。".to_string(),
            tone: "negative".to_string(),
        },
    ]
}

fn profile_rules_for(
    leader: Option<&LeaderConfirmation>,
    calibration: &ProfileCalibration,
    internals: &MarketInternals,
) -> Vec<BacktestRule> {
    let mut rules = Vec::new();

    for signal in internals
        .signals
        .iter()
        .filter(|signal| internal_signal_is_active(signal))
    {
        rules.push(BacktestRule {
            key: signal.key.clone(),
            label: signal.label.clone(),
            condition: signal.detail.clone(),
            action: match signal.key.as_str() {
                "breadth_collapse" => {
                    "上涨家数低于 35% 时，不把指数强势解释成全面健康；新增仓位等待广度恢复。"
                        .to_string()
                }
                "relative_weakness_expansion" => {
                    "高 beta 弱于低 beta 时，短线进攻降级为观察，等待弱势链条修复。".to_string()
                }
                "gap_failure" => "龙头高开低走说明承接不足，禁止按开盘强势追价。".to_string(),
                _ => signal.status.clone(),
            },
            tone: signal.tone.clone(),
        });
    }

    if let Some(leader) = leader {
        if leader.leader_count > 0 {
            let weak_names = if leader.weak_labels.is_empty() {
                "无".to_string()
            } else {
                leader.weak_labels.join(" / ")
            };
            rules.push(BacktestRule {
                key: "leader_confirmation".to_string(),
                label: "龙头确认约束".to_string(),
                condition: format!(
                    "leaderRoles={}；共 {} 个，弱确认 {} 个，跌破 MA20 {} 个，跌破 MA50 {} 个。",
                    role_list_text(&calibration.leader_roles),
                    leader.leader_count,
                    leader.weak_count,
                    leader.below_ma20_count,
                    leader.below_ma50_count
                ),
                action: format!(
                    "弱确认名单：{weak_names}。若任一龙头跌破 MA20/MA50 或弱确认比例达到 {:.0}%，则短线仓位上限压到 {}%。",
                    calibration.divergence_weak_ratio * 100.0,
                    calibration.divergence_trading_cap
                ),
                tone: if leader.divergent {
                    "caution".to_string()
                } else {
                    "positive".to_string()
                },
            });
        }

        if leader.confirmation_count > 0 {
            let confirmation_names = short_label_list(&leader.confirmation_weak_labels);
            rules.push(BacktestRule {
                key: "confirmation_pullback".to_string(),
                label: "确认资产回踩约束".to_string(),
                condition: format!(
                    "confirmationRoles={}；共 {} 个，弱确认 {} 个，跌破 MA20 {} 个，跌破 MA50 {} 个。",
                    role_list_text(&calibration.confirmation_roles),
                    leader.confirmation_count,
                    leader.confirmation_weak_count,
                    leader.confirmation_below_ma20_count,
                    leader.confirmation_below_ma50_count
                ),
                action: format!(
                    "弱确认名单：{confirmation_names}。若跌破 MA20 但未跌破 MA50，状态降为回踩观察；2 日无法收复再减仓。"
                ),
                tone: if leader.confirmation_below_ma20_count > 0 {
                    "caution".to_string()
                } else {
                    "positive".to_string()
                },
            });
        }
    }

    rules
}

fn snapshot_at(candles: &[Candle], index: usize) -> IndicatorSnapshot {
    let closes = candles
        .iter()
        .map(|candle| candle.close)
        .collect::<Vec<_>>();
    let (macd_values, signal_values) = macd_series(&closes);
    let moving_averages = [5_u16, 10, 20, 50, 60, 100, 120, 200]
        .into_iter()
        .filter_map(|period| {
            sma_close_at(candles, index, period as usize).map(|value| (period, value))
        })
        .collect::<HashMap<_, _>>();
    let returns = [1_u16, 5, 10, 20, 60, 120]
        .into_iter()
        .filter_map(|period| {
            percent_change_at(candles, index, period as usize).map(|value| (period, value))
        })
        .collect::<HashMap<_, _>>();
    let rsi_values = [6_u16, 14, 21]
        .into_iter()
        .filter_map(|period| rsi_at(candles, index, period as usize).map(|value| (period, value)))
        .collect::<HashMap<_, _>>();
    let kdj_values = [9_u16, 14, 21]
        .into_iter()
        .filter_map(|period| kdj_at(candles, index, period as usize).map(|value| (period, value)))
        .collect::<HashMap<_, _>>();
    let previous_kdj_values = index
        .checked_sub(1)
        .map(|previous_index| {
            [9_u16, 14, 21]
                .into_iter()
                .filter_map(|period| {
                    kdj_at(candles, previous_index, period as usize).map(|value| (period, value))
                })
                .collect::<HashMap<_, _>>()
        })
        .unwrap_or_default();
    let highs = [20_u16, 60, 120]
        .into_iter()
        .filter_map(|period| high_at(candles, index, period as usize).map(|value| (period, value)))
        .collect::<HashMap<_, _>>();

    IndicatorSnapshot {
        candle: candles[index].clone(),
        previous_close: index.checked_sub(1).map(|previous| candles[previous].close),
        rsi_14: rsi_values.get(&14).copied(),
        macd: macd_values.get(index).and_then(|value| *value),
        macd_signal: signal_values.get(index).and_then(|value| *value),
        previous_macd: index
            .checked_sub(1)
            .and_then(|previous| macd_values.get(previous))
            .and_then(|value| *value),
        previous_macd_signal: index
            .checked_sub(1)
            .and_then(|previous| signal_values.get(previous))
            .and_then(|value| *value),
        kdj_values,
        previous_kdj_values,
        volume_avg_20: sma_volume_at(candles, index, 20),
        high_60: highs.get(&60).copied(),
        highs,
        moving_averages,
        returns,
        rsi_values,
    }
}

fn find_index_on_or_before(candles: &[Candle], date: NaiveDate) -> Option<usize> {
    candles.iter().rposition(|candle| candle.date <= date)
}

fn sma_close_at(candles: &[Candle], index: usize, period: usize) -> Option<f64> {
    if index + 1 < period {
        return None;
    }
    let start = index + 1 - period;
    Some(
        candles[start..=index]
            .iter()
            .map(|candle| candle.close)
            .sum::<f64>()
            / period as f64,
    )
}

fn sma_volume_at(candles: &[Candle], index: usize, period: usize) -> Option<f64> {
    if index + 1 < period {
        return None;
    }
    let start = index + 1 - period;
    Some(
        candles[start..=index]
            .iter()
            .map(|candle| candle.volume)
            .sum::<f64>()
            / period as f64,
    )
}

fn high_at(candles: &[Candle], index: usize, period: usize) -> Option<f64> {
    if index + 1 < period {
        return None;
    }
    let start = index + 1 - period;
    candles[start..=index]
        .iter()
        .map(|candle| candle.high)
        .reduce(f64::max)
}

fn percent_change_at(candles: &[Candle], index: usize, days: usize) -> Option<f64> {
    if index < days {
        return None;
    }
    let previous = candles[index - days].close;
    if previous <= 0.0 {
        return None;
    }
    Some(percent(candles[index].close / previous - 1.0))
}

fn rsi_at(candles: &[Candle], index: usize, period: usize) -> Option<f64> {
    if index < period {
        return None;
    }

    let mut gains = 0.0;
    let mut losses = 0.0;
    for item_index in index + 1 - period..=index {
        let change = candles[item_index].close - candles[item_index - 1].close;
        if change >= 0.0 {
            gains += change;
        } else {
            losses += change.abs();
        }
    }

    if losses == 0.0 {
        return Some(100.0);
    }
    let rs = (gains / period as f64) / (losses / period as f64);
    Some(100.0 - (100.0 / (1.0 + rs)))
}

fn kdj_at(candles: &[Candle], index: usize, period: usize) -> Option<KdjValue> {
    if period == 0 || index + 1 < period {
        return None;
    }

    let mut k = 50.0;
    let mut d = 50.0;
    for item_index in period - 1..=index {
        let start = item_index + 1 - period;
        let window = &candles[start..=item_index];
        let low = window
            .iter()
            .map(|candle| candle.low)
            .fold(f64::INFINITY, f64::min);
        let high = window
            .iter()
            .map(|candle| candle.high)
            .fold(f64::NEG_INFINITY, f64::max);
        let range = high - low;
        let rsv = if range.abs() <= f64::EPSILON {
            50.0
        } else {
            ((candles[item_index].close - low) / range * 100.0).clamp(0.0, 100.0)
        };
        k = k * 2.0 / 3.0 + rsv / 3.0;
        d = d * 2.0 / 3.0 + k / 3.0;
    }

    Some(KdjValue {
        k,
        d,
        j: 3.0 * k - 2.0 * d,
    })
}

fn macd_series(closes: &[f64]) -> (Vec<Option<f64>>, Vec<Option<f64>>) {
    let ema_12 = ema_series(closes, 12);
    let ema_26 = ema_series(closes, 26);
    let mut macd = vec![None; closes.len()];
    for index in 0..closes.len() {
        if let (Some(fast), Some(slow)) = (ema_12[index], ema_26[index]) {
            macd[index] = Some(fast - slow);
        }
    }

    let mut signal = vec![None; closes.len()];
    let mut seed = Vec::new();
    let mut signal_ema = None;
    let multiplier = 2.0 / 10.0;

    for (index, value) in macd.iter().enumerate() {
        let Some(value) = value else {
            continue;
        };

        if signal_ema.is_none() {
            seed.push(*value);
            if seed.len() == 9 {
                let average = seed.iter().sum::<f64>() / seed.len() as f64;
                signal_ema = Some(average);
                signal[index] = Some(average);
            }
            continue;
        }

        let next = value * multiplier + signal_ema.unwrap() * (1.0 - multiplier);
        signal_ema = Some(next);
        signal[index] = Some(next);
    }

    (macd, signal)
}

fn ema_series(values: &[f64], period: usize) -> Vec<Option<f64>> {
    let mut output = vec![None; values.len()];
    if values.len() < period {
        return output;
    }

    let mut ema = values[..period].iter().sum::<f64>() / period as f64;
    output[period - 1] = Some(ema);
    let multiplier = 2.0 / (period as f64 + 1.0);
    for index in period..values.len() {
        ema = values[index] * multiplier + ema * (1.0 - multiplier);
        output[index] = Some(ema);
    }
    output
}

fn get_snapshot<'a>(
    snapshots: &'a HashMap<String, IndicatorSnapshot>,
    symbol: &str,
) -> Result<&'a IndicatorSnapshot, AppError> {
    snapshots
        .get(symbol)
        .ok_or_else(|| AppError::internal(format!("{symbol} snapshot is missing")))
}

fn underperformed_for(
    series: &HashMap<String, Vec<Candle>>,
    indexes: &HashMap<String, usize>,
    left: &str,
    right: &str,
    days: usize,
) -> bool {
    let Some(left_series) = series.get(left) else {
        return false;
    };
    let Some(right_series) = series.get(right) else {
        return false;
    };
    let Some(left_index) = indexes.get(left).copied() else {
        return false;
    };
    let Some(right_index) = indexes.get(right).copied() else {
        return false;
    };
    if left_index < days || right_index < days {
        return false;
    }

    (0..days).all(|offset| {
        let left_today = left_series[left_index - offset].close;
        let left_previous = left_series[left_index - offset - 1].close;
        let right_today = right_series[right_index - offset].close;
        let right_previous = right_series[right_index - offset - 1].close;
        left_today / left_previous - 1.0 < right_today / right_previous - 1.0
    })
}

fn relative_strength_declined(
    series: &HashMap<String, Vec<Candle>>,
    indexes: &HashMap<String, usize>,
    left: &str,
    right: &str,
    days: usize,
) -> bool {
    let Some(left_series) = series.get(left) else {
        return false;
    };
    let Some(right_series) = series.get(right) else {
        return false;
    };
    let Some(left_index) = indexes.get(left).copied() else {
        return false;
    };
    let Some(right_index) = indexes.get(right).copied() else {
        return false;
    };
    if left_index < days || right_index < days {
        return false;
    }

    (0..days).all(|offset| {
        let current =
            left_series[left_index - offset].close / right_series[right_index - offset].close;
        let previous = left_series[left_index - offset - 1].close
            / right_series[right_index - offset - 1].close;
        current < previous
    })
}

fn breadth_below_ma_ratio(
    rule: &RuleConfig,
    snapshots: &HashMap<String, IndicatorSnapshot>,
) -> Result<bool, AppError> {
    Ok(breadth_below_ma_ratio_value(rule, snapshots)
        .map(|value| {
            value >= rule.threshold.unwrap_or(50.0)
                && rule.max_threshold.map(|max| value <= max).unwrap_or(true)
        })
        .unwrap_or(false))
}

fn breadth_below_ma_ratio_value(
    rule: &RuleConfig,
    snapshots: &HashMap<String, IndicatorSnapshot>,
) -> Option<f64> {
    let period = rule.period.unwrap_or(20);
    let symbols = rule.symbols.as_ref()?;
    if symbols.is_empty() {
        return None;
    }

    let mut total = 0_u16;
    let mut below_count = 0_u16;
    for symbol in symbols {
        let Some(snapshot) = snapshots.get(symbol) else {
            continue;
        };
        let Some(average) = snapshot.ma(period) else {
            continue;
        };
        total += 1;
        if snapshot.candle.close < average {
            below_count += 1;
        }
    }

    (total > 0).then(|| percent(below_count as f64 / total as f64))
}

fn flow_turn_negative(
    series: &HashMap<String, Vec<Candle>>,
    indexes: &HashMap<String, usize>,
    symbol: &str,
    days: usize,
    threshold: f64,
    prior_sum_gt: f64,
) -> bool {
    let Some(candles) = series.get(symbol) else {
        return false;
    };
    let Some(index) = indexes.get(symbol).copied() else {
        return false;
    };
    if index < days || days == 0 {
        return false;
    }
    let Some(current_flow) = candles[index].flow else {
        return false;
    };
    let mut prior_sum = 0.0;
    for candle in candles.iter().take(index).skip(index - days) {
        let Some(flow) = candle.flow else {
            return false;
        };
        prior_sum += flow;
    }

    current_flow < threshold && prior_sum > prior_sum_gt
}

fn asset_status_key(snapshot: &IndicatorSnapshot, symbol: &ProfileSymbol) -> &'static str {
    if is_volatility_symbol(symbol) {
        let close = snapshot.candle.close;
        return if close >= 25.0 {
            "red"
        } else if close >= 20.0 || close < 15.0 {
            "yellow"
        } else {
            "green"
        };
    }

    let mut points = 0;
    if below(snapshot.candle.close, snapshot.ma(20)) {
        points += 1;
    }
    if below(snapshot.candle.close, snapshot.ma(50)) {
        points += 2;
    }
    if below(snapshot.candle.close, snapshot.ma(200)) {
        points += 3;
    }
    if macd_bearish(snapshot) {
        points += 1;
    }
    let rsi = snapshot.rsi_14.unwrap_or(0.0);
    if rsi > 85.0 {
        points += 3;
    } else if rsi > 75.0 {
        points += 2;
    } else if rsi > 70.0 {
        points += 1;
    }
    if snapshot.change_1d().unwrap_or(0.0) < -4.0 && snapshot.volume_ratio().unwrap_or(0.0) > 1.2 {
        points += 2;
    }

    if points >= 4 {
        "red"
    } else if points >= 2 {
        "yellow"
    } else {
        "green"
    }
}

fn status_label(status: &str) -> &'static str {
    match status {
        "green" => "绿灯",
        "yellow" => "黄灯",
        "red" => "红灯",
        _ => "未知",
    }
}

fn technical_note(snapshot: &IndicatorSnapshot, symbol: &ProfileSymbol) -> String {
    if is_volatility_symbol(symbol) {
        return match snapshot.candle.close {
            value if value >= 30.0 => "危机波动".to_string(),
            value if value >= 25.0 => "明显恐慌".to_string(),
            value if value >= 20.0 => "风险升温".to_string(),
            value if value < 15.0 => "过度平静".to_string(),
            _ => "正常区间".to_string(),
        };
    }

    if symbol.role.as_deref() == Some("fx") {
        let return_20d = snapshot.return_for(20).unwrap_or(0.0);
        let change_1d = snapshot.change_1d().unwrap_or(0.0);
        return if return_20d >= 4.0 || change_1d >= 1.2 {
            "汇率压力上升".to_string()
        } else if return_20d <= -2.0 {
            "汇率压力缓和".to_string()
        } else {
            "汇率观察".to_string()
        };
    }

    let rsi = snapshot.rsi_14.unwrap_or(0.0);
    let distance = ma_distance(snapshot, 20).unwrap_or(0.0);
    let return_20d = snapshot.return_for(20).unwrap_or(0.0);
    let change_1d = snapshot.change_1d().unwrap_or(0.0);

    if below(snapshot.candle.close, snapshot.ma(50)) {
        "跌破 MA50".to_string()
    } else if below(snapshot.candle.close, snapshot.ma(20)) {
        "动能降温".to_string()
    } else if matches!(symbol.symbol.as_str(), "SMH" | "NVDA")
        && above(snapshot.candle.close, snapshot.ma(20))
    {
        "外部确认仍强".to_string()
    } else if symbol.role.as_deref() == Some("offshore") && (rsi >= 78.0 || return_20d >= 18.0) {
        "海外资金拥挤".to_string()
    } else if rsi >= 90.0 || distance >= 25.0 || return_20d >= 45.0 {
        "极度过热".to_string()
    } else if symbol.role.as_deref() == Some("leader") && (rsi >= 82.0 || return_20d >= 25.0) {
        "龙头加速".to_string()
    } else if change_1d <= -2.0 && above(snapshot.candle.close, snapshot.ma(20)) {
        "强势但回落".to_string()
    } else if rsi >= 75.0 || distance >= 8.0 || return_20d >= 12.0 {
        "强趋势过热".to_string()
    } else if macd_bearish(snapshot) {
        "MACD 偏弱".to_string()
    } else {
        "趋势正常".to_string()
    }
}

fn is_volatility_symbol(symbol: &ProfileSymbol) -> bool {
    symbol.role.as_deref() == Some("volatility")
        || symbol.symbol.eq_ignore_ascii_case("VIX")
        || symbol.yahoo_symbol.as_deref() == Some("^VIX")
}

fn asset_kind_for(symbol: &ProfileSymbol) -> &'static str {
    if let Some(kind) = symbol
        .asset_kind
        .as_deref()
        .map(str::trim)
        .map(str::to_ascii_lowercase)
        .and_then(|kind| {
            SUPPORTED_ASSET_KINDS
                .iter()
                .find(|item| **item == kind.as_str())
                .copied()
        })
    {
        return kind;
    }

    if is_volatility_symbol(symbol) || symbol.weight.is_some_and(|weight| weight == 0.0) {
        return "observer";
    }
    if symbol.role.as_deref() == Some("proxy") {
        return "proxy";
    }
    if symbol.role.as_deref() == Some("benchmark") && symbol.weight.unwrap_or(0.0) <= 0.0 {
        return "benchmark";
    }
    "holding"
}

fn asset_participates_in_portfolio(symbol: &ProfileSymbol) -> bool {
    matches!(asset_kind_for(symbol), "holding")
}

fn risk_level(score: u8) -> RiskLevel {
    let (key, label, color) = match score {
        0..=25 => ("green", "绿色，风险较低", "#8dbb9e"),
        26..=45 => ("yellow", "无恐慌，但不宜追", "#d1be72"),
        46..=65 => ("orange", "橙色，风险偏高", "#c89a6b"),
        66..=80 => ("red", "红色，明显危险", "#cf8588"),
        _ => ("crimson", "深红，高风险环境", "#b76876"),
    };

    RiskLevel {
        key: key.to_string(),
        label: label.to_string(),
        color: color.to_string(),
    }
}

fn report_summary(score: u8, level: &RiskLevel, state: &MarketState) -> String {
    format!(
        "{}：{}（风险分 {score}/100，{}）。",
        state.label, state.summary, level.label
    )
}

fn guidance_for(profile: &AnalysisProfile, state: &MarketState) -> Vec<String> {
    if let Some(guidance) = profile
        .copy
        .states
        .get(&state.key)
        .and_then(|item| item.guidance.as_ref())
        .filter(|items| !items.is_empty())
    {
        return guidance.clone();
    }
    default_guidance_for(state)
}

fn default_guidance_for(state: &MarketState) -> Vec<String> {
    match state.key.as_str() {
        "high_level_digest" | "strong_trend_extreme_hot" => vec![
            "极度过热不是马上看空，核心是停止追高并等待动作线。".to_string(),
            "已有仓位优先看 MA20 是否守住；跌破后再按 MA50 做中期风控。".to_string(),
        ],
        "strong_trend_hot" => vec![
            "主趋势仍强时不急着反向交易，但新增仓位要等回踩确认。".to_string(),
            "短线用 MA20、成交量和核心标的是否滞涨来控制节奏。".to_string(),
        ],
        "strong_trend_expansion" | "strong_trend_healthy" => vec![
            "趋势和结构都较好，可以按计划分批推进，而不是一次性打满。".to_string(),
            "若价格远离 MA20 或 RSI 快速升温，新增仓位自动降速。".to_string(),
        ],
        "strong_trend_divergence" => vec![
            "主趋势仍在，但内部结构不是全面共振，当前更适合持有而不是追高。".to_string(),
            "等弱确认资产重新站回 MA20，或基准回踩 MA20 不破后，再提高短线动作力度。".to_string(),
        ],
        "strong_trend_pullback_watch" => vec![
            "主趋势仍在，但确认资产已经进入 MA20 回踩验证，当前重点是能否重新站稳。".to_string(),
            "已有仓位可以观察，不把单日回踩当成看空；新增仓位等确认资产收复 MA20 或基准回踩不破。"
                .to_string(),
        ],
        "trend_repair_leader_divergence" => vec![
            "指数结构仍在修复，但龙头没有形成一致上攻，当前适合持有观察。".to_string(),
            "先看龙头能否重新站回关键均线；若继续弱于指数，不把指数修复当成全面健康。".to_string(),
        ],
        "risk_diffusion_breakdown" => vec![
            "风险扩散已经叠加核心链条或结构破位，当前不是判断长期景气结束，而是先压低新增风险预算。"
                .to_string(),
            "等广度、核心资产和 MA50 结构至少修复两项后，再从停止加仓切回等待确认。".to_string(),
        ],
        "risk_diffusion_watch" => vec![
            "风险已经从单一指标扩散到内部广度或高 beta 链条，当前重点不是追强，而是等弱环节修复。"
                .to_string(),
            "上涨家数、相对强弱和龙头高开低走至少修复一项前，不提高短线进攻仓位。".to_string(),
        ],
        "trend_breakdown" => vec![
            "趋势结构已经被破坏，先控制仓位，不把低位波动当成低风险买点。".to_string(),
            "重新站回 MA20/MA50 且结构评分修复前，不恢复主动进攻仓位。".to_string(),
        ],
        "weak_trend_low_risk" => vec![
            "低波动不等于低风险，趋势未修复前不把仓位抬太高。".to_string(),
            "等待重新站上 MA20/MA50，或核心标的重新领涨。".to_string(),
        ],
        "risk_release" | "defensive_breakdown" => vec![
            "趋势或系统压力进入防守区，优先控制回撤和流动性。".to_string(),
            "只有重新站回关键均线并放量修复后，再考虑恢复仓位。".to_string(),
        ],
        _ => vec![
            "当前处于观察区，等待突破延续或回踩确认后再提高动作力度。".to_string(),
            "短线看过热，中期看趋势结构，长期看系统风险是否抬升。".to_string(),
        ],
    }
}

fn support_evidence_for(
    profile: &AnalysisProfile,
    snapshots: &HashMap<String, IndicatorSnapshot>,
) -> Vec<SupportEvidence> {
    let mut evidence = Vec::new();

    if let Some(benchmark) = profile
        .symbols
        .iter()
        .find(|item| item.symbol == profile.benchmark)
        .and_then(|item| snapshots.get(&item.symbol).map(|snapshot| (item, snapshot)))
    {
        let (item, snapshot) = benchmark;
        if above(snapshot.candle.close, snapshot.ma(20))
            && above(snapshot.candle.close, snapshot.ma(50))
        {
            evidence.push(SupportEvidence {
                key: "benchmark_trend".to_string(),
                label: "趋势未破".to_string(),
                tone: "positive".to_string(),
                text: format!("{} 仍在 MA20/MA50 上方，不追高不等于看空。", item.label),
            });
        }
    }

    if let Some(leader) = profile.symbols.iter().find(|item| {
        item.symbol != profile.benchmark
            && item
                .role
                .as_deref()
                .is_some_and(|role| matches!(role, "leader" | "growth"))
    }) {
        if let Some(snapshot) = snapshots.get(&leader.symbol) {
            if above(snapshot.candle.close, snapshot.ma(20)) {
                evidence.push(SupportEvidence {
                    key: "leader_trend".to_string(),
                    label: "龙头仍强".to_string(),
                    tone: "positive".to_string(),
                    text: format!("{} 仍站上 MA20，主线尚未明显破位。", leader.label),
                });
            }
        }
    }

    let external = profile
        .symbols
        .iter()
        .filter(|item| matches!(item.symbol.as_str(), "SMH" | "NVDA" | "QQQ"))
        .filter_map(|item| snapshots.get(&item.symbol).map(|snapshot| (item, snapshot)))
        .filter(|(_, snapshot)| above(snapshot.candle.close, snapshot.ma(20)))
        .map(|(item, _)| item.label.clone())
        .collect::<Vec<_>>();

    if !external.is_empty() {
        evidence.push(SupportEvidence {
            key: "external_confirmation".to_string(),
            label: "外部确认".to_string(),
            tone: "positive".to_string(),
            text: format!(
                "{} 仍在短期趋势上方，外部确认尚未明显破位。",
                external.join(" / ")
            ),
        });
    }

    if evidence.is_empty() {
        evidence.push(SupportEvidence {
            key: "no_support".to_string(),
            label: "支撑有限".to_string(),
            tone: "caution".to_string(),
            text: "暂时缺少明确反向证据，先按风险触发条件执行。".to_string(),
        });
    }

    evidence.truncate(3);
    evidence
}

fn leader_confirmation_for(
    profile: &AnalysisProfile,
    snapshots: &HashMap<String, IndicatorSnapshot>,
    benchmark: &IndicatorSnapshot,
) -> Option<LeaderConfirmation> {
    let benchmark_return = benchmark.return_for(20);
    let mut weak_labels = Vec::new();
    let mut leader_count = 0;
    let mut weak_count = 0;
    let mut below_ma20_count = 0;
    let mut below_ma50_count = 0;
    let mut confirmation_weak_labels = Vec::new();
    let mut confirmation_count = 0;
    let mut confirmation_weak_count = 0;
    let mut confirmation_below_ma20_count = 0;
    let mut confirmation_below_ma50_count = 0;

    for symbol in profile
        .symbols
        .iter()
        .filter(|item| item.symbol != profile.benchmark)
    {
        let role = symbol.role.as_deref().unwrap_or_default();
        let is_leader = role_matches(&profile.calibration.leader_roles, role);
        let is_confirmation = role_matches(&profile.calibration.confirmation_roles, role);
        if !is_leader && !is_confirmation {
            continue;
        }

        let Some(snapshot) = snapshots.get(&symbol.symbol) else {
            continue;
        };

        let below_ma20 = below(snapshot.candle.close, snapshot.ma(20));
        let below_ma50 = below(snapshot.candle.close, snapshot.ma(50));
        let underperformed = match (snapshot.return_for(20), benchmark_return) {
            (Some(symbol_return), Some(benchmark_return)) => {
                symbol_return - benchmark_return <= -3.0
            }
            _ => false,
        };
        let weak = below_ma20 || below_ma50 || underperformed;

        if is_leader {
            leader_count += 1;
            if below_ma20 {
                below_ma20_count += 1;
            }
            if below_ma50 {
                below_ma50_count += 1;
            }
            if weak {
                weak_count += 1;
                weak_labels.push(symbol.label.clone());
            }
        }

        if is_confirmation {
            confirmation_count += 1;
            if below_ma20 {
                confirmation_below_ma20_count += 1;
            }
            if below_ma50 {
                confirmation_below_ma50_count += 1;
            }
            if weak {
                confirmation_weak_count += 1;
                confirmation_weak_labels.push(symbol.label.clone());
            }
        }
    }

    if leader_count == 0 && confirmation_count == 0 {
        return None;
    }

    let half_or_more = weak_ratio_met(
        weak_count,
        leader_count,
        profile.calibration.divergence_weak_ratio,
    );
    let any_leader_break = below_ma20_count > 0 || below_ma50_count > 0;
    let divergent = if leader_count >= 2 {
        any_leader_break || half_or_more
    } else {
        any_leader_break && weak_count > 0
    };
    let severe = if leader_count >= 3 {
        below_ma50_count * 2 >= leader_count || weak_ratio_met(weak_count, leader_count, 0.67)
    } else {
        below_ma50_count > 0 || (leader_count >= 2 && half_or_more)
    };

    Some(LeaderConfirmation {
        leader_count,
        weak_count,
        below_ma20_count,
        below_ma50_count,
        weak_labels,
        confirmation_count,
        confirmation_weak_count,
        confirmation_below_ma20_count,
        confirmation_below_ma50_count,
        confirmation_weak_labels,
        divergent,
        severe,
    })
}

fn factor_scores_for(
    dimensions: &[DimensionScore],
    benchmark: &IndicatorSnapshot,
    internals: &MarketInternals,
) -> Vec<FactorScore> {
    let trend_pressure = factor_pressure(dimensions, "trend");
    let momentum_pressure = factor_pressure(dimensions, "momentum");
    let heat_pressure = factor_pressure(dimensions, "heat");
    let systemic_pressure = factor_raw_pressure(dimensions, "systemic", 4);
    let structure_pressure = factor_pressure(dimensions, "structure");
    let structure_penalty = internal_structure_penalty(internals);
    let momentum_penalty = internal_momentum_penalty(internals);
    let internal_systemic = internal_systemic_pressure(internals);

    let trend = bounded_score(trend_strength(benchmark) as i16 - trend_pressure as i16 / 3);
    let momentum = bounded_score(
        momentum_strength(benchmark) as i16 - momentum_pressure as i16 / 4 - momentum_penalty,
    );
    let heat = heat_pressure.max(technical_heat_pressure(benchmark));
    let systemic = systemic_pressure
        .max(technical_systemic_pressure(benchmark))
        .max(internal_systemic);
    let volatility = technical_volatility_pressure(benchmark);
    let structure = bounded_score(
        structure_strength(benchmark) as i16 - structure_pressure as i16 / 2 - structure_penalty,
    );
    let opportunity = opportunity_score(trend, heat, systemic, structure);

    vec![
        make_factor_score(
            "trend",
            "趋势",
            trend,
            100 - trend,
            trend_status(trend),
            trend_detail(benchmark),
        ),
        make_factor_score(
            "momentum",
            "动量",
            momentum,
            100_u8.saturating_sub(momentum),
            momentum_status(momentum),
            momentum_detail(benchmark),
        ),
        make_factor_score(
            "heat",
            "过热",
            heat,
            heat,
            heat_status(heat),
            heat_detail(benchmark),
        ),
        make_factor_score(
            "systemic",
            "系统风险",
            systemic,
            systemic,
            systemic_status(systemic),
            "波动、汇率、信用和关键均线共同决定系统压力。".to_string(),
        ),
        make_factor_score(
            "volatility",
            "波动恐慌",
            volatility,
            volatility,
            volatility_status(volatility),
            volatility_detail(benchmark),
        ),
        make_factor_score(
            "opportunity",
            "交易分",
            opportunity,
            100_u8.saturating_sub(opportunity),
            opportunity_status(opportunity),
            "用于判断当前是否适合新增仓位；趋势强会加分，但过热、分化和系统压力会压低交易分。"
                .to_string(),
        ),
        make_factor_score(
            "structure",
            "结构",
            structure,
            100_u8.saturating_sub(structure),
            structure_status(structure),
            structure_detail(benchmark),
        ),
    ]
}

fn make_factor_score(
    key: &str,
    label: &str,
    score: u8,
    pressure: u8,
    status: (&str, &str),
    detail: String,
) -> FactorScore {
    FactorScore {
        key: key.to_string(),
        label: label.to_string(),
        score,
        pressure,
        tone: status.0.to_string(),
        status: status.1.to_string(),
        detail,
    }
}

fn opportunity_scores_for(
    calibration: &ProfileCalibration,
    factors: &[FactorScore],
    leader: Option<&LeaderConfirmation>,
    internals: &MarketInternals,
) -> Vec<OpportunityScore> {
    let trend = factor_value(factors, "trend");
    let heat = factor_value(factors, "heat");
    let systemic = factor_value(factors, "systemic");
    let volatility = factor_value(factors, "volatility");
    let structure = factor_value(factors, "structure");

    let mut short = bounded_score(
        (trend as f64 * 0.20
            + structure as f64 * 0.20
            + (100 - heat) as f64 * 0.38
            + (100 - volatility) as f64 * 0.17
            + (100 - systemic) as f64 * 0.05)
            .round() as i16,
    );
    let mut medium = bounded_score(
        (trend as f64 * 0.28
            + structure as f64 * 0.28
            + (100 - heat) as f64 * 0.22
            + (100 - systemic) as f64 * 0.16
            + (100 - volatility) as f64 * 0.06)
            .round() as i16,
    );
    let mut long = bounded_score(
        (trend as f64 * 0.28
            + structure as f64 * 0.24
            + (100 - systemic) as f64 * 0.30
            + (100 - heat.min(70)) as f64 * 0.12
            + (100 - volatility.min(80)) as f64 * 0.06)
            .round() as i16,
    );

    if systemic >= 75 || (trend < 35 && structure < 45) {
        short = short.min(30);
        medium = medium.min(38);
        long = long.min(45);
    } else if trend < 45 {
        short = short.min(35);
        medium = medium.min(45);
    }
    if heat >= calibration.extreme_heat_min || volatility >= 80 {
        short = short.min(40);
        medium = medium.min(60);
        long = long.min(70);
    } else if heat >= calibration.hot_state_heat_min {
        short = short.min(calibration.hot_trading_cap);
        medium = medium.min(calibration.hot_medium_cap);
        long = long.min(calibration.hot_long_cap);
    }
    if let Some(leader) = leader {
        if leader.confirmation_count >= calibration.divergence_min_confirmations
            && weak_ratio_met(
                leader.confirmation_weak_count,
                leader.confirmation_count,
                calibration.divergence_weak_ratio,
            )
        {
            short = short.min(calibration.divergence_trading_cap);
            medium = medium.min(calibration.divergence_medium_cap);
            long = long.min(calibration.divergence_long_cap);
        }
        if leader.confirmation_below_ma20_count > 0 && leader.confirmation_below_ma50_count == 0 {
            let pullback_score_cap = calibration
                .pullback_trading_cap
                .saturating_add(18)
                .clamp(52, 64);
            short = short.min(pullback_score_cap);
            medium = medium.min(calibration.pullback_medium_cap);
        }
        if leader.divergent {
            short = short.min(calibration.divergence_trading_cap);
            medium = medium.min(calibration.divergence_medium_cap);
            long = long.min(calibration.divergence_long_cap);
        }
        if leader.severe {
            short = short.min(calibration.severe_trading_cap);
            medium = medium.min(calibration.severe_medium_cap);
            long = long.min(calibration.severe_long_cap);
        }
    }
    if market_internal_signal_active(internals, "breadth_collapse") {
        short = short.min(38);
        medium = medium.min(58);
    }
    if market_internal_signal_active(internals, "relative_weakness_expansion") {
        short = short.min(42);
        medium = medium.min(60);
        long = long.min(72);
    }
    if market_internal_signal_active(internals, "gap_failure") {
        short = short.min(40);
        medium = medium.min(62);
    }
    short = short.min(calibration.trading_score_cap);
    medium = medium.min(calibration.medium_score_cap);
    long = long.min(calibration.long_score_cap);

    vec![
        make_opportunity_score(
            "short",
            "短线机会",
            short,
            "过热和波动权重最高，适合判断今天是否还能追。",
        ),
        make_opportunity_score(
            "medium",
            "中线机会",
            medium,
            "更看重 MA20/MA50 结构和回踩后的趋势质量。",
        ),
        make_opportunity_score(
            "long",
            "长期配置",
            long,
            "更看重系统风险和长期趋势，不把短线过热等同于长期看空。",
        ),
    ]
}

fn make_opportunity_score(key: &str, label: &str, score: u8, detail: &str) -> OpportunityScore {
    let (tone, status) = opportunity_status(score);
    OpportunityScore {
        horizon_key: key.to_string(),
        horizon_label: label.to_string(),
        score,
        tone: tone.to_string(),
        status: status.to_string(),
        detail: detail.to_string(),
    }
}

fn calibrate_opportunity_factor(factors: &mut [FactorScore], opportunities: &[OpportunityScore]) {
    let Some(short_opportunity) = opportunities
        .iter()
        .find(|item| item.horizon_key == "short")
    else {
        return;
    };
    let Some(factor) = factors.iter_mut().find(|item| item.key == "opportunity") else {
        return;
    };

    factor.score = short_opportunity.score;
    factor.pressure = 100_u8.saturating_sub(short_opportunity.score);
    factor.tone = short_opportunity.tone.clone();
    factor.status = short_opportunity.status.clone();
    factor.detail =
        "已按市场状态、结构分化和 Profile 仓位上限校准，避免把强趋势直接解释成可追买点。"
            .to_string();
}

fn decision_frame_for(
    state: &MarketState,
    factors: &[FactorScore],
    opportunities: &[OpportunityScore],
    position_advice: &[PositionAdvice],
    structure: &StructureAnalysis,
    rule_risk_score: u8,
    copy: &ProfileCopyConfig,
) -> DecisionFrame {
    let trend_score = decision_trend_score(state, factors);
    let risk_score = decision_risk_score(state, factors, rule_risk_score);
    let edge_score = decision_edge_score(state, opportunities, factors);
    let short_action = position_advice
        .iter()
        .find(|item| item.horizon_key == "short")
        .or_else(|| position_advice.first())
        .map(|item| item.action.clone())
        .unwrap_or_else(|| "等待确认".to_string());
    let (permission, permission_tone) =
        decision_permission(state, trend_score, risk_score, edge_score);
    let protocol_state = protocol_state_for(state, factors, risk_score, edge_score);
    let trend_status = decision_trend_status(state, trend_score);
    let risk_status = decision_risk_status(state, risk_score, factors);
    let edge_status = decision_edge_status(edge_score);
    let (condition_label, condition) = decision_condition_for(
        protocol_state,
        permission,
        position_advice,
        structure,
        state,
    );
    let state_copy = copy.states.get(&state.key);
    let summary = state_copy
        .and_then(|item| item.summary.clone())
        .unwrap_or_else(|| {
            format!(
                "{}，{}，赔率{}；{}。",
                trend_status, risk_status, edge_status, permission
            )
        });

    DecisionFrame {
        protocol_state: protocol_state.to_string(),
        state_label: state.label.clone(),
        action_label: short_action,
        permission: permission.to_string(),
        permission_tone: permission_tone.to_string(),
        badge_label: state_copy.and_then(|item| item.badge.clone()),
        condition_label: condition_label.to_string(),
        condition,
        summary,
        note: state_copy.and_then(|item| item.note.clone()),
        trend: DecisionAxis {
            key: "trend".to_string(),
            label: "Trend".to_string(),
            score: trend_score,
            status: trend_status,
            tone: trend_tone(trend_score).to_string(),
            detail: state.summary.clone(),
        },
        risk: DecisionAxis {
            key: "risk".to_string(),
            label: "Risk".to_string(),
            score: risk_score,
            status: risk_status,
            tone: risk_tone(risk_score).to_string(),
            detail: decision_risk_detail(state, factors, rule_risk_score),
        },
        edge: DecisionAxis {
            key: "edge".to_string(),
            label: "Edge".to_string(),
            score: edge_score,
            status: edge_status,
            tone: opportunity_tone(edge_score).to_string(),
            detail: "衡量现在新增仓位是否值得；趋势、结构、过热和风险共同裁剪。".to_string(),
        },
        invalidation: structure.invalidation.clone(),
    }
}

fn decision_trend_score(state: &MarketState, factors: &[FactorScore]) -> u8 {
    let trend = factor_value(factors, "trend");
    let structure = factor_value(factors, "structure");
    let mut score = bounded_score((trend as f64 * 0.62 + structure as f64 * 0.38).round() as i16);

    score = match state.key.as_str() {
        "trend_breakdown" | "risk_release" | "defensive_breakdown" => score.min(34),
        "risk_diffusion_breakdown" => score.min(52),
        "risk_diffusion_watch" => score.min(62),
        "trend_repair_leader_divergence" => score.min(58),
        "strong_trend_divergence" => score.min(68),
        "strong_trend_pullback_watch" => score.min(72),
        _ => score,
    };

    score
}

fn decision_risk_score(state: &MarketState, factors: &[FactorScore], rule_risk_score: u8) -> u8 {
    let systemic = factor_value(factors, "systemic");
    let volatility = factor_value(factors, "volatility");
    let heat = factor_value(factors, "heat");
    let structure_risk = 100_u8.saturating_sub(factor_value(factors, "structure"));
    let mut score = rule_risk_score
        .max(systemic)
        .max(volatility)
        .max((heat as f64 * 0.55).round() as u8);

    score = match state.key.as_str() {
        "risk_release" | "defensive_breakdown" => score.max(78),
        "trend_breakdown" => score
            .max(trend_breakdown_risk_floor(structure_risk))
            .max(70),
        "risk_diffusion_breakdown" => score.max(72),
        "risk_diffusion_watch" => score.max(62),
        "trend_repair_leader_divergence" => score.max(58),
        "strong_trend_divergence" | "strong_trend_pullback_watch" => score.max(52),
        _ => score,
    };

    score.min(100)
}

fn trend_breakdown_risk_floor(structure_risk: u8) -> u8 {
    bounded_score(58 + (structure_risk as f64 * 0.28).round() as i16)
}

fn decision_edge_score(
    state: &MarketState,
    opportunities: &[OpportunityScore],
    factors: &[FactorScore],
) -> u8 {
    let mut score = opportunities
        .iter()
        .find(|item| item.horizon_key == "short")
        .map(|item| item.score)
        .unwrap_or_else(|| factor_value(factors, "opportunity"));

    score = match state.key.as_str() {
        "risk_release" | "defensive_breakdown" => score.min(25),
        "trend_breakdown" => score.min(30),
        "risk_diffusion_breakdown" => score.min(35),
        "risk_diffusion_watch" => score.min(45),
        "trend_repair_leader_divergence" => score.min(52),
        "strong_trend_divergence" => score.min(56),
        "strong_trend_pullback_watch" => score.min(64),
        "high_level_digest" | "strong_trend_hot" | "strong_trend_extreme_hot" => score.min(52),
        _ => score,
    };

    score
}

fn decision_permission(
    state: &MarketState,
    trend_score: u8,
    risk_score: u8,
    edge_score: u8,
) -> (&'static str, &'static str) {
    if matches!(state.key.as_str(), "risk_release" | "defensive_breakdown") {
        return ("主动降风险", "negative");
    }
    if state.key == "trend_breakdown" {
        return ("停止加仓", "negative");
    }
    if state.key == "risk_diffusion_breakdown" {
        return ("停止加仓", "negative");
    }
    if trend_score <= 40 && risk_score >= 70 {
        return ("主动降风险", "negative");
    }
    if risk_score >= 80 && edge_score <= 45 {
        return ("主动降风险", "negative");
    }
    if risk_score >= 72 && edge_score <= 45 {
        return ("停止加仓", "negative");
    }
    if risk_score >= 75 {
        return ("主动降风险", "negative");
    }
    if matches!(
        state.key.as_str(),
        "high_level_digest" | "strong_trend_hot" | "strong_trend_extreme_hot"
    ) {
        return ("禁止追高", "caution");
    }
    if edge_score < 55
        || matches!(
            state.key.as_str(),
            "trend_repair_leader_divergence" | "risk_diffusion_watch" | "strong_trend_divergence"
        )
    {
        return ("等待确认", "caution");
    }
    if trend_score >= 70 && risk_score < 55 && edge_score >= 70 {
        return ("允许分批", "positive");
    }
    if trend_score >= 66 && risk_score < 58 && edge_score >= 62 {
        return ("小仓试探", "positive");
    }
    ("持有观察", "neutral")
}

fn protocol_state_for(
    state: &MarketState,
    factors: &[FactorScore],
    risk_score: u8,
    edge_score: u8,
) -> &'static str {
    let systemic = factor_value(factors, "systemic");
    if matches!(state.key.as_str(), "risk_release" | "defensive_breakdown") || systemic >= 75 {
        return "panic";
    }
    if state.key == "trend_breakdown" {
        return "broken";
    }
    if state.key == "strong_trend_pullback_watch" && risk_score < 62 && edge_score >= 62 {
        return "probe";
    }
    let hard_observe_state = matches!(
        state.key.as_str(),
        "high_level_digest"
            | "strong_trend_hot"
            | "strong_trend_extreme_hot"
            | "trend_repair_leader_divergence"
            | "risk_diffusion_breakdown"
            | "risk_diffusion_watch"
            | "strong_trend_divergence"
            | "range_watch"
    );
    let pullback_needs_confirmation = state.key == "strong_trend_pullback_watch" && edge_score < 62;
    if risk_score >= 62 || edge_score < 55 || hard_observe_state || pullback_needs_confirmation {
        return "observe";
    }
    "healthy"
}

fn decision_condition_for(
    protocol_state: &str,
    permission: &str,
    position_advice: &[PositionAdvice],
    structure: &StructureAnalysis,
    state: &MarketState,
) -> (&'static str, String) {
    if permission == "小仓试探" {
        return (
            "试探条件",
            position_advice
                .iter()
                .find(|item| item.horizon_key == "short")
                .map(|item| item.entry_trigger.clone())
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| "只在回踩确认后小仓执行。".to_string()),
        );
    }

    match protocol_state {
        "panic" => (
            "解除条件",
            "系统压力回落至 60 以下，且基准与核心标的重新站回关键均线。".to_string(),
        ),
        "broken" => ("修复条件", repair_condition_for(structure)),
        "observe" => (
            "确认条件",
            position_advice
                .iter()
                .find(|item| item.horizon_key == "short")
                .map(|item| item.entry_trigger.clone())
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| "等待结构重新确认后再提高风险预算。".to_string()),
        ),
        _ => (
            "失效条件",
            if structure.invalidation.trim().is_empty() || structure.invalidation == "-" {
                state.summary.clone()
            } else {
                structure.invalidation.clone()
            },
        ),
    }
}

fn repair_condition_for(structure: &StructureAnalysis) -> String {
    let invalidation = structure.invalidation.trim();
    if invalidation.is_empty() || invalidation == "-" {
        return "重新站回关键均线，并恢复结构评分。".to_string();
    }
    invalidation
        .replacen("跌破", "重新站回", 1)
        .replace("且无法快速收复", "")
        .replace("；若放量下跌同步出现，优先降低仓位。", "")
        .trim()
        .to_string()
}

fn decision_trend_status(state: &MarketState, score: u8) -> String {
    match state.key.as_str() {
        "trend_breakdown" => "趋势破坏".to_string(),
        "risk_release" | "defensive_breakdown" => "风险主导".to_string(),
        "risk_diffusion_breakdown" => "扩散破位".to_string(),
        "risk_diffusion_watch" => "风险扩散".to_string(),
        "trend_repair_leader_divergence" => "修复分歧".to_string(),
        "strong_trend_pullback_watch" => "回踩观察".to_string(),
        "strong_trend_divergence" => "趋势分化".to_string(),
        _ if score >= 75 => "趋势健康".to_string(),
        _ if score >= 55 => "趋势可用".to_string(),
        _ if score >= 35 => "趋势脆弱".to_string(),
        _ => "趋势破坏".to_string(),
    }
}

fn decision_risk_status(state: &MarketState, score: u8, factors: &[FactorScore]) -> String {
    if state.key == "trend_breakdown" && factor_value(factors, "volatility") < 35 {
        return "未恐慌但结构风险高".to_string();
    }
    if matches!(
        state.key.as_str(),
        "risk_diffusion_breakdown"
            | "risk_diffusion_watch"
            | "trend_repair_leader_divergence"
            | "strong_trend_divergence"
    ) {
        return "结构风险中高".to_string();
    }
    format!("风险{}", risk_word(score, false))
}

fn decision_edge_status(score: u8) -> String {
    match score {
        75..=100 => "高".to_string(),
        55..=74 => "中".to_string(),
        35..=54 => "一般".to_string(),
        _ => "差".to_string(),
    }
}

fn decision_risk_detail(
    state: &MarketState,
    factors: &[FactorScore],
    rule_risk_score: u8,
) -> String {
    let systemic = factor_value(factors, "systemic");
    let volatility = factor_value(factors, "volatility");
    if state.key == "trend_breakdown" && volatility < 35 {
        return format!(
            "波动恐慌 {volatility}/100 仍低，但趋势与结构已破坏；交易许可按结构风险收缩。"
        );
    }
    if state.key == "risk_diffusion_breakdown" {
        return format!(
            "系统压力 {systemic}/100，波动恐慌 {volatility}/100；内部扩散已叠加核心链条或结构破位。"
        );
    }
    if state.key == "risk_diffusion_watch" {
        return format!(
            "系统压力 {systemic}/100，波动恐慌 {volatility}/100；内部广度或高 beta 链条已转弱。"
        );
    }
    format!("规则压力 {rule_risk_score}/100，系统压力 {systemic}/100，波动恐慌 {volatility}/100。")
}

fn decision_metric_contexts_for(
    benchmark_series: &[Candle],
    benchmark_index: usize,
    frame: &DecisionFrame,
) -> Vec<DecisionMetricContext> {
    let history = decision_metric_history(benchmark_series, benchmark_index);
    vec![
        decision_metric_context_for(
            &frame.trend,
            axis_history_values(&history, "trend"),
            "MA20/MA50/MA200 + 结构",
            "趋势用于判断持有基础；新增动作还要看风险和机会是否同步达标。",
        ),
        decision_metric_context_for(
            &frame.risk,
            axis_history_values(&history, "risk"),
            "规则压力 / 系统 / 波动 / 过热",
            "风险用于裁剪动作强度；高风险优先降级为等待、停止加仓或主动降风险。",
        ),
        decision_metric_context_for(
            &frame.edge,
            axis_history_values(&history, "edge"),
            "趋势 / 结构 / 过热 / 风险裁剪",
            "机会用于判断新增仓位赔率；试探区只小仓验证，高分区才允许分批。",
        ),
    ]
}

fn decision_metric_context_for(
    axis: &DecisionAxis,
    history_values: Vec<u8>,
    scope: &str,
    detail: &str,
) -> DecisionMetricContext {
    let percentile = percentile_rank(&history_values, axis.score);
    let sample_label = if history_values.len() >= 20 {
        format!("近{}日", history_values.len())
    } else {
        "样本不足".to_string()
    };

    DecisionMetricContext {
        key: axis.key.clone(),
        label: axis.label.clone(),
        value: axis.score,
        percentile,
        percentile_label: percentile
            .map(|value| format!("P{value}"))
            .unwrap_or_else(|| "P--".to_string()),
        sample_label,
        scope: scope.to_string(),
        tone: axis.tone.clone(),
        detail: detail.to_string(),
    }
}

fn decision_metric_history(
    benchmark_series: &[Candle],
    benchmark_index: usize,
) -> Vec<(u8, u8, u8)> {
    const MIN_LOOKBACK: usize = 220;
    const SAMPLE_DAYS: usize = 120;
    if benchmark_index < MIN_LOOKBACK {
        return Vec::new();
    }

    let start = benchmark_index
        .saturating_sub(SAMPLE_DAYS.saturating_sub(1))
        .max(MIN_LOOKBACK);
    (start..=benchmark_index)
        .map(|index| {
            let snapshot = snapshot_at(benchmark_series, index);
            baseline_decision_values(&snapshot)
        })
        .collect()
}

fn baseline_decision_values(snapshot: &IndicatorSnapshot) -> (u8, u8, u8) {
    let trend = bounded_score(
        (trend_strength(snapshot) as f64 * 0.62 + structure_strength(snapshot) as f64 * 0.38)
            .round() as i16,
    );
    let heat = technical_heat_pressure(snapshot);
    let systemic = technical_systemic_pressure(snapshot);
    let volatility = technical_volatility_pressure(snapshot);
    let structure = structure_strength(snapshot);
    let risk = systemic
        .max(volatility)
        .max((heat as f64 * 0.55).round() as u8);
    let edge = opportunity_score(trend, heat, systemic.max(volatility), structure);
    (trend, risk.min(100), edge)
}

fn axis_history_values(history: &[(u8, u8, u8)], key: &str) -> Vec<u8> {
    history
        .iter()
        .map(|(trend, risk, edge)| match key {
            "risk" => *risk,
            "edge" => *edge,
            _ => *trend,
        })
        .collect()
}

fn percentile_rank(values: &[u8], current: u8) -> Option<u8> {
    if values.len() < 20 {
        return None;
    }
    let below_or_equal = values.iter().filter(|value| **value <= current).count();
    let percentile = ((below_or_equal as f64 / values.len() as f64) * 100.0).round() as u8;
    Some(percentile.clamp(1, 99))
}

fn trend_tone(score: u8) -> &'static str {
    match score {
        75..=100 => "positive",
        55..=74 => "neutral",
        35..=54 => "caution",
        _ => "negative",
    }
}

fn status_metrics_for(
    state: &MarketState,
    factors: &[FactorScore],
    opportunities: &[OpportunityScore],
    risk_score: u8,
    internals: &MarketInternals,
) -> Vec<StatusMetric> {
    let heat = factor_value(factors, "heat");
    let systemic = factor_value(factors, "systemic");
    let volatility = factor_value(factors, "volatility");
    let short_opportunity = opportunities
        .iter()
        .find(|item| item.horizon_key == "short")
        .map(|item| item.score)
        .unwrap_or_else(|| factor_value(factors, "opportunity"));
    let pullback_watch = state.key == "strong_trend_pullback_watch";
    let divergence_watch = state.key == "strong_trend_divergence";
    let leader_divergence_watch = state.key == "trend_repair_leader_divergence";
    let diffusion_watch = matches!(
        state.key.as_str(),
        "risk_diffusion_watch" | "risk_diffusion_breakdown"
    );

    vec![
        StatusMetric {
            key: "chase_risk".to_string(),
            label: "追高风险".to_string(),
            value: if pullback_watch && heat < 75 {
                "中高"
            } else if divergence_watch && heat < 55 {
                "中"
            } else if leader_divergence_watch && heat < 55 {
                "中"
            } else if diffusion_watch {
                "高"
            } else {
                risk_word(heat, false)
            }
            .to_string(),
            tone: if (pullback_watch && heat < 75)
                || (divergence_watch && heat < 55)
                || (leader_divergence_watch && heat < 55)
                || diffusion_watch
            {
                "caution"
            } else {
                risk_tone(heat)
            }
            .to_string(),
            detail: if pullback_watch {
                format!("过热 {heat}/100，确认资产已回踩 MA20，新增追高需要等重新站稳。")
            } else if divergence_watch {
                format!("过热 {heat}/100，结构分化会抬高追高风险，即使系统压力不高也不宜激进追。")
            } else if leader_divergence_watch {
                format!("过热 {heat}/100，龙头确认不足会抬高追高风险，不能只按低过热判断买点。")
            } else if diffusion_watch {
                format!(
                    "过热 {heat}/100；{}，强势开盘或单一指数强势不再直接等于可追。",
                    internals.summary
                )
            } else {
                format!("过热 {heat}/100，越高越不适合新增追高。")
            },
        },
        StatusMetric {
            key: "systemic_risk".to_string(),
            label: if diffusion_watch || state.key == "trend_repair_leader_divergence" {
                "结构压力"
            } else {
                "系统压力"
            }
            .to_string(),
            value: risk_word(systemic, false).to_string(),
            tone: risk_tone(systemic).to_string(),
            detail: if diffusion_watch {
                format!(
                    "结构风险 {systemic}/100，{} 不等同于系统性恐慌，但会压低新增仓位赔率。",
                    internals.summary
                )
            } else if state.key == "trend_repair_leader_divergence" {
                format!(
                    "结构风险 {systemic}/100，指数仍在修复，但核心权重确认不足，不等同于系统性转弱。"
                )
            } else {
                format!("系统风险 {systemic}/100，关注趋势破位和宏观压力。")
            },
        },
        StatusMetric {
            key: "volatility_risk".to_string(),
            label: "波动恐慌".to_string(),
            value: risk_word(volatility, false).to_string(),
            tone: risk_tone(volatility).to_string(),
            detail: format!("波动恐慌 {volatility}/100，高位加速后的回撤风险单独处理。"),
        },
        StatusMetric {
            key: "opportunity_quality".to_string(),
            label: "短线买点".to_string(),
            value: if pullback_watch {
                if short_opportunity >= 62 {
                    "小仓试探"
                } else if short_opportunity >= 55 {
                    "持有观察"
                } else {
                    "等待确认"
                }
            } else if divergence_watch {
                "等待分化"
            } else if diffusion_watch {
                "等待修复"
            } else {
                opportunity_word(short_opportunity)
            }
            .to_string(),
            tone: if pullback_watch && short_opportunity >= 62 {
                "positive"
            } else if pullback_watch || divergence_watch || diffusion_watch {
                "caution"
            } else {
                opportunity_tone(short_opportunity)
            }
            .to_string(),
            detail: format!(
                "交易分 {short_opportunity}/100，状态为{}。规则压力 {risk_score}/100。",
                state.label
            ),
        },
    ]
}

fn risk_word(score: u8, invert: bool) -> &'static str {
    let score = if invert {
        100_u8.saturating_sub(score)
    } else {
        score
    };
    match score {
        80..=100 => "极高",
        60..=79 => "高",
        35..=59 => "中",
        15..=34 => "低",
        _ => "很低",
    }
}

fn opportunity_word(score: u8) -> &'static str {
    match score {
        75..=100 => "好",
        55..=74 => "中等",
        35..=54 => "一般",
        _ => "偏差",
    }
}

fn risk_tone(score: u8) -> &'static str {
    match score {
        75..=100 => "negative",
        55..=74 => "caution",
        25..=54 => "neutral",
        _ => "positive",
    }
}

fn opportunity_tone(score: u8) -> &'static str {
    match score {
        75..=100 => "positive",
        55..=74 => "neutral",
        35..=54 => "caution",
        _ => "negative",
    }
}

fn market_state_for(calibration: &ProfileCalibration, factors: &[FactorScore]) -> MarketState {
    let trend = factor_value(factors, "trend");
    let heat = factor_value(factors, "heat");
    let systemic = factor_value(factors, "systemic");
    let structure = factor_value(factors, "structure");

    let (key, label, tone, summary) = if systemic >= 75 {
        (
            "risk_release",
            "风险释放",
            "defensive",
            "系统压力进入高位，优先控制回撤和流动性。",
        )
    } else if trend < 35 || (trend < 45 && structure < 45) {
        (
            "trend_breakdown",
            "趋势破坏",
            "reduce",
            "趋势结构已经转弱，先降低风险资产暴露。",
        )
    } else if trend >= 70 && heat >= calibration.extreme_heat_min {
        (
            "high_level_digest",
            "强趋势过热",
            "caution",
            "趋势仍强，但短线过热明显，优先等待回踩和动量降温。",
        )
    } else if trend >= 70 && heat >= calibration.hot_state_heat_min {
        (
            "high_level_digest",
            "强趋势过热",
            "caution",
            "主趋势仍强，但短线拥挤，不适合激进追高。",
        )
    } else if trend >= 70 && structure >= calibration.expansion_structure_min {
        (
            "strong_trend_expansion",
            "强趋势扩张",
            "increase",
            "趋势、结构和系统风险配合较好，可按计划分批推进。",
        )
    } else if trend >= 70 {
        (
            "strong_trend_divergence",
            "强趋势分化",
            "caution",
            "主趋势仍在，但结构确认不足，持有为主、等待回踩。",
        )
    } else if trend < 45 && heat < 45 {
        (
            "range_watch",
            "低波动观察",
            "hold",
            "波动不高但趋势质量不足，低风险不等于高仓位。",
        )
    } else {
        (
            "range_watch",
            "震荡观察",
            "hold",
            "趋势进入观察区，等待突破或回踩确认。",
        )
    };

    MarketState {
        key: key.to_string(),
        label: label.to_string(),
        tone: tone.to_string(),
        summary: summary.to_string(),
    }
}

fn market_state_for_with_context(
    calibration: &ProfileCalibration,
    factors: &[FactorScore],
    leader: Option<&LeaderConfirmation>,
    internals: &MarketInternals,
) -> MarketState {
    let base = market_state_for(calibration, factors);
    let trend = factor_value(factors, "trend");
    let systemic = factor_value(factors, "systemic");
    let structure = factor_value(factors, "structure");

    let internal_diffusion = market_internal_pressure_count(internals) >= 2
        || (market_internal_signal_active(internals, "breadth_collapse")
            && market_internal_signal_active(internals, "relative_weakness_expansion"));
    if !matches!(base.key.as_str(), "risk_release" | "trend_breakdown")
        && trend >= 55
        && systemic < 75
        && internal_diffusion
    {
        let severe_leader_damage = leader.is_some_and(|leader| {
            leader.severe
                || leader.below_ma50_count >= 2
                || leader.confirmation_below_ma50_count >= 2
        });
        if severe_leader_damage || structure < 48 || systemic >= 70 {
            return MarketState {
                key: "risk_diffusion_breakdown".to_string(),
                label: "风险扩散破位".to_string(),
                tone: "reduce".to_string(),
                summary: "内部扩散已经叠加核心链条或结构破位，当前优先压低新增风险预算。"
                    .to_string(),
            };
        }
        return MarketState {
            key: "risk_diffusion_watch".to_string(),
            label: "风险扩散观察".to_string(),
            tone: "caution".to_string(),
            summary: internals.summary.clone(),
        };
    }

    if let Some(leader) = leader {
        if leader.divergent
            && trend >= 60
            && structure >= calibration.pullback_structure_min.saturating_sub(5)
            && systemic < calibration.divergence_max_systemic
            && matches!(
                base.key.as_str(),
                "strong_trend_expansion"
                    | "strong_trend_divergence"
                    | "range_watch"
                    | "high_level_digest"
                    | "strong_trend_healthy"
                    | "strong_trend_hot"
            )
        {
            return MarketState {
                key: "trend_repair_leader_divergence".to_string(),
                label: "趋势修复，龙头分歧".to_string(),
                tone: "caution".to_string(),
                summary: format!(
                    "指数结构仍在修复，但 {} 个龙头确认不足，当前持有观察，不主动追涨。",
                    leader.weak_count
                ),
            };
        }

        if trend >= 70
            && structure >= calibration.pullback_structure_min
            && systemic < calibration.pullback_max_systemic
            && leader.confirmation_below_ma20_count > 0
            && leader.confirmation_below_ma50_count == 0
            && matches!(
                base.key.as_str(),
                "strong_trend_expansion"
                    | "strong_trend_divergence"
                    | "high_level_digest"
                    | "strong_trend_healthy"
                    | "strong_trend_hot"
            )
        {
            return MarketState {
                key: "strong_trend_pullback_watch".to_string(),
                label: "强趋势回踩观察".to_string(),
                tone: "caution".to_string(),
                summary: format!(
                    "主趋势未破、系统风险低，但 {} 已进入 MA20 回踩验证，先看能否快速收复。",
                    short_label_list(&leader.confirmation_weak_labels)
                ),
            };
        }

        if trend >= 70
            && systemic < calibration.divergence_max_systemic
            && leader.confirmation_count >= calibration.divergence_min_confirmations
            && weak_ratio_met(
                leader.confirmation_weak_count,
                leader.confirmation_count,
                calibration.divergence_weak_ratio,
            )
            && matches!(
                base.key.as_str(),
                "strong_trend_expansion"
                    | "strong_trend_divergence"
                    | "range_watch"
                    | "strong_trend_healthy"
            )
        {
            return MarketState {
                key: "strong_trend_divergence".to_string(),
                label: "强趋势分化".to_string(),
                tone: "caution".to_string(),
                summary: format!(
                    "主趋势仍在，但 {} 确认不足，持有为主，等待分化收敛或回踩确认。",
                    short_label_list(&leader.confirmation_weak_labels)
                ),
            };
        }
    }

    base
}

fn structure_analysis(
    profile: &AnalysisProfile,
    snapshots: &HashMap<String, IndicatorSnapshot>,
    leader: Option<&LeaderConfirmation>,
) -> StructureAnalysis {
    let benchmark_item = profile
        .symbols
        .iter()
        .find(|item| item.symbol == profile.benchmark)
        .or_else(|| profile.symbols.first());
    let benchmark_snapshot = benchmark_item.and_then(|item| snapshots.get(&item.symbol));

    let Some(snapshot) = benchmark_snapshot else {
        return StructureAnalysis {
            trend: "结构数据不足。".to_string(),
            support: "-".to_string(),
            resistance: "-".to_string(),
            invalidation: "-".to_string(),
            action_map: Vec::new(),
            signals: Vec::new(),
        };
    };

    let close = snapshot.candle.close;
    let ma20 = snapshot.ma(20);
    let ma50 = snapshot.ma(50);
    let high60 = snapshot.high(60);
    let ma20_distance = ma_distance(snapshot, 20).unwrap_or(0.0);
    let pullback = pullback_from_period_high(snapshot, 60).unwrap_or(0.0);
    let trend = if above(close, ma20)
        && above(close, ma50)
        && ma20.zip(ma50).is_some_and(|(left, right)| left >= right)
    {
        "结构状态：趋势向上，关注回踩是否守住短中期均线。"
    } else if above(close, ma20) && above(close, ma50) {
        "结构状态：修复中，短线站上均线但中期排列仍需确认。"
    } else if below(close, ma50) {
        "结构状态：趋势承压，等待重新站回 MA50。"
    } else {
        "结构状态：震荡整理，等待方向选择。"
    };

    let mut signals = vec![
        StructureSignal {
            key: "ma_stack".to_string(),
            label: "均线结构".to_string(),
            value: format!(
                "MA20 {} / MA50 {}",
                format_price_option(ma20),
                format_price_option(ma50)
            ),
            tone: if above(close, ma20) && above(close, ma50) {
                "positive"
            } else {
                "caution"
            }
            .to_string(),
            detail: "价格相对 MA20/MA50 决定短中期结构质量。".to_string(),
        },
        StructureSignal {
            key: "extension".to_string(),
            label: "乖离".to_string(),
            value: format!("{:+.1}%", round(ma20_distance, 1)),
            tone: if ma20_distance > 8.0 {
                "caution"
            } else {
                "neutral"
            }
            .to_string(),
            detail: "远离 MA20 越多，越不适合新增追高。".to_string(),
        },
        StructureSignal {
            key: "pullback".to_string(),
            label: "回撤".to_string(),
            value: format!("-{:.1}%", round(pullback, 1)),
            tone: if pullback >= 5.0 && above(close, ma50) {
                "positive"
            } else {
                "neutral"
            }
            .to_string(),
            detail: "距 60 日高点的回撤可用来判断是否进入可分批观察区。".to_string(),
        },
    ];

    if let Some(leader) = profile.symbols.iter().find(|item| {
        item.symbol != profile.benchmark
            && item
                .role
                .as_deref()
                .is_some_and(|role| matches!(role, "leader" | "growth" | "sector"))
    }) {
        if let Some(leader_snapshot) = snapshots.get(&leader.symbol) {
            let leader_close = leader_snapshot.candle.close;
            signals.push(StructureSignal {
                key: "leader".to_string(),
                label: format!("核心标的 {}", leader.label),
                value: if above(leader_close, leader_snapshot.ma(20)) {
                    "站上 MA20".to_string()
                } else {
                    "跌破 MA20".to_string()
                },
                tone: if above(leader_close, leader_snapshot.ma(20)) {
                    "positive"
                } else {
                    "caution"
                }
                .to_string(),
                detail: "核心标的用于确认主线是否仍被资金承认。".to_string(),
            });
        }
    }

    StructureAnalysis {
        trend: trend.to_string(),
        support: format!(
            "MA20 {} / MA50 {}",
            format_price_option(ma20),
            format_price_option(ma50)
        ),
        resistance: format!(
            "60日高点 {}，当前回撤 {:.1}%",
            format_price_option(high60),
            round(pullback, 1)
        ),
        invalidation: format!("跌破 MA50 {} 且无法快速收复", format_price_option(ma50)),
        action_map: action_map_for(snapshot, leader),
        signals,
    }
}

fn action_map_for(
    snapshot: &IndicatorSnapshot,
    leader: Option<&LeaderConfirmation>,
) -> Vec<ActionLine> {
    let close = snapshot.candle.close;
    let ma20 = snapshot.ma(20);
    let ma50 = snapshot.ma(50);
    let ma200 = snapshot.ma(200);
    let ma20_distance = ma_distance(snapshot, 20).unwrap_or(0.0);

    let mut lines = vec![
        ActionLine {
            key: "current".to_string(),
            label: "当前".to_string(),
            value: format_price(close),
            tone: if ma20_distance >= 8.0 {
                "caution"
            } else {
                "neutral"
            }
            .to_string(),
            action: if ma20_distance >= 8.0 {
                "远离 MA20，不追高".to_string()
            } else {
                "接近短线均衡区".to_string()
            },
            detail: format!("相对 MA20 {:+.1}%。", round(ma20_distance, 1)),
        },
        ActionLine {
            key: "wait_ma20".to_string(),
            label: "等待".to_string(),
            value: format_price_option(ma20),
            tone: "positive".to_string(),
            action: "回踩 MA20 附近观察".to_string(),
            detail: "RSI 回落到 60-70，且核心标的不破趋势时才考虑新增。".to_string(),
        },
        ActionLine {
            key: "wait_ma50".to_string(),
            label: "二次观察".to_string(),
            value: format_price_option(ma50),
            tone: "neutral".to_string(),
            action: "MA50 / 前平台附近".to_string(),
            detail: "更适合中期资金分批观察，不适合情绪化接飞刀。".to_string(),
        },
        ActionLine {
            key: "reduce_ma20".to_string(),
            label: "减仓观察".to_string(),
            value: format_price_option(ma20),
            tone: "caution".to_string(),
            action: "跌破 MA20 后 2 日不收复".to_string(),
            detail: "短线动量降温，等待无法收复确认后再降低仓位。".to_string(),
        },
        ActionLine {
            key: "defense_ma50".to_string(),
            label: "防守".to_string(),
            value: format_price_option(ma50),
            tone: "negative".to_string(),
            action: "跌破 MA50".to_string(),
            detail: "中期结构转弱，仓位从趋势持有切换为防守管理。".to_string(),
        },
        ActionLine {
            key: "long_ma200".to_string(),
            label: "长期".to_string(),
            value: format_price_option(ma200),
            tone: "neutral".to_string(),
            action: "MA200 为长期风控线".to_string(),
            detail: "跌破后不再按强趋势处理，等待长期结构修复。".to_string(),
        },
    ];

    if let Some(leader) = leader {
        if leader.confirmation_below_ma20_count > 0 && leader.confirmation_below_ma50_count == 0 {
            let weak_names = short_label_list(&leader.confirmation_weak_labels);
            if let Some(wait_line) = lines.iter_mut().find(|line| line.key == "wait_ma20") {
                wait_line.key = "wait_confirm_ma20".to_string();
                wait_line.label = "加仓观察".to_string();
                wait_line.value = weak_names.clone();
                wait_line.tone = "caution".to_string();
                wait_line.action = "重新站回 MA20".to_string();
                wait_line.detail =
                    "回踩已经发生，重点观察确认资产能否重新站回 MA20，或基准回踩 MA20 不破。"
                        .to_string();
            }
            if let Some(reduce_line) = lines.iter_mut().find(|line| line.key == "reduce_ma20") {
                reduce_line.value = weak_names;
                reduce_line.detail =
                    "确认资产跌破 MA20 后若 2 日无法收复，说明回踩验证失败，再降低短线仓位。"
                        .to_string();
            }
        }
    }

    lines
}

fn pattern_analysis(
    profile: &AnalysisProfile,
    series: &HashMap<String, Vec<Candle>>,
    indexes: &HashMap<String, usize>,
) -> PatternAnalysis {
    let mut patterns = Vec::new();

    for symbol in pattern_targets(profile) {
        let Some(candles) = series.get(&symbol.symbol) else {
            continue;
        };
        let Some(index) = indexes.get(&symbol.symbol).copied() else {
            continue;
        };
        patterns.extend(detect_chart_patterns(symbol, candles, index));
    }

    patterns.sort_by(|left, right| {
        pattern_rank(right)
            .cmp(&pattern_rank(left))
            .then_with(|| right.confidence.cmp(&left.confidence))
    });
    patterns.truncate(4);

    let dominant = patterns.first().cloned();
    let summary = match &dominant {
        Some(pattern) => format!(
            "{}：{}，{}，置信度 {}%。{}",
            pattern.symbol_label,
            pattern.label,
            pattern.phase_label,
            pattern.confidence,
            pattern.implication
        ),
        None => {
            "未识别到高置信度头肩或双顶双底形态；当前以均线结构和关键支撑/压力为主。".to_string()
        }
    };

    PatternAnalysis {
        summary,
        dominant,
        patterns,
    }
}

fn pattern_targets(profile: &AnalysisProfile) -> Vec<&ProfileSymbol> {
    let mut targets = Vec::new();
    if let Some(benchmark) = profile
        .symbols
        .iter()
        .find(|item| item.symbol == profile.benchmark)
    {
        targets.push(benchmark);
    }

    if let Some(leader) = profile.symbols.iter().find(|item| {
        item.symbol != profile.benchmark
            && item
                .role
                .as_deref()
                .is_some_and(|role| matches!(role, "leader" | "growth" | "sector"))
    }) {
        targets.push(leader);
    }

    targets
}

fn detect_chart_patterns(
    symbol: &ProfileSymbol,
    candles: &[Candle],
    end_index: usize,
) -> Vec<ChartPattern> {
    if candles.is_empty() || end_index >= candles.len() {
        return Vec::new();
    }

    let swings = detect_swings(candles, end_index, 160);
    let mut patterns = Vec::new();

    if let Some(pattern) = best_head_shoulders_top(symbol, candles, end_index, &swings) {
        patterns.push(pattern);
    }
    if let Some(pattern) = best_head_shoulders_bottom(symbol, candles, end_index, &swings) {
        patterns.push(pattern);
    }
    if let Some(pattern) = best_double_top(symbol, candles, end_index, &swings) {
        patterns.push(pattern);
    }
    if let Some(pattern) = best_double_bottom(symbol, candles, end_index, &swings) {
        patterns.push(pattern);
    }

    patterns
        .into_iter()
        .filter(|pattern| pattern.confidence >= 45)
        .collect()
}

fn best_head_shoulders_top(
    symbol: &ProfileSymbol,
    candles: &[Candle],
    end_index: usize,
    swings: &[SwingPoint],
) -> Option<ChartPattern> {
    swings
        .windows(5)
        .filter_map(|window| {
            if !matches_pattern(
                window,
                &[
                    SwingKind::High,
                    SwingKind::Low,
                    SwingKind::High,
                    SwingKind::Low,
                    SwingKind::High,
                ],
            ) {
                return None;
            }
            let left = &window[0];
            let neck_left = &window[1];
            let head = &window[2];
            let neck_right = &window[3];
            let right = &window[4];
            if !valid_pattern_spacing(window, 4, 120) {
                return None;
            }
            let shoulder_gap = relative_gap(left.price, right.price);
            if shoulder_gap > 0.14 {
                return None;
            }
            let head_margin = percent(head.price / left.price.max(right.price) - 1.0);
            if head_margin < 1.8 {
                return None;
            }
            if neck_left.price >= left.price || neck_right.price >= right.price {
                return None;
            }

            let neckline = line_price(neck_left, neck_right, end_index);
            if neckline <= 0.0 {
                return None;
            }
            let close = candles[end_index].close;
            let (status, status_label, tone, status_score) = if close < neckline * 0.99 {
                ("confirmed", "已确认", "negative", 28)
            } else if close <= neckline * 1.04 && close < right.price {
                ("forming", "形成中", "caution", 18)
            } else if close < head.price && close <= right.price * 1.03 {
                ("watch", "观察中", "neutral", 8)
            } else {
                return None;
            };

            let confidence = pattern_confidence(
                head_margin,
                shoulder_gap,
                neckline_slope(neck_left, neck_right),
                prior_uptrend(candles, left.index),
                status_score,
            );
            let (phase, phase_label, action) = pattern_phase("bearish", status, close, neckline);

            Some(ChartPattern {
                key: format!("{}_head_shoulders_top", symbol.symbol.to_ascii_lowercase()),
                label: "头肩顶".to_string(),
                symbol: symbol.symbol.clone(),
                symbol_label: symbol.label.clone(),
                direction: "bearish".to_string(),
                status: status.to_string(),
                status_label: status_label.to_string(),
                phase,
                phase_label,
                tone: tone.to_string(),
                confidence,
                neckline: Some(format_price(neckline)),
                confirmation: format!(
                    "收盘跌破颈线 {}，且最好伴随量能放大。",
                    format_price(neckline)
                ),
                invalidation: format!(
                    "重新站上右肩 {} 后，头肩顶形态失效。",
                    format_price(right.price)
                ),
                action,
                implication: if status == "confirmed" {
                    "反转形态已确认，短期优先降低风险仓位。".to_string()
                } else {
                    "右肩已形成，跌破颈线前先降低追高动作。".to_string()
                },
                detail: format!(
                    "左肩 {}，头部 {}，右肩 {}；颈线来自两个回撤低点。",
                    format_price(left.price),
                    format_price(head.price),
                    format_price(right.price)
                ),
                points: pattern_points(&[
                    ("左肩", left),
                    ("颈线1", neck_left),
                    ("头部", head),
                    ("颈线2", neck_right),
                    ("右肩", right),
                ]),
            })
        })
        .max_by_key(|pattern| pattern_rank(pattern))
}

fn best_head_shoulders_bottom(
    symbol: &ProfileSymbol,
    candles: &[Candle],
    end_index: usize,
    swings: &[SwingPoint],
) -> Option<ChartPattern> {
    swings
        .windows(5)
        .filter_map(|window| {
            if !matches_pattern(
                window,
                &[
                    SwingKind::Low,
                    SwingKind::High,
                    SwingKind::Low,
                    SwingKind::High,
                    SwingKind::Low,
                ],
            ) {
                return None;
            }
            let left = &window[0];
            let neck_left = &window[1];
            let head = &window[2];
            let neck_right = &window[3];
            let right = &window[4];
            if !valid_pattern_spacing(window, 4, 120) {
                return None;
            }
            let shoulder_gap = relative_gap(left.price, right.price);
            if shoulder_gap > 0.14 {
                return None;
            }
            let head_margin = percent(left.price.min(right.price) / head.price - 1.0);
            if head_margin < 1.8 {
                return None;
            }
            if neck_left.price <= left.price || neck_right.price <= right.price {
                return None;
            }

            let neckline = line_price(neck_left, neck_right, end_index);
            if neckline <= 0.0 {
                return None;
            }
            let close = candles[end_index].close;
            let (status, status_label, tone, status_score) = if close > neckline * 1.01 {
                ("confirmed", "已确认", "positive", 28)
            } else if close >= neckline * 0.96 && close > right.price {
                ("forming", "形成中", "caution", 18)
            } else if close > head.price && close >= right.price * 0.97 {
                ("watch", "观察中", "neutral", 8)
            } else {
                return None;
            };

            let confidence = pattern_confidence(
                head_margin,
                shoulder_gap,
                neckline_slope(neck_left, neck_right),
                prior_downtrend(candles, left.index),
                status_score,
            );
            let (phase, phase_label, action) = pattern_phase("bullish", status, close, neckline);

            Some(ChartPattern {
                key: format!(
                    "{}_head_shoulders_bottom",
                    symbol.symbol.to_ascii_lowercase()
                ),
                label: "头肩底".to_string(),
                symbol: symbol.symbol.clone(),
                symbol_label: symbol.label.clone(),
                direction: "bullish".to_string(),
                status: status.to_string(),
                status_label: status_label.to_string(),
                phase,
                phase_label,
                tone: tone.to_string(),
                confidence,
                neckline: Some(format_price(neckline)),
                confirmation: format!(
                    "收盘突破颈线 {}，且回踩不破时更可靠。",
                    format_price(neckline)
                ),
                invalidation: format!(
                    "重新跌破右肩 {} 后，头肩底形态失效。",
                    format_price(right.price)
                ),
                action,
                implication: if status == "confirmed" {
                    if close > neckline * 1.08 {
                        "底部形态已经确认并脱离初始买点，当前更适合等回踩，而不是追高。".to_string()
                    } else {
                        "底部反转已确认，可把回踩企稳作为加仓观察条件。".to_string()
                    }
                } else {
                    "底部结构在形成，突破颈线前先按观察信号处理。".to_string()
                },
                detail: format!(
                    "左肩 {}，头部 {}，右肩 {}；颈线来自两个反弹高点。",
                    format_price(left.price),
                    format_price(head.price),
                    format_price(right.price)
                ),
                points: pattern_points(&[
                    ("左肩", left),
                    ("颈线1", neck_left),
                    ("头部", head),
                    ("颈线2", neck_right),
                    ("右肩", right),
                ]),
            })
        })
        .max_by_key(|pattern| pattern_rank(pattern))
}

fn best_double_top(
    symbol: &ProfileSymbol,
    candles: &[Candle],
    end_index: usize,
    swings: &[SwingPoint],
) -> Option<ChartPattern> {
    swings
        .windows(3)
        .filter_map(|window| {
            if !matches_pattern(window, &[SwingKind::High, SwingKind::Low, SwingKind::High]) {
                return None;
            }
            let left = &window[0];
            let valley = &window[1];
            let right = &window[2];
            if !valid_pattern_spacing(window, 5, 90) {
                return None;
            }
            let top_gap = relative_gap(left.price, right.price);
            let pullback = percent(left.price.min(right.price) / valley.price - 1.0);
            if top_gap > 0.045 || pullback < 3.0 {
                return None;
            }
            let close = candles[end_index].close;
            let (status, status_label, tone, status_score) = if close < valley.price * 0.99 {
                ("confirmed", "已确认", "negative", 26)
            } else if close < right.price * 0.98 {
                ("forming", "形成中", "caution", 16)
            } else {
                return None;
            };
            let confidence = double_pattern_confidence(top_gap, pullback, status_score);
            let (phase, phase_label, action) =
                pattern_phase("bearish", status, close, valley.price);

            Some(ChartPattern {
                key: format!("{}_double_top", symbol.symbol.to_ascii_lowercase()),
                label: "双顶".to_string(),
                symbol: symbol.symbol.clone(),
                symbol_label: symbol.label.clone(),
                direction: "bearish".to_string(),
                status: status.to_string(),
                status_label: status_label.to_string(),
                phase,
                phase_label,
                tone: tone.to_string(),
                confidence,
                neckline: Some(format_price(valley.price)),
                confirmation: format!("收盘跌破双顶颈线 {}。", format_price(valley.price)),
                invalidation: format!(
                    "重新突破右顶 {} 后，双顶形态失效。",
                    format_price(right.price)
                ),
                action,
                implication: "上方抛压开始清晰，跌破颈线后短期仓位应更保守。".to_string(),
                detail: format!(
                    "两个高点价差 {:.1}%，中间回撤 {:.1}%。",
                    round(top_gap * 100.0, 1),
                    round(pullback, 1)
                ),
                points: pattern_points(&[("高点1", left), ("颈线", valley), ("高点2", right)]),
            })
        })
        .max_by_key(|pattern| pattern_rank(pattern))
}

fn best_double_bottom(
    symbol: &ProfileSymbol,
    candles: &[Candle],
    end_index: usize,
    swings: &[SwingPoint],
) -> Option<ChartPattern> {
    swings
        .windows(3)
        .filter_map(|window| {
            if !matches_pattern(window, &[SwingKind::Low, SwingKind::High, SwingKind::Low]) {
                return None;
            }
            let left = &window[0];
            let peak = &window[1];
            let right = &window[2];
            if !valid_pattern_spacing(window, 5, 90) {
                return None;
            }
            let bottom_gap = relative_gap(left.price, right.price);
            let rebound = percent(peak.price / left.price.max(right.price) - 1.0);
            if bottom_gap > 0.045 || rebound < 3.0 {
                return None;
            }
            let close = candles[end_index].close;
            let (status, status_label, tone, status_score) = if close > peak.price * 1.01 {
                ("confirmed", "已确认", "positive", 26)
            } else if close > right.price * 1.02 {
                ("forming", "形成中", "caution", 16)
            } else {
                return None;
            };
            let confidence = double_pattern_confidence(bottom_gap, rebound, status_score);
            let (phase, phase_label, action) = pattern_phase("bullish", status, close, peak.price);

            Some(ChartPattern {
                key: format!("{}_double_bottom", symbol.symbol.to_ascii_lowercase()),
                label: "双底".to_string(),
                symbol: symbol.symbol.clone(),
                symbol_label: symbol.label.clone(),
                direction: "bullish".to_string(),
                status: status.to_string(),
                status_label: status_label.to_string(),
                phase,
                phase_label,
                tone: tone.to_string(),
                confidence,
                neckline: Some(format_price(peak.price)),
                confirmation: format!("收盘突破双底颈线 {}。", format_price(peak.price)),
                invalidation: format!(
                    "重新跌破右底 {} 后，双底形态失效。",
                    format_price(right.price)
                ),
                action,
                implication: if status == "confirmed" && close > peak.price * 1.08 {
                    "双底已经突破并脱离初始买点，当前不是底部买点，等待回踩颈线或 MA20。"
                        .to_string()
                } else {
                    "底部承接改善，突破颈线后可观察回踩加仓。".to_string()
                },
                detail: format!(
                    "两个低点价差 {:.1}%，中间反弹 {:.1}%。",
                    round(bottom_gap * 100.0, 1),
                    round(rebound, 1)
                ),
                points: pattern_points(&[("低点1", left), ("颈线", peak), ("低点2", right)]),
            })
        })
        .max_by_key(|pattern| pattern_rank(pattern))
}

fn detect_swings(candles: &[Candle], end_index: usize, lookback: usize) -> Vec<SwingPoint> {
    if end_index < 8 {
        return Vec::new();
    }

    let radius = 3;
    let start = end_index.saturating_sub(lookback).max(radius);
    let end = end_index.saturating_sub(radius);
    if start >= end {
        return Vec::new();
    }

    let mut raw = Vec::new();
    for index in start..=end {
        let window = &candles[index - radius..=index + radius];
        let candle = &candles[index];
        let is_high = window.iter().all(|item| candle.high >= item.high)
            && window.iter().any(|item| candle.high > item.high);
        let is_low = window.iter().all(|item| candle.low <= item.low)
            && window.iter().any(|item| candle.low < item.low);

        match (is_high, is_low) {
            (true, false) => raw.push(SwingPoint {
                index,
                date: candle.date,
                price: candle.high,
                kind: SwingKind::High,
            }),
            (false, true) => raw.push(SwingPoint {
                index,
                date: candle.date,
                price: candle.low,
                kind: SwingKind::Low,
            }),
            _ => {}
        }
    }

    zigzag_filter(raw, pattern_min_move_pct(candles, end_index))
}

fn zigzag_filter(points: Vec<SwingPoint>, min_move_pct: f64) -> Vec<SwingPoint> {
    let mut filtered: Vec<SwingPoint> = Vec::new();

    for point in points {
        let Some(last) = filtered.last_mut() else {
            filtered.push(point);
            continue;
        };

        if last.kind == point.kind {
            let more_extreme = match point.kind {
                SwingKind::High => point.price > last.price,
                SwingKind::Low => point.price < last.price,
            };
            if more_extreme {
                *last = point;
            }
            continue;
        }

        let move_pct = percent(point.price / last.price - 1.0).abs();
        if move_pct >= min_move_pct {
            filtered.push(point);
        }
    }

    filtered
}

fn pattern_min_move_pct(candles: &[Candle], end_index: usize) -> f64 {
    average_true_range_pct(candles, end_index, 14)
        .map(|value| (value * 1.15).clamp(1.6, 4.5))
        .unwrap_or(2.2)
}

fn average_true_range_pct(candles: &[Candle], end_index: usize, period: usize) -> Option<f64> {
    if end_index == 0 || end_index < period {
        return None;
    }

    let start = end_index + 1 - period;
    let mut total = 0.0;
    for index in start..=end_index {
        let candle = &candles[index];
        let previous_close = candles[index - 1].close;
        let range = (candle.high - candle.low)
            .max((candle.high - previous_close).abs())
            .max((candle.low - previous_close).abs());
        total += range;
    }

    let close = candles[end_index].close;
    (close > 0.0).then(|| percent((total / period as f64) / close))
}

fn matches_pattern(window: &[SwingPoint], kinds: &[SwingKind]) -> bool {
    window.len() == kinds.len()
        && window
            .iter()
            .zip(kinds.iter())
            .all(|(point, kind)| point.kind == *kind)
}

fn valid_pattern_spacing(window: &[SwingPoint], min_gap: usize, max_span: usize) -> bool {
    window
        .windows(2)
        .all(|pair| pair[1].index.saturating_sub(pair[0].index) >= min_gap)
        && window
            .last()
            .zip(window.first())
            .is_some_and(|(last, first)| last.index.saturating_sub(first.index) <= max_span)
}

fn pattern_confidence(
    prominence_pct: f64,
    side_gap: f64,
    neckline_slope_pct: f64,
    trend_confirmed: bool,
    status_score: i16,
) -> u8 {
    let prominence_score = ((prominence_pct / 8.0).min(1.0) * 24.0).round() as i16;
    let symmetry_score = ((1.0 - (side_gap / 0.14)).clamp(0.0, 1.0) * 22.0).round() as i16;
    let neckline_score =
        ((1.0 - (neckline_slope_pct.abs() / 8.0)).clamp(0.0, 1.0) * 16.0).round() as i16;
    let trend_score = if trend_confirmed { 10 } else { 3 };

    bounded_score(
        20 + prominence_score + symmetry_score + neckline_score + trend_score + status_score,
    )
}

fn double_pattern_confidence(side_gap: f64, reaction_pct: f64, status_score: i16) -> u8 {
    let symmetry_score = ((1.0 - (side_gap / 0.045)).clamp(0.0, 1.0) * 28.0).round() as i16;
    let reaction_score = ((reaction_pct / 8.0).min(1.0) * 28.0).round() as i16;
    bounded_score(18 + symmetry_score + reaction_score + status_score)
}

fn prior_uptrend(candles: &[Candle], pivot_index: usize) -> bool {
    let start = pivot_index.saturating_sub(45);
    pivot_index > start
        && candles[start].close > 0.0
        && percent(candles[pivot_index].close / candles[start].close - 1.0) >= 6.0
}

fn prior_downtrend(candles: &[Candle], pivot_index: usize) -> bool {
    let start = pivot_index.saturating_sub(45);
    pivot_index > start
        && candles[start].close > 0.0
        && percent(candles[pivot_index].close / candles[start].close - 1.0) <= -6.0
}

fn line_price(left: &SwingPoint, right: &SwingPoint, target_index: usize) -> f64 {
    if right.index == left.index {
        return right.price;
    }
    let slope = (right.price - left.price) / (right.index - left.index) as f64;
    left.price + slope * (target_index.saturating_sub(left.index)) as f64
}

fn neckline_slope(left: &SwingPoint, right: &SwingPoint) -> f64 {
    if left.price <= 0.0 || right.index == left.index {
        return 0.0;
    }
    percent(right.price / left.price - 1.0)
}

fn relative_gap(left: f64, right: f64) -> f64 {
    if left <= 0.0 || right <= 0.0 {
        return 1.0;
    }
    (left - right).abs() / left.max(right)
}

fn pattern_phase(
    direction: &str,
    status: &str,
    close: f64,
    neckline: f64,
) -> (String, String, String) {
    if direction == "bullish" && status == "confirmed" && close > neckline * 1.08 {
        return (
            "post_breakout_extended".to_string(),
            "已确认，当前远离买点".to_string(),
            "不追高，等待回踩颈线或 MA20。".to_string(),
        );
    }
    if direction == "bullish" && status == "confirmed" {
        return (
            "breakout_confirmed".to_string(),
            "已确认，等回踩确认".to_string(),
            "回踩颈线不破可观察加仓。".to_string(),
        );
    }
    if direction == "bullish" {
        return (
            "base_forming".to_string(),
            "形成中，未到确认买点".to_string(),
            "等突破颈线后再确认。".to_string(),
        );
    }
    if direction == "bearish" && status == "confirmed" {
        return (
            "breakdown_confirmed".to_string(),
            "已确认，进入风控".to_string(),
            "降低高弹性仓位，等重新站回关键位。".to_string(),
        );
    }
    (
        "distribution_watch".to_string(),
        "形成中，等待确认".to_string(),
        "不新增追高，盯住颈线和右肩失效位。".to_string(),
    )
}

fn pattern_points(points: &[(&str, &SwingPoint)]) -> Vec<PatternPoint> {
    points
        .iter()
        .map(|(label, point)| PatternPoint {
            label: (*label).to_string(),
            date: point.date.to_string(),
            price: round(point.price, 2),
        })
        .collect()
}

fn pattern_rank(pattern: &ChartPattern) -> i16 {
    let status_weight = match pattern.status.as_str() {
        "confirmed" => 300,
        "forming" => 200,
        _ => 100,
    };
    status_weight + pattern.confidence as i16
}

fn format_price(value: f64) -> String {
    format!("{:.2}", round(value, 2))
}

fn pattern_entry_trigger(pattern_analysis: &PatternAnalysis) -> Option<String> {
    pattern_analysis
        .dominant
        .as_ref()
        .filter(|pattern| pattern.direction == "bullish")
        .map(|pattern| {
            format!(
                "形态确认：{}{}，{}",
                pattern.label, pattern.status_label, pattern.confirmation
            )
        })
}

fn pattern_risk_trigger(pattern_analysis: &PatternAnalysis) -> Option<String> {
    pattern_analysis
        .dominant
        .as_ref()
        .filter(|pattern| pattern.direction == "bearish")
        .map(|pattern| {
            format!(
                "形态风险：{}{}，{}",
                pattern.label, pattern.status_label, pattern.confirmation
            )
        })
}

fn position_advice_for(
    profile: &AnalysisProfile,
    state: &MarketState,
    factors: &[FactorScore],
    structure: &StructureAnalysis,
    pattern_analysis: &PatternAnalysis,
    leader_confirmation: Option<&LeaderConfirmation>,
    dimensions: &[DimensionScore],
) -> Vec<PositionAdvice> {
    let calibration = &profile.calibration;
    let leading = leading_pressure_label(dimensions);
    let heat = factor_value(factors, "heat");
    let systemic = factor_value(factors, "systemic");
    let structure_score = factor_value(factors, "structure");
    let trading_score = factor_value(factors, "opportunity");
    let pattern_entry = pattern_entry_trigger(pattern_analysis);
    let pattern_risk = pattern_risk_trigger(pattern_analysis);

    let base_entry_pullback = format!(
        "回踩 {} 后企稳，且过热评分降至 65 以下。",
        structure.support
    );
    let entry_pullback = match pattern_entry {
        Some(note) => format!("{base_entry_pullback} {note}"),
        None => base_entry_pullback,
    };
    let base_risk_break = format!(
        "{}；若放量下跌同步出现，优先降低仓位。",
        structure.invalidation
    );
    let risk_break = match &pattern_risk {
        Some(note) => format!("{base_risk_break} {note}"),
        None => base_risk_break,
    };
    let defensive_trigger = match pattern_risk {
        Some(note) => format!("系统风险升至 75 以上，或核心标的与基准同步跌破 MA50。{note}"),
        None => "系统风险升至 75 以上，或核心标的与基准同步跌破 MA50。".to_string(),
    };

    let advice = match state.key.as_str() {
        "strong_trend_extreme_hot" => vec![
            make_position_advice(
                "short",
                "短期",
                "已有持有，不新增追高",
                "0%~-10%",
                "20%~35%",
                "caution",
                &format!("趋势仍强，但 {leading} 已进入极端拥挤区，短线买点质量偏低。"),
                &format!("回踩 {}，RSI 降至 60-70，核心标的不破 MA50。", structure.support),
                &risk_break,
            ),
            make_position_advice(
                "medium",
                "中期",
                "核心持有，等 MA20/MA50",
                "0%~+5%",
                "40%~55%",
                "hold",
                "中期主线仍可保留，但新增仓位要等加速段降温。",
                "回踩 MA20/MA50 后企稳，且外部确认信号未破位。",
                &defensive_trigger,
            ),
            make_position_advice(
                "long",
                "长期",
                "保留部分配置",
                "0%",
                "45%~65%",
                "hold",
                "长期配置不因短线过热直接清空，但要控制单一主线集中度。",
                "按配置纪律再平衡，避免在极端乖离时继续提高敞口。",
                &defensive_trigger,
            ),
        ],
        "high_level_digest" | "strong_trend_hot" => vec![
            make_position_advice(
                "short",
                "短期",
                "持有，不追高",
                "0%~-5%",
                &position_range(calibration.hot_short_min, calibration.hot_short_max),
                "caution",
                &format!("主趋势仍强，但 {leading} 已经拥挤，短线新增的风险收益比下降。"),
                &entry_pullback,
                &risk_break,
            ),
            make_position_advice(
                "medium",
                "中期",
                "核心持有，等回调",
                "0%~+5%",
                &position_range(calibration.hot_medium_min, calibration.hot_medium_max),
                "hold",
                "中期趋势仍有延续基础，但加速段不适合一次性提高敞口。",
                &format!("回踩支撑后结构评分仍高于 60，且系统风险低于 60。"),
                &defensive_trigger,
            ),
            make_position_advice(
                "long",
                "长期",
                "保留部分配置",
                "0%",
                &position_range(calibration.hot_long_min, calibration.hot_long_max),
                "hold",
                "长期配置可以保留核心，但需要防止单一主线过度集中。",
                "按资产配置纪律再平衡，不因短线过热追高。",
                &defensive_trigger,
            ),
        ],
        "risk_diffusion_breakdown" => vec![
            make_position_advice(
                "short",
                "短期",
                "停止加仓，等扩散收敛",
                "0%~-15%",
                "10%~25%",
                "reduce",
                "内部扩散已经叠加核心链条或结构破位，短线目标是降低新增风险预算，而不是寻找追价入口。",
                "上涨家数、高 beta 链条和核心标的至少修复两项，再从停止加仓切回等待确认。",
                "核心标的继续跌破 MA50，或广度坍塌继续扩大，优先再降短线仓位。",
            ),
            make_position_advice(
                "medium",
                "中期",
                "压低上限，只留核心",
                "0%~-10%",
                "25%~40%",
                "reduce",
                "中期趋势可能尚未完全结束，但扩散破位会压低可承受的目标暴露上限。",
                "结构评分回到 55 以上，且弱确认资产重新站回 MA50。",
                &defensive_trigger,
            ),
            make_position_advice(
                "long",
                "长期",
                "保留核心，暂停扩仓",
                "0%~-5%",
                "40%~55%",
                "defensive",
                "长期配置可保留核心，但在扩散破位阶段不应继续提高集中度或长期上限。",
                "系统风险低于 55，核心链条重新站回 MA50 后再恢复长期上限。",
                &defensive_trigger,
            ),
        ],
        "risk_diffusion_watch" => vec![
            make_position_advice(
                "short",
                "短期",
                "停止追价，等内部修复",
                "0%~-10%",
                "20%~35%",
                "caution",
                "内部广度、相对强弱或龙头承接已经转弱，短线不把指数强势直接解释成买点。",
                "上涨家数回到 50% 以上，且高 beta 链条不再弱于基准。",
                "Breadth Collapse 继续恶化，或核心龙头高开低走后跌破 MA20。",
            ),
            make_position_advice(
                "medium",
                "中期",
                "核心持有，降低加仓速度",
                "0%~+5%",
                "35%~50%",
                "hold",
                "中期趋势未必破坏，但风险扩散会压低新增仓位赔率。",
                "结构评分回到 60 以上，且弱确认资产重新站回 MA20。",
                &defensive_trigger,
            ),
            make_position_advice(
                "long",
                "长期",
                "保留核心，不扩仓",
                "0%",
                "50%~65%",
                "hold",
                "长期仓位看系统风险和趋势结构，但内部扩散未修复前不提高上限。",
                "系统风险低于 55，且内部扩散信号消失。",
                &defensive_trigger,
            ),
        ],
        "strong_trend_divergence" => vec![
            make_position_advice(
                "short",
                "短期",
                "持有为主，等分化收敛",
                "0%~-5%",
                "30%~45%",
                "caution",
                "趋势仍在，但内部结构不是全面共振，短线不把强指数当成强买点。",
                "弱确认资产重新站回 MA20，或基准回踩 MA20 后不破。",
                "确认资产跌破 MA20 后 2 日无法收复，再降低短线仓位。",
            ),
            make_position_advice(
                "medium",
                "中期",
                "核心持有，等确认",
                "0%~+5%",
                "50%~65%",
                "hold",
                "中期趋势未破，但结构分化会压低仓位上限。",
                "结构评分回到 65 以上，且弱确认资产不再继续跑输基准。",
                &defensive_trigger,
            ),
            make_position_advice(
                "long",
                "长期",
                "核心持有",
                "0%",
                "60%~75%",
                "hold",
                "长期配置保留核心，但分化未收敛前不主动提高上限。",
                "系统风险维持低位，且基准仍在 MA50 上方。",
                &defensive_trigger,
            ),
        ],
        "trend_repair_leader_divergence" => vec![
            make_position_advice(
                "short",
                "短期",
                "持有观察，不主动追",
                "0%~-5%",
                "25%~40%",
                "caution",
                "指数结构仍在修复，但核心权重确认不足，短线仓位上限需要低于强趋势健康状态。",
                "指数回踩 MA20 不破，且至少一个弱确认龙头重新站回关键均线。",
                "跌破 MA20 后 2 日无法收复，再降低短线仓位。",
            ),
            make_position_advice(
                "medium",
                "中期",
                "等待龙头确认",
                "0%~+5%",
                "40%~55%",
                "hold",
                "中期可以保留观察仓，但不能只因指数修复就提高到高仓位。",
                "指数守住 MA20/MA50，同时核心权重不再继续弱于基准。",
                &defensive_trigger,
            ),
            make_position_advice(
                "long",
                "长期",
                "保留核心配置",
                "0%",
                "50%~65%",
                "hold",
                "长期配置可以保留，但需要防止指数修复被少数弱龙头拖累。",
                "龙头分歧消失后再恢复长期配置上限。",
                &defensive_trigger,
            ),
        ],
        "strong_trend_pullback_watch" if trading_score >= 62 && systemic < 58 && heat < 78 => vec![
            make_position_advice(
                "short",
                "短期",
                "确认后小仓试探",
                "0%~+5%",
                "35%~50%",
                "increase",
                "主趋势仍在，回踩后短线赔率有所修复；只用小仓验证动作线，不按突破追价。",
                "确认资产重新站回 MA20，或基准回踩 MA20 后不破。",
                "确认资产跌破 MA20 后 2 日无法收复，再降低短线仓位。",
            ),
            make_position_advice(
                "medium",
                "中期",
                "核心持有，轻加确认",
                "0%~+8%",
                "50%~68%",
                "hold",
                "中期趋势没有破坏，轻仓试探只用于确认回踩质量，不改变核心纪律。",
                "确认资产重新站稳 MA20，且结构评分维持 60 以上。",
                &defensive_trigger,
            ),
            make_position_advice(
                "long",
                "长期",
                "核心持有",
                "0%",
                "60%~80%",
                "hold",
                "长期趋势未破时保留核心配置，短线试探不替代长期再平衡。",
                "系统风险维持低位，且基准仍在 MA50 上方。",
                &defensive_trigger,
            ),
        ],
        "strong_trend_pullback_watch" => vec![
            make_position_advice(
                "short",
                "短期",
                "持有观察，等确认",
                "0%~-5%",
                "30%~45%",
                "caution",
                "主趋势仍在，但确认资产已进入 MA20 回踩验证，不适合继续按顺势追高处理。",
                "确认资产重新站回 MA20，或基准回踩 MA20 后不破。",
                "确认资产跌破 MA20 后 2 日无法收复，再降低短线仓位。",
            ),
            make_position_advice(
                "medium",
                "中期",
                "核心持有，等站稳",
                "0%~+5%",
                "50%~65%",
                "hold",
                "中期趋势没有破坏，但科技/板块确认不足时不急于提高仓位上限。",
                "确认资产重新站稳 MA20，且结构评分维持 60 以上。",
                &defensive_trigger,
            ),
            make_position_advice(
                "long",
                "长期",
                "核心持有",
                "0%",
                "60%~80%",
                "hold",
                "长期趋势未破时保留核心配置，但短线回踩验证期间避免频繁加仓。",
                "系统风险维持低位，且基准仍在 MA50 上方。",
                &defensive_trigger,
            ),
        ],
        "strong_trend_expansion" | "strong_trend_healthy" if trading_score < 75 || heat >= 55 => {
            vec![
                make_position_advice(
                    "short",
                    "短期",
                    "顺势持有，等回踩",
                    "0%~+5%",
                    "30%~45%",
                    "hold",
                    "趋势和结构较好，但交易分没有达到强买点区，新增仓位仍优先等回踩。",
                    "价格回踩 MA20 不破，且交易分重新升至 75 以上。",
                    &risk_break,
                ),
                make_position_advice(
                    "medium",
                    "中期",
                    "核心持有，分批确认",
                    "0%~+10%",
                    "50%~65%",
                    "hold",
                    "中期趋势质量较高，但仓位提升需要结构和买点质量继续确认。",
                    &entry_pullback,
                    &defensive_trigger,
                ),
                make_position_advice(
                    "long",
                    "长期",
                    "核心持有",
                    "0%",
                    "60%~75%",
                    "hold",
                    "长期仓位以核心配置为主，避免把短线强势直接解释成长期高仓位信号。",
                    "结构评分维持 60 以上时按计划持有。",
                    &defensive_trigger,
                ),
            ]
        }
        "strong_trend_expansion" | "strong_trend_healthy" => vec![
            make_position_advice(
                "short",
                "短期",
                "顺势分批",
                "+5%~+10%",
                "35%~50%",
                "increase",
                "趋势和结构较好，短线可小步跟随，但仍按触发条件执行。",
                "价格守住 MA20，且过热评分低于 70。",
                &risk_break,
            ),
            make_position_advice(
                "medium",
                "中期",
                "提高核心仓",
                "+5%~+15%",
                "55%~75%",
                "increase",
                "中期趋势质量较高，可把回踩当作分批加仓观察区。",
                &entry_pullback,
                &defensive_trigger,
            ),
            make_position_advice(
                "long",
                "长期",
                "核心持有",
                "0%~+5%",
                "60%~80%",
                "hold",
                "长期仓位以核心配置为主，避免因短线波动频繁调整。",
                "结构评分维持 60 以上时按计划持有。",
                &defensive_trigger,
            ),
        ],
        "trend_breakdown" | "weak_trend_low_risk" => vec![
            make_position_advice(
                "short",
                "短期",
                "轻仓观察",
                "0%",
                "10%~25%",
                "hold",
                "波动不高但趋势弱，低风险不等于可以提高仓位。",
                "重新站上 MA20/MA50，且动量评分升至 55 以上。",
                "再次跌破前低或结构评分低于 40。",
            ),
            make_position_advice(
                "medium",
                "中期",
                "等趋势修复",
                "0%~+5%",
                "25%~40%",
                "hold",
                "中期先等结构确认，避免在弱趋势里过早加仓。",
                "基准站稳 MA50，核心标的同步转强。",
                &defensive_trigger,
            ),
            make_position_advice(
                "long",
                "长期",
                "低配观察",
                "0%",
                "30%~50%",
                "hold",
                "长期只保留基础配置，等待趋势和结构重新变好。",
                "交易分升至 60 以上后再恢复配置。",
                &defensive_trigger,
            ),
        ],
        "risk_release" | "defensive_breakdown" => vec![
            make_position_advice(
                "short",
                "短期",
                "降仓防守",
                "-15%~-25%",
                "0%~20%",
                "defensive",
                "趋势或系统压力已进入防守区，短线先保护净值。",
                "只有重新站回 MA20 并修复放量下跌后再观察。",
                &defensive_trigger,
            ),
            make_position_advice(
                "medium",
                "中期",
                "只留核心",
                "-10%~-20%",
                "15%~35%",
                "reduce",
                "中期需要降低高弹性仓位，等待 MA50 修复。",
                "站回 MA50，系统风险低于 60，结构评分回到 50 以上。",
                &defensive_trigger,
            ),
            make_position_advice(
                "long",
                "长期",
                "防守配置",
                "-5%~-15%",
                "25%~45%",
                "defensive",
                "长期资金也需要控制最大回撤，避免在系统压力高位集中加仓。",
                "系统风险回落且趋势评分回到 55 以上。",
                &defensive_trigger,
            ),
        ],
        _ => vec![
            make_position_advice(
                "short",
                "短期",
                "等待确认",
                "0%",
                "20%~35%",
                "hold",
                &format!("结构和动量尚未给出明确方向，当前更适合等待触发条件。过热 {heat}/100，系统风险 {systemic}/100。"),
                &entry_pullback,
                &risk_break,
            ),
            make_position_advice(
                "medium",
                "中期",
                "区间管理",
                "0%~+5%",
                "35%~55%",
                "hold",
                "中期按区间处理，突破确认再加，跌破支撑就降。",
                "结构评分升至 60 以上，且核心标的同步转强。",
                &defensive_trigger,
            ),
            make_position_advice(
                "long",
                "长期",
                "核心观察",
                "0%",
                "45%~60%",
                "hold",
                &format!("长期先看结构能否改善，目前结构评分 {structure_score}/100。"),
                "交易分升至 60 以上后再逐步恢复。",
                &defensive_trigger,
            ),
        ],
    };

    let advice = apply_position_copy(&profile.copy, state, advice);
    let advice = apply_market_damage_policy(
        profile,
        state,
        factors,
        pattern_analysis,
        leader_confirmation,
        advice,
    );
    apply_action_policy(profile, state, factors, advice)
}

#[derive(Debug, Clone)]
struct MarketDamage {
    score: u8,
    label: &'static str,
    detail: String,
}

const TARGET_EXPOSURE_MEANING: &str = "目标暴露上限，不是立即买入建议";
const TARGET_EXPOSURE_NOTE: &str =
    "区间表示当前风险状态允许的目标暴露上限；新增仓位仍需满足确认条件。";

fn apply_market_damage_policy(
    profile: &AnalysisProfile,
    state: &MarketState,
    factors: &[FactorScore],
    pattern_analysis: &PatternAnalysis,
    leader_confirmation: Option<&LeaderConfirmation>,
    mut advice: Vec<PositionAdvice>,
) -> Vec<PositionAdvice> {
    let damage = market_damage_for(
        profile,
        state,
        factors,
        pattern_analysis,
        leader_confirmation,
    );
    let haircut_allowed = matches!(
        state.key.as_str(),
        "risk_diffusion_watch"
            | "strong_trend_divergence"
            | "trend_repair_leader_divergence"
            | "trend_breakdown"
            | "weak_trend_low_risk"
            | "range_watch"
    ) && damage.score >= 50;

    for item in &mut advice {
        item.range_meaning = TARGET_EXPOSURE_MEANING.to_string();
        item.damage_score = damage.score;
        item.damage_label = damage.label.to_string();

        if state.key == "risk_diffusion_breakdown" {
            item.range_note = format!(
                "已进入{}，采用压缩目标暴露区间。{}",
                damage.label, damage.detail
            );
            refresh_position_ranges(item);
            continue;
        }

        if haircut_allowed {
            let previous = item.target_position.clone();
            if let Some(adjusted) =
                adjusted_position_range(&previous, &item.horizon_key, damage.score)
            {
                if adjusted != previous {
                    item.target_position = adjusted.clone();
                    item.range_note = format!(
                        "{}已按{}从 {} 裁剪为 {}。{}",
                        TARGET_EXPOSURE_NOTE, damage.label, previous, adjusted, damage.detail
                    );
                    refresh_position_ranges(item);
                    continue;
                }
            }
        }

        item.range_note = format!("{}{}", TARGET_EXPOSURE_NOTE, damage.detail);
        refresh_position_ranges(item);
    }

    advice
}

fn market_damage_for(
    profile: &AnalysisProfile,
    state: &MarketState,
    factors: &[FactorScore],
    pattern_analysis: &PatternAnalysis,
    leader_confirmation: Option<&LeaderConfirmation>,
) -> MarketDamage {
    let trend = factor_value(factors, "trend");
    let systemic = factor_value(factors, "systemic");
    let volatility = factor_value(factors, "volatility");
    let structure = factor_value(factors, "structure");
    let breadth_damage = 100_u8.saturating_sub(structure);
    let drawdown_damage = match state.key.as_str() {
        "trend_breakdown" | "risk_release" | "defensive_breakdown" => {
            100_u8.saturating_sub(trend).max(72)
        }
        _ => 100_u8.saturating_sub(trend),
    };
    let core_breakdown = leader_confirmation
        .map(core_breakdown_damage)
        .unwrap_or_else(|| match state.key.as_str() {
            "risk_diffusion_breakdown" | "trend_breakdown" => 72,
            "risk_diffusion_watch" | "strong_trend_divergence" => 48,
            _ => 24,
        });
    let high_beta_weakness = leader_confirmation
        .map(leader_weakness_damage)
        .unwrap_or(0)
        .max(match state.key.as_str() {
            "risk_diffusion_breakdown" => 78,
            "risk_diffusion_watch" => 64,
            "strong_trend_divergence" => 58,
            "trend_repair_leader_divergence" => 54,
            _ => 0,
        });
    let volatility_shock = systemic.max(volatility);
    let failed_rebound = pattern_analysis
        .dominant
        .as_ref()
        .map(pattern_damage)
        .unwrap_or(0);

    let weighted = breadth_damage as f64 * 0.25
        + core_breakdown as f64 * 0.20
        + drawdown_damage as f64 * 0.20
        + high_beta_weakness as f64 * 0.15
        + volatility_shock as f64 * 0.10
        + failed_rebound as f64 * 0.10;
    let mut score =
        bounded_score((weighted * profile_damage_multiplier(&profile.key)).round() as i16);

    if state.key == "risk_diffusion_breakdown" {
        score = score.max(70);
    }
    if leader_confirmation.is_some_and(|leader| leader.severe) {
        score = score.max(65);
    }

    let label = match score {
        80..=100 => "重度损伤",
        65..=79 => "扩散损伤",
        50..=64 => "轻度损伤",
        _ => "结构可控",
    };

    let mut reasons = Vec::new();
    if breadth_damage >= 60 {
        reasons.push("广度偏弱");
    }
    if core_breakdown >= 70 {
        reasons.push("核心链条破位");
    } else if core_breakdown >= 55 {
        reasons.push("核心确认不足");
    }
    if high_beta_weakness >= 70 {
        reasons.push("高 beta 链条跑输");
    }
    if volatility_shock >= 70 {
        reasons.push("系统/波动压力高");
    }
    if failed_rebound >= 60 {
        reasons.push("反弹失败或破位形态");
    }

    let detail = if reasons.is_empty() {
        "当前未触发额外裁剪，仅保留确认条件。".to_string()
    } else {
        format!("裁剪依据：{}。", reasons.join("、"))
    };

    MarketDamage {
        score,
        label,
        detail,
    }
}

fn profile_damage_multiplier(profile_key: &str) -> f64 {
    match profile_key {
        "ai-semiconductor" | "korea-ai-risk" => 1.15,
        "hk-tech" | "a-share-risk" => 1.12,
        "us-core" => 1.04,
        "global-risk" => 0.96,
        _ => 1.0,
    }
}

fn core_breakdown_damage(leader: &LeaderConfirmation) -> u8 {
    if leader.severe || leader.below_ma50_count >= 2 || leader.confirmation_below_ma50_count >= 2 {
        85
    } else if leader.below_ma50_count > 0 || leader.confirmation_below_ma50_count > 0 {
        70
    } else if leader.below_ma20_count > 0 || leader.confirmation_below_ma20_count > 0 {
        55
    } else if leader.divergent {
        48
    } else {
        22
    }
}

fn leader_weakness_damage(leader: &LeaderConfirmation) -> u8 {
    let total = leader.leader_count + leader.confirmation_count;
    if total == 0 {
        return 0;
    }
    let weak = leader.weak_count + leader.confirmation_weak_count;
    ((weak * 100) / total).min(100) as u8
}

fn pattern_damage(pattern: &ChartPattern) -> u8 {
    if pattern.direction == "bearish" || pattern.tone == "negative" {
        pattern.confidence
    } else if pattern.tone == "caution" {
        ((pattern.confidence as u16 * 2) / 3).min(100) as u8
    } else {
        0
    }
}

fn adjusted_position_range(value: &str, horizon_key: &str, damage_score: u8) -> Option<String> {
    let (lower, upper) = parse_percent_range(value)?;
    let (lower_cut, upper_cut) = damage_haircut(horizon_key, damage_score);
    if lower_cut == 0 && upper_cut == 0 {
        return None;
    }
    let adjusted_lower = lower.saturating_sub(lower_cut);
    let adjusted_upper = upper
        .saturating_sub(upper_cut)
        .max(adjusted_lower)
        .min(upper);
    Some(position_range(adjusted_lower, adjusted_upper))
}

fn damage_haircut(horizon_key: &str, damage_score: u8) -> (u8, u8) {
    match damage_score {
        80..=100 => (10, 10),
        65..=79 => match horizon_key {
            "short" => (5, 8),
            _ => (5, 10),
        },
        50..=64 => match horizon_key {
            "short" => (0, 7),
            _ => (0, 7),
        },
        _ => (0, 0),
    }
}

fn parse_percent_range(value: &str) -> Option<(u8, u8)> {
    let (lower, upper) = parse_signed_percent_range(value)?;
    if lower < 0 || upper < 0 {
        return None;
    }
    Some((lower.min(upper) as u8, lower.max(upper) as u8))
}

fn parse_signed_percent_range(value: &str) -> Option<(i16, i16)> {
    let numbers = signed_numbers(value);
    if numbers.is_empty() {
        return None;
    }
    if numbers.len() == 1 {
        return Some((numbers[0], numbers[0]));
    }
    Some((numbers[0].min(numbers[1]), numbers[0].max(numbers[1])))
}

fn signed_numbers(value: &str) -> Vec<i16> {
    let mut numbers = Vec::new();
    let mut current = String::new();

    for character in value.chars() {
        if character.is_ascii_digit()
            || ((character == '+' || character == '-') && current.is_empty())
        {
            current.push(character);
            continue;
        }

        if current.chars().any(|item| item.is_ascii_digit()) {
            if let Ok(parsed) = current.parse::<i16>() {
                numbers.push(parsed);
            }
        }
        current.clear();
    }

    if current.chars().any(|item| item.is_ascii_digit()) {
        if let Ok(parsed) = current.parse::<i16>() {
            numbers.push(parsed);
        }
    }

    numbers
}

fn refresh_position_ranges(advice: &mut PositionAdvice) {
    advice.current_range = exposure_range_from_text(&advice.target_position);
    advice.add_range = exposure_range_from_text(&advice.adjustment);
    advice.max_cap = advice
        .current_range
        .as_ref()
        .map(|range| range.max.clamp(0, 100) as u8);
}

fn exposure_range_from_text(value: &str) -> Option<ExposureRange> {
    let (min, max) = parse_signed_percent_range(value)?;
    let display = if min >= 0 && max >= 0 && !value.contains('+') && !value.contains('-') {
        position_range(min as u8, max as u8)
    } else {
        signed_position_range(min, max)
    };
    Some(ExposureRange { min, max, display })
}

fn signed_position_range(min: i16, max: i16) -> String {
    let lower = min.min(max);
    let upper = min.max(max);
    if lower == upper {
        format_signed_percent(lower)
    } else {
        format!(
            "{}~{}",
            format_signed_percent(lower),
            format_signed_percent(upper)
        )
    }
}

fn format_signed_percent(value: i16) -> String {
    if value > 0 {
        format!("+{value}%")
    } else {
        format!("{value}%")
    }
}

fn apply_position_copy(
    copy: &ProfileCopyConfig,
    state: &MarketState,
    mut advice: Vec<PositionAdvice>,
) -> Vec<PositionAdvice> {
    let Some(overrides) = copy
        .states
        .get(&state.key)
        .and_then(|item| item.advice.as_ref())
    else {
        return advice;
    };

    for override_item in overrides {
        if override_item.horizon_key.trim().is_empty() {
            continue;
        }
        if let Some(item) = advice
            .iter_mut()
            .find(|item| item.horizon_key == override_item.horizon_key)
        {
            apply_advice_override(item, override_item);
        }
    }

    advice
}

fn apply_action_policy(
    profile: &AnalysisProfile,
    state: &MarketState,
    factors: &[FactorScore],
    mut advice: Vec<PositionAdvice>,
) -> Vec<PositionAdvice> {
    let trend = factor_value(factors, "trend");
    let heat = factor_value(factors, "heat");
    let systemic = factor_value(factors, "systemic");
    let structure = factor_value(factors, "structure");
    let edge = factor_value(factors, "opportunity");
    let budget_pressure = systemic
        .max((heat as f64 * 0.55).round() as u8)
        .max(100_u8.saturating_sub(structure));

    for item in &mut advice {
        let gates = action_gates_for(
            profile,
            state,
            &item.horizon_key,
            trend,
            heat,
            systemic,
            structure,
            edge,
            budget_pressure,
        );
        let confidence_score =
            action_confidence_for(item, &gates, trend, heat, systemic, structure, edge);
        item.confidence_score = confidence_score;
        item.confidence_label = confidence_label(confidence_score).to_string();
        item.confidence_tone = confidence_tone(confidence_score).to_string();
        item.gates = gates;
    }

    advice
}

#[allow(clippy::too_many_arguments)]
fn action_gates_for(
    profile: &AnalysisProfile,
    state: &MarketState,
    horizon: &str,
    trend: u8,
    heat: u8,
    systemic: u8,
    structure: u8,
    edge: u8,
    budget_pressure: u8,
) -> Vec<ActionGate> {
    let horizon_score = horizon_policy_score(horizon, trend, heat, systemic, structure, edge);
    let edge_threshold = match horizon {
        "short" => 55,
        "medium" => 50,
        _ => 45,
    };
    let structure_threshold = match horizon {
        "short" => 50,
        "medium" => 55,
        _ => 50,
    };
    let heat_watch = match horizon {
        "short" => 65,
        "medium" => 75,
        _ => 82,
    };
    let heat_block = match horizon {
        "short" => 82,
        "medium" => 90,
        _ => 96,
    };

    let mut gates = Vec::new();
    gates.push(score_gate(
        "edge",
        "赔率",
        horizon_score,
        edge_threshold,
        edge_threshold.saturating_add(15),
        "cap_add",
        "block_add",
        &format!(
            "{}评分 {horizon_score}/100；低于 {edge_threshold} 时不适合提高新增仓位。",
            horizon_label(horizon)
        ),
    ));

    let broken_state = matches!(
        state.key.as_str(),
        "trend_breakdown" | "risk_release" | "defensive_breakdown"
    );
    let trend_detail = if broken_state {
        format!("当前状态为{}，趋势/结构闸门关闭。", state.label)
    } else {
        format!(
            "趋势 {trend}/100，结构 {structure}/100；低于 {structure_threshold} 只允许观察或防守。"
        )
    };
    let structure_status = if broken_state || structure < structure_threshold {
        "block"
    } else if structure < structure_threshold.saturating_add(12) {
        "watch"
    } else {
        "pass"
    };
    let structure_tone = if broken_state || structure < structure_threshold {
        "negative"
    } else if structure < structure_threshold.saturating_add(12) {
        "caution"
    } else {
        "positive"
    };
    gates.push(action_gate(
        "structure",
        "趋势结构",
        structure_status,
        structure_tone,
        gate_effect(structure_status, "allow", "cap_add", "block_add"),
        trend_detail,
    ));

    let heat_status = if heat >= heat_block {
        "block"
    } else if heat >= heat_watch {
        "watch"
    } else {
        "pass"
    };
    let heat_tone = if heat >= heat_block {
        "negative"
    } else if heat >= heat_watch {
        "caution"
    } else {
        "positive"
    };
    gates.push(action_gate(
        "heat",
        "拥挤度",
        heat_status,
        heat_tone,
        gate_effect(heat_status, "allow", "cooldown", "block_chase"),
        format!(
            "过热 {heat}/100；{}段超过 {heat_watch} 需等待降温，超过 {heat_block} 不追价。",
            horizon_label(horizon)
        ),
    ));

    gates.push(match profile.mandate.risk_score_limit {
        Some(limit) => {
            let budget_status = if budget_pressure > limit {
                "block"
            } else if budget_pressure >= limit.saturating_sub(8) {
                "watch"
            } else {
                "pass"
            };
            let budget_tone = if budget_pressure > limit {
                "negative"
            } else if budget_pressure >= limit.saturating_sub(8) {
                "caution"
            } else {
                "positive"
            };
            action_gate(
                "budget",
                "风险预算",
                budget_status,
                budget_tone,
                gate_effect(budget_status, "allow", "slow_add", "cap_add"),
                format!(
                    "预算压力 {budget_pressure}/100，Profile 上限 {limit}/100；超过上限时只允许降速或降仓。"
                ),
            )
        }
        None => action_gate(
            "budget",
            "风险预算",
            "watch",
            "caution",
            "require_limit",
            "Profile 未设置 riskScoreLimit，仓位上限只能按市场状态保守推导。".to_string(),
        ),
    });

    if fund_configured(&profile.fund) {
        gates.push(fund_freshness_gate(&profile.fund, horizon));
    }

    if systemic >= 75 {
        gates.push(action_gate(
            "systemic",
            "系统压力",
            "block",
            "negative",
            "defensive_only",
            format!("系统压力 {systemic}/100，恢复风险预算前先等压力回落。"),
        ));
    }

    gates
}

fn score_gate(
    key: &str,
    label: &str,
    score: u8,
    watch_threshold: u8,
    pass_threshold: u8,
    watch_effect: &str,
    block_effect: &str,
    detail: &str,
) -> ActionGate {
    let status = if score >= pass_threshold {
        "pass"
    } else if score >= watch_threshold {
        "watch"
    } else {
        "block"
    };
    let tone = if score >= pass_threshold {
        "positive"
    } else if score >= watch_threshold {
        "caution"
    } else {
        "negative"
    };
    action_gate(
        key,
        label,
        status,
        tone,
        gate_effect(status, "allow", watch_effect, block_effect),
        detail.to_string(),
    )
}

fn action_gate(
    key: &str,
    label: &str,
    status: &str,
    tone: &str,
    effect: &str,
    detail: String,
) -> ActionGate {
    ActionGate {
        key: key.to_string(),
        label: label.to_string(),
        status: status.to_string(),
        triggered: status != "pass",
        effect: effect.to_string(),
        tone: tone.to_string(),
        detail,
    }
}

fn gate_effect<'a>(status: &str, pass: &'a str, watch: &'a str, block: &'a str) -> &'a str {
    match status {
        "block" => block,
        "watch" => watch,
        _ => pass,
    }
}

fn horizon_policy_score(
    horizon: &str,
    trend: u8,
    heat: u8,
    systemic: u8,
    structure: u8,
    edge: u8,
) -> u8 {
    match horizon {
        "short" => edge,
        "medium" => bounded_score(
            (edge as f64 * 0.25
                + structure as f64 * 0.35
                + trend as f64 * 0.18
                + 100_u8.saturating_sub(systemic) as f64 * 0.15
                + 100_u8.saturating_sub(heat) as f64 * 0.07)
                .round() as i16,
        ),
        _ => bounded_score(
            (structure as f64 * 0.30
                + trend as f64 * 0.26
                + 100_u8.saturating_sub(systemic) as f64 * 0.32
                + 100_u8.saturating_sub(heat.min(70)) as f64 * 0.12)
                .round() as i16,
        ),
    }
}

fn fund_configured(fund: &ProfileFundConfig) -> bool {
    [
        fund.code.as_deref(),
        fund.name.as_deref(),
        fund.nav_symbol.as_deref(),
        fund.holdings_as_of.as_deref(),
        fund.holdings_source.as_deref(),
    ]
    .iter()
    .any(|value| value.map(str::trim).is_some_and(|item| !item.is_empty()))
}

fn fund_freshness_gate(fund: &ProfileFundConfig, horizon: &str) -> ActionGate {
    let raw_date = fund.holdings_as_of.as_deref().map(str::trim).unwrap_or("");
    if raw_date.is_empty() {
        let status = if horizon == "long" { "watch" } else { "block" };
        let tone = if horizon == "long" {
            "caution"
        } else {
            "negative"
        };
        return action_gate(
            "fund_freshness",
            "持仓时效",
            status,
            tone,
            gate_effect(status, "allow", "manual_review", "require_fresh_data"),
            "基金未设置 holdingsAsOf，短/中期买点需要更多依赖净值、基准和实时持仓代理。"
                .to_string(),
        );
    }

    match NaiveDate::parse_from_str(raw_date, "%Y-%m-%d") {
        Ok(date) => {
            let age = (Utc::now().date_naive() - date).num_days();
            let (status, tone) = if age < 0 {
                ("block", "negative")
            } else if age <= 45 {
                ("pass", "positive")
            } else if age <= 100 || horizon == "long" {
                ("watch", "caution")
            } else {
                ("block", "negative")
            };
            action_gate(
                "fund_freshness",
                "持仓时效",
                status,
                tone,
                gate_effect(status, "allow", "manual_review", "require_fresh_data"),
                format!(
                    "基金持仓披露日 {raw_date}，距今 {age} 天；短线判断越依赖新鲜持仓和净值确认。"
                ),
            )
        }
        Err(_) => action_gate(
            "fund_freshness",
            "持仓时效",
            "block",
            "negative",
            "require_fresh_data",
            format!("基金 holdingsAsOf `{raw_date}` 无法解析，无法审计持仓时效。"),
        ),
    }
}

fn action_confidence_for(
    advice: &PositionAdvice,
    gates: &[ActionGate],
    trend: u8,
    heat: u8,
    systemic: u8,
    structure: u8,
    edge: u8,
) -> u8 {
    let gate_blocks = gates.iter().filter(|item| item.status == "block").count() as i16;
    let gate_watches = gates.iter().filter(|item| item.status == "watch").count() as i16;
    let horizon_score =
        horizon_policy_score(&advice.horizon_key, trend, heat, systemic, structure, edge) as i16;
    let risk_pressure = systemic.max(heat).max(100_u8.saturating_sub(structure)) as i16;
    let mut score = match advice.tone.as_str() {
        "increase" => horizon_score - gate_blocks * 16 - gate_watches * 6,
        "reduce" | "defensive" => 58 + risk_pressure / 3 + gate_blocks * 4,
        "caution" => 52 + horizon_score / 5 - gate_watches * 2,
        _ => 54 + horizon_score / 4 - gate_blocks * 8 - gate_watches * 3,
    };
    if advice.horizon_key == "long" {
        score += 4;
    }
    bounded_score(score)
}

fn confidence_label(score: u8) -> &'static str {
    match score {
        75..=100 => "高置信",
        58..=74 => "中置信",
        _ => "低置信",
    }
}

fn confidence_tone(score: u8) -> &'static str {
    match score {
        75..=100 => "positive",
        58..=74 => "neutral",
        _ => "caution",
    }
}

fn horizon_label(horizon: &str) -> &'static str {
    match horizon {
        "short" => "短期",
        "medium" => "中期",
        "long" => "长期",
        _ => "当前",
    }
}

fn apply_advice_override(advice: &mut PositionAdvice, override_item: &ProfileAdviceCopy) {
    if let Some(value) = non_empty_copy(override_item.horizon_label.as_deref()) {
        advice.horizon_label = value;
    }
    if let Some(value) = non_empty_copy(override_item.action.as_deref()) {
        advice.action = value;
    }
    if let Some(value) = non_empty_copy(override_item.adjustment.as_deref()) {
        advice.adjustment = value;
    }
    if let Some(value) = non_empty_copy(override_item.target_position.as_deref()) {
        advice.target_position = value;
    }
    if let Some(value) = non_empty_copy(override_item.tone.as_deref()) {
        advice.tone = value;
    }
    if let Some(value) = non_empty_copy(override_item.rationale.as_deref()) {
        advice.rationale = value;
    }
    if let Some(value) = non_empty_copy(override_item.entry_trigger.as_deref()) {
        advice.entry_trigger = value;
    }
    if let Some(value) = non_empty_copy(override_item.risk_trigger.as_deref()) {
        advice.risk_trigger = value;
    }
    refresh_position_ranges(advice);
}

fn non_empty_copy(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn make_position_advice(
    horizon_key: &str,
    horizon_label: &str,
    action: &str,
    adjustment: &str,
    target_position: &str,
    tone: &str,
    rationale: &str,
    entry_trigger: &str,
    risk_trigger: &str,
) -> PositionAdvice {
    let mut advice = PositionAdvice {
        horizon_key: horizon_key.to_string(),
        horizon_label: horizon_label.to_string(),
        action: action.to_string(),
        adjustment: adjustment.to_string(),
        target_position: target_position.to_string(),
        current_range: None,
        add_range: None,
        max_cap: None,
        range_meaning: TARGET_EXPOSURE_MEANING.to_string(),
        range_note: TARGET_EXPOSURE_NOTE.to_string(),
        damage_score: 0,
        damage_label: "结构可控".to_string(),
        tone: tone.to_string(),
        confidence_score: 0,
        confidence_label: String::new(),
        confidence_tone: "neutral".to_string(),
        gates: Vec::new(),
        rationale: rationale.to_string(),
        entry_trigger: entry_trigger.to_string(),
        risk_trigger: risk_trigger.to_string(),
    };
    refresh_position_ranges(&mut advice);
    advice
}

fn position_range(min: u8, max: u8) -> String {
    format!("{}%~{}%", min.min(max), max.max(min))
}

fn factor_pressure(dimensions: &[DimensionScore], factor: &str) -> u8 {
    let mut weight = 0_u16;
    let mut score = 0_u16;
    for dimension in dimensions
        .iter()
        .filter(|dimension| dimension.factor == factor)
    {
        weight += dimension.weight as u16;
        score += dimension.score as u16;
    }
    if weight == 0 {
        return 0;
    }
    ((score * 100) / weight).min(100) as u8
}

fn factor_raw_pressure(dimensions: &[DimensionScore], factor: &str, multiplier: u16) -> u8 {
    dimensions
        .iter()
        .filter(|dimension| dimension.factor == factor)
        .map(|dimension| dimension.score as u16)
        .sum::<u16>()
        .saturating_mul(multiplier)
        .min(100) as u8
}

fn factor_value(factors: &[FactorScore], key: &str) -> u8 {
    factors
        .iter()
        .find(|factor| factor.key == key)
        .map(|factor| factor.score)
        .unwrap_or(0)
}

fn role_matches(configured_roles: &[String], role: &str) -> bool {
    if role.is_empty() {
        return false;
    }
    configured_roles
        .iter()
        .any(|configured| configured == "*" || configured == role)
}

fn role_list_text(roles: &[String]) -> String {
    if roles.is_empty() {
        "-".to_string()
    } else {
        roles.join(" / ")
    }
}

fn weak_ratio_met(weak: usize, total: usize, ratio: f64) -> bool {
    total > 0 && (weak as f64 / total as f64) >= ratio
}

fn short_label_list(labels: &[String]) -> String {
    if labels.is_empty() {
        return "-".to_string();
    }

    let mut text = labels
        .iter()
        .take(3)
        .cloned()
        .collect::<Vec<_>>()
        .join(" / ");
    if labels.len() > 3 {
        text.push_str(" 等");
    }
    text
}

fn trend_strength(snapshot: &IndicatorSnapshot) -> u8 {
    let close = snapshot.candle.close;
    let mut score = 0_u8;
    if above(close, snapshot.ma(20)) {
        score += 22;
    }
    if above(close, snapshot.ma(50)) {
        score += 22;
    }
    if above(close, snapshot.ma(200)) {
        score += 18;
    }
    if snapshot
        .ma(20)
        .zip(snapshot.ma(50))
        .is_some_and(|(left, right)| left >= right)
    {
        score += 14;
    }
    if snapshot.return_for(20).unwrap_or(0.0) > 0.0 {
        score += 12;
    }
    if snapshot
        .macd
        .zip(snapshot.macd_signal)
        .is_some_and(|(macd, signal)| macd >= signal)
    {
        score += 12;
    }
    score.min(100)
}

fn momentum_strength(snapshot: &IndicatorSnapshot) -> u8 {
    let rsi = snapshot.rsi(14).unwrap_or(50.0);
    let rsi_score = if rsi >= 75.0 {
        88
    } else if rsi >= 60.0 {
        72
    } else if rsi >= 45.0 {
        52
    } else if rsi >= 35.0 {
        34
    } else {
        20
    };
    let return_score = match snapshot.return_for(20).unwrap_or(0.0) {
        value if value >= 12.0 => 12,
        value if value >= 5.0 => 8,
        value if value >= 0.0 => 4,
        value if value <= -8.0 => -12,
        _ => -6,
    };
    bounded_score(rsi_score + return_score)
}

fn technical_heat_pressure(snapshot: &IndicatorSnapshot) -> u8 {
    let rsi = snapshot.rsi(14).unwrap_or(50.0);
    let return_20d = snapshot.return_for(20).unwrap_or(0.0);
    let distance = ma_distance(snapshot, 20).unwrap_or(0.0);
    let mut score = 0_i16;

    score += if rsi >= 85.0 {
        50
    } else if rsi >= 75.0 {
        38
    } else if rsi >= 68.0 {
        24
    } else if rsi >= 60.0 {
        12
    } else {
        0
    };
    score += if return_20d >= 20.0 {
        28
    } else if return_20d >= 12.0 {
        18
    } else if return_20d >= 6.0 {
        10
    } else {
        0
    };
    score += if distance >= 12.0 {
        22
    } else if distance >= 8.0 {
        14
    } else if distance >= 5.0 {
        8
    } else {
        0
    };

    bounded_score(score)
}

fn technical_systemic_pressure(snapshot: &IndicatorSnapshot) -> u8 {
    let close = snapshot.candle.close;
    let mut score = 0_i16;
    if below(close, snapshot.ma(50)) {
        score += 25;
    }
    if below(close, snapshot.ma(200)) {
        score += 35;
    }
    if snapshot.return_for(20).unwrap_or(0.0) <= -8.0 {
        score += 18;
    }
    if snapshot
        .macd
        .zip(snapshot.macd_signal)
        .is_some_and(|(macd, signal)| macd < signal)
    {
        score += 12;
    }
    if technical_heat_pressure(snapshot) >= 85 {
        score += 10;
    }
    if snapshot.change_1d().unwrap_or(0.0) <= -2.0 && above(close, snapshot.ma(20)) {
        score += 8;
    }
    bounded_score(score)
}

fn technical_volatility_pressure(snapshot: &IndicatorSnapshot) -> u8 {
    let rsi = snapshot.rsi(14).unwrap_or(50.0);
    let return_20d = snapshot.return_for(20).unwrap_or(0.0);
    let distance = ma_distance(snapshot, 20).unwrap_or(0.0);
    let change_1d = snapshot.change_1d().unwrap_or(0.0).abs();
    let mut score = 0_i16;

    score += if rsi >= 90.0 {
        30
    } else if rsi >= 82.0 {
        24
    } else if rsi >= 75.0 {
        16
    } else {
        0
    };
    score += if return_20d >= 30.0 {
        28
    } else if return_20d >= 18.0 {
        20
    } else if return_20d >= 10.0 {
        12
    } else {
        0
    };
    score += if distance >= 20.0 {
        24
    } else if distance >= 12.0 {
        18
    } else if distance >= 8.0 {
        10
    } else {
        0
    };
    score += if change_1d >= 4.0 {
        14
    } else if change_1d >= 2.0 {
        9
    } else {
        0
    };

    bounded_score(score)
}

fn structure_strength(snapshot: &IndicatorSnapshot) -> u8 {
    let close = snapshot.candle.close;
    let extension = ma_distance(snapshot, 20).unwrap_or(0.0).max(0.0);
    let mut score = trend_strength(snapshot) as i16;
    if extension > 12.0 {
        score -= 22;
    } else if extension > 8.0 {
        score -= 14;
    } else if extension > 5.0 {
        score -= 6;
    }
    if below(close, snapshot.ma(20)) {
        score -= 12;
    }
    bounded_score(score)
}

fn opportunity_score(trend: u8, heat: u8, systemic: u8, structure: u8) -> u8 {
    let score = trend as f64 * 0.25
        + structure as f64 * 0.25
        + (100 - heat) as f64 * 0.35
        + (100 - systemic) as f64 * 0.15;
    bounded_score(score.round() as i16)
}

fn trend_status(score: u8) -> (&'static str, &'static str) {
    match score {
        75..=100 => ("positive", "强趋势"),
        55..=74 => ("neutral", "趋势修复"),
        35..=54 => ("caution", "趋势摇摆"),
        _ => ("negative", "趋势弱"),
    }
}

fn momentum_status(score: u8) -> (&'static str, &'static str) {
    match score {
        75..=100 => ("positive", "动量强"),
        55..=74 => ("neutral", "动量温和"),
        35..=54 => ("caution", "动量不足"),
        _ => ("negative", "动量弱"),
    }
}

fn heat_status(score: u8) -> (&'static str, &'static str) {
    match score {
        75..=100 => ("caution", "明显过热"),
        55..=74 => ("neutral", "偏热"),
        35..=54 => ("neutral", "正常"),
        _ => ("positive", "不拥挤"),
    }
}

fn systemic_status(score: u8) -> (&'static str, &'static str) {
    match score {
        75..=100 => ("negative", "系统高压"),
        55..=74 => ("caution", "压力抬升"),
        20..=54 => ("neutral", "压力可控"),
        _ => ("positive", "系统稳定"),
    }
}

fn volatility_status(score: u8) -> (&'static str, &'static str) {
    match score {
        75..=100 => ("negative", "波动很高"),
        55..=74 => ("caution", "波动偏高"),
        30..=54 => ("neutral", "波动可控"),
        _ => ("positive", "波动低"),
    }
}

fn opportunity_status(score: u8) -> (&'static str, &'static str) {
    match score {
        75..=100 => ("positive", "买点较好"),
        55..=74 => ("neutral", "等回踩"),
        35..=54 => ("caution", "买点一般"),
        _ => ("negative", "不宜扩张"),
    }
}

fn structure_status(score: u8) -> (&'static str, &'static str) {
    match score {
        70..=100 => ("positive", "结构强"),
        50..=69 => ("neutral", "结构可用"),
        30..=49 => ("caution", "结构脆弱"),
        _ => ("negative", "结构破坏"),
    }
}

fn trend_detail(snapshot: &IndicatorSnapshot) -> String {
    format!(
        "收盘价相对 MA20/MA50/MA200 和 MACD 共同决定趋势强度，20日涨跌幅 {:+.1}%。",
        round(snapshot.return_for(20).unwrap_or(0.0), 1)
    )
}

fn momentum_detail(snapshot: &IndicatorSnapshot) -> String {
    format!(
        "RSI {:.1}，20日涨跌幅 {:+.1}%，用于判断主线速度。",
        round(snapshot.rsi(14).unwrap_or(0.0), 1),
        round(snapshot.return_for(20).unwrap_or(0.0), 1)
    )
}

fn heat_detail(snapshot: &IndicatorSnapshot) -> String {
    format!(
        "RSI、20日涨幅和 MA20 乖离共同衡量追高风险，当前乖离 {:+.1}%。",
        round(ma_distance(snapshot, 20).unwrap_or(0.0), 1)
    )
}

fn volatility_detail(snapshot: &IndicatorSnapshot) -> String {
    format!(
        "RSI {:.1}，20日涨幅 {:+.1}%，MA20 乖离 {:+.1}%，衡量短线波动和回撤风险。",
        round(snapshot.rsi(14).unwrap_or(0.0), 1),
        round(snapshot.return_for(20).unwrap_or(0.0), 1),
        round(ma_distance(snapshot, 20).unwrap_or(0.0), 1)
    )
}

fn structure_detail(snapshot: &IndicatorSnapshot) -> String {
    format!(
        "结构分关注 MA20/MA50 支撑、60日高点回撤和是否远离均线，当前回撤 {:.1}%。",
        round(pullback_from_period_high(snapshot, 60).unwrap_or(0.0), 1)
    )
}

fn bounded_score(value: i16) -> u8 {
    value.clamp(0, 100) as u8
}

fn contains_any(value: &str, needles: &[&str]) -> bool {
    needles.iter().any(|needle| value.contains(needle))
}

fn above(value: f64, average: Option<f64>) -> bool {
    average.map(|average| value > average).unwrap_or(false)
}

fn format_price_option(value: Option<f64>) -> String {
    value
        .map(|value| format!("{:.2}", round(value, 2)))
        .unwrap_or_else(|| "-".to_string())
}

fn leading_pressure_label(dimensions: &[DimensionScore]) -> String {
    dimensions
        .iter()
        .max_by_key(|dimension| dimension.score)
        .filter(|dimension| dimension.score > 0)
        .map(|dimension| dimension.label.clone())
        .unwrap_or_else(|| "综合风险".to_string())
}

fn below(value: f64, average: Option<f64>) -> bool {
    average.map(|average| value < average).unwrap_or(false)
}

fn below_option(left: Option<f64>, right: Option<f64>) -> bool {
    match (left, right) {
        (Some(left), Some(right)) => left < right,
        _ => false,
    }
}

fn close_above_ma(snapshot: &IndicatorSnapshot, period: u16) -> bool {
    above(snapshot.candle.close, snapshot.ma(period))
}

fn close_below_ma(snapshot: &IndicatorSnapshot, period: u16) -> bool {
    below(snapshot.candle.close, snapshot.ma(period))
}

fn ma_distance(snapshot: &IndicatorSnapshot, period: u16) -> Option<f64> {
    snapshot
        .ma(period)
        .filter(|average| *average > 0.0)
        .map(|average| percent(snapshot.candle.close / average - 1.0))
}

fn macd_bearish(snapshot: &IndicatorSnapshot) -> bool {
    match (snapshot.macd, snapshot.macd_signal) {
        (Some(macd), Some(signal)) => macd < signal,
        _ => false,
    }
}

fn macd_bullish(snapshot: &IndicatorSnapshot) -> bool {
    match (snapshot.macd, snapshot.macd_signal) {
        (Some(macd), Some(signal)) => macd > signal,
        _ => false,
    }
}

fn macd_confirmation(snapshot: &IndicatorSnapshot) -> bool {
    macd_bullish(snapshot) && snapshot.macd_histogram().is_some_and(|value| value > 0.0)
}

fn macd_cross_up(snapshot: &IndicatorSnapshot) -> bool {
    match (
        snapshot.previous_macd,
        snapshot.previous_macd_signal,
        snapshot.macd,
        snapshot.macd_signal,
    ) {
        (Some(previous_macd), Some(previous_signal), Some(macd), Some(signal)) => {
            previous_macd <= previous_signal && macd > signal
        }
        _ => false,
    }
}

fn macd_cross_down(snapshot: &IndicatorSnapshot) -> bool {
    match (
        snapshot.previous_macd,
        snapshot.previous_macd_signal,
        snapshot.macd,
        snapshot.macd_signal,
    ) {
        (Some(previous_macd), Some(previous_signal), Some(macd), Some(signal)) => {
            previous_macd >= previous_signal && macd < signal
        }
        _ => false,
    }
}

fn kdj_line_value(value: KdjValue, line: Option<&str>) -> f64 {
    match line.unwrap_or("j").to_ascii_lowercase().as_str() {
        "k" => value.k,
        "d" => value.d,
        _ => value.j,
    }
}

fn is_kdj_line(line: &str) -> bool {
    matches!(line.to_ascii_lowercase().as_str(), "k" | "d" | "j")
}

fn kdj_bullish(snapshot: &IndicatorSnapshot, rule: &RuleConfig) -> bool {
    let Some(value) = snapshot.kdj(rule.period.unwrap_or(9)) else {
        return false;
    };
    if value.k <= value.d {
        return false;
    }
    let selected = kdj_line_value(value, rule.line.as_deref());
    rule.threshold.map(|min| selected >= min).unwrap_or(true)
        && rule
            .max_threshold
            .map(|max| selected <= max)
            .unwrap_or(true)
}

fn kdj_bearish(snapshot: &IndicatorSnapshot, rule: &RuleConfig) -> bool {
    let Some(value) = snapshot.kdj(rule.period.unwrap_or(9)) else {
        return false;
    };
    if value.k >= value.d {
        return false;
    }
    let selected = kdj_line_value(value, rule.line.as_deref());
    rule.threshold.map(|max| selected <= max).unwrap_or(true)
        && rule
            .max_threshold
            .map(|min| selected >= min)
            .unwrap_or(true)
}

fn kdj_cross_up(snapshot: &IndicatorSnapshot, rule: &RuleConfig) -> bool {
    let period = rule.period.unwrap_or(9);
    match (snapshot.previous_kdj(period), snapshot.kdj(period)) {
        (Some(previous), Some(current)) => previous.k <= previous.d && current.k > current.d,
        _ => false,
    }
}

fn kdj_cross_down(snapshot: &IndicatorSnapshot, rule: &RuleConfig) -> bool {
    let period = rule.period.unwrap_or(9);
    match (snapshot.previous_kdj(period), snapshot.kdj(period)) {
        (Some(previous), Some(current)) => previous.k >= previous.d && current.k < current.d,
        _ => false,
    }
}

fn kdj_above(snapshot: &IndicatorSnapshot, rule: &RuleConfig) -> bool {
    snapshot
        .kdj(rule.period.unwrap_or(9))
        .map(|value| kdj_line_value(value, rule.line.as_deref()) > rule.threshold.unwrap_or(80.0))
        .unwrap_or(false)
}

fn kdj_below(snapshot: &IndicatorSnapshot, rule: &RuleConfig) -> bool {
    snapshot
        .kdj(rule.period.unwrap_or(9))
        .map(|value| kdj_line_value(value, rule.line.as_deref()) < rule.threshold.unwrap_or(20.0))
        .unwrap_or(false)
}

fn trend_continuation(snapshot: &IndicatorSnapshot) -> bool {
    close_above_ma(snapshot, 20) && close_above_ma(snapshot, 50)
}

fn pullback_hold_ma(snapshot: &IndicatorSnapshot, rule: &RuleConfig) -> bool {
    let period = rule.period.unwrap_or(20);
    ma_distance(snapshot, period)
        .map(|distance| distance.abs() <= rule_tolerance_pct(rule, 2.2))
        .unwrap_or(false)
        && close_above_ma(snapshot, 50)
}

fn support_lost(snapshot: &IndicatorSnapshot, rule: &RuleConfig) -> bool {
    let period = rule.period.unwrap_or(50);
    close_below_ma(snapshot, period)
        || (ma_distance(snapshot, 20)
            .map(|distance| distance < -rule_tolerance_pct(rule, 3.0))
            .unwrap_or(false)
            && close_below_ma(snapshot, 20))
}

fn volume_breakout(snapshot: &IndicatorSnapshot, rule: &RuleConfig) -> bool {
    snapshot
        .volume_ratio()
        .map(|value| value >= rule_volume_threshold(rule, 1.45))
        .unwrap_or(false)
        && snapshot.change_1d().unwrap_or(0.0) >= rule.buffer.unwrap_or(0.0)
        && close_above_ma(snapshot, rule.period.unwrap_or(20))
}

fn distribution_volume(snapshot: &IndicatorSnapshot, rule: &RuleConfig) -> bool {
    let volume_expanded = snapshot
        .volume_ratio()
        .map(|value| value >= rule_volume_threshold(rule, 1.45))
        .unwrap_or(false);
    let bearish_price = snapshot.change_1d().unwrap_or(0.0) < rule.change_lte.unwrap_or(0.0);
    let overheated = snapshot.rsi(rule.period.unwrap_or(14)).unwrap_or(0.0)
        >= rule.max_threshold.unwrap_or(78.0);

    volume_expanded && (bearish_price || overheated)
}

fn range_compression(snapshot: &IndicatorSnapshot, rule: &RuleConfig) -> bool {
    let return_days = rule.days.unwrap_or(20);
    let return_abs_ok = snapshot
        .return_for(return_days)
        .map(|value| value.abs() <= rule_return_abs_max(rule, 3.0))
        .unwrap_or(false);
    let volume_ok = snapshot
        .volume_ratio()
        .map(|value| value <= rule_volume_max(rule, 1.08))
        .unwrap_or(true);

    return_abs_ok && volume_ok && snapshot.ma(20).is_some() && snapshot.ma(50).is_some()
}

fn momentum_exhaustion(snapshot: &IndicatorSnapshot, rule: &RuleConfig) -> bool {
    let rsi_overheated =
        snapshot.rsi(rule.period.unwrap_or(14)).unwrap_or(0.0) >= rule.threshold.unwrap_or(75.0);
    let kdj_overheated = snapshot
        .kdj(9)
        .map(|value| value.j >= rule.max_threshold.unwrap_or(90.0))
        .unwrap_or(false);

    rsi_overheated || kdj_overheated
}

fn risk_proxy_cooling(snapshot: &IndicatorSnapshot) -> bool {
    close_below_ma(snapshot, 20) && close_below_ma(snapshot, 50)
}

fn risk_proxy_heating(snapshot: &IndicatorSnapshot, rule: &RuleConfig) -> bool {
    close_above_ma(snapshot, 20)
        || snapshot
            .return_for(rule.days.unwrap_or(20))
            .map(|value| value > rule.threshold.unwrap_or(8.0))
            .unwrap_or(false)
        || snapshot.change_1d().unwrap_or(0.0) > rule.buffer.unwrap_or(5.0)
}

fn rule_tolerance_pct(rule: &RuleConfig, default: f64) -> f64 {
    rule.tolerance_pct.or(rule.threshold).unwrap_or(default)
}

fn rule_volume_threshold(rule: &RuleConfig, default: f64) -> f64 {
    rule.volume_threshold
        .or(rule.volume_ratio_gt)
        .or(rule.threshold)
        .unwrap_or(default)
}

fn rule_return_abs_max(rule: &RuleConfig, default: f64) -> f64 {
    rule.return20d_abs_max.or(rule.threshold).unwrap_or(default)
}

fn rule_volume_max(rule: &RuleConfig, default: f64) -> f64 {
    rule.volume_max.or(rule.max_threshold).unwrap_or(default)
}

fn is_risk_proxy_symbol(symbol: &str) -> bool {
    let normalized = symbol.trim().trim_start_matches('^').to_ascii_uppercase();
    matches!(
        normalized.as_str(),
        "VIX" | "VIXCLS" | "VVIX" | "VIXY" | "VXX" | "UVXY" | "MOVE"
    )
}

fn long_bearish_volume_candle(snapshot: &IndicatorSnapshot) -> bool {
    let day_change = snapshot.candle.close / snapshot.candle.open - 1.0;
    let range = (snapshot.candle.high - snapshot.candle.low).abs();
    let body = (snapshot.candle.open - snapshot.candle.close).max(0.0);
    day_change <= -0.03 && body >= range * 0.45 && snapshot.volume_ratio().unwrap_or(0.0) > 1.5
}

fn high_volume_stalling(snapshot: &IndicatorSnapshot) -> bool {
    let Some(high_60) = snapshot.high_60 else {
        return false;
    };
    let day_change = percent(snapshot.candle.close / snapshot.candle.open - 1.0);
    snapshot.volume_ratio().unwrap_or(0.0) > 1.5
        && day_change.abs() <= 1.0
        && snapshot.candle.close >= high_60 * 0.97
}

fn upper_shadow_reversal(snapshot: &IndicatorSnapshot, rule: &RuleConfig) -> bool {
    let change_ok = rule
        .change_lte
        .map(|max_change| snapshot.change_1d().unwrap_or(0.0) <= max_change)
        .unwrap_or(true);
    let volume_ok = rule
        .volume_ratio_gt
        .map(|min_ratio| snapshot.volume_ratio().unwrap_or(0.0) > min_ratio)
        .unwrap_or(true);

    upper_shadow_share(snapshot) >= rule.threshold.unwrap_or(45.0)
        && pullback_from_high(snapshot) >= rule.buffer.unwrap_or(2.0)
        && change_ok
        && volume_ok
}

fn upper_shadow_share(snapshot: &IndicatorSnapshot) -> f64 {
    let range = snapshot.candle.high - snapshot.candle.low;
    if range <= 0.0 {
        return 0.0;
    }
    let upper_shadow = snapshot.candle.high - snapshot.candle.open.max(snapshot.candle.close);
    percent(upper_shadow.max(0.0) / range)
}

fn pullback_from_high(snapshot: &IndicatorSnapshot) -> f64 {
    if snapshot.candle.close <= 0.0 {
        return 0.0;
    }
    percent(snapshot.candle.high / snapshot.candle.close - 1.0)
}

fn pullback_from_period_high(snapshot: &IndicatorSnapshot, period: u16) -> Option<f64> {
    snapshot
        .high(period)
        .filter(|high| *high > 0.0 && snapshot.candle.close > 0.0)
        .map(|high| percent(high / snapshot.candle.close - 1.0))
}

fn percent(value: f64) -> f64 {
    value * 100.0
}

fn round(value: f64, digits: u32) -> f64 {
    let factor = 10_f64.powi(digits as i32);
    (value * factor).round() / factor
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bridge_workspace_defaults_are_user_portable() {
        let documents = PathBuf::from("home").join("Documents");

        assert_eq!(
            default_bridge_workspace_from(Some(documents.clone()), "Qbot"),
            documents.join("Qbot")
        );
        assert_eq!(
            default_bridge_workspace_from(None, "vnpy"),
            PathBuf::from("Documents").join("vnpy")
        );
    }

    #[test]
    fn parses_eastmoney_daily_klines_in_ohlcv_order() {
        let value = serde_json::json!({
            "data": {
                "klines": [
                    "2026-07-02,4.955,4.850,4.960,4.835,13691536,6704066004.000,2.50,-2.96,-0.148,7.39",
                    "2026-07-03,4.830,4.876,4.927,4.828,19983308,9792434457.000,2.04,0.54,0.026,10.78"
                ]
            }
        });
        let candles = parse_eastmoney_daily_klines(&value, "CSI300").expect("daily klines");

        assert_eq!(candles.len(), 2);
        assert_eq!(candles[0].date.to_string(), "2026-07-02");
        assert!((candles[0].open - 4.955).abs() < 0.0001);
        assert!((candles[0].close - 4.850).abs() < 0.0001);
        assert!((candles[0].volume - 13_691_536.0).abs() < 0.1);
    }

    #[test]
    fn maps_china_exchange_symbols_to_eastmoney_secid() {
        let item = ProfileSymbol {
            symbol: "CSI300".to_string(),
            yahoo_symbol: Some("510300.SS".to_string()),
            stooq_symbol: None,
            fred_symbol: None,
            csv_path: None,
            label: "沪深300ETF".to_string(),
            role: Some("benchmark".to_string()),
            asset_kind: None,
            weight: Some(100.0),
            sector: None,
            style: None,
            exposure: None,
        };

        assert_eq!(eastmoney_secid_for_item(&item).as_deref(), Some("1.510300"));
        assert_eq!(sina_symbol_for_item(&item).as_deref(), Some("sh510300"));
    }

    #[test]
    fn parses_sina_daily_klines_in_ohlcv_order() {
        let value = serde_json::json!({
            "result": {
                "data": [
                    {"day":"2026-07-02","open":"4.955","high":"4.960","low":"4.835","close":"4.850","volume":"13691536"},
                    {"day":"2026-07-03","open":"4.830","high":"4.927","low":"4.828","close":"4.876","volume":"19983308"}
                ]
            }
        });
        let candles = parse_sina_daily_klines(&value, "CSI300").expect("daily klines");

        assert_eq!(candles.len(), 2);
        assert_eq!(candles[1].date.to_string(), "2026-07-03");
        assert!((candles[1].close - 4.876).abs() < 0.0001);
    }

    #[test]
    fn parses_fund_purchase_limit_and_redemption_status() {
        let status = parse_fund_transaction_status(
            r#"<div>交易状态：<span>限大额（单日累计购买上限10.00元）</span><span>开放赎回</span></div><div>购买手续费</div>"#,
        );

        assert_eq!(status.purchase_open, Some(true));
        assert_eq!(status.purchase_limit, Some(10.0));
        assert_eq!(status.redemption_open, Some(true));
        assert_eq!(status.label, "限购 ¥10/日 · 开放赎回");
    }

    #[test]
    fn parses_fund_purchase_limit_in_ten_thousands() {
        let status = parse_fund_transaction_status(
            "交易状态：限大额（单日累计购买上限5.00万元）开放赎回 购买手续费",
        );

        assert_eq!(status.purchase_limit, Some(50_000.0));
        assert_eq!(status.label, "限购 ¥5万/日 · 开放赎回");
    }

    #[test]
    fn parses_suspended_fund_purchase() {
        let status = parse_fund_transaction_status("交易状态：暂停申购 开放赎回 购买手续费");

        assert_eq!(status.purchase_open, Some(false));
        assert_eq!(status.purchase_limit, None);
        assert_eq!(status.label, "暂停申购 · 开放赎回");
    }

    #[test]
    fn parses_fund_top_holdings_snapshot() {
        let snapshot = parse_fund_top_holdings(
            r#"var apidata={ content:"<div>截止至：<font>2026-03-31</font></div><table><tbody>
              <tr><td>1</td><td><a>NVDA</a></td><td><a>英伟达</a></td><td>--</td><td>--</td><td>资讯</td><td>9.26%</td><td>26.50</td><td>31,983.16</td></tr>
              <tr><td>2</td><td><a>GOOGL</a></td><td><a>谷歌-A</a></td><td>--</td><td>--</td><td>资讯</td><td>8.06%</td><td>14.00</td><td>27,861.97</td></tr>
            </tbody></table>"};"#,
        );

        assert_eq!(snapshot.as_of.as_deref(), Some("2026-03-31"));
        assert_eq!(snapshot.holdings.len(), 2);
        assert_eq!(snapshot.holdings[0].symbol, "NVDA");
        assert_eq!(snapshot.holdings[0].name, "英伟达");
        assert_eq!(snapshot.holdings[0].weight, 9.26);
    }

    #[test]
    fn parses_fund_redemption_fee_schedule() {
        let tiers = parse_fund_redemption_fees(
            r#"<h4><label>赎回费率<a name="shfl"></a></label></h4><table><tbody>
              <tr><td>小于7天</td><td>1.50%</td></tr>
              <tr><td>大于等于7天，小于30天</td><td>0.50%</td></tr>
              <tr><td>大于等于30天</td><td>0.00%</td></tr>
            </tbody></table>"#,
        );

        assert_eq!(tiers.len(), 3);
        assert_eq!(tiers[0].min_days, Some(0));
        assert_eq!(tiers[0].max_days_exclusive, Some(7));
        assert_eq!(tiers[0].rate, 1.5);
        assert_eq!(tiers[1].min_days, Some(7));
        assert_eq!(tiers[1].max_days_exclusive, Some(30));
        assert_eq!(tiers[2].min_days, Some(30));
        assert_eq!(tiers[2].max_days_exclusive, None);
    }

    fn test_order_command_request(bridge: &str) -> OrderCommandRequest {
        OrderCommandRequest {
            bridge: bridge.to_string(),
            broker_mode: bridge.to_string(),
            order_id: Some("ord-test".to_string()),
            order_ref: None,
            current_status: None,
            symbol: "SPY".to_string(),
            name: "SPDR S&P 500 ETF".to_string(),
            side: "BUY".to_string(),
            quantity: "10".to_string(),
            limit: "500.00".to_string(),
            amount: "5000".to_string(),
            weight: "3%".to_string(),
            strategy: "risk-gated-trend".to_string(),
            platform: "local".to_string(),
            trade_type: "ETF".to_string(),
            risk_override: false,
            allow_live: None,
        }
    }

    #[test]
    fn validates_builtin_profile_config() {
        let report = validate_profile_config(BUILTIN_PROFILES[0].1);

        assert!(report.valid, "{:?}", report.errors);
        assert!(report.stats.symbols > 0);
        assert!(report.stats.rules > 0);
    }

    #[test]
    fn profile_v2_inherits_builtin_and_overrides_nested_calibration() {
        let profile = parse_profile(
            r#"{
              "schemaVersion": 2,
              "profileVersion": "2.0.1",
              "extends": "us-core",
              "key": "us-core-low-turnover",
              "name": "美股核心低换手",
              "calibration": {
                "hotStateHeatMin": 68,
                "divergenceTradingCap": 40
              },
              "calibrationMeta": {
                "method": "manual-baseline",
                "dataSignature": "test-fixture",
                "objective": "net return minus drawdown and turnover"
              }
            }"#,
            None,
        )
        .expect("profile inheritance");

        assert_eq!(profile.schema_version, 2);
        assert_eq!(profile.profile_version, "2.0.1");
        assert_eq!(profile.extends.as_deref(), Some("us-core"));
        assert_eq!(profile.market, "us");
        assert_eq!(profile.benchmark, "SPY");
        assert_eq!(profile.symbols.len(), 6);
        assert_eq!(profile.calibration.hot_state_heat_min, 68);
        assert_eq!(profile.calibration.divergence_trading_cap, 40);
        assert_eq!(profile.calibration.pullback_structure_min, 55);
        assert_eq!(profile.execution_policy.quote_warn_age_seconds, 30);
        assert_eq!(profile.execution_policy.etf_block_spread_bps, 100.0);
    }

    #[test]
    fn profile_v2_rejects_invalid_execution_threshold_order() {
        let report = validate_profile_config(
            r#"{
              "schemaVersion": 2,
              "profileVersion": "2.0.1",
              "extends": "us-core",
              "key": "invalid-execution-policy",
              "name": "Invalid execution policy",
              "executionPolicy": {
                "quoteWarnAgeSeconds": 180,
                "quoteBlockAgeSeconds": 120,
                "etfWarnSpreadBps": 120,
                "etfBlockSpreadBps": 100
              }
            }"#,
        );

        assert!(!report.valid);
        assert!(report
            .errors
            .iter()
            .any(|issue| issue.path == "executionPolicy.quoteWarnAgeSeconds"));
        assert!(report
            .errors
            .iter()
            .any(|issue| issue.path == "executionPolicy.etfWarnSpreadBps"));
    }

    #[test]
    fn profile_v2_rejects_unknown_parent() {
        let error = parse_profile(
            r#"{
              "schemaVersion": 2,
              "profileVersion": "2.0.0",
              "extends": "missing-parent",
              "key": "broken-child",
              "name": "Broken child"
            }"#,
            None,
        )
        .expect_err("unknown parent must fail");

        assert!(error.message.contains("unknown parent profile"));
    }

    #[test]
    fn historical_samples_are_clustered_by_event_spacing() {
        let samples = vec![0, 1, 4, 5, 6, 10]
            .into_iter()
            .map(|index| HistoricalStateSample {
                index,
                exact_state_match: true,
            })
            .collect();

        let clustered = cluster_historical_samples(samples, 5);

        assert_eq!(
            clustered
                .iter()
                .map(|sample| sample.index)
                .collect::<Vec<_>>(),
            vec![0, 5, 10]
        );
    }

    #[test]
    fn state_replay_samples_expose_real_relative_price_paths() {
        let candles = [100.0, 95.0, 105.0]
            .into_iter()
            .enumerate()
            .map(|(index, close)| Candle {
                date: NaiveDate::from_ymd_opt(2025, 1, index as u32 + 1).unwrap(),
                open: close,
                high: close,
                low: close,
                close,
                volume: 1.0,
                flow: None,
            })
            .collect::<Vec<_>>();
        let samples = vec![HistoricalStateSample {
            index: 0,
            exact_state_match: true,
        }];

        let replay = state_replay_samples(&candles, &samples, 2);

        assert_eq!(replay.len(), 1);
        assert_eq!(replay[0].date, "2025-01-01");
        assert!(replay[0].exact_state_match);
        assert_eq!(replay[0].path_returns_pct, vec![0.0, -5.0, 5.0]);
    }

    #[test]
    fn profile_validation_window_keeps_forward_horizon_out_of_training_period() {
        let mut profile = test_profile("validation-window");
        profile.calibration_meta.validation_start = Some("2025-01-01".to_string());
        profile.calibration_meta.validation_end = Some("2025-12-31".to_string());

        assert!(!profile_validation_sample_allowed(
            &profile,
            NaiveDate::from_ymd_opt(2024, 12, 31).unwrap(),
            NaiveDate::from_ymd_opt(2025, 3, 1).unwrap(),
        ));
        assert!(profile_validation_sample_allowed(
            &profile,
            NaiveDate::from_ymd_opt(2025, 2, 1).unwrap(),
            NaiveDate::from_ymd_opt(2025, 4, 1).unwrap(),
        ));
        assert!(!profile_validation_sample_allowed(
            &profile,
            NaiveDate::from_ymd_opt(2025, 11, 15).unwrap(),
            NaiveDate::from_ymd_opt(2026, 1, 15).unwrap(),
        ));
    }

    #[test]
    fn local_paper_order_commands_update_lifecycle() {
        let request = test_order_command_request("local-paper");

        let prepared = prepare_order(request.clone());
        assert!(prepared.accepted);
        assert!(!prepared.submitted);
        assert_eq!(prepared.status, "queued");
        assert_eq!(prepared.action, "prepareOrder");

        let submitted = submit_order(OrderCommandRequest {
            order_ref: Some(prepared.order_ref.clone()),
            ..request.clone()
        });
        assert!(submitted.accepted);
        assert!(submitted.submitted);
        assert_eq!(submitted.status, "submitted");
        assert_eq!(submitted.action, "submitOrder");
        assert_eq!(submitted.order_ref, prepared.order_ref);

        let cancelled = cancel_order(OrderCommandRequest {
            current_status: Some("submitted".to_string()),
            order_ref: Some(submitted.order_ref.clone()),
            ..request
        });
        assert!(cancelled.accepted);
        assert!(!cancelled.submitted);
        assert_eq!(cancelled.status, "cancelled");
        assert_eq!(cancelled.action, "cancelOrder");
        assert_eq!(cancelled.order_ref, submitted.order_ref);
    }

    #[test]
    fn local_paper_sync_preserves_current_status() {
        let result = sync_order_status(OrderCommandRequest {
            current_status: Some("prepared".to_string()),
            ..test_order_command_request("local-paper")
        });

        assert!(result.accepted);
        assert_eq!(result.status, "prepared");
        assert_eq!(result.action, "syncOrderStatus");
        assert_eq!(result.event_label, "状态同步");
    }

    #[test]
    fn local_paper_account_sync_returns_snapshot() {
        let snapshot = sync_account(BrokerAccountSyncRequest {
            bridge: "local-paper".to_string(),
            broker_mode: "local-paper".to_string(),
            platform: "local".to_string(),
            trade_type: "ETF".to_string(),
            strategy: "risk-gated-trend".to_string(),
            risk_override: false,
            allow_live: None,
        });

        assert!(snapshot.accepted);
        assert_eq!(snapshot.status, "synced");
        assert_eq!(snapshot.account_id, "local-paper");
        assert!(snapshot.positions.is_empty());
    }

    #[test]
    fn local_paper_market_quote_returns_reference_spread() {
        let quote = sync_market_quote(MarketQuoteRequest {
            bridge: "local-paper".to_string(),
            broker_mode: "local-paper".to_string(),
            symbol: "SPY".to_string(),
            name: "SPDR S&P 500 ETF".to_string(),
            market: "US".to_string(),
            asset_type: Some("etf".to_string()),
            reference_price: Some(500.0),
            platform: "local".to_string(),
            trade_type: "ETF".to_string(),
            strategy: "risk-gated-trend".to_string(),
            risk_override: false,
            allow_live: None,
        });

        assert!(quote.accepted);
        assert_eq!(quote.status, "synced");
        assert_eq!(quote.symbol, "SPY");
        assert_eq!(quote.bid, Some(499.5));
        assert_eq!(quote.ask, Some(500.5));
        assert_eq!(quote.last, Some(500.0));
    }

    #[test]
    fn price_bars_by_symbol_respects_report_index_window() {
        let profile = test_profile("price-bars-window");
        let candles = synthetic_candles(&[(0, 100.0), (1, 101.0), (2, 102.0), (3, 103.0)]);
        let mut series = HashMap::new();
        series.insert("SPY".to_string(), candles.clone());
        series.insert("SMH".to_string(), candles.clone());
        series.insert("NVDA".to_string(), candles);
        let indexes = HashMap::from([
            ("SPY".to_string(), 2_usize),
            ("SMH".to_string(), 2_usize),
            ("NVDA".to_string(), 2_usize),
        ]);

        let bars = price_bars_by_symbol(&profile, &series, &indexes, 2);
        let spy = bars.get("SPY").expect("SPY bars");

        assert_eq!(spy.len(), 2);
        assert_eq!(spy[0].date, "2025-01-02");
        assert_eq!(spy[1].date, "2025-01-03");
        assert_eq!(spy[1].close, 102.0);
        assert!(spy.iter().all(|bar| bar.date != "2025-01-04"));
    }

    #[test]
    fn orders_storage_roundtrips_snapshot() {
        let path = temp_order_store_path("roundtrip");
        let orders = vec![
            serde_json::json!({"id": "ord-1", "symbol": "SPY", "status": "queued"}),
            serde_json::json!("ignore-me"),
            serde_json::json!({"id": "ord-2", "symbol": "QQQ", "status": "submitted"}),
        ];

        let saved = save_orders_to_path(&path, orders).expect("save orders");
        let loaded = load_orders_from_path(&path).expect("load orders");
        let _ = fs::remove_file(&path);

        assert_eq!(saved.len(), 2);
        assert_eq!(loaded.len(), 2);
        assert_eq!(loaded[0]["id"], "ord-1");
        assert_eq!(loaded[1]["status"], "submitted");
    }

    #[test]
    fn orders_storage_reads_legacy_array() {
        let path = temp_order_store_path("legacy");
        fs::write(
            &path,
            r#"[{"id":"legacy-1","symbol":"SPY"},{"id":"legacy-2","symbol":"QQQ"}]"#,
        )
        .expect("write legacy orders");

        let loaded = load_orders_from_path(&path).expect("load legacy orders");
        let _ = fs::remove_file(&path);

        assert_eq!(loaded.len(), 2);
        assert_eq!(loaded[0]["id"], "legacy-1");
    }

    #[test]
    fn recommendation_storage_roundtrips_auditable_records() {
        let path = temp_order_store_path("recommendation-roundtrip");
        let records = vec![
            serde_json::json!({
                "id": "rec-1",
                "schemaVersion": 1,
                "profileKey": "us-core",
                "profileVersion": "2.0.0-manual-baseline",
                "symbol": "SPY",
                "side": "BUY",
                "outcome": { "status": "pending" }
            }),
            serde_json::json!("ignore-me"),
        ];

        let saved = save_recommendations_to_path(&path, records).expect("save recommendations");
        let loaded = load_recommendations_from_path(&path).expect("load recommendations");
        let _ = fs::remove_file(&path);

        assert_eq!(saved.len(), 1);
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0]["id"], "rec-1");
        assert_eq!(loaded[0]["outcome"]["status"], "pending");
    }

    #[test]
    fn recommendation_outcomes_are_evaluated_at_trading_day_horizons() {
        let path = temp_order_store_path("recommendation-evaluation");
        let profile = test_profile("evaluation-profile");
        let candles = sample_equity_series(100.0, 0.2, 0.01, 0.0, 1_000_000.0, 4.0);
        let anchor_index = candles.len() - 61;
        let anchor_date = candles[anchor_index].date;
        let anchor_close = candles[anchor_index].close;
        let mut series = HashMap::new();
        series.insert("SPY".to_string(), candles);
        let pending_outcomes = || {
            [5, 20, 60]
                .into_iter()
                .map(|horizon| {
                    serde_json::json!({
                        "status": "pending",
                        "horizonDays": horizon
                    })
                })
                .collect::<Vec<_>>()
        };
        save_recommendations_to_path(
            &path,
            vec![
                serde_json::json!({
                    "id": "rec-evaluate-1",
                    "schemaVersion": 2,
                    "profileKey": "evaluation-profile",
                    "symbol": "SPY",
                    "side": "BUY",
                    "priority": "P1",
                    "marketState": "healthy_trend",
                    "asOf": anchor_date.to_string(),
                    "referencePrice": anchor_close,
                    "outcomes": pending_outcomes()
                }),
                serde_json::json!({
                    "id": "rec-evaluate-2",
                    "schemaVersion": 2,
                    "profileKey": "evaluation-profile",
                    "symbol": "SPY",
                    "side": "BUY",
                    "priority": "P1",
                    "marketState": "healthy_trend",
                    "asOf": anchor_date.to_string(),
                    "referencePrice": anchor_close,
                    "outcomes": pending_outcomes()
                }),
            ],
        )
        .expect("save pending recommendation");

        evaluate_recommendation_records(&path, &profile, &series, None)
            .expect("evaluate recommendations");
        let loaded = load_recommendations_from_path(&path).expect("load evaluated recommendations");
        let evaluated = loaded[0]["outcomes"].as_array().expect("outcomes array");
        assert_eq!(evaluated.len(), 3);
        assert!(evaluated
            .iter()
            .all(|outcome| outcome["status"] == "evaluated"));
        assert_eq!(evaluated[2]["horizonDays"], 60);
        assert!(evaluated[2]["evaluationPrice"].as_f64().is_some());
        assert!(evaluated[2]["signedReturnPct"].as_f64().is_some());

        let performance = recommendation_performance_for(&path, "evaluation-profile")
            .expect("aggregate recommendation performance");
        let _ = fs::remove_file(&path);

        assert_eq!(performance.evaluated_records, 2);
        assert_eq!(performance.raw_evaluated_outcomes, 6);
        assert_eq!(performance.effective_evaluated_outcomes, 3);
        assert_eq!(performance.horizons.len(), 3);
        assert_eq!(performance.market_states[0].label, "健康趋势");
        assert_eq!(performance.priorities[0].key, "P1");
        assert_eq!(performance.priorities[0].sample_count, 3);
    }

    #[test]
    fn waiting_decision_counts_rising_price_as_opportunity_cost() {
        let path = temp_order_store_path("recommendation-wait-evaluation");
        let profile = test_profile("wait-evaluation-profile");
        let candles = sample_equity_series(100.0, 0.35, 0.01, 0.0, 1_000_000.0, 4.0);
        let anchor_index = candles.len() - 21;
        let anchor_date = candles[anchor_index].date;
        let anchor_close = candles[anchor_index].close;
        let mut series = HashMap::new();
        series.insert("SPY".to_string(), candles);
        save_recommendations_to_path(
            &path,
            vec![serde_json::json!({
                "id": "rec-wait-1",
                "schemaVersion": 2,
                "profileKey": "wait-evaluation-profile",
                "symbol": "SPY",
                "side": "WAIT",
                "decisionType": "wait",
                "marketState": "healthy_trend",
                "asOf": anchor_date.to_string(),
                "referencePrice": anchor_close,
                "outcomes": [{
                    "status": "pending",
                    "horizonDays": 20
                }]
            })],
        )
        .expect("save waiting recommendation");

        evaluate_recommendation_records(&path, &profile, &series, None)
            .expect("evaluate waiting recommendation");
        let loaded = load_recommendations_from_path(&path).expect("load waiting recommendation");
        let outcome = &loaded[0]["outcomes"][0];
        let _ = fs::remove_file(&path);

        assert!(outcome["returnPct"].as_f64().unwrap_or_default() > 0.0);
        assert!(outcome["signedReturnPct"].as_f64().unwrap_or_default() < 0.0);
        assert_eq!(outcome["wasCorrect"], false);
    }

    #[test]
    fn calibration_action_keeps_parameters_when_real_sample_is_small() {
        let profile = test_profile("calibration-action-small-sample");
        let performance = RecommendationPerformanceSummary {
            profile_key: profile.key.clone(),
            horizons: vec![test_performance_slice("20", "20 日", 8, 50.0, 0.4)],
            ..RecommendationPerformanceSummary::default()
        };

        let action = calibration_action_for(&profile, &performance);

        assert_eq!(action.key, "collect");
        assert!(action.proposals.is_empty());
        assert!(action.action.contains("再积累 12 个"));
    }

    #[test]
    fn calibration_action_proposes_specific_tightening_for_weak_buy_samples() {
        let profile = test_profile("calibration-action-weak-buy");
        let performance = RecommendationPerformanceSummary {
            profile_key: profile.key.clone(),
            horizons: vec![test_performance_slice("20", "20 日", 24, 41.0, -0.8)],
            directions: vec![test_performance_slice("BUY", "增加风险", 20, 40.0, -1.1)],
            market_states: vec![test_performance_slice(
                "risk_diffusion_watch",
                "风险扩散",
                14,
                35.0,
                -1.5,
            )],
            ..RecommendationPerformanceSummary::default()
        };

        let action = calibration_action_for(&profile, &performance);

        assert_eq!(action.key, "candidate");
        assert!(action
            .proposals
            .iter()
            .any(|item| item.path == "calibration.expansionStructureMin"));
        assert!(action
            .proposals
            .iter()
            .any(|item| item.path == "calibration.divergenceTradingCap"));
        assert!(action.action.contains("walk-forward"));
    }

    #[test]
    fn monitor_storage_roundtrips_state() {
        let path = temp_order_store_path("monitor-roundtrip");
        let state = serde_json::json!({
            "snapshot": {
                "key": "profile-state-1",
                "profileKey": "us-core",
                "profileName": "美股核心风险"
            },
            "records": [
                {"key": "record-1", "summary": "建立基线"},
                "ignore-me",
                {"key": "record-2", "summary": "状态稳定"}
            ]
        });

        let saved = save_monitor_state_to_path(&path, state).expect("save monitor");
        let loaded = load_monitor_state_from_path(&path).expect("load monitor");
        let _ = fs::remove_file(&path);

        assert_eq!(saved["snapshot"]["key"], "profile-state-1");
        assert_eq!(saved["records"].as_array().unwrap().len(), 2);
        assert_eq!(loaded["snapshot"]["profileKey"], "us-core");
        assert_eq!(loaded["records"][1]["key"], "record-2");
    }

    #[test]
    fn monitor_storage_reads_legacy_snapshot() {
        let path = temp_order_store_path("monitor-legacy");
        fs::write(
            &path,
            r#"{"key":"legacy-monitor","profileKey":"us-core","profileName":"美股核心风险"}"#,
        )
        .expect("write legacy monitor");

        let loaded = load_monitor_state_from_path(&path).expect("load monitor legacy");
        let _ = fs::remove_file(&path);

        assert_eq!(loaded["snapshot"]["key"], "legacy-monitor");
        assert_eq!(loaded["records"].as_array().unwrap().len(), 0);
    }

    #[test]
    fn paper_sim_storage_roundtrips_state() {
        let path = temp_order_store_path("paper-sim-roundtrip");
        let state = serde_json::json!({
            "active": true,
            "accountId": "paper-us-core",
            "experimentName": "美股核心风险 · 趋势",
            "profileKey": "us-core",
            "profileName": "美股核心风险",
            "currency": "USD",
            "initialCapital": 100000.0,
            "cash": 25000.0,
            "positions": [
                {"symbol": "SPY", "quantity": 10, "lastPrice": 500},
                "ignore-me"
            ],
            "pendingFundOrders": [
                {"id": "pfund-1", "symbol": "016702", "side": "BUY", "confirmDate": "2026-06-23"}
            ],
            "trades": [
                {"id": "ptrade-1", "symbol": "SPY", "side": "BUY"}
            ],
            "snapshots": [
                {"id": "psnap-1", "runDate": "2026-06-22", "equity": 100500}
            ]
        });

        let saved = save_paper_sim_to_path(&path, state).expect("save paper sim");
        let loaded = load_paper_sim_from_path(&path).expect("load paper sim");
        let _ = fs::remove_file(&path);

        assert_eq!(saved["active"], true);
        assert_eq!(saved["positions"].as_array().unwrap().len(), 1);
        assert_eq!(loaded["accountId"], "paper-us-core");
        assert_eq!(loaded["pendingFundOrders"][0]["id"], "pfund-1");
        assert_eq!(loaded["trades"][0]["id"], "ptrade-1");
        assert_eq!(loaded["snapshots"][0]["runDate"], "2026-06-22");
    }

    #[test]
    fn risk_policy_storage_roundtrips_normalized_policy() {
        let path = temp_order_store_path("risk-policy-roundtrip");
        let policy = serde_json::json!({
            "maxDailyOrders": 500,
            "cooldownMinutes": 15,
            "requireLiveConfirmation": false,
            "singleOrderCaps": {
                "etfPct": 6,
                "fundPct": 4.5,
                "leveragedEtfPct": 2,
                "stockPct": 3.5
            },
            "lossBrake": {
                "etfDailyDropWarnPct": 5,
                "etfDailyDropBlockPct": 8,
                "leveragedEtfDailyDropBlockPct": 3,
                "portfolioDailyLossPct": 4
            },
            "updatedAt": "2026-06-19T00:00:00Z"
        });

        let saved = save_risk_policy_to_path(&path, policy).expect("save risk policy");
        let loaded = load_risk_policy_from_path(&path).expect("load risk policy");
        let _ = fs::remove_file(&path);

        assert_eq!(saved["version"].as_i64(), Some(2));
        assert_eq!(saved["maxDailyOrders"].as_i64(), Some(200));
        assert_eq!(loaded["singleOrderCaps"]["etfPct"].as_f64(), Some(6.0));
        assert_eq!(loaded["requireLiveConfirmation"].as_bool(), Some(false));
    }

    #[test]
    fn exports_order_audit_json_snapshot() {
        let orders_path = temp_order_store_path("audit-json-orders");
        let export_dir = temp_order_export_dir("json");
        save_orders_to_path(&orders_path, test_audit_orders()).expect("save audit orders");

        let result = export_order_audit_from_paths(
            &orders_path,
            &export_dir,
            OrderAuditExportRequest {
                format: Some("json".to_string()),
            },
        )
        .expect("export json audit");
        let content = fs::read_to_string(&result.path).expect("audit json file");
        let _ = fs::remove_file(&orders_path);
        let _ = fs::remove_file(&result.path);
        let _ = fs::remove_dir(&export_dir);

        assert_eq!(result.format, "json");
        assert_eq!(result.orders, 2);
        assert_eq!(result.events, 2);
        assert!(content.contains("\"orders\""));
        assert!(content.contains("ord-audit-1"));
    }

    #[test]
    fn exports_order_audit_json_with_risk_policy_snapshot() {
        let orders_path = temp_order_store_path("audit-risk-orders");
        let risk_policy_path = temp_order_store_path("audit-risk-policy");
        let export_dir = temp_order_export_dir("risk-json");
        save_orders_to_path(&orders_path, test_audit_orders()).expect("save audit orders");
        save_risk_policy_to_path(
            &risk_policy_path,
            serde_json::json!({
                "maxDailyOrders": 6,
                "cooldownMinutes": 45,
                "updatedAt": "2026-06-19T00:00:00Z"
            }),
        )
        .expect("save risk policy");

        let result = export_order_audit_from_paths_with_policy(
            &orders_path,
            Some(&risk_policy_path),
            &export_dir,
            OrderAuditExportRequest {
                format: Some("json".to_string()),
            },
        )
        .expect("export json audit with policy");
        let content = fs::read_to_string(&result.path).expect("audit json file");
        let payload: Value = serde_json::from_str(&content).expect("audit json parse");
        let _ = fs::remove_file(&orders_path);
        let _ = fs::remove_file(&risk_policy_path);
        let _ = fs::remove_file(&result.path);
        let _ = fs::remove_dir(&export_dir);

        assert_eq!(payload["riskPolicy"]["maxDailyOrders"].as_i64(), Some(6));
        assert_eq!(
            payload["riskPolicy"]["cooldownMinutes"].as_f64(),
            Some(45.0)
        );
    }

    #[test]
    fn exports_order_audit_csv_events() {
        let orders_path = temp_order_store_path("audit-csv-orders");
        let export_dir = temp_order_export_dir("csv");
        save_orders_to_path(&orders_path, test_audit_orders()).expect("save audit orders");

        let result = export_order_audit_from_paths(
            &orders_path,
            &export_dir,
            OrderAuditExportRequest {
                format: Some("csv".to_string()),
            },
        )
        .expect("export csv audit");
        let content = fs::read_to_string(&result.path).expect("audit csv file");
        let _ = fs::remove_file(&orders_path);
        let _ = fs::remove_file(&result.path);
        let _ = fs::remove_dir(&export_dir);

        assert_eq!(result.format, "csv");
        assert_eq!(result.orders, 2);
        assert_eq!(result.events, 2);
        assert!(content.contains("order_id,intent_key,symbol"));
        assert!(content.contains("ord-audit-1"));
        assert!(content.contains("evt-1"));
    }

    #[test]
    fn parses_adapter_response_from_json_stdout() {
        let response = parse_adapter_response(
            r#"{"accepted":true,"submitted":true,"status":"submitted","orderRef":"VNPY.1","message":"ok","eventLabel":"已提交"}"#,
        )
        .expect("adapter json");

        assert!(response.accepted);
        assert!(response.submitted);
        assert_eq!(response.status, "submitted");
        assert_eq!(response.order_ref, "VNPY.1");
    }

    #[test]
    fn parses_adapter_response_from_last_json_line() {
        let response = parse_adapter_response(
            "gateway log line\n{\"accepted\":false,\"status\":\"adapter_error\",\"message\":\"bad\"}",
        )
        .expect("adapter json line");

        assert!(!response.accepted);
        assert_eq!(response.status, "adapter_error");
        assert_eq!(response.message, "bad");
    }

    #[test]
    fn parses_account_snapshot_from_json_stdout() {
        let snapshot = parse_account_snapshot(
            "log\n{\"accepted\":true,\"status\":\"synced\",\"accountId\":\"ACC-1\",\"cash\":1200,\"positions\":[{\"symbol\":\"SPY\"}],\"orders\":[{\"vtOrderId\":\"VNPY.1\"}],\"trades\":[]}",
        )
        .expect("account snapshot json line");

        assert!(snapshot.accepted);
        assert_eq!(snapshot.status, "synced");
        assert_eq!(snapshot.account_id, "ACC-1");
        assert_eq!(snapshot.positions.len(), 1);
        assert_eq!(snapshot.orders.len(), 1);
    }

    #[test]
    fn parses_market_quote_from_json_stdout() {
        let quote = parse_market_quote_snapshot(
            "log\n{\"accepted\":true,\"status\":\"synced\",\"symbol\":\"SPY\",\"bid\":499.8,\"ask\":500.2,\"last\":500,\"indicativeNav\":499.9,\"premiumDiscountPct\":0.02,\"session\":\"open\",\"source\":\"adapter\"}",
        )
        .expect("market quote json line");

        assert!(quote.accepted);
        assert_eq!(quote.status, "synced");
        assert_eq!(quote.symbol, "SPY");
        assert_eq!(quote.bid, Some(499.8));
        assert_eq!(quote.ask, Some(500.2));
        assert_eq!(quote.indicative_nav, Some(499.9));
        assert_eq!(quote.session, "open");
    }

    #[test]
    fn parses_yahoo_realtime_quote_snapshot() {
        let value: Value = serde_json::from_str(
            r#"{
              "chart": {
                "result": [{
                  "meta": {
                    "regularMarketPrice": 101.2,
                    "regularMarketPreviousClose": 100.0,
                    "marketState": "REGULAR"
                  },
                  "timestamp": [1719000000, 1719000060, 1719000120],
                  "indicators": {
                    "quote": [{
                      "open": [100.4, 100.8, 101.0],
                      "high": [100.9, 101.1, 101.3],
                      "low": [100.1, 100.7, 100.9],
                      "close": [100.7, 101.0, 101.2],
                      "volume": [1200, 1500, 1800]
                    }]
                  }
                }],
                "error": null
              }
            }"#,
        )
        .expect("json");
        let request = RealtimeAssetQuoteRequest {
            symbol: "QQQ".to_string(),
            name: "Nasdaq 100".to_string(),
            market: "US".to_string(),
            reference_price: Some(100.0),
        };
        let quote = parse_yahoo_realtime_quote(&value, &request, "QQQ", "QQQ").expect("quote");

        assert!(quote.accepted);
        assert_eq!(quote.source, "yahoo-chart");
        assert_eq!(quote.last, Some(101.2));
        assert!((quote.change_pct.unwrap_or_default() - 1.2).abs() < 0.0001);
        assert_eq!(quote.volume, Some(4500.0));
        assert_eq!(quote.points.len(), 3);
        assert!(quote.bid.is_some());
        assert!(quote.ask.is_some());
    }

    #[test]
    fn realtime_quote_falls_back_to_reference_price() {
        let quote = fallback_realtime_asset_quote(
            RealtimeAssetQuoteRequest {
                symbol: "019305".to_string(),
                name: "标普500基金".to_string(),
                market: "CN".to_string(),
                reference_price: Some(3.33),
            },
            "offline",
        );

        assert!(!quote.accepted);
        assert_eq!(quote.status, "fallback");
        assert_eq!(quote.last, Some(3.33));
        assert!(!quote.points.is_empty());
    }

    #[test]
    fn unsupported_order_bridge_fails_without_submission() {
        let result = submit_order(OrderCommandRequest {
            allow_live: Some(true),
            ..test_order_command_request("unknown-live-bridge")
        });

        assert!(!result.accepted);
        assert!(!result.submitted);
        assert_eq!(result.status, "missing_bridge");
        assert_eq!(result.event_label, "通道缺失");
    }

    fn temp_order_store_path(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "rportfolio-orders-{label}-{}-{}.json",
            std::process::id(),
            Utc::now().timestamp_millis()
        ))
    }

    fn temp_order_export_dir(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "rportfolio-order-audit-{label}-{}-{}",
            std::process::id(),
            Utc::now().timestamp_millis()
        ))
    }

    fn test_audit_orders() -> Vec<Value> {
        vec![
            serde_json::json!({
                "id": "ord-audit-1",
                "intentKey": "intent-1",
                "symbol": "SPY",
                "name": "SPY ETF",
                "side": "BUY",
                "status": "submitted",
                "routeStatus": "submitted",
                "broker": "local-paper",
                "route": "本地模拟",
                "orderRef": "paper-1",
                "sourceKind": "strategy",
                "sourceLabel": "策略建议",
                "amount": "5000",
                "weight": "3%",
                "quantity": "10",
                "limit": "500",
                "events": [
                    {
                        "key": "evt-1",
                        "at": "2026-06-19T00:00:00Z",
                        "time": "08:00:00",
                        "type": "submitted",
                        "status": "submitted",
                        "label": "已提交",
                        "detail": "paper submitted"
                    },
                    {
                        "key": "evt-2",
                        "at": "2026-06-19T00:01:00Z",
                        "time": "08:01:00",
                        "type": "queued",
                        "status": "queued",
                        "label": "进入队列",
                        "detail": "created"
                    }
                ]
            }),
            serde_json::json!({
                "id": "ord-audit-2",
                "symbol": "QQQ",
                "status": "queued",
                "events": []
            }),
        ]
    }

    #[test]
    fn profile_validation_reports_unknown_rule_symbol() {
        let report = validate_profile_config(
            r#"{
              "key": "bad-profile",
              "name": "Bad Profile",
              "market": "us",
              "benchmark": "SPY",
              "symbols": [
                { "symbol": "SPY", "label": "SPY", "role": "benchmark", "weight": 100 }
              ],
              "technicalColumns": [],
              "dimensions": [
                {
                  "key": "trend",
                  "label": "Trend",
                  "factor": "trend",
                  "weight": 100,
                  "rules": [
                    { "type": "close_below_ma", "symbol": "QQQ", "period": 50, "points": 10, "reason": "QQQ break" }
                  ]
                }
              ]
            }"#,
        );

        assert!(!report.valid);
        assert!(report
            .errors
            .iter()
            .any(|issue| issue.message.contains("unknown symbol 'QQQ'")));
    }

    #[test]
    fn profile_validation_reports_invalid_fund_holding_date() {
        let report = validate_profile_config(
            r#"{
              "key": "fund-profile",
              "name": "Fund Profile",
              "market": "us",
              "benchmark": "SPY",
              "fund": {
                "code": "FUND-1",
                "name": "Example Fund",
                "fundType": "active_equity",
                "holdingsAsOf": "2026/03/31",
                "holdingsSource": "quarterly_report"
              },
              "symbols": [
                { "symbol": "SPY", "label": "SPY", "role": "benchmark", "weight": 100 }
              ],
              "technicalColumns": [],
              "dimensions": [
                {
                  "key": "trend",
                  "label": "Trend",
                  "factor": "trend",
                  "weight": 100,
                  "rules": [
                    { "type": "close_below_ma", "symbol": "SPY", "period": 50, "points": 10, "reason": "SPY break" }
                  ]
                }
              ]
            }"#,
        );

        assert!(!report.valid);
        assert!(report
            .errors
            .iter()
            .any(|issue| issue.path == "fund.holdingsAsOf"));
    }

    #[test]
    fn detects_confirmed_head_shoulders_top() {
        let candles = synthetic_candles(&[
            (0, 90.0),
            (30, 116.0),
            (42, 104.0),
            (60, 128.0),
            (74, 103.0),
            (92, 116.0),
            (112, 99.0),
        ]);
        let symbol = test_symbol("SPY", "大盘");
        let patterns = detect_chart_patterns(&symbol, &candles, candles.len() - 1);

        assert!(patterns.iter().any(|pattern| {
            pattern.label == "头肩顶"
                && pattern.status == "confirmed"
                && pattern.direction == "bearish"
        }));
    }

    #[test]
    fn detects_confirmed_head_shoulders_bottom() {
        let candles = synthetic_candles(&[
            (0, 130.0),
            (30, 104.0),
            (42, 116.0),
            (60, 92.0),
            (74, 117.0),
            (92, 104.0),
            (112, 123.0),
        ]);
        let symbol = test_symbol("QQQ", "科技");
        let patterns = detect_chart_patterns(&symbol, &candles, candles.len() - 1);

        assert!(patterns.iter().any(|pattern| {
            pattern.label == "头肩底"
                && pattern.status == "confirmed"
                && pattern.direction == "bullish"
        }));
    }

    #[test]
    fn decision_frame_marks_breakdown_as_broken_protocol() {
        let frame = decision_frame_for(
            &test_market_state("trend_breakdown"),
            &test_factors(32, 28, 24, 18, 12),
            &test_opportunities(72),
            &test_position_advice("重新站回 MA20 后再评估。"),
            &test_structure("跌破 MA50 4.83 且无法快速收复"),
            0,
            &ProfileCopyConfig::default(),
        );

        assert_eq!(frame.protocol_state, "broken");
        assert_eq!(frame.permission, "停止加仓");
        assert_eq!(frame.condition_label, "修复条件");
        assert!(frame.condition.contains("重新站回 MA50 4.83"));
        assert!(!frame.condition.contains("无法快速收复"));
    }

    #[test]
    fn decision_frame_marks_confirmed_pullback_as_probe_protocol() {
        let frame = decision_frame_for(
            &test_market_state("strong_trend_pullback_watch"),
            &test_factors(88, 74, 24, 22, 42),
            &test_opportunities(68),
            &test_position_advice("基准回踩 MA20 不破，且弱确认资产重新站回 MA20。"),
            &test_structure("跌破 MA50 346.63 且无法快速收复"),
            24,
            &ProfileCopyConfig::default(),
        );

        assert_eq!(frame.protocol_state, "probe");
        assert_eq!(frame.permission, "小仓试探");
        assert_eq!(frame.condition_label, "试探条件");
        assert_eq!(
            frame.condition,
            "基准回踩 MA20 不破，且弱确认资产重新站回 MA20。"
        );
    }

    #[test]
    fn decision_frame_marks_risk_diffusion_as_waiting_not_no_chase() {
        let frame = decision_frame_for(
            &test_market_state("risk_diffusion_watch"),
            &test_factors(76, 48, 28, 22, 58),
            &test_opportunities(34),
            &test_position_advice("上涨家数回到 50% 以上。"),
            &test_structure("Breadth Collapse 继续恶化。"),
            40,
            &ProfileCopyConfig::default(),
        );

        assert_eq!(frame.protocol_state, "observe");
        assert_eq!(frame.permission, "等待确认");
        assert_eq!(frame.condition_label, "确认条件");
    }

    #[test]
    fn market_state_downgrades_to_risk_diffusion_watch() {
        let factors = test_factors(82, 72, 55, 20, 35);
        let internals = test_market_internals(&[
            ("breadth_collapse", "negative", "Breadth Collapse"),
            (
                "relative_weakness_expansion",
                "caution",
                "Relative Weakness",
            ),
        ]);
        let state = market_state_for_with_context(
            &ProfileCalibration::default(),
            &factors,
            None,
            &internals,
        );

        assert_eq!(state.key, "risk_diffusion_watch");
        assert_eq!(state.label, "风险扩散观察");
    }

    #[test]
    fn market_state_escalates_severe_diffusion_to_breakdown() {
        let factors = test_factors(70, 46, 68, 34, 42);
        let internals = test_market_internals(&[
            ("breadth_collapse", "negative", "Breadth Collapse"),
            (
                "relative_weakness_expansion",
                "negative",
                "Relative Weakness",
            ),
        ]);
        let state = market_state_for_with_context(
            &ProfileCalibration::default(),
            &factors,
            None,
            &internals,
        );

        assert_eq!(state.key, "risk_diffusion_breakdown");
        assert_eq!(state.label, "风险扩散破位");
    }

    #[test]
    fn decision_frame_marks_severe_diffusion_as_only_reduce() {
        let frame = decision_frame_for(
            &test_market_state("risk_diffusion_breakdown"),
            &test_factors(62, 42, 68, 45, 40),
            &test_opportunities(58),
            &test_position_advice("广度和核心资产至少修复两项。"),
            &test_structure("核心标的跌破 MA50 且无法快速收复"),
            60,
            &ProfileCopyConfig::default(),
        );

        assert_eq!(frame.protocol_state, "observe");
        assert_eq!(frame.permission, "停止加仓");
        assert_eq!(frame.condition_label, "确认条件");
    }

    #[test]
    fn position_advice_haircuts_diffusion_when_market_damage_is_high() {
        let profile = test_profile("ai-semiconductor");
        let state = test_market_state("risk_diffusion_watch");
        let advice = position_advice_for(
            &profile,
            &state,
            &test_factors(60, 35, 50, 42, 40),
            &test_structure("核心标的跌破 MA50 且无法快速收复"),
            &test_pattern_analysis(),
            Some(&test_leader_confirmation(true)),
            &[],
        );

        let long = advice
            .iter()
            .find(|item| item.horizon_key == "long")
            .expect("long horizon");
        assert_eq!(long.target_position, "45%~55%");
        assert!(long.damage_score >= 65);
        assert!(long.range_note.contains("裁剪"));
        assert!(long.range_meaning.contains("不是立即买入建议"));
        assert_eq!(long.current_range.as_ref().unwrap().display, "45%~55%");
        assert_eq!(long.max_cap, Some(55));
        assert!(long.gates.iter().all(|gate| !gate.effect.is_empty()));
        assert!(long
            .gates
            .iter()
            .all(|gate| gate.triggered == (gate.status != "pass")));
    }

    #[test]
    fn position_advice_exposes_signed_add_range() {
        let advice = make_position_advice(
            "short",
            "短期",
            "降仓防守",
            "-15%~-25%",
            "0%~20%",
            "defensive",
            "test",
            "test",
            "test",
        );

        let add_range = advice.add_range.expect("add range");
        assert_eq!(add_range.min, -25);
        assert_eq!(add_range.max, -15);
        assert_eq!(add_range.display, "-25%~-15%");
        assert_eq!(advice.current_range.unwrap().display, "0%~20%");
        assert_eq!(advice.max_cap, Some(20));
    }

    #[test]
    fn validates_all_builtin_profiles() {
        for (key, content) in BUILTIN_PROFILES {
            let report = validate_profile_config(content);
            assert!(report.valid, "{key} should be valid: {:?}", report.errors);
        }
    }

    #[test]
    fn rejects_invalid_asset_kind() {
        let report = validate_profile_config(
            r#"{
              "key": "bad-kind",
              "name": "Bad Kind",
              "market": "us",
              "benchmark": "SPY",
              "symbols": [
                { "symbol": "SPY", "label": "SPY", "assetKind": "watcher", "weight": 100 }
              ],
              "technicalColumns": [],
              "dimensions": [
                { "key": "trend", "label": "Trend", "weight": 100, "rules": [] }
              ]
            }"#,
        );

        assert!(!report.valid);
        assert!(report
            .errors
            .iter()
            .any(|issue| issue.path == "symbols[0].assetKind"));
    }

    #[test]
    fn observer_and_proxy_assets_do_not_enter_portfolio_health() {
        let profile: AnalysisProfile = serde_json::from_value(serde_json::json!({
            "key": "asset-kind-test",
            "name": "Asset Kind Test",
            "market": "us",
            "benchmark": "SPY",
            "symbols": [
                { "symbol": "SPY", "label": "SPY", "assetKind": "holding", "weight": 60 },
                { "symbol": "VIX", "label": "VIX", "role": "volatility", "assetKind": "observer", "weight": 20 },
                { "symbol": "QQQ_PROXY", "label": "QQQ Proxy", "assetKind": "proxy", "weight": 40 }
            ],
            "technicalColumns": [],
            "dimensions": []
        }))
        .expect("valid profile");
        let loaded = load_sample_data(&profile, "sample", "sample");
        let snapshots = profile
            .symbols
            .iter()
            .map(|symbol| {
                let candles = loaded.series.get(&symbol.symbol).unwrap();
                (
                    symbol.symbol.clone(),
                    snapshot_at(candles, candles.len() - 1),
                )
            })
            .collect::<HashMap<_, _>>();
        let portfolio = portfolio_profile_for(&profile, &snapshots, 40);

        assert_eq!(portfolio.holdings.len(), 1);
        assert_eq!(portfolio.holdings[0].symbol, "SPY");
        assert_eq!(portfolio.holdings[0].asset_kind, "holding");
    }

    #[test]
    fn account_storage_migrates_legacy_cash_fields() {
        let path = test_holdings_path("accounts-migration");
        fs::write(
            &path,
            r#"{
              "version": 1,
              "accounts": [{"id":"legacy-cn","name":"人民币账户","currency":"CNY","cash":12000}],
              "snapshots": []
            }"#,
        )
        .expect("write legacy accounts");

        let loaded = load_accounts_from_path(&path).expect("load accounts");
        let saved = save_accounts_to_path(&path, loaded).expect("save accounts");
        let _ = fs::remove_file(&path);

        assert_eq!(saved.version, ACCOUNT_STORE_VERSION);
        assert_eq!(saved.accounts.len(), 1);
        assert_eq!(saved.accounts[0]["settledCash"], 12_000.0);
        assert_eq!(saved.accounts[0]["availableCash"], 12_000.0);
        assert_eq!(saved.accounts[0]["pendingSettlement"], 0.0);
        assert!(saved.accounts[0].get("cash").is_none());
    }

    #[test]
    fn performance_ledger_storage_roundtrips_and_validates_currency() {
        let path = test_holdings_path("performance-ledger-roundtrip");
        let snapshot = PerformanceLedgerSnapshot {
            version: 99,
            updated_at: "2026-07-16T10:00:00Z".to_string(),
            snapshots: vec![serde_json::json!({
                "id": "performance-2026-07-16",
                "date": "2026-07-16",
                "baseCurrency": "CNY",
                "portfolioValue": 120000.0,
                "note": "private portfolio note"
            })],
            cash_flows: vec![serde_json::json!({
                "id": "cash-flow-1",
                "date": "2026-07-16",
                "kind": "deposit",
                "currency": "USD",
                "baseCurrency": "CNY",
                "baseAmount": 7100.0
            })],
        };

        let saved = save_performance_ledger_to_path(&path, snapshot).expect("save ledger");
        let loaded = load_performance_ledger_from_path(&path).expect("load ledger");

        assert_eq!(saved.version, PERFORMANCE_LEDGER_VERSION);
        assert_eq!(loaded.snapshots.len(), 1);
        assert_eq!(loaded.cash_flows.len(), 1);
        assert_eq!(loaded.snapshots[0]["portfolioValue"], 120000.0);

        fs::write(
            &path,
            r#"{"snapshots":[{"date":"2026-07-16","baseCurrency":"EUR","portfolioValue":1}],"cashFlows":[]}"#,
        )
        .expect("write invalid ledger");
        let invalid = load_performance_ledger_from_path(&path);
        let _ = fs::remove_file(&path);

        assert!(invalid.is_err());
    }

    #[test]
    fn statement_import_ledger_roundtrips_redacted_batch_metadata() {
        let path = test_holdings_path("statement-import-ledger-roundtrip");
        let snapshot = StatementImportLedgerSnapshot {
            version: 99,
            updated_at: "2026-07-16T10:00:00Z".to_string(),
            batches: vec![serde_json::json!({
                "id": "statement-checksum",
                "checksum": "checksum",
                "fileName": "broker.csv",
                "importedAt": "2026-07-16T10:00:00Z",
                "rowCount": 4,
                "warningCount": 1,
                "counts": {"account": 1, "position": 1, "trade": 1, "cash-flow": 1}
            })],
        };

        let saved = save_statement_imports_to_path(&path, snapshot).expect("save imports");
        let loaded = load_statement_imports_from_path(&path).expect("load imports");
        let _ = fs::remove_file(&path);

        assert_eq!(saved.version, STATEMENT_IMPORT_LEDGER_VERSION);
        assert_eq!(loaded.batches.len(), 1);
        assert_eq!(loaded.batches[0]["rowCount"], 4);
    }

    #[test]
    fn backup_and_diagnostics_include_performance_ledger_without_content() {
        let dir = std::env::temp_dir().join(format!(
            "rportfolio-performance-backup-test-{}-{}",
            std::process::id(),
            Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        fs::create_dir_all(&dir).expect("create test data directory");
        fs::write(
            dir.join("performance-ledger.json"),
            r#"{"version":1,"snapshots":[{"id":"private-snapshot","date":"2026-07-16"}],"cashFlows":[{"id":"private-flow"}]}"#,
        )
        .expect("write ledger");

        let backup = create_data_backup_in_dir(&dir, "manual").expect("create backup");
        let diagnostics = data_diagnostics_for_dir(&dir).expect("diagnostics");
        let diagnostic_json = serde_json::to_string(&diagnostics).expect("serialize diagnostics");
        let performance = diagnostics
            .stores
            .iter()
            .find(|store| store.key == "performanceLedger")
            .expect("performance diagnostic");
        let _ = fs::remove_dir_all(&dir);

        assert!(backup
            .files
            .contains(&"performance-ledger.json".to_string()));
        assert_eq!(performance.records, 2);
        assert!(!diagnostic_json.contains("private-snapshot"));
        assert!(!diagnostic_json.contains("private-flow"));
    }

    #[test]
    fn backup_restore_creates_protection_snapshot_and_redacted_diagnostics() {
        let dir = std::env::temp_dir().join(format!(
            "rportfolio-backup-test-{}-{}",
            std::process::id(),
            Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        fs::create_dir_all(&dir).expect("create test data directory");
        fs::write(
            dir.join("holdings.json"),
            r#"[{"id":"secret-account-position","symbol":"SPY"}]"#,
        )
        .expect("write holdings");

        let backup = create_data_backup_in_dir(&dir, "manual").expect("create backup");
        fs::write(dir.join("holdings.json"), "[]").expect("mutate holdings");
        let restored = restore_data_backup_in_dir(&dir, &backup.id).expect("restore backup");
        let content =
            fs::read_to_string(dir.join("holdings.json")).expect("read restored holdings");
        let diagnostics = data_diagnostics_for_dir(&dir).expect("diagnostics");
        let diagnostic_json = serde_json::to_string(&diagnostics).expect("serialize diagnostics");
        let backups = list_data_backups_in_dir(&dir).expect("list backups");
        let _ = fs::remove_dir_all(&dir);

        assert!(content.contains("secret-account-position"));
        assert_eq!(restored.backup_id, backup.id);
        assert!(!restored.pre_restore_backup_id.is_empty());
        assert_eq!(restored.restored_files, 1);
        assert!(backups.len() >= 2);
        assert!(!diagnostic_json.contains("secret-account-position"));
        assert_eq!(
            diagnostics
                .stores
                .iter()
                .find(|store| store.key == "holdings")
                .map(|store| store.records),
            Some(1)
        );
    }

    #[test]
    fn holdings_storage_roundtrips_normalized_records() {
        let path = test_holdings_path("roundtrip");
        let holdings = vec![HoldingRecord {
            id: "  local-smh ".to_string(),
            account_id: Some(" account-us ".to_string()),
            symbol: " smh ".to_string(),
            name: " 半导体 ETF ".to_string(),
            market: " us ".to_string(),
            currency: " usd ".to_string(),
            role: " REAL ".to_string(),
            asset_type: Some(" etf ".to_string()),
            quote_source: Some(" yahoo ".to_string()),
            profile_key: Some(" local-smh-profile ".to_string()),
            quantity: 12.0,
            cost_price: 180.0,
            current_price: 195.0,
            quote_as_of: Some(" 2026-07-15 ".to_string()),
            confirmed_nav: Some(194.5),
            confirmed_nav_as_of: Some(" 2026-07-01 ".to_string()),
            fund_purchase_status: None,
            fund_purchase_open: None,
            fund_purchase_limit: None,
            fund_redemption_open: None,
            fund_trade_status_as_of: None,
            fund_holdings_as_of: None,
            fund_top_holdings: Vec::new(),
            fund_nav_history: Vec::new(),
            fund_redemption_fee_schedule: Vec::new(),
            target_min_weight: Some(25.0),
            target_weight: 35.0,
            target_max_weight: Some(42.0),
            notes: " 核心仓位 ".to_string(),
        }];

        let saved = save_holdings_to_path(&path, holdings).expect("save holdings");
        let loaded = load_holdings_from_path(&path).expect("load holdings");
        let _ = fs::remove_file(&path);

        assert_eq!(saved, loaded);
        assert_eq!(loaded[0].symbol, "SMH");
        assert_eq!(loaded[0].account_id.as_deref(), Some("account-us"));
        assert_eq!(loaded[0].market, "US");
        assert_eq!(loaded[0].currency, "USD");
        assert_eq!(loaded[0].role, "real");
        assert_eq!(loaded[0].asset_type.as_deref(), Some("etf"));
        assert_eq!(loaded[0].quote_source.as_deref(), Some("yahoo"));
        assert_eq!(loaded[0].profile_key.as_deref(), Some("local-smh-profile"));
        assert_eq!(loaded[0].quote_as_of.as_deref(), Some("2026-07-15"));
        assert_eq!(loaded[0].confirmed_nav, Some(194.5));
        assert_eq!(loaded[0].confirmed_nav_as_of.as_deref(), Some("2026-07-01"));
        assert_eq!(loaded[0].target_min_weight, Some(25.0));
        assert_eq!(loaded[0].target_max_weight, Some(42.0));
        assert_eq!(loaded[0].notes, "核心仓位");
    }

    #[test]
    fn fund_nav_history_requires_exact_date() {
        let timestamp = Utc
            .with_ymd_and_hms(2026, 6, 30, 0, 0, 0)
            .single()
            .expect("valid timestamp")
            .timestamp_millis();
        let trend = vec![serde_json::json!({"x": timestamp, "y": 2.3456})];
        let exact = fund_nav_point_for_date(
            &trend,
            NaiveDate::from_ymd_opt(2026, 6, 30).expect("valid date"),
        );
        let missing = fund_nav_point_for_date(
            &trend,
            NaiveDate::from_ymd_opt(2026, 7, 1).expect("valid date"),
        );

        assert_eq!(exact.map(|(_, nav)| nav), Some(2.3456));
        assert!(missing.is_none());
    }

    #[test]
    fn fund_nav_history_keeps_latest_sorted_points() {
        let timestamp = |day| {
            Utc.with_ymd_and_hms(2026, 6, day, 0, 0, 0)
                .single()
                .expect("valid timestamp")
                .timestamp_millis()
        };
        let trend = vec![
            serde_json::json!({"x": timestamp(2), "y": 1.02}),
            serde_json::json!({"x": timestamp(1), "y": 1.01}),
            serde_json::json!({"x": timestamp(3), "y": 1.03}),
        ];
        let points = fund_nav_history(&trend, 2);

        assert_eq!(points.len(), 2);
        assert_eq!(points[0].date, "2026-06-02");
        assert_eq!(points[1].date, "2026-06-03");
        assert_eq!(points[1].nav, 1.03);
    }

    #[test]
    fn holdings_storage_rejects_invalid_role() {
        let path = test_holdings_path("bad-role");
        let error = save_holdings_to_path(
            &path,
            vec![HoldingRecord {
                id: "bad".to_string(),
                account_id: None,
                symbol: "SPY".to_string(),
                name: "SPY".to_string(),
                market: "US".to_string(),
                currency: "USD".to_string(),
                role: "tracker".to_string(),
                asset_type: None,
                quote_source: None,
                profile_key: None,
                quantity: 1.0,
                cost_price: 1.0,
                current_price: 1.0,
                quote_as_of: None,
                confirmed_nav: None,
                confirmed_nav_as_of: None,
                fund_purchase_status: None,
                fund_purchase_open: None,
                fund_purchase_limit: None,
                fund_redemption_open: None,
                fund_trade_status_as_of: None,
                fund_holdings_as_of: None,
                fund_top_holdings: Vec::new(),
                fund_nav_history: Vec::new(),
                fund_redemption_fee_schedule: Vec::new(),
                target_min_weight: None,
                target_weight: 0.0,
                target_max_weight: None,
                notes: String::new(),
            }],
        )
        .expect_err("invalid role should fail");

        assert!(error.message.contains("real, proxy, watch"));
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn trades_storage_roundtrips_normalized_records() {
        let path = test_holdings_path("trades-roundtrip");
        let trades = vec![TradeRecord {
            id: " trade-016702 ".to_string(),
            account_id: Some(" account-cn ".to_string()),
            decision_id: Some(" decision-016702 ".to_string()),
            order_id: Some(" order-016702 ".to_string()),
            symbol: " 016702 ".to_string(),
            name: " 银华数字经济 ".to_string(),
            side: " BUY ".to_string(),
            trade_date: "2026-06-09".to_string(),
            quantity: 1200.0,
            price: 2.2362,
            fee: 1.5,
            currency: " cny ".to_string(),
            notes: " 定投 ".to_string(),
        }];

        let saved = save_trades_to_path(&path, trades).expect("save trades");
        let loaded = load_trades_from_path(&path).expect("load trades");
        let _ = fs::remove_file(&path);

        assert_eq!(saved, loaded);
        assert_eq!(loaded[0].symbol, "016702");
        assert_eq!(loaded[0].account_id.as_deref(), Some("account-cn"));
        assert_eq!(loaded[0].decision_id.as_deref(), Some("decision-016702"));
        assert_eq!(loaded[0].order_id.as_deref(), Some("order-016702"));
        assert_eq!(loaded[0].side, "buy");
        assert_eq!(loaded[0].currency, "CNY");
        assert_eq!(loaded[0].notes, "定投");
    }

    #[test]
    fn encodes_yahoo_symbols_for_chart_path() {
        assert_eq!(encode_url_path_segment("^VIX"), "%5EVIX");
        assert_eq!(encode_url_path_segment("0700.HK"), "0700.HK");
        assert_eq!(encode_url_path_segment("BRK B"), "BRK%20B");
    }

    #[test]
    fn yahoo_source_label_marks_benchmark_proxy() {
        let profile: AnalysisProfile = serde_json::from_str(
            r#"{
              "key": "hk-tech",
              "name": "港股科技",
              "market": "hk",
              "benchmark": "HSTECH",
              "symbols": [
                { "symbol": "HSTECH", "yahooSymbol": "3033.HK", "label": "恒生科技ETF", "role": "benchmark" },
                { "symbol": "TENCENT", "yahooSymbol": "0700.HK", "label": "腾讯", "role": "leader" }
              ],
              "technicalColumns": [],
              "dimensions": []
            }"#,
        )
        .expect("valid profile");

        assert_eq!(yahoo_source_label(&profile), "Yahoo Finance · Proxy");
        assert!(yahoo_provider_note(&profile).contains("HSTECH=3033.HK"));
        assert!(yahoo_provider_note(&profile).contains("TENCENT=0700.HK"));
    }

    #[test]
    fn parses_fred_csv_and_skips_missing_observations() {
        let candles = parse_fred_csv(
            "observation_date,VIXCLS\n2026-05-18,17.82\n2026-05-19,.\n2026-05-20,17.44\n",
            "VIXCLS",
        )
        .expect("valid FRED csv");

        assert_eq!(candles.len(), 2);
        assert_eq!(
            candles[0].date,
            NaiveDate::from_ymd_opt(2026, 5, 18).unwrap()
        );
        assert_eq!(candles[0].close, 17.82);
        assert_eq!(candles[0].open, candles[0].close);
        assert_eq!(
            candles[1].date,
            NaiveDate::from_ymd_opt(2026, 5, 20).unwrap()
        );
    }

    #[test]
    fn hybrid_provider_note_reports_fred_overlays() {
        let profile: AnalysisProfile = serde_json::from_str(
            r#"{
              "key": "us-core",
              "name": "美股核心风险",
              "market": "us",
              "benchmark": "SPY",
              "symbols": [
                { "symbol": "SPY", "yahooSymbol": "SPY", "label": "大盘", "role": "benchmark" },
                { "symbol": "VIX", "yahooSymbol": "^VIX", "fredSymbol": "VIXCLS", "label": "恐慌", "role": "volatility" }
              ],
              "technicalColumns": [],
              "dimensions": []
            }"#,
        )
        .expect("valid profile");

        let overlays = vec!["VIX=VIXCLS".to_string()];
        assert_eq!(hybrid_source_label(&profile, &overlays), "Yahoo/FRED");
        assert!(hybrid_provider_note(&profile, &overlays, &[]).contains("FRED 覆盖：VIX=VIXCLS"));
    }

    #[test]
    fn parses_stooq_history_table_and_page_count() {
        let page = parse_stooq_history_page(
            r#"
            <html><body>
              <table><tr><td><a href=q/d/?s=spy.us&i=d&l=2>></a> | <a href=q/d/?s=spy.us&i=d&l=134>>></a></td></tr></table>
              <table width=100% border=0 cellpadding=3 cellspacing=0 class=fth1 id=fth1>
                <thead><tr><td>No.</td><td>Date</td><td>Open</td><td>High</td><td>Low</td><td>Close</td><td colspan=2>Change</td><td>Volume</td></tr></thead>
                <tbody>
                  <tr><td align=center id=t03>5343</td><td nowrap>22 May 2026</td><td>746.24</td><td>748.94</td><td>744.48</td><td>745.64</td><td id=c1>+0.39%</td><td id=c1>+2.9200</td><td>41,762,006</td></tr>
                  <tr><td align=center id=t03>5342</td><td nowrap>21 May 2026</td><td>738.64</td><td>744.87</td><td>737.03</td><td>742.72</td><td id=c1>+0.20%</td><td id=c1>+1.4700</td><td>43,332,225</td></tr>
                </tbody>
              </table>
            </body></html>
            "#,
            "spy.us",
        )
        .expect("valid Stooq html");

        assert_eq!(page.page_count, 134);
        assert_eq!(page.candles.len(), 2);
        assert_eq!(
            page.candles[0].date,
            NaiveDate::from_ymd_opt(2026, 5, 21).unwrap()
        );
        assert_eq!(page.candles[0].close, 742.72);
        assert_eq!(page.candles[1].volume, 41_762_006.0);
    }

    #[test]
    fn detects_stooq_daily_hit_limit() {
        let page = parse_stooq_history_page(
            "Historical values of TLT.US Exceeded the daily site hits limit The data has been hidden",
            "tlt.us",
        )
        .expect("limit page");

        assert!(page.limit_exceeded);
        assert_eq!(page.candles.len(), 0);
    }

    #[test]
    fn infers_stooq_symbols_from_yahoo_symbols() {
        assert_eq!(infer_stooq_symbol("SPY"), "spy.us");
        assert_eq!(infer_stooq_symbol("0700.HK"), "0700.hk");
        assert_eq!(infer_stooq_symbol("000660.KS"), "000660.kr");
        assert_eq!(infer_stooq_symbol("510300.SS"), "510300.cn");
        assert_eq!(infer_stooq_symbol("DX-Y.NYB"), "dx.f");
        assert_eq!(infer_stooq_symbol("^KS11"), "^kospi");
    }

    #[test]
    fn trend_breakdown_risk_floor_does_not_force_panic() {
        let risk = decision_risk_score(
            &test_market_state("trend_breakdown"),
            &test_factors(0, 0, 72, 9, 0),
            54,
        );

        assert!((80..100).contains(&risk));
    }

    #[test]
    fn horizon_stat_reports_distribution_and_tail_risk() {
        let candles = synthetic_candles(&[
            (0, 100.0),
            (1, 96.0),
            (2, 101.0),
            (3, 94.0),
            (4, 104.0),
            (5, 102.0),
            (6, 98.0),
            (7, 106.0),
            (8, 99.0),
            (9, 108.0),
            (10, 90.0),
            (11, 109.0),
            (12, 103.0),
            (13, 111.0),
            (14, 100.0),
            (15, 112.0),
        ]);
        let samples = (0..8)
            .map(|index| HistoricalStateSample {
                index,
                exact_state_match: true,
            })
            .collect::<Vec<_>>();
        let stat = backtest_horizon_stat(&candles, &samples, 5);

        assert_eq!(stat.sample_count, 8);
        assert!(stat.average_return_ci_low_pct.is_some());
        assert!(stat.return_p25_pct.is_some());
        assert!(stat.return_p75_pct.is_some());
        assert!(stat.tail_loss_rate_pct.unwrap_or(0.0) > 0.0);
        assert!(stat.severe_drawdown_rate_pct.unwrap_or(0.0) > 0.0);
    }

    fn synthetic_candles(points: &[(usize, f64)]) -> Vec<Candle> {
        let last_index = points.last().map(|(index, _)| *index).unwrap_or(0);
        let start = NaiveDate::from_ymd_opt(2025, 1, 1).expect("valid date");

        (0..=last_index)
            .map(|index| {
                let close = interpolate(points, index);
                Candle {
                    date: start + Duration::days(index as i64),
                    open: close,
                    high: close * 1.006,
                    low: close * 0.994,
                    close,
                    volume: 1_000_000.0,
                    flow: None,
                }
            })
            .collect()
    }

    fn interpolate(points: &[(usize, f64)], index: usize) -> f64 {
        for pair in points.windows(2) {
            let (left_index, left_price) = pair[0];
            let (right_index, right_price) = pair[1];
            if index >= left_index && index <= right_index {
                let span = (right_index - left_index) as f64;
                let progress = if span > 0.0 {
                    (index - left_index) as f64 / span
                } else {
                    0.0
                };
                return left_price + (right_price - left_price) * progress;
            }
        }
        points.last().map(|(_, price)| *price).unwrap_or(0.0)
    }

    fn test_symbol(symbol: &str, label: &str) -> ProfileSymbol {
        ProfileSymbol {
            symbol: symbol.to_string(),
            yahoo_symbol: None,
            stooq_symbol: None,
            fred_symbol: None,
            csv_path: None,
            label: label.to_string(),
            role: Some("benchmark".to_string()),
            asset_kind: None,
            weight: None,
            sector: None,
            style: None,
            exposure: None,
        }
    }

    fn test_market_state(key: &str) -> MarketState {
        MarketState {
            key: key.to_string(),
            label: key.to_string(),
            tone: "neutral".to_string(),
            summary: "test state".to_string(),
        }
    }

    fn test_factors(
        trend: u8,
        structure: u8,
        systemic: u8,
        volatility: u8,
        heat: u8,
    ) -> Vec<FactorScore> {
        vec![
            test_factor("trend", trend),
            test_factor("structure", structure),
            test_factor("systemic", systemic),
            test_factor("volatility", volatility),
            test_factor("heat", heat),
        ]
    }

    fn test_factor(key: &str, score: u8) -> FactorScore {
        FactorScore {
            key: key.to_string(),
            label: key.to_string(),
            score,
            pressure: score,
            tone: "neutral".to_string(),
            status: "test".to_string(),
            detail: "test".to_string(),
        }
    }

    fn test_opportunities(short_score: u8) -> Vec<OpportunityScore> {
        vec![OpportunityScore {
            horizon_key: "short".to_string(),
            horizon_label: "短线机会".to_string(),
            score: short_score,
            tone: "neutral".to_string(),
            status: "test".to_string(),
            detail: "test".to_string(),
        }]
    }

    fn test_position_advice(entry_trigger: &str) -> Vec<PositionAdvice> {
        vec![PositionAdvice {
            horizon_key: "short".to_string(),
            horizon_label: "短线".to_string(),
            action: "等待确认".to_string(),
            adjustment: "test".to_string(),
            target_position: "test".to_string(),
            current_range: None,
            add_range: None,
            max_cap: None,
            range_meaning: TARGET_EXPOSURE_MEANING.to_string(),
            range_note: TARGET_EXPOSURE_NOTE.to_string(),
            damage_score: 0,
            damage_label: "结构可控".to_string(),
            tone: "neutral".to_string(),
            confidence_score: 60,
            confidence_label: "中置信".to_string(),
            confidence_tone: "neutral".to_string(),
            gates: Vec::new(),
            rationale: "test".to_string(),
            entry_trigger: entry_trigger.to_string(),
            risk_trigger: "test".to_string(),
        }]
    }

    fn test_structure(invalidation: &str) -> StructureAnalysis {
        StructureAnalysis {
            trend: "test".to_string(),
            support: "test".to_string(),
            resistance: "test".to_string(),
            invalidation: invalidation.to_string(),
            action_map: Vec::new(),
            signals: Vec::new(),
        }
    }

    fn test_pattern_analysis() -> PatternAnalysis {
        PatternAnalysis {
            summary: "test".to_string(),
            dominant: None,
            patterns: Vec::new(),
        }
    }

    #[test]
    fn kdj_rules_can_trigger_from_profile_snapshots() {
        let candles = test_indicator_candles(36, |index| 10.0 + index as f64 * 0.8, |_| 1.0);
        let snapshot = snapshot_at(&candles, candles.len() - 1);
        let kdj = snapshot.kdj(9).expect("kdj value");
        assert!(kdj.j > 80.0, "rising series should push KDJ J high");

        let mut snapshots = HashMap::new();
        snapshots.insert("SPY".to_string(), snapshot);
        let rule = test_rule("kdj_above", "SPY", 8)
            .with_threshold(80.0)
            .with_line("j");

        assert!(evaluate_rule(&rule, &HashMap::new(), &HashMap::new(), &snapshots).unwrap());
    }

    #[test]
    fn volume_ratio_rules_can_gate_execution_quality() {
        let candles = test_indicator_candles(
            25,
            |index| 20.0 + index as f64 * 0.1,
            |index| if index == 24 { 8.0 } else { 1.0 },
        );
        let snapshot = snapshot_at(&candles, candles.len() - 1);
        assert!(snapshot.volume_ratio().unwrap_or_default() > 3.0);

        let mut snapshots = HashMap::new();
        snapshots.insert("ETF".to_string(), snapshot);
        let rule = test_rule("volume_ratio_above", "ETF", 6).with_threshold(1.5);

        assert!(evaluate_rule(&rule, &HashMap::new(), &HashMap::new(), &snapshots).unwrap());
    }

    #[test]
    fn price_action_trend_and_pullback_rules_use_indicator_snapshots() {
        let candles =
            test_indicator_candles(60, |index| if index == 59 { 101.0 } else { 100.0 }, |_| 1.0);
        let snapshot = snapshot_at(&candles, candles.len() - 1);
        assert!(snapshot.ma(20).is_some());
        assert!(snapshot.ma(50).is_some());

        let mut snapshots = HashMap::new();
        snapshots.insert("SPY".to_string(), snapshot);
        let trend_rule = test_rule("trend_continuation", "SPY", 7);
        let pullback_rule = test_rule("pullback_hold_ma", "SPY", 8)
            .with_period(20)
            .with_tolerance_pct(2.2);

        assert!(evaluate_rule(&trend_rule, &HashMap::new(), &HashMap::new(), &snapshots).unwrap());
        assert!(
            evaluate_rule(&pullback_rule, &HashMap::new(), &HashMap::new(), &snapshots).unwrap()
        );
    }

    #[test]
    fn price_action_breakdown_and_range_rules_are_distinct() {
        let breakdown_candles = test_indicator_candles(
            60,
            |index| {
                if index < 30 {
                    100.0
                } else {
                    100.0 - (index - 30) as f64
                }
            },
            |_| 1.0,
        );
        let range_candles = test_indicator_candles(
            60,
            |index| 100.0 + ((index % 4) as f64 - 1.5) * 0.15,
            |_| 1.0,
        );
        let mut snapshots = HashMap::new();
        snapshots.insert(
            "BROKEN".to_string(),
            snapshot_at(&breakdown_candles, breakdown_candles.len() - 1),
        );
        snapshots.insert(
            "RANGE".to_string(),
            snapshot_at(&range_candles, range_candles.len() - 1),
        );

        let support_lost = test_rule("support_lost", "BROKEN", 10).with_period(50);
        let compression = test_rule("range_compression", "RANGE", 5)
            .with_return20d_abs_max(3.0)
            .with_volume_max(1.08);

        assert!(
            evaluate_rule(&support_lost, &HashMap::new(), &HashMap::new(), &snapshots).unwrap()
        );
        assert!(evaluate_rule(&compression, &HashMap::new(), &HashMap::new(), &snapshots).unwrap());
    }

    #[test]
    fn price_action_volume_and_risk_proxy_rules_are_guarded() {
        let breakout_candles = test_indicator_candles(
            60,
            |index| 100.0 + index as f64 * 0.1,
            |index| if index == 59 { 6.0 } else { 1.0 },
        );
        let cooling_candles = test_indicator_candles(
            60,
            |index| {
                if index < 30 {
                    24.0
                } else {
                    24.0 - (index - 30) as f64 * 0.2
                }
            },
            |_| 1.0,
        );
        let mut snapshots = HashMap::new();
        snapshots.insert(
            "SPY".to_string(),
            snapshot_at(&breakout_candles, breakout_candles.len() - 1),
        );
        snapshots.insert(
            "VIX".to_string(),
            snapshot_at(&cooling_candles, cooling_candles.len() - 1),
        );
        snapshots.insert(
            "RISKY".to_string(),
            snapshot_at(&cooling_candles, cooling_candles.len() - 1),
        );

        let breakout = test_rule("volume_breakout", "SPY", 6).with_volume_threshold(1.45);
        let cooling = test_rule("risk_proxy_cooling", "VIX", 6);
        let non_proxy_cooling = test_rule("risk_proxy_cooling", "RISKY", 6);

        assert!(evaluate_rule(&breakout, &HashMap::new(), &HashMap::new(), &snapshots).unwrap());
        assert!(evaluate_rule(&cooling, &HashMap::new(), &HashMap::new(), &snapshots).unwrap());
        assert!(!evaluate_rule(
            &non_proxy_cooling,
            &HashMap::new(),
            &HashMap::new(),
            &snapshots
        )
        .unwrap());
    }

    fn test_leader_confirmation(severe: bool) -> LeaderConfirmation {
        LeaderConfirmation {
            leader_count: 2,
            weak_count: if severe { 2 } else { 1 },
            below_ma20_count: if severe { 2 } else { 1 },
            below_ma50_count: if severe { 2 } else { 0 },
            weak_labels: vec!["NVDA".to_string(), "SMH".to_string()],
            confirmation_count: 2,
            confirmation_weak_count: if severe { 2 } else { 1 },
            confirmation_below_ma20_count: if severe { 1 } else { 0 },
            confirmation_below_ma50_count: if severe { 1 } else { 0 },
            confirmation_weak_labels: vec!["AMD".to_string(), "MU".to_string()],
            divergent: true,
            severe,
        }
    }

    fn test_profile(key: &str) -> AnalysisProfile {
        serde_json::from_value(serde_json::json!({
            "key": key,
            "name": "Test Profile",
            "market": "us",
            "benchmark": "SPY",
            "symbols": [
                { "symbol": "SPY", "label": "SPY", "role": "benchmark", "weight": 50 },
                { "symbol": "SMH", "label": "SMH", "role": "leader", "weight": 25 },
                { "symbol": "NVDA", "label": "NVDA", "role": "confirmation", "weight": 25 }
            ],
            "technicalColumns": [],
            "dimensions": []
        }))
        .expect("valid profile")
    }

    fn test_market_internals(active: &[(&str, &str, &str)]) -> MarketInternals {
        let signals = active
            .iter()
            .map(|(key, tone, status)| MarketInternalSignal {
                key: (*key).to_string(),
                label: (*key).to_string(),
                value: "test".to_string(),
                tone: (*tone).to_string(),
                status: (*status).to_string(),
                detail: "test".to_string(),
            })
            .collect::<Vec<_>>();

        MarketInternals {
            summary: "test internals".to_string(),
            tone: "caution".to_string(),
            scope_label: "监控篮子 n=3，相对弱势 n=3".to_string(),
            breadth_sample_size: 3,
            relative_weakness_sample_size: 3,
            breadth_advancing_ratio: Some(30.0),
            relative_weakness_ratio: Some(60.0),
            high_beta_order: "SMH < QQQ < SPY".to_string(),
            signals,
        }
    }

    fn test_performance_slice(
        key: &str,
        label: &str,
        sample_count: usize,
        hit_rate_pct: f64,
        average_signed_return_pct: f64,
    ) -> RecommendationPerformanceSlice {
        RecommendationPerformanceSlice {
            key: key.to_string(),
            label: label.to_string(),
            sample_count,
            correct_count: ((sample_count as f64 * hit_rate_pct / 100.0).round()) as usize,
            hit_rate_pct: Some(hit_rate_pct),
            average_signed_return_pct: Some(average_signed_return_pct),
            average_excess_return_pct: None,
            average_max_adverse_pct: Some(-1.0),
        }
    }

    fn test_indicator_candles(
        count: usize,
        mut close_for: impl FnMut(usize) -> f64,
        mut volume_for: impl FnMut(usize) -> f64,
    ) -> Vec<Candle> {
        let start = NaiveDate::from_ymd_opt(2026, 1, 1).expect("valid date");
        (0..count)
            .map(|index| {
                let close = close_for(index);
                Candle {
                    date: start + Duration::days(index as i64),
                    open: close * 0.995,
                    high: close * 1.01,
                    low: close * 0.99,
                    close,
                    volume: volume_for(index),
                    flow: None,
                }
            })
            .collect()
    }

    fn test_rule(rule_type: &str, symbol: &str, points: u8) -> RuleConfig {
        RuleConfig {
            rule_type: rule_type.to_string(),
            symbol: Some(symbol.to_string()),
            symbols: None,
            other: None,
            period: None,
            left_period: None,
            right_period: None,
            days: None,
            threshold: None,
            max_threshold: None,
            tolerance_pct: None,
            return20d_abs_max: None,
            volume_max: None,
            volume_threshold: None,
            buffer: None,
            multiplier: None,
            change_lte: None,
            volume_ratio_gt: None,
            line: None,
            points,
            reason: "{symbol} test".to_string(),
        }
    }

    trait TestRuleExt {
        fn with_threshold(self, value: f64) -> Self;
        fn with_period(self, value: u16) -> Self;
        fn with_line(self, value: &str) -> Self;
        fn with_tolerance_pct(self, value: f64) -> Self;
        fn with_return20d_abs_max(self, value: f64) -> Self;
        fn with_volume_max(self, value: f64) -> Self;
        fn with_volume_threshold(self, value: f64) -> Self;
    }

    impl TestRuleExt for RuleConfig {
        fn with_threshold(mut self, value: f64) -> Self {
            self.threshold = Some(value);
            self
        }

        fn with_period(mut self, value: u16) -> Self {
            self.period = Some(value);
            self
        }

        fn with_line(mut self, value: &str) -> Self {
            self.line = Some(value.to_string());
            self
        }

        fn with_tolerance_pct(mut self, value: f64) -> Self {
            self.tolerance_pct = Some(value);
            self
        }

        fn with_return20d_abs_max(mut self, value: f64) -> Self {
            self.return20d_abs_max = Some(value);
            self
        }

        fn with_volume_max(mut self, value: f64) -> Self {
            self.volume_max = Some(value);
            self
        }

        fn with_volume_threshold(mut self, value: f64) -> Self {
            self.volume_threshold = Some(value);
            self
        }
    }

    fn test_holdings_path(name: &str) -> PathBuf {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        std::env::temp_dir().join(format!(
            "rportfolio-holdings-{name}-{}-{now}.json",
            std::process::id()
        ))
    }
}
