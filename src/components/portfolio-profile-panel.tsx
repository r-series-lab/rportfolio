import DonutLargeRoundedIcon from "@mui/icons-material/DonutLargeRounded";
import HealthAndSafetyRoundedIcon from "@mui/icons-material/HealthAndSafetyRounded";
import InfoOutlineRoundedIcon from "@mui/icons-material/InfoOutlineRounded";
import PieChartRoundedIcon from "@mui/icons-material/PieChartRounded";
import TrackChangesRoundedIcon from "@mui/icons-material/TrackChangesRounded";
import { Tooltip } from "@mui/material";
import type { CSSProperties, ReactNode } from "react";
import type { PortfolioAction, PortfolioExposure, PortfolioHolding, PortfolioProfile } from "../lib/types";
import { formatNumber, formatPercent } from "../lib/utils";
import { DetailTooltip } from "./detail-tooltip";

type PortfolioProfilePanelProps = {
  portfolio: PortfolioProfile;
};

export function PortfolioProfilePanel({ portfolio }: PortfolioProfilePanelProps) {
  const exposureGroups = [
    { key: "sector", title: "行业", rows: portfolio.sectorExposure.slice(0, 4), focus: portfolio.topSector },
    { key: "style", title: "风格", rows: portfolio.styleExposure.slice(0, 4), focus: portfolio.topStyle },
    { key: "exposure", title: "暴露", rows: portfolio.exposureBreakdown.slice(0, 4), focus: portfolio.topExposure },
  ];
  const scoreCopy = portfolioScoreCopy(portfolio);

  return (
    <section className="portfolio-panel panel">
      <div className="panel-head portfolio-head">
        <h2>
          <TrackChangesRoundedIcon fontSize="inherit" />
          Profile 资产池 / 结构健康
        </h2>
        <div className="portfolio-head-meta">
          <span>Profile 配置权重</span>
          <strong>{portfolio.holdings.length} 项</strong>
        </div>
      </div>

      <div className="portfolio-dashboard is-profile-pool">
        <div className={`portfolio-command-card is-${portfolio.healthTone}`}>
          <div className="portfolio-score-card">
            <div
              className={`portfolio-score-ring is-${portfolio.healthTone}`}
              style={{ "--portfolio-score": portfolio.healthScore } as CSSProperties}
            >
              <HealthAndSafetyRoundedIcon fontSize="inherit" />
              <strong>{portfolio.healthScore}</strong>
              <span>{portfolio.healthLabel}</span>
            </div>
            <div className="portfolio-score-copy">
              <span className="portfolio-score-label">
                资产池体检
                <Tooltip title={scoreCopy.detail} arrow placement="top" enterTouchDelay={0}>
                  <button type="button" className="portfolio-info-button" aria-label={scoreCopy.detail}>
                    <InfoOutlineRoundedIcon fontSize="inherit" />
                  </button>
                </Tooltip>
              </span>
              <strong>{scoreCopy.title}</strong>
              <em>
                配置权重 {formatNumber(portfolio.totalWeight, 0)}% · 现金/未分配 {formatNumber(portfolio.cashWeight, 0)}%
              </em>
            </div>
          </div>

          <div className="portfolio-kpis">
            <MetricCard
              icon={<TrackChangesRoundedIcon fontSize="inherit" />}
              label="结构风险"
              value={portfolio.weightedRiskScore}
              suffix="/100"
              tone={portfolio.healthTone}
            />
            <MetricCard
              icon={<DonutLargeRoundedIcon fontSize="inherit" />}
              label="集中风险"
              value={portfolio.concentrationScore}
              suffix="/100"
              tone={portfolio.concentrationTone}
              note={portfolio.concentrationLabel}
            />
            <MetricCard
              icon={<PieChartRoundedIcon fontSize="inherit" />}
              label="最大权重"
              value={portfolio.topHoldingWeight}
              suffix="%"
              tone={portfolio.concentrationTone}
              note={portfolio.topHolding}
            />
          </div>

          <div className="portfolio-focus-strip">
            <FocusPill label="主行业" value={portfolio.topSector} />
            <FocusPill label="主风格" value={portfolio.topStyle} />
            <FocusPill label="主暴露" value={portfolio.topExposure} />
          </div>

          <div className="portfolio-action-list">
            {portfolio.actions.map((action) => (
              <DetailTooltip key={action.key} title={action.detail} placement="top-start">
                <article className={`portfolio-action is-${action.tone} has-detail`}>
                  <span>{action.label}</span>
                  <p>{compactPortfolioAction(action)}</p>
                </article>
              </DetailTooltip>
            ))}
          </div>
        </div>

        <div className="portfolio-exposure-board">
          <div className="portfolio-board-head">
            <strong>暴露结构</strong>
            <span>Profile weights</span>
          </div>
          <div className="portfolio-exposure-block">
            {exposureGroups.map((group) => (
              <ExposureColumn key={group.key} title={group.title} focus={group.focus} rows={group.rows} />
            ))}
          </div>
        </div>

        <div className="portfolio-holdings-board">
          <div className="portfolio-board-head">
            <strong>资产池健康</strong>
            <span>{portfolio.holdings.length} symbols</span>
          </div>
          <div className="portfolio-holding-list">
            {portfolio.holdings.slice(0, 6).map((holding) => (
              <HoldingRow key={holding.symbol} holding={holding} />
            ))}
          </div>
          <div className={`portfolio-holding-fill is-${portfolio.healthTone}`}>
            <span>Profile 结构摘要</span>
            <strong>{portfolio.healthLabel} · {formatNumber(portfolio.healthScore, 0)}/100</strong>
            <p>{compactPortfolioAction(portfolio.actions[0])}</p>
          </div>
        </div>
      </div>
    </section>
  );
}

