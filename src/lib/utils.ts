import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatNumber(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "—";
  }
  return value.toFixed(digits);
}

export function formatPercent(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "—";
  }
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)}%`;
}

export function formatMoney(value: number, currency: string): string {
  if (!Number.isFinite(value) || value <= 0) return "—";
  const symbol = currency === "USD" ? "$" : currency === "HKD" ? "HK$" : currency === "KRW" ? "₩" : "¥";
  return `${symbol}${Math.round(value).toLocaleString("zh-CN")}`;
}

export function formatDateTime(value: string): string {
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

export function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export function scoreAngle(score: number): string {
  return `${Math.max(0, Math.min(100, score)) * 3.6}deg`;
}
