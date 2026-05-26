import { test, expect } from "@playwright/test";

// 前提: docker compose up -d（rag-worker 含む）が起動済み
// この E2E は全バックエンドスタック（postgres/qdrant/redis/rag）を必要とします。
// ローカル CI では `pnpm e2e` で実行。
test("register → upload → ask → cited answer", async ({ page }) => {
  await page.goto("/");

  // 新規登録フォームへ
  await page.getByRole("link", { name: /新規登録|register/i }).click().catch(() => {
    // ログインページに直接表示されている場合もある
  });

  // ユニークなテストユーザーを登録
  const email = `e2e-${Date.now()}@example.com`;
  const password = "TestPass123!";
  await page.getByLabel(/メールアドレス|email/i).fill(email);
  await page.getByLabel(/パスワード/i).fill(password);
  await page.getByRole("button", { name: /登録|register/i }).click();

  // ログイン後にワークスペースが表示される
  await expect(page).toHaveURL(/\/(workspace)?$/, { timeout: 10_000 });

  // ファイルアップロード（small PDF）
  await page.setInputFiles('input[type="file"]', "tests-e2e/fixtures/sample.pdf");
  await expect(page.getByText(/索引化しました|ready/i)).toBeVisible({ timeout: 120_000 });

  // 質問
  await page.getByRole("textbox").fill("この資料の要点は？");
  await page.keyboard.press("Enter");

  // 引用付き回答
  await expect(page.locator("text=/\\[1\\]/")).toBeVisible({ timeout: 60_000 });
});
