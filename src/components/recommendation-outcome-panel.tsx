import FactCheckRoundedIcon from "@mui/icons-material/FactCheckRounded";
import type { ExecutionAttributionSummary } from "../lib/execution-attribution";
import type { ProfileCalibrationAction, RecommendationPerformanceSlice, RecommendationPerformanceSummary } from "../lib/types";

type RecommendationOutcomePanelProps = {
  action: ProfileCalibrationAction | undefined;
  attribution: ExecutionAttributionSummary;
  performance: RecommendationPerformanceSummary | undefined;
};

export function RecommendationOutcomePanel({ action, attribution, performance }: RecommendationOutcomePanelProps) {
  const tone = performance?.tone ?? "neutral";
  const horizon20 = performance?.horizons.find((item) => item.key === "20");
  const sampleCount = horizon20?.sampleCount ?? 0;
  const minimumSampleCount = action?.minimumSampleCount ?? 20;
  const missingSamples = Math.max(0, minimumSampleCount - sampleCount);
  const prioritySlices = performance?.priorities ?? [];
  const priorityReview = priorityReviewFor(prioritySlices);

  return (
    <section className={`panel recommendation-outcome-panel is-${tone}`}>
      <div className="panel-head">
        <h2>
          <FactCheckRoundedIcon />
          真实建议结果
        </h2>
        <span className="outcome-source-badge">样本外 · 5/20/60 日</span>
      </div>

      <div className="outcome-verdict">
        <div>
          <span>当前结论</span>
          <strong>{performance?.label ?? "等待真实结果"}</strong>
        </div>
        <p>{performance?.summary ?? "建议到期后自动回填，不使用历史回测冒充真实命中率。"}</p>
        <em className={`is-${tone}`}>
          {sampleCount >= minimumSampleCount ? "允许进入校准评审" : `还需 ${missingSamples} 个 20 日样本`}
        </em>
      </div>

      <div className="outcome-metric-grid" aria-label="真实建议指标">
        <OutcomeMetric label="有效结果" value={String(performance?.effectiveEvaluatedOutcomes ?? 0)} detail={`等待 ${performance?.pendingOutcomes ?? 0}`} />
        <OutcomeMetric label="20 日命中" value={formatRate(horizon20?.hitRatePct)} detail={`n=${sampleCount}`} />
        <OutcomeMetric label="方向收益" value={formatSigned(horizon20?.averageSignedReturnPct)} detail="买卖与等待统一计分" />
        <OutcomeMetric label="超额收益" value={formatSigned(horizon20?.averageExcessReturnPct)} detail="相对 Profile 基准" />
        <OutcomeMetric label="最大不利" value={formatSigned(horizon20?.averageMaxAdversePct)} detail="平均路径风险" />
        <OutcomeMetric label="证据不足" value={String(performance?.insufficientOutcomes ?? 0)} detail="缺少价格或到期数据" />
      </div>

      <section className={`outcome-priority-review is-${priorityReview.tone}`} aria-label="优先级有效性">
        <div>
          <span>优先级复盘</span>
          <strong>{priorityReview.label}</strong>
        </div>
        <p>{priorityReview.detail}</p>
      </section>

      {prioritySlices.length ? (
        <div className="outcome-slice-list is-priority-list" aria-label="按优先级拆分">
          {prioritySlices.map((item) => <OutcomeSlice key={item.key} item={item} />)}
        </div>
      ) : null}

      <section className={`outcome-execution-review is-${attribution.verdictTone}`} aria-label="真实执行归因">
        <header>
          <div>
            <span>真实执行归因</span>
            <strong>{attribution.verdict}</strong>
          </div>
          <p>{attribution.verdictDetail}</p>
        </header>
        <div className="outcome-execution-metrics">
          <OutcomeMetric label="匹配成交" value={`${attribution.matched}/${attribution.total}`} detail={`待评估 ${attribution.pending}`} />
          <OutcomeMetric label="不利滑点" value={formatBps(attribution.averageSlippageBps)} detail="相对建议参考价" />
          <OutcomeMetric label="交易费用" value={formatBps(attribution.averageFeeBps)} detail="占成交金额" />
          <OutcomeMetric label="执行拖累" value={formatSigned(attribution.averageExecutionDragPct)} detail="相对建议基准" />
          <OutcomeMetric label="未执行机会" value={formatSigned(attribution.missedOpportunityPct)} detail={`${attribution.missed} 条未匹配`} />
        </div>
        {attribution.rows.length ? (
          <div className="outcome-execution-rows">
            {attribution.rows.slice(0, 5).map((row) => (
              <span key={row.key}>
                <strong>{row.symbol}</strong>
                <em>{row.priority} · {row.side}</em>
                <small>{row.tradeDate} · 滑点 {formatBps(row.slippageBps)} · 拖累 {formatSigned(row.executionDragPct)}</small>
              </span>
            ))}
          </div>
        ) : null}
      </section>

      {performance?.directions.length ? (
        <div className="outcome-slice-list" aria-label="按决策类型拆分">
          {performance.directions.slice(0, 5).map((item) => <OutcomeSlice key={item.key} item={item} />)}
        </div>
      ) : null}

      <div className={`outcome-calibration is-${action?.tone ?? "neutral"}`}>
        <div>
          <span>{action?.label ?? "继续收集"}</span>
          <strong>{action?.action ?? "保持当前 Profile，累计到 20 个去重的 20 日结果后复核。"}</strong>
        </div>
        <p>{action?.rationale ?? "样本不足时不调整参数，避免追随短期噪声。"}</p>
        <small>下次复核：{action?.nextReview ?? "20 日有效样本达到 20 个时"}</small>
      </div>
    </section>
  );
}

