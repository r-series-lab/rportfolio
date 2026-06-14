import InsightsRoundedIcon from "@mui/icons-material/InsightsRounded";
import RuleRoundedIcon from "@mui/icons-material/RuleRounded";
import type { BacktestEventStat, BacktestHorizonStat, BacktestSummary, ProtocolValidationRow } from "../lib/types";
import { formatNumber, formatPercent } from "../lib/utils";
import { DetailTooltip } from "./detail-tooltip";

type BacktestPanelProps = {
  backtest: BacktestSummary;
  showRules?: boolean;
};

export function BacktestPanel({ backtest, showRules = true }: BacktestPanelProps) {
  const validation = backtest.stateValidation;
  const protocolValidation = backtest.protocolValidation;
  const availableForwards = backtest.forwardReturns.filter((item) => item.available);
  const ma20 = validation.eventStats.find((item) => item.key === "ma20_pullback");
  const earlyDrawdown = validation.eventStats.find((item) => item.key === "early_drawdown");
  const ma50 = validation.eventStats.find((item) => item.key === "ma50_break");
  const riskEvents = [ma20, earlyDrawdown, ma50].filter((item): item is BacktestEventStat => item !== undefined);
  const rules = [
    ...backtest.ruleSet.stateRules.slice(0, 2),
    ...backtest.ruleSet.actionRules.slice(0, 2),
    ...backtest.ruleSet.profileRules.slice(0, 1),
  ];

  return (
    <section className="panel backtest-panel">
      <div className="panel-head">
        <h2>
          <InsightsRoundedIcon />
          状态回测
        </h2>
        <span className="date-badge">
          {backtest.benchmarkSymbol} · {backtest.date}
        </span>
      </div>

      <div className={`validation-card is-${validation.tone}`}>
        <div>
          <span>当前状态</span>
          <strong>{validation.stateLabel}</strong>
        </div>
        <div>
          <span>样本</span>
          <strong>{validation.sampleCount}</strong>
        </div>
        <div>
          <span>置信</span>
          <strong>{validation.confidence}</strong>
        </div>
        <DetailTooltip title={validation.sampleNote ?? "样本质量由数量、同状态占比和是否使用相似状态补样本决定。"}>
          <div className={`validation-quality is-${validation.sampleQualityTone ?? "neutral"} has-detail`}>
            <span>质量</span>
            <strong>{validation.sampleQualityLabel ?? validation.confidence}</strong>
          </div>
        </DetailTooltip>
        <p>{validation.verdict}</p>
      </div>

      <div className="sample-quality-strip">
        <DetailTooltip title={validation.sampleNote ?? "同状态样本越多，回测结论越可依赖。"}>
          <article className="has-detail">
            <span>同状态</span>
            <strong>{validation.exactSampleCount ?? validation.sampleCount}</strong>
          </article>
        </DetailTooltip>
        <article>
          <span>相似补样</span>
          <strong>{validation.similarSampleCount ?? 0}</strong>
        </article>
        <article>
          <span>匹配方式</span>
          <strong>{validation.matchMode}</strong>
        </article>
      </div>

      <div className="backtest-section-title">未来表现</div>
      <div className="backtest-stats">
        {validation.horizonStats.map((item) => (
          <DetailTooltip key={item.days} title={horizonDetail(item)}>
            <article className="has-detail">
              <span>{item.days}D</span>
              <strong>{formatPercent(item.medianReturnPct)}</strong>
              <em>胜率 {formatNumber(item.winRatePct, 0)}%</em>
              <small>{hasDistributionStats(item) ? `90%CI ${formatRange(item.averageReturnCiLowPct, item.averageReturnCiHighPct)}` : `回撤 ${formatPercent(item.medianMaxDrawdownPct)}`}</small>
              {hasDistributionStats(item) ? (
                <small>尾损 {formatUnsignedPercent(item.tailLossRatePct)}｜深回撤 {formatUnsignedPercent(item.severeDrawdownRatePct)}</small>
              ) : null}
            </article>
          </DetailTooltip>
        ))}
      </div>

      <div className="backtest-section-title">风险事件</div>
      <div className="event-strip">
        {riskEvents.map((item) => (
          <DetailTooltip key={item.key} title={item.detail}>
            <article className={`is-${item.tone} has-detail`}>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </article>
          </DetailTooltip>
        ))}
      </div>

      <div className="protocol-validation">
        <div className="backtest-section-title">状态协议验证</div>
        <div className={`protocol-verdict is-${protocolValidation.tone}`}>
          <span>当前协议</span>
          <strong>{protocolValidation.currentLabel}</strong>
          <p>{protocolValidation.verdict}</p>
        </div>
        <div className="protocol-grid">
          {protocolValidation.rows.map((row) => (
            <ProtocolRow key={row.protocolState} row={row} active={row.protocolState === protocolValidation.currentProtocol} />
          ))}
        </div>
      </div>

      <div className="action-validation">
        <div className="backtest-section-title">动作验证</div>
        <div className="action-validation-grid">
          <article>
            <span>立即追高</span>
            <strong>{earlyDrawdown ? `回撤概率 ${earlyDrawdown.value}` : "待样本"}</strong>
            <em>用于判断当前是否适合立刻加仓。</em>
          </article>
          <article>
            <span>等待 MA20</span>
            <strong>{ma20 ? `触发概率 ${ma20.value}` : "待样本"}</strong>
            <em>用于验证等待回踩是否有历史依据。</em>
          </article>
          <article>
            <span>中期防守</span>
            <strong>{ma50 ? `破位概率 ${ma50.value}` : "待样本"}</strong>
            <em>用于判断 MA50 是否需要作为防守线。</em>
          </article>
        </div>
      </div>

      {availableForwards.length > 0 ? (
        <div className="forward-list">
          {availableForwards.map((item) => (
            <article key={item.days}>
              <span>{item.days}D 实际</span>
              <strong>{formatPercent(item.returnPct)}</strong>
              <em>{item.endDate ?? "—"}</em>
            </article>
          ))}
        </div>
      ) : null}

      {showRules ? (
        <div className="rule-preview">
          <div className="micro-panel-head">
            <RuleRoundedIcon />
            <span>可回测规则</span>
          </div>
          <div className="rule-list">
            {rules.map((rule) => (
              <article key={rule.key} className={`is-${rule.tone}`}>
                <strong>{rule.label}</strong>
                <span>{rule.condition}</span>
                <em>{rule.action}</em>
              </article>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function ProtocolRow({ row, active }: { row: ProtocolValidationRow; active: boolean }) {
  return (
    <DetailTooltip title={row.summary}>
      <article className={`is-${row.tone} ${active ? "is-active" : ""} has-detail`}>
        <div>
          <span>{row.label}</span>
          <em>{row.permission}</em>
        </div>
        <strong>{formatPercent(row.medianReturn20Pct)}</strong>
        <small>
          胜率 {formatNumber(row.winRate20Pct, 0)}%｜回撤 {formatPercent(row.medianMaxDrawdown20Pct)}
        </small>
        <small>
          MA50 破位 {formatNumber(row.ma50BreakRate20Pct, 0)}%｜n={row.sampleCount}
        </small>
        {row.tailLossRate20Pct !== undefined || row.severeDrawdownRate20Pct !== undefined ? (
          <small>
            尾损 {formatUnsignedPercent(row.tailLossRate20Pct)}｜深回撤 {formatUnsignedPercent(row.severeDrawdownRate20Pct)}
          </small>
        ) : null}
      </article>
    </DetailTooltip>
  );
}

function horizonDetail(item: BacktestHorizonStat) {
  return [
    `${item.days}D 中位收益 ${formatPercent(item.medianReturnPct)}，均值 ${formatPercent(item.averageReturnPct)}。`,
    `均值 90%CI ${formatRange(item.averageReturnCiLowPct, item.averageReturnCiHighPct)}；收益 P25-P75 ${formatRange(item.returnP25Pct, item.returnP75Pct)}。`,
    `尾部亏损率 ${formatUnsignedPercent(item.tailLossRatePct)}，深回撤率 ${formatUnsignedPercent(item.severeDrawdownRatePct)}，样本 n=${item.sampleCount}。`,
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
