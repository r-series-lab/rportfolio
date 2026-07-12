export type DataSource = "auto" | "china" | "stooq" | "hybrid" | "yahoo" | "csv" | "sample";
export type LightStatus = "green" | "yellow" | "red";

export interface ScoreMarketRequest {
  source?: DataSource;
  asOf?: string;
  profile?: string;
}

export interface ProfileSummary {
  key: string;
  name: string;
  market: string;
  description: string;
  builtin: boolean;
  schemaVersion?: number;
  profileVersion?: string;
  parentProfile?: string | null;
}

export interface ProfileConfigBundle {
  key: string;
  name: string;
  market: string;
  description: string;
  builtin: boolean;
  path: string | null;
  json: string;
}

export interface FundProfileSeed {
  code: string;
  name: string;
  fundType: string;
  manager: string;
  issuer: string;
  navSymbol: string;
  navDate: string | null;
  nav: number | null;
  estimateNav: number | null;
  estimateChange: number | null;
  estimateTime: string | null;
  return1m: number | null;
  return3m: number | null;
  return6m: number | null;
  return1y: number | null;
  latestStockPosition: number | null;
  assetAllocationAsOf: string | null;
  stockWeight: number | null;
  bondWeight: number | null;
  cashWeight: number | null;
  netAsset: number | null;
  purchaseStatus: string;
  purchaseOpen: boolean | null;
  purchaseLimit: number | null;
  redemptionOpen: boolean | null;
  holdingsAsOf: string | null;
  topHoldings: FundHoldingSeed[];
  navHistory: FundNavPoint[];
  redemptionFeeSchedule: FundRedemptionFeeTier[];
  topicLabels: string[];
  sourceName: string;
  sourceUrl: string;
  fetchedAt: string;
  warnings: string[];
}

export interface FundHoldingSeed {
  symbol: string;
  name: string;
  weight: number;
}

export interface FundNavPoint {
  date: string;
  nav: number;
}

export interface FundRedemptionFeeTier {
  label: string;
  minDays: number | null;
  maxDaysExclusive: number | null;
  rate: number;
}

export interface FundNavLookup {
  code: string;
  requestedDate: string;
  navDate: string;
  nav: number;
  exact: boolean;
  sourceName: string;
  sourceUrl: string;
  fetchedAt: string;
}

export interface ProfileValidationIssue {
  severity: "error" | "warning" | string;
  scope: string;
  path: string;
  message: string;
}

export interface ProfileValidationStats {
  symbols: number;
  weightedSymbols: number;
  totalWeight: number;
  dimensions: number;
  dimensionWeight: number;
  rules: number;
}

export interface ProfileValidationReport {
  valid: boolean;
  summary: string;
  errors: ProfileValidationIssue[];
  warnings: ProfileValidationIssue[];
  stats: ProfileValidationStats;
}

export interface MandateConstraint {
  key: string;
  label: string;
  value: string;
  tone: "positive" | "neutral" | "caution" | "negative" | string;
}

export interface ProfileMandate {
  objective: string;
  mandateType: string;
  baseCurrency: string;
  benchmarkName: string;
  timeHorizon: string;
  riskBudget: string;
  maxDrawdown: string;
  targetGrossExposure: string;
  rebalanceCadence: string;
  liquidity: string;
  riskScoreLimit: number | null;
  riskAlignment: string;
  riskAlignmentTone: "positive" | "neutral" | "caution" | "negative" | string;
  constraints: MandateConstraint[];
  notes: string[];
  summary: string;
}

export interface ProfileFund {
  enabled: boolean;
  code: string;
  name: string;
  fundType: string;
  manager: string;
  issuer: string;
  navSymbol: string;
  holdingsAsOf: string;
  holdingsSource: string;
  holdingsAgeDays: number | null;
  freshnessLabel: string;
  freshnessTone: "positive" | "neutral" | "caution" | "negative" | string;
  summary: string;
  notes: string[];
}

export interface ProfileExecutionPolicy {
  quoteWarnAgeSeconds: number;
  quoteBlockAgeSeconds: number;
  etfWarnSpreadBps: number;
  etfBlockSpreadBps: number;
  etfWarnPremiumDiscountPct: number;
  etfBlockPremiumDiscountPct: number;
  fundWarnHoldingsAgeDays: number;
  fundBlockHoldingsAgeDays: number;
}

export interface ProfileCalibrationStatus {
  stage: "validated" | "manual-baseline" | "legacy" | "evidence-gap" | string;
  label: string;
  tone: "positive" | "neutral" | "caution" | "negative" | string;
  executionGrade: boolean;
  method: string;
  trainingWindow: string;
  validationWindow: string;
  dataSignature: string;
  objective: string;
  effectiveSampleCount: number;
  summary: string;
  warnings: string[];
}

