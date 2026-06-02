import { buildLocaleCookie } from "./cookie";
import type { Locale } from "./config";

export interface LocaleSwitchEffects {
  setCookie: (value: string) => void;
  reload: () => void;
}

/** Cookie 書き込み → リロード。副作用は注入してテスト可能にする。 */
export function performLocaleSwitch(next: Locale, effects: LocaleSwitchEffects): void {
  effects.setCookie(buildLocaleCookie(next));
  effects.reload();
}

/** ブラウザ既定の副作用。 */
export const browserLocaleEffects: LocaleSwitchEffects = {
  setCookie: (value) => { document.cookie = value; },
  reload: () => { window.location.reload(); },
};
