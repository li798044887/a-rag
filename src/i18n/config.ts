/** サポートする UI/プロンプト言語。ja が既定。 */
export type Locale = "zh" | "ja";

export const LOCALES: Locale[] = ["ja", "zh"];
export const DEFAULT_LOCALE: Locale = "ja";

/** 言語設定の保存先 Cookie 名（クライアント書き込み・サーバ読み取り）。 */
export const LOCALE_COOKIE = "arag_locale";

/** 言語切替 UI に出す表示名。 */
export const LOCALE_LABELS: Record<Locale, string> = { zh: "中文", ja: "日本語" };

export function isLocale(value: unknown): value is Locale {
  return value === "zh" || value === "ja";
}

/** <html lang> 用の BCP47 タグ。 */
export function htmlLang(locale: Locale): string {
  return locale === "zh" ? "zh-CN" : "ja";
}
