import WarningAmberRoundedIcon from "@mui/icons-material/WarningAmberRounded";
import type { MarketAnalysisReport } from "../lib/types";

type ExplainPanelProps = {
  report: MarketAnalysisReport;
};

export function ExplainPanel({ report }: ExplainPanelProps) {
  return (
    <section className="panel explain-panel">
      <div className="panel-head">
        <div className="panel-title">
          <WarningAmberRoundedIcon fontSize="inherit" />
          <h2>风险原因</h2>
        </div>
      </div>

      <div className="reason-list">
        {report.reasons.length ? (
          report.reasons.slice(0, 4).map((reason) => (
            <article key={`${reason.dimension}-${reason.text}`} className="reason-item">
              <strong>+{reason.points}</strong>
              <div>
                <p>{reason.text}</p>
              </div>
            </article>
          ))
        ) : (
          <p className="quiet-text">今日没有触发高权重风险项。</p>
        )}
      </div>

      <div className="evidence-block">
        <span>反向证据 / 支撑因素</span>
        {report.supportEvidence.map((item) => (
          <article key={item.key} className={`support-item is-${item.tone}`}>
            <strong>{item.label}</strong>
            <p>{item.text}</p>
          </article>
        ))}
      </div>

      {report.guidance[0] ? <p className="policy-note">{report.guidance[0]}</p> : null}
    </section>
  );
}