export interface RecommendationPerformanceSlice {
  key: string;
  label: string;
  sampleCount: number;
  correctCount: number;
  hitRatePct: number | null;
  averageSignedReturnPct: number | null;
  averageExcessReturnPct: number | null;
  averageMaxAdversePct: number | null;
}

export interface RecommendationPerformanceSummary {
  profileKey: string;
  label: string;
  tone: "positive" | "neutral" | "caution" | "negative" | string;
  summary: string;
  evaluatedRecords: number;
  rawEvaluatedOutcomes: number;
  effectiveEvaluatedOutcomes: number;
  pendingOutcomes: number;
  insufficientOutcomes: number;
  horizons: RecommendationPerformanceSlice[];
  directions: RecommendationPerformanceSlice[];
  marketStates: RecommendationPerformanceSlice[];
  priorities: RecommendationPerformanceSlice[];
}

export interface ProfileParameterProposal {
  key: string;
  label: string;
  path: string;
  currentValue: string;
  proposedValue: string;
  expectedEffect: string;
  reason: string;
  sampleCount: number;
  confidence: string;
  directlyApplicable: boolean;
}

export interface ProfileCalibrationAction {
  key: "collect" | "candidate" | "hold" | "review" | string;
  label: string;
  tone: "positive" | "neutral" | "caution" | "negative" | string;
  action: string;
  rationale: string;
  nextReview: string;
  minimumSampleCount: number;
  currentSampleCount: number;
  proposals: ProfileParameterProposal[];
  evidence: string[];
}

export interface DataSourceSummary {
  key: DataSource;
  name: string;
  description: string;
  requiresConfig: boolean;
}

export interface RiskLevel {
  key: "green" | "yellow" | "orange" | "red" | "crimson";
  label: string;
  color: string;
}

export interface MarketState {
  key: string;
  label: string;
  tone: "increase" | "hold" | "caution" | "reduce" | "defensive" | string;
  summary: string;
}

export interface DecisionAxis {
  key: string;
  label: string;
  score: number;
  status: string;
  tone: "positive" | "neutral" | "caution" | "negative" | string;
  detail: string;
}

export interface IntelligenceDriver {
  key: string;
  label: string;
  score: number;
  tone: "positive" | "neutral" | "caution" | "negative" | string;
  detail: string;
}

export interface RiskVectorItem {
  key: "system" | "structure" | "heat" | "volatility" | string;
  label: string;
  score: number;
  status: string;
  tone: "positive" | "neutral" | "caution" | "negative" | string;
  detail: string;
  drivers: string[];
}

export interface StateConfidence {
  score: number;
  label: string;
  tone: "positive" | "neutral" | "caution" | "negative" | string;
  summary: string;
  drivers: IntelligenceDriver[];
}

export interface SignalQuality {
  score: number;
  label: string;
  tone: "positive" | "neutral" | "caution" | "negative" | string;
  summary: string;
  effect: "trust" | "verify" | "limit" | "insufficient" | string;
  drivers: IntelligenceDriver[];
}

export interface DamageScore {
  score: number;
  label: string;
  tone: "positive" | "neutral" | "caution" | "negative" | string;
  summary: string;
  effect: "allow" | "cap_add" | "block_add" | "reduce_risk" | string;
  drivers: IntelligenceDriver[];
}

export interface StateTransitionOutcome {
  key: string;
  label: string;
  probability: number;
  tone: "positive" | "neutral" | "caution" | "negative" | string;
  summary: string;
}

export interface StateTransitionMatrix {
  horizonDays: number;
  sourceStateKey: string;
  sourceStateLabel: string;
  confidenceLabel: string;
  summary: string;
  outcomes: StateTransitionOutcome[];
}

export interface DecisionFrame {
  protocolState: "healthy" | "observe" | "broken" | "panic" | string;
  stateLabel: string;
  actionLabel: string;
  permission: string;
  permissionTone: "positive" | "neutral" | "caution" | "negative" | string;
  badgeLabel: string | null;
  conditionLabel: string;
  condition: string;
  summary: string;
  note: string | null;
  trend: DecisionAxis;
  risk: DecisionAxis;
  edge: DecisionAxis;
  stateConfidence?: StateConfidence;
  signalQuality?: SignalQuality;
  damageScore?: DamageScore;
  riskVector?: RiskVectorItem[];
  stateTransitionMatrix?: StateTransitionMatrix;
  invalidation: string;
}

