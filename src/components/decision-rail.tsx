import AccountBalanceWalletRoundedIcon from "@mui/icons-material/AccountBalanceWalletRounded";
import BoltRoundedIcon from "@mui/icons-material/BoltRounded";
import ChevronRightRoundedIcon from "@mui/icons-material/ChevronRightRounded";
import TimelineRoundedIcon from "@mui/icons-material/TimelineRounded";
import type { ActionLine, MarketInternalSignal, MarketAnalysisReport, PositionAdvice, RiskVectorItem, SignalQuality, StateTransitionMatrix, StateTransitionOutcome, StatusMetric } from "../lib/types";
import { DetailTooltip } from "./detail-tooltip";
import { EvidenceSummaryPanel } from "./evidence-summary-panel";

type DecisionRailProps = {
  report: MarketAnalysisReport;
};

type RailActionItem = {
  label: string;
  line?: ActionLine;
  fallback?: string;
  tone?: string;
};

export function DecisionRail({ report }: DecisionRailProps) {
  const riskMetrics = report.statusMetrics.slice(0, 4);
  const riskVector = report.riskVector ?? report.decisionFrame.riskVector ?? [];
  const signalQuality = report.signalQuality ?? report.decisionFrame.signalQuality;
  const transitionMatrix = report.stateTransitionMatrix ?? report.decisionFrame.stateTransitionMatrix;
  const waitLine = actionLineFor(report.structure.actionMap, "wait");
  const reduceLine = actionLineFor(report.structure.actionMap, "reduce");
  const defenseLine = actionLineFor(report.structure.actionMap, "defense");
  const protocolState = report.decisionFrame.protocolState;
  const isBroken = protocolState === "broken";
  const isPanic = protocolState === "panic";
  const actionTitle = isBroken || isPanic ? "修复路线" : "下一步动作";
  const actionItems: RailActionItem[] = isBroken || isPanic
    ? [
        {
          label: isPanic ? "解除条件" : "修复条件",
          fallback: report.decisionFrame.condition,
          tone: "caution",
        },
        {
          label: "防守触发",
          line: defenseLine,
          fallback: report.positionAdvice[0]?.riskTrigger ?? report.structure.invalidation,
          tone: "negative",
        },
        {
          label: "禁止动作",
          fallback: isPanic ? "解除前不恢复风险预算" : "修复前不追高、不扩仓",
          tone: "negative",
        },
      ]
    : [
        { label: "加仓观察", line: waitLine, fallback: report.positionAdvice[0]?.entryTrigger },
        { label: "减仓观察", line: reduceLine, fallback: report.positionAdvice[0]?.riskTrigger },
        { label: "防守触发", line: defenseLine, fallback: report.structure.invalidation },
      ];

  return (
    <aside className={`decision-rail workspace-inspector-rail is-protocol-${protocolState}`}>
      <section className="rail-card rail-risk-card">
        <div className="rail-risk-grid">
          {riskVector.length
            ? riskVector.slice(0, 4).map((item) => <RiskVectorMetric key={item.key} item={item} />)
            : riskMetrics.map((metric) => (
                <DetailTooltip key={metric.key} title={metric.detail}>
                  <article className={`is-${metric.tone} has-detail`}>
                    <span>{metricLabel(metric)}</span>
                    <strong>{metric.value}</strong>
                  </article>
                </DetailTooltip>
              ))}
        </div>

        <DetailTooltip title={report.marketInternals.summary}>
          <div className="rail-scope-line has-detail">
            <span>{report.marketInternals.scopeLabel}</span>
            <strong>监控口径</strong>
          </div>
        </DetailTooltip>

        <div className="rail-internal-grid">
          {report.marketInternals.signals.map((signal) => (
            <InternalSignalItem key={signal.key} signal={signal} />
          ))}
        </div>
      </section>

      {signalQuality ? <SignalQualityCard quality={signalQuality} /> : null}

      {transitionMatrix ? <TransitionMatrixCard matrix={transitionMatrix} /> : null}

      <section className="rail-card rail-action-card">
        <div className="rail-section-head">
          <BoltRoundedIcon fontSize="inherit" />
          <span>{actionTitle}</span>
        </div>

        <div className="rail-trigger-list">
          {actionItems.map((item) => (
            <TriggerItem
              key={item.label}
              label={item.label}
              line={item.line}
              fallback={item.fallback}
              tone={item.tone}
            />
          ))}
        </div>
      </section>

      <EvidenceSummaryPanel report={report} compact />

      <section className="rail-card rail-position-card">
        <div className="rail-section-head">
          <AccountBalanceWalletRoundedIcon fontSize="inherit" />
          <span>仓位节奏</span>
        </div>

        <div className="rail-position-list">
          {report.positionAdvice.map((advice) => (
            <PositionRhythmItem key={advice.horizonKey} advice={advice} />
          ))}
        </div>
      </section>
    </aside>
  );
}

