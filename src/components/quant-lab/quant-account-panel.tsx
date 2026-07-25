import {
  summarizeAccountBook,
  type AccountBookSnapshot,
  type PortfolioReconcileResult,
  type PortfolioReconcileRow,
  type PortfolioReconcileStatus,
} from "../../lib/account-book";
import type { AccountPortfolioSummary, AccountRecord } from "../../lib/accounts";
import { formatMoney } from "../../lib/utils";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import "../../styles/pages/quant-lab-account.css";

type QuantAccountPanelProps = {
  accountBook: AccountBookSnapshot;
  activeAccounts: AccountRecord[];
  actionableRows: PortfolioReconcileRow[];
  currency: string;
  executionAccountId: string;
  portfolio: AccountPortfolioSummary;
  reconcile: PortfolioReconcileResult;
  syncing: boolean;
  onApplyAll: () => void;
  onApplyRow: (row: PortfolioReconcileRow) => void;
  onExecutionAccountChange: (accountId: string) => void;
  onSync: () => void | Promise<void>;
};

export default function QuantAccountPanel({
  accountBook,
  activeAccounts,
  actionableRows,
  currency,
  executionAccountId,
  portfolio,
  reconcile,
  syncing,
  onApplyAll,
  onApplyRow,
  onExecutionAccountChange,
  onSync,
}: QuantAccountPanelProps) {
  return (
    <Card id="quant-account-center" size="sm" className="rail-card quant-account-sync" role="region" aria-label="账户同步">
      <div className="quant-section-head">
        <div>
          <span>账户</span>
          <strong>{accountBook.accountCount ? summarizeAccountBook(accountBook) : "账户同步"}</strong>
        </div>
        <span className="quant-account-actions">
          <Button
            type="button"
            variant="outline"
            size="xs"
            className="quant-rail-control"
            disabled={!actionableRows.some((row) => row.status === "extra" || row.status === "drift")}
            onClick={onApplyAll}
          >
            应用差异
          </Button>
          <Button
            type="button"
            variant="outline"
            size="xs"
            className="quant-rail-control"
            disabled={syncing}
            onClick={() => void onSync()}
          >
            {syncing ? "同步中" : "同步"}
          </Button>
        </span>
      </div>
      <div className="quant-order-center-summary" aria-label="账户同步摘要">
        <span>权益 <strong>{formatBookMoney(portfolio.equity, portfolio.baseCurrency, currency)}</strong></span>
        <span>可用 <strong>{formatBookMoney(portfolio.availableCash, portfolio.baseCurrency, currency)}</strong></span>
        <span>持仓 <strong>{accountBook.positionCount}</strong></span>
      </div>
      <label className="quant-account-selector">
        <span>执行账户</span>
        <select value={executionAccountId} onChange={(event) => onExecutionAccountChange(event.target.value)}>
          <option value="">待选择</option>
          {activeAccounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {account.currency}</option>)}
        </select>
      </label>
      {accountBook.accounts.length ? (
        <div className="quant-account-list" aria-label="已同步账户">
          {accountBook.accounts.slice(0, 3).map((account) => (
            <article key={account.key} className={account.accepted ? "is-positive" : "is-negative"}>
              <div>
                <strong>{account.accountName}</strong>
                <span>{account.route || account.bridge}</span>
              </div>
              <em>{formatBookMoney(account.equity, account.currency || accountBook.currency, currency)}</em>
            </article>
          ))}
        </div>
      ) : null}
      {accountBook.accountCount ? (
        <div className={`quant-reconcile-panel is-${reconcile.summary.tone}`}>
          <div className="quant-reconcile-strip" aria-label="持仓对账摘要">
            <span>匹配 <strong>{reconcile.summary.matched}</strong></span>
            <span>偏差 <strong>{reconcile.summary.drift}</strong></span>
            <span>缺口 <strong>{reconcile.summary.missing + reconcile.summary.extra}</strong></span>
          </div>
          {reconcile.rows.some((row) => row.status !== "matched") ? (
            <div className="quant-reconcile-list" aria-label="持仓差异">
              {actionableRows.slice(0, 3).map((row) => (
                <article key={row.key} className={`is-${row.tone}`}>
                  <div>
                    <strong>{row.symbol}</strong>
                    <span>{row.name}</span>
                  </div>
                  <em>{reconcileStatusLabel(row.status)}</em>
                  <small>{row.summary}</small>
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    className="quant-reconcile-action"
                    onClick={() => onApplyRow(row)}
                  >
                    {reconcileActionLabel(row.status)}
                  </Button>
                </article>
              ))}
            </div>
          ) : (
            <p>{reconcile.summary.headline}</p>
          )}
        </div>
      ) : (
        <p>同步真实账户、持仓、委托和成交回报。</p>
      )}
    </Card>
  );
}

function formatBookMoney(value: number, currency: string, fallbackCurrency: string) {
  if (!Number.isFinite(value) || value <= 0) return "—";
  if (currency === "MIXED") return "多币种";
  return formatMoney(value, currency || fallbackCurrency);
}

function reconcileStatusLabel(status: PortfolioReconcileStatus) {
  if (status === "matched") return "匹配";
  if (status === "drift") return "偏差";
  if (status === "missing") return "账户缺失";
  return "本地缺失";
}

function reconcileActionLabel(status: PortfolioReconcileStatus) {
  if (status === "extra") return "加入";
  if (status === "drift") return "更新";
  if (status === "missing") return "设观察";
  return "已匹配";
}