export interface DecisionMetricContext {
  key: string;
  label: string;
  value: number;
  percentile: number | null;
  percentileLabel: string;
  sampleLabel: string;
  scope: string;
  tone: "positive" | "neutral" | "caution" | "negative" | string;
  detail: string;
}

export interface FactorScore {
  key: string;
  label: string;
  score: number;
  pressure: number;
  tone: "positive" | "neutral" | "caution" | "negative" | string;
  status: string;
  detail: string;
}

export interface StatusMetric {
  key: string;
  label: string;
  value: string;
  tone: "positive" | "neutral" | "caution" | "negative" | string;
  detail: string;
}

export interface MarketInternalSignal {
  key: string;
  label: string;
  value: string;
  tone: "positive" | "neutral" | "caution" | "negative" | string;
  status: string;
  detail: string;
}

export interface MarketInternals {
  summary: string;
  tone: "positive" | "neutral" | "caution" | "negative" | string;
  scopeLabel: string;
  breadthSampleSize: number;
  relativeWeaknessSampleSize: number;
  breadthAdvancingRatio: number | null;
  relativeWeaknessRatio: number | null;
  highBetaOrder: string;
  signals: MarketInternalSignal[];
}

export interface OpportunityScore {
  horizonKey: "short" | "medium" | "long" | string;
  horizonLabel: string;
  score: number;
  tone: "positive" | "neutral" | "caution" | "negative" | string;
  status: string;
  detail: string;
}

export interface StructureSignal {
  key: string;
  label: string;
  value: string;
  tone: "positive" | "neutral" | "caution" | "negative" | string;
  detail: string;
}

export interface ActionLine {
  key: string;
  label: string;
  value: string;
  tone: "positive" | "neutral" | "caution" | "negative" | string;
  action: string;
  detail: string;
}

export interface StructureAnalysis {
  trend: string;
  support: string;
  resistance: string;
  invalidation: string;
  actionMap: ActionLine[];
  signals: StructureSignal[];
}

export interface PriceBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number | null;
}

export interface PatternPoint {
  label: string;
  date: string;
  price: number;
}

export interface ChartPattern {
  key: string;
  label: string;
  symbol: string;
  symbolLabel: string;
  direction: "bullish" | "bearish" | string;
  status: "confirmed" | "forming" | "watch" | string;
  statusLabel: string;
  phase: string;
  phaseLabel: string;
  tone: "positive" | "neutral" | "caution" | "negative" | string;
  confidence: number;
  neckline: string | null;
  confirmation: string;
  invalidation: string;
  action: string;
  implication: string;
  detail: string;
  points: PatternPoint[];
}

export interface PatternAnalysis {
  summary: string;
  dominant: ChartPattern | null;
  patterns: ChartPattern[];
}

export type PriceActionCategory = "trend" | "support" | "resistance" | "volume" | "momentum" | "risk" | string;
export type PriceActionDirection = "bullish" | "bearish" | "neutral" | string;

export interface PriceActionSignal {
  key: string;
  label: string;
  symbol: string;
  symbolLabel: string;
  category: PriceActionCategory;
  direction: PriceActionDirection;
  tone: "positive" | "neutral" | "caution" | "negative" | string;
  strength: number;
  level: string;
  condition: string;
  invalidation: string;
  detail: string;
  ruleType: string;
}

export interface PriceActionSnapshot {
  symbol: string;
  label: string;
  phase:
    | "trend-continuation"
    | "pullback-hold"
    | "breakout-watch"
    | "range-compression"
    | "breakdown"
    | "exhaustion"
    | "risk-cooling"
    | "risk-heating"
    | "unknown"
    | string;
  phaseLabel: string;
  tone: "positive" | "neutral" | "caution" | "negative" | string;
  score: number;
  structureScore: number;
  momentumScore: number;
  riskScore: number;
  support: string;
  resistance: string;
  invalidation: string;
  entryTrigger: string;
  summary: string;
  signals: PriceActionSignal[];
}

export interface PriceActionAnalysis {
  score: number;
  label: string;
  tone: "positive" | "neutral" | "caution" | "negative" | string;
  summary: string;
  primarySignal: PriceActionSignal | null;
  snapshots: PriceActionSnapshot[];
}

export interface AssetStatus {
  symbol: string;
  label: string;
  assetKind?: "holding" | "observer" | "proxy" | "benchmark" | string;
  status: LightStatus;
  statusLabel: string;
  close: number;
  change1d: number | null;
  note: string;
}

