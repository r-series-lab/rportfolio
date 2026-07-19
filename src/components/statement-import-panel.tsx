import { CheckCircle2, Download, FileSearch, History, Upload, XCircle } from "lucide-react";
import { useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { AccountStoreSnapshot } from "../lib/accounts";
import { createDataBackup, dataSafetyAvailable } from "../lib/data-safety";
import type { HoldingRecord } from "../lib/holdings";
import type { PerformanceLedger } from "../lib/performance-ledger";
import type { PortfolioValuationSettings } from "../lib/portfolio-valuation";
import {
  applyStatementImport,
  parseStatementCsv,
  STATEMENT_CSV_TEMPLATE,
  statementImportReferenceIssues,
  type StatementImportLedger,
  type StatementImportPreview,
  type StatementRecordType,
} from "../lib/statement-import";
import type { TradeRecord } from "../lib/trades";
import { Button } from "./ui/button";
import "../styles/pages/statement-import.css";

type StatementImportPanelProps = {
  accountStore: AccountStoreSnapshot;
  holdings: HoldingRecord[];
  importLedger: StatementImportLedger;
  onAccountStoreChange: Dispatch<SetStateAction<AccountStoreSnapshot>>;
  onHoldingsChange: Dispatch<SetStateAction<HoldingRecord[]>>;
  onImportLedgerChange: Dispatch<SetStateAction<StatementImportLedger>>;
  onPerformanceLedgerChange: Dispatch<SetStateAction<PerformanceLedger>>;
  onTradesChange: Dispatch<SetStateAction<TradeRecord[]>>;
  performanceLedger: PerformanceLedger;
  trades: TradeRecord[];
  valuation: PortfolioValuationSettings;
};

const RECORD_LABELS: Record<StatementRecordType, string> = {
  account: "账户",
  position: "持仓",
  trade: "成交",
  "cash-flow": "现金流",
};

export function StatementImportPanel({
  accountStore,
  holdings,
  importLedger,
  onAccountStoreChange,
  onHoldingsChange,
  onImportLedgerChange,
  onPerformanceLedgerChange,
  onTradesChange,
  performanceLedger,
  trades,
  valuation,
}: StatementImportPanelProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [preview, setPreview] = useState<StatementImportPreview | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const duplicate = Boolean(preview && importLedger.batches.some((batch) => batch.checksum === preview.checksum));
  const referenceIssues = useMemo(() => preview ? statementImportReferenceIssues(preview, accountStore) : [], [accountStore, preview]);
  const allIssues = [...(preview?.issues ?? []), ...referenceIssues];
  const errors = allIssues.filter((issue) => issue.severity === "error");
  const warnings = allIssues.filter((issue) => issue.severity === "warning");

  const selectFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setPreview(null);
      setMessage("文件超过 5 MB，未解析。");
      return;
    }
    setBusy(true);
    try {
      const next = parseStatementCsv(await file.text(), file.name, valuation);
      setPreview(next);
      setMessage(next.canApply ? `已校验 ${next.rowCount} 行。` : `发现 ${next.issues.filter((issue) => issue.severity === "error").length} 个阻断错误。`);
    } catch (error) {
      setPreview(null);
      setMessage(error instanceof Error ? error.message : "文件读取失败。");
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const applyPreview = async () => {
    if (!preview || !preview.canApply || duplicate) return;
    setBusy(true);
    try {
      if (dataSafetyAvailable()) await createDataBackup();
      const result = applyStatementImport(preview, {
        accountStore,
        holdings,
        trades,
        performanceLedger,
        importLedger,
      }, valuation);
      if (!result.applied) {
        setMessage(result.message);
        return;
      }
      onAccountStoreChange(result.accountStore);
      onHoldingsChange(result.holdings);
      onTradesChange(result.trades);
      onPerformanceLedgerChange(result.performanceLedger);
      onImportLedgerChange(result.importLedger);
      setMessage(result.message);
    } catch (error) {
      setMessage(error instanceof Error ? `导入失败：${error.message}` : "导入失败。");
    } finally {
      setBusy(false);
    }
  };

  const downloadTemplate = () => {
    const blob = new Blob([`\uFEFF${STATEMENT_CSV_TEMPLATE}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "rportfolio-statement-template.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="statement-import-panel" aria-label="账单导入">
      <header className="statement-import-toolbar">
        <div>
          <FileSearch aria-hidden="true" />
          <div><strong>统一账单</strong><span>CSV · CNY / USD</span></div>
        </div>
        <span className="statement-import-actions">
          <Button type="button" variant="outline" size="sm" onClick={downloadTemplate}><Download aria-hidden="true" />模板</Button>
          <Button type="button" size="sm" disabled={busy} onClick={() => fileInputRef.current?.click()}><Upload aria-hidden="true" />选择文件</Button>
          <input ref={fileInputRef} type="file" accept=".csv,text/csv" hidden onChange={(event) => void selectFile(event.target.files?.[0])} />
        </span>
      </header>

      {message ? <p className={`statement-import-message ${errors.length || duplicate ? "is-caution" : ""}`}>{message}</p> : null}

      {preview ? (
        <>
          <section className="statement-import-summary" aria-label="导入摘要">
            {(Object.entries(preview.counts) as Array<[StatementRecordType, number]>).map(([key, count]) => (
              <div key={key}><span>{RECORD_LABELS[key]}</span><strong>{count}</strong></div>
            ))}
            <div><span>错误</span><strong className={errors.length ? "is-negative" : ""}>{errors.length}</strong></div>
            <div><span>警告</span><strong className={warnings.length ? "is-caution" : ""}>{warnings.length}</strong></div>
          </section>

          {duplicate ? <p className="statement-import-duplicate"><History aria-hidden="true" />该文件校验和已存在，禁止重复导入。</p> : null}

          {allIssues.length ? (
            <div className="statement-issue-list" aria-label="账单问题">
              {allIssues.slice(0, 50).map((issue, index) => (
                <span key={`${issue.row}-${issue.field}-${index}`} className={`is-${issue.severity}`}>
                  {issue.severity === "error" ? <XCircle aria-hidden="true" /> : <History aria-hidden="true" />}
                  <strong>第 {issue.row} 行 · {issue.field}</strong>
                  <em>{issue.message}</em>
                </span>
              ))}
            </div>
          ) : <p className="statement-import-valid"><CheckCircle2 aria-hidden="true" />格式与财务字段校验通过。</p>}

          <div className="statement-import-table-wrap">
            <div className="statement-import-table" role="table" aria-label="账单行预览">
              <div className="statement-import-table-head" role="row"><span>行</span><span>类型</span><span>账户</span><span>日期 / 标的</span><span>金额 / 数量</span><span>币种</span></div>
              {preview.rows.slice(0, 100).map((row) => (
                <div className="statement-import-row" role="row" key={`${row.rowNumber}-${row.type}-${row.externalId}`}>
                  <span>{row.rowNumber}</span>
                  <strong>{RECORD_LABELS[row.type]}</strong>
                  <span>{row.accountName || row.externalAccountId}</span>
                  <span>{row.date || row.quoteAsOf || "—"}{row.symbol ? ` · ${row.symbol}` : ""}</span>
                  <span>{row.type === "position" || row.type === "trade" ? `${formatNumber(row.quantity)} @ ${formatNumber(row.price)}` : row.type === "cash-flow" ? formatNumber(row.amount) : formatNumber(row.availableCash)}</span>
                  <span>{row.currency}</span>
                </div>
              ))}
            </div>
          </div>

          <footer className="statement-import-footer">
            <span>{preview.fileName} · {preview.checksum}</span>
            <Button type="button" disabled={busy || !preview.canApply || errors.length > 0 || duplicate} onClick={() => void applyPreview()}>
              <CheckCircle2 aria-hidden="true" />
              应用整批
            </Button>
          </footer>
        </>
      ) : (
        <div className="statement-import-empty"><FileSearch aria-hidden="true" /><strong>选择标准账单</strong><span>尚未载入 CSV 文件。</span></div>
      )}

      <div className="statement-import-section-head"><div><strong>最近批次</strong><span>{importLedger.batches.length} 个已应用批次</span></div></div>
      {importLedger.batches.length ? (
        <div className="statement-batch-list">
          {importLedger.batches.slice(0, 10).map((batch) => (
            <article key={batch.id}>
              <div><strong>{batch.fileName}</strong><span>{formatDateTime(batch.importedAt)} · {batch.checksum}</span></div>
              <span>{batch.rowCount} 行 · 账户 {batch.counts.account} · 持仓 {batch.counts.position} · 成交 {batch.counts.trade} · 现金流 {batch.counts["cash-flow"]}</span>
              <em>{batch.warningCount ? `${batch.warningCount} 个警告` : "已校验"}</em>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 4 }).format(value);
}

function formatDateTime(value: string) {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toLocaleString("zh-CN", { hour12: false }) : value;
}
