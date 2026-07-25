import { useMemo } from "react";
import type { BrokerAdapterPlan, BrokerMode } from "../../lib/broker-adapter";
import type { BrokerBridgeStatus } from "../../lib/broker-bridge";
import type { ScenarioProjectionResult } from "../../lib/backtest-engine";
import type { FundReplacementPlan } from "../../lib/fund-replacement-plan";
import type { PositionPlan, PositionPlanTone } from "../../lib/position-plan";
import type { RecommendationReadiness } from "../../lib/recommendation-readiness";
import type { RiskGuardPolicy } from "../../lib/risk-policy";
import {
  normalizePlanTone,
  QBOT_PRESETS,
  type LabTone,
  type QbotPreset,
} from "../../lib/strategy-engine";
import {
  SCALING_POLICIES,
  scalingPolicyDefinition,
  type ScalingPolicyKey,
  type StrategyPolicyConfig,
} from "../../lib/strategy-policies";
import { compareScalingPolicies, type ScalingReplayComparison } from "../../lib/strategy-scaling-replay";
import type { MarketAnalysisReport } from "../../lib/types";
import { formatMoney, formatNumber, formatPercent } from "../../lib/utils";
import { sideLabel } from "../../lib/quant-desk-view";
import { handleTabListKeyDown } from "../../lib/tab-keyboard";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/dialog";
import {
  BROKER_OPTIONS,
  EXECUTION_MODE_OPTIONS,
  QUANT_DIALOG_META,
  type ExecutionMode,
  type QuantDialogKey,
} from "./quant-lab-contracts";
import "../../styles/pages/quant-lab-dialogs.css";

export type QuantLabDialogsProps = {
  activeAdapterPlan: BrokerAdapterPlan;
  activeDialog: Exclude<QuantDialogKey, null>;
  bridgeError: string;
  bridgeLoading: boolean;
  bridgeStatuses: BrokerBridgeStatus[];
  brokerMode: BrokerMode;
  executionLabel: string;
  executionMode: ExecutionMode;
  executionTone: LabTone;
  lastRun: ScenarioProjectionResult | null;
  onBrokerChange: (mode: BrokerMode) => void;
  onClose: () => void;
  onExecutionModeChange: (mode: ExecutionMode) => void;
  onPresetChange: (preset: QbotPreset) => void;
  onRefreshBridge: () => void;
  onRequireLiveConfirmationToggle: () => void;
  onRiskCapChange: (key: keyof RiskGuardPolicy["singleOrderCaps"], value: number) => void;
  onRiskLossChange: (key: keyof RiskGuardPolicy["lossBrake"], value: number) => void;
  onRiskNumberChange: (key: "cooldownMinutes" | "maxDailyOrders", value: number) => void;
  onRiskOverrideToggle: () => void;
  onScalingPolicyChange: (key: ScalingPolicyKey) => void;
  onStartReplacementSimulation: () => void;
  onStrategyPolicyChange: (patch: Partial<StrategyPolicyConfig>) => void;
  paperSimLastRunDate: string;
  paperSimTone: LabTone;
  positionPlan: PositionPlan;
  primaryReplacementPlan: FundReplacementPlan | null;
  qbotPreset: QbotPreset;
  recommendationReadiness: RecommendationReadiness;
  report: MarketAnalysisReport;
  riskOverride: boolean;
  riskPolicy: RiskGuardPolicy;
  riskPolicyError: string;
  strategyPolicyConfig: StrategyPolicyConfig;
};

