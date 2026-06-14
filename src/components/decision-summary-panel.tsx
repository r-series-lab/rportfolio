import WarningAmberRoundedIcon from "@mui/icons-material/WarningAmberRounded";
import { Chip } from "@mui/material";
import type {
  DecisionAxis,
  DecisionMetricContext,
  FactorScore,
  MarketAnalysisReport,
  PositionAdvice,
} from "../lib/types";
import type { PositionPlan } from "../lib/position-plan";
import { DetailTooltip } from "./detail-tooltip";

type DecisionSummaryPanelProps = {
  positionPlan?: PositionPlan;
  report: MarketAnalysisReport;
};

const DECISION_PROTOCOL_STEPS = [
  { key: "allow", label: "允许分批", tone: "positive" },
  { key: "probe", label: "小仓试探", tone: "positive" },
  { key: "hold", label: "持有观察", tone: "neutral" },
  { key: "wait", label: "等待确认", tone: "caution" },
  { key: "noChase", label: "禁止追高", tone: "caution" },
  { key: "reduce", label: "停止加仓", tone: "negative" },
  { key: "defend", label: "主动降风险", tone: "negative" },
] as const;

export function DecisionSummaryPanel({ positionPlan, report }: DecisionSummaryPanelProps) {
  const heat = factorFor(report.factorScores, "heat");
  const shortOpportunity = report.opportunityScores.find((item) => item.horizonKey === "short");
  const showHeatNote = (heat?.score ?? 100) <= 15 && (shortOpportunity?.score ?? 100) < 55;
  const configuredNote = report.decisionFrame.note;
  const protocolNote = noteForProtocol(report.decisionFrame.protocolState);
  const decisionNote = configuredNote || protocolNote || (showHeatNote ? "不过热不等于买点好，当前主要看结构触发和核心标的确认。" : null);
  const summaryCopy = compactDecisionSummary(report.decisionFrame.summary);
  const conditionCopy = compactDecisionCondition(report.decisionFrame.condition);
  const actionCopy = compactActionLabel(report.decisionFrame.actionLabel);
  const noteCopy = decisionNote ? compactDecisionNote(decisionNote) : null;
  const focusCopy = noteCopy ?? fallbackFocusCopy(report.decisionFrame.protocolState);
  const decisionAxes = [report.decisionFrame.trend, report.decisionFrame.risk, report.decisionFrame.edge];
  const contextByKey = new Map(report.decisionMetricContexts.map((item) => [item.key, item]));
  const activeProtocolLabel = report.decisionFrame.permission;
  const stateConfidence = report.stateConfidence ?? report.decisionFrame.stateConfidence;
  const signalQuality = report.signalQuality ?? report.decisionFrame.signalQuality;
  const damageScore = report.damageScore ?? report.decisionFrame.damageScore;
  const primaryAdvice = report.positionAdvice[0];
  const localPositionCopy =
    positionPlan && positionPlan.totalValue > 0
      ? `当前真实风险仓位 ${formatCompactPercent(positionPlan.riskExposure)}，现金 ${formatCompactPercent(positionPlan.cashWeight)}；持仓页目标带按单资产计算。`
      : null;

  return (
    <section className={`decision-summary-panel is-protocol-${report.decisionFrame.protocolState}`} aria-label="当前市场分析">
      <div className="decision-wave" aria-hidden="true">
        <svg viewBox="0 0 640 190" preserveAspectRatio="none">
          <path className="wave-line is-soft" d="M0 128 C92 118 132 88 212 92 C282 96 306 52 386 68 C462 83 500 62 558 18 C596 -11 618 -10 640 -4" />
          <path className="wave-line" d="M0 132 C88 122 142 96 214 94 C280 92 310 64 384 72 C466 80 508 58 560 18" />
          <path className="wave-fill" d="M0 135 C88 122 142 96 214 94 C280 92 310 64 384 72 C466 80 508 58 560 18 L640 18 L640 190 L0 190 Z" />
          <circle cx="215" cy="94" r="3" />
          <circle cx="384" cy="72" r="3" />
          <circle cx="560" cy="18" r="3" />
        </svg>
      </div>
      <div className="decision-heading" aria-label="当前情况">
        <div className="decision-title-row">
          <div>
            <h1>{report.decisionFrame.permission}</h1>
          </div>
          <Chip
            size="small"
            label={report.decisionFrame.badgeLabel ?? decisionBadge(report)}
            className={`level-chip state-chip is-${report.decisionFrame.permissionTone}`}
          />
        </div>
        <div className="decision-context-grid" aria-label="状态与确认条件">
          <article className="decision-context-card">
            <span>状态</span>
            <strong>{report.decisionFrame.stateLabel}</strong>
          </article>
          <article className="decision-context-card is-condition">
            <span>{report.decisionFrame.conditionLabel}</span>
            <strong>{conditionCopy}</strong>
          </article>
        </div>
        {signalQuality || stateConfidence || damageScore ? (
          <div className="decision-intelligence-strip" aria-label="信号质量、状态置信与内部损伤">
            {signalQuality ? (
              <DetailTooltip title={signalQuality.summary}>
                <article className={`decision-intelligence-chip is-signal is-${signalQuality.tone}`}>
                  <span>信号质量</span>
                  <strong>{signalQuality.score}/100</strong>
                  <em>{signalQuality.label}</em>
                </article>
              </DetailTooltip>
            ) : null}
            {stateConfidence ? (
              <DetailTooltip title={stateConfidence.summary}>
                <article className={`decision-intelligence-chip is-${stateConfidence.tone}`}>
                  <span>状态置信</span>
                  <strong>{stateConfidence.score}/100</strong>
                  <em>{stateConfidence.label}</em>
                </article>
              </DetailTooltip>
            ) : null}
            {damageScore ? (
              <DetailTooltip title={damageScore.summary}>
                <article className={`decision-intelligence-chip is-${damageScore.tone}`}>
                  <span>内部损伤</span>
                  <strong>{damageScore.score}/100</strong>
                  <em>{damageScore.label}</em>
                </article>
              </DetailTooltip>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="decision-protocol-panel" aria-label={`分析分歧轨道，当前为${activeProtocolLabel}`}>
        <div className="decision-section-label">
          <span>分析分歧轨道</span>
          <b>{activeProtocolLabel}</b>
        </div>
        <ol className="decision-protocol-track">
          {DECISION_PROTOCOL_STEPS.map((step) => {
            const active = step.label === activeProtocolLabel;
            return (
              <li
                key={step.key}
                aria-current={active ? "step" : undefined}
                className={`decision-protocol-step is-${step.tone} ${active ? "is-active" : ""}`}
              >
                <span>{step.label}</span>
              </li>
            );
          })}
        </ol>
      </div>

      <div className="decision-copy-panel" aria-label="条件动作关注">
        <div className="decision-section-label">
          <span>条件 / 动作 / 关注</span>
          <b>{report.decisionFrame.conditionLabel}</b>
        </div>
        <div className="decision-copy-stack">
          <article className="decision-copy-card">
            <span>判断</span>
            <strong>{summaryCopy}</strong>
          </article>
          <article className="decision-copy-card">
            <span>动作</span>
            <strong>{actionCopy}</strong>
          </article>
          <article className="decision-copy-card is-note">
            <span>
              <WarningAmberRoundedIcon fontSize="inherit" aria-hidden="true" />
              关注
            </span>
            <strong>{focusCopy}</strong>
          </article>
        </div>
      </div>

      <div className="decision-position-panel" aria-label="Profile 风险仓位上限">
        <div className="decision-section-label">
          <span>Profile 风险仓位上限</span>
          <b>{primaryAdvice ? positionRangeDisplay(primaryAdvice) : report.decisionFrame.actionLabel}</b>
        </div>
        <p className="decision-position-note">
          {localPositionCopy ?? primaryAdvice?.rangeMeaning ?? "Profile 风险仓位上限，不是单只资产目标带"}
        </p>
        <div className="decision-position-strip">
          {report.positionAdvice.map((item) => (
            <AdvicePill key={item.horizonKey} advice={item} />
          ))}
        </div>
      </div>

      <div className="decision-evidence-panel" aria-label="协议证据">
        <div className="decision-section-label decision-evidence-head">
          <span>协议证据</span>
          <b>趋势 / 风险 / 机会</b>
        </div>
        <div className="structure-split">
          {decisionAxes.map((axis) => (
            <AxisMetric
              key={axis.key}
              axis={axis}
              context={contextByKey.get(axis.key)}
              strong={axis.key === "edge"}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function AdvicePill({ advice }: { advice: PositionAdvice }) {
  const blocked = advice.gates.filter((gate) => gate.status === "block").length;
  const watched = advice.gates.filter((gate) => gate.status === "watch").length;
  const gateCopy = blocked ? `${blocked} 项卡住` : watched ? `${watched} 项观察` : "闸门通过";
  const footerLeft = advice.damageScore && advice.damageScore >= 50 ? advice.damageLabel ?? advice.adjustment : advice.adjustment;
  const triggeredGates = advice.gates.filter((gate) => gate.triggered ?? gate.status !== "pass");
  const tooltipGates = rankAdviceGates(triggeredGates.length ? triggeredGates : advice.gates).slice(0, 3);
  const addRangeCopy = advice.addRange?.display ?? advice.adjustment;
  const actionSummary = conciseAdviceAction(advice, blocked, watched);
  const whySummary = conciseAdviceWhy(advice);
  const title = (
    <div className="advice-policy-tooltip">
      <strong>
        <span>{advice.horizonLabel}怎么做</span>
        <b>{advice.confidenceLabel}</b>
      </strong>
      <div className="advice-policy-meta" aria-label="策略摘要">
        <span>
          <i>仓位上限</i>
          <b>{positionRangeDisplay(advice)}</b>
        </span>
        <span>
          <i>可新增</i>
          <b>{addRangeCopy}</b>
        </span>
        <span>
          <i>限制</i>
          <b>{gateCopy}</b>
        </span>
      </div>
      <p className="advice-policy-verdict">{actionSummary}</p>
      <p>
        <b>原因</b>
        {whySummary}
      </p>
      <ul>
        {tooltipGates.map((gate) => (
          <li key={gate.key} className={`is-${gate.status} ${gate.triggered ?? gate.status !== "pass" ? "is-triggered" : ""}`}>
            <span className="advice-gate-row">
              <b>{gate.label}</b>
              <i>{plainGateStatusLabel(gate.status)}</i>
            </span>
            <em>{conciseGateDetail(gate)}</em>
          </li>
        ))}
      </ul>
    </div>
  );

  return (
    <DetailTooltip title={title}>
      <article className={`decision-advice-pill is-${advice.tone} horizon-${advice.horizonKey} has-detail`}>
        <span className="advice-pill-head">
          <b>{advice.horizonLabel}</b>
          <i className={`is-${advice.confidenceTone}`}>{advice.confidenceLabel}</i>
        </span>
        <strong>{positionRangeDisplay(advice)}</strong>
        <em>{advice.action}</em>
        <small>
          <span>{footerLeft}</span>
          <span>{gateCopy}</span>
        </small>
      </article>
    </DetailTooltip>
  );
}

function positionRangeDisplay(advice: PositionAdvice) {
  return advice.currentRange?.display ?? advice.targetPosition;
}

function formatCompactPercent(value: number) {
  return `${new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(value)}%`;
}

function gateStatusLabel(status: string) {
  if (status === "pass") return "通过";
  if (status === "block") return "卡住";
  return "观察";
}

function plainGateStatusLabel(status: string) {
  if (status === "block") return "先别做";
  if (status === "watch") return "再观察";
  if (status === "pass") return "已满足";
  return gateStatusLabel(status);
}

function conciseAdviceAction(advice: PositionAdvice, blocked: number, watched: number) {
  const range = positionRangeDisplay(advice);
  const addRange = advice.addRange?.display ?? advice.adjustment;
  const action = compactActionLabel(advice.action);
  if (blocked > 0) {
    return `${action}。当前先按 ${range} 控制，不急着加仓。`;
  }
  if (watched > 0) {
    return `${action}。可以观察，但等确认后再加。`;
  }
  if (addRange === "0%" || addRange === "0%~0%" || addRange === "0%~+0%") {
    return `${action}。当前不建议新增仓位。`;
  }
  return `${action}。可新增 ${addRange}，但不超过 ${range}。`;
}

function conciseAdviceWhy(advice: PositionAdvice) {
  const source = advice.confidenceReason || advice.rationale || advice.rangeNote || "按当前 Profile 规则控制仓位。";
  return compactAdviceSentence(source);
}

function conciseGateDetail(gate: PositionAdvice["gates"][number]) {
  return compactAdviceSentence(gate.detail);
}

function compactAdviceSentence(value: string) {
  const normalized = value
    .replace(/区间表示当前风险状态允许的目标暴露上限，?新增仓位仍需满足确认条件。?/g, "这是当前风险下的仓位上限；加仓要等确认。")
    .replace(/已按扩散损伤从\s*/g, "内部损伤已压低仓位：")
    .replace(/信号质量、内部损伤和状态置信已二次裁剪上限\s*/g, "信号不够强，已下调上限 ")
    .replace(/信号质量\s*\d+\/100，优先复核\s*信号一致性/g, "信号质量不错，但方向还没完全一致")
    .replace(/信号质量和内部损伤未触发额外仓位裁剪。?/g, "信号和损伤没有额外压仓。")
    .replace(/短期赔率仍需确认，新增仓位不应脱离触发条件/g, "买点还没确认，等触发再加")
    .replace(/主趋势未破，但确认资产正在回踩验证/g, "趋势没坏，但还在回踩验证")
    .replace(/短中期需要等过热评分降温，长期配置不把短线拥挤等同于看空/g, "有点拥挤，等降温再加")
    .replace(/当前状态为趋势破坏，趋势\/结构闸门关闭。?/g, "结构走坏，先别进攻。")
    .replace(/修复前只允许减仓、防守或等待确认。?/g, "修复前只防守。")
    .replace(/超过上限时只允许降速或降仓。?/g, "超过上限就减速或降仓。")
    .replace(/主要受/g, "受")
    .replace(/规则一致性/g, "规则信号")
    .replace(/失败反抽/g, "反抽失败")
    .replace(/约束/g, "拖累")
    .replace(/Profile 上限/g, "仓位上限")
    .replace(/风险预算/g, "仓位预算")
    .replace(/目标暴露/g, "目标仓位")
    .replace(/；/g, "，")
    .replace(/\s+/g, " ")
    .trim();
  const firstSentence = normalized.split(/[。.!?？]/)[0] || normalized;
  return truncateText(firstSentence, 32);
}

function truncateText(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

function rankAdviceGates(gates: PositionAdvice["gates"]) {
  const statusRank = new Map([
    ["block", 0],
    ["watch", 1],
    ["pass", 2],
  ]);
  return [...gates].sort((left, right) => {
    const leftTriggered = left.triggered ?? left.status !== "pass";
    const rightTriggered = right.triggered ?? right.status !== "pass";
    if (leftTriggered !== rightTriggered) return leftTriggered ? -1 : 1;
    return (statusRank.get(left.status) ?? 3) - (statusRank.get(right.status) ?? 3);
  });
}

function AxisMetric({
  axis,
  context,
  strong = false,
}: {
  axis: DecisionAxis;
  context?: DecisionMetricContext;
  strong?: boolean;
}) {
  const title = (
    <div className="axis-policy-tooltip">
      <strong>
        {axisTitle(axis.key)} {axis.score} · {axis.status}
      </strong>
      <p>{axisTooltipCopy(axis.key)}</p>
      {context ? (
        <span>
          {context.percentileLabel} · {context.sampleLabel} · {context.scope}
        </span>
      ) : null}
    </div>
  );
  return (
    <DetailTooltip title={title}>
      <article className={`axis-${axis.key} ${strong ? "is-strong" : ""} is-${axis.tone} has-detail`}>
        <span>{axisTitle(axis.key)}</span>
        <strong>{axis.score}</strong>
        <em>{axis.status}</em>
        {context ? (
          <small>
            <b>{context.percentileLabel}</b>
            <span>{context.sampleLabel}</span>
          </small>
        ) : null}
      </article>
    </DetailTooltip>
  );
}

function axisTitle(key: string) {
  if (key === "trend") return "趋势";
  if (key === "risk") return "风险";
  if (key === "edge") return "机会";
  return "指标";
}

function axisTooltipCopy(key: string) {
  if (key === "trend") return "看主趋势和结构质量；趋势好是持有基础，不等于无条件追价。";
  if (key === "risk") return "看结构破坏、系统压力、波动和过热；越高越需要降低动作强度。";
  if (key === "edge") return "看新增仓位赔率；达到试探区才允许小仓验证，达到高分区才允许分批。";
  return "用于辅助当前协议判断。";
}

function factorFor(factors: FactorScore[], key: string) {
  return factors.find((item) => item.key === key);
}

function decisionBadge(report: MarketAnalysisReport) {
  const { protocolState } = report.decisionFrame;
  const factors = report.factorScores;
  const fallback = report.decisionFrame.edge.status;
  const heat = factorFor(factors, "heat")?.score ?? 0;
  const systemic = factorFor(factors, "systemic")?.score ?? 50;
  const opportunity = factorFor(factors, "opportunity")?.score ?? 50;

  if (protocolState === "broken") {
    return "修复前不可进攻";
  }
  if (protocolState === "panic") {
    return "主动降风险";
  }
  if (heat >= 75 && systemic <= 35) {
    return "系统稳定，追高过热";
  }
  if (heat >= 75) {
    return "追高过热";
  }
  if (opportunity <= 45) {
    return "趋势强，买点差";
  }
  if (report.decisionFrame.permission === "小仓试探") {
    return "轻仓试探，等确认";
  }
  if (systemic <= 35) {
    return "无恐慌，等触发";
  }
  return fallback;
}

function noteForProtocol(protocolState: string) {
  if (protocolState === "broken") {
    return "趋势结构已破坏，修复前只允许减仓、防守或等待确认。";
  }
  if (protocolState === "panic") {
    return "系统压力主导，先保护回撤与流动性，等待解除条件。";
  }
  if (protocolState === "probe") {
    return "只做小仓验证，动作线失效后立即回到等待确认。";
  }
  return null;
}

function compactActionLabel(value: string) {
  return value
    .replace("确认后小仓试探", "确认后试探")
    .replace("小仓试探，严守动作线", "小仓试探")
    .replace("顺势持有，等回踩", "持有等回踩")
    .replace("持有观察，等确认", "持有等确认")
    .replace("核心持有，等站稳", "核心持有")
    .replace("，", " · ");
}

function compactDecisionCondition(value: string) {
  return value
    .replace("弱确认资产重新站回 MA20，或基准回踩 MA20 后不破", "弱确认站回 MA20 / 基准回踩不破")
    .replace("弱确认资产重新站回 MA20 或基准回踩 MA20 后不破", "弱确认站回 MA20 / 基准回踩不破")
    .replace("重新站回 MA20/MA50 且结构评分修复前，不恢复主动进攻仓位。", "站回 MA20/50 · 结构修复")
    .replace(/重新站回\s*MA50\s*([\d.]+)/g, "站回 MA50 $1")
    .replace(/重新站回\s*MA20\s*([\d.]+)/g, "站回 MA20 $1")
    .replace("价格回踩 MA20 不破，且交易分重新升至 75 以上。", "MA20 不破 · 交易分 >75")
    .replace("回踩 MA20/MA50 后企稳，且过热评分降至 65 以下。", "MA20/50 企稳 · 过热 <65")
    .replace("且", "·")
    .replace(/重新升至\s*(\d+)\s*以上/g, ">$1")
    .replace(/评分降至\s*(\d+)\s*以下/g, "<$1")
    .replace(/[。；;]$/g, "");
}

function compactDecisionSummary(value: string) {
  return value
    .replace("回踩观察，风险中，赔率中；小仓试探。", "回踩观察 · 风险中 · 小仓试探")
    .replace("趋势健康，风险中，赔率中；持有观察。", "趋势健康 · 风险中 · 持有观察")
    .replace("趋势健康，风险低，赔率好；允许分批。", "趋势健康 · 风险低 · 允许分批")
    .replace("趋势健康，风险中，赔率一般；等待确认。", "趋势健康 · 风险中 · 等确认")
    .replace("回踩观察，风险中，赔率一般；等待确认。", "回踩观察 · 风险中 · 等确认")
    .replace("风险扩散，结构风险中高，赔率一般；等待确认。", "风险扩散 · 结构承压 · 等确认")
    .replace(/[。；;]$/g, "");
}

function compactDecisionNote(value: string) {
  return value
    .replace("只做小仓验证，动作线失效后立即回到等待确认。", "小仓验证：失效即回到等待。")
    .replace("不过热不等于买点好，当前主要看结构触发和核心标的确认。", "买点未确认：等结构触发 + 核心标的。")
    .replace("趋势结构已破坏，修复前只允许减仓、防守或等待确认。", "结构破坏：修复前只防守。")
    .replace("系统压力主导，先保护回撤与流动性，等待解除条件。", "系统压力主导：先控回撤。")
    .replace(/[。；;]$/g, "");
}

function fallbackFocusCopy(protocolState: string) {
  if (protocolState === "broken") return "修复前不进攻，只看结构回到规则内。";
  if (protocolState === "panic") return "先控回撤，等待系统压力解除。";
  if (protocolState === "probe") return "小仓验证动作线，失效就回到等待确认。";
  if (protocolState === "healthy") return "跟踪失效条件，触发后降级处理。";
  return "关注未确认：等待结构突破 + 核心标的抬升。";
}
