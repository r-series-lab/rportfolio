import {
  ArrowDownRight,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  CalendarClock,
  Check,
  CircleAlert,
  Clock3,
  FileCheck2,
  ListChecks,
  ShieldAlert,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { RecommendationDecisionAction, RecommendationRecord } from "../lib/recommendation-log";
import { handleTabListKeyDown } from "../lib/tab-keyboard";
import type { TodayBlocker, TodayDecisionItem, TodayInbox } from "../lib/today-inbox";
import type { ProfileSummary } from "../lib/types";
import { formatMoney } from "../lib/utils";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import "../styles/pages/today.css";

type TodayWorkspaceProps = {
  baseCurrency: "CNY" | "USD";
  inbox: TodayInbox;
  loading: boolean;
  profileKey: string;
  profiles: ProfileSummary[];
  portfolioValue: number;
  usdCnyRate: number | null;
  onAsOfChange: (value: string) => void;
  onDecisionAction: (
    record: RecommendationRecord,
    action: RecommendationDecisionAction,
    reviewAt?: string,
  ) => void;
  onOpenExecution: (record: RecommendationRecord) => void;
  onProfileChange: (value: string) => void;
};

type TodayMobilePane = "queue" | "decision";

export function TodayWorkspace({
  baseCurrency,
  inbox,
  loading,
  profileKey,
  profiles,
  portfolioValue,
  usdCnyRate,
  onAsOfChange,
  onDecisionAction,
  onOpenExecution,
  onProfileChange,
}: TodayWorkspaceProps) {
  const [selectedDecisionId, setSelectedDecisionId] = useState("");
  const [mobilePane, setMobilePane] = useState<TodayMobilePane>("queue");
  const [deferDate, setDeferDate] = useState(() => nextDateKey(1));
  const selected = useMemo(
    () => inbox.decisions.find((item) => item.record.decisionId === selectedDecisionId) ?? inbox.decisions[0] ?? null,
    [inbox.decisions, selectedDecisionId],
  );

  useEffect(() => {
    if (selected) setDeferDate(selected.record.deferredUntil || nextDateKey(1));
  }, [selected?.record.decisionId]);

  const act = (action: RecommendationDecisionAction) => {
    if (!selected) return;
    onDecisionAction(selected.record, action, action === "defer" ? deferDate : undefined);
  };

  return (
    <section className="today-workspace" aria-label="今日决策">
      <header className="today-commandbar">
        <div className="today-title-block">
          <h1><span>今日</span><i aria-hidden="true">·</i><strong>行动账本</strong></h1>
          <p>{formatMoney(portfolioValue, baseCurrency)} · {baseCurrency} 基准</p>
        </div>
        <div className="today-context-controls">
          <label>
            <span className="sr-only">投资组合</span>
            <select value={profileKey} onChange={(event) => onProfileChange(event.target.value)}>
              {profiles.map((profile) => <option key={profile.key} value={profile.key}>{profile.name}</option>)}
            </select>
          </label>
          <label>
            <span className="sr-only">估值日期</span>
            <input type="date" value={inbox.asOf} onChange={(event) => onAsOfChange(event.target.value)} />
          </label>
        </div>
        <span className="today-data-stamp">数据截至 {inbox.asOf || "待同步"} · {baseCurrency}</span>
      </header>

      <div className="today-metrics" aria-label="今日概况">
        <TodayMetric label="待处理" value={inbox.decisions.length} tone={inbox.decisions.length ? "active" : "quiet"} />
        <TodayMetric label="阻断" value={inbox.blockers.length} tone={inbox.blockers.length ? "danger" : "quiet"} />
        <TodayMetric label="延期" value={inbox.deferredCount} tone="quiet" />
        <TodayMetric label="已闭环" value={inbox.linkedTradeCount} tone="positive" />
      </div>

      <nav className="today-mobile-nav" role="tablist" aria-label="今日工作区" onKeyDown={handleTabListKeyDown}>
        <button
          type="button"
          role="tab"
          aria-selected={mobilePane === "queue"}
          tabIndex={mobilePane === "queue" ? 0 : -1}
          className={mobilePane === "queue" ? "is-active" : undefined}
          onClick={() => setMobilePane("queue")}
        >
          <ListChecks aria-hidden="true" />
          队列
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mobilePane === "decision"}
          tabIndex={mobilePane === "decision" ? 0 : -1}
          className={mobilePane === "decision" ? "is-active" : undefined}
          onClick={() => setMobilePane("decision")}
        >
          <FileCheck2 aria-hidden="true" />
          处理
        </button>
      </nav>

      <div className="today-layout">
        <section className={`today-queue ${mobilePane === "queue" ? "is-mobile-pane-active" : ""}`} aria-label="行动队列">
          <header className="today-section-header">
            <strong>待处理行动 <span>({inbox.decisions.length})</span></strong>
            <span>{inbox.processedCount} 已处理</span>
          </header>

          <div className="today-table-head" aria-hidden="true">
            <span>优先级</span>
            <span>代码 / 名称</span>
            <span>当前仓位</span>
            <span>目标区间</span>
            <span>计划金额</span>
            <span>证据 / 状态</span>
            <span>紧急度</span>
          </div>

          <div className="today-decision-list">
            {loading && !inbox.decisions.length ? (
              <div className="today-empty-state">
                <Clock3 aria-hidden="true" />
                <strong>正在同步今日决策</strong>
              </div>
            ) : inbox.decisions.length ? inbox.decisions.map((item) => (
              <DecisionRow
                active={selected?.record.decisionId === item.record.decisionId}
                item={item}
                key={item.record.decisionId}
                onSelect={() => {
                  setSelectedDecisionId(item.record.decisionId);
                  setMobilePane("decision");
                }}
              />
            )) : (
              <div className="today-empty-state is-complete">
                <FileCheck2 aria-hidden="true" />
                <strong>当前没有待处理动作</strong>
                <span>{inbox.blockers.length ? "先处理阻断项" : "今日队列已清空"}</span>
              </div>
            )}
            <QueueBlockers blockers={inbox.blockers} />
          </div>
        </section>

        <aside className={`today-inspector ${mobilePane === "decision" ? "is-mobile-pane-active" : ""}`} aria-label="决策检查器">
          {selected ? (
            <DecisionInspector
              baseCurrency={baseCurrency}
              deferDate={deferDate}
              inbox={inbox}
              item={selected}
              usdCnyRate={usdCnyRate}
              onAccept={() => onOpenExecution(selected.record)}
              onBack={() => setMobilePane("queue")}
              onDefer={() => act("defer")}
              onDeferDateChange={setDeferDate}
              onReject={() => act("reject")}
              onReview={() => act("review")}
            />
          ) : (
            <BlockerPanel inbox={inbox} />
          )}
        </aside>
      </div>
    </section>
  );
}

