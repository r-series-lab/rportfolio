import { StructurePanel } from "../structure-panel";
import type { AnalysisTabProps } from "./analysis-tab-loader";
import "../../styles/pages/portfolio-analysis-structure.css";

export default function StructureAnalysisTab({ report }: AnalysisTabProps) {
  return (
    <div className="tab-stack">
      <StructurePanel
        structure={report.structure}
        factorScores={report.factorScores}
        patternAnalysis={report.patternAnalysis}
        report={report}
      />
    </div>
  );
}
