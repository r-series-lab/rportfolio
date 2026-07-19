import {
  ArrowDownRight,
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
import type { TodayDecisionItem, TodayInbox } from "../lib/today-inbox";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import "../styles/pages/today.css";

type TodayWorkspaceProps = {
  inbox: TodayInbox;
  loading: boolean;
  profileName: string;
  onDecisionAction: (
    record: RecommendationRecord,
    action: RecommendationDecisionAction,
    reviewAt?: string,
  ) => void;
  onOpenExecution: (record: RecommendationRecord) => void;
};

type TodayMobilePane = "queue" | "decision";

export function TodayWorkspace({
  inbox,
  loading,
  profileName,
  onDecisionAction,
  onOpenExecution,
}: TodayWorkspaceProps) {
  const [selectedDecisionId, setSelectedDecisionId] = useState("");
  const [mobilePane, setMobilePane] = useState<TodayMobilePane>("queue");
  const [deferDate, setDeferDate] = useState(() => nextDateKey(1));
  const selected = useMemo(
    () => inbox.decisions.find((item) => item.record.decisionId === selectedDecisionId) ?? inbox.decisions[0] ?? null,
    [inbox.decisions, selectedDecisionId],
  );

  useEffect(() => {
    if (selected) {
      setDeferDate(selected.record.deferredUntil || nextDateKey(1));
    }
  }, [selected?.record.decisionId]);

  const act = (action: RecommendationDecisionAction) => {
    if (!selected) return;
    onDecisionAction(selected.record, action, action === "defer" ? deferDate : undefined);
  };

  return (
    <section className="today-workspace" aria-label="今日决策">
      <header className="today-header">
        <div>
          <span className="today-eyebrow">{inbox.asOf || "等待报告"} · {profileName}</span>
          <h1>今日</h1>
        </div>
        <div className="today-metrics" aria-label="今日概况">
          <TodayMetric label="待处理" value={inbox.decisions.length} tone={inbox.decisions.length ? "active" : "quiet"} />
          <TodayMetric label="阻断" value={inbox.blockers.length} tone={inbox.blockers.length ? "warning" : "quiet"} />
          <TodayMetric label="延期" value={inbox.deferredCount} tone="quiet" />
          <TodayMetric label="已闭环" value={inbox.linkedTradeCount} tone="positive" />
        </div>
      </header>

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
            <div>
              <ListChecks aria-hidden="true" />
              <strong>行动队列</strong>
            </div>
            <span>{inbox.processedCount} 已处理</span>
          </header>

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
                <span>{inbox.blockers.length ? "先处理右侧阻断项" : "今日队列已清空"}</span>
              </div>
            )}
          </div>
        </section>

        <aside className={`today-inspector ${mobilePane === "decision" ? "is-mobile-pane-active" : ""}`} aria-label="决策检查器">
          {selected ? (
            <>
              <header className="today-inspector-header">
                <span className={`today-direction is-${directionTone(selected.record)}`}>
                  {directionIcon(selected.record)}
                  {directionLabel(selected.record)}
                </span>
                <span className="today-state-label">{selected.stateLabel}</span>
                <strong>{selected.record.symbol}</strong>
                <small>{selected.record.name}</small>
              </header>

              <dl className="today-decision-facts">
                <div><dt>计划金额</dt><dd>{selected.record.amount}</dd></div>
                <div><dt>目标变化</dt><dd>{selected.record.weight}</dd></div>
                <div><dt>可信度</dt><dd>{selected.record.confidenceScore}/100</dd></div>
                <div><dt>复核日</dt><dd>{selected.record.reviewAt || inbox.asOf || "待定"}</dd></div>
              </dl>

              <section className="today-decision-evidence">
                <strong>决策依据</strong>
                <p>{selected.record.detail}</p>
                {selected.record.invalidationCondition ? <small>失效：{selected.record.invalidationCondition}</small> : null}
              </section>

              <section className="today-audit-chain">
                <strong>审计链</strong>
                <div>
                  <AuditNode label="决策" value={shortId(selected.record.decisionId)} ready />
                  <ArrowRight aria-hidden="true" />
                  <AuditNode label="委托" value={selected.linkedOrderIds.length ? `${selected.linkedOrderIds.length} 条` : "待生成"} ready={Boolean(selected.linkedOrderIds.length)} />
                  <ArrowRight aria-hidden="true" />
                  <AuditNode label="成交" value={selected.linkedTradeIds.length ? `${selected.linkedTradeIds.length} 笔` : "待回报"} ready={Boolean(selected.linkedTradeIds.length)} />
                </div>
              </section>

              {selected.state !== "routed" ? (
                <div className="today-defer-row">
                  <CalendarClock aria-hidden="true" />
                  <Input
                    aria-label="延期复核日期"
                    min={nextDateKey(1)}
                    type="date"
                    value={deferDate}
                    onChange={(event) => setDeferDate(event.target.value)}
                  />
                  <Button type="button" variant="outline" onClick={() => act("defer")}>
                    延期
                  </Button>
                </div>
              ) : null}

              <div className="today-actions">
                {selected.state !== "routed" ? (
                  <>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button type="button" variant="destructive" size="icon" aria-label="拒绝建议" onClick={() => act("reject")}>
                          <X aria-hidden="true" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>拒绝建议</TooltipContent>
                    </Tooltip>
                    <Button type="button" variant="outline" onClick={() => act("review")}>
                      <Check aria-hidden="true" />
                      已复核
                    </Button>
                  </>
                ) : null}
                <Button type="button" onClick={() => onOpenExecution(selected.record)}>
                  {selected.state === "routed" ? "查看委托" : "接受并执行"}
                  <ArrowRight aria-hidden="true" />
                </Button>
              </div>
            </>
          ) : (
            <BlockerPanel inbox={inbox} />
          )}

          {selected && inbox.blockers.length ? <BlockerPanel inbox={inbox} compact /> : null}
        </aside>
      </div>
    </section>
  );
}

