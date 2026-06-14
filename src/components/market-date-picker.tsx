import CalendarMonthRoundedIcon from "@mui/icons-material/CalendarMonthRounded";
import ChevronLeftRoundedIcon from "@mui/icons-material/ChevronLeftRounded";
import ChevronRightRoundedIcon from "@mui/icons-material/ChevronRightRounded";
import { Popover } from "@mui/material";
import type { MouseEvent } from "react";
import { useMemo, useState } from "react";

type MarketDatePickerProps = {
  value: string;
  onChange: (value: string) => void;
};

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];

export function MarketDatePicker({ value, onChange }: MarketDatePickerProps) {
  const selectedDate = useMemo(() => parseDateValue(value), [value]);
  const [anchorEl, setAnchorEl] = useState<HTMLButtonElement | null>(null);
  const [viewMonth, setViewMonth] = useState(() => monthStart(selectedDate));
  const calendarToday = useMemo(() => stripTime(new Date()), []);
  const currentTradingDay = useMemo(() => nearestTradingDay(calendarToday, -1), [calendarToday]);
  const open = Boolean(anchorEl);
  const days = useMemo(() => calendarDays(viewMonth), [viewMonth]);
  const valueParts = dateParts(selectedDate);

  function openCalendar(event: MouseEvent<HTMLButtonElement>) {
    setViewMonth(monthStart(selectedDate));
    setAnchorEl(event.currentTarget);
  }

  function closeCalendar() {
    setAnchorEl(null);
  }

  function selectDate(date: Date, close = true) {
    onChange(formatDateValue(date));
    setViewMonth(monthStart(date));
    if (close) {
      closeCalendar();
    }
  }

  return (
    <>
      <button
        type="button"
        className={`date-field topbar-field market-date-trigger ${open ? "is-open" : ""}`}
        aria-label={`回测日期 ${formatDateValue(selectedDate)}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={openCalendar}
      >
        <CalendarMonthRoundedIcon fontSize="inherit" />
        <span className="market-date-value" aria-hidden="true">
          <strong>{valueParts.year}</strong>
          <em>/{valueParts.month}/{valueParts.day}</em>
        </span>
      </button>

      <Popover
        open={open}
        anchorEl={anchorEl}
        onClose={closeCalendar}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        transformOrigin={{ vertical: "top", horizontal: "left" }}
        marginThreshold={12}
        slotProps={{ paper: { className: "market-date-popover-paper" } }}
      >
        <div className="market-date-panel" role="dialog" aria-label="选择回测日期">
          <div className="market-date-panel-head">
            <button
              type="button"
              className="market-date-nav"
              aria-label="上个月"
              onClick={() => setViewMonth(addMonths(viewMonth, -1))}
            >
              <ChevronLeftRoundedIcon fontSize="inherit" />
            </button>
            <div>
              <strong>
                {viewMonth.getFullYear()}年 {viewMonth.getMonth() + 1}月
              </strong>
              <span>回测交易日</span>
            </div>
            <button
              type="button"
              className="market-date-nav"
              aria-label="下个月"
              onClick={() => setViewMonth(addMonths(viewMonth, 1))}
            >
              <ChevronRightRoundedIcon fontSize="inherit" />
            </button>
          </div>

          <div className="market-date-weekdays" aria-hidden="true">
            {WEEKDAYS.map((day) => (
              <span key={day}>{day}</span>
            ))}
          </div>

          <div className="market-date-grid" role="grid" aria-label={`${viewMonth.getFullYear()}年${viewMonth.getMonth() + 1}月`}>
            {days.map((day) => {
              const selected = sameDate(day.date, selectedDate);
              const currentMonth = day.date.getMonth() === viewMonth.getMonth();
              const weekend = isWeekend(day.date);
              const dayLabel = formatDateValue(day.date);
              return (
                <button
                  type="button"
                  role="gridcell"
                  key={dayLabel}
                  aria-label={dayLabel}
                  aria-selected={selected}
                  disabled={weekend}
                  className={[
                    "market-date-day",
                    selected ? "is-selected" : "",
                    sameDate(day.date, calendarToday) ? "is-today" : "",
                    currentMonth ? "" : "is-outside",
                    weekend ? "is-weekend" : "",
                  ].filter(Boolean).join(" ")}
                  onClick={() => selectDate(day.date)}
                >
                  <span>{day.date.getDate()}</span>
                  {sameDate(day.date, calendarToday) ? <i aria-hidden="true" /> : null}
                </button>
              );
            })}
          </div>

          <div className="market-date-footer">
            <button type="button" onClick={() => selectDate(currentTradingDay)}>
              今日
            </button>
            <button type="button" onClick={() => selectDate(addTradingDays(selectedDate, -1), false)}>
              前一交易日
            </button>
            <button type="button" onClick={() => selectDate(addTradingDays(selectedDate, 1), false)}>
              后一交易日
            </button>
          </div>
        </div>
      </Popover>
    </>
  );
}

function calendarDays(month: Date) {
  const firstDay = new Date(month.getFullYear(), month.getMonth(), 1);
  const mondayOffset = (firstDay.getDay() + 6) % 7;
  const start = addDays(firstDay, -mondayOffset);
  return Array.from({ length: 42 }, (_, index) => ({ date: addDays(start, index) }));
}

function dateParts(date: Date) {
  return {
    year: String(date.getFullYear()),
    month: pad(date.getMonth() + 1),
    day: pad(date.getDate()),
  };
}

function parseDateValue(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return stripTime(new Date());
  }
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (Number.isNaN(date.getTime())) {
    return stripTime(new Date());
  }
  return stripTime(date);
}

function formatDateValue(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function monthStart(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function stripTime(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return stripTime(next);
}

function addMonths(date: Date, months: number) {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

function addTradingDays(date: Date, days: number) {
  const step = days >= 0 ? 1 : -1;
  let remaining = Math.abs(days);
  let next = stripTime(date);
  while (remaining > 0) {
    next = addDays(next, step);
    if (!isWeekend(next)) {
      remaining -= 1;
    }
  }
  return next;
}

function nearestTradingDay(date: Date, direction: 1 | -1) {
  let next = stripTime(date);
  while (isWeekend(next)) {
    next = addDays(next, direction);
  }
  return next;
}

function isWeekend(date: Date) {
  const day = date.getDay();
  return day === 0 || day === 6;
}

function sameDate(left: Date, right: Date) {
  return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth() && left.getDate() === right.getDate();
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}