function DecisionRow({ active, item, onSelect }: { active: boolean; item: TodayDecisionItem; onSelect: () => void }) {
  const record = item.record;
  const allocation = allocationFacts(record);
  const priority = priorityCode(record);
  const urgency = urgencyFor(record);
  return (
    <button type="button" className={`today-decision-row ${active ? "is-active" : ""}`} onClick={onSelect}>
      <span className={`today-priority is-${priority.toLowerCase()}`}>
        <i>{directionIcon(record)}</i>
        <strong>{priority}</strong>
      </span>
      <span className="today-decision-identity">
        <strong>{record.symbol}</strong>
        <small>{record.name}</small>
      </span>
      <strong className="today-current-weight">{allocation.current}</strong>
      <strong className="today-target-range">{allocation.target}</strong>
      <strong className="today-decision-amount">{record.amount}</strong>
      <span className={`today-evidence-state is-${item.state}`}>{evidenceLabel(item)}</span>
      <span className={`today-urgency is-${urgency.tone}`}><i />{urgency.label}</span>
      <ArrowRight className="today-row-arrow" aria-hidden="true" />
    </button>
  );
}

function DecisionInspector({
  baseCurrency,
  deferDate,
  inbox,
  item,
  usdCnyRate,
  onAccept,
  onBack,
  onDefer,
  onDeferDateChange,
  onReject,
  onReview,
}: {
  baseCurrency: "CNY" | "USD";
  deferDate: string;
  inbox: TodayInbox;
  item: TodayDecisionItem;
  usdCnyRate: number | null;
  onAccept: () => void;
  onBack: () => void;
  onDefer: () => void;
  onDeferDateChange: (value: string) => void;
  onReject: () => void;
  onReview: () => void;
}) {
  const { record } = item;
  const allocation = allocationFacts(record);
  return (
    <>
      <header className="today-inspector-header">
        <div>
          <span>行动详情</span>
          <button type="button" className="today-mobile-back" aria-label="返回行动队列" onClick={onBack}>
            <ArrowLeft aria-hidden="true" />
          </button>
        </div>
        <strong>{record.symbol}</strong>
        <small>{record.name}</small>
      </header>

      <section className="today-inspector-reason">
        <strong>决策理由</strong>
        <p>{record.detail}</p>
      </section>

      <dl className="today-decision-facts">
        <div><dt>当前仓位</dt><dd>{allocation.current}</dd></div>
        <div><dt>目标区间</dt><dd>{allocation.target}</dd></div>
        <div><dt>计划金额</dt><dd>{record.amount}</dd></div>
        <div><dt>参考限价</dt><dd>{referencePriceLabel(record)}</dd></div>
        <div><dt>USD/CNY</dt><dd>{usdCnyRate ? usdCnyRate.toFixed(2) : "待确认"}</dd></div>
        <div><dt>基准币种</dt><dd>{baseCurrency}</dd></div>
      </dl>

      <section className="today-evidence-panel">
        <header><strong>证据与状态</strong><span>{evidenceLabel(item)}</span></header>
        <div>
          <span>信号强度 <strong>{record.signalQualityScore}/100</strong></span>
          <span>风险等级 <strong>{riskLevel(record)}</strong></span>
          <span>数据日期 <strong>{record.asOf || inbox.asOf}</strong></span>
        </div>
      </section>

      <section className="today-risk-check">
        <header><strong>风险检查</strong><span>{record.riskScore >= 80 ? "需要复核" : "风险通过"}</span></header>
        <dl>
          <div><dt>触发</dt><dd>{record.triggerCondition || "仓位偏离目标带"}</dd></div>
          <div><dt>触发数值</dt><dd>{allocation.current}</dd></div>
          <div><dt>规则区间</dt><dd>{allocation.target}</dd></div>
          <div><dt>失效条件</dt><dd>{record.invalidationCondition || "回到目标区间后停止"}</dd></div>
        </dl>
      </section>

      {item.state !== "routed" ? (
        <div className="today-defer-row">
          <CalendarClock aria-hidden="true" />
          <Input
            aria-label="延期复核日期"
            min={nextDateKey(1)}
            type="date"
            value={deferDate}
            onChange={(event) => onDeferDateChange(event.target.value)}
          />
          <Button type="button" variant="outline" onClick={onDefer}>延期</Button>
        </div>
      ) : null}

      <div className="today-actions">
        {item.state !== "routed" ? (
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button type="button" variant="destructive" size="icon" aria-label="拒绝建议" onClick={onReject}>
                  <X aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>拒绝建议</TooltipContent>
            </Tooltip>
            <Button type="button" variant="outline" onClick={onReview}>
              <Check aria-hidden="true" />
              已复核
            </Button>
          </>
        ) : null}
        <Button type="button" onClick={onAccept}>
          {item.state === "routed" ? "查看委托" : "接受并执行"}
          <ArrowRight aria-hidden="true" />
        </Button>
      </div>
    </>
  );
}