export interface TechnicalRow {
  symbol: string;
  label: string;
  cells: TechnicalCell[];
  close: number;
  change1d: number | null;
  return10d: number | null;
  return20d: number | null;
  rsi14: number | null;
  ma20: number | null;
  ma50: number | null;
  ma200: number | null;
  macd: number | null;
  macdSignal: number | null;
  macdHistogram: number | null;
  kdjK: number | null;
  kdjD: number | null;
  kdjJ: number | null;
  volumeRatio: number | null;
  status: LightStatus;
  note: string;
}

export interface TechnicalColumn {
  key: string;
  label: string;
  align: "left" | "right" | "center" | string;
}

export interface TechnicalCell {
  key: string;
  display: string;
  value: number | null;
  tone: "positive" | "negative" | "neutral" | string;
}

export interface SectorStrengthRow {
  symbol: string;
  label: string;
  return20d: number | null;
  relativeToSpy: number | null;
  status: "strong" | "neutral" | "weak" | "unknown";
}

export interface DimensionScore {
  key: string;
  label: string;
  factor: string;
  weight: number;
  score: number;
  rawScore: number;
  triggers: string[];
}

export interface RiskReason {
  dimension: string;
  text: string;
  points: number;
}

export interface SupportEvidence {
  key: string;
  label: string;
  tone: "positive" | "neutral" | "caution" | "negative" | string;
  text: string;
}

export interface ExposureRange {
  min: number;
  max: number;
  display: string;
}

export interface PositionAdvice {
  horizonKey: "short" | "medium" | "long" | string;
  horizonLabel: string;
  action: string;
  adjustment: string;
  targetPosition: string;
  currentRange?: ExposureRange | null;
  addRange?: ExposureRange | null;
  maxCap?: number | null;
  rangeMeaning?: string;
  rangeNote?: string;
  damageScore?: number;
  damageLabel?: string;
  tone: "increase" | "hold" | "caution" | "reduce" | "defensive" | string;
  confidenceScore: number;
  confidenceLabel: string;
  confidenceTone: "positive" | "neutral" | "caution" | "negative" | string;
  confidenceReason?: string;
  gates: ActionGate[];
  rationale: string;
  entryTrigger: string;
  riskTrigger: string;
}

export interface ActionGate {
  key: string;
  label: string;
  status: "pass" | "watch" | "block" | string;
  triggered?: boolean;
  effect?: string;
  tone: "positive" | "neutral" | "caution" | "negative" | string;
  detail: string;
}

export interface PortfolioHolding {
  symbol: string;
  label: string;
  assetKind?: "holding" | "observer" | "proxy" | "benchmark" | string;
  weight: number;
  sector: string;
  style: string;
  exposure: string;
  status: LightStatus;
  statusLabel: string;
  healthScore: number;
  healthTone: "positive" | "neutral" | "caution" | "negative" | string;
  contributionRisk: number;
  return20d: number | null;
  ma20Gap: number | null;
  note: string;
}

export interface PortfolioExposure {
  key: string;
  label: string;
  kind: "sector" | "style" | "exposure" | string;
  weight: number;
  tone: "positive" | "neutral" | "caution" | "negative" | string;
  status: string;
}

export interface PortfolioAction {
  key: string;
  label: string;
  tone: "positive" | "neutral" | "caution" | "negative" | string;
  detail: string;
}

export interface PortfolioProfile {
  totalWeight: number;
  cashWeight: number;
  healthScore: number;
  healthLabel: string;
  healthTone: "positive" | "neutral" | "caution" | "negative" | string;
  concentrationScore: number;
  concentrationLabel: string;
  concentrationTone: "positive" | "neutral" | "caution" | "negative" | string;
  topHoldingWeight: number;
  topHolding: string;
  topSector: string;
  topStyle: string;
  topExposure: string;
  weightedRiskScore: number;
  summary: string;
  holdings: PortfolioHolding[];
  sectorExposure: PortfolioExposure[];
  styleExposure: PortfolioExposure[];
  exposureBreakdown: PortfolioExposure[];
  actions: PortfolioAction[];
}

export interface ForwardReturn {
  days: number;
  available: boolean;
  endDate: string | null;
  returnPct: number | null;
}

export interface BacktestHorizonStat {
  days: number;
  sampleCount: number;
  medianReturnPct: number | null;
  averageReturnPct: number | null;
  averageReturnCiLowPct?: number | null;
  averageReturnCiHighPct?: number | null;
  returnP25Pct?: number | null;
  returnP75Pct?: number | null;
  winRatePct: number | null;
  medianMaxDrawdownPct: number | null;
  tailLossRatePct?: number | null;
  severeDrawdownRatePct?: number | null;
  ma20BreakRatePct: number | null;
  ma50BreakRatePct: number | null;
}

