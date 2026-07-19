import { AssetLights } from "../asset-lights";
import { BacktestSummaryPanel } from "../backtest-summary-panel";
import { PortfolioProfilePanel } from "../portfolio-profile-panel";
import type { AnalysisTabProps } from "./analysis-tab-loader";
import "../../styles/pages/portfolio-analysis-overview.css";

export default function OverviewAnalysisTab({ report }: AnalysisTabProps) {
  return (
    <div className="overview-grid">
      <div className="overview-main">
        <AssetLights assets={report.assetStatuses} />
        <PortfolioProfilePanel portfolio={report.portfolioProfile} />
        <div className="overview-lower-grid">
          <BacktestSummaryPanel backtest={report.backtest} />
        </div>
      </div>
    </div>
  );
}
