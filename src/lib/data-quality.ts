import type { MarketAnalysisReport, TechnicalRow } from "./types";

export type DataQualitySeverity = "pass" | "warn" | "block";

export type DataQualityCheck = {
  key: string;
  label: string;
  severity: DataQualitySeverity;
  detail: string;
};

export type DataQualityAssessment = {
  blocksExecution: boolean;
  checks: DataQualityCheck[];
  detail: string;
  label: string;
  riskIncreaseAllowed: boolean;
  score: number;
  severity: DataQualitySeverity;
};

export function assessDataQuality(
  report: MarketAnalysisReport | null,
  reportIsCurrent: boolean,
  now = new Date(),
): DataQualityAssessment {
  if (!report || !reportIsCurrent) {
    return assessment([{
      key: "report.current",
      label: "报告状态",
      severity: "block",
      detail: "当前 Profile 的分析报告尚未生成或已经切换，请先刷新。",
    }]);
  }

  const checks: DataQualityCheck[] = [];
  const sourceName = report.sourceLabel || report.source || "未知来源";
  if (report.source === "sample" || /示例|演示/.test(`${sourceName} ${report.providerNote}`)) {
    checks.push({
      key: "source.sample",
      label: "数据来源",
      severity: "block",
      detail: `${sourceName} 只用于演示，不能生成真实交易票。`,
    });
  } else if (/兜底|fallback|降级/i.test(report.providerNote || "")) {
    checks.push({
      key: "source.fallback",
      label: "数据来源",
      severity: "warn",
      detail: `当前使用 ${sourceName} 兜底数据，提交前需要复核来源一致性。`,
    });
  } else {
    checks.push({
      key: "source.ready",
      label: "数据来源",
      severity: "pass",
      detail: `当前生效来源：${sourceName}。`,
    });
  }

  if (report.source === "china") {
    if (/一致性异常/.test(report.providerNote || "")) {
      checks.push({
        key: "source.cross-check.block",
        label: "双源校验",
        severity: "block",
        detail: report.providerNote,
      });
    } else if (/交叉校验未完成/.test(report.providerNote || "")) {
      checks.push({
        key: "source.cross-check.warn",
        label: "双源校验",
        severity: "warn",
        detail: report.providerNote,
      });
    } else {
      checks.push({
        key: "source.cross-check.pass",
        label: "双源校验",
        severity: "pass",
        detail: report.providerNote || "A 股核心基准双源校验通过。",
      });
    }
  }

  checks.push(reportDateCheck(report.asOf, now));
  checks.push(technicalCoverageCheck(report.technicalRows));
  checks.push(assetCoverageCheck(report.assetStatuses.length, report.technicalRows.length));

  if (report.profileFund?.freshnessTone === "negative") {
    checks.push({
      key: "fund.freshness.block",
      label: "基金披露",
      severity: "block",
      detail: `${report.profileFund.freshnessLabel}，需要更新基金持仓资料。`,
    });
  } else if (report.profileFund?.freshnessTone === "caution") {
    checks.push({
      key: "fund.freshness.warn",
      label: "基金披露",
      severity: "warn",
      detail: `${report.profileFund.freshnessLabel}，建议仅小额验证。`,
    });
  }

  return assessment(checks);
}

function assessment(checks: DataQualityCheck[]): DataQualityAssessment {
  const blocks = checks.filter((check) => check.severity === "block");
  const warnings = checks.filter((check) => check.severity === "warn");
  const severity: DataQualitySeverity = blocks.length ? "block" : warnings.length ? "warn" : "pass";
  const score = Math.max(0, 100 - blocks.length * 45 - warnings.length * 14);
  const firstIssue = blocks[0] ?? warnings[0];
  return {
    blocksExecution: blocks.length > 0,
    checks,
    detail: firstIssue?.detail ?? "来源、日期和关键字段完整性均通过。",
    label: severity === "block" ? "数据阻断" : severity === "warn" ? "数据待确认" : "数据可信",
    riskIncreaseAllowed: blocks.length === 0,
    score,
    severity,
  };
}

