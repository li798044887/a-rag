# 源文件削除時の専用プレビュー表示 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 源文件が削除済み（`/raw`・`/rendered` が 404）のとき、原文件タブに「フォーマット非対応」ではなく専用の削除メッセージを表示し、無効なダウンロード導線を出さない。

**Architecture:** `/raw`（GET/HEAD）と `/rendered` の 404 を「欠落（missing）」として個別に検出し、新規 `MissingOriginalPreview` フォールバックへ振り分ける。非対応フォーマットや解析失敗（非 404）は従来フォールバックのまま維持する。対象は PDF/画像・テキスト・Office変換・表計算の全経路。

**Tech Stack:** Next.js 16 / React 19 / TypeScript / Tailwind v4 / Storybook 10（vitest + MSW でコンポーネントテスト）/ vitest（i18n parity の unit テスト）。

設計書: `docs/superpowers/specs/2026-06-03-deleted-source-preview-design.md`

---

## File Structure

- `src/i18n/locales/zh/documents.ts` — 新規キー `missingTitle` / `missingDescription`（zh = 出所）を追加
- `src/i18n/locales/ja/documents.ts` — 同キーの ja 値を追加（parity 維持）
- `src/hooks/use-raw-text.ts` — `RawTextState.status` に `"missing"` を追加し、404 を区別
- `src/components/documents/original-preview.tsx` — `MissingOriginalPreview` を新設。`RawObjectPreview` / `RawTextContent` / `RenderedPdfPreview` の 404 分岐を更新。`SpreadsheetPreview` へ `onShowParsed` を透過
- `src/components/documents/spreadsheet-preview.tsx` — `"missing"` state を追加し 404 → `MissingOriginalPreview`。`onShowParsed?` prop を受ける
- `src/components/sources/right-panel.stories.tsx` — 既存 `OriginalDeletedPdf` の期待を更新し、テキスト/表計算/Office の削除バリアントを追加（テスト兼カタログ）

各タスクは TDD（失敗するテスト → 最小実装 → パス → コミット）。i18n は高速な parity unit テスト、コンポーネントは Storybook の play 関数をテストとして使う。

---

## Task 1: i18n キー追加（zh 出所 → ja parity）

**Files:**
- Modify: `src/i18n/locales/zh/documents.ts:80-83`
- Modify: `src/i18n/locales/ja/documents.ts`（`unsupported*` の直後）
- Test: `src/i18n/dictionary.test.ts`（既存の parity テストを利用）

- [ ] **Step 1: zh にのみキーを追加して parity を失敗させる**

`src/i18n/locales/zh/documents.ts` の `// UnsupportedPreview / Fallback` ブロック（現 80-83 行）の直後に追記する:

```ts
  // UnsupportedPreview / Fallback
  unsupportedTitle: "此格式无法在浏览器中预览",
  unsupportedDescription: '请在"解析文本"标签页查看提取内容，或下载原文件。',
  unsupportedDownload: "下载原文件",

  // MissingOriginalPreview（源文件が削除済み = /raw 404）
  missingTitle: "源文件已删除或不可用",
  missingDescription: '该文件已被删除，无法预览或下载。可在"解析文本"标签页查看已提取的引用文本。',
```

- [ ] **Step 2: parity テストが失敗することを確認**

Run: `pnpm test src/i18n/dictionary.test.ts`
Expected: FAIL — `zh / ja 键完全对等` で ja 側に `documents.missingTitle` / `documents.missingDescription` が無く不一致。

- [ ] **Step 3: ja に同キーを追加**

`src/i18n/locales/ja/documents.ts` の `unsupportedDownload`（現 85 行付近）の直後に追記する:

```ts
  // MissingOriginalPreview（源文件が削除済み = /raw 404）
  missingTitle: "原本ファイルは削除されたか利用できません",
  missingDescription: "このファイルは削除されており、プレビュー・ダウンロードできません。「解析テキスト」タブで抽出済みの引用テキストを確認できます。",
```

