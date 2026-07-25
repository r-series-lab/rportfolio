import {
  paperFundOrderNextDate,
  paperFundOrderStatusLabel,
  paperReplacementCostFor,
  paperSimMetricLabel,
  paperSimRunButtonLabel,
  paperTradePerformanceFor,
  paperTradePerformanceGroupsFor,
  type PaperSimState,
  type PaperSimSummary,
} from "../../lib/paper-sim";
import { paperStrategyExperimentFor } from "../../lib/paper-strategy-experiment";
import { paperTradeAttributionFor } from "../../lib/paper-trade-attribution";
import { formatMoney, formatNumber, formatPercent } from "../../lib/utils";
import { ProgressiveDisclosure } from "../progressive-disclosure";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import "../../styles/pages/quant-lab-simulation.css";

export type QuantSimulationPanelProps = {
  onPause: () => void;
  onRun: () => void;
  paperSim: PaperSimState;
  summary: PaperSimSummary;
};

export default function QuantSimulationPanel({ onPause, onRun, paperSim, summary }: QuantSimulationPanelProps) {
  const latestTrade = paperSim.trades[0];
  const latestPendingFundOrder = paperSim.pendingFundOrders[0];
  const latestSnapshot = paperSim.snapshots[0];
  const tradePerformance = paperTradePerformanceFor(paperSim);
  const tradePerformanceGroups = paperTradePerformanceGroupsFor(paperSim);
  const tradeAttribution = paperTradeAttributionFor(paperSim);
  const strategyExperiment = paperStrategyExperimentFor(paperSim);
  const replacementCost = paperReplacementCostFor(paperSim);

  return (
    <Card size="sm" className={`rail-card quant-paper-sim-card is-${summary.tone}`} role="region" aria-label="自动模拟交易">
      <div className="quant-section-head">
        <div>
          <span>自动模拟</span>
          <strong>{summary.statusLabel}</strong>
        </div>
        <span className="quant-account-actions">
          {summary.active ? (
            <Button type="button" variant="outline" size="xs" className="quant-rail-control" onClick={onPause}>
              暂停
            </Button>
          ) : null}
          <Button type="button" size="xs" className="quant-rail-control" onClick={onRun}>
            {paperSimRunButtonLabel(summary)}
          </Button>
        </span>
      </div>
      <div className="quant-paper-sim-headline">
        <strong>{summary.headline}</strong>
        <span>{summary.active ? paperSim.experimentName : "按当前 Profile 和规则建立虚拟账户。"}</span>
      </div>
      <div className="quant-order-center-summary" aria-label="模拟账户摘要">
        <span>权益 <strong>{paperSimMetricLabel(summary.equity, paperSim.currency)}</strong></span>
        <span>现金 <strong>{paperSimMetricLabel(summary.cash, paperSim.currency)}</strong></span>
        <span>持仓 <strong>{summary.positionCount}</strong></span>
      </div>
      <div className="quant-paper-sim-strip" aria-label="模拟表现">
        <span>收益 <strong>{formatPercent(summary.pnlPct)}</strong></span>
        <span>回撤 <strong>{formatPercent(summary.maxDrawdownPct)}</strong></span>
        <span>成交 <strong>{summary.tradeCount}</strong></span>
        <span>待确认 <strong>{summary.pendingFundOrderCount}</strong></span>
      </div>
      <div className={`quant-paper-evidence-strip is-${tradePerformance.tone}`}>
        <span>{tradePerformance.ready ? "交易质量" : "已平仓样本"}</span>
        <strong>{tradePerformance.ready ? tradePerformance.verdict : `${tradePerformance.sampleCount}/${tradePerformance.requiredSamples}`}</strong>
        <small>{tradePerformance.ready ? tradePerformance.confidenceLabel : "满 10 笔后输出胜率与盈亏比"}</small>
      </div>
      <ProgressiveDisclosure label="指标、归因与规则" badge={`${summary.tradeCount} 笔`}>
        <div className="quant-paper-detail-stack">
          {latestSnapshot ? (
            <section className="quant-paper-performance" aria-label="基准与费用评估">
              <span>策略<strong>{formatPercent(summary.pnlPct)}</strong></span>
              <span title={summary.benchmarkSymbol || "未配置基准"}>
                基准<strong>{summary.benchmarkAvailable ? formatPercent(summary.benchmarkReturnPct) : "—"}</strong>
              </span>
              <span>超额<strong className={summary.excessReturnPct >= 0 ? "is-positive" : "is-negative"}>{summary.benchmarkAvailable ? formatPercent(summary.excessReturnPct) : "—"}</strong></span>
              <span title={`累计费用 ${formatMoney(summary.cumulativeFees, paperSim.currency)}`}>费用拖累<strong className="is-negative">{formatPercent(summary.feeDragPct)}</strong></span>
            </section>
          ) : null}
          <section className={`quant-paper-trade-performance is-${tradePerformance.tone}`} aria-label="已实现交易质量">
            <header>
              <span>{tradePerformance.ready ? "交易质量" : "已平仓样本"}</span>
              <strong>
                {tradePerformance.ready
                  ? `${tradePerformance.verdict} · ${tradePerformance.confidenceLabel}`
                  : `${tradePerformance.sampleCount}/${tradePerformance.requiredSamples}`}
              </strong>
            </header>
            {tradePerformance.ready ? (
              <div className="quant-paper-trade-metrics">
                <span>胜率<strong>{tradePerformance.winRatePct === null ? "—" : formatPercent(tradePerformance.winRatePct)}</strong></span>
                <span>盈亏比<strong>{tradePerformance.payoffRatio === null ? "—" : `${formatNumber(tradePerformance.payoffRatio, 2)} : 1`}</strong></span>
                <span>单回合期望<strong>{tradePerformance.expectancy === null ? "—" : formatSignedMoney(tradePerformance.expectancy, paperSim.currency)}</strong></span>
                <span>平均持有<strong>{tradePerformance.averageHoldingDays === null ? "—" : `${formatNumber(tradePerformance.averageHoldingDays, 1)} 天`}</strong></span>
              </div>
            ) : (
              <div className="quant-paper-trade-progress" aria-hidden="true">
                <span style={{ width: `${Math.min(100, (tradePerformance.sampleCount / tradePerformance.requiredSamples) * 100)}%` }} />
              </div>
            )}
            <p>{tradePerformance.detail}</p>
            {tradePerformance.ready && tradePerformance.nextConfidenceSample ? (
              <small className="quant-paper-confidence">
                再积累 {tradePerformance.nextConfidenceSample - tradePerformance.sampleCount} 笔，提升为
                {tradePerformance.nextConfidenceSample >= 60 ? "较稳定" : "可参考"}结论
              </small>
            ) : null}
            {tradePerformanceGroups.length ? (
              <div className="quant-paper-trade-groups" aria-label="按 Profile 和策略分组">
                {tradePerformanceGroups.slice(0, 3).map((group) => (
                  <span key={group.key} title={`${group.profileName} · ${group.strategyName}`}>
                    <em>{group.profileName} · {group.strategyName}</em>
                    <strong>
                      {group.ready
                        ? `${group.winRatePct === null ? "—" : formatPercent(group.winRatePct)} / ${group.payoffRatio === null ? "—" : `${formatNumber(group.payoffRatio, 2)}:1`}`
                        : `${group.sampleCount}/${group.requiredSamples}`}
                    </strong>
                  </span>
                ))}
              </div>
            ) : null}
          </section>
          {replacementCost.tradeCount ? (
            <section className="quant-paper-exit-attribution is-neutral" aria-label="基金替换执行成本">
              <header><span>基金替换成本</span><strong>{replacementCost.completedWorkflowCount}/{replacementCost.workflowCount} 条已闭环</strong></header>
              <div>
                <span>费用<strong>{formatMoney(replacementCost.fees, paperSim.currency)}</strong></span>
                <span>滑点<strong>{formatMoney(replacementCost.slippage, paperSim.currency)}</strong></span>
                <span>总摩擦<strong>{formatMoney(replacementCost.totalCost, paperSim.currency)}</strong></span>
              </div>
              <p>占关联成交额 {formatPercent(replacementCost.costPct)}；只统计已发生费用与模拟滑点，不把等待期机会成本伪装成确定损失。</p>
            </section>
          ) : null}
          {tradeAttribution.sampleCount ? (
            <section className={`quant-paper-exit-attribution is-${tradeAttribution.tone}`} aria-label="交易结果归因">
              <header><span>交易归因</span><strong>{tradeAttribution.primaryDriver}</strong></header>
              <div>
                <span>持有结果<strong>{formatSignedMoney(tradeAttribution.holdingPnl, paperSim.currency)}</strong></span>
                <span>退出滑点<strong>{formatSignedMoney(tradeAttribution.slippageDrag, paperSim.currency)}</strong></span>
                <span>交易费用<strong>{formatSignedMoney(tradeAttribution.feeDrag, paperSim.currency)}</strong></span>
              </div>
              <p>{tradeAttribution.recommendation}</p>
              {tradeAttribution.latest?.decisionDetail ? (
                <small title={tradeAttribution.latest.decisionDetail}>最近 {tradeAttribution.latest.symbol} · {tradeAttribution.latest.decisionDetail}</small>
              ) : null}
            </section>
          ) : null}
          {strategyExperiment.baseline.tradeCount ? (
            <section className={`quant-paper-experiment is-${strategyExperiment.tone}`} aria-label="策略参数 A/B 回放">
              <header><span>A/B 参数回放</span><strong>{strategyExperiment.verdict}</strong></header>
              {strategyExperiment.ready ? (
                <div>
                  <article>
                    <span>A · 当前参数</span>
                    <strong>{formatSignedMoney(strategyExperiment.baseline.netPnl, paperSim.currency)}</strong>
                    <small>最大单笔 {formatSignedMoney(strategyExperiment.baseline.worstTradePnl, paperSim.currency)}</small>
                  </article>
                  <article className={strategyExperiment.preferred === "B" ? "is-preferred" : ""}>
                    <span>B · {strategyExperiment.variantLabel}</span>
                    <strong>{formatSignedMoney(strategyExperiment.candidate.netPnl, paperSim.currency)}</strong>
                    <small>最大单笔 {formatSignedMoney(strategyExperiment.candidate.worstTradePnl, paperSim.currency)}</small>
                  </article>
                </div>
              ) : null}
              <p>{strategyExperiment.ready ? strategyExperiment.changeSummary : strategyExperiment.verdict}</p>
              {strategyExperiment.ready ? <small>{strategyExperiment.assumption} 仅用于反事实比较，不代表未来收益。</small> : null}
            </section>
          ) : null}
          {latestSnapshot ? (
            <section className="quant-paper-attribution" aria-label="当日收益归因">
              <header>
                <span>当日归因</span>
                <strong className={latestSnapshot.dailyPnl >= 0 ? "is-positive" : "is-negative"}>
                  {formatSignedMoney(latestSnapshot.dailyPnl, paperSim.currency)} · {formatPercent(latestSnapshot.dailyPnlPct)}
                </strong>
              </header>
              <div>
                <span>持仓估值<strong>{formatSignedMoney(latestSnapshot.marketPnl, paperSim.currency)}</strong></span>
                <span>交易价差<strong>{formatSignedMoney(latestSnapshot.executionPnl, paperSim.currency)}</strong></span>
                <span>费用<strong>{formatSignedMoney(latestSnapshot.feePnl, paperSim.currency)}</strong></span>
                <span>现金/差异<strong>{formatSignedMoney(latestSnapshot.otherPnl, paperSim.currency)}</strong></span>
              </div>
            </section>
          ) : null}
          {latestSnapshot ? <p>{latestSnapshot.runDate} · {latestSnapshot.summary}</p> : <p>启动后会按交易日记录净值、现金、成交和回撤。</p>}
          <p className="quant-paper-sim-policy">A 股默认：官方交易日、T+1、申报手数、涨跌停校验；场外基金分开处理净值确认、赎回到账和限购分批。</p>
          {latestTrade ? (
            <article className="quant-paper-sim-latest">
              <div>
                <strong>{latestTrade.symbol}</strong>
                <span title={latestTrade.ruleNote}>{latestTrade.side === "BUY" ? "买入" : "卖出"} · {latestTrade.ruleLabel}</span>
              </div>
              <em>{formatNumber(latestTrade.quantity, latestTrade.quantity >= 100 ? 0 : 4)} @ {formatNumber(latestTrade.price, 2)} · 费 {formatMoney(latestTrade.fee, paperSim.currency)}</em>
            </article>
          ) : null}
        </div>
      </ProgressiveDisclosure>
      {latestPendingFundOrder ? (
        <article className="quant-paper-sim-latest is-pending">
          <div>
            <strong>{latestPendingFundOrder.symbol}</strong>
            <span>{latestPendingFundOrder.side === "BUY" ? "申购" : "赎回"} · {paperFundOrderStatusLabel(latestPendingFundOrder)}</span>
          </div>
          <em>{paperFundOrderNextDate(latestPendingFundOrder)}</em>
        </article>
      ) : null}
    </Card>
  );
}

function formatSignedMoney(value: number, currency: string) {
  const formatted = formatMoney(Math.abs(value), currency);
  if (Math.abs(value) < 0.005) return formatted;
  return `${value > 0 ? "+" : "−"}${formatted}`;
}
