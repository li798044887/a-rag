import { cookies, headers } from "next/headers";
import { LOCALES, LOCALE_COOKIE, DEFAULT_LOCALE, isLocale, type Locale } from "./config";

/**
 * Accept-Language ヘッダからサポート言語を選ぶ。q 値の高い順に走査し、
 * 先頭一致（zh* → zh, ja* → ja）で最初に該当した言語を返す。該当なしは null。
 */
export function negotiateLocale(acceptLanguage: string | null | undefined): Locale | null {
  if (!acceptLanguage) return null;
  const ranked = acceptLanguage
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.find((p) => p.trim().startsWith("q="));
      const quality = q ? Number.parseFloat(q.split("=")[1]) : 1;
      return { tag: tag.trim().toLowerCase(), quality: Number.isNaN(quality) ? 0 : quality };
    })
    .filter((entry) => entry.tag)
    .sort((a, b) => b.quality - a.quality);

  for (const { tag } of ranked) {
    const primary = tag.split("-")[0];
    const match = LOCALES.find((locale) => locale === primary);
    if (match) return match;
  }
  return null;
}

/**
 * リクエストの言語を解決する。
 * Cookie（永続設定）→ Accept-Language（初回訪問のシステム言語）→ 既定 ja の順。
 */
export async function getLocale(): Promise<Locale> {
  const value = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(value)) return value;

  const negotiated = negotiateLocale((await headers()).get("accept-language"));
  return negotiated ?? DEFAULT_LOCALE;
}
