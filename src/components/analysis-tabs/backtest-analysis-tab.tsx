import { BacktestPanel } from "../backtest-panel";
import type { AnalysisTabProps } from "./analysis-tab-loader";
import "../../styles/pages/portfolio-analysis-backtest.css";

export default function BacktestAnalysisTab({ report }: AnalysisTabProps) {
  return (
    <div className="tab-stack">
      <BacktestPanel backtest={report.backtest} showRules={false} />
    </div>
  );
}
