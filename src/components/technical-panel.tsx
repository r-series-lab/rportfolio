import QueryStatsRoundedIcon from "@mui/icons-material/QueryStatsRounded";
import SwapHorizRoundedIcon from "@mui/icons-material/SwapHorizRounded";
import {
  Chip,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
} from "@mui/material";
import type { CSSProperties } from "react";
import { useMemo, useState } from "react";
import { useDragScroll } from "../hooks/use-drag-scroll";
import type { SectorStrengthRow, TechnicalColumn, TechnicalRow } from "../lib/types";
import { formatPercent } from "../lib/utils";

type IndicatorFilter = "all" | "core" | "overheat" | "weak" | "risk";

type TechnicalPanelProps = {
  columns: TechnicalColumn[];
  rows: TechnicalRow[];
  strength: SectorStrengthRow[];
  profileMarket?: string;
};

const FILTERS: Array<{ key: IndicatorFilter; label: string }> = [
  { key: "all", label: "全部" },
  { key: "core", label: "核心资产" },
  { key: "overheat", label: "过热资产" },
  { key: "weak", label: "弱势资产" },
  { key: "risk", label: "风险资产" },
];

export function TechnicalPanel({ columns, rows, strength, profileMarket }: TechnicalPanelProps) {
  const [filter, setFilter] = useState<IndicatorFilter>("all");
  const tableDragScroll = useDragScroll();
  const strengthDragScroll = useDragScroll();
  const filteredRows = useMemo(() => rows.filter((row, index) => matchesFilter(row, filter, index)), [filter, rows]);
  const activeFilter = FILTERS.find((item) => item.key === filter) ?? FILTERS[0];
  const benchmarkLabel = relativeBenchmarkLabel(profileMarket);

  return (
    <section className="panel technical-panel">
      <div className="panel-head">
        <div className="panel-title">
          <QueryStatsRoundedIcon fontSize="inherit" />
          <h2>技术指标</h2>
        </div>
        <span className="panel-kicker">
          {activeFilter.label} {filteredRows.length}/{rows.length}
        </span>
      </div>
      <div className="indicator-filter-strip" role="group" aria-label="指标筛选">
        {FILTERS.map((item) => (
          <button
            key={item.key}
            type="button"
            className={item.key === filter ? "is-active" : undefined}
            onClick={() => setFilter(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <TableContainer
        className="technical-table-wrap drag-scroll"
        style={{ "--technical-column-count": columns.length } as CSSProperties}
        {...tableDragScroll}
      >
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell>标的</TableCell>
              {columns.map((column) => (
                <TableCell key={column.key} align={alignFor(column.align)}>
                  {column.label}
                </TableCell>
              ))}
              <TableCell>状态</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filteredRows.length ? (
              filteredRows.map((row) => (
                <TableRow key={row.symbol}>
                  <TableCell>
                    <strong>{row.symbol}</strong>
                    <span className="muted-cell">{row.label}</span>
                  </TableCell>
                  {columns.map((column) => {
                    const cell = row.cells.find((item) => item.key === column.key);
                    return (
                      <TableCell
                        key={`${row.symbol}-${column.key}`}
                        align={alignFor(column.align)}
                        className={cellToneClass(cell?.tone)}
                      >
                        {cell?.display ?? "-"}
                      </TableCell>
                    );
                  })}
                  <TableCell>
                    <Chip size="small" label={row.note} className={`status-chip is-${row.status}`} />
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length + 2} className="empty-table-cell">
                  当前筛选无标的
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <div className="strength-scroll-wrap">
        <div className="strength-strip drag-scroll" {...strengthDragScroll}>
          <span className="strength-label">
            <SwapHorizRoundedIcon fontSize="inherit" />
            相对 {benchmarkLabel}
          </span>
          {strength.map((item) => (
            <div key={item.symbol} className={`strength-pill is-${item.status}`}>
              <span>{item.symbol}</span>
              <strong>{formatPercent(item.relativeToSpy)}</strong>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function matchesFilter(row: TechnicalRow, filter: IndicatorFilter, index: number) {
  if (filter === "all") {
    return true;
  }
  if (filter === "core") {
    return index < 4 || isCoreAsset(row);
  }
  if (filter === "overheat") {
    return isOverheated(row);
  }
  if (filter === "weak") {
    return isWeak(row);
  }
  return row.status !== "green" || isOverheated(row) || isWeak(row);
}

function isCoreAsset(row: TechnicalRow) {
  const symbol = row.symbol.toUpperCase();
  return /SPY|QQQ|SMH|NVDA|HSTECH|HSI|TENCENT|ALIBABA|MEITUAN|KOSPI|EWY|SKHYNIX|SAMSUNG|CSI|HSCEI/.test(symbol);
}

function isOverheated(row: TechnicalRow) {
  return (row.rsi14 ?? 0) >= 75 || /过热|拥挤|加速|追高/.test(row.note);
}

function isWeak(row: TechnicalRow) {
  return row.status === "red" || /跌破|走弱|弱|承压|压力|回落|分歧/.test(row.note);
}

function relativeBenchmarkLabel(profileMarket: string | undefined) {
  if (profileMarket === "hk") return "HSTECH";
  if (profileMarket === "kr") return "KOSPI";
  if (profileMarket === "cn") return "沪深300";
  if (profileMarket === "global") return "ACWI";
  return "SPY";
}

function alignFor(value: string): "left" | "right" | "center" | "justify" | "inherit" {
  if (value === "left" || value === "center" || value === "justify" || value === "inherit") {
    return value;
  }
  return "right";
}

function cellToneClass(value: string | undefined) {
  if (value === "positive") {
    return "is-positive";
  }
  if (value === "negative") {
    return "is-negative";
  }
  return "";
}
