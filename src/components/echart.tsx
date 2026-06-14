import { useEffect, useRef, type CSSProperties } from "react";
import { BarChart, PieChart, ScatterChart } from "echarts/charts";
import {
  GridComponent,
  LegendComponent,
  TooltipComponent,
  type GridComponentOption,
  type LegendComponentOption,
  type TooltipComponentOption,
} from "echarts/components";
import * as echarts from "echarts/core";
import type { BarSeriesOption, PieSeriesOption, ScatterSeriesOption } from "echarts/charts";
import type { ComposeOption, ECharts, EChartsCoreOption } from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([BarChart, PieChart, ScatterChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

export type RPortfolioChartOption = ComposeOption<
  BarSeriesOption | PieSeriesOption | ScatterSeriesOption | GridComponentOption | LegendComponentOption | TooltipComponentOption
>;

type EChartProps = {
  ariaLabel: string;
  className?: string;
  option: RPortfolioChartOption | EChartsCoreOption;
  style?: CSSProperties;
};

export function EChart({ ariaLabel, className, option, style }: EChartProps) {
  const chartRef = useRef<ECharts | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!rootRef.current) {
      return;
    }

    const chart = echarts.init(rootRef.current, undefined, { renderer: "canvas" });
    chartRef.current = chart;

    const resizeObserver = new ResizeObserver(() => chart.resize());
    resizeObserver.observe(rootRef.current);

    return () => {
      resizeObserver.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    chartRef.current?.setOption(option, { lazyUpdate: true, notMerge: true });
  }, [option]);

  return <div ref={rootRef} className={className} style={style} role="img" aria-label={ariaLabel} />;
}
