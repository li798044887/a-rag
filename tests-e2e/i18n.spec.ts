import { test, expect } from "@playwright/test";

// 言語切替（i18n）の E2E。
// バックエンドスタック（postgres/qdrant/redis/rag）は不要 —— 未認証の入口は
// ローカライズされたログイン画面を描画するため、Cookie 駆動のロケール解決を
// そのまま検証できる。アプリの言語切替は「Cookie 書き込み → リロード」で動くので、
// arag_locale Cookie を仕込んでリロードする本テストは "ユーザーが切替えた後の状態" を
// 忠実に再現する（切替操作自体のロジックは performLocaleSwitch のユニットテストで担保）。

const LOCALE_COOKIE = "arag_locale";

async function setLocaleCookie(context: import("@playwright/test").BrowserContext, value: "zh" | "ja") {
  await context.addCookies([
    { name: LOCALE_COOKIE, value, url: "http://localhost:3000" },
  ]);
}

test("既定（Cookie なし）は中国語 UI で描画される", async ({ page, context }) => {
  await context.clearCookies();
  await page.goto("/");

  // ログイン見出し（中国語）が出る
  await expect(page.getByText("欢迎回来")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "登录" })).toBeVisible();
  // 日本語版の見出しは出ていない
  await expect(page.getByText("おかえりなさい")).toHaveCount(0);
  // <html lang> が zh-CN
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
});

test("arag_locale=ja の Cookie で日本語 UI に切り替わる", async ({ page, context }) => {
  await setLocaleCookie(context, "ja");
  await page.goto("/");

  await expect(page.getByText("おかえりなさい")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "サインイン" })).toBeVisible();
  await expect(page.getByText("欢迎回来")).toHaveCount(0);
  await expect(page.locator("html")).toHaveAttribute("lang", "ja");
});

test("arag_locale=zh の Cookie で明示的に中国語へ戻せる", async ({ page, context }) => {
  await setLocaleCookie(context, "zh");
  await page.goto("/");

  await expect(page.getByText("欢迎回来")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
});

test("不正な arag_locale 値は既定（中国語）にフォールバックする", async ({ page, context }) => {
  await context.addCookies([
    { name: LOCALE_COOKIE, value: "en", url: "http://localhost:3000" },
  ]);
  await page.goto("/");

  await expect(page.getByText("欢迎回来")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
});
