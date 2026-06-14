import AccountTreeRoundedIcon from "@mui/icons-material/AccountTreeRounded";
import CheckCircleRoundedIcon from "@mui/icons-material/CheckCircleRounded";
import ChevronRightRoundedIcon from "@mui/icons-material/ChevronRightRounded";
import HourglassTopRoundedIcon from "@mui/icons-material/HourglassTopRounded";
import Inventory2RoundedIcon from "@mui/icons-material/Inventory2Rounded";
import RuleRoundedIcon from "@mui/icons-material/RuleRounded";
import ShieldRoundedIcon from "@mui/icons-material/ShieldRounded";
import ThermostatRoundedIcon from "@mui/icons-material/ThermostatRounded";
import TrendingUpRoundedIcon from "@mui/icons-material/TrendingUpRounded";
import WarningAmberRoundedIcon from "@mui/icons-material/WarningAmberRounded";
import type { SvgIconComponent } from "@mui/icons-material";
import type { BacktestRule, MarketAnalysisReport } from "../lib/types";
import { DetailTooltip } from "./detail-tooltip";

type RulesPanelProps = {
  report: MarketAnalysisReport;
};

export function RulesPanel({ report }: RulesPanelProps) {
  const stateRules = report.backtest.ruleSet.stateRules;
  const actionRules = report.backtest.ruleSet.actionRules;
  const profileRules = report.backtest.ruleSet.profileRules;
  const advancedRules = [...stateRules, ...actionRules, ...profileRules].slice(0, 4);

  return (
    <section className="panel rules-panel">
      <div className="panel-head">
        <h2>
          <RuleRoundedIcon />
          可回测规则
        </h2>
        <span className="panel-kicker">自然语言优先</span>
      </div>

      <div className="rule-context">
        <article className="rule-context-card is-positive">
          <span className="rule-icon-box">
            <ShieldRoundedIcon fontSize="inherit" />
          </span>
          <div>
            <span>当前状态</span>
            <strong>{report.marketState.label}</strong>
          </div>
        </article>
        <article className="rule-context-card is-positive">
          <span className="rule-icon-box">
            <TrendingUpRoundedIcon fontSize="inherit" />
          </span>
          <div>
            <span>执行主线</span>
            <strong>{report.positionAdvice[0]?.action ?? "等待确认"}</strong>
          </div>
        </article>
        <article className="rule-context-card is-negative">
          <span className="rule-icon-box">
            <WarningAmberRoundedIcon fontSize="inherit" />
          </span>
          <div>
            <span>结构失效</span>
            <strong>{report.structure.invalidation}</strong>
          </div>
        </article>
      </div>

      <div className="rule-board">
        <RuleSection icon={RuleRoundedIcon} label="状态规则" rules={stateRules} groupKey="state" />
        <RuleSection icon={TrendingUpRoundedIcon} label="动作规则" rules={actionRules} groupKey="action" />
        <RuleSection icon={AccountTreeRoundedIcon} label="扩散规则" rules={profileRules} groupKey="profile" />
      </div>

      <div className="rule-strip-card">
        <span className="rule-icon-box is-blue">
          <AccountTreeRoundedIcon fontSize="inherit" />
        </span>
        <div>
          <strong>Profile 约束</strong>
          <p>动态配置：市场、权重和龙头确认来自 Profile，不在核心代码里写死单个市场或标的。</p>
        </div>
        <ChevronRightRoundedIcon fontSize="inherit" />
      </div>

      <details className="rule-advanced-card" open>
        <summary>
          <span className="rule-icon-box is-cyan">
            <Inventory2RoundedIcon fontSize="inherit" />
          </span>
          <strong>高级详情</strong>
          <em>规则条件概览</em>
        </summary>
        <div className="rule-condition-strip">
          {advancedRules.map((rule) => (
            <code key={rule.key}>{rule.condition}</code>
          ))}
        </div>
      </details>
    </section>
  );
}

function RuleSection({
  groupKey,
  icon: Icon,
  label,
  rules,
}: {
  groupKey: string;
  icon: SvgIconComponent;
  label: string;
  rules: BacktestRule[];
}) {
  return (
    <section className="rule-section">
      <div className="micro-panel-head">
        <Icon fontSize="inherit" />
        <span>{label}</span>
      </div>
      <div className="rule-row-list">
        {rules.length ? rules.map((rule) => <RuleItem key={rule.key} groupKey={groupKey} rule={rule} />) : <p className="quiet-text">当前 Profile 没有额外约束。</p>}
      </div>
    </section>
  );
}

function RuleItem({ groupKey, rule }: { groupKey: string; rule: BacktestRule }) {
  const status = ruleStatus(rule);
  const Icon = iconForRule(groupKey, rule);
  const StatusIcon = status.icon;

  return (
    <DetailTooltip title={rule.condition} placement="top-start">
      <article className={`rule-row is-${status.tone} has-detail`}>
        <span className="rule-icon-box">
          <Icon fontSize="inherit" />
        </span>
        <div>
          <strong>{rule.label}</strong>
          <p>{ruleNarrative(groupKey, rule)}</p>
        </div>
        <span className="rule-status-pill">
          {status.label}
          <StatusIcon fontSize="inherit" />
        </span>
      </article>
    </DetailTooltip>
  );
}

function ruleNarrative(groupKey: string, rule: BacktestRule) {
  if (groupKey === "state") {
    return `${rule.action} ${conditionHint(rule.condition)}`;
  }
  if (groupKey === "action") {
    return `${rule.action} 触发前不把分析结论当成直接买卖。`;
  }
  return rule.action;
}

function ruleStatus(rule: BacktestRule): { label: string; tone: string; icon: SvgIconComponent } {
  if (rule.tone === "positive") {
    return { label: "已命中", tone: "positive", icon: CheckCircleRoundedIcon };
  }
  if (rule.tone === "caution") {
    return { label: "观察", tone: "caution", icon: WarningAmberRoundedIcon };
  }
  return { label: "未命中", tone: "neutral", icon: CheckCircleRoundedIcon };
}

function iconForRule(groupKey: string, rule: BacktestRule): SvgIconComponent {
  if (groupKey === "action") {
    if (/long|长期/i.test(rule.key)) return HourglassTopRoundedIcon;
    if (/reduce|defense|guard|ma50/i.test(rule.key)) return ShieldRoundedIcon;
    return TrendingUpRoundedIcon;
  }
  if (groupKey === "profile") {
    if (/breadth|relative|gap/i.test(rule.key)) return AccountTreeRoundedIcon;
    if (/leader/i.test(rule.key)) return ShieldRoundedIcon;
  }
  if (/hot|heat|over/i.test(rule.key)) return ThermostatRoundedIcon;
  if (/defense|risk|guard/i.test(rule.key)) return ShieldRoundedIcon;
  return TrendingUpRoundedIcon;
}

function conditionHint(condition: string) {
  return condition ? `条件：${condition}` : "";
}
