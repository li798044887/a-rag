import type { Locale } from "./config";
import { zh, type Dictionary } from "./locales/zh";
import { ja } from "./locales/ja";

export type { Dictionary };

const DICTIONARIES: Record<Locale, Dictionary> = { zh, ja };

export function getDictionary(locale: Locale): Dictionary {
  return DICTIONARIES[locale];
}
