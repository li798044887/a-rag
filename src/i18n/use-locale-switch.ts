import type { Locale } from "./config";

export interface LocaleSwitchEffects {
  /** 言語設定をユーザーデータへ永続化する（失敗時は throw）。 */
  save: (locale: Locale) => Promise<void>;
  reload: () => void;
}

/** 言語をユーザーデータへ保存してからページをリロードする。
 *  保存が失敗した場合はリロードしない（副作用は注入してテスト可能にする）。 */
export async function persistAndSwitchLocale(next: Locale, effects: LocaleSwitchEffects): Promise<void> {
  await effects.save(next);
  effects.reload();
}

/** ブラウザ既定の副作用：API でユーザーデータへ永続化 → リロード。 */
export const browserLocaleEffects: LocaleSwitchEffects = {
  save: async (locale) => {
    const res = await fetch("/api/account/locale", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locale }),
    });
    if (!res.ok) throw new Error("failed to persist locale");
  },
  reload: () => { window.location.reload(); },
};