function FocusPill({ label, value }: { label: string; value: string }) {
  return (
    <span className="portfolio-focus-pill">
      <small>{label}</small>
      <strong>{value}</strong>
    </span>
  );
}

function portfolioScoreCopy(portfolio: PortfolioProfile) {
  const sector = shortExposureName(portfolio.topSector);
  const score = formatNumber(portfolio.healthScore, 0);
  return {
    title: `${portfolio.healthLabel} ${score}/100 · ${sector}最高`,
    detail: "Profile 资产池结构评分，只评估当前 Profile 内的标的、权重和风险贡献，不读取你的个人账户持仓。",
  };
}

function shortExposureName(value: string) {
  if (!value || value === "-") {
    return "主线";
  }
  return value.replace(/\s+\d+(?:\.\d+)?%$/, "");
}

function compactPortfolioAction(action: PortfolioAction) {
  return action.detail
    .replace(/(.+?) 权重 \d+(?:\.\d+)?%，新增仓位优先等回踩确认。/u, "$1偏高 · 新增等回踩")
    .replace("红灯持仓先看 MA20/MA50 收复，未修复前不提高持仓风险预算。", "红灯资产先修复 MA20/50")
    .replace("暂未发现明显集中项。", "集中项暂稳")
    .replace(/[。；;]$/g, "");
}

function MetricCard({
  icon,
  label,
  note,
  suffix,
  tone,
  value,
}: {
  icon: ReactNode;
  label: string;
  note?: string;
  suffix: string;
  tone: string;
  value: number;
}) {
  return (
    <article className={`portfolio-metric is-${tone}`}>
      <span>
        {icon}
        {label}
      </span>
      <strong>
        {formatNumber(value, 0)}
        <small>{suffix}</small>
      </strong>
      {note ? <em>{note}</em> : null}
    </article>
  );
}

function ExposureColumn({ focus, rows, title }: { focus: string; rows: PortfolioExposure[]; title: string }) {
  return (
    <div className="portfolio-exposure-column">
      <div className="portfolio-exposure-title">
        <span>{title}</span>
        <strong>{focus}</strong>
      </div>
      {rows.map((row) => (
        <article key={`${row.kind}-${row.key}`} className={`portfolio-exposure-row is-${row.tone}`}>
          <div>
            <strong>{row.label}</strong>
            <em>{formatNumber(row.weight, 0)}%</em>
          </div>
          <div className="portfolio-bar-track">
            <span style={{ width: `${Math.max(4, Math.min(100, row.weight))}%` }} />
          </div>
        </article>
      ))}
    </div>
  );
}

function HoldingRow({ holding }: { holding: PortfolioHolding }) {
  return (
    <article className={`portfolio-holding is-${holding.healthTone}`}>
      <span className={`portfolio-status-dot is-${holding.status}`} />
      <div className="portfolio-holding-main">
        <strong>{holding.symbol}</strong>
        <span>
          {holding.sector} · {holding.style}
        </span>
      </div>
      <div className="portfolio-holding-weight">
        <strong>{formatNumber(holding.weight, 0)}%</strong>
        <span>{holding.exposure}</span>
      </div>
      <div className="portfolio-holding-health">
        <strong>{holding.healthScore}</strong>
        <span>{formatPercent(holding.return20d)}</span>
      </div>
      <div className="portfolio-holding-meter" aria-hidden="true">
        <span style={{ width: `${Math.max(4, Math.min(100, holding.healthScore))}%` }} />
      </div>
    </article>
  );
}
