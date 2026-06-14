import SpeedRoundedIcon from "@mui/icons-material/SpeedRounded";
import { Chip, LinearProgress } from "@mui/material";
import type { CSSProperties } from "react";
import type { FactorScore, MarketInternalSignal, MarketAnalysisReport } from "../lib/types";
import { formatDateTime } from "../lib/utils";
import { DetailTooltip } from "./detail-tooltip";

type RiskScorePanelProps = {
  report: MarketAnalysisReport;
};

export function RiskScorePanel({ report }: RiskScorePanelProps) {
  return (
    <section
      className="score-panel"
      style={
        {
          "--level-color": report.level.color,
        } as CSSProperties
      }
    >
      <div className="score-orbit">
        <SpeedRoundedIcon className="score-orbit-icon" fontSize="inherit" />
        <div className="score-state">
          <strong>{stateWords(report.marketState.label)[0]}</strong>
          <span>{stateWords(report.marketState.label)[1]}</span>
        </div>
      </div>
      <div className="score-copy">
        <Chip
          label={report.marketState.label}
          className={`level-chip state-chip is-${report.marketState.tone}`}
        />
        <p>{report.marketState.summary}</p>
        <span className="score-time">{report.asOf} · {formatDateTime(report.generatedAt)}</span>
      </div>
      <div className="status-metrics">
        {report.statusMetrics.map((metric) => (
          <DetailTooltip key={metric.key} title={metric.detail}>
            <div className={`status-metric is-${metric.tone} has-detail`}>
              <span>{metric.label}</span>
              <strong>{metric.value}</strong>
            </div>
          </DetailTooltip>
        ))}
      </div>
      <div className="internal-signal-strip">
        {report.marketInternals.signals.map((signal) => (
          <InternalSignalChip key={signal.key} signal={signal} />
        ))}
      </div>
      <div className="opportunity-strip">
        {report.opportunityScores.map((item) => (
          <DetailTooltip key={item.horizonKey} title={item.detail}>
            <div className={`opportunity-chip is-${item.tone} has-detail`}>
              <span>{item.horizonLabel}</span>
              <strong>{item.score}</strong>
            </div>
          </DetailTooltip>
        ))}
      </div>
      <div className="dimension-stack factor-stack">
        {report.factorScores.filter((factor) => factor.key !== "opportunity").map((factor) => (
          <FactorBar key={factor.key} factor={factor} />
        ))}
      </div>
    </section>
  );
}

function InternalSignalChip({ signal }: { signal: MarketInternalSignal }) {
  return (
    <DetailTooltip title={signal.detail}>
      <div className={`internal-signal-chip is-${signal.tone} has-detail`}>
        <span>{signal.label}</span>
        <strong>{signal.value}</strong>
        <em>{signal.status}</em>
      </div>
    </DetailTooltip>
  );
}

function stateWords(label: string) {
  if (label.includes("扩散")) {
    return ["风险", "扩散"];
  }
  if (label.includes("扩张")) {
    return ["强趋势", "扩张"];
  }
  if (label.includes("分化")) {
    return ["强趋势", "分化"];
  }
  if (label.includes("回踩")) {
    return ["回踩", "观察"];
  }
  if (label.includes("消化")) {
    return ["高位", "消化"];
  }
  if (label.includes("破坏")) {
    return ["趋势", "破坏"];
  }
  if (label.includes("释放")) {
    return ["风险", "释放"];
  }
  if (label.includes("极度过热")) {
    return ["强趋势", "极热"];
  }
  if (label.includes("过热")) {
    return ["强趋势", "过热"];
  }
  if (label.includes("防守")) {
    return ["防守", "破位"];
  }
  if (label.includes("健康")) {
    return ["趋势", "健康"];
  }
  return [label.slice(0, 3), label.slice(3) || "状态"];
}

function FactorBar({ factor }: { factor: FactorScore }) {
  return (
    <div className={`dimension-row factor-row is-${factor.tone}`}>
      <div className="dimension-head">
        <span>{factor.label}</span>
        <strong>
          {factor.score}
          <small>{factor.status}</small>
        </strong>
      </div>
      <LinearProgress variant="determinate" value={factor.score} />
    </div>
  );
}