- [ ] **Step 4: parity テストがパスすることを確認**

Run: `pnpm test src/i18n/dictionary.test.ts`
Expected: PASS（3 tests passed）

- [ ] **Step 5: コミット**

```bash
git add src/i18n/locales/zh/documents.ts src/i18n/locales/ja/documents.ts
git commit -m "feat: 源文件削除時用の i18n キー(missingTitle/Description)を追加"
```

---

## Task 2: `MissingOriginalPreview` 新設 + テキスト/PDF/画像経路の 404 分離

`useRawText` に `"missing"` を足し、`MissingOriginalPreview` を作って `RawObjectPreview`（PDF/画像）と `RawTextContent`（テキスト）の 404 を振り分ける。

**Files:**
- Modify: `src/hooks/use-raw-text.ts:9-13,28-41`
- Modify: `src/components/documents/original-preview.tsx:24-46,88-128`
- Test: `src/components/sources/right-panel.stories.tsx:221-236`（既存 `OriginalDeletedPdf` を更新）+ 新規 `OriginalDeletedText`

- [ ] **Step 1: 失敗するテスト（Storybook）を用意**

`src/components/sources/right-panel.stories.tsx` の既存 `OriginalDeletedPdf`（221-236 行）を、新しい削除文言とダウンロードボタン非表示を検証する内容に置き換える:

```tsx
/** 原本タブ（削除済み PDF）: HEAD が 404 → 専用の削除メッセージ。DL ボタンは出さない。 */
export const OriginalDeletedPdf: Story = {
  args: baseArgs("doc-gone", "missing.pdf"),
  parameters: {
    msw: {
      handlers: [
        http.head("/api/documents/:id/raw", () => new HttpResponse(null, { status: 404 })),
        http.get("/api/documents/:id/raw", () => new HttpResponse(null, { status: 404 })),
      ],
    },
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "原本" }));
    await waitFor(() => expect(canvas.getByText("原本ファイルは削除されたか利用できません")).toBeInTheDocument());
    // 404 になるダウンロード導線は出さない。引用テキスト導線のみ残す。
    await expect(canvas.queryByRole("link", { name: "原本をダウンロード" })).toBeNull();
    await expect(canvas.getByRole("button", { name: "引用テキストを表示" })).toBeInTheDocument();
  },
};

/** 原本タブ（削除済みテキスト）: GET が 404 → 専用の削除メッセージ。 */
export const OriginalDeletedText: Story = {
  args: baseArgs("doc-txt-gone", "missing.txt"),
  parameters: {
    msw: {
      handlers: [
        http.get("/api/documents/:id/raw", () => new HttpResponse(null, { status: 404 })),
      ],
    },
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "原本" }));
    await waitFor(() => expect(canvas.getByText("原本ファイルは削除されたか利用できません")).toBeInTheDocument());
    await expect(canvas.queryByRole("link", { name: "原本をダウンロード" })).toBeNull();
  },
};
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm test:storybook src/components/sources/right-panel.stories.tsx`
Expected: FAIL — 現状は「この形式はブラウザでプレビューできません」が出るため、削除文言が見つからずタイムアウト/不一致。
（初回のみ `pnpm exec playwright install` が必要。）

- [ ] **Step 3: `useRawText` に `"missing"` を追加**

`src/hooks/use-raw-text.ts`。`RawTextState` の status と 404 検出を変更する:

```ts
export interface RawTextState {
  status: "idle" | "loading" | "ready" | "missing" | "error";
  text: string;
  truncated: boolean;
}
```

`run()` 内の `catch` を、404 を判別できるよう書き換える（`fetch` 後の分岐で 404 を先に処理する）:

