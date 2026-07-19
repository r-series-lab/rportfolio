import type { PositionPlan, PositionPlanTone } from "./position-plan";
import type { MarketAnalysisReport } from "./types";
import { assessDataQuality, type DataQualityAssessment } from "./data-quality";

export type RecommendationReadiness = {
  autoExecutionAllowed: boolean;
  canExecute: boolean;
  canIncreaseRisk: boolean;
  canReduceRisk: boolean;
  confidenceLabel: string;
  confidenceScore: number;
  dataQuality: DataQualityAssessment;
  detail: string;
  label: string;
  validationLabel: string;
  tone: PositionPlanTone;
};

export function recommendationReadinessFor({
  plan,
  report,
  reportIsCurrent,
}: {
  plan: PositionPlan;
  report: MarketAnalysisReport | null;
  reportIsCurrent: boolean;
}): RecommendationReadiness {
  const dataQuality = assessDataQuality(report, reportIsCurrent);
  const signalScore = report?.signalQuality?.score ?? 0;
  const stateScore = report?.stateConfidence?.score ?? 0;
  const confidenceScore = reportIsCurrent
    ? Math.min(signalScore || 55, stateScore || 55, dataQuality.score)
    : 0;
  const confidenceLabel = confidenceScore >= 72
    ? "高可信"
    : confidenceScore >= 58
      ? "中可信"
      : confidenceScore > 0
        ? "低可信"
        : "待评估";
  const makeReadiness = (...args: Parameters<typeof readiness>): RecommendationReadiness => ({
    ...readiness(...args),
    dataQuality,
  });

  if (!report || !reportIsCurrent) {
    return makeReadiness(false, false, confidenceLabel, confidenceScore, "先刷新组合报告，再生成交易建议。", "待更新", "caution");
  }
  if (!plan.valuation.canCalculate) {
    return makeReadiness(false, false, confidenceLabel, confidenceScore, plan.valuation.detail, plan.valuation.label, "negative");
  }
  if (dataQuality.blocksExecution) {
    return makeReadiness(
      plan.valuation.riskReductionAllowed,
      false,
      confidenceLabel,
      confidenceScore,
      `${dataQuality.detail} 仍可复核降低风险的动作。`,
      plan.valuation.riskReductionAllowed ? "只减不加" : dataQuality.label,
      plan.valuation.riskReductionAllowed ? "caution" : "negative",
    );
  }
  if (!plan.valuation.riskIncreaseAllowed) {
    return makeReadiness(
      plan.valuation.riskReductionAllowed,
      false,
      confidenceLabel,
      confidenceScore,
      `${plan.valuation.detail} 仍可复核降低风险的动作。`,
      "估值待确认",
      "caution",
    );
  }
  if (!plan.hasCashInstrument) {
    return makeReadiness(true, false, confidenceLabel, confidenceScore, "缺少现金或货基记录；允许减仓，不生成新增风险仓位。", "只减不加", "caution");
  }
  if (!plan.decision.profileHealth.valid) {
    return makeReadiness(false, false, confidenceLabel, confidenceScore, plan.decision.profileHealth.message || "目标带配置需要复核。", "配置阻断", "negative");
  }
  if (plan.riskGate?.blocked) {
    return makeReadiness(true, false, confidenceLabel, confidenceScore, `${plan.riskGate.reason} 仅保留降低风险的动作。`, "只减不加", "negative");
  }
  if (report.profileFund?.freshnessTone === "negative") {
    return makeReadiness(
      true,
      false,
      confidenceLabel,
      confidenceScore,
      `${report.profileFund.freshnessLabel}；基金穿透持仓过期，只保留降低风险的动作。`,
      "持仓过期",
      "caution",
    );
  }
  if (confidenceScore < 45) {
    return makeReadiness(true, false, confidenceLabel, confidenceScore, report.signalQuality?.summary || "信号质量不足，只保留降低风险的动作。", "仅降风险", "caution");
  }
  if (dataQuality.severity === "warn" || plan.riskGate?.watch || confidenceScore < 65 || report.profileFund?.freshnessTone === "caution") {
    return makeReadiness(
      true,
      dataQuality.riskIncreaseAllowed,
      confidenceLabel,
      confidenceScore,
      dataQuality.severity === "warn" ? dataQuality.detail : plan.riskGate?.reason || report.signalQuality?.summary || "仅保留小额、分批或模拟动作。",
      dataQuality.severity === "warn" ? dataQuality.label : "小额验证",
      "caution",
    );
  }
  if (!report.profileCalibrationStatus?.executionGrade) {
    return makeReadiness(
      true,
      true,
      confidenceLabel,
      confidenceScore,
      `${report.profileCalibrationStatus?.label ?? "校准证据不足"}；允许手动确认和自动模拟，禁止通道自动。`,
      "待样本验证",
      "caution",
      false,
      report.profileCalibrationStatus?.label ?? "未完成样本外验证",
    );
  }
  return makeReadiness(
    true,
    true,
    confidenceLabel,
    confidenceScore,
    report.signalQuality?.summary || "数据、规则与风险门已完成一致性校验。",
    "交易就绪",
    "positive",
    true,
    report.profileCalibrationStatus.label,
  );
}

function readiness(
  canExecute: boolean,
  canIncreaseRisk: boolean,
  confidenceLabel: string,
  confidenceScore: number,
  detail: string,
  label: string,
  tone: PositionPlanTone,
  autoExecutionAllowed = false,
  validationLabel = "未达到执行级",
): Omit<RecommendationReadiness, "dataQuality"> {
  return {
    autoExecutionAllowed,
    canExecute,
    canIncreaseRisk,
    canReduceRisk: canExecute,
    confidenceLabel,
    confidenceScore,
    detail,
    label,
    validationLabel,
    tone,
  };
}
