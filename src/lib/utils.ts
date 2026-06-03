import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { Locale } from "@/i18n/config";

/** Tailwind-aware className combiner. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Format a duration in ms as `48ms` / `1.24s`. */
export function formatMs(ms: number | null | undefined): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

/** Human-readable file size. */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Short, collision-resistant id for client-only entities (toasts, files). */
export function uid(prefix = ""): string {
  return prefix + Math.random().toString(36).slice(2);
}

/** Locale-aware relative time string from a Date.
 *  zh: "刚刚"/"3分钟前"/"2小时前"/"3天前"/"1周前"/"2个月前"/"1年前"
 *  ja: "たった今"/"3分前"/"2時間前"/"3日前"/"1週間前"/"2ヶ月前"/"1年前"
 */
export function relativeTime(date: Date, locale: Locale): string {
  const diffMs = Date.now() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (locale === "zh") {
    if (diffSec < 60) return "刚刚";
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}分钟前`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}小时前`;
    const diffDay = Math.floor(diffHr / 24);
    if (diffDay < 7) return `${diffDay}天前`;
    const diffWeek = Math.floor(diffDay / 7);
    if (diffWeek < 5) return `${diffWeek}周前`;
    const diffMonth = Math.floor(diffDay / 30);
    if (diffMonth < 12) return `${diffMonth}个月前`;
    return `${Math.floor(diffDay / 365)}年前`;
  }
  // ja
  if (diffSec < 60) return "たった今";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}分前`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}時間前`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}日前`;
  const diffWeek = Math.floor(diffDay / 7);
  if (diffWeek < 5) return `${diffWeek}週間前`;
  const diffMonth = Math.floor(diffDay / 30);
  if (diffMonth < 12) return `${diffMonth}ヶ月前`;
  return `${Math.floor(diffDay / 365)}年前`;
}
