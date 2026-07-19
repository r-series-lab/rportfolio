import AddCircleRoundedIcon from "@mui/icons-material/AddCircleRounded";
import AccountBalanceWalletRoundedIcon from "@mui/icons-material/AccountBalanceWalletRounded";
import CandlestickChartRoundedIcon from "@mui/icons-material/CandlestickChartRounded";
import QueryStatsRoundedIcon from "@mui/icons-material/QueryStatsRounded";
import ScienceRoundedIcon from "@mui/icons-material/ScienceRounded";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import ShieldRoundedIcon from "@mui/icons-material/ShieldRounded";
import TrackChangesRoundedIcon from "@mui/icons-material/TrackChangesRounded";
import { useCallback, useEffect, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { isCashHolding, type PositionPlan } from "../lib/position-plan";
import type { HoldingRecord } from "../lib/holdings";
import { syncRealtimeAssetQuote, type RealtimeAssetQuoteSnapshot } from "../lib/realtime-quote";
import { handleTabListKeyDown } from "../lib/tab-keyboard";
import type { AssetStatus, MarketAnalysisReport, PriceActionSnapshot, TechnicalRow } from "../lib/types";
import { formatMoney, formatNumber, formatPercent } from "../lib/utils";
import { Button } from "./ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import "../styles/pages/asset-analysis.css";
import "../styles/pages/asset-analysis-polish.css";

type AssetAnalysisWorkspaceProps = {
  focusSymbol?: string;
  holdings: HoldingRecord[];
  loading: boolean;
  onHoldingsChange: Dispatch<SetStateAction<HoldingRecord[]>>;
  onOpenAnalysis: () => void;
  onOpenHoldings: () => void;
  onOpenQuant: () => void;
  positionPlan: PositionPlan;
  report: MarketAnalysisReport | null;
  reportIsCurrent: boolean;
};

type AssetAnalysisFilter = "all" | "tradable" | "holdings" | "watch" | "profile";
type AssetAnalysisSection = "overview" | "research" | "technical" | "records";
type AssetMobilePane = "universe" | "research" | "actions";

type AssetAnalysisRow = {
  key: string;
  symbol: string;
  label: string;
  sourceLabel: string;
  scopeLabel: string;
  tradable: boolean;
  registered: boolean;
  tone: "positive" | "neutral" | "caution" | "negative";
  close: number;
  change1d: number | null;
  market: string;
  currency: string;
  assetType: HoldingRecord["assetType"];
  holding: HoldingRecord | null;
  asset: AssetStatus | null;
  technical: TechnicalRow | null;
  priceAction: PriceActionSnapshot | null;
};

type AssetResearchTone = "positive" | "neutral" | "caution" | "negative";

type AssetResearchPoint = {
  x: number;
  value: number;
};

type AssetResearchItem = {
  key: string;
  label: string;
  value: string;
  tone: AssetResearchTone;
  detail: string;
};

type AssetResearch = {
  trendLabel: string;
  trendTone: AssetResearchTone;
  trendDetail: string;
  sparkline: AssetResearchPoint[];
  levels: AssetResearchItem[];
  scenarios: AssetResearchItem[];
  playbook: AssetResearchItem[];
};

const FILTERS: Array<{ key: AssetAnalysisFilter; label: string }> = [
  { key: "all", label: "全部" },
  { key: "tradable", label: "可交易" },
  { key: "holdings", label: "持仓" },
  { key: "watch", label: "观察" },
  { key: "profile", label: "Profile" },
];

export function AssetAnalysisWorkspace({
  focusSymbol,
  holdings,
  loading,
  onHoldingsChange,
  onOpenAnalysis,
  onOpenHoldings,
  onOpenQuant,
  positionPlan,
  report,
  reportIsCurrent,
}: AssetAnalysisWorkspaceProps) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<AssetAnalysisFilter>("tradable");
  const [selectedSymbol, setSelectedSymbol] = useState("");
  const [activeSection, setActiveSection] = useState<AssetAnalysisSection>("overview");
  const [mobilePane, setMobilePane] = useState<AssetMobilePane>("research");
  const [liveQuotes, setLiveQuotes] = useState<Record<string, RealtimeAssetQuoteSnapshot>>({});
  const [liveQuoteSyncing, setLiveQuoteSyncing] = useState("");
  const [liveAutoRefresh, setLiveAutoRefresh] = useState(true);
  const [liveQuoteError, setLiveQuoteError] = useState("");
  const rows = useMemo(
    () => report && reportIsCurrent
      ? buildAssetRows({ holdings, report }).filter((row) => row.assetType === "fund" || row.assetType === "etf")
      : [],
    [holdings, report, reportIsCurrent],
  );
  const filteredRows = useMemo(() => filterAssetRows(rows, filter, query), [filter, query, rows]);
  const activeRow = filteredRows.find((row) => sameSymbol(row.symbol, selectedSymbol)) ?? filteredRows[0] ?? null;
  const activeDecision = activeRow ? decisionForAsset(activeRow, positionPlan) : null;
  const activeResearch = activeRow && activeDecision && report ? buildAssetResearch(activeRow, report, positionPlan, activeDecision) : null;
  const activeLiveQuote = activeRow ? liveQuotes[symbolKey(activeRow.symbol)] ?? null : null;
  const counts = useMemo(() => ({
    all: rows.length,
    tradable: rows.filter((row) => row.tradable).length,
    holdings: rows.filter((row) => row.holding?.role === "real").length,
    watch: rows.filter((row) => row.holding?.role === "watch").length,
    profile: rows.filter((row) => !row.holding).length,
  }), [rows]);

  useEffect(() => {
    if (!focusSymbol) return;
    setFilter("all");
    setQuery("");
    setSelectedSymbol(focusSymbol);
    setMobilePane("research");
  }, [focusSymbol]);

  const syncActiveLiveQuote = useCallback(async (options: { silent?: boolean } = {}) => {
    if (!activeRow) return;
    const key = symbolKey(activeRow.symbol);
    setLiveQuoteSyncing(key);
    if (!options.silent) setLiveQuoteError("");
    try {
      const quote = await syncRealtimeAssetQuote({
        market: activeRow.market,
        name: activeRow.label,
        referencePrice: activeRow.close || null,
        symbol: activeRow.symbol,
      });
      setLiveQuotes((current) => ({ ...current, [key]: quote }));
      setLiveQuoteError(quote.accepted ? "" : quote.message);
    } catch (error) {
      setLiveQuoteError(error instanceof Error ? error.message : "实时行情同步失败");
    } finally {
      setLiveQuoteSyncing((current) => current === key ? "" : current);
    }
  }, [activeRow]);

  useEffect(() => {
    if (!activeRow || !reportIsCurrent) return;
    void syncActiveLiveQuote({ silent: true });
  }, [activeRow?.symbol, reportIsCurrent, syncActiveLiveQuote]);

  useEffect(() => {
    if (!activeRow || !liveAutoRefresh || !reportIsCurrent) return;
    const timer = window.setInterval(() => {
      void syncActiveLiveQuote({ silent: true });
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [activeRow?.symbol, liveAutoRefresh, reportIsCurrent, syncActiveLiveQuote]);

  const handleRegisterWatch = () => {
    if (!activeRow || !report) return;
    if (activeRow.registered) {
      onOpenHoldings();
      return;
    }
    const nextHolding = createWatchHolding(activeRow, report);
    onHoldingsChange((current) => {
      if (current.some((holding) => sameSymbol(holding.symbol, nextHolding.symbol))) return current;
      return [nextHolding, ...current];
    });
    setFilter("watch");
    setSelectedSymbol(nextHolding.symbol);
  };

  if (!report || !reportIsCurrent) {
    return (
      <section className="asset-analysis-page" aria-label="基金和 ETF 研究">
        <div className="asset-analysis-empty">
          <TrackChangesRoundedIcon fontSize="inherit" />
          <div>
            <strong>{loading ? "正在准备持仓研究" : "等待组合数据"}</strong>
            <span>{loading ? "组合输出后会生成基金与 ETF 研究视图。" : "先刷新组合决策，再查看当前持仓的证据与边界。"}</span>
          </div>
          <button type="button" onClick={onOpenAnalysis}>组合决策</button>
        </div>
      </section>
    );
  }

  return (
    <section className="asset-analysis-page" aria-label="基金和 ETF 研究">
      <header className="asset-analysis-header">
        <div>
          <span>
            <TrackChangesRoundedIcon fontSize="inherit" />
            持仓研究
          </span>
          <h1>{activeRow ? `${activeRow.symbol} · ${activeRow.label}` : "基金 / ETF 研究"}</h1>
        </div>
        <div className="asset-analysis-header-stats" aria-label="标的池摘要">
          <Button type="button" size="sm" variant="outline" onClick={onOpenHoldings}>
            <AccountBalanceWalletRoundedIcon fontSize="inherit" />
            返回持仓
          </Button>
          <CompactAssetStat label="可交易" value={`${counts.tradable}`} tone="positive" />
          <CompactAssetStat label="观察" value={`${counts.watch}`} tone="caution" />
          <CompactAssetStat label="Profile" value={`${counts.profile}`} tone="neutral" />
        </div>
      </header>

      <nav className="asset-analysis-mobile-nav" role="tablist" aria-label="研究工作区" onKeyDown={handleTabListKeyDown}>
        <button
          type="button"
          role="tab"
          aria-selected={mobilePane === "universe"}
          tabIndex={mobilePane === "universe" ? 0 : -1}
          className={mobilePane === "universe" ? "is-active" : undefined}
          onClick={() => setMobilePane("universe")}
        >
          <SearchRoundedIcon fontSize="inherit" />
          标的
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mobilePane === "research"}
          tabIndex={mobilePane === "research" ? 0 : -1}
          className={mobilePane === "research" ? "is-active" : undefined}
          onClick={() => setMobilePane("research")}
        >
          <QueryStatsRoundedIcon fontSize="inherit" />
          研究
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mobilePane === "actions"}
          tabIndex={mobilePane === "actions" ? 0 : -1}
          className={mobilePane === "actions" ? "is-active" : undefined}
          onClick={() => setMobilePane("actions")}
        >
          <ShieldRoundedIcon fontSize="inherit" />
          动作
        </button>
      </nav>

      <div className="asset-analysis-grid">
        <aside className={`asset-analysis-picker ${mobilePane === "universe" ? "is-mobile-pane-active" : ""}`} aria-label="标的池">
          <div className="asset-analysis-search">
            <SearchRoundedIcon fontSize="inherit" />
            <input
              id="asset-analysis-search"
              name="asset-analysis-search"
              aria-label="搜索标的"
              placeholder="搜索代码或名称"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <div className="asset-analysis-filters" role="tablist" aria-label="标的范围" onKeyDown={handleTabListKeyDown}>
            {FILTERS.map((item) => (
              <button
                key={item.key}
                type="button"
                role="tab"
                aria-selected={filter === item.key}
                tabIndex={filter === item.key ? 0 : -1}
                className={filter === item.key ? "is-active" : undefined}
                onClick={() => setFilter(item.key)}
              >
                <span>{item.label}</span>
                <strong>{counts[item.key]}</strong>
              </button>
            ))}
          </div>
          <div className="asset-analysis-list" aria-label="标的列表">
            {filteredRows.length ? filteredRows.map((row) => (
              <button
                key={row.key}
                type="button"
                className={`is-${row.tone} ${activeRow?.key === row.key ? "is-active" : ""}`}
                onClick={() => {
                  setSelectedSymbol(row.symbol);
                  setMobilePane("research");
                }}
              >
                <div>
                  <strong>{row.symbol}</strong>
                  <span>{row.label}</span>
                </div>
                <em>{row.sourceLabel}</em>
                <small>{formatPercent(row.change1d)}</small>
              </button>
            )) : (
              <div className="asset-analysis-no-results">
                <strong>没有匹配标的</strong>
                <span>换个关键词或切回全部范围。</span>
              </div>
            )}
          </div>
        </aside>

        <main className={`asset-analysis-main ${mobilePane === "research" ? "is-mobile-pane-active" : ""}`} aria-label="基金和 ETF 研究详情">
          {activeRow && activeDecision ? (
            <>
              <LiveQuoteCard
                error={liveQuoteError}
                quote={activeLiveQuote}
                row={activeRow}
                autoRefresh={liveAutoRefresh}
                syncing={liveQuoteSyncing === symbolKey(activeRow.symbol)}
                onRefresh={() => void syncActiveLiveQuote()}
                onToggleAuto={() => setLiveAutoRefresh((current) => !current)}
              />

              <Tabs value={activeSection} onValueChange={(value) => setActiveSection(value as AssetAnalysisSection)} className="asset-detail-tabs">
                <TabsList className="asset-detail-tabs-list" aria-label="研究分类">
                  <TabsTrigger value="overview">概览</TabsTrigger>
                  <TabsTrigger value="research">研究</TabsTrigger>
                  <TabsTrigger value="technical">技术</TabsTrigger>
                  <TabsTrigger value="records">记录</TabsTrigger>
                </TabsList>

                <TabsContent value="overview" className="asset-detail-tab-panel">
                  <section className={`asset-focus-card is-${activeDecision.tone}`}>
                    <div className="asset-focus-title">
                      <div>
                        <span>{activeRow.scopeLabel}</span>
                        <strong>{activeDecision.actionLabel}</strong>
                        <p>{activeDecision.summary}</p>
                      </div>
                      <em>{activeRow.tradable ? "可交易" : activeRow.registered ? "已登记" : "研究"}</em>
                    </div>
                    <div className="asset-focus-metrics" aria-label="核心指标">
                      <Metric label="价格" value={formatPrice(activeRow.close, activeRow.symbol)} />
                      <Metric label="日涨跌" value={formatPercent(activeRow.change1d)} tone={moveTone(activeRow.change1d)} />
                      <Metric label="RSI" value={formatNullable(activeRow.technical?.rsi14, 1)} tone={rsiTone(activeRow.technical?.rsi14)} />
                      <Metric label="20日" value={formatPercent(activeRow.technical?.return20d)} tone={moveTone(activeRow.technical?.return20d)} />
                      <Metric label="结构" value={activeRow.priceAction?.phaseLabel ?? "—"} tone={activeRow.priceAction?.tone as AssetResearchTone ?? "neutral"} />
                    </div>
                  </section>

                  {activeResearch ? (
                    <section className="asset-analysis-band">
                      <PanelTitle icon={<TrackChangesRoundedIcon fontSize="inherit" />} title="下一步" />
                      <div className="asset-playbook-grid is-compact">
                        {activeResearch.playbook.slice(0, 3).map((item) => (
                          <ResearchItem key={item.key} item={item} />
                        ))}
                      </div>
                    </section>
                  ) : null}
                </TabsContent>

                <TabsContent value="research" className="asset-detail-tab-panel">
                  {activeResearch ? (
                    <section className="asset-research-grid" aria-label="单标研究预览">
                      <article className={`asset-research-card is-${activeResearch.trendTone}`}>
                        <PanelTitle icon={<QueryStatsRoundedIcon fontSize="inherit" />} title="走势预览" />
                        <div className="asset-trend-summary">
                          <strong>{activeResearch.trendLabel}</strong>
                          <span>{activeResearch.trendDetail}</span>
                        </div>
                        <AssetSparkline points={activeResearch.sparkline} tone={activeResearch.trendTone} />
                        <div className="asset-level-grid">
                          {activeResearch.levels.map((item) => (
                            <ResearchItem key={item.key} item={item} />
                          ))}
                        </div>
                      </article>

                      <article className={`asset-research-card is-${activeResearch.scenarios[0]?.tone ?? "neutral"}`}>
                        <PanelTitle icon={<ScienceRoundedIcon fontSize="inherit" />} title="情景回测" />
                        <div className="asset-scenario-grid">
                          {activeResearch.scenarios.map((item) => (
                            <ResearchItem key={item.key} item={item} />
                          ))}
                        </div>
                      </article>
                    </section>
                  ) : null}
                </TabsContent>

                <TabsContent value="technical" className="asset-detail-tab-panel">
                  <section className="asset-analysis-band">
                    <PanelTitle icon={<CandlestickChartRoundedIcon fontSize="inherit" />} title="技术状态" />
                    <div className="asset-diagnostic-grid">
                      {technicalChecks(activeRow).map((item) => (
                        <DiagnosticItem key={item.key} detail={item.detail} label={item.label} tone={item.tone} value={item.value} />
                      ))}
                    </div>
                  </section>

                  <section className="asset-analysis-band">
                    <PanelTitle icon={<ShieldRoundedIcon fontSize="inherit" />} title="交易边界" />
                    <div className="asset-diagnostic-grid">
                      {boundaryChecks(activeRow, activeDecision).map((item) => (
                        <DiagnosticItem key={item.key} detail={item.detail} label={item.label} tone={item.tone} value={item.value} />
                      ))}
                    </div>
                  </section>
                </TabsContent>

                <TabsContent value="records" className="asset-detail-tab-panel">
                  <section className="asset-position-card">
                    <PanelTitle icon={<AccountBalanceWalletRoundedIcon fontSize="inherit" />} title="本地记录" />
                    <div className="asset-position-list">
                      <Metric label="角色" value={activeRow.holding ? holdingRoleLabel(activeRow.holding) : "Profile 标的"} />
                      <Metric label="数量" value={activeRow.holding ? formatNumber(activeRow.holding.quantity, activeRow.holding.quantity >= 100 ? 0 : 4) : "—"} />
                      <Metric label="成本" value={activeRow.holding ? formatNumber(activeRow.holding.costPrice, 3) : "—"} />
                      <Metric label="市值" value={activeRow.holding ? formatMoney(activeRow.holding.quantity * activeRow.holding.currentPrice, activeRow.currency) : "—"} />
                      <Metric label="目标" value={activeRow.holding ? `${formatNumber(activeRow.holding.targetWeight, 1)}%` : "—"} />
                      <Metric label="来源" value={activeRow.sourceLabel} />
                    </div>
                  </section>
                </TabsContent>
              </Tabs>
            </>
          ) : (
            <section className="asset-analysis-empty">
              <SearchRoundedIcon fontSize="inherit" />
              <div>
                <strong>{rows.length ? "当前范围没有标的" : "没有可分析标的"}</strong>
                <span>{rows.length ? "切换分类或调整搜索条件。" : "当前 Profile 没有返回技术指标或资产灯号。"}</span>
              </div>
            </section>
          )}
        </main>

        <aside className={`asset-analysis-rail workspace-inspector-rail ${mobilePane === "actions" ? "is-mobile-pane-active" : ""}`} aria-label="标的动作">
          {activeRow && activeDecision ? (
            <>
              <section className={`asset-action-card is-${activeDecision.tone}`}>
                <div>
                  <span>操作建议</span>
                  <strong>{activeDecision.actionLabel}</strong>
                  <p>{activeDecision.detail}</p>
                </div>
                <div className="asset-action-buttons">
                  {!activeRow.registered ? (
                    <Button type="button" size="sm" onClick={handleRegisterWatch}>
                      <AddCircleRoundedIcon fontSize="inherit" />
                      加入观察
                    </Button>
                  ) : (
                    <Button type="button" size="sm" variant="outline" onClick={onOpenHoldings}>
                      <AccountBalanceWalletRoundedIcon fontSize="inherit" />
                      持仓管理
                    </Button>
                  )}
                  <Button type="button" size="sm" variant="outline" onClick={activeRow.tradable ? onOpenQuant : onOpenAnalysis}>
                    {activeRow.tradable ? <ScienceRoundedIcon fontSize="inherit" /> : <QueryStatsRoundedIcon fontSize="inherit" />}
                    {activeRow.tradable ? "量化交易" : "组合决策"}
                  </Button>
                </div>
              </section>

              <LiveMarketRailCard quote={activeLiveQuote} row={activeRow} />
            </>
          ) : null}
        </aside>
      </div>
    </section>
  );
}

function buildAssetRows({ holdings, report }: { holdings: HoldingRecord[]; report: MarketAnalysisReport }): AssetAnalysisRow[] {
  const holdingsBySymbol = new Map(holdings.map((holding) => [symbolKey(holding.symbol), holding]));
  const assetsBySymbol = new Map(report.assetStatuses.map((asset) => [symbolKey(asset.symbol), asset]));
  const technicalBySymbol = new Map(report.technicalRows.map((row) => [symbolKey(row.symbol), row]));
  const priceActionBySymbol = new Map((report.priceAction?.snapshots ?? []).map((snapshot) => [symbolKey(snapshot.symbol), snapshot]));
  const symbols = new Set<string>([
    ...report.assetStatuses.map((asset) => symbolKey(asset.symbol)),
    ...report.technicalRows.map((row) => symbolKey(row.symbol)),
    ...holdings.map((holding) => symbolKey(holding.symbol)),
  ]);
  return Array.from(symbols).map((symbol) => {
    const holding = holdingsBySymbol.get(symbol) ?? null;
    const asset = assetsBySymbol.get(symbol) ?? null;
    const technical = technicalBySymbol.get(symbol) ?? null;
    const priceAction = priceActionBySymbol.get(symbol) ?? null;
    return assetRowFromSources(symbol, holding, asset, technical, priceAction, report);
  }).sort(compareAssetRows);
}

function assetRowFromSources(
  symbol: string,
  holding: HoldingRecord | null,
  asset: AssetStatus | null,
  technical: TechnicalRow | null,
  priceAction: PriceActionSnapshot | null,
  report: MarketAnalysisReport,
): AssetAnalysisRow {
  const cash = holding ? isCashHolding(holding) : false;
  const tradable = Boolean(holding?.role === "real" && !cash);
  const tone = normalizeTone(technical?.status ?? asset?.status ?? "gray");
  const assetKind = asset?.assetKind ?? "";
  const sourceLabel = holding
    ? holdingSourceLabel(holding, cash)
    : assetKind === "benchmark"
      ? "基准指标"
      : assetKind === "proxy"
        ? "代理标的"
        : "Profile 标的";
  return {
    key: `asset-${symbol}`,
    symbol,
    label: holding?.name || technical?.label || asset?.label || symbol,
    sourceLabel,
    scopeLabel: tradable ? "可交易标的" : holding ? "本地观察资产" : "Profile 研究标的",
    tradable,
    registered: Boolean(holding),
    tone,
    close: firstPositiveNumber(holding?.currentPrice, technical?.close, asset?.close) ?? 0,
    change1d: technical?.change1d ?? asset?.change1d ?? null,
    market: holding?.market || inferMarket(symbol, report.profileMarket),
    currency: holding?.currency || currencyForMarket(inferMarket(symbol, report.profileMarket)),
    assetType: holding?.assetType ?? inferAssetType(symbol, asset?.label ?? technical?.label ?? ""),
    holding,
    asset,
    technical,
    priceAction,
  };
}

function filterAssetRows(rows: AssetAnalysisRow[], filter: AssetAnalysisFilter, query: string) {
  const keyword = query.trim().toLowerCase();
  return rows.filter((row) => {
    if (filter === "tradable" && !row.tradable) return false;
    if (filter === "holdings" && row.holding?.role !== "real") return false;
    if (filter === "watch" && row.holding?.role !== "watch") return false;
    if (filter === "profile" && row.holding) return false;
    if (!keyword) return true;
    return row.symbol.toLowerCase().includes(keyword) || row.label.toLowerCase().includes(keyword);
  });
}

function decisionForAsset(row: AssetAnalysisRow, positionPlan: PositionPlan) {
  const weak = row.tone === "negative" || (row.technical?.return20d ?? 0) < -6 || (row.technical?.rsi14 ?? 50) < 35;
  const overheated = (row.technical?.rsi14 ?? 0) >= 75 || (row.technical?.return20d ?? 0) > 12;
  const aboveTrend = row.technical?.ma20 && row.close > row.technical.ma20;
  const priceBroken = row.priceAction?.tone === "negative" || row.priceAction?.phase === "breakdown";
  const priceConfirmed = row.priceAction?.tone === "positive" && row.priceAction.score >= 68;
  const cashPressure = positionPlan.cashWeight < positionPlan.policy.minCashWeight;
  if (row.tradable && (weak || priceBroken)) {
    return {
      actionLabel: "减仓观察",
      tone: "negative" as const,
      summary: priceBroken ? "价格行为已经转弱，优先控制仓位。" : "该标的处在弱势或风险灯号下，适合先控制仓位。",
      detail: priceBroken ? row.priceAction?.summary ?? "结构破位，先等待修复。" : "本地持仓可以进入量化交易，但应先通过风控和目标带复核。",
    };
  }
  if (row.tradable && overheated) {
    return {
      actionLabel: "防追高",
      tone: "caution" as const,
      summary: "短期热度偏高，适合等待回落或小额模拟。",
      detail: "可交易，但下单前需要关注 RSI、短期涨幅和仓位上限。",
    };
  }
  if (row.tradable && aboveTrend && priceConfirmed && !cashPressure) {
    return {
      actionLabel: "可交易",
      tone: "positive" as const,
      summary: "趋势与价格行为同向，若目标带有空间可进入交易页执行。",
      detail: row.priceAction?.entryTrigger ?? "建议先在量化交易页走风控，再选择手动、模拟或通道执行。",
    };
  }
  if (row.tradable) {
    return {
      actionLabel: row.technical ? "交易前复核" : "补充指标",
      tone: "caution" as const,
      summary: row.technical ? "该标的可进入交易页，但当前信号不足，适合先小额模拟或等待确认。" : "该标的是可交易持仓，但缺少技术指标，建议先补齐行情和指标再执行。",
      detail: "本地持仓可以进入量化交易；下单前仍需经过风控、目标带和执行方式确认。",
    };
  }
  if (row.registered) {
    return {
      actionLabel: "继续观察",
      tone: "caution" as const,
      summary: "该标的已在本地资产池，但还不应直接交易。",
      detail: "可以在持仓管理里调整角色、目标带和成本，再决定是否转为本地持仓。",
    };
  }
  return {
    actionLabel: "加入观察",
    tone: "neutral" as const,
    summary: "这是 Profile 里的研究标的，先进入观察池再评估是否可交易。",
    detail: "加入观察不会进入委托队列；转为本地持仓后才会被量化交易识别。",
  };
}

function technicalChecks(row: AssetAnalysisRow) {
  const technical = row.technical;
  const checks = [
    {
      key: "trend",
      label: "趋势",
      value: technical?.ma20 && row.close > technical.ma20 ? "站上 MA20" : technical?.ma20 ? "低于 MA20" : "缺少均线",
      tone: technical?.ma20 && row.close > technical.ma20 ? "positive" as const : technical?.ma20 ? "caution" as const : "neutral" as const,
      detail: technical?.note || row.asset?.note || "等待技术指标。",
    },
    {
      key: "rsi",
      label: "热度",
      value: formatNullable(technical?.rsi14, 1),
      tone: rsiTone(technical?.rsi14),
      detail: rsiDetail(technical?.rsi14),
    },
    {
      key: "volume",
      label: "量能",
      value: technical?.volumeRatio ? `${formatNumber(technical.volumeRatio, 2)}x` : "—",
      tone: technical?.volumeRatio && technical.volumeRatio > 1.6 ? "caution" as const : "neutral" as const,
      detail: technical?.volumeRatio && technical.volumeRatio > 1.6 ? "放量波动，交易前需确认方向。" : "量能没有明显异常。",
    },
    {
      key: "return",
      label: "20日表现",
      value: formatPercent(technical?.return20d),
      tone: moveTone(technical?.return20d),
      detail: "用于判断短期强弱和是否追高。",
    },
  ];
  if (row.priceAction) {
    checks.unshift({
      key: "price-action",
      label: "价格行为",
      value: `${row.priceAction.phaseLabel} ${formatNumber(row.priceAction.score, 0)}`,
      tone: row.priceAction.tone as "positive" | "neutral" | "caution" | "negative",
      detail: row.priceAction.entryTrigger,
    });
    checks.push({
      key: "invalidation",
      label: "失效线",
      value: row.priceAction.invalidation,
      tone: row.priceAction.tone === "negative" ? "negative" as const : "caution" as const,
      detail: row.priceAction.summary,
    });
  }
  return checks;
}

function boundaryChecks(row: AssetAnalysisRow, decision: ReturnType<typeof decisionForAsset>) {
  return [
    {
      key: "scope",
      label: "交易范围",
      value: row.tradable ? "可进入交易" : "研究/观察",
      tone: row.tradable ? "positive" as const : "caution" as const,
      detail: row.tradable ? "本地持仓且非现金，可被量化交易页识别。" : "不会直接进入委托队列。",
    },
    {
      key: "registry",
      label: "资产登记",
      value: row.registered ? "已登记" : "未登记",
      tone: row.registered ? "positive" as const : "neutral" as const,
      detail: row.registered ? "可以在持仓管理中维护目标带。" : "加入观察后再维护成本和目标带。",
    },
    {
      key: "decision",
      label: "动作",
      value: decision.actionLabel,
      tone: decision.tone,
      detail: decision.detail,
    },
  ];
}

function buildAssetResearch(row: AssetAnalysisRow, report: MarketAnalysisReport, positionPlan: PositionPlan, decision: ReturnType<typeof decisionForAsset>): AssetResearch {
  const hasTechnical = Boolean(row.technical);
  const return20d = finiteNumber(row.technical?.return20d) ?? finiteNumber(row.change1d) ?? 0;
  const ma20Gap = row.technical?.ma20 && row.close ? ((row.close - row.technical.ma20) / row.technical.ma20) * 100 : null;
  const rsi = finiteNumber(row.technical?.rsi14);
  const rsiEffect = rsi == null ? 0 : (rsi - 50) * 0.45;
  const heatPenalty = rsi != null && (rsi >= 75 || rsi <= 28) ? 8 : 0;
  const priceActionScore = row.priceAction?.score ?? null;
  const trendScore = clamp((hasTechnical ? 50 : 38) + return20d * 1.15 + (ma20Gap ?? 0) * 1.8 + rsiEffect - heatPenalty + (priceActionScore == null ? 0 : (priceActionScore - 55) * 0.35), 0, 100);
  const trendTone = scoreTone(trendScore);
  const trendLabel = row.priceAction?.phaseLabel ?? (hasTechnical ? trendLabelForScore(trendScore) : "等待行情补齐");
  const support = row.priceAction?.support ?? formatPrice(firstPositiveNumber(row.technical?.ma20, row.technical?.ma50, row.close ? row.close * 0.96 : null) ?? 0, row.symbol);
  const resistance = row.priceAction?.resistance ?? formatPrice(row.close ? row.close * (return20d > 8 ? 1.03 : return20d < -6 ? 1.08 : 1.06) : 0, row.symbol);
  const invalidation = row.priceAction?.invalidation ?? formatPrice(firstPositiveNumber(row.technical?.ma50, row.close ? row.close * 0.93 : null) ?? 0, row.symbol);
  const horizon20 = report.backtest.stateValidation.horizonStats.find((item) => item.days === 20) ?? report.backtest.stateValidation.horizonStats[0] ?? null;
  const strategyTone = row.tradable ? decision.tone : row.registered ? "caution" : "neutral";
  const cashBlocked = row.tradable && positionPlan.cashWeight < positionPlan.policy.minCashWeight;

  return {
    trendLabel,
    trendTone: row.priceAction?.tone as AssetResearchTone ?? trendTone,
    trendDetail: row.priceAction
      ? `${row.priceAction.summary} 进入条件：${row.priceAction.entryTrigger}。`
      : hasTechnical
      ? `基于 20日表现、MA20 偏离和 RSI 估算，趋势适配度 ${formatNumber(trendScore, 0)}/100。`
      : "当前只有持仓价格或 Profile 灯号，先把行情/指标补齐再做交易判断。",
    sparkline: buildProxySparkline(row),
    levels: [
      {
        key: "price",
        label: "现价",
        value: formatPrice(row.close, row.symbol),
        tone: "neutral",
        detail: row.holding ? "来自本地持仓或行情同步。" : "来自 Profile 技术行或资产灯号。",
      },
      {
        key: "support",
        label: "支撑",
        value: support,
        tone: row.priceAction?.tone === "negative" ? "negative" : "positive",
        detail: row.priceAction ? "来自价格行为引擎的关键支撑位。" : "优先使用 MA20/MA50；没有均线时用现价下方代理线。",
      },
      {
        key: "resistance",
        label: "压力",
        value: resistance,
        tone: "neutral",
        detail: row.priceAction ? "来自当前结构的突破观察位。" : "用于判断追高空间，真实阻力位后续应由 K 线结构确认。",
      },
      {
        key: "invalidation",
        label: "失效线",
        value: invalidation,
        tone: "negative",
        detail: "跌破后不再按当前观察逻辑加仓，应重新评估。",
      },
    ],
    scenarios: [
      {
        key: "profile-sample",
        label: "环境样本",
        value: horizon20 ? `${horizon20.sampleCount}` : "—",
        tone: sampleTone(horizon20?.sampleCount ?? 0),
        detail: `来自 ${report.backtest.stateValidation.stateLabel} 的历史相似环境，不是该标的独立回测。`,
      },
      {
        key: "win-rate",
        label: "20日胜率",
        value: formatPercent(horizon20?.winRatePct, 1),
        tone: percentTone(horizon20?.winRatePct, 55, 45),
        detail: "衡量当前 Profile 状态下，未来 20 日正收益概率。",
      },
      {
        key: "median-return",
        label: "20日中位",
        value: formatPercent(horizon20?.medianReturnPct, 2),
        tone: moveTone(horizon20?.medianReturnPct),
        detail: "作为方向参考；单个标的需再叠加自身趋势强弱。",
      },
      {
        key: "drawdown",
        label: "中位回撤",
        value: formatPercent(horizon20?.medianMaxDrawdownPct, 2),
        tone: drawdownTone(horizon20?.medianMaxDrawdownPct),
        detail: "用于估算模拟交易或手动下单前的容忍波动。",
      },
      {
        key: "asset-fit",
        label: "单标修正",
        value: `${formatNumber(trendScore, 0)}/100`,
        tone: trendTone,
        detail: "用当前标的趋势、热度和均线状态修正组合级环境。",
      },
    ],
    playbook: [
      {
        key: "entry",
        label: "进入路径",
        value: row.tradable ? "量化交易" : row.registered ? "持仓维护" : "加入观察",
        tone: strategyTone,
        detail: row.tradable ? "本地持仓可进入交易页，再选择手动、模拟或通道执行。" : row.registered ? "先补角色、成本和目标带，再决定是否转本地持仓。" : "先进入观察池，不直接进入委托队列。",
      },
      {
        key: "price-action",
        label: "价格行为",
        value: row.priceAction ? `${row.priceAction.score}/100` : "待补齐",
        tone: row.priceAction?.tone as AssetResearchTone ?? "neutral",
        detail: row.priceAction?.entryTrigger ?? "等待价格行为分析。",
      },
      {
        key: "execution",
        label: "执行方式",
        value: executionRouteLabel(row, decision),
        tone: decision.tone,
        detail: executionRouteDetail(row, decision),
      },
      {
        key: "cash",
        label: "资金约束",
        value: cashBlocked ? "现金偏紧" : "预算可用",
        tone: cashBlocked ? "caution" : "positive",
        detail: cashBlocked ? "现金低于策略下限，新增买入需要更严格。" : "资金约束没有阻止研究或模拟。",
      },
      {
        key: "review",
        label: "复盘周期",
        value: row.tradable ? "每日模拟" : "观察复核",
        tone: row.tradable ? "positive" : "neutral",
        detail: row.tradable ? "适合纳入自动模拟交易，隔一段时间看真实规则效果。" : "先观察信号是否持续，再决定是否转入真实交易池。",
      },
    ],
  };
}

function createWatchHolding(row: AssetAnalysisRow, report: MarketAnalysisReport): HoldingRecord {
  const symbol = symbolKey(row.symbol);
  const price = firstPositiveNumber(row.close, row.technical?.close, row.asset?.close) ?? 0;
  const market = row.market || inferMarket(symbol, report.profileMarket);
  return {
    id: `watch-${symbol.toLowerCase()}-${Date.now()}`,
    symbol,
    name: row.label || symbol,
    market,
    currency: row.currency || currencyForMarket(market),
    role: "watch",
    assetType: row.assetType,
    quoteSource: market === "CN" ? "manual" : "yahoo",
    profileKey: report.profileKey,
    quantity: 0,
    costPrice: price,
    currentPrice: price,
    targetWeight: 0,
    notes: `由基金 / ETF 研究从 ${report.profileName} 加入观察。`,
  };
}

function PanelTitle({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <div className="asset-analysis-panel-title">
      {icon}
      <strong>{title}</strong>
    </div>
  );
}

function CompactAssetStat({ label, tone, value }: { label: string; tone: "positive" | "neutral" | "caution" | "negative"; value: string }) {
  return (
    <span className={`asset-compact-stat is-${tone}`}>
      <em>{label}</em>
      <strong>{value}</strong>
    </span>
  );
}

function Metric({ label, tone = "neutral", value }: { label: string; tone?: "positive" | "neutral" | "caution" | "negative"; value: string }) {
  return (
    <span className={`asset-metric is-${tone}`}>
      <em>{label}</em>
      <strong>{value}</strong>
    </span>
  );
}

function DiagnosticItem({ detail, label, tone, value }: { detail: string; label: string; tone: "positive" | "neutral" | "caution" | "negative"; value: string }) {
  return (
    <article className={`asset-diagnostic-item is-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{detail}</p>
    </article>
  );
}

function ResearchItem({ item }: { item: AssetResearchItem }) {
  return (
    <article className={`asset-research-item is-${item.tone}`}>
      <span>{item.label}</span>
      <strong>{item.value}</strong>
      <p>{item.detail}</p>
    </article>
  );
}

function AssetSparkline({ points, tone }: { points: AssetResearchPoint[]; tone: AssetResearchTone }) {
  const polyline = sparklinePolyline(points);
  const endPoint = points[points.length - 1]?.value ?? 100;
  const startPoint = points[0]?.value ?? 100;
  return (
    <div className={`asset-research-sparkline is-${tone}`}>
      <svg viewBox="0 0 100 44" preserveAspectRatio="none" aria-hidden="true">
        <line x1="0" x2="100" y1="30" y2="30" />
        <polyline points={polyline} />
      </svg>
      <div>
        <span>20日代理线</span>
        <strong>{formatPercent(endPoint - startPoint, 2)}</strong>
      </div>
    </div>
  );
}

function LiveQuoteCard({
  autoRefresh,
  error,
  onRefresh,
  onToggleAuto,
  quote,
  row,
  syncing,
}: {
  autoRefresh: boolean;
  error: string;
  onRefresh: () => void;
  onToggleAuto: () => void;
  quote: RealtimeAssetQuoteSnapshot | null;
  row: AssetAnalysisRow;
  syncing: boolean;
}) {
  const last = quote?.last ?? row.close;
  const changePct = quote?.changePct ?? row.change1d;
  const change = quote?.change ?? null;
  const tone = moveTone(changePct);
  const statusTone = quote?.accepted ? "positive" : quote ? "caution" : "neutral";
  return (
    <section className={`asset-live-card is-${statusTone}`} aria-label="实时行情">
      <div className="asset-live-head">
        <div>
          <span>
            <i />
            {quote?.accepted ? "实时" : quote ? "准实时" : "待同步"}
          </span>
          <strong>{row.symbol} · {row.label}</strong>
          <p>{quote ? `${quote.sourceLabel} · ${quoteSessionLabel(quote.session)} · ${formatSyncTime(quote.syncedAt)}` : "打开页面后会自动同步行情。"}</p>
        </div>
        <div className="asset-live-actions">
          <button type="button" className={autoRefresh ? "is-active" : undefined} onClick={onToggleAuto}>
            {autoRefresh ? "自动刷新" : "手动刷新"}
          </button>
          <Button type="button" size="sm" variant="outline" disabled={syncing} onClick={onRefresh}>
            {syncing ? "同步中" : "同步"}
          </Button>
        </div>
      </div>

      <div className="asset-live-body">
        <div className="asset-live-price-stack">
          <strong className={`is-${tone}`}>{formatPrice(last, row.symbol)}</strong>
          <span className={`is-${tone}`}>{formatSignedPrice(change, row.symbol)} · {formatPercent(changePct)}</span>
          <em>{quote?.message ?? "等待行情源返回。"}</em>
        </div>
        <LiveIntradayChart quote={quote} row={row} />
      </div>

      <div className="asset-live-market-grid" aria-label="实时核心数据">
        <Metric label="今开" value={formatPrice(quote?.open ?? 0, row.symbol)} />
        <Metric label="最高" value={formatPrice(quote?.high ?? 0, row.symbol)} tone="negative" />
        <Metric label="最低" value={formatPrice(quote?.low ?? 0, row.symbol)} tone="positive" />
        <Metric label="成交量" value={formatCompactNumber(quote?.volume)} />
        <Metric label="买一" value={formatPrice(quote?.bid ?? 0, row.symbol)} tone="positive" />
        <Metric label="卖一" value={formatPrice(quote?.ask ?? 0, row.symbol)} tone="negative" />
      </div>

      {quote?.warnings.length || error ? (
        <p className="asset-live-warning">{error || quote?.warnings[0]}</p>
      ) : null}
    </section>
  );
}

function LiveIntradayChart({ quote, row }: { quote: RealtimeAssetQuoteSnapshot | null; row: AssetAnalysisRow }) {
  const points = quote?.points.length ? quote.points : fallbackUiQuotePoints(row.close || 100);
  const line = pricePolyline(points);
  const baseline = quote?.previousClose ?? points[0]?.price ?? row.close;
  const baselineY = priceY(baseline, points);
  const bars = volumeBars(points);
  const tone = moveTone((points[points.length - 1]?.price ?? baseline) - baseline);
  return (
    <div className={`asset-live-chart is-${tone}`}>
      <svg viewBox="0 0 320 150" preserveAspectRatio="none" aria-hidden="true">
        <line className="baseline" x1="0" x2="320" y1={baselineY} y2={baselineY} />
        {bars.map((bar) => (
          <rect key={bar.key} x={bar.x} y={bar.y} width={bar.width} height={bar.height} />
        ))}
        <polyline points={line} />
      </svg>
      <div>
        <span>分时</span>
        <strong>{quote?.points.length ? `${quote.points.length} 点` : "预览线"}</strong>
      </div>
    </div>
  );
}

function LiveMarketRailCard({ quote, row }: { quote: RealtimeAssetQuoteSnapshot | null; row: AssetAnalysisRow }) {
  const book = buildOrderBookRows(quote, row);
  const ticks = buildTapeRows(quote, row);
  return (
    <section className="asset-live-rail-card">
      <PanelTitle icon={<CandlestickChartRoundedIcon fontSize="inherit" />} title="实时盘口" />
      <div className="asset-orderbook" aria-label="盘口代理">
        <div className="asset-orderbook-head">
          <span>盘口代理</span>
          <strong>{quote?.spreadBps ? `${formatNumber(quote.spreadBps, 1)} bps` : "—"}</strong>
        </div>
        {book.map((item) => (
          <div key={item.key} className={`is-${item.side}`}>
            <span>{item.label}</span>
            <strong>{formatPrice(item.price, row.symbol)}</strong>
            <em>{formatCompactNumber(item.size)}</em>
          </div>
        ))}
      </div>
      <div className="asset-tape" aria-label="逐笔时间线">
        <div className="asset-orderbook-head">
          <span>逐笔</span>
          <strong>{quote?.accepted ? "1m" : "预览"}</strong>
        </div>
        {ticks.map((item) => (
          <div key={item.key} className={`is-${item.tone}`}>
            <span>{item.time}</span>
            <strong>{formatPrice(item.price, row.symbol)}</strong>
            <em>{formatCompactNumber(item.volume)}</em>
          </div>
        ))}
      </div>
    </section>
  );
}

function compareAssetRows(left: AssetAnalysisRow, right: AssetAnalysisRow) {
  const priority = rowPriority(left) - rowPriority(right);
  if (priority !== 0) return priority;
  return left.symbol.localeCompare(right.symbol);
}

function rowPriority(row: AssetAnalysisRow) {
  if (row.tradable) return 0;
  if (row.holding?.role === "watch") return 1;
  if (row.holding) return 2;
  return 3;
}

function holdingSourceLabel(holding: HoldingRecord, cash = isCashHolding(holding)) {
  if (cash) return "现金";
  if (holding.role === "real") return "本地持仓";
  if (holding.role === "proxy") return "代理资产";
  return "观察资产";
}

function holdingRoleLabel(holding: HoldingRecord) {
  if (isCashHolding(holding)) return "现金";
  if (holding.role === "real") return "本地持仓";
  if (holding.role === "proxy") return "代理资产";
  return "观察资产";
}

function normalizeTone(status: string): AssetAnalysisRow["tone"] {
  if (status === "green") return "positive";
  if (status === "yellow") return "caution";
  if (status === "red") return "negative";
  return "neutral";
}

function moveTone(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value) || value === 0) return "neutral" as const;
  return value > 0 ? "positive" as const : "negative" as const;
}

function rsiTone(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "neutral" as const;
  if (value >= 75 || value <= 30) return "caution" as const;
  if (value >= 45 && value <= 65) return "positive" as const;
  return "neutral" as const;
}

function rsiDetail(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "缺少 RSI 数据。";
  if (value >= 75) return "短期偏热，容易追高。";
  if (value <= 30) return "短期偏弱，等待修复确认。";
  if (value >= 45 && value <= 65) return "热度相对健康。";
  return "热度中性。";
}

function buildProxySparkline(row: AssetAnalysisRow): AssetResearchPoint[] {
  const return20d = finiteNumber(row.technical?.return20d) ?? finiteNumber(row.change1d) ?? 0;
  const swing = row.technical ? clamp(Math.abs(return20d) * 0.16 + Math.abs(row.change1d ?? 0) * 0.75 + 1.2, 1.2, 7.5) : 0.6;
  return Array.from({ length: 21 }, (_, index) => {
    const progress = index / 20;
    const drift = return20d * progress;
    const wave = Math.sin(progress * Math.PI * 2) * swing * (1 - progress * 0.3);
    const pulse = Math.sin(progress * Math.PI * 5) * swing * 0.24 * (1 - progress);
    const value = index === 20 ? 100 + return20d : 100 + drift + wave + pulse;
    return { x: index, value };
  });
}

function fallbackUiQuotePoints(reference: number) {
  const now = Date.now();
  return Array.from({ length: 36 }, (_, index) => {
    const progress = index / 35;
    const price = reference + Math.sin(progress * Math.PI * 2.7) * reference * 0.002 + (progress - 0.5) * reference * 0.003;
    return {
      time: new Date(now - (35 - index) * 60_000).toISOString(),
      price,
      volume: 0,
    };
  });
}

function pricePolyline(points: Array<{ price: number }>) {
  if (!points.length) return "";
  return points.map((point, index) => {
    const x = points.length <= 1 ? 0 : (index / (points.length - 1)) * 320;
    return `${formatNumber(x, 2)},${formatNumber(priceY(point.price, points), 2)}`;
  }).join(" ");
}

function priceY(price: number, points: Array<{ price: number }>) {
  const values = points.map((point) => point.price).filter((value) => Number.isFinite(value));
  const min = Math.min(...values, price);
  const max = Math.max(...values, price);
  const range = Math.max(max - min, Math.max(Math.abs(max) * 0.002, 1));
  return 18 + (1 - (price - min) / range) * 86;
}

function volumeBars(points: Array<{ volume: number }>) {
  const maxVolume = Math.max(...points.map((point) => point.volume), 1);
  const width = points.length ? Math.max(1.2, 280 / points.length) : 2;
  return points.map((point, index) => {
    const height = point.volume > 0 ? Math.max(2, point.volume / maxVolume * 30) : 2;
    return {
      key: `bar-${index}`,
      x: points.length <= 1 ? 0 : (index / (points.length - 1)) * 314,
      y: 132 - height,
      width,
      height,
    };
  });
}

function buildOrderBookRows(quote: RealtimeAssetQuoteSnapshot | null, row: AssetAnalysisRow) {
  const last = quote?.last ?? row.close;
  const bid = quote?.bid ?? (last ? last * 0.9998 : 0);
  const ask = quote?.ask ?? (last ? last * 1.0002 : 0);
  const volumeSeed = Math.max(100, Math.round((quote?.volume ?? 18_000) / 120));
  const sells = [2, 1].map((level) => ({
    key: `sell-${level}`,
    label: `卖${level}`,
    price: ask ? ask + (level - 1) * Math.max(ask * 0.0004, 0.01) : 0,
    side: "sell" as const,
    size: volumeSeed / level,
  }));
  const buys = [1, 2].map((level) => ({
    key: `buy-${level}`,
    label: `买${level}`,
    price: bid ? bid - (level - 1) * Math.max(bid * 0.0004, 0.01) : 0,
    side: "buy" as const,
    size: volumeSeed / level,
  }));
  return [...sells, ...buys];
}

function buildTapeRows(quote: RealtimeAssetQuoteSnapshot | null, row: AssetAnalysisRow) {
  const points = quote?.points.length ? quote.points : fallbackUiQuotePoints(row.close || 100);
  return points.slice(-5).reverse().map((point, index, list) => {
    const next = list[index + 1]?.price ?? point.price;
    return {
      key: `${point.time}-${index}`,
      time: formatTickTime(point.time),
      price: point.price,
      volume: point.volume,
      tone: point.price >= next ? "positive" as const : "negative" as const,
    };
  });
}

function sparklinePolyline(points: AssetResearchPoint[]) {
  if (!points.length) return "";
  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(max - min, 1);
  return points.map((point, index) => {
    const x = points.length <= 1 ? 0 : (index / (points.length - 1)) * 100;
    const y = 38 - ((point.value - min) / range) * 30;
    return `${formatNumber(x, 2)},${formatNumber(y, 2)}`;
  }).join(" ");
}

function trendLabelForScore(score: number) {
  if (score >= 72) return "趋势可用";
  if (score >= 56) return "趋势中性";
  if (score >= 40) return "等待确认";
  return "偏弱防守";
}

function scoreTone(score: number): AssetResearchTone {
  if (score >= 70) return "positive";
  if (score >= 45) return "caution";
  return "negative";
}

function sampleTone(sampleCount: number): AssetResearchTone {
  if (sampleCount >= 40) return "positive";
  if (sampleCount >= 15) return "caution";
  return "neutral";
}

function percentTone(value: number | null | undefined, positiveLine: number, negativeLine: number): AssetResearchTone {
  if (value == null || !Number.isFinite(value)) return "neutral";
  if (value >= positiveLine) return "positive";
  if (value <= negativeLine) return "negative";
  return "caution";
}

function drawdownTone(value: number | null | undefined): AssetResearchTone {
  if (value == null || !Number.isFinite(value)) return "neutral";
  if (value <= -8) return "negative";
  if (value <= -4) return "caution";
  return "positive";
}

function executionRouteLabel(row: AssetAnalysisRow, decision: ReturnType<typeof decisionForAsset>) {
  if (!row.tradable) return "观察";
  if (decision.tone === "positive") return "模拟 -> 执行";
  if (decision.tone === "negative") return "减仓复核";
  return "自动模拟";
}

function executionRouteDetail(row: AssetAnalysisRow, decision: ReturnType<typeof decisionForAsset>) {
  if (!row.tradable) return "当前不是可交易持仓，不进入手动或通道交易。";
  if (decision.tone === "positive") return "先跑自动模拟，信号稳定后再选择手动交易或通道自动交易。";
  if (decision.tone === "negative") return "优先检查是否减仓或暂停加仓，避免弱势中扩大风险。";
  return "信号不足时让自动模拟先运行，过几天看规则收益和回撤。";
}

function quoteSessionLabel(session: string) {
  if (session === "regular" || session === "open") return "盘中";
  if (session === "pre" || session === "pre_market") return "盘前";
  if (session === "post" || session === "post_market") return "盘后";
  if (session === "closed") return "休市";
  if (session === "preview") return "预览";
  return "时段未知";
}

function formatSyncTime(value: string | null | undefined) {
  if (!value) return "未同步";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未同步";
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function formatTickTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--:--";
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatSignedPrice(value: number | null | undefined, symbol: string) {
  if (value == null || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${formatPrice(Math.abs(value), symbol)}`;
}

function formatCompactNumber(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  if (Math.abs(value) >= 100_000_000) return `${formatNumber(value / 100_000_000, 2)}亿`;
  if (Math.abs(value) >= 10_000) return `${formatNumber(value / 10_000, 2)}万`;
  if (Math.abs(value) >= 1_000) return `${formatNumber(value / 1_000, 1)}k`;
  return formatNumber(value, 0);
}

function formatPrice(value: number, symbol: string) {
  if (!Number.isFinite(value) || value <= 0) return "—";
  return formatNumber(value, symbol === "VIX" ? 1 : value >= 100 ? 2 : 4);
}

function formatNullable(value: number | null | undefined, digits = 2) {
  if (value == null || !Number.isFinite(value)) return "—";
  return formatNumber(value, digits);
}

function inferMarket(symbol: string, profileMarket: string) {
  const normalizedMarket = profileMarket.toUpperCase();
  if (normalizedMarket === "US" || normalizedMarket === "CN" || normalizedMarket === "HK" || normalizedMarket === "GLOBAL") return normalizedMarket === "GLOBAL" ? "Global" : normalizedMarket;
  if (/^\d{6}$/.test(symbol)) return "CN";
  if (/\.HK$/i.test(symbol)) return "HK";
  return "US";
}

function currencyForMarket(market: string) {
  if (market === "US") return "USD";
  if (market === "HK") return "HKD";
  if (market === "Global") return "USD";
  return "CNY";
}

function inferAssetType(symbol: string, label: string): HoldingRecord["assetType"] {
  const text = `${symbol} ${label}`.toUpperCase();
  if (/^\d{6}$/.test(symbol)) return "fund";
  if (text.includes("ETF") || ["SPY", "QQQ", "SMH", "IWM", "DIA", "VTI", "VOO", "TLT", "GLD"].includes(symbol)) return "etf";
  if (symbol === "VIX") return "other";
  return "stock";
}

function symbolKey(symbol: string) {
  return symbol.trim().toUpperCase();
}

function sameSymbol(left: string, right: string) {
  return symbolKey(left) === symbolKey(right);
}

function firstPositiveNumber(...values: Array<number | null | undefined>) {
  return values.find((value) => typeof value === "number" && Number.isFinite(value) && value > 0) ?? null;
}

function finiteNumber(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
