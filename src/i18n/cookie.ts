import { LOCALE_COOKIE, type Locale } from "./config";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/** クライアントで document.cookie に書き込む言語 Cookie 文字列を作る。 */
export function buildLocaleCookie(locale: Locale): string {
  return `${LOCALE_COOKIE}=${locale}; path=/; max-age=${ONE_YEAR_SECONDS}; samesite=lax`;
}
