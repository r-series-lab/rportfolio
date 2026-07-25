import type { BrokerMode } from "../../lib/broker-adapter";
import type { OrderRecord } from "../../lib/order-store";
import type { LabTone } from "../../lib/strategy-engine";

export type ExecutionMode = "manual" | "simulation" | "auto";
export type ExecutionRailTab = "ticket" | "orders" | "account" | "simulation" | "logs";
export type QuantDialogKey = "strategy" | "bridge" | "risk" | "replacement" | "backtest" | null;

export const MANUAL_BROKER_MODE = "manual-ticket";
export const PAPER_SIM_BROKER_MODE = "paper-simulation";

export type LabLog = {
  key: string;
  time: string;
  tone: LabTone;
  text: string;
};

export function isManualExecutionOrder(order: OrderRecord) {
  return order.broker === MANUAL_BROKER_MODE
    || order.route === "手动交易"
    || order.routeStatus.startsWith("manual_");
}

export type BrokerOption = {
  key: BrokerMode;
  label: string;
  detail: string;
};

export const BROKER_OPTIONS: BrokerOption[] = [
  { key: "local-paper", label: "本地模拟", detail: "本地撮合" },
  { key: "qbot-bridge", label: "Qbot 桥接", detail: "Qbot 参数" },
  { key: "live-gateway", label: "vn.py 通道", detail: "券商适配器" },
];

export const EXECUTION_MODE_OPTIONS: Array<{ key: ExecutionMode; label: string; detail: string }> = [
  { key: "manual", label: "手动交易", detail: "生成下单票" },
  { key: "simulation", label: "自动模拟", detail: "实验账本" },
  { key: "auto", label: "通道自动", detail: "桥接提交" },
];

export const EXECUTION_RAIL_TABS: Array<{ key: ExecutionRailTab; label: string }> = [
  { key: "ticket", label: "交易票" },
  { key: "orders", label: "委托" },
  { key: "account", label: "账户" },
  { key: "simulation", label: "模拟" },
  { key: "logs", label: "日志" },
];

export const QUANT_DIALOG_META: Record<Exclude<QuantDialogKey, null>, { eyebrow: string; title: string }> = {
  strategy: { eyebrow: "策略参数", title: "策略与参数" },
  bridge: { eyebrow: "执行通道", title: "执行通道" },
  risk: { eyebrow: "风控", title: "风控开关" },
  replacement: { eyebrow: "基金替换", title: "关联模拟计划" },
  backtest: { eyebrow: "情景验证", title: "情景试算结果" },
};
