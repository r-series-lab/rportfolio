import type { PositionPlan } from "./position-plan";
import type { OrderRecord } from "./order-store";
import type { LabTone, OrderIntent, StrategyScore } from "./strategy-engine";
import type { MarketAnalysisReport } from "./types";

export type ProfileMonitorEvent = {
  key: string;
  label: string;
  tone: LabTone;
  detail: string;
};

export type ProfileMonitorSnapshot = {
  key: string;
  profileKey: string;
  profileName: string;
  asOf: string;
  createdAt: string;
  stateKey: string;
  orderKeys: string[];
  score: number;
  permission: string;
  permissionTone: string;
  protocolState: string;
  riskGateLabel: string;
  riskGateTone: string;
  riskGateBlocked: boolean;
  positionStatus: string;
  cashWeight: number;
  riskExposure: number;
  actionSignature: string;
  orderSignature: string;
};

export type ProfileMonitorEvaluation = {
  actionLabel: string;
  autoQueueIntents: OrderIntent[];
  changed: boolean;
  duplicateCount: number;
  events: ProfileMonitorEvent[];
  refreshed: boolean;
  skippedCount: number;
  snapshot: ProfileMonitorSnapshot;
  statusLabel: string;
  summary: string;
  tone: LabTone;
};

export type ProfileMonitorRecord = {
  key: string;
  at: string;
  profileKey: string;
  profileName: string;
  snapshotKey: string;
  previousSnapshotKey: string;
  changed: boolean;
  refreshed: boolean;
  statusLabel: string;
  summary: string;
  tone: LabTone;
  autoQueueCount: number;
  duplicateCount: number;
  skippedCount: number;
  queuedOrderIds: string[];
  eventLabels: string[];
  eventDetails: string[];
};

export type ProfileMonitorInput = {
  orderIntents: OrderIntent[];
  positionPlan: PositionPlan;
  previousSnapshot: ProfileMonitorSnapshot | null;
  queuedOrders: OrderRecord[];
  report: MarketAnalysisReport;
  score: StrategyScore;
};

const ACTIVE_ORDER_STATUSES = new Set(["preview", "queued", "prepared", "submitted", "partially_filled"]);

export function evaluateProfileMonitor({
  orderIntents,
  positionPlan,
  previousSnapshot,
  queuedOrders,
  report,
  score,
}: ProfileMonitorInput): ProfileMonitorEvaluation {
  const snapshot = createProfileMonitorSnapshot({ orderIntents, positionPlan, report, score });
  const comparablePrevious = previousSnapshot?.profileKey === snapshot.profileKey ? previousSnapshot : null;
  const activeOrderKeys = new Set(queuedOrders.filter(isActiveOrderRecord).map(orderRecordFingerprint));
  const previousOrderKeys = new Set(comparablePrevious?.orderKeys ?? []);
  const seenOrderKeys = new Set([...activeOrderKeys, ...previousOrderKeys]);
  const changed = comparablePrevious ? comparablePrevious.stateKey !== snapshot.stateKey : false;
  const refreshed = Boolean(comparablePrevious && comparablePrevious.asOf !== snapshot.asOf);
  const executableIntents = comparablePrevious
    ? orderIntents.filter((intent) => isExecutableIntent(intent))
    : [];
  const autoQueueIntents = changed
    ? executableIntents.filter((intent) => !seenOrderKeys.has(orderIntentFingerprint(intent)))
    : [];
  const duplicateCount = executableIntents.length - autoQueueIntents.length;
  const events = monitorEventsFor(comparablePrevious, snapshot, changed, refreshed, autoQueueIntents.length, duplicateCount);
  const tone = monitorTone(events, autoQueueIntents.length, changed);
  return {
    actionLabel: monitorActionLabel(comparablePrevious, changed, autoQueueIntents.length),
    autoQueueIntents,
    changed,
    duplicateCount,
    events,
    refreshed,
    skippedCount: Math.max(0, orderIntents.length - autoQueueIntents.length),
    snapshot,
    statusLabel: monitorStatusLabel(comparablePrevious, changed, autoQueueIntents.length),
    summary: monitorSummary(comparablePrevious, changed, refreshed, autoQueueIntents.length, duplicateCount),
    tone,
  };
}

