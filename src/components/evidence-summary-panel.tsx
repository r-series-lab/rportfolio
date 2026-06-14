import BalanceRoundedIcon from "@mui/icons-material/BalanceRounded";
import type { MarketAnalysisReport } from "../lib/types";
import { DetailTooltip } from "./detail-tooltip";

type EvidenceSummaryPanelProps = {
  report: MarketAnalysisReport;
  compact?: boolean;
};

export function EvidenceSummaryPanel({ report, compact = false }: EvidenceSummaryPanelProps) {
  const itemLimit = compact ? 2 : 3;
  const reasons = report.reasons.slice(0, itemLimit);
  const support = report.supportEvidence.slice(0, itemLimit);
  const turnWeak = report.structure.actionMap
    .filter((line) => line.key.includes("reduce") || line.key.includes("defense"))
    .slice(0, itemLimit);

  return (
    <section className={`panel evidence-summary-panel ${compact ? "is-compact" : ""}`}>
      <div className="panel-head">
        <h2>
          <BalanceRoundedIcon />
          风险 / 确认 / 转弱
        </h2>
        <span className="panel-kicker">Top 3</span>
      </div>

      <div className="evidence-columns">
        <div>
          <span className="evidence-column-title">主要风险</span>
          {reasons.length ? (
            reasons.map((reason) => (
              <DetailTooltip key={`${reason.dimension}-${reason.text}`} title={reason.text} placement="left">
                <article className="evidence-line is-risk has-detail">
                  <strong>+{reason.points}</strong>
                  <p>{compact ? compactEvidenceText(reason.text) : reason.text}</p>
                </article>
              </DetailTooltip>
            ))
          ) : (
            <p className="quiet-text">暂无高权重风险项。</p>
          )}
        </div>

        <div>
          <span className="evidence-column-title">确认</span>
          {support.length ? (
            support.map((item) => (
              <DetailTooltip key={item.key} title={item.text} placement="left">
                <article className={`evidence-line is-${item.tone} has-detail`}>
                  <strong>{item.label}</strong>
                  <p>{compact ? compactEvidenceText(item.text) : item.text}</p>
                </article>
              </DetailTooltip>
            ))
          ) : (
            <p className="quiet-text">暂无明显反向证据。</p>
          )}
        </div>

        <div>
          <span className="evidence-column-title">转弱触发</span>
          {turnWeak.length ? (
            turnWeak.map((line) => (
              <DetailTooltip key={line.key} title={line.detail} placement="left">
                <article className={`evidence-line is-${line.tone} has-detail`}>
                  <strong>{line.label}</strong>
                  <p>{compact ? compactTriggerText(line.action, line.value) : `${line.action} ${line.value}`.trim()}</p>
                </article>
              </DetailTooltip>
            ))
          ) : (
            <p className="quiet-text">暂无明确转弱触发。</p>
          )}
        </div>
      </div>
    </section>
  );
}

function compactEvidenceText(value: string) {
  return trimText(
    value
      .replace("风险偏好", "风险")
      .replace("结构风险", "结构")
      .replace("当前", "")
      .replace("已经", "")
      .replace("仍然", "")
      .replace(/[。；;]$/g, ""),
    25,
  );
}

function compactTriggerText(action: string, value: string) {
  return trimText(
    `${action} ${value}`
      .replace("附近观察", "")
      .replace("且反抽失败", "")
      .replace("且无法快速收复", "")
      .replace(/[。；;]$/g, "")
      .trim(),
    24,
  );
}

function trimText(value: string, limit: number) {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > limit ? `${compact.slice(0, limit)}…` : compact;
}