export interface BacktestEventStat {
  key: string;
  label: string;
  value: string;
  tone: "positive" | "neutral" | "caution" | "negative" | string;
  detail: string;
}

export interface StateReplaySample {
  date: string;
  exactStateMatch: boolean;
  pathReturnsPct: number[];
}

export interface StateValidation {
  stateKey: string;
  stateLabel: string;
  sampleCount: number;
  rawSampleCount?: number;
  effectiveSampleCount?: number;
  sampleSpacingDays?: number;
  exactSampleCount?: number;
  similarSampleCount?: number;
  matchMode: string;
  sampleQualityLabel?: string;
  sampleQualityTone?: "positive" | "neutral" | "caution" | "negative" | string;
  sampleNote?: string;
  verdict: string;
  tone: "positive" | "neutral" | "caution" | "negative" | string;
  confidence: string;
  horizonStats: BacktestHorizonStat[];
  eventStats: BacktestEventStat[];
  replaySamples?: StateReplaySample[];
}

export interface ProtocolValidationRow {
  protocolState: string;
  label: string;
  permission: string;
  sampleCount: number;
  medianReturn20Pct: number | null;
  averageReturnCiLow20Pct?: number | null;
  averageReturnCiHigh20Pct?: number | null;
  returnP2520Pct?: number | null;
  returnP7520Pct?: number | null;
  winRate20Pct: number | null;
  medianMaxDrawdown20Pct: number | null;
  tailLossRate20Pct?: number | null;
  severeDrawdownRate20Pct?: number | null;
  ma50BreakRate20Pct: number | null;
  tone: "positive" | "neutral" | "caution" | "negative" | string;
  summary: string;
}

export interface ProtocolValidation {
  currentProtocol: string;
  currentLabel: string;
  sampleCount: number;
  verdict: string;
  tone: "positive" | "neutral" | "caution" | "negative" | string;
  rows: ProtocolValidationRow[];
}

export interface BacktestRule {
  key: string;
  label: string;
  condition: string;
  action: string;
  tone: "positive" | "neutral" | "caution" | "negative" | string;
}

export interface BacktestRuleSet {
  stateRules: BacktestRule[];
  actionRules: BacktestRule[];
  profileRules: BacktestRule[];
}

export interface BacktestSummary {
  date: string;
  score: number;
  spyClose: number;
  benchmarkSymbol: string;
  benchmarkClose: number;
  forwardReturns: ForwardReturn[];
  stateValidation: StateValidation;
  protocolValidation: ProtocolValidation;
  ruleSet: BacktestRuleSet;
}

export interface MarketAnalysisReport {
  generatedAt: string;
  source: string;
  sourceLabel: string;
  providerNote: string;
  profileSchemaVersion?: number;
  profileVersion?: string;
  parentProfile?: string | null;
  asOf: string;
  score: number;
  level: RiskLevel;
  summary: string;
  marketState: MarketState;
  decisionFrame: DecisionFrame;
  stateConfidence?: StateConfidence;
  signalQuality?: SignalQuality;
  damageScore?: DamageScore;
  riskVector?: RiskVectorItem[];
  stateTransitionMatrix?: StateTransitionMatrix;
  decisionMetricContexts: DecisionMetricContext[];
  statusMetrics: StatusMetric[];
  marketInternals: MarketInternals;
  factorScores: FactorScore[];
  opportunityScores: OpportunityScore[];
  structure: StructureAnalysis;
  patternAnalysis: PatternAnalysis;
  priceBarsBySymbol?: Record<string, PriceBar[]>;
  priceAction?: PriceActionAnalysis;
  profileKey: string;
  profileName: string;
  profileMarket: string;
  assetStatuses: AssetStatus[];
  technicalColumns: TechnicalColumn[];
  technicalRows: TechnicalRow[];
  sectorStrength: SectorStrengthRow[];
  dimensionScores: DimensionScore[];
  reasons: RiskReason[];
  supportEvidence: SupportEvidence[];
  guidance: string[];
  positionAdvice: PositionAdvice[];
  portfolioProfile: PortfolioProfile;
  profileMandate: ProfileMandate;
  profileFund: ProfileFund | null;
  profileCalibrationStatus?: ProfileCalibrationStatus;
  recommendationPerformance?: RecommendationPerformanceSummary;
  calibrationAction?: ProfileCalibrationAction;
  executionPolicy?: ProfileExecutionPolicy;
  backtest: BacktestSummary;
  policyNote: string;
}