export default function QuantLabDialogs(props: QuantLabDialogsProps) {
  const {
    activeAdapterPlan,
    activeDialog,
    bridgeError,
    bridgeLoading,
    bridgeStatuses,
    brokerMode,
    executionLabel,
    executionMode,
    executionTone,
    lastRun,
    onBrokerChange,
    onClose,
    onExecutionModeChange,
    onPresetChange,
    onRefreshBridge,
    onRequireLiveConfirmationToggle,
    onRiskCapChange,
    onRiskLossChange,
    onRiskNumberChange,
    onRiskOverrideToggle,
    onScalingPolicyChange,
    onStartReplacementSimulation,
    onStrategyPolicyChange,
    paperSimLastRunDate,
    paperSimTone,
    positionPlan,
    primaryReplacementPlan,
    qbotPreset,
    recommendationReadiness,
    report,
    riskOverride,
    riskPolicy,
    riskPolicyError,
    strategyPolicyConfig,
  } = props;
  const activeScalingPolicy = scalingPolicyDefinition(strategyPolicyConfig.scalingPolicyKey);
  const scalingReplay = useMemo(
    () => compareScalingPolicies({
      activeConfig: strategyPolicyConfig,
      samples: report.backtest.stateValidation.replaySamples ?? [],
    }),
    [report, strategyPolicyConfig],
  );
  const activeGate = positionPlan.riskGate;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className={`quant-dialog is-${activeDialog}`} mobileMode="sheet" showCloseButton size="lg">
        <DialogHeader className="quant-dialog-head">
          <div>
            <DialogDescription>{QUANT_DIALOG_META[activeDialog].eyebrow}</DialogDescription>
            <DialogTitle>{QUANT_DIALOG_META[activeDialog].title}</DialogTitle>
          </div>
        </DialogHeader>

        {activeDialog === "strategy" ? (
          <div className="quant-dialog-stack">
            <div className="quant-qbot-presets" aria-label="Qbot 策略预设">
              <div className="quant-mini-head"><span>Qbot 预设</span><strong>{qbotPreset.platform}</strong></div>
              <div className="quant-qbot-list">
                {QBOT_PRESETS.map((item) => (
                  <button key={item.key} type="button" className={item.key === qbotPreset.key ? "is-active" : undefined} onClick={() => onPresetChange(item)}>
                    <strong>{item.label}</strong><span>{item.tradeType}</span><em>{item.strategy}</em>
                  </button>
                ))}
              </div>
            </div>

            <div className="quant-qbot-presets quant-scaling-policy-panel" aria-label="仓位递进方法">
              <div className="quant-mini-head"><span>仓位方法</span><strong>{activeScalingPolicy.label} · {activeScalingPolicy.riskLabel}</strong></div>
              <div className="quant-qbot-list quant-scaling-policy-list">
                {SCALING_POLICIES.map((policy) => (
                  <button key={policy.key} type="button" className={policy.key === strategyPolicyConfig.scalingPolicyKey ? "is-active" : undefined} onClick={() => onScalingPolicyChange(policy.key)}>
                    <strong>{policy.label}</strong><span>{policy.riskLabel}</span><em>{policy.detail}</em>
                  </button>
                ))}
              </div>
              {activeScalingPolicy.triggerDirection !== "none" ? (
                <div className="quant-policy-controls" aria-label="仓位方法参数">
                  <label>
                    <span>最多批次</span><strong>{strategyPolicyConfig.maxTranches}</strong>
                    <input type="range" min="2" max="5" step="1" value={strategyPolicyConfig.maxTranches} onChange={(event) => onStrategyPolicyChange({ maxTranches: Number(event.target.value) })} />
                  </label>
                  {activeScalingPolicy.triggerDirection === "down" || activeScalingPolicy.triggerDirection === "up" ? (
                    <label>
                      <span>{activeScalingPolicy.triggerDirection === "down" ? "回撤触发" : "上涨触发"}</span><strong>{formatNumber(strategyPolicyConfig.triggerPct, 1)}%</strong>
                      <input type="range" min="0.5" max="10" step="0.5" value={strategyPolicyConfig.triggerPct} onChange={(event) => onStrategyPolicyChange({ triggerPct: Number(event.target.value) })} />
                    </label>
                  ) : null}
                  <label>
                    <span>冷却时间</span><strong>{strategyPolicyConfig.cooldownDays} 天</strong>
                    <input type="range" min="0" max="10" step="1" value={strategyPolicyConfig.cooldownDays} onChange={(event) => onStrategyPolicyChange({ cooldownDays: Number(event.target.value) })} />
                  </label>
                </div>
              ) : null}
            </div>

            <ScalingReplayPanel comparison={scalingReplay} activePolicyKey={strategyPolicyConfig.scalingPolicyKey} />
            <div className="quant-parameter-grid" aria-label="情景试算参数">
              <Param label="标的池" value={report.profileKey} />
              <Param label="仓位方法" value={activeScalingPolicy.label} />
              <Param label="周期" value="1D" />
              <Param label="成交" value="次日收盘" />
              <Param label="费用" value="10 bps" />
              <Param label="滑点" value="20 bps" />
              <Param label="单标上限" value={`${formatNumber(positionPlan.policy.singleAssetCap, 0)}%`} />
            </div>
          </div>
        ) : null}

        {activeDialog === "bridge" ? (
          <div className="quant-dialog-stack">
            <div className="quant-execution-mode-options" role="tablist" aria-label="执行方式" onKeyDown={handleTabListKeyDown}>
              {EXECUTION_MODE_OPTIONS.map((item) => (
                <button key={item.key} type="button" role="tab" aria-selected={executionMode === item.key} tabIndex={executionMode === item.key ? 0 : -1} className={executionMode === item.key ? "is-active" : undefined} disabled={item.key === "auto" && !recommendationReadiness.autoExecutionAllowed} title={item.key === "auto" && !recommendationReadiness.autoExecutionAllowed ? `${recommendationReadiness.validationLabel}：先完成样本外验证` : item.detail} onClick={() => onExecutionModeChange(item.key)}>
                  <strong>{item.label}</strong><span>{item.detail}</span>
                </button>
              ))}
            </div>
            <div className="quant-broker-options" role="tablist" aria-label="执行通道" onKeyDown={handleTabListKeyDown}>
              {BROKER_OPTIONS.map((item) => (
                <button key={item.key} type="button" role="tab" aria-selected={brokerMode === item.key} tabIndex={brokerMode === item.key ? 0 : -1} className={brokerMode === item.key ? "is-active" : undefined} disabled={!recommendationReadiness.autoExecutionAllowed} title={!recommendationReadiness.autoExecutionAllowed ? `${recommendationReadiness.validationLabel}：通道自动暂不可用` : item.detail} onClick={() => onBrokerChange(item.key)}>
                  <strong>{item.label}</strong><span>{item.detail}</span>
                </button>
              ))}
            </div>
            <div className="quant-router-meta">
              <Param label="方式" value={executionLabel} tone={executionTone} />
              <Param label="类型" value={executionMode === "manual" ? "人工" : executionMode === "simulation" ? "实验" : brokerMode === "live-gateway" ? "实盘" : "虚拟盘"} tone={executionMode === "manual" ? "caution" : executionMode === "simulation" ? paperSimTone : brokerMode === "live-gateway" ? "caution" : "positive"} />
              <Param label="平台" value={qbotPreset.platform} />
              <Param label="品种" value={qbotPreset.tradeType} />
            </div>
            {executionMode === "manual" ? <article className="quant-manual-mode-card"><strong>手动交易</strong><span>系统只生成下单票、执行风控和保留审计；你在外部交易平台完成下单后，再回到订单中心标记状态。</span></article> : null}
            {executionMode === "simulation" ? <article className="quant-manual-mode-card"><strong>自动模拟</strong><span>系统使用独立虚拟账户执行 Profile 建议、记录成交和每日净值，不触达真实通道。</span></article> : null}
            <AdapterPlanCard plan={activeAdapterPlan} />
            <div className="quant-bridge-status-list">
              <div className="quant-mini-head"><span>本机桥接</span><button type="button" onClick={onRefreshBridge}>{bridgeLoading ? "探测中" : "重新探测"}</button></div>
              {bridgeError ? <p className="quant-dialog-error">{bridgeError}</p> : null}
              {bridgeStatuses.map((item) => <BridgeStatusCard key={item.bridge} status={item} />)}
            </div>
          </div>
        ) : null}

        {activeDialog === "backtest" ? (
          <div className="quant-dialog-stack quant-backtest-dialog">
            {lastRun ? (
              <>
                <article className={`quant-backtest-summary is-${lastRun.tone}`}><span>当前情景结果</span><strong>{lastRun.summary}</strong><p>{lastRun.methodology}</p></article>
                <div className="quant-parameter-grid" aria-label="情景试算结果">
                  <Param label="净收益" value={formatPercent(lastRun.pnlPct)} tone={lastRun.tone} />
                  <Param label="最大回撤" value={formatPercent(lastRun.maxDrawdownPct)} tone={lastRun.maxDrawdownPct <= -18 ? "negative" : "caution"} />
                  <Param label="胜率" value={formatPercent(lastRun.winRatePct)} />
                  <Param label="Sharpe" value={formatNumber(lastRun.sharpe, 2)} />
                  <Param label="模拟委托" value={`${lastRun.simulatedOrders.length} 单`} />
                  <Param label="换手" value={formatPercent(lastRun.turnoverPct)} />
                </div>
                {lastRun.simulatedOrders.length ? (
                  <div className="quant-backtest-orders" aria-label="模拟委托明细">
                    {lastRun.simulatedOrders.map((order) => (
                      <article key={order.key} className={order.blocked ? "is-negative" : "is-neutral"}>
                        <strong>{order.symbol}</strong><span>{sideLabel(order.side)} · {formatMoney(order.notional, positionPlan.currency)}</span><em>{order.blocked ? "已阻断" : `净贡献 ${formatPercent(order.netPnlPct)}`}</em>
                      </article>
                    ))}
                  </div>
                ) : null}
              </>
            ) : <div className="quant-dialog-empty"><strong>暂无试算结果</strong><span>请先生成可建票建议后重新运行试算。</span></div>}
          </div>
        ) : null}

        {activeDialog === "risk" ? (
          <div className="quant-dialog-stack">
            <section className="quant-risk-switchboard">
              <div className="quant-risk-summary-grid" aria-label="当前风控摘要">
                <RiskRule label="现金底线" value={`${formatNumber(positionPlan.policy.minCashWeight, 0)}%`} tone={positionPlan.hasCashInstrument ? "positive" : "caution"} />
                <RiskRule label="单标上限" value={`${formatNumber(positionPlan.policy.singleAssetCap, 0)}%`} tone="positive" />
                <RiskRule label="单日委托" value={`${riskPolicy.maxDailyOrders} 单`} tone="positive" />
                <RiskRule label="冷却时间" value={`${riskPolicy.cooldownMinutes} 分钟`} tone={riskPolicy.cooldownMinutes ? "positive" : "neutral"} />
                <RiskRule label="风险门" value={activeGate?.blocked ? "阻断" : activeGate?.watch ? "观察" : "通过"} tone={activeGate?.tone ?? "neutral"} />
              </div>
              <div className="quant-parameter-grid" aria-label="风控参数">
                <RiskNumberInput label="ETF 单笔" max={20} min={0.5} step={0.5} suffix="%" value={riskPolicy.singleOrderCaps.etfPct} onChange={(value) => onRiskCapChange("etfPct", value)} />
                <RiskNumberInput label="基金单笔" max={20} min={0.5} step={0.5} suffix="%" value={riskPolicy.singleOrderCaps.fundPct} onChange={(value) => onRiskCapChange("fundPct", value)} />
                <RiskNumberInput label="杠杆 ETF" max={10} min={0.5} step={0.5} suffix="%" value={riskPolicy.singleOrderCaps.leveragedEtfPct} onChange={(value) => onRiskCapChange("leveragedEtfPct", value)} />
                <RiskNumberInput label="股票单笔" max={20} min={0.5} step={0.5} suffix="%" value={riskPolicy.singleOrderCaps.stockPct} onChange={(value) => onRiskCapChange("stockPct", value)} />
                <RiskNumberInput label="单日委托" max={50} min={0} step={1} suffix="单" value={riskPolicy.maxDailyOrders} onChange={(value) => onRiskNumberChange("maxDailyOrders", value)} />
                <RiskNumberInput label="冷却" max={240} min={0} step={5} suffix="分钟" value={riskPolicy.cooldownMinutes} onChange={(value) => onRiskNumberChange("cooldownMinutes", value)} />
                <RiskNumberInput label="ETF 提醒" max={20} min={0} step={0.5} suffix="%" value={riskPolicy.lossBrake.etfDailyDropWarnPct} onChange={(value) => onRiskLossChange("etfDailyDropWarnPct", value)} />
                <RiskNumberInput label="ETF 阻断" max={30} min={0} step={0.5} suffix="%" value={riskPolicy.lossBrake.etfDailyDropBlockPct} onChange={(value) => onRiskLossChange("etfDailyDropBlockPct", value)} />
              </div>
              <button type="button" aria-pressed={riskOverride} className={`quant-override-button ${riskOverride ? "is-active" : ""}`} onClick={onRiskOverrideToggle}>手动放行<strong>{riskOverride ? "开启" : "关闭"}</strong></button>
              <button type="button" aria-pressed={riskPolicy.requireLiveConfirmation} className={`quant-override-button ${riskPolicy.requireLiveConfirmation ? "is-active" : ""}`} onClick={onRequireLiveConfirmationToggle}>实盘二次确认<strong>{riskPolicy.requireLiveConfirmation ? "开启" : "关闭"}</strong></button>
              {riskPolicyError ? <p className="quant-dialog-error">{riskPolicyError}</p> : null}
            </section>
          </div>
        ) : null}

        {activeDialog === "replacement" && primaryReplacementPlan ? (
          <div className="quant-dialog-stack">
            <article className={`quant-replacement-summary is-${primaryReplacementPlan.executable ? "positive" : "caution"}`}><span>{primaryReplacementPlan.label}</span><strong>{primaryReplacementPlan.sourceSymbol} → {primaryReplacementPlan.targetSymbol}</strong><p>{primaryReplacementPlan.summary}</p></article>
            <div className="quant-parameter-grid" aria-label="替换金额">
              <Param label="预计赎回" value={formatMoney(primaryReplacementPlan.sellAmount, positionPlan.currency)} tone="caution" />
              <Param label="预计赎回费" value={primaryReplacementPlan.estimatedRedemptionFee == null ? "待核对" : formatMoney(primaryReplacementPlan.estimatedRedemptionFee, positionPlan.currency)} tone={primaryReplacementPlan.estimatedRedemptionFee == null ? "caution" : "neutral"} />
              <Param label="预计申购" value={formatMoney(primaryReplacementPlan.buyAmount, positionPlan.currency)} tone="positive" />
              <Param label="申购批次" value={primaryReplacementPlan.batches ? `${primaryReplacementPlan.batches} 批` : "—"} />
            </div>
            <section className="quant-replacement-sequence" aria-label="关联模拟顺序">
              <article><em>1</em><div><strong>提交赎回模拟</strong><span>只创建 {primaryReplacementPlan.sourceSymbol} 的赎回委托。</span></div></article>
              <article><em>2</em><div><strong>等待净值确认与资金到账</strong><span>到账前不会预先创建目标基金申购。</span></div></article>
              <article><em>3</em><div><strong>按限购分批申购</strong><span>每个交易日重新核对 {primaryReplacementPlan.targetSymbol} 的申购状态和限额。</span></div></article>
            </section>
            {primaryReplacementPlan.warnings.length ? <article className="quant-replacement-warning"><strong>当前不能直接执行</strong><span>{primaryReplacementPlan.warnings.join("；")}</span></article> : null}
            <article className="quant-manual-mode-card"><strong>仅进入模拟账本</strong><span>不会连接券商或生成真实交易；申购暂停、限购变化或数据过期时，链路会停止并保留现金。</span></article>
            <div className="quant-replacement-actions">
              <button type="button" className="is-primary" disabled={!primaryReplacementPlan.executable || primaryReplacementPlan.action !== "replace" || paperSimLastRunDate === report.asOf} title={paperSimLastRunDate === report.asOf ? `${report.asOf} 模拟账户已经结算，请在下一交易日刷新后启动。` : primaryReplacementPlan.executable ? "创建关联基金替换模拟" : primaryReplacementPlan.summary} onClick={onStartReplacementSimulation}>创建关联模拟</button>
              <button type="button" onClick={onClose}>取消</button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ScalingReplayPanel({ activePolicyKey, comparison }: { activePolicyKey: ScalingPolicyKey; comparison: ScalingReplayComparison }) {
  return (
    <section className="quant-scaling-replay" aria-label="仓位方法历史回放对照">
      <header><div><span>历史回放对照</span><strong>{comparison.horizonDays} 日 · 基准路径代理</strong></div><em className={`is-${comparison.evidence}`}>n={comparison.sampleCount} · {comparison.evidenceLabel}</em></header>
      {comparison.sampleCount ? (
        <>
          <div className="quant-scaling-replay-head" aria-hidden="true"><span>方法</span><span>净收益中位</span><span>回撤中位</span><span>尾部均值</span><span>资金占用</span></div>
          <div className="quant-scaling-replay-list">
            {comparison.metrics.map((metric) => (
              <article key={metric.policyKey} className={metric.policyKey === activePolicyKey ? "is-active" : undefined}>
                <div><strong>{metric.label}</strong><small>{metric.averageTranches} 批</small></div>
                <span className={replayTone(metric.medianNetReturnPct)}>{formatReplayMetric(metric.medianNetReturnPct)}</span>
                <span className="is-negative">{formatReplayMetric(metric.medianMaxDrawdownPct)}</span>
                <span className="is-negative">{formatReplayMetric(metric.tailAverageReturnPct)}</span>
                <span>{formatNumber(metric.averageCapitalUtilizationPct, 0)}%</span>
                {comparison.winnerKey === metric.policyKey ? <b>稳健领先</b> : null}
              </article>
            ))}
          </div>
        </>
      ) : <div className="quant-scaling-replay-empty">当前报告没有可回放的历史路径；刷新市场数据后再比较，系统不会用均值伪造回放。</div>}
      <p>{comparison.methodology}</p>
    </section>
  );
}

function Param({ label, tone = "neutral", value }: { label: string; tone?: LabTone; value: string }) {
  return <article className={`quant-param is-${tone}`}><span>{label}</span><strong>{value}</strong></article>;
}

function RiskRule({ label, tone, value }: { label: string; tone: LabTone | PositionPlanTone; value: string }) {
  return <article className={`quant-risk-rule is-${normalizePlanTone(tone)}`}><span>{label}</span><strong>{value}</strong></article>;
}

function RiskNumberInput({ label, max, min, onChange, step, suffix, value }: { label: string; max: number; min: number; onChange: (value: number) => void; step: number; suffix: string; value: number }) {
  return (
    <label className="quant-param">
      <span>{label}</span><strong>{formatNumber(value, step >= 1 ? 0 : 1)}{suffix}</strong>
      <input max={max} min={min} step={step} type="number" value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}

function BridgeStatusCard({ status }: { status: BrokerBridgeStatus }) {
  const tone: LabTone = status.commandAvailable ? "positive" : status.pathExists ? "caution" : "negative";
  return (
    <article className={`quant-bridge-status is-${tone}`}>
      <div><span>{status.label}</span><strong>{status.commandAvailable ? "就绪" : "未就绪"}</strong></div>
      <p>{status.summary}</p><code>{status.path}</code>
      <div className="quant-bridge-flags"><em>路径 {status.pathExists ? "正常" : "缺失"}</em><em>适配器 {status.adapterExists ? "正常" : "缺失"}</em><em>Python {status.pythonOk ? "正常" : "缺失"}</em></div>
      {status.warnings.length ? <p>{status.warnings[0]}</p> : null}
    </article>
  );
}

function AdapterPlanCard({ plan }: { plan: BrokerAdapterPlan }) {
  const tone: LabTone = plan.ready ? "positive" : plan.pathReady ? "caution" : "negative";
  return (
    <article className={`quant-adapter-plan is-${tone}`}>
      <div className="quant-adapter-plan-head"><div><span>当前通道</span><strong>{plan.label}</strong><p>{plan.summary}</p></div><em>{plan.statusLabel}</em></div>
      <div className="quant-adapter-capabilities">{plan.capabilities.map((item) => <span key={item.key} className={item.ready ? "is-ready" : undefined}><strong>{item.label}</strong><em>{item.detail}</em></span>)}</div>
      {plan.nextActions.length ? <div className="quant-adapter-next"><span>下一步</span><strong>{plan.nextActions[0]}</strong></div> : null}
    </article>
  );
}

function formatReplayMetric(value: number) {
  return `${value > 0 ? "+" : ""}${formatNumber(value, 2)}%`;
}

function replayTone(value: number) {
  return value > 0 ? "is-positive" : value < 0 ? "is-negative" : undefined;
}
