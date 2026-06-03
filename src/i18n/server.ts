import { cookies } from "next/headers";
import { LOCALE_COOKIE, DEFAULT_LOCALE, isLocale, type Locale } from "./config";

/** リクエストの Cookie から言語を解決する。未設定/不正は既定 ja。 */
export async function getLocale(): Promise<Locale> {
  const jar = await cookies();
  const value = jar.get(LOCALE_COOKIE)?.value;
  return isLocale(value) ? value : DEFAULT_LOCALE;
}
