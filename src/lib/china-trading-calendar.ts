const CHINA_EXCHANGE_HOLIDAY_RANGES_2026: Array<[string, string]> = [
  ["2026-01-01", "2026-01-03"],
  ["2026-02-15", "2026-02-23"],
  ["2026-04-04", "2026-04-06"],
  ["2026-05-01", "2026-05-05"],
  ["2026-06-19", "2026-06-21"],
  ["2026-09-25", "2026-09-27"],
  ["2026-10-01", "2026-10-07"],
];

const CHINA_EXCHANGE_HOLIDAYS_2026 = new Set(
  CHINA_EXCHANGE_HOLIDAY_RANGES_2026.flatMap(([start, end]) => datesBetween(start, end)),
);

export function isChinaTradingDay(value: string) {
  const date = normalizeDate(value);
  if (!date) return false;
  const day = utcDate(date).getUTCDay();
  if (day === 0 || day === 6) return false;
  if (date.startsWith("2026-") && CHINA_EXCHANGE_HOLIDAYS_2026.has(date)) return false;
  return true;
}

export function nextChinaTradingDay(value: string) {
  const normalized = normalizeDate(value) || new Date().toISOString().slice(0, 10);
  const date = utcDate(normalized);
  for (let offset = 1; offset <= 20; offset += 1) {
    date.setUTCDate(date.getUTCDate() + 1);
    const candidate = date.toISOString().slice(0, 10);
    if (isChinaTradingDay(candidate)) return candidate;
  }
  return normalized;
}

export function chinaTradingCalendarNote(value: string) {
  const date = normalizeDate(value);
  if (!date) return "日期无效";
  if (date.startsWith("2026-")) return "沪深交易所 2026 年休市表";
  return "工作日推算（尚未载入该年度官方休市表）";
}

function normalizeDate(value: string) {
  const match = value.trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (!match) return "";
  const [, year, month, day] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function datesBetween(start: string, end: string) {
  const result: string[] = [];
  const cursor = utcDate(start);
  const last = utcDate(end).getTime();
  while (cursor.getTime() <= last) {
    result.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return result;
}

function utcDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}
