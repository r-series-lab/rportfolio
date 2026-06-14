import QueryStatsRoundedIcon from "@mui/icons-material/QueryStatsRounded";
import TrendingDownRoundedIcon from "@mui/icons-material/TrendingDownRounded";
import TrendingFlatRoundedIcon from "@mui/icons-material/TrendingFlatRounded";
import TrendingUpRoundedIcon from "@mui/icons-material/TrendingUpRounded";
import { useDragScroll } from "../hooks/use-drag-scroll";
import type { AssetStatus } from "../lib/types";
import { formatPercent } from "../lib/utils";
import { DetailTooltip } from "./detail-tooltip";

type AssetLightsProps = {
  assets: AssetStatus[];
};

export function AssetLights({ assets }: AssetLightsProps) {
  const dragScroll = useDragScroll();

  return (
    <section className="asset-panel">
      <div className="micro-panel-head">
        <QueryStatsRoundedIcon fontSize="inherit" />
        <span>资产灯号</span>
      </div>
      <div className="asset-list drag-scroll" {...dragScroll}>
        {assets.map((asset) => (
          <article key={asset.symbol} className={`asset-item is-${asset.status}`}>
            <div className="asset-light" />
            <DetailTooltip title={`${asset.symbol} · ${asset.label}`}>
              <div className="asset-main has-detail">
                <strong>{asset.symbol}</strong>
                <small>{asset.label}</small>
              </div>
            </DetailTooltip>
            <div className="asset-meta">
              <span>{asset.close.toFixed(asset.symbol === "VIX" ? 1 : 2)}</span>
              <em className={marketMoveClass(asset.change1d)}>
                {trendIcon(asset.change1d)}
                {formatPercent(asset.change1d)}
              </em>
            </div>
            <Sparkline value={asset.change1d} />
          </article>
        ))}
      </div>
    </section>
  );
}

function Sparkline({ value }: { value: number | null }) {
  const positive = (value ?? 0) >= 0;
  const points = positive
    ? "0,24 10,20 20,22 30,10 40,14 50,8 60,12 70,7"
    : "0,9 10,13 20,11 30,22 40,18 50,24 60,21 70,26";

  return (
    <svg className={`asset-sparkline ${positive ? "is-positive" : "is-negative"}`} viewBox="0 0 70 32" aria-hidden="true">
      <polyline points={points} />
    </svg>
  );
}

function marketMoveClass(value: number | null) {
  if (value === null || value === 0) {
    return "is-flat";
  }
  return value > 0 ? "is-positive" : "is-negative";
}

function trendIcon(value: number | null) {
  if (value === null) {
    return <TrendingFlatRoundedIcon fontSize="inherit" />;
  }
  if (value > 0) {
    return <TrendingUpRoundedIcon fontSize="inherit" />;
  }
  if (value < 0) {
    return <TrendingDownRoundedIcon fontSize="inherit" />;
  }
  return <TrendingFlatRoundedIcon fontSize="inherit" />;
}
