import InsightsRoundedIcon from "@mui/icons-material/InsightsRounded";
import type { BacktestHorizonStat, BacktestSummary } from "../lib/types";
import { formatNumber, formatPercent } from "../lib/utils";
import { DetailTooltip } from "./detail-tooltip";

type BacktestSummaryPanelProps = {
  backtest: BacktestSummary;
};

export function BacktestSummaryPanel({ backtest }: BacktestSummaryPanelProps) {
  const validation = backtest.stateValidation;
  const protocolValidation = backtest.protocolValidation;
  const lowSample = validation.sampleCount < 12;

  return (
    <section className="panel backtest-summary-panel">
      <div className="panel-head">
        <h2>
          <InsightsRoundedIcon />
          回测摘要
        </h2>
        <DetailTooltip title={validation.sampleNote ?? "样本质量由数量、同状态占比和是否使用相似状态补样本决定。"}>
          <span className={`sample-badge is-${validation.sampleQualityTone ?? "neutral"} ${lowSample ? "is-low" : ""}`}>
            样本 {validation.sampleCount}｜质量：{validation.sampleQualityLabel ?? (lowSample ? "低" : validation.confidence)}
          </span>
        </DetailTooltip>
      </div>

      <div className={`backtest-verdict is-${validation.tone}`}>
        <strong>{validation.stateLabel}</strong>
        <span>{validation.confidence} · {validation.matchMode}</span>
        <p>{validation.verdict}</p>
      </div>

      <div className={`protocol-mini-verdict is-${protocolValidation.tone}`}>
        <span>状态协议</span>
        <strong>{protocolValidation.currentLabel}</strong>
        <p>{protocolValidation.verdict}</p>
      </div>

      <div className="backtest-mini-stats">
        {validation.horizonStats.slice(0, 4).map((item) => (
          <DetailTooltip key={item.days} title={horizonDetail(item)}>
            <article className="has-detail">
              <span>{item.days}D</span>
              <strong>{formatPercent(item.medianReturnPct)}</strong>
              <em>胜率 {formatNumber(item.winRatePct, 0)}%</em>
              <small>
                {hasDistributionStats(item)
                  ? `尾损 ${formatUnsignedPercent(item.tailLossRatePct)}`
                  : `回撤 ${formatPercent(item.medianMaxDrawdownPct)}`}
                {lowSample ? `｜n=${validation.sampleCount}` : ""}
              </small>
            </article>
          </DetailTooltip>
        ))}
      </div>

      <div className="backtest-events-mini">
        {validation.eventStats.map((item) => (
          <DetailTooltip key={item.key} title={item.detail}>
            <article className={`is-${item.tone} has-detail`}>
              <span>{item.label}</span>
              <strong>
                {item.value}
                {lowSample ? <small>n={validation.sampleCount}</small> : null}
              </strong>
            </article>
          </DetailTooltip>
        ))}
      </div>
    </section>
  );
}

function horizonDetail(item: BacktestHorizonStat) {
  return [
    `${item.days}D 中位收益 ${formatPercent(item.medianReturnPct)}，回撤 ${formatPercent(item.medianMaxDrawdownPct)}。`,
    `均值 90%CI ${formatRange(item.averageReturnCiLowPct, item.averageReturnCiHighPct)}；P25-P75 ${formatRange(item.returnP25Pct, item.returnP75Pct)}。`,
    `尾部亏损率 ${formatUnsignedPercent(item.tailLossRatePct)}，深回撤率 ${formatUnsignedPercent(item.severeDrawdownRatePct)}。`,
  ].join(" ");
}

function formatRange(low: number | null | undefined, high: number | null | undefined) {
  if (low === null || low === undefined || high === null || high === undefined) {
    return "—";
  }
  return `${formatPercent(low)} ~ ${formatPercent(high)}`;
}

function formatUnsignedPercent(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "—";
  }
  return `${formatNumber(value, 0)}%`;
}

function hasDistributionStats(item: BacktestHorizonStat) {
  return item.averageReturnCiLowPct !== undefined || item.tailLossRatePct !== undefined;
}