function QueueBlockers({ blockers }: { blockers: TodayBlocker[] }) {
  if (!blockers.length) return null;
  return (
    <section className="today-queue-blockers" aria-label="阻断项">
      <header><strong>阻断项 <span>({blockers.length})</span></strong></header>
      {blockers.map((blocker) => (
        <article key={blocker.key} className={`is-${blocker.severity}`}>
          <CircleAlert aria-hidden="true" />
          <div><strong>{blocker.label}</strong><small>{blocker.owner}</small></div>
          <p>{blocker.detail}</p>
          <span>阻断</span>
          <i />
          <em>高</em>
        </article>
      ))}
    </section>
  );
}

function BlockerPanel({ inbox }: { inbox: TodayInbox }) {
  return (
    <section className="today-blockers">
      <header><ShieldAlert aria-hidden="true" /><strong>阻断归属</strong><span>{inbox.blockers.length}</span></header>
      {inbox.blockers.length ? (
        <div className="today-blocker-list">
          {inbox.blockers.map((blocker) => (
            <article key={blocker.key} className={`is-${blocker.severity}`}>
              <CircleAlert aria-hidden="true" />
              <div><span>{blocker.owner}</span><strong>{blocker.label}</strong><p>{blocker.detail}</p></div>
            </article>
          ))}
        </div>
      ) : <p className="today-no-blockers">当前没有阻断项</p>}
    </section>
  );
}

