import { TechnicalPanel } from "../technical-panel";
import type { AnalysisTabProps } from "./analysis-tab-loader";
import "../../styles/pages/portfolio-analysis-indicators.css";

export default function IndicatorsAnalysisTab({ report }: AnalysisTabProps) {
  return (
    <TechnicalPanel
      profileMarket={report.profileMarket}
      columns={report.technicalColumns}
      priceAction={report.priceAction}
      rows={report.technicalRows}
      strength={report.sectorStrength}
    />
  );
}