function priorityReviewFor(priorities: RecommendationPerformanceSlice[]) {
  const p1 = priorities.find((item) => item.key === "P1");
  const p2 = priorities.find((item) => item.key === "P2");
  if (!p1 || p1.sampleCount < 20) {
    return {
      detail: `P1 已到期样本 n=${p1?.sampleCount ?? 0}；累计到 20 条前不调整排序权重。`,
      label: "继续收集",
      tone: "neutral",
    };
  }
  if (!p2 || p2.sampleCount < 10) {
    return {
      detail: `P1 样本已可观察，但 P2 对照仅 n=${p2?.sampleCount ?? 0}，暂不能证明排序有效。`,
      label: "缺少对照",
      tone: "caution",
    };
  }
  const hitGap = (p1.hitRatePct ?? 0) - (p2.hitRatePct ?? 0);
  const edgeGap = (p1.averageExcessReturnPct ?? p1.averageSignedReturnPct ?? 0)
    - (p2.averageExcessReturnPct ?? p2.averageSignedReturnPct ?? 0);
  if (hitGap >= 5 && edgeGap >= 0) {
    return {
      detail: `P1 命中率领先 P2 ${hitGap.toFixed(1)} 个百分点，收益证据也未落后；保留当前排序。`,
      label: "排序有效",
      tone: "positive",
    };
  }
  if (hitGap <= -5 || edgeGap < -0.5) {
    return {
      detail: `P1 未优于 P2：命中差 ${hitGap.toFixed(1)} 个百分点、收益差 ${edgeGap.toFixed(2)}%；应降低当前排序权重。`,
      label: "排序需调整",
      tone: "negative",
    };
  }
  return {
    detail: `P1 与 P2 区分度不足：命中差 ${hitGap.toFixed(1)} 个百分点、收益差 ${edgeGap.toFixed(2)}%；继续收集。`,
    label: "暂不调整",
    tone: "caution",
  };
}

function OutcomeMetric({ detail, label, value }: { detail: string; label: string; value: string }) {
  return (
    <article>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function OutcomeSlice({ item }: { item: RecommendationPerformanceSlice }) {
  return (
    <article>
      <span>{item.label}</span>
      <strong>{formatRate(item.hitRatePct)}</strong>
      <small>n={item.sampleCount} · 收益 {formatSigned(item.averageSignedReturnPct)}</small>
    </article>
  );
}

function formatRate(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(1)}%` : "—";
}

function formatSigned(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatBps(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(0)} bps`;
}