```ts
      setState({ status: "loading", text: "", truncated: false });
      try {
        const res = await fetch(`/api/documents/${encodeURIComponent(docId)}/raw`);
        if (res.status === 404) {
          if (!cancelled) setState({ status: "missing", text: "", truncated: false });
          return;
        }
        if (!res.ok) throw new Error(String(res.status));
        const full = await res.text();
        if (cancelled) return;
        const truncated = full.length > MAX_TEXT_PREVIEW_CHARS;
        setState({
          status: "ready",
          text: truncated ? full.slice(0, MAX_TEXT_PREVIEW_CHARS) : full,
          truncated,
        });
      } catch {
        if (!cancelled) setState({ status: "error", text: "", truncated: false });
      }
```

- [ ] **Step 4: `MissingOriginalPreview` を新設**

`src/components/documents/original-preview.tsx`。`UnsupportedPreview`（46 行）の直後に追加する:

```tsx
/** 原本欠落（削除済み = /raw 404）専用フォールバック。
 *  ダウンロード導線は出さない（404 になるため）。onShowParsed 指定時のみ引用テキスト導線を出す。 */
export function MissingOriginalPreview({ onShowParsed }: { onShowParsed?: () => void }) {
  const { t } = useT();
  return (
    <div className="grid h-full place-items-center p-8 text-center">
      <div className="max-w-[380px]">
        <div className="mb-1.5 text-[13px] font-semibold text-fg">{t.documents.missingTitle}</div>
        <div className="mb-4 text-[12px] leading-[1.6] text-muted">{t.documents.missingDescription}</div>
        {onShowParsed && (
          <button
            onClick={onShowParsed}
            className="inline-flex items-center rounded-lg border-[0.5px] border-divider-strong bg-surface px-3 py-1.5 text-[12px] font-medium text-fg hover:bg-surface-2"
          >{t.sources.showCitedText}</button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: `RawObjectPreview`（PDF/画像）と `RawTextContent`（テキスト）の 404 分岐を更新**

同ファイル。`RawObjectPreview` の最終分岐（現 126 行）を差し替える:

```tsx
  if (missingFor === docId) return <MissingOriginalPreview onShowParsed={onShowParsed} />;
  return <>{children}</>;
```

`RawTextContent`（現 95-98 行付近）の error 分岐を、missing と error に分ける:

```tsx
  if (raw.status === "loading" || raw.status === "idle") {
    return <div className="grid h-full place-items-center text-[12px] text-muted">{t.common.loading}</div>;
  }
  if (raw.status === "missing") return <MissingOriginalPreview onShowParsed={onShowParsed} />;
  if (raw.status === "error") return <UnsupportedPreview docId={docId} onShowParsed={onShowParsed} />;
