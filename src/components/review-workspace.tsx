import { ArrowDownToLine, ArrowUpFromLine, Camera, CircleDollarSign, ShieldCheck, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import type { AccountRecord } from "../lib/accounts";
import type { ExecutionAttributionSummary } from "../lib/execution-attribution";
import { buildDailyCloseReadiness } from "../lib/daily-close";
import type { HoldingRecord } from "../lib/holdings";
import {
  appendExternalCashFlow,
  calculatePortfolioAttribution,
  createExternalCashFlow,
  createPortfolioSnapshot,
  removeExternalCashFlow,
  upsertPerformanceSnapshot,
  type ExternalCashFlowKind,
  type PerformanceLedger,
} from "../lib/performance-ledger";
import type { PortfolioValuationSettings, SupportedCurrency } from "../lib/portfolio-valuation";
import type { PositionPlan } from "../lib/position-plan";
import { buildPromotionGate } from "../lib/promotion-gate";
import type { RecommendationRecord } from "../lib/recommendation-log";
import { handleTabListKeyDown } from "../lib/tab-keyboard";
import type { TradeRecord } from "../lib/trades";
import type { MarketAnalysisReport } from "../lib/types";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { RecommendationOutcomePanel } from "./recommendation-outcome-panel";
import "../styles/pages/review.css";

type ReviewTab = "performance" | "cash-flows" | "outcomes" | "promotion";

type ReviewWorkspaceProps = {
  accounts: AccountRecord[];
  attribution: ExecutionAttributionSummary;
  holdings: HoldingRecord[];
  ledger: PerformanceLedger;
  onLedgerChange: Dispatch<SetStateAction<PerformanceLedger>>;
  performancePersistenceMessage: string;
  positionPlan: PositionPlan;
  recommendationRecords: RecommendationRecord[];
  report: MarketAnalysisReport | null;
  reportIsCurrent: boolean;
  trades: TradeRecord[];
  valuation: PortfolioValuationSettings;
};

const REVIEW_TABS: Array<{ key: ReviewTab; label: string }> = [
  { key: "performance", label: "收益归因" },
  { key: "cash-flows", label: "现金流" },
  { key: "outcomes", label: "建议结果" },
  { key: "promotion", label: "版本晋级" },
];

export function ReviewWorkspace({
  accounts,
  attribution,
  holdings,
  ledger,
  onLedgerChange,
  performancePersistenceMessage,
  positionPlan,
  recommendationRecords,
  report,
  reportIsCurrent,
  trades,
  valuation,
}: ReviewWorkspaceProps) {
  const today = new Date().toISOString().slice(0, 10);
  const [activeTab, setActiveTab] = useState<ReviewTab>("performance");
  const [snapshotDate, setSnapshotDate] = useState(reportIsCurrent && report?.asOf ? report.asOf : today);
  const [message, setMessage] = useState("");
  const [cashFlowOpen, setCashFlowOpen] = useState(false);
  const [flowKind, setFlowKind] = useState<ExternalCashFlowKind>("deposit");
  const [flowDate, setFlowDate] = useState(today);
  const [flowAccountId, setFlowAccountId] = useState(accounts.find((account) => account.status === "active")?.id ?? "");
  const [flowCurrency, setFlowCurrency] = useState<SupportedCurrency>(valuation.baseCurrency);
  const [flowAmount, setFlowAmount] = useState("");
  const [flowNote, setFlowNote] = useState("");
  const performance = useMemo(() => calculatePortfolioAttribution(ledger), [ledger]);
  const promotion = useMemo(() => buildPromotionGate(recommendationRecords), [recommendationRecords]);
  const dailyClose = useMemo(() => buildDailyCloseReadiness({
    accounts,
    date: snapshotDate,
    holdings,
    ledger,
    positionPlan,
    report,
    reportIsCurrent,
    valuation,
  }), [accounts, holdings, ledger, positionPlan, report, reportIsCurrent, snapshotDate, valuation]);

  useEffect(() => {
    if (reportIsCurrent && report?.asOf) setSnapshotDate(report.asOf);
  }, [report?.asOf, reportIsCurrent]);

  const recordSnapshot = () => {
    if (!dailyClose.canCapture) {
      setMessage(dailyClose.detail);
      return;
    }
    const benchmarkAligned = Boolean(reportIsCurrent && report?.asOf === snapshotDate);
    const snapshot = createPortfolioSnapshot({
      asOf: snapshotDate,
      benchmarkLevel: benchmarkAligned ? report?.backtest.benchmarkClose : null,
      benchmarkSymbol: benchmarkAligned ? report?.backtest.benchmarkSymbol : "",
      holdings,
      note: benchmarkAligned ? "组合估值与 Profile 基准同日。" : "组合估值；该日缺少同日基准点。",
      portfolioValue: positionPlan.totalValue,
      trades,
      valuation,
    });
    onLedgerChange((current) => upsertPerformanceSnapshot(current, snapshot));
    setMessage(`${snapshot.date} 估值已记录${benchmarkAligned ? "，已带入同日基准" : ""}。`);
  };

  const openCashFlow = (kind: ExternalCashFlowKind) => {
    const account = accounts.find((item) => item.id === flowAccountId)
      ?? accounts.find((item) => item.status === "active");
    setFlowKind(kind);
    setFlowAccountId(account?.id ?? "");
    setFlowCurrency(account?.currency ?? valuation.baseCurrency);
    setFlowAmount("");
    setFlowNote("");
    setCashFlowOpen(true);
  };

  const submitCashFlow = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const flow = createExternalCashFlow({
      accountId: flowAccountId,
      amount: Number(flowAmount),
      currency: flowCurrency,
      date: flowDate,
      kind: flowKind,
      note: flowNote,
      valuation,
    });
    if (!flow) {
      setMessage("现金流日期、金额或汇率无效，请检查后重试。");
      return;
    }
    onLedgerChange((current) => appendExternalCashFlow(current, flow));
    setCashFlowOpen(false);
    setMessage(`${flow.date} ${flow.kind === "deposit" ? "入金" : "出金"}已登记。`);
  };

  return (
    <section className="review-workspace" aria-label="复盘归因">
      <header className="review-workspace-head">
        <div>
          <span>复盘归因</span>
          <strong>{performance.ready ? `${performance.startDate} 至 ${performance.endDate}` : "等待真实估值时间轴"}</strong>
          <small>{performancePersistenceMessage}</small>
        </div>
        <nav className="review-tabs" role="tablist" aria-label="复盘视图" onKeyDown={handleTabListKeyDown}>
          {REVIEW_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              className={activeTab === tab.key ? "is-active" : undefined}
              aria-selected={activeTab === tab.key}
              tabIndex={activeTab === tab.key ? 0 : -1}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </header>

      {activeTab === "performance" ? (
        <div className="review-page">
          <section className="review-command-bar">
            <div>
              <label htmlFor="review-snapshot-date">估值日</label>
              <Input id="review-snapshot-date" type="date" value={snapshotDate} onChange={(event) => setSnapshotDate(event.target.value)} />
            </div>
            <span>{formatMoney(positionPlan.totalValue, valuation.baseCurrency)} · 日末估值口径</span>
            <Button type="button" size="sm" disabled={!dailyClose.canCapture} onClick={recordSnapshot} title={dailyClose.canCapture ? undefined : dailyClose.detail}>
              <Camera aria-hidden="true" />
              {dailyClose.alreadyCaptured ? "更新估值" : "记录估值"}
            </Button>
          </section>
          {message ? <p className="review-inline-message">{message}</p> : null}
          {!performance.ready ? <p className="review-inline-warning">{performance.issue}</p> : null}

          <section className={`review-close-readiness is-${dailyClose.status}`} aria-label="日结准备度">
            <header><div><strong>{dailyClose.label}</strong><span>{dailyClose.detail}</span></div><em>{dailyClose.blockingCount ? `${dailyClose.blockingCount} 阻断` : dailyClose.warningCount ? `${dailyClose.warningCount} 确认` : "已对齐"}</em></header>
            <div>
              {dailyClose.checks.map((check) => (
                <article key={check.key} className={`is-${check.severity}`}><span>{check.label}</span><strong>{check.severity === "pass" ? "通过" : check.severity === "warning" ? "确认" : "阻断"}</strong><small>{check.detail}</small></article>
              ))}
            </div>
          </section>

          <section className="review-metric-grid" aria-label="组合收益指标">
            <ReviewMetric label="TWR" value={formatPercent(performance.twrPct)} detail="剔除外部现金流" />
            <ReviewMetric label="MWR" value={formatPercent(performance.mwrAnnualizedPct)} detail="年化资金收益率" />
            <ReviewMetric label="基准" value={formatPercent(performance.benchmarkReturnPct)} detail="同日基准链" />
            <ReviewMetric label="净超额" value={formatPercent(performance.excessReturnPct)} detail="净 TWR - 基准" />
            <ReviewMetric label="费用拖累" value={formatPercent(performance.feeDragPct)} detail="净值已含费用" tone="caution" />
            <ReviewMetric label="汇率贡献" value={formatPercent(performance.fxContributionPct)} detail="按期初外币暴露" />
          </section>

          <section className="review-attribution-band" aria-label="收益归因拆解">
            <div><span>组合净收益</span><strong>{formatPercent(performance.twrPct)}</strong></div>
            <i aria-hidden="true">-</i>
            <div><span>基准收益</span><strong>{formatPercent(performance.benchmarkReturnPct)}</strong></div>
            <i aria-hidden="true">=</i>
            <div><span>净超额</span><strong>{formatPercent(performance.excessReturnPct)}</strong></div>
            <i aria-hidden="true">-</i>
            <div><span>汇率贡献</span><strong>{formatPercent(performance.fxContributionPct)}</strong></div>
            <i aria-hidden="true">=</i>
            <div><span>选择与时机</span><strong>{formatPercent(performance.selectionContributionPct)}</strong></div>
          </section>

          <div className="review-section-head">
            <div><strong>估值时间轴</strong><span>{ledger.snapshots.length} 个日末快照</span></div>
          </div>
          {ledger.snapshots.length ? (
            <div className="review-table" role="table" aria-label="估值快照">
              <div className="review-table-head" role="row"><span>日期</span><span>组合净值</span><span>基准</span><span>累计费用</span><span>美元暴露</span></div>
              {ledger.snapshots.map((snapshot) => (
                <div className="review-table-row" role="row" key={snapshot.id}>
                  <span>{snapshot.date}</span>
                  <strong>{formatMoney(snapshot.portfolioValue, snapshot.baseCurrency)}</strong>
                  <span>{snapshot.benchmarkLevel === null ? "缺失" : `${snapshot.benchmarkSymbol} ${formatNumber(snapshot.benchmarkLevel)}`}</span>
                  <span>{formatMoney(snapshot.cumulativeFees, snapshot.baseCurrency)}</span>
                  <span>{formatMoney(snapshot.usdExposureValue, snapshot.baseCurrency)}</span>
                </div>
              ))}
            </div>
          ) : <ReviewEmpty title="尚无估值快照" detail="记录两个不同日期的估值后即可计算真实收益。" />}
        </div>
      ) : null}

      {activeTab === "cash-flows" ? (
        <div className="review-page">
          <section className="review-cash-summary">
            <div><span>期间净现金流</span><strong>{formatSignedMoney(performance.netExternalFlow, performance.baseCurrency)}</strong></div>
            <div><span>已登记</span><strong>{ledger.cashFlows.length} 笔</strong></div>
            <span className="review-cash-actions">
              <Button type="button" variant="outline" size="sm" onClick={() => openCashFlow("withdrawal")}><ArrowUpFromLine aria-hidden="true" />出金</Button>
              <Button type="button" size="sm" onClick={() => openCashFlow("deposit")}><ArrowDownToLine aria-hidden="true" />入金</Button>
            </span>
          </section>
          {message ? <p className="review-inline-message">{message}</p> : null}
          {ledger.cashFlows.length ? (
            <div className="review-cash-list">
              {ledger.cashFlows.map((flow) => (
                <article key={flow.id}>
                  <div className={`review-flow-icon is-${flow.kind}`} aria-hidden="true">{flow.kind === "deposit" ? "+" : "-"}</div>
                  <div><strong>{flow.kind === "deposit" ? "入金" : "出金"} · {flow.date}</strong><span>{accountName(accounts, flow.accountId)}{flow.note ? ` · ${flow.note}` : ""}</span></div>
                  <strong>{flow.kind === "deposit" ? "+" : "-"}{formatMoney(flow.amount, flow.currency)}</strong>
                  <span>本位币 {formatSignedMoney(flow.baseAmount, flow.baseCurrency)}</span>
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={`删除 ${flow.date} 现金流`} title="删除现金流" onClick={() => onLedgerChange((current) => removeExternalCashFlow(current, flow.id))}><Trash2 aria-hidden="true" /></Button>
                </article>
              ))}
            </div>
          ) : <ReviewEmpty title="暂无外部现金流" detail="入金和出金必须登记，内部买卖不属于外部现金流。" />}
        </div>
      ) : null}

      {activeTab === "outcomes" ? (
        <div className="review-page review-outcome-page">
          {report && reportIsCurrent ? (
            <RecommendationOutcomePanel action={report.calibrationAction} attribution={attribution} performance={report.recommendationPerformance} />
          ) : <ReviewEmpty title="等待当前分析报告" detail="刷新当前 Profile 后查看 5/20/60 日真实建议结果。" />}
        </div>
      ) : null}

      {activeTab === "promotion" ? (
        <div className="review-page">
          <section className="review-promotion-summary">
            <div><ShieldCheck aria-hidden="true" /><span>晋级门只接受冻结版本的真实前瞻 20 日队列，达到门槛后仍需人工审核。</span></div>
            <dl>
              <div><dt>可评审</dt><dd>{promotion.reviewable}</dd></div>
              <div><dt>收集中</dt><dd>{promotion.collecting}</dd></div>
              <div><dt>维持</dt><dd>{promotion.held}</dd></div>
              <div><dt>阻断</dt><dd>{promotion.blocked}</dd></div>
            </dl>
          </section>
          {promotion.cohorts.length ? (
            <div className="review-cohort-list">
              {promotion.cohorts.map((cohort) => (
                <article key={cohort.key} className={`is-${cohort.tone}`}>
                  <div className="review-cohort-title">
                    <div><strong>{cohort.profileKey} · {cohort.profileVersion}</strong><span>{cohort.strategyVersion}</span></div>
                    <em>{cohort.statusLabel}</em>
                  </div>
                  <dl>
                    <div><dt>有效样本</dt><dd>{cohort.sampleCount}/{cohort.minimumSampleCount}</dd></div>
                    <div><dt>命中率</dt><dd>{formatPercent(cohort.hitRatePct)}</dd></div>
                    <div><dt>方向收益</dt><dd>{formatPercent(cohort.averageSignedReturnPct)}</dd></div>
                    <div><dt>基准超额</dt><dd>{formatPercent(cohort.averageExcessReturnPct)}</dd></div>
                    <div><dt>平均不利</dt><dd>{formatPercent(cohort.averageMaxAdversePct)}</dd></div>
                  </dl>
                  <p>{cohort.rationale}</p>
                  <small>{cohort.dataSignature ? `数据签名 ${cohort.dataSignature}` : `未验证历史记录 ${cohort.unverifiedRecords} 条`}</small>
                </article>
              ))}
            </div>
          ) : <ReviewEmpty title="暂无版本队列" detail="新的真实建议会自动冻结版本证据并进入独立队列。" />}
        </div>
      ) : null}

      <Dialog open={cashFlowOpen} onOpenChange={setCashFlowOpen}>
        <DialogContent className="review-cash-dialog" mobileMode="sheet" showCloseButton size="md">
          <form className="rp-dialog-form" onSubmit={submitCashFlow}>
            <DialogHeader>
              <DialogTitle>登记外部现金流</DialogTitle>
              <DialogDescription>只登记组合外部的入金或出金，成交和账户间划转不要重复记录。</DialogDescription>
            </DialogHeader>
            <DialogBody>
              <div className="rp-dialog-context">
                <CircleDollarSign aria-hidden="true" />
                <strong>现金流会改变资金收益率口径</strong>
                <span>金额会按登记日汇率冻结为组合基准币种，之后只影响 TWR/MWR，不改写成交或持仓。</span>
              </div>
              <div className="review-flow-kind" role="group" aria-label="现金流方向">
                <button type="button" className={flowKind === "deposit" ? "is-active" : undefined} onClick={() => setFlowKind("deposit")}><ArrowDownToLine aria-hidden="true" />入金</button>
                <button type="button" className={flowKind === "withdrawal" ? "is-active" : undefined} onClick={() => setFlowKind("withdrawal")}><ArrowUpFromLine aria-hidden="true" />出金</button>
              </div>
              <div className="review-dialog-grid">
                <label><span>日期</span><Input type="date" required value={flowDate} onChange={(event) => setFlowDate(event.target.value)} /></label>
                <label><span>账户</span><select value={flowAccountId} onChange={(event) => { const account = accounts.find((item) => item.id === event.target.value); setFlowAccountId(event.target.value); if (account) setFlowCurrency(account.currency); }}><option value="">未指定账户</option>{accounts.filter((account) => account.status !== "archived").map((account) => <option value={account.id} key={account.id}>{account.name}</option>)}</select></label>
                <label><span>币种</span><select value={flowCurrency} onChange={(event) => setFlowCurrency(event.target.value as SupportedCurrency)}><option value="CNY">人民币 CNY</option><option value="USD">美元 USD</option></select></label>
                <label><span>金额</span><Input type="number" min="0.01" step="0.01" required value={flowAmount} onChange={(event) => setFlowAmount(event.target.value)} /></label>
                <label className="is-wide"><span>备注</span><Input value={flowNote} onChange={(event) => setFlowNote(event.target.value)} placeholder="可选" /></label>
              </div>
            </DialogBody>
            <DialogFooter><Button type="button" variant="outline" onClick={() => setCashFlowOpen(false)}>取消</Button><Button type="submit">登记{flowKind === "deposit" ? "入金" : "出金"}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function ReviewMetric({ detail, label, tone, value }: { detail: string; label: string; tone?: string; value: string }) {
  return <article className={tone ? `is-${tone}` : undefined}><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>;
}

function ReviewEmpty({ detail, title }: { detail: string; title: string }) {
  return <div className="review-empty"><strong>{title}</strong><span>{detail}</span></div>;
}

function formatPercent(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatMoney(value: number, currency: string) {
  return new Intl.NumberFormat("zh-CN", { style: "currency", currency: currency === "USD" ? "USD" : "CNY", maximumFractionDigits: 2 }).format(value);
}

function formatSignedMoney(value: number, currency: string) {
  return `${value > 0 ? "+" : ""}${formatMoney(value, currency)}`;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 4 }).format(value);
}

function accountName(accounts: AccountRecord[], accountId: string) {
  return accounts.find((account) => account.id === accountId)?.name ?? "未指定账户";
}
