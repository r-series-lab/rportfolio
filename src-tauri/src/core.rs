use chrono::{Datelike, Duration, NaiveDate, TimeZone, Utc, Weekday};
use csv::StringRecord;
use reqwest::header::{HeaderMap, HeaderValue, ACCEPT, ACCEPT_LANGUAGE, REFERER, USER_AGENT};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration as StdDuration;

const HISTORY_RANGE: &str = "2y";
const MIN_DAILY_BARS: usize = 220;
const DEFAULT_PROFILE_KEY: &str = "us-core";
const YAHOO_USER_AGENT: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36";
const YAHOO_CHART_HOSTS: [&str; 2] = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"];
const FRED_GRAPH_CSV_URL: &str = "https://fred.stlouisfed.org/graph/fredgraph.csv";
const STOOQ_HISTORY_URL: &str = "https://stooq.com/q/d/";
const STOOQ_ROWS_PER_PAGE: usize = 40;
const STOOQ_MAX_PAGES: usize = 8;
const AUTO_PROVIDER_TIMEOUT: StdDuration = StdDuration::from_secs(4);
const HTTP_REQUEST_TIMEOUT: StdDuration = StdDuration::from_secs(4);
const HTTP_CONNECT_TIMEOUT: StdDuration = StdDuration::from_secs(2);
const SUPPORTED_RULE_TYPES: &[&str] = &[
    "close_below_ma",
    "volume_break_ma",
    "ma_below_ma",
    "macd_bearish",
    "rsi_above",
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
    pub topic_labels: Vec<String>,
    pub source_name: String,
    pub source_url: String,
    pub fetched_at: String,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HoldingRecord {
    pub id: String,
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

#[derive(Debug, Clone)]
struct Candle {
    date: NaiveDate,
    open: f64,
    high: f64,
    low: f64,
    close: f64,
    volume: f64,
    flow: Option<f64>,
}

#[derive(Debug, Clone)]
struct LoadedMarketData {
    source: String,
    source_label: String,
    provider_note: String,
    series: HashMap<String, Vec<Candle>>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AnalysisProfile {
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
    copy: ProfileCopyConfig,
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
    buffer: Option<f64>,
    multiplier: Option<f64>,
    change_lte: Option<f64>,
    volume_ratio_gt: Option<f64>,
    points: u8,
    reason: String,
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
            Ok(ProfileSummary {
                key: profile.key,
                name: profile.name,
                market: profile.market,
                description: profile.description.unwrap_or_default(),
                builtin: true,
            })
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
        profiles.push(ProfileSummary {
            key: profile.key,
            name: profile.name,
            market: profile.market,
            description: profile.description.unwrap_or_default(),
            builtin: false,
        });
    }

    Ok(profiles)
}

pub fn list_data_sources() -> Vec<DataSourceSummary> {
    vec![
        DataSourceSummary {
            key: "auto".to_string(),
            name: "自动".to_string(),
            description: "优先使用 profile 配置的 CSV；否则尝试 Stooq 历史页，失败后使用免费混合源，最后使用示例数据。".to_string(),
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
        topic_labels,
        source_name: "东方财富公开基金资料".to_string(),
        source_url: format!("https://fund.eastmoney.com/{code}.html"),
        fetched_at: Utc::now().to_rfc3339(),
        warnings,
    })
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

    Ok(ProfileSummary {
        key: profile.key,
        name: profile.name,
        market: profile.market,
        description: profile.description.unwrap_or_default(),
        builtin: false,
    })
}

pub fn validate_profile_config(content: &str) -> ProfileValidationReport {
    let mut report = ProfileValidationReport::new();
    let value = match parse_profile_json_value(content) {
        Ok(value) => value,
        Err(error) => {
            report.error("json", "$", error.message);
            return report.finish();
        }
    };
    let json = match serde_json::to_string(&value) {
        Ok(json) => json,
        Err(error) => {
            report.error(
                "json",
                "$",
                format!("profile json normalization failed: {error}"),
            );
            return report.finish();
        }
    };
    let mut profile: AnalysisProfile = match serde_json::from_str(&json) {
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

pub async fn score_market(request: ScoreMarketRequest) -> Result<MarketAnalysisReport, AppError> {
    let profile = load_profile(request.profile.as_deref())?;
    let source = request
        .source
        .unwrap_or_else(|| "auto".to_string())
        .trim()
        .to_lowercase();
    let loaded = load_market_data(&source, &profile).await?;
    build_report(loaded, request.as_of, profile)
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

fn looks_like_path(value: &str) -> bool {
    value.ends_with(".json")
        || value.contains('/')
        || value.contains('\\')
        || Path::new(value).exists()
}

fn parse_profile(content: &str, base_dir: Option<PathBuf>) -> Result<AnalysisProfile, AppError> {
    let mut profile: AnalysisProfile = serde_json::from_str(content)
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
            "return" | "rsi" | "ma_distance" | "ma"
        ) && column.period.is_some_and(|period| period == 0)
        {
            report.error(
                "technicalColumns",
                format!("{path}.period"),
                "period must be greater than 0",
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
            "unsupported source '{other}', use auto, stooq, hybrid, yahoo, csv, or sample"
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

    Ok(MarketAnalysisReport {
        generated_at: Utc::now().to_rfc3339(),
        source: loaded.source,
        source_label: loaded.source_label,
        provider_note: loaded.provider_note,
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
        "macd_bearish" => macd_bearish(snapshot()?),
        "rsi_above" => {
            let snapshot = snapshot()?;
            let value = snapshot.rsi(rule.period.unwrap_or(14)).unwrap_or(0.0);
            value > rule.threshold.unwrap_or(70.0)
                && rule.max_threshold.map(|max| value <= max).unwrap_or(true)
        }
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
                volume_ratio: snapshot.volume_ratio().map(|value| round(value, 2)),
                status: status.to_string(),
                note: technical_note(snapshot, item),
            })
        })
        .collect()
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
    let samples = historical_state_samples(
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
    let horizon_stats = [5_u16, 10, 20, 60]
        .into_iter()
        .map(|days| backtest_horizon_stat(benchmark_series, &samples, days))
        .collect::<Vec<_>>();
    let event_stats = backtest_event_stats(benchmark_series, &samples);
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
) -> Vec<HistoricalStateSample> {
    const MIN_LOOKBACK: usize = 220;
    const MAX_HORIZON: usize = 60;
    let Some(last_index) = benchmark_index.checked_sub(MAX_HORIZON) else {
        return Vec::new();
    };
    if last_index < MIN_LOOKBACK {
        return Vec::new();
    }

    let mut exact = Vec::new();
    let mut similar = Vec::new();

    for index in MIN_LOOKBACK..=last_index {
        let date = benchmark_series[index].date;
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

    if exact.len() >= 8 {
        exact
    } else {
        exact.extend(similar);
        exact
    }
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
    fn validates_builtin_profile_config() {
        let report = validate_profile_config(BUILTIN_PROFILES[0].1);

        assert!(report.valid, "{:?}", report.errors);
        assert!(report.stats.symbols > 0);
        assert!(report.stats.rules > 0);
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
    fn holdings_storage_roundtrips_normalized_records() {
        let path = test_holdings_path("roundtrip");
        let holdings = vec![HoldingRecord {
            id: "  local-smh ".to_string(),
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
        assert_eq!(loaded[0].market, "US");
        assert_eq!(loaded[0].currency, "USD");
        assert_eq!(loaded[0].role, "real");
        assert_eq!(loaded[0].asset_type.as_deref(), Some("etf"));
        assert_eq!(loaded[0].quote_source.as_deref(), Some("yahoo"));
        assert_eq!(loaded[0].profile_key.as_deref(), Some("local-smh-profile"));
        assert_eq!(loaded[0].target_min_weight, Some(25.0));
        assert_eq!(loaded[0].target_max_weight, Some(42.0));
        assert_eq!(loaded[0].notes, "核心仓位");
    }

    #[test]
    fn holdings_storage_rejects_invalid_role() {
        let path = test_holdings_path("bad-role");
        let error = save_holdings_to_path(
            &path,
            vec![HoldingRecord {
                id: "bad".to_string(),
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