```

- [ ] **Step 6: テストがパスすることを確認**

Run: `pnpm test:storybook src/components/sources/right-panel.stories.tsx`
Expected: PASS（`OriginalDeletedPdf` / `OriginalDeletedText` を含む全 story がパス）

- [ ] **Step 7: コミット**

```bash
git add src/hooks/use-raw-text.ts src/components/documents/original-preview.tsx src/components/sources/right-panel.stories.tsx
git commit -m "feat: 原本欠落(404)を専用表示にする(PDF/画像/テキスト経路)"
```

---

## Task 3: Office 変換（`RenderedPdfPreview`）の 404 分離

`/rendered` が 404 のときだけ `MissingOriginalPreview`、変換失敗等は従来の `UnsupportedPreview`。

**Files:**
- Modify: `src/components/documents/original-preview.tsx:50-83`
- Test: `src/components/sources/right-panel.stories.tsx`（新規 `OriginalDeletedConvertedPdf`）

- [ ] **Step 1: 失敗するテスト（Storybook）を追加**

`src/components/sources/right-panel.stories.tsx` の末尾に追加する:

```tsx
/** 原本タブ（削除済み Office）: /rendered が 404 → 専用の削除メッセージ。 */
export const OriginalDeletedConvertedPdf: Story = {
  args: baseArgs("doc-docx-gone", "missing.docx"),
  parameters: {
    msw: {
      handlers: [
        http.get("/api/documents/:id/rendered", () => new HttpResponse(null, { status: 404 })),
      ],
    },
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "原本PDF変換" }));
    await waitFor(() => expect(canvas.getByText("原本ファイルは削除されたか利用できません")).toBeInTheDocument());
    await expect(canvas.queryByRole("link", { name: "原本をダウンロード" })).toBeNull();
  },
};
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm test:storybook src/components/sources/right-panel.stories.tsx`
Expected: FAIL — 現状 `/rendered` の 404 は `error` 経由で `UnsupportedPreview` になり、削除文言が出ない。

- [ ] **Step 3: `RenderedPdfPreview` で 404 を `missing` に分離**

`src/components/documents/original-preview.tsx` の `RenderedPdfPreview`（50-83 行）を更新する。state 型と fetch 分岐、戻り分岐を変える:

```tsx
export function RenderedPdfPreview({ docId, filename }: { docId: string; filename: string }) {
  const [state, setState] = useState<"loading" | "ready" | "error" | "missing">("loading");
  const [url, setUrl] = useState<string | null>(null);

  // docId ごとに key で再マウントされる前提（初期状態 = loading）。
  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    (async () => {
      try {
        const res = await fetch(`/api/documents/${encodeURIComponent(docId)}/rendered`);
        if (res.status === 404) {
          if (!cancelled) setState("missing");
          return;
        }
        if (!res.ok) throw new Error(String(res.status));
        const blob = await res.blob();
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
        setState("ready");
      } catch {
        if (!cancelled) setState("error");
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [docId]);

  const { t } = useT();
  if (state === "missing") return <MissingOriginalPreview />;
  if (state === "error") return <UnsupportedPreview docId={docId} />;
  if (state === "loading" || !url) {
    return <div className="grid h-full place-items-center text-[12px] text-muted">{t.documents.pdfConverting}</div>;
  }
  return <iframe title={filename} src={url + PDF_VIEW_PARAMS} className="h-full w-full border-0" />;
}
```

- [ ] **Step 4: テストがパスすることを確認**

Run: `pnpm test:storybook src/components/sources/right-panel.stories.tsx`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/components/documents/original-preview.tsx src/components/sources/right-panel.stories.tsx
git commit -m "feat: Office変換原本の欠落(404)を専用表示にする"
```

---

## Task 4: 表計算（`SpreadsheetPreview`）の 404 分離 + `onShowParsed` 透過

`/raw` が 404 のとき `MissingOriginalPreview`。解析失敗は従来 `Fallback`。引用パネルで引用テキスト導線を出せるよう `onShowParsed` を透過する。

**Files:**
- Modify: `src/components/documents/spreadsheet-preview.tsx:29-60`
- Modify: `src/components/documents/original-preview.tsx:175-177`
- Test: `src/components/sources/right-panel.stories.tsx`（新規 `OriginalDeletedSpreadsheet`）

- [ ] **Step 1: 失敗するテスト（Storybook）を追加**

`src/components/sources/right-panel.stories.tsx` の末尾に追加する:

```tsx
/** 原本タブ（削除済み表計算）: /raw が 404 → 専用の削除メッセージ。 */
export const OriginalDeletedSpreadsheet: Story = {
  args: baseArgs("doc-xlsx-gone", "missing.xlsx"),
  parameters: {
    msw: {
      handlers: [
        http.get("/api/documents/:id/raw", () => new HttpResponse(null, { status: 404 })),
      ],
    },
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "スプレッドシート" }));
    await waitFor(() => expect(canvas.getByText("原本ファイルは削除されたか利用できません")).toBeInTheDocument());
    await expect(canvas.queryByRole("link", { name: "原本をダウンロード" })).toBeNull();
  },
};
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm test:storybook src/components/sources/right-panel.stories.tsx`
Expected: FAIL — 現状 404 は `error` 経由で表計算用 `Fallback`（「この表計算ファイルを表示できませんでした」）になり、削除文言が出ない。

- [ ] **Step 3: `SpreadsheetPreview` に `missing` state と `onShowParsed` を追加**

`src/components/documents/spreadsheet-preview.tsx`。まず import に `MissingOriginalPreview` を足す:

```tsx
import { MissingOriginalPreview } from "@/components/documents/original-preview";
```

シグネチャと state、fetch 分岐、戻り分岐を更新する:

```tsx
export function SpreadsheetPreview({ docId, filename, onShowParsed }: { docId: string; filename: string; onShowParsed?: () => void }) {
  const [state, setState] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [active, setActive] = useState(0);

  // docId ごとに key で再マウントされる前提（初期 state = loading）。
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/documents/${encodeURIComponent(docId)}/raw`);
        if (res.status === 404) {
          if (!cancelled) setState("missing");
          return;
        }
        if (!res.ok) throw new Error(String(res.status));
        const buf = await res.arrayBuffer();
        const XLSX = await import("xlsx");
        const wb = XLSX.read(buf, { type: "array" });
        if (!wb.SheetNames.length) throw new Error("no sheets");
        const grids = wb.SheetNames.map((n) => sheetToGrid(wb.Sheets[n]));
        if (cancelled) return;
        setParsed({ sheetNames: wb.SheetNames, grids });
        setState("ready");
      } catch {
        if (!cancelled) setState("error");
      }
    })();
    return () => { cancelled = true; };
  }, [docId]);

  const { t } = useT();
  if (state === "missing") return <MissingOriginalPreview onShowParsed={onShowParsed} />;
  if (state === "error") return <Fallback docId={docId} />;
