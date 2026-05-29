import { test, expect } from "@playwright/test";

// 前提: docker compose up -d（rag-worker 含む）が起動済み
// この E2E は全バックエンドスタック（postgres/qdrant/redis/rag）を必要とします。
// ローカル CI では `pnpm e2e` で実行。

/** Composer（質問入力欄）のロケータ。placeholder で一意に特定する。 */
function composer(page: import("@playwright/test").Page) {
  return page.getByPlaceholder(/質問するか/);
}

/** Composer に質問を入力し送信する（値が入ったことを確認してから Enter）。 */
async function ask(page: import("@playwright/test").Page, text: string) {
  const box = composer(page);
  await box.click();
  await box.fill(text);
  await expect(box).toHaveValue(text); // React state に反映されたことを保証
  await box.press("Enter");
}

/** サインアップしてワークスペースに入る共通ヘルパ。 */
async function registerAndEnter(page: import("@playwright/test").Page) {
  await page.goto("/");
  // signin → signup へ切替
  await page.getByRole("link", { name: "サインアップ" }).click();

  const email = `e2e-${Date.now()}-${Math.floor(Math.random() * 1e4)}@example.com`;
  const password = "TestPass123!";
  await page.getByPlaceholder("you@company.com").fill(email);
  await page.getByPlaceholder("山田 太郎").fill("E2E ユーザー");
  await page.getByPlaceholder("8文字以上").fill(password);
  await page.getByRole("button", { name: "アカウントを作成" }).click();

  // ワークスペースの質問入力欄が出れば成功
  await expect(composer(page)).toBeVisible({ timeout: 15_000 });
}

async function uploadSample(page: import("@playwright/test").Page) {
  await page.setInputFiles('input[type="file"]', "tests-e2e/fixtures/sample.pdf");
  // 索引化完了は添付カードの永続表示「N件のチャンクを索引化」で判定（トースト消滅に依存しない）。
  await expect(page.getByText(/チャンクを索引化/)).toBeVisible({ timeout: 120_000 });
}

test("register → upload → ask → cited answer", async ({ page }) => {
  test.setTimeout(240_000); // 索引化(最大120s) + 回答生成を含む
  await registerAndEnter(page);
  await uploadSample(page);

  // 質問
  await ask(page, "この資料の要点は？");

  // 引用付き回答 + トランスクリプトにターンが1つ
  await expect(page.locator("text=/\\[1\\]/")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator("[data-turn]")).toHaveCount(1, { timeout: 60_000 });
});

// 同一スレッド内で対話を継続できる（agentic マルチターン）ことを検証する。
// この機能の核心は「ターンが蓄積し過去ターンが残る」ことなので、文書アップロードには依存しない
// （文書ゼロでも各質問はターンを生成し done で完了する）。
test("follow up continues in the same thread", async ({ page }) => {
  test.setTimeout(180_000);
  await registerAndEnter(page);

  // 1ターン目
  await ask(page, "社内の休暇規程について教えて。");
  await expect(page.locator("[data-turn]")).toHaveCount(1, { timeout: 60_000 });
  // 1ターン目が完了（フッターの「再生成」操作が出る = status done）するまで待つ
  await expect(page.getByRole("button", { name: /再生成|regenerate/i })).toBeVisible({ timeout: 90_000 });

  // 2ターン目（同一スレッド内のフォローアップ。過去ターンは残ったまま追記される）
  await ask(page, "その申請期限は？");

  // 過去ターンが消えず、トランスクリプトのターンが2つになる（＝継続できている）
  await expect(page.locator("[data-turn]")).toHaveCount(2, { timeout: 90_000 });
  // 1ターン目の質問が画面に残っている
  await expect(page.locator('[data-turn="0"]')).toContainText("社内の休暇規程について教えて。");
});
