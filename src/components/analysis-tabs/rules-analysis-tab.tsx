import { RulesPanel } from "../rules-panel";
import type { AnalysisTabProps } from "./analysis-tab-loader";
import "../../styles/pages/portfolio-analysis-rules.css";

export default function RulesAnalysisTab({ report }: AnalysisTabProps) {
  return <RulesPanel report={report} />;
}
