import TimelineRoundedIcon from "@mui/icons-material/TimelineRounded";
import type { ChartPattern, PatternAnalysis } from "../lib/types";

type PatternPanelProps = {
  analysis: PatternAnalysis;
  compact?: boolean;
};

export function PatternPanel({ analysis, compact = false }: PatternPanelProps) {
  const dominant = analysis.dominant;
  const riskPattern = analysis.patterns.find((pattern) => pattern.direction === "bearish" && pattern.key !== dominant?.key);
  const featured = [dominant, riskPattern].filter((pattern): pattern is ChartPattern => Boolean(pattern));
  const secondary = analysis.patterns.filter((pattern) => !featured.some((item) => item.key === pattern.key));

  return (
    <section className="panel pattern-panel">
      <div className="micro-panel-head pattern-head">
        <span>
          <TimelineRoundedIcon fontSize="inherit" />
          <span>形态识别</span>
        </span>
        {dominant ? <strong>{dominant.confidence}%</strong> : <strong>未确认</strong>}
      </div>

      <div className={`pattern-summary is-${dominant?.tone ?? "neutral"}`}>
        <strong>{dominant ? `${dominant.symbolLabel} · ${dominant.label}` : "暂无高置信度反转形态"}</strong>
        <span>{analysis.summary}</span>
      </div>

      {compact && featured.length > 0 ? (
        <>
          <div className="pattern-focus-grid">
            {featured.map((pattern, index) => (
              <article key={pattern.key} className={`pattern-focus-card is-${pattern.tone}`}>
                <span>{index === 0 ? "主结构" : "风险结构"}</span>
                <strong>
                  {pattern.symbolLabel}：{pattern.label}
                </strong>
                <p>{pattern.implication}</p>
                <em>{pattern.action}</em>
              </article>
            ))}
          </div>
          {secondary.length ? (
            <details className="pattern-more">
              <summary>查看其他形态（{secondary.length}）</summary>
              <div className="pattern-list">
                {secondary.map((pattern) => (
                  <PatternCard key={pattern.key} pattern={pattern} />
                ))}
              </div>
            </details>
          ) : null}
        </>
      ) : analysis.patterns.length > 0 ? (
        <div className="pattern-list">
          {analysis.patterns.map((pattern) => (
            <PatternCard key={pattern.key} pattern={pattern} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function PatternCard({ pattern }: { pattern: ChartPattern }) {
  return (
    <article className={`pattern-card is-${pattern.tone}`}>
      <div className="pattern-card-top">
        <span>{pattern.symbolLabel}</span>
        <strong>{pattern.label}</strong>
        <em>{pattern.phaseLabel}</em>
      </div>
      <div className="pattern-metrics">
        <span>颈线 {pattern.neckline ?? "-"}</span>
        <span>置信度 {pattern.confidence}%</span>
      </div>
      <p>{pattern.implication}</p>
      <p className="pattern-action">动作：{pattern.action}</p>
      <dl>
        <div>
          <dt>确认</dt>
          <dd>{pattern.confirmation}</dd>
        </div>
        <div>
          <dt>失效</dt>
          <dd>{pattern.invalidation}</dd>
        </div>
      </dl>
      <div className="pattern-points">
        {pattern.points.map((point) => (
          <span key={`${pattern.key}-${point.label}-${point.date}`}>
            {point.label} {point.price.toFixed(2)}
          </span>
        ))}
      </div>
    </article>
  );
}
