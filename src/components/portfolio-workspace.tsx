import { Archive, DatabaseBackup, Landmark, Pencil, Plus, RefreshCw, RotateCcw, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { accountBookFromSnapshots, reconcileAccountBookWithHoldings } from "../lib/account-book";
import {
  createManualAccount,
  summarizeAccounts,
  type AccountRecord,
  type AccountStoreSnapshot,
} from "../lib/accounts";
import {
  createDataBackup,
  dataSafetyAvailable,
  getDataDiagnostics,
  listDataBackups,
  restoreDataBackup,
  type DataBackupSummary,
  type DataDiagnostics,
} from "../lib/data-safety";
import type { HoldingRecord } from "../lib/holdings";
import type { PortfolioValuationSettings, SupportedCurrency } from "../lib/portfolio-valuation";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import "../styles/pages/portfolio-accounts.css";

type PortfolioTab = "accounts" | "holdings" | "import" | "reconcile" | "data";

type PortfolioWorkspaceProps = {
  accountStore: AccountStoreSnapshot;
  children: ReactNode;
  holdings: HoldingRecord[];
  importer: ReactNode;
  onAccountStoreChange: Dispatch<SetStateAction<AccountStoreSnapshot>>;
  onOpenQuant: () => void;
  persistenceMessage: string;
  valuation: PortfolioValuationSettings;
};

type AccountDraft = {
  name: string;
  currency: SupportedCurrency;
  settledCash: string;
  availableCash: string;
  pendingSettlement: string;
  notes: string;
};

const EMPTY_ACCOUNT_DRAFT: AccountDraft = {
  name: "",
  currency: "CNY",
  settledCash: "",
  availableCash: "",
  pendingSettlement: "",
  notes: "",
};

const PORTFOLIO_TABS: Array<{ key: PortfolioTab; label: string }> = [
  { key: "accounts", label: "账户" },
  { key: "holdings", label: "持仓" },
  { key: "import", label: "导入" },
  { key: "reconcile", label: "对账" },
  { key: "data", label: "数据" },
];

export function PortfolioWorkspace({
  accountStore,
  children,
  holdings,
  importer,
  onAccountStoreChange,
  onOpenQuant,
  persistenceMessage,
  valuation,
}: PortfolioWorkspaceProps) {
  const [activeTab, setActiveTab] = useState<PortfolioTab>("accounts");
  const [accountDialogOpen, setAccountDialogOpen] = useState(false);
  const [editingAccountId, setEditingAccountId] = useState("");
  const [draft, setDraft] = useState<AccountDraft>(EMPTY_ACCOUNT_DRAFT);
  const [errorMessage, setErrorMessage] = useState("");
  const [dataMessage, setDataMessage] = useState("");
  const [dataBusy, setDataBusy] = useState(false);
  const [backups, setBackups] = useState<DataBackupSummary[]>([]);
  const [diagnostics, setDiagnostics] = useState<DataDiagnostics | null>(null);
  const accounts = accountStore.accounts;
  const accountSummary = useMemo(() => summarizeAccounts(accounts, valuation), [accounts, valuation]);
  const accountBook = useMemo(
    () => accountBookFromSnapshots(accountStore.brokerSnapshots, holdings),
    [accountStore.brokerSnapshots, holdings],
  );
  const reconciliation = useMemo(
    () => reconcileAccountBookWithHoldings(accountBook, holdings),
    [accountBook, holdings],
  );
  const editingAccount = accounts.find((account) => account.id === editingAccountId);
  const editingSyncedAccount = Boolean(editingAccount && editingAccount.source !== "manual");

  useEffect(() => {
    if (activeTab !== "data" || !dataSafetyAvailable()) return;
    void refreshDataSafety();
    // Refresh only when entering the data tab.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const refreshDataSafety = async () => {
    setDataBusy(true);
    try {
      const [nextBackups, nextDiagnostics] = await Promise.all([listDataBackups(), getDataDiagnostics()]);
      setBackups(nextBackups);
      setDiagnostics(nextDiagnostics);
      setDataMessage("");
    } catch (error) {
      setDataMessage(error instanceof Error ? error.message : "数据状态读取失败。");
    } finally {
      setDataBusy(false);
    }
  };

  const openNewAccount = () => {
    setEditingAccountId("");
    setDraft(EMPTY_ACCOUNT_DRAFT);
    setErrorMessage("");
    setAccountDialogOpen(true);
  };

  const openEditAccount = (account: AccountRecord) => {
    setEditingAccountId(account.id);
    setDraft({
      name: account.name,
      currency: account.currency,
      settledCash: String(account.settledCash),
      availableCash: String(account.availableCash),
      pendingSettlement: String(account.pendingSettlement),
      notes: account.notes,
    });
    setErrorMessage("");
    setAccountDialogOpen(true);
  };

  const submitAccount = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = parseAccountDraft(draft);
    if (!parsed.ok) {
      setErrorMessage(parsed.message);
      return;
    }
    const now = new Date();
    onAccountStoreChange((current) => {
      const existing = current.accounts.find((account) => account.id === editingAccountId);
      const account = existing
        ? {
          ...existing,
          name: parsed.value.name,
          notes: parsed.value.notes,
          ...(existing.source === "manual" ? {
            currency: parsed.value.currency,
            settledCash: parsed.value.settledCash,
            availableCash: parsed.value.availableCash,
            pendingSettlement: parsed.value.pendingSettlement,
            equity: existing.marketValue + parsed.value.settledCash + parsed.value.pendingSettlement,
          } : {}),
          updatedAt: now.toISOString(),
        }
        : createManualAccount({ ...parsed.value, now });
      return {
        ...current,
        updatedAt: now.toISOString(),
        accounts: [account, ...current.accounts.filter((item) => item.id !== account.id)],
      };
    });
    setAccountDialogOpen(false);
    setEditingAccountId("");
    setDraft(EMPTY_ACCOUNT_DRAFT);
  };

  const toggleAccountArchived = (account: AccountRecord) => {
    const nextStatus = account.status === "archived" ? "active" : "archived";
    onAccountStoreChange((current) => ({
      ...current,
      updatedAt: new Date().toISOString(),
      accounts: current.accounts.map((item) => item.id === account.id ? { ...item, status: nextStatus } : item),
    }));
  };

  const createBackup = async () => {
    setDataBusy(true);
    try {
      const backup = await createDataBackup();
      setDataMessage(`备份已创建：${formatDateTime(backup.createdAt)}`);
      await refreshDataSafety();
    } catch (error) {
      setDataMessage(error instanceof Error ? error.message : "备份创建失败。");
      setDataBusy(false);
    }
  };

  const restoreBackup = async (backup: DataBackupSummary) => {
    if (!window.confirm(`恢复 ${formatDateTime(backup.createdAt)} 的备份？当前数据会先自动备份，恢复后应用将重新载入。`)) return;
    setDataBusy(true);
    try {
      const restored = await restoreDataBackup(backup.id);
      setDataMessage(`已恢复 ${restored.restoredFiles} 个数据文件。`);
      window.location.reload();
    } catch (error) {
      setDataMessage(error instanceof Error ? error.message : "备份恢复失败。");
      setDataBusy(false);
    }
  };

  return (
    <section className="portfolio-workspace" aria-label="组合账户">
      <header className="portfolio-workspace-head">
        <div>
          <span>组合账户</span>
          <strong>{accountSummary.accountCount ? `${accountSummary.activeCount} 个活跃账户` : "尚未建立账户"}</strong>
          <small>{persistenceMessage}</small>
        </div>
        <nav className="portfolio-tabs" aria-label="组合账户视图">
          {PORTFOLIO_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              className={activeTab === tab.key ? "is-active" : undefined}
              aria-current={activeTab === tab.key ? "page" : undefined}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </header>

      {activeTab === "accounts" ? (
        <div className="portfolio-account-page">
          <section className="portfolio-cash-summary" aria-label="账户现金摘要">
            <Metric label="可用现金" value={formatMoney(accountSummary.availableCash, accountSummary.baseCurrency)} />
            <Metric label="已结算" value={formatMoney(accountSummary.settledCash, accountSummary.baseCurrency)} />
            <Metric
              label="待交收"
              value={formatSignedMoney(accountSummary.pendingSettlement, accountSummary.baseCurrency)}
              tone={accountSummary.pendingSettlement === 0 ? "neutral" : "caution"}
            />
            <Metric label="账户权益" value={formatMoney(accountSummary.equity, accountSummary.baseCurrency)} />
          </section>
          {!accountSummary.complete ? <p className="portfolio-inline-warning">{accountSummary.issue}</p> : null}

          <div className="portfolio-section-head">
            <div>
              <strong>账户清单</strong>
              <span>{accounts.length} 个账户</span>
            </div>
            <Button type="button" size="sm" onClick={openNewAccount}>
              <Plus aria-hidden="true" />
              新建账户
            </Button>
          </div>

          {accounts.length ? (
            <div className="portfolio-account-list">
              {accounts.map((account) => (
                <article key={account.id} className={`portfolio-account-row is-${account.status}`}>
                  <div className="portfolio-account-identity">
                    <i aria-hidden="true">{account.currency === "CNY" ? "¥" : "$"}</i>
                    <div>
                      <strong>{account.name}</strong>
                      <span>{account.source === "manual" ? "手工账户" : account.route || account.broker} · {account.currency}</span>
                    </div>
                  </div>
                  <dl>
                    <div><dt>可用</dt><dd>{formatMoney(account.availableCash, account.currency)}</dd></div>
                    <div><dt>已结算</dt><dd>{formatMoney(account.settledCash, account.currency)}</dd></div>
                    <div><dt>待交收</dt><dd>{formatSignedMoney(account.pendingSettlement, account.currency)}</dd></div>
                    <div><dt>市值</dt><dd>{formatMoney(account.marketValue, account.currency)}</dd></div>
                  </dl>
                  <div className="portfolio-account-state">
                    <span>{accountStatusLabel(account)}</span>
                    <small>{formatAccountTimestamp(account)}</small>
                  </div>
                  <div className="portfolio-row-actions">
                    <Button type="button" variant="ghost" size="icon-sm" aria-label={`编辑 ${account.name}`} title="编辑账户" onClick={() => openEditAccount(account)}>
                      <Pencil aria-hidden="true" />
                    </Button>
                    <Button type="button" variant="ghost" size="icon-sm" aria-label={`${account.status === "archived" ? "启用" : "归档"} ${account.name}`} title={account.status === "archived" ? "启用账户" : "归档账户"} onClick={() => toggleAccountArchived(account)}>
                      {account.status === "archived" ? <RotateCcw aria-hidden="true" /> : <Archive aria-hidden="true" />}
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="portfolio-empty-state">
              <strong>建立第一个人民币或美元账户</strong>
              <span>现金将作为仓位规划和下单预算的事实来源。</span>
            </div>
          )}
        </div>
      ) : null}

      {activeTab === "holdings" ? <div className="portfolio-holdings-slot">{children}</div> : null}

      {activeTab === "import" ? <div className="portfolio-import-slot">{importer}</div> : null}

      {activeTab === "reconcile" ? (
        <div className="portfolio-reconcile-page">
          <section className={`portfolio-reconcile-summary is-${reconciliation.summary.tone}`}>
            <div><span>匹配</span><strong>{reconciliation.summary.matched}</strong></div>
            <div><span>偏差</span><strong>{reconciliation.summary.drift}</strong></div>
            <div><span>本地缺口</span><strong>{reconciliation.summary.missing}</strong></div>
            <div><span>账户新增</span><strong>{reconciliation.summary.extra}</strong></div>
            <Button type="button" variant="outline" size="sm" onClick={onOpenQuant}>
              <RefreshCw aria-hidden="true" />
              交易同步
            </Button>
          </section>
          {reconciliation.rows.length ? (
            <div className="portfolio-reconcile-table" role="table" aria-label="账户持仓对账">
              <div className="portfolio-reconcile-table-head" role="row">
                <span>账户 / 标的</span><span>本地数量</span><span>账户数量</span><span>差额</span><span>状态</span>
              </div>
              {reconciliation.rows.map((row) => (
                <div key={row.key} className={`portfolio-reconcile-row is-${row.tone}`} role="row">
                  <div><strong>{row.symbol}</strong><span>{row.accountName} · {row.name}</span></div>
                  <span>{formatNumber(row.localQuantity)}</span>
                  <span>{formatNumber(row.brokerQuantity)}</span>
                  <span>{formatSignedNumber(row.quantityDiff)}</span>
                  <em>{reconcileStatusLabel(row.status)}</em>
                </div>
              ))}
            </div>
          ) : (
            <div className="portfolio-empty-state"><strong>等待账户回报</strong><span>在量化交易中同步账户后，对账结果会显示在这里。</span></div>
          )}
        </div>
      ) : null}

      {activeTab === "data" ? (
        <div className="portfolio-data-page">
          <section className="portfolio-data-toolbar">
            <div>
              <ShieldCheck aria-hidden="true" />
              <div><strong>本机数据</strong><span>{diagnostics ? `${diagnostics.stores.filter((store) => store.readable).length}/${diagnostics.stores.length} 个存储可读` : "等待诊断"}</span></div>
            </div>
            <span className="portfolio-data-actions">
              <Button type="button" variant="outline" size="sm" disabled={dataBusy || !dataSafetyAvailable()} onClick={() => void refreshDataSafety()} aria-label="刷新数据诊断" title="刷新数据诊断">
                <RefreshCw aria-hidden="true" />
              </Button>
              <Button type="button" size="sm" disabled={dataBusy || !dataSafetyAvailable()} onClick={() => void createBackup()}>
                <DatabaseBackup aria-hidden="true" />
                创建备份
              </Button>
            </span>
          </section>
          {dataMessage ? <p className="portfolio-data-message">{dataMessage}</p> : null}
          {!dataSafetyAvailable() ? <p className="portfolio-inline-warning">Web 预览不执行本机备份与恢复。</p> : null}
          {diagnostics ? (
            <section className="portfolio-diagnostic-grid" aria-label="脱敏数据诊断">
              {diagnostics.stores.map((store) => (
                <article key={store.key} className={store.readable ? "is-positive" : "is-negative"}>
                  <strong>{diagnosticLabel(store.key)}</strong>
                  <span>{store.present ? `${store.records} 条 · v${store.version || "legacy"}` : "尚未创建"}</span>
                  <small>{formatBytes(store.bytes)}</small>
                </article>
              ))}
            </section>
          ) : null}
          <div className="portfolio-section-head"><div><strong>恢复点</strong><span>{backups.length} 个本机备份</span></div></div>
          {backups.length ? (
            <div className="portfolio-backup-list">
              {backups.slice(0, 8).map((backup) => (
                <article key={backup.id}>
                  <div><strong>{formatDateTime(backup.createdAt)}</strong><span>{backup.reason === "pre-restore" ? "恢复前保护" : "手动备份"}</span></div>
                  <span>{backup.files.length} 个文件 · {formatBytes(backup.bytes)}</span>
                  <Button type="button" variant="outline" size="sm" disabled={dataBusy} onClick={() => void restoreBackup(backup)}>
                    <RotateCcw aria-hidden="true" />
                    恢复
                  </Button>
                </article>
              ))}
            </div>
          ) : <div className="portfolio-empty-state"><strong>暂无恢复点</strong><span>创建备份后会在此保留恢复入口。</span></div>}
        </div>
      ) : null}

      <Dialog open={accountDialogOpen} onOpenChange={setAccountDialogOpen}>
        <DialogContent className="portfolio-account-dialog" mobileMode="sheet" showCloseButton size="md">
          <form className="rp-dialog-form" onSubmit={submitAccount}>
            <DialogHeader>
              <DialogTitle>{editingAccount ? "编辑账户" : "新建账户"}</DialogTitle>
              <DialogDescription>{editingSyncedAccount ? "同步账户的币种与现金由原始数据源更新。" : "人民币与美元账户使用独立现金账本。"}</DialogDescription>
            </DialogHeader>
            <DialogBody>
              <div className="rp-dialog-context">
                <Landmark aria-hidden="true" />
                <strong>{editingAccount ? "保持账户标识稳定" : "建立可执行现金来源"}</strong>
                <span>币种与现金口径会参与组合估值和下单预算；导入账户的同步字段不会在这里被静默覆盖。</span>
              </div>
              <div className="portfolio-account-form">
                <label><span>账户名称</span><Input value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} autoFocus /></label>
                <label><span>币种</span><select value={draft.currency} disabled={editingSyncedAccount} onChange={(event) => setDraft((current) => ({ ...current, currency: event.target.value as SupportedCurrency }))}><option value="CNY">CNY 人民币</option><option value="USD">USD 美元</option></select></label>
                <label><span>已结算现金</span><Input type="number" min="0" step="any" value={draft.settledCash} disabled={editingSyncedAccount} onChange={(event) => setDraft((current) => ({ ...current, settledCash: event.target.value }))} /></label>
                <label><span>可用现金</span><Input type="number" min="0" step="any" value={draft.availableCash} disabled={editingSyncedAccount} onChange={(event) => setDraft((current) => ({ ...current, availableCash: event.target.value }))} /></label>
                <label><span>待交收</span><Input type="number" step="any" value={draft.pendingSettlement} disabled={editingSyncedAccount} onChange={(event) => setDraft((current) => ({ ...current, pendingSettlement: event.target.value }))} /></label>
                <label className="is-wide"><span>备注</span><Input value={draft.notes} onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))} /></label>
              </div>
              {errorMessage ? <p className="portfolio-dialog-error" role="alert">{errorMessage}</p> : null}
            </DialogBody>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAccountDialogOpen(false)}>取消</Button>
              <Button type="submit">保存账户</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function Metric({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "neutral" | "caution" }) {
  return <div className={`portfolio-metric is-${tone}`}><span>{label}</span><strong>{value}</strong></div>;
}

function parseAccountDraft(draft: AccountDraft): { ok: true; value: { name: string; currency: SupportedCurrency; settledCash: number; availableCash: number; pendingSettlement: number; notes: string } } | { ok: false; message: string } {
  const name = draft.name.trim();
  const settledCash = parseAmount(draft.settledCash);
  const availableCash = parseAmount(draft.availableCash);
  const pendingSettlement = parseAmount(draft.pendingSettlement);
  if (!name) return { ok: false, message: "请填写账户名称。" };
  if (![settledCash, availableCash, pendingSettlement].every(Number.isFinite)) return { ok: false, message: "现金金额格式不正确。" };
  if (settledCash < 0 || availableCash < 0) return { ok: false, message: "已结算和可用现金不能为负数。" };
  return { ok: true, value: { name, currency: draft.currency, settledCash, availableCash, pendingSettlement, notes: draft.notes.trim() } };
}

function parseAmount(value: string) {
  if (!value.trim()) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function formatMoney(value: number, currency: SupportedCurrency) {
  return new Intl.NumberFormat("zh-CN", { style: "currency", currency, maximumFractionDigits: 2 }).format(value || 0);
}

function formatSignedMoney(value: number, currency: SupportedCurrency) {
  return `${value > 0 ? "+" : ""}${formatMoney(value, currency)}`;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 4 }).format(value || 0);
}

function formatSignedNumber(value: number) {
  return `${value > 0 ? "+" : ""}${formatNumber(value)}`;
}

function formatDateTime(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "short" }).format(date) : "尚未同步";
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function accountStatusLabel(account: AccountRecord) {
  if (account.status === "archived") return "已归档";
  if (account.status === "disconnected") return "同步异常";
  if (account.source === "broker") return "已同步";
  if (account.source === "import") return "账单同步";
  return "手工维护";
}

function formatAccountTimestamp(account: AccountRecord) {
  const value = account.syncedAt || account.updatedAt;
  if (account.source === "import" && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  return formatDateTime(value);
}

function reconcileStatusLabel(status: "matched" | "drift" | "missing" | "extra") {
  if (status === "matched") return "匹配";
  if (status === "drift") return "偏差";
  if (status === "missing") return "账户缺失";
  return "账户新增";
}

function diagnosticLabel(key: string) {
  const labels: Record<string, string> = { accounts: "账户", holdings: "持仓", trades: "成交", orders: "委托", recommendations: "决策", monitor: "监测", riskPolicy: "风控", paperSim: "模拟", performanceLedger: "业绩", statementImports: "导入" };
  return labels[key] ?? key;
}