export function createProfileMonitorSnapshot({
  orderIntents,
  positionPlan,
  report,
  score,
}: Omit<ProfileMonitorInput, "previousSnapshot" | "queuedOrders">): ProfileMonitorSnapshot {
  const orderKeys = orderIntents.map(orderIntentFingerprint).sort();
  const actionSignature = positionPlan.actions
    .filter((item) => item.holdingId)
    .map((item) => [
      item.symbol,
      item.action,
      compactNumber(item.amount),
      compactNumber(item.weightDelta),
      item.tone,
    ].map(normalizeToken).join(":"))
    .sort()
    .join(";");
  const orderSignature = orderKeys.join(";");
  const stateParts = [
    report.profileKey,
    compactNumber(report.score),
    report.decisionFrame.permission,
    report.decisionFrame.permissionTone,
    report.decisionFrame.protocolState,
    positionPlan.riskGate?.label ?? "无风险门",
    positionPlan.riskGate?.tone ?? "neutral",
    positionPlan.riskGate?.blocked ? "blocked" : "open",
    positionPlan.statusLabel,
    compactNumber(positionPlan.cashWeight),
    compactNumber(positionPlan.riskExposure),
    actionSignature,
    orderSignature,
    score.permission,
    compactNumber(score.score),
  ];
  const stateKey = hashText(stateParts.map(normalizeToken).join("|"));
  return {
    key: `${report.profileKey}-${stateKey}`,
    profileKey: report.profileKey,
    profileName: report.profileName,
    asOf: report.asOf,
    createdAt: new Date().toISOString(),
    stateKey,
    orderKeys,
    score: score.score,
    permission: score.permission,
    permissionTone: report.decisionFrame.permissionTone,
    protocolState: report.decisionFrame.protocolState,
    riskGateLabel: positionPlan.riskGate?.label ?? "无风险门",
    riskGateTone: positionPlan.riskGate?.tone ?? "neutral",
    riskGateBlocked: Boolean(positionPlan.riskGate?.blocked),
    positionStatus: positionPlan.statusLabel,
    cashWeight: positionPlan.cashWeight,
    riskExposure: positionPlan.riskExposure,
    actionSignature,
    orderSignature,
  };
}

export function orderIntentFingerprint(intent: OrderIntent) {
  return [
    intent.symbol,
    intent.side,
    intent.amount,
    intent.weight,
  ].map(normalizeToken).join("|");
}

export function orderRecordFingerprint(order: OrderRecord) {
  return [
    order.symbol,
    order.side,
    order.amount,
    order.weight,
  ].map(normalizeToken).join("|");
}

export function createProfileMonitorRecord({
  evaluation,
  previousSnapshot,
  queuedOrders = [],
}: {
  evaluation: ProfileMonitorEvaluation;
  previousSnapshot: ProfileMonitorSnapshot | null;
  queuedOrders?: OrderRecord[];
}): ProfileMonitorRecord {
  const at = new Date().toISOString();
  return {
    key: `mon-${evaluation.snapshot.key}-${hashText(`${at}|${evaluation.summary}|${queuedOrders.map((order) => order.id).join("|")}`)}`,
    at,
    profileKey: evaluation.snapshot.profileKey,
    profileName: evaluation.snapshot.profileName,
    snapshotKey: evaluation.snapshot.key,
    previousSnapshotKey: previousSnapshot?.key ?? "",
    changed: evaluation.changed,
    refreshed: evaluation.refreshed,
    statusLabel: evaluation.statusLabel,
    summary: evaluation.summary,
    tone: evaluation.tone,
    autoQueueCount: evaluation.autoQueueIntents.length,
    duplicateCount: evaluation.duplicateCount,
    skippedCount: evaluation.skippedCount,
    queuedOrderIds: queuedOrders.map((order) => order.id),
    eventLabels: evaluation.events.map((event) => event.label),
    eventDetails: evaluation.events.map((event) => event.detail),
  };
}

