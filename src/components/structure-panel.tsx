import AccountTreeRoundedIcon from "@mui/icons-material/AccountTreeRounded";
import { decisionMetricsFor } from "../lib/market-metrics";
import type { FactorScore, MarketAnalysisReport, PatternAnalysis, StructureAnalysis } from "../lib/types";
import { DetailTooltip } from "./detail-tooltip";

type StructurePanelProps = {
  structure: StructureAnalysis;
  factorScores?: FactorScore[];
  patternAnalysis?: PatternAnalysis;
  report?: MarketAnalysisReport;
};

export function StructurePanel({ structure, factorScores = [], patternAnalysis, report }: StructurePanelProps) {
  const metrics = report ? decisionMetricsFor(report) : fallbackMetricsFor(factorScores);
  const mainPattern = patternAnalysis?.dominant ?? patternAnalysis?.patterns[0] ?? null;

  return (
    <section className="panel structure-panel">
      <div className="micro-panel-head">
        <AccountTreeRoundedIcon fontSize="inherit" />
        <span>动作地图</span>
      </div>

      <div className="structure-template-grid">
        <article className="structure-status-card">
          <span>当前结构状态</span>
          <strong>{cleanTrend(structure.trend)}</strong>
          <p>
            支撑：{structure.support}
            <br />
            压力：{structure.resistance}
          </p>
        </article>

        <div className="structure-score-row">
          {metrics.map((metric) => (
            <StructureScore key={metric.label} label={metric.label} value={metric.value} tone={structureScoreTone(metric.tone)} />
          ))}
        </div>
      </div>

      <div className="action-map">
        {structure.actionMap.slice(0, 6).map((line) => (
          <DetailTooltip key={line.key} title={line.detail}>
            <article className={`action-line is-${line.tone} has-detail`}>
              <span>{line.label}</span>
              <strong>{line.value}</strong>
              <em>{line.action}</em>
            </article>
          </DetailTooltip>
        ))}
      </div>

      <div className="structure-signals is-template">
        {structure.signals.slice(0, 4).map((signal) => (
          <article key={signal.key} className={`structure-signal is-${signal.tone}`}>
            <span>{signal.label}</span>
            <strong>{signal.value}</strong>
            <p>{signal.detail}</p>
          </article>
        ))}
      </div>

      <article className={`main-pattern-strip is-${mainPattern?.tone ?? "neutral"}`}>
        <span>主形态</span>
        <strong>{mainPattern ? `${mainPattern.symbolLabel}：${mainPattern.label}` : "暂无高置信度主形态"}</strong>
        <p>{mainPattern ? mainPattern.action : "当前以均线结构和动作线为主。"}</p>
      </article>
    </section>
  );
}

function StructureScore({ label, value, tone }: { label: string; value: number | null; tone: string }) {
  return (
    <article className={`is-${tone}`}>
      <span>{label}</span>
      <strong>{value ?? "-"}</strong>
    </article>
  );
}

function cleanTrend(value: string) {
  return value.replace(/^结构状态：/, "");
}

function fallbackMetricsFor(factors: FactorScore[]) {
  const trend = factors.find((item) => item.key === "trend")?.score ?? null;
  const structure = factors.find((item) => item.key === "structure")?.score ?? null;
  const trade = factors.find((item) => item.key === "opportunity")?.score ?? null;
  return [
    { label: "趋势质量", value: trend, tone: "positive" },
    { label: "结构一致", value: structure, tone: "neutral" },
    { label: "交易买点", value: trade, tone: "blue" },
  ];
}

function structureScoreTone(tone: string) {
  if (tone === "index" || tone === "positive") return "positive";
  if (tone === "leader" || tone === "composite" || tone === "neutral") return "blue";
  return tone;
}