```

（`loading` 以降の既存表示はそのまま。）

- [ ] **Step 4: `OriginalPreview` から `onShowParsed` を透過**

`src/components/documents/original-preview.tsx` の表計算分岐（現 175-177 行）を更新する:

```tsx
  if (isSpreadsheet(filename)) {
    return card(<SpreadsheetPreview key={docId} docId={docId} filename={filename} onShowParsed={onShowParsed} />);
  }
```

- [ ] **Step 5: テストがパスすることを確認**

Run: `pnpm test:storybook src/components/sources/right-panel.stories.tsx`
Expected: PASS

- [ ] **Step 6: コミット**

```bash
git add src/components/documents/spreadsheet-preview.tsx src/components/documents/original-preview.tsx src/components/sources/right-panel.stories.tsx
git commit -m "feat: 表計算原本の欠落(404)を専用表示にする"
```

---

## Task 5: 全体検証ゲート

型・lint・テスト全体を通す。

**Files:** （変更なし。検証のみ）

- [ ] **Step 1: 型チェック**

Run: `pnpm exec tsc --noEmit`
Expected: エラーなし。

- [ ] **Step 2: lint**

Run: `pnpm lint`
Expected: エラーなし。

- [ ] **Step 3: i18n unit テスト全体**

Run: `pnpm test src/i18n/dictionary.test.ts`
Expected: PASS。

- [ ] **Step 4: Storybook テスト全体**

Run: `pnpm test:storybook src/components/sources/right-panel.stories.tsx`
Expected: 既存（OriginalPdf/Text/Spreadsheet/ConvertedPdf）と新規（Deleted×4）が全てパス。

- [ ] **Step 5: 問題なければ完了（追加コミット不要）**

すべてグリーンなら本プランは完了。`superpowers:finishing-a-development-branch` で統合方針を決める。

---

## Self-Review メモ

- **Spec coverage:** 設計書の 5 経路（PDF/画像=RawObjectPreview, テキスト=RawTextContent, Office=RenderedPdfPreview, 表計算=SpreadsheetPreview）+ `MissingOriginalPreview` + i18n + テストをそれぞれ Task 1–4 で実装、Task 5 で検証。末尾の真の非対応 fallback を変えない点も維持（変更箇所に含めていない）。
- **型整合:** 新 status 文字列は `"missing"` で全経路統一。`MissingOriginalPreview` の prop は `onShowParsed?` のみ（`docId` 不要 = ダウンロード導線を持たないため）。`SpreadsheetPreview` の新 prop も `onShowParsed?`。
- **Placeholder:** なし。各コード片は実値。i18n 文言は確定。