function TodayMetric({ label, tone, value }: { label: string; tone: string; value: number }) {
  return <div className={`today-metric is-${tone}`}><span>{label}</span><strong>{value}</strong></div>;
}

function priorityCode(record: RecommendationRecord) {
  return record.priority === "BLOCKED" ? "P0" : record.priority ?? "P3";
}

function evidenceLabel(item: TodayDecisionItem) {
  const score = Math.round(item.record.priorityScore ?? item.record.confidenceScore);
  const state = item.state === "pending" ? "今日复核" : item.stateLabel;
  return `${priorityCode(item.record)} ${score} · ${state}`;
}

function urgencyFor(record: RecommendationRecord) {
  const priority = priorityCode(record);
  if (priority === "P0" || priority === "P1") return { label: "高", tone: "high" };
  if (priority === "P2") return { label: "中", tone: "medium" };
  return { label: "低", tone: "low" };
}

function riskLevel(record: RecommendationRecord) {
  if (record.riskScore >= 80) return "很高";
  if (record.riskScore >= 60) return "高";
  if (record.riskScore >= 40) return "中";
  return "低";
}

function referencePriceLabel(record: RecommendationRecord) {
  if (!record.referencePrice || !Number.isFinite(record.referencePrice)) return "—";
  return record.referencePrice >= 100 ? record.referencePrice.toFixed(2) : record.referencePrice.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

function allocationFacts(record: RecommendationRecord) {
  const detail = [record.detail, record.triggerCondition, record.invalidationCondition].filter(Boolean).join(" ");
  const current = detail.match(/(?:当前|仓位)[^\d]{0,8}(\d+(?:\.\d+)?)\s*%/i)?.[1];
  const range = detail.match(/(\d+(?:\.\d+)?)\s*%\s*[–—~至-]\s*(\d+(?:\.\d+)?)\s*%/i);
  const upper = detail.match(/上限[^\d]{0,4}(\d+(?:\.\d+)?)\s*%/i)?.[1];
  return {
    current: current ? `${current}%` : "—",
    target: range ? `${range[1]}%–${range[2]}%` : upper ? `≤ ${upper}%` : record.weight || "—",
  };
}

function directionIcon(record: RecommendationRecord) {
  return record.decisionType === "reduce"
    ? <ArrowDownRight aria-hidden="true" />
    : <ArrowUpRight aria-hidden="true" />;
}

function nextDateKey(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