function monitorEventsFor(
  previous: ProfileMonitorSnapshot | null,
  snapshot: ProfileMonitorSnapshot,
  changed: boolean,
  refreshed: boolean,
  autoQueueCount: number,
  duplicateCount: number,
): ProfileMonitorEvent[] {
  if (!previous) {
    return [{
      key: "baseline",
      label: "建立基线",
      tone: "neutral",
      detail: `${snapshot.profileName} · ${snapshot.positionStatus}`,
    }];
  }

  const events: ProfileMonitorEvent[] = [];
  if (refreshed) {
    events.push({
      key: "refresh",
      label: "数据刷新",
      tone: "neutral",
      detail: `${previous.asOf} -> ${snapshot.asOf}`,
    });
  }
  if (previous.permission !== snapshot.permission || previous.permissionTone !== snapshot.permissionTone) {
    events.push({
      key: "permission",
      label: "权限变化",
      tone: toneFromProfile(snapshot.permissionTone),
      detail: `${previous.permission} -> ${snapshot.permission}`,
    });
  }
  if (previous.riskGateLabel !== snapshot.riskGateLabel || previous.riskGateBlocked !== snapshot.riskGateBlocked) {
    events.push({
      key: "risk-gate",
      label: "风险门变化",
      tone: toneFromProfile(snapshot.riskGateTone),
      detail: `${previous.riskGateLabel} -> ${snapshot.riskGateLabel}`,
    });
  }
  if (Math.abs(snapshot.score - previous.score) >= 3) {
    const delta = snapshot.score - previous.score;
    events.push({
      key: "score",
      label: "评分变化",
      tone: delta > 0 ? "positive" : "caution",
      detail: `${previous.score} -> ${snapshot.score}`,
    });
  }
  if (previous.actionSignature !== snapshot.actionSignature || previous.orderSignature !== snapshot.orderSignature) {
    events.push({
      key: "orders",
      label: autoQueueCount ? "新委托" : "建议变化",
      tone: autoQueueCount ? "positive" : "caution",
      detail: autoQueueCount ? `${autoQueueCount} 条可排队` : "建议已更新",
    });
  }
  if (duplicateCount > 0) {
    events.push({
      key: "dedupe",
      label: "重复过滤",
      tone: "neutral",
      detail: `${duplicateCount} 条已存在或已见过`,
    });
  }
  if (!changed && events.length === 0) {
    events.push({
      key: "stable",
      label: "状态稳定",
      tone: "neutral",
      detail: "交易条件未变化",
    });
  }
  return events.slice(0, 5);
}

function monitorSummary(
  previous: ProfileMonitorSnapshot | null,
  changed: boolean,
  refreshed: boolean,
  autoQueueCount: number,
  duplicateCount: number,
) {
  if (!previous) return "已记录当前 Profile 基线，等待下一次状态变化。";
  if (autoQueueCount > 0) return `发现 ${autoQueueCount} 条新委托，可进入自动排队。`;
  if (changed && duplicateCount > 0) return "Profile 有变化，但可建票委托已过滤重复。";
  if (changed) return "Profile 有变化，但没有新增可建票委托。";
  if (refreshed) return "Profile 已刷新，交易条件未变化。";
  return "监测运行中，等待下一次 Profile 刷新。";
}

function monitorActionLabel(previous: ProfileMonitorSnapshot | null, changed: boolean, autoQueueCount: number) {
  if (!previous) return "建立基线";
  if (autoQueueCount > 0) return "自动排队";
  if (changed) return "记录变化";
  return "等待变化";
}

function monitorStatusLabel(previous: ProfileMonitorSnapshot | null, changed: boolean, autoQueueCount: number) {
  if (!previous) return "基线";
  if (autoQueueCount > 0) return "触发";
  if (changed) return "变化";
  return "稳定";
}

function monitorTone(events: ProfileMonitorEvent[], autoQueueCount: number, changed: boolean): LabTone {
  if (events.some((item) => item.tone === "negative")) return "negative";
  if (autoQueueCount > 0) return "positive";
  if (changed || events.some((item) => item.tone === "caution")) return "caution";
  return "neutral";
}

function isExecutableIntent(intent: OrderIntent) {
  return intent.state !== "已阻断";
}

function isActiveOrderRecord(order: OrderRecord) {
  return ACTIVE_ORDER_STATUSES.has(order.status);
}

function toneFromProfile(value: string | undefined): LabTone {
  if (value === "positive" || value === "increase") return "positive";
  if (value === "negative" || value === "reduce" || value === "defensive") return "negative";
  if (value === "caution" || value === "hold" || value === "watch") return "caution";
  return "neutral";
}

function compactNumber(value: number) {
  return Number.isFinite(value) ? String(Math.round(value * 10) / 10) : "0";
}

function normalizeToken(value: string | number | boolean | null | undefined) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, "")
    .toUpperCase();
}

function hashText(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36);
}
