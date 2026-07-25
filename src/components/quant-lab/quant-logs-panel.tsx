import CandlestickChartRoundedIcon from "@mui/icons-material/CandlestickChartRounded";
import { ProgressiveDisclosure } from "../progressive-disclosure";
import { Card } from "../ui/card";
import type { LabLog } from "./quant-lab-contracts";
import "../../styles/pages/quant-lab-logs.css";

type QuantLogsPanelProps = {
  logs: LabLog[];
};

export default function QuantLogsPanel({ logs }: QuantLogsPanelProps) {
  return (
    <Card id="quant-execution-log" size="sm" className="rail-card quant-log-panel" role="region" aria-label="运行日志">
      <div className="quant-section-head">
        <div>
          <span>日志</span>
          <strong>运行日志</strong>
        </div>
        <CandlestickChartRoundedIcon fontSize="inherit" />
      </div>
      {logs.slice(0, 3).map((item) => (
        <article key={item.key} className={`is-${item.tone}`}>
          <span>{item.time}</span>
          <p>{item.text}</p>
        </article>
      ))}
      {logs.length > 3 ? (
        <ProgressiveDisclosure className="quant-log-disclosure" label="更早日志" badge={`${logs.length - 3} 条`}>
          {logs.slice(3).map((item) => (
            <article key={item.key} className={`is-${item.tone}`}>
              <span>{item.time}</span>
              <p>{item.text}</p>
            </article>
          ))}
        </ProgressiveDisclosure>
      ) : null}
    </Card>
  );
}
