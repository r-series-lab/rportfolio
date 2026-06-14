import AccountBalanceWalletRoundedIcon from "@mui/icons-material/AccountBalanceWalletRounded";
import ShieldRoundedIcon from "@mui/icons-material/ShieldRounded";
import TrendingDownRoundedIcon from "@mui/icons-material/TrendingDownRounded";
import TrendingFlatRoundedIcon from "@mui/icons-material/TrendingFlatRounded";
import TrendingUpRoundedIcon from "@mui/icons-material/TrendingUpRounded";
import type { PositionAdvice } from "../lib/types";

type PositionAdvicePanelProps = {
  advice: PositionAdvice[];
};

export function PositionAdvicePanel({ advice }: PositionAdvicePanelProps) {
  return (
    <section className="panel position-panel">
      <div className="panel-head">
        <div className="panel-title">
          <AccountBalanceWalletRoundedIcon fontSize="inherit" />
          <h2>Profile 风险仓位上限</h2>
        </div>
        <span className="panel-kicker">组合层风控</span>
      </div>

      <div className="position-list">
        {advice.map((item) => (
          <article
            key={item.horizonKey}
            className={`position-item is-${normalizeTone(item.tone)}`}
            title={item.confidenceReason}
          >
            <div className="position-horizon">{item.horizonLabel}</div>
            <div className="position-main">
              <div className="position-topline">
                <span className="position-action">
                  <ToneIcon tone={item.tone} />
                  {item.action}
                </span>
                <strong className="position-target">{positionRangeDisplay(item)}</strong>
              </div>
              <div className="position-detail">
                <p>{item.rationale}</p>
                <em>{item.damageScore && item.damageScore >= 50 ? item.damageLabel : item.adjustment}</em>
              </div>
              <div className="position-triggers">
                <span>加仓：{item.entryTrigger}</span>
                <span>风控：{item.riskTrigger}</span>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function positionRangeDisplay(advice: PositionAdvice) {
  return advice.currentRange?.display ?? advice.targetPosition;
}

function ToneIcon({ tone }: { tone: string }) {
  switch (normalizeTone(tone)) {
    case "increase":
      return <TrendingUpRoundedIcon fontSize="inherit" />;
    case "reduce":
      return <TrendingDownRoundedIcon fontSize="inherit" />;
    case "defensive":
      return <ShieldRoundedIcon fontSize="inherit" />;
    default:
      return <TrendingFlatRoundedIcon fontSize="inherit" />;
  }
}

function normalizeTone(tone: string) {
  if (["increase", "hold", "caution", "reduce", "defensive"].includes(tone)) {
    return tone;
  }
  return "hold";
}