function DecisionRow({ active, item, onSelect }: { active: boolean; item: TodayDecisionItem; onSelect: () => void }) {
  const record = item.record;
  return (
    <button type="button" className={`today-decision-row ${active ? "is-active" : ""}`} onClick={onSelect}>
      <span className={`today-decision-icon is-${directionTone(record)}`}>{directionIcon(record)}</span>
      <span className="today-decision-identity">
        <strong>{record.symbol}</strong>
        <small>{record.name}</small>
      </span>
      <span className="today-decision-plan">
        <strong>{record.amount}</strong>
        <small>{record.weight}</small>
      </span>
      <span className="today-decision-reason">{record.detail}</span>
      <span className={`today-decision-status is-${item.state}`}>{item.stateLabel}</span>
      <ArrowRight className="today-row-arrow" aria-hidden="true" />
    </button>
  );
}

function BlockerPanel({ inbox, compact = false }: { inbox: TodayInbox; compact?: boolean }) {
  return (
    <section className={`today-blockers ${compact ? "is-compact" : ""}`}>
      <header>
        <ShieldAlert aria-hidden="true" />
        <strong>阻断归属</strong>
        <span>{inbox.blockers.length}</span>
      </header>
      {inbox.blockers.length ? (
        <div className="today-blocker-list">
          {inbox.blockers.map((blocker) => (
            <article key={blocker.key} className={`is-${blocker.severity}`}>
              <CircleAlert aria-hidden="true" />
              <div>
                <span>{blocker.owner}</span>
                <strong>{blocker.label}</strong>
                <p>{blocker.detail}</p>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="today-no-blockers">当前没有阻断项</p>
      )}
    </section>
  );
}

function TodayMetric({ label, tone, value }: { label: string; tone: string; value: number }) {
  return <div className={`today-metric is-${tone}`}><span>{label}</span><strong>{value}</strong></div>;
}

function AuditNode({ label, ready, value }: { label: string; ready: boolean; value: string }) {
  return <span className={ready ? "is-ready" : undefined}><small>{label}</small><strong>{value}</strong></span>;
}

function directionLabel(record: RecommendationRecord) {
  return record.decisionType === "reduce" ? "降低风险" : "增加风险";
}

function directionTone(record: RecommendationRecord) {
  return record.decisionType === "reduce" ? "reduce" : "increase";
}

function directionIcon(record: RecommendationRecord) {
  return record.decisionType === "reduce"
    ? <ArrowDownRight aria-hidden="true" />
    : <ArrowUpRight aria-hidden="true" />;
}

function shortId(value: string) {
  return value.length > 18 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
}

function nextDateKey(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
