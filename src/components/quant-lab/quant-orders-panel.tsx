import DatasetRoundedIcon from "@mui/icons-material/DatasetRounded";
import type { OrderCommandAction } from "../../lib/broker-bridge";
import type { OrderAuditExportFormat } from "../../lib/order-persistence";
import {
  orderLatestEvent,
  orderStatusLabel,
  type OrderCenterSummary,
  type OrderRecord,
} from "../../lib/order-store";
import { sideLabel } from "../../lib/quant-desk-view";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { isManualExecutionOrder } from "./quant-lab-contracts";
import "../../styles/pages/quant-lab-orders.css";

type QuantOrdersPanelProps = {
  activeCommandKey: string;
  blockedOrderCount: number;
  exportFormat: OrderAuditExportFormat | "";
  orders: OrderRecord[];
  summary: OrderCenterSummary;
  onClearBlocked: () => void;
  onCommand: (order: OrderRecord, action: OrderCommandAction) => void | Promise<void>;
  onExport: (format: OrderAuditExportFormat) => void | Promise<void>;
  onManualAdvance: (order: OrderRecord) => void;
};

export default function QuantOrdersPanel({
  activeCommandKey,
  blockedOrderCount,
  exportFormat,
  orders,
  summary,
  onClearBlocked,
  onCommand,
  onExport,
  onManualAdvance,
}: QuantOrdersPanelProps) {
  return (
    <Card id="quant-order-center" size="sm" className="rail-card quant-order-blotter" role="region" aria-label="委托队列">
      <div className="quant-section-head">
        <div>
          <span>委托队列</span>
          <strong>{orders.length ? `${summary.active} 活跃 / ${orders.length} 总计` : "等待排队"}</strong>
        </div>
        <span className="quant-audit-actions" aria-label="订单审计导出">
          <Button
            type="button"
            variant="outline"
            size="xs"
            className="quant-rail-control"
            disabled={!blockedOrderCount}
            onClick={onClearBlocked}
          >
            清理阻断
          </Button>
          <Button
            type="button"
            variant="outline"
            size="xs"
            className="quant-rail-control"
            disabled={!orders.length || Boolean(exportFormat)}
            onClick={() => void onExport("json")}
          >
            {exportFormat === "json" ? "导出中" : "JSON"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="xs"
            className="quant-rail-control"
            disabled={!orders.length || Boolean(exportFormat)}
            onClick={() => void onExport("csv")}
          >
            {exportFormat === "csv" ? "导出中" : "CSV"}
          </Button>
        </span>
      </div>
      {orders.length ? (
        <div className="quant-order-center-summary" aria-label="订单中心摘要">
          <span>预备 <strong>{summary.prepared}</strong></span>
          <span>提交 <strong>{summary.submitted}</strong></span>
          <span>异常 <strong>{summary.errored}</strong></span>
        </div>
      ) : null}
      <div className="quant-order-list">
        {orders.length ? orders.map((order) => {
          const latestEvent = orderLatestEvent(order);
          const manualOrder = isManualExecutionOrder(order);
          const submitBusy = activeCommandKey === `${order.id}:submitOrder`;
          const cancelBusy = activeCommandKey === `${order.id}:cancelOrder`;
          const syncBusy = activeCommandKey === `${order.id}:syncOrderStatus`;
          const commandBusy = Boolean(activeCommandKey);
          return (
            <article key={order.key} className={`is-${order.tone} is-${order.status}`}>
              <div>
                <span>{sideLabel(order.side)} · {orderStatusLabel(order.status)}</span>
                <strong>{order.symbol}</strong>
                <em>{order.name}</em>
              </div>
              <div>
                <strong>{order.amount}</strong>
                <span>{order.weight}</span>
                <em>{order.route}</em>
              </div>
              <p>{order.quantity} @ {order.limit} · {latestEvent?.label ?? order.state}</p>
              <div className="quant-order-actions" aria-label={`${order.symbol} 委托动作`}>
                {manualOrder && manualOrderCanAdvance(order) ? (
                  <Button
                    type="button"
                    size="xs"
                    className="quant-order-command is-manual"
                    disabled={commandBusy}
                    onClick={() => onManualAdvance(order)}
                  >
                    {manualOrderActionLabel(order)}
                  </Button>
                ) : null}
                {!manualOrder && canSubmitOrder(order) ? (
                  <Button
                    type="button"
                    size="xs"
                    className="quant-order-command is-submit"
                    disabled={commandBusy}
                    onClick={() => void onCommand(order, "submitOrder")}
                  >
                    {submitBusy ? "提交中" : "提交"}
                  </Button>
                ) : null}
                {!manualOrder && canCancelOrder(order) ? (
                  <Button
                    type="button"
                    variant="destructive"
                    size="xs"
                    className="quant-order-command is-cancel"
                    disabled={commandBusy}
                    onClick={() => void onCommand(order, "cancelOrder")}
                  >
                    {cancelBusy ? "撤单中" : "撤单"}
                  </Button>
                ) : null}
                {!manualOrder ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    className="quant-order-command is-sync"
                    disabled={commandBusy}
                    onClick={() => void onCommand(order, "syncOrderStatus")}
                  >
                    {syncBusy ? "同步中" : "同步"}
                  </Button>
                ) : null}
              </div>
            </article>
          );
        }) : (
          <div className="quant-no-orders">
            <DatasetRoundedIcon fontSize="inherit" />
            <strong>暂无委托</strong>
            <span>等待风险门和目标带给出动作。</span>
          </div>
        )}
      </div>
    </Card>
  );
}

function manualOrderCanAdvance(order: OrderRecord) {
  return order.status === "queued"
    || order.status === "prepared"
    || order.status === "submitted"
    || order.status === "partially_filled";
}

function manualOrderActionLabel(order: OrderRecord) {
  return order.status === "submitted" || order.status === "partially_filled" ? "已成交" : "已下单";
}

function canSubmitOrder(order: OrderRecord) {
  return order.status === "queued" || order.status === "prepared";
}

function canCancelOrder(order: OrderRecord) {
  return order.status === "queued"
    || order.status === "prepared"
    || order.status === "submitted"
    || order.status === "partially_filled";
}