function reportDateCheck(asOf: string, now: Date): DataQualityCheck {
  const reportDate = dateOnly(asOf);
  const today = dateOnly(now.toISOString());
  if (!reportDate || !today) {
    return {
      key: "date.invalid",
      label: "数据日期",
      severity: "block",
      detail: "报告日期无法识别，不能用于交易决策。",
    };
  }
  if (reportDate.getTime() > today.getTime()) {
    return {
      key: "date.future",
      label: "数据日期",
      severity: "block",
      detail: `报告日期 ${asOf} 晚于本机日期，请检查系统时间和数据源。`,
    };
  }
  const age = businessDaysBetween(reportDate, today);
  if (age > 3) {
    return {
      key: "date.stale.block",
      label: "数据日期",
      severity: "block",
      detail: `报告日期 ${asOf} 已落后 ${age} 个交易日，先刷新数据再生成交易票。`,
    };
  }
  if (age > 1) {
    return {
      key: "date.stale.warn",
      label: "数据日期",
      severity: "warn",
      detail: `报告日期 ${asOf} 已落后 ${age} 个交易日，建议复核后小额执行。`,
    };
  }
  return {
    key: "date.fresh",
    label: "数据日期",
    severity: "pass",
    detail: `报告日期 ${asOf}，时效正常。`,
  };
}

function technicalCoverageCheck(rows: TechnicalRow[]): DataQualityCheck {
  if (!rows.length) {
    return {
      key: "technical.empty",
      label: "技术数据",
      severity: "block",
      detail: "没有技术行情行，无法校验趋势和目标带。",
    };
  }
  const complete = rows.filter((row) =>
    isPositive(row.close)
    && [row.change1d, row.ma20, row.ma50].filter(isFiniteNumber).length >= 2
  ).length;
  const coverage = complete / rows.length;
  if (coverage < 0.6) {
    return {
      key: "technical.coverage.block",
      label: "技术数据",
      severity: "block",
      detail: `关键行情字段完整率仅 ${Math.round(coverage * 100)}%，暂停生成交易票。`,
    };
  }
  if (coverage < 0.85) {
    return {
      key: "technical.coverage.warn",
      label: "技术数据",
      severity: "warn",
      detail: `关键行情字段完整率 ${Math.round(coverage * 100)}%，建议小额验证。`,
    };
  }
  return {
    key: "technical.coverage.pass",
    label: "技术数据",
    severity: "pass",
    detail: `关键行情字段完整率 ${Math.round(coverage * 100)}%。`,
  };
}

function assetCoverageCheck(assetCount: number, technicalCount: number): DataQualityCheck {
  if (assetCount <= 0) {
    return {
      key: "asset.empty",
      label: "标的覆盖",
      severity: "block",
      detail: "Profile 没有返回任何标的状态。",
    };
  }
  const ratio = Math.min(1, technicalCount / assetCount);
  if (ratio < 0.7) {
    return {
      key: "asset.coverage.warn",
      label: "标的覆盖",
      severity: "warn",
      detail: `技术数据仅覆盖 ${technicalCount}/${assetCount} 个标的。`,
    };
  }
  return {
    key: "asset.coverage.pass",
    label: "标的覆盖",
    severity: "pass",
    detail: `技术数据覆盖 ${Math.min(technicalCount, assetCount)}/${assetCount} 个标的。`,
  };
}

function dateOnly(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isNaN(date.getTime()) ? null : date;
}

function businessDaysBetween(from: Date, to: Date) {
  let count = 0;
  const cursor = new Date(from);
  const maxIterations = 740;
  for (let index = 0; cursor.getTime() < to.getTime() && index < maxIterations; index += 1) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) count += 1;
  }
  return count;
}

function isFiniteNumber(value: number | null) {
  return typeof value === "number" && Number.isFinite(value);
}

function isPositive(value: number) {
  return Number.isFinite(value) && value > 0;
}