function SignalQualityCard({ quality }: { quality: SignalQuality }) {
  const drivers = [...quality.drivers].sort((left, right) => left.score - right.score).slice(0, 3);

  return (
    <section className="rail-card rail-quality-card">
      <div className="rail-section-head">
        <TimelineRoundedIcon fontSize="inherit" />
        <span>信号质量</span>
        <em>{quality.score}/100</em>
      </div>

      <p>{quality.summary}</p>

      <div className="rail-quality-list">
        {drivers.map((driver) => (
          <DetailTooltip key={driver.key} title={driver.detail}>
            <article className={`rail-quality-row is-${driver.tone} has-detail`}>
              <span>{driver.label}</span>
              <div aria-hidden="true">
                <i style={{ width: `${driver.score}%` }} />
              </div>
              <strong>{driver.score}</strong>
            </article>
          </DetailTooltip>
        ))}
      </div>
    </section>
  );
}

function TransitionMatrixCard({ matrix }: { matrix: StateTransitionMatrix }) {
  return (
    <section className="rail-card rail-transition-card">
      <div className="rail-section-head">
        <TimelineRoundedIcon fontSize="inherit" />
        <span>状态转移</span>
        <em>{matrix.horizonDays} 日</em>
      </div>

      <p>{matrix.summary}</p>

      <div className="rail-transition-list">
        {matrix.outcomes.slice(0, 5).map((outcome) => (
          <TransitionOutcomeItem key={outcome.key} outcome={outcome} />
        ))}
      </div>
    </section>
  );
}

function TransitionOutcomeItem({ outcome }: { outcome: StateTransitionOutcome }) {
  return (
    <DetailTooltip title={outcome.summary}>
      <article className={`rail-transition-row is-${outcome.tone} has-detail`}>
        <span>{outcome.label}</span>
        <div aria-hidden="true">
          <i style={{ width: `${outcome.probability}%` }} />
        </div>
        <strong>{outcome.probability}%</strong>
      </article>
    </DetailTooltip>
  );
}

function RiskVectorMetric({ item }: { item: RiskVectorItem }) {
  const tooltip = (
    <div className="rail-risk-vector-tooltip">
      <strong>{item.label} {item.score}/100</strong>
      <p>{item.detail}</p>
      {item.drivers.length ? (
        <ul>
          {item.drivers.map((driver) => (
            <li key={driver}>{driver}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );

  return (
    <DetailTooltip title={tooltip}>
      <article className={`is-${item.tone} has-detail`}>
        <span>{item.label}</span>
        <strong>{item.status}</strong>
        <em>{item.score}/100</em>
      </article>
    </DetailTooltip>
  );
}

function InternalSignalItem({ signal }: { signal: MarketInternalSignal }) {
  return (
    <DetailTooltip title={signal.detail}>
      <article className={`is-${signal.tone} has-detail`}>
        <span>{signal.label}</span>
        <strong>{signal.value}</strong>
        <em>{signal.status}</em>
      </article>
    </DetailTooltip>
  );
}

function TriggerItem({
  label,
  line,
  fallback,
  tone,
}: {
  label: string;
  line?: ActionLine;
  fallback?: string;
  tone?: string;
}) {
  return (
    <DetailTooltip title={line?.detail ?? fallback}>
      <article className={`is-${tone ?? line?.tone ?? "neutral"} has-detail`}>
        <span>{label}</span>
        <strong>{line ? compactTrigger(line) : fallback ?? "-"}</strong>
        <ChevronRightRoundedIcon fontSize="inherit" />
      </article>
    </DetailTooltip>
  );
}

function PositionRhythmItem({ advice }: { advice: PositionAdvice }) {
  return (
    <DetailTooltip title={`${advice.confidenceReason ? `${advice.confidenceReason} ` : ""}${advice.rationale} ${advice.entryTrigger}`}>
      <article className={`is-${normalizeRailTone(advice.confidenceTone)} has-detail`}>
        <div>
          <span>{advice.horizonLabel}</span>
          <em>{advice.confidenceLabel}</em>
        </div>
        <strong>{positionRangeDisplay(advice)}</strong>
        <p>{compactRailAdvice(advice.action)}</p>
      </article>
    </DetailTooltip>
  );
}

function positionRangeDisplay(advice: PositionAdvice) {
  return advice.currentRange?.display ?? advice.targetPosition;
}

function metricLabel(metric: StatusMetric) {
  if (metric.key === "volatility_risk") {
    return "波动恐慌";
  }
  return metric.label;
}

function actionLineFor(lines: ActionLine[], intent: "wait" | "reduce" | "defense") {
  if (intent === "wait") {
    return lines.find((line) => line.key.includes("wait") || line.label.includes("等待") || line.label.includes("加仓"));
  }
  if (intent === "reduce") {
    return lines.find((line) => line.key.includes("reduce") || line.label.includes("减仓"));
  }
  return lines.find((line) => line.key.includes("defense") || line.label.includes("防守"));
}

function compactTrigger(line: ActionLine) {
  const action = line.action
    .replace("附近观察", "")
    .replace("且反抽失败", "")
    .replace("且无法快速收复", "")
    .trim();
  if (line.key.includes("confirm") && line.value) {
    return `${line.value} ${action}`.trim();
  }
  return `${action} ${line.value}`.trim();
}

function normalizeRailTone(tone: string) {
  if (tone === "positive" || tone === "negative" || tone === "caution") {
    return tone;
  }
  return "neutral";
}

function compactRailAdvice(value: string) {
  const compact = value.replace(/[。；;]$/g, "").replace(/\s+/g, " ").trim();
  return compact.length > 18 ? `${compact.slice(0, 18)}…` : compact;
}
