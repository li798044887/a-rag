# 一次資料パネルの原本表示 全形式標準化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 一次資料パネル（right-panel）の「原本」表示を全ファイル形式に対応させ、原本描画ロジックを文書一覧モーダルと共有コンポーネントへ一本化する。

**Architecture:** `documents-modal.tsx` 内にインライン定義されている原本プレビュー部品（`RenderedPdfPreview` / `RawTextContent` / `UnsupportedPreview`）を新ファイル `src/components/documents/original-preview.tsx` へ移設し、形式ディスパッチ本体 `OriginalPreview` を追加する。modal と right-panel の双方がこの `OriginalPreview` を使う。形式判定は `file-types.ts` の拡張子ベース純粋関数に統一する。

**Tech Stack:** Next.js 16 App Router / React 19 / TypeScript / Tailwind v4 / Storybook（MSW モック）/ Vitest。

---

## 設計参照

- Spec: `docs/superpowers/specs/2026-06-03-original-preview-standardize-design.md`

## ファイル構成

- **Create** `src/components/documents/original-preview.tsx` — 原本プレビューの共有ディスパッチ + 移設された3部品。
- **Modify** `src/lib/file-types.ts` — `isPdf` / `isImage`（拡張子判定）を追加。
- **Modify** `src/lib/file-types.test.ts` — 上記のテストを追加。
- **Modify** `src/components/documents/documents-modal.tsx` — インライン3部品を削除し `OriginalPreview` を使用。`mime` 判定を拡張子 helper に置換。
- **Modify** `src/components/sources/right-panel.tsx` — 原本タブを全形式常設、`OriginalPreview` を使用、HEAD チェック分岐を撤去。
- **Modify** `src/i18n/locales/zh/sources.ts` / `src/i18n/locales/ja/sources.ts` — 未使用化する `viewPdf` / `deletedTitle` / `deletedDesc` を削除。
- **Modify** `src/components/sources/right-panel.stories.tsx` — 全形式の原本タブ表示ストーリーを追加。

---

## Task 1: `file-types.ts` に `isPdf` / `isImage` を追加

**Files:**
- Modify: `src/lib/file-types.ts`
- Test: `src/lib/file-types.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/file-types.test.ts` の import 行を更新し、末尾に2テストを追加する。

import 行を以下へ置換:

```ts
import { getTextPreviewKind, isConvertibleToPdf, isImage, isPdf, isSpreadsheet, type TextPreviewKind } from "@/lib/file-types";
```

ファイル末尾に追記:

```ts
test("isPdf: PDF のみ true（拡張子の大小無視）", () => {
  for (const name of ["a.pdf", "REPORT.PDF"]) expect(isPdf(name), name).toBe(true);
  for (const name of ["a.png", "a.docx", "a.txt", "noext", ""]) expect(isPdf(name), name).toBe(false);
});

test("isImage: ブラウザ表示可能な画像は true（拡張子の大小無視）", () => {
  for (const name of ["a.png", "b.jpg", "c.jpeg", "d.gif", "e.webp", "f.svg", "g.bmp", "h.avif", "PHOTO.JPG"]) {
    expect(isImage(name), name).toBe(true);
  }
  for (const name of ["a.pdf", "a.docx", "a.txt", "noext", ""]) expect(isImage(name), name).toBe(false);
});
```

- [ ] **Step 2: テストが落ちることを確認**

Run: `pnpm test src/lib/file-types.test.ts`
Expected: FAIL（`isPdf`/`isImage` is not exported → 型エラーまたは未定義）

- [ ] **Step 3: 最小実装**

`src/lib/file-types.ts` の `isSpreadsheet` 関数定義（56行目あたり、`}` で閉じる箇所）の直後に追記する:

```ts
// ブラウザが直接表示できる画像形式（拡張子・小文字）。
const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif"]);

// 純正 PDF かを拡張子で判定する。
export function isPdf(name: string): boolean {
  const ext = (name.split(".").pop() || "").toLowerCase();
  return name.includes(".") && ext === "pdf";
}

// ブラウザで <img> 直接表示できる画像形式かを拡張子で判定する。
export function isImage(name: string): boolean {
  const ext = (name.split(".").pop() || "").toLowerCase();
  return name.includes(".") && IMAGE_EXTS.has(ext);
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm test src/lib/file-types.test.ts`
Expected: PASS（全テスト緑）

- [ ] **Step 5: コミット**

```bash
git add src/lib/file-types.ts src/lib/file-types.test.ts
git commit -m "feat: file-types に isPdf/isImage の拡張子判定を追加"
```

---

## Task 2: 共有コンポーネント `original-preview.tsx` を作成

`documents-modal.tsx` から3部品を移設し、ディスパッチ `OriginalPreview` を追加する。
この時点では modal はまだ自前のインライン定義を使っており、build は緑のまま。

**Files:**
- Create: `src/components/documents/original-preview.tsx`

- [ ] **Step 1: ファイルを作成**

`src/components/documents/original-preview.tsx` を以下の内容で新規作成する:

```tsx
"use client";

import { useEffect, useState, type ReactNode } from "react";
import { SpreadsheetPreview } from "@/components/documents/spreadsheet-preview";
import { PlainTextView } from "@/components/documents/plain-text-view";
import { useRawText, type RawTextState } from "@/hooks/use-raw-text";
import { getTextPreviewKind, isConvertibleToPdf, isImage, isPdf, isSpreadsheet } from "@/lib/file-types";
import { useT } from "@/i18n/context";

// 純正 PDF ビューアの黒いクロムを隠し、紙系の世界観に馴染ませる。
const PDF_VIEW_PARAMS = "#toolbar=0&navpanes=0&statusbar=0&view=FitH";

/** プレビュー不可フォールバック（原本ダウンロード導線）。
 *  onShowParsed 指定時は「引用テキストを表示」導線も並べる（一次資料パネル用）。 */
export function UnsupportedPreview({ docId, onShowParsed }: { docId: string; onShowParsed?: () => void }) {
  const { t } = useT();
  return (
    <div className="grid h-full place-items-center p-8 text-center">
      <div className="max-w-[380px]">
        <div className="mb-1.5 text-[13px] font-semibold text-fg">{t.documents.unsupportedTitle}</div>
        <div className="mb-4 text-[12px] leading-[1.6] text-muted">{t.documents.unsupportedDescription}</div>
        <div className="flex items-center justify-center gap-2">
          <a
            href={`/api/documents/${encodeURIComponent(docId)}/raw?download=1`}
            className="inline-flex items-center gap-1.5 rounded-lg border-[0.5px] border-divider-strong bg-surface px-3 py-1.5 text-[12px] font-medium text-fg hover:bg-surface-2"
          >{t.documents.unsupportedDownload}</a>
          {onShowParsed && (
            <button
              onClick={onShowParsed}
              className="inline-flex items-center rounded-lg border-[0.5px] border-divider-strong bg-surface px-3 py-1.5 text-[12px] font-medium text-fg hover:bg-surface-2"
            >{t.sources.showCitedText}</button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Office 原本をサーバ側で PDF 変換し iframe 表示する。初回は数秒の変換待ち、
 *  失敗時はダウンロード導線へ退避する。blob 経由にして HTTP エラーを iframe に晒さない。 */
export function RenderedPdfPreview({ docId, filename }: { docId: string; filename: string }) {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [url, setUrl] = useState<string | null>(null);

  // docId ごとに key で再マウントされる前提（初期状態 = loading）。
  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    (async () => {
      try {
        const res = await fetch(`/api/documents/${encodeURIComponent(docId)}/rendered`);
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
  if (state === "error") return <UnsupportedPreview docId={docId} />;
  if (state === "loading" || !url) {
    return <div className="grid h-full place-items-center text-[12px] text-muted">{t.documents.pdfConverting}</div>;
  }
  return <iframe title={filename} src={url + PDF_VIEW_PARAMS} className="h-full w-full border-0" />;
}

/** 原本テキストの読み込み状態をラップする。ready のとき children（整形ビュー）を表示し、
 *  children 無し（原本タブ）のときは生テキストを PlainTextView で表示する。
 *  loading/error と truncate 注記もここで一元的に出す。 */
export function RawTextContent({
  raw,
  docId,
  children,
  onShowParsed,
}: { raw: RawTextState; docId: string; children?: ReactNode; onShowParsed?: () => void }) {
  const { t } = useT();
  if (raw.status === "loading" || raw.status === "idle") {
    return <div className="grid h-full place-items-center text-[12px] text-muted">{t.common.loading}</div>;
  }
  if (raw.status === "error") return <UnsupportedPreview docId={docId} onShowParsed={onShowParsed} />;
  return (
    <div>
      {raw.truncated && (
        <div className="border-b-[0.5px] border-divider bg-accent-soft px-5 py-2 text-[11.5px] text-fg-2">
          {t.documents.rawTruncated}
        </div>
      )}
      {children ?? <PlainTextView text={raw.text} />}
    </div>
  );
}

interface OriginalPreviewProps {
  docId: string;
  filename: string;
  /** PDF のときだけ #page=N へジャンプ。1-based。省略時はジャンプしない。 */
  pdfPage?: number;
  /** true で modal 風の角丸カード枠、false（既定）でフラッシュ表示（panel 用）。 */
  framed?: boolean;
  /** 指定時、非対応/原本欠落フォールバックに「引用テキストを表示」導線を出す。 */
  onShowParsed?: () => void;
}

/** 文書の原本を形式に応じて描画する共有ディスパッチ。modal/panel 共通。
 *  優先順位: PDF → 画像 → 表計算 → Office変換 → テキスト → 非対応フォールバック。 */
export function OriginalPreview({ docId, filename, pdfPage, framed, onShowParsed }: OriginalPreviewProps) {
  const textKind = getTextPreviewKind(filename);
  const raw = useRawText(textKind ? docId : null);

  const card = (node: ReactNode) =>
    framed ? (
      <div className="h-full p-3">
        <div className="h-full overflow-hidden rounded-[10px] border-[0.5px] border-divider-strong bg-surface shadow-e1">{node}</div>
      </div>
    ) : (
      <div className="h-full">{node}</div>
    );

  if (isPdf(filename)) {
    const base = `/api/documents/${encodeURIComponent(docId)}/raw`;
    const src = pdfPage ? `${base}#page=${pdfPage}&toolbar=0&navpanes=0&statusbar=0&view=FitH` : `${base}${PDF_VIEW_PARAMS}`;
    return card(<iframe key={pdfPage ?? 0} title={filename} src={src} className="h-full w-full border-0" />);
  }
  if (isImage(filename)) {
    return (
      <div className="grid h-full place-items-center p-5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/api/documents/${encodeURIComponent(docId)}/raw`} alt={filename} className="max-h-full max-w-full rounded-lg border-[0.5px] border-divider" />
      </div>
    );
  }
  if (isSpreadsheet(filename)) {
    return card(<SpreadsheetPreview key={docId} docId={docId} filename={filename} />);
  }
  if (isConvertibleToPdf(filename)) {
    return card(<RenderedPdfPreview key={docId} docId={docId} filename={filename} />);
  }
  if (textKind) {
    return <RawTextContent raw={raw} docId={docId} onShowParsed={onShowParsed} />;
  }
  return <UnsupportedPreview docId={docId} onShowParsed={onShowParsed} />;
}
```

- [ ] **Step 2: 型チェック**

Run: `pnpm exec tsc --noEmit`
Expected: PASS（新ファイルに型エラーなし。`t.common.loading` / `t.sources.showCitedText` / `t.documents.*` は既存キー）

- [ ] **Step 3: コミット**

```bash
git add src/components/documents/original-preview.tsx
git commit -m "feat: 原本プレビュー共有コンポーネント OriginalPreview を追加"
```

---

## Task 3: `documents-modal.tsx` を `OriginalPreview` 利用へリファクタ

表示・挙動は現状維持。インライン3部品を削除し、`mime` 判定を拡張子 helper へ寄せ、
原本タブ本体を `OriginalPreview` へ置換する。

**Files:**
- Modify: `src/components/documents/documents-modal.tsx`

- [ ] **Step 1: import を差し替え**

先頭 import 群のうち、`use-raw-text` の import を残しつつ、新コンポーネントを取り込む。

1行目付近の `import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";` を以下へ置換（`ReactNode` はインライン部品撤去で不要になるため削除）:

```tsx
import { useEffect, useMemo, useRef, useState } from "react";
```

`import { useRawText, type RawTextState } from "@/hooks/use-raw-text";` を以下へ置換:

```tsx
import { useRawText } from "@/hooks/use-raw-text";
import { OriginalPreview, RawTextContent } from "@/components/documents/original-preview";
```

`import { getFileMeta, getTextPreviewKind, isConvertibleToPdf, isSpreadsheet } from "@/lib/file-types";` を以下へ置換:

```tsx
import { getFileMeta, getTextPreviewKind, isConvertibleToPdf, isImage, isPdf, isSpreadsheet } from "@/lib/file-types";
```

- [ ] **Step 2: インライン定義の3部品と定数を削除**

以下を**まるごと削除**する（現状 24〜126行付近）:

- `const PDF_VIEW_PARAMS = "#toolbar=0&navpanes=0&statusbar=0&view=FitH";` の行
- `function UnsupportedPreview(...) { ... }` ブロック全体
- `function RenderedPdfPreview(...) { ... }` ブロック全体
- `function RawTextContent(...) { ... }` ブロック全体

`RenderedChunk` 関数と `statusLabels` 関数、`type Tab` / `IMG_RE` は**残す**。

- [ ] **Step 3: mime 判定を拡張子 helper へ置換**

`const isPdf = selected?.mime === "application/pdf";` を以下へ置換:

```tsx
  const isPdfFile = selected ? isPdf(selected.filename) : false;
```

`const isImage = selected?.mime.startsWith("image/") ?? false;` の行を**削除**する（リファクタ後、画像分岐は `OriginalPreview` に統合されるため、この変数は不要。`isImage` 関数自体は次の `selectDoc` で使う）。

`selectDoc` 内の `const previewable = d.mime === "application/pdf" || d.mime.startsWith("image/") || isSpreadsheet(d.filename) || isConvertibleToPdf(d.filename);` を以下へ置換:

```tsx
    const previewable = isPdf(d.filename) || isImage(d.filename) || isSpreadsheet(d.filename) || isConvertibleToPdf(d.filename);
```

- [ ] **Step 4: 原本タブ本体を OriginalPreview へ置換**

`tab === "pdf"` の6分岐（現状 484〜514行付近、`{tab === "pdf" && isPdf && (` から `{tab === "pdf" && ... && !textKind && (\n <UnsupportedPreview docId={selected.id} />\n )}` まで）を、次の1ブロックへ置換する:

```tsx
                  {tab === "pdf" && (
                    <OriginalPreview docId={selected.id} filename={selected.filename} framed />
                  )}
```

`tab === "layout"` / `tab === "span"` の分岐は `isPdf` を参照しているため、`isPdfFile` へリネームする:

```tsx
                  {tab === "layout" && isPdfFile && (
                    <iframe title={`${selected.filename} ${t.documents.tabLayout}`} src={`/api/documents/${encodeURIComponent(selected.id)}/layout`} className="h-full w-full border-0" />
                  )}
                  {tab === "span" && isPdfFile && (
                    <iframe title={`${selected.filename} ${t.documents.tabSpan}`} src={`/api/documents/${encodeURIComponent(selected.id)}/span`} className="h-full w-full border-0" />
                  )}
```

- [ ] **Step 5: タブ生成の `isPdf` 参照をリネーム**

タブ配列生成（現状 467行付近）の `...(isPdf ? [["layout", ...], ["span", ...]] ...)` を `isPdfFile` へ置換:

```tsx
                      : ([["pdf", isSheet ? t.documents.tabSpreadsheet : isConvertible ? t.documents.tabConvertedPdf : t.documents.tabOriginal], ...(isPdfFile ? [["layout", t.documents.tabLayout], ["span", t.documents.tabSpan]] as [Tab, string][] : []), ["text", t.documents.tabText], ["html", t.documents.tabHtml], ["images", images.length ? interpolate(t.documents.tabImagesCount, { n: images.length }) : t.documents.tabImages]] as [Tab, string][])
```

（`rich` タブの `RawTextContent`（children 付き）はそのまま。`raw` / `textKind` の利用も維持。）

- [ ] **Step 6: lint と型チェック**

Run: `pnpm lint && pnpm exec tsc --noEmit`
Expected: PASS（未使用 import / 変数なし。`isPdfFile` は layout/span タブ条件で使用。`isImage` 関数は `selectDoc` の `previewable` 判定で使用。`isPdf` 関数は `isPdfFile` と `previewable` で使用。）

> 注: 旧コードの `tab === "pdf" && isImage` 画像分岐は `OriginalPreview` に統合済みのため、`isImage` を格納する変数（旧 `const isImage`）は宣言しない。`isImage` は関数として `selectDoc` 内でのみ呼ぶ。

- [ ] **Step 7: Storybook で modal の表示が現状維持か確認（手動）**

Run: `pnpm build`
Expected: PASS（本番ビルド成功）

- [ ] **Step 8: コミット**

```bash
git add src/components/documents/documents-modal.tsx
git commit -m "refactor: documents-modal の原本表示を OriginalPreview に集約"
```

---

## Task 4: `right-panel.tsx` を全形式原本対応へ変更

**Files:**
- Modify: `src/components/sources/right-panel.tsx`

- [ ] **Step 1: import を追加**

先頭 import 群に追記する:

```tsx
import { OriginalPreview } from "@/components/documents/original-preview";
import { isConvertibleToPdf, isSpreadsheet } from "@/lib/file-types";
```

- [ ] **Step 2: ViewMode を改名し、不要な状態・副作用を削除**

`type ViewMode = "html" | "text" | "pdf";` を以下へ置換:

```tsx
type ViewMode = "html" | "text" | "original";
```

`const [viewMode, setViewMode] = useState<ViewMode>("html");` の直後にある以下2行（`missingRawId` の state とコメント）を**削除**:

```tsx
  // 原本(raw)が消えている（文書削除済み）と判明した文書ID。確認できた時だけ記録する。
  const [missingRawId, setMissingRawId] = useState<string | null>(null);
```

`const active = ...` 以降の次のブロックを置換する。現状:

```tsx
  const active = sources.find((s) => s.id === activeSourceId) || sources[0];
  const isPdf = active ? /\.pdf$/i.test(active.title || active.path) : false;
  const rawUrl = active ? `/api/documents/${encodeURIComponent(active.id)}/raw` : "";
  // ハイライト中セクション → 先頭セクションの順でページを決定（0-based を PDF の 1-based へ）。
  const hlSec = active?.sections.find((s) => s.id === highlightSectionId);
  const pdfPage = ((hlSec?.page ?? active?.sections[0]?.page ?? 0) | 0) + 1;
  // PDF を持たない資料では HTML整形にフォールバックする。
  const effectiveMode: ViewMode = isPdf ? viewMode : (viewMode === "pdf" ? "html" : viewMode);

  // 元PDF表示に切り替わったとき raw の存在を HEAD で確認し、404（削除済み）と判明した文書だけ記録する。
  // 存在する場合は iframe をそのまま出すため、判明するまではフォールバックを出さない（楽観表示）。
  const activeId = active?.id;
  useEffect(() => {
    if (effectiveMode !== "pdf" || !rawUrl || !activeId) return;
    let cancelled = false;
    fetch(rawUrl, { method: "HEAD" })
      .then((r) => { if (!cancelled && !r.ok) setMissingRawId(activeId); })
      .catch(() => { if (!cancelled) setMissingRawId(activeId); });
    return () => { cancelled = true; };
  }, [effectiveMode, rawUrl, activeId]);
  // 「今表示中の文書」が削除済みと判明している場合のみフォールバック。文書切替時は判明するまで false。
  const rawMissing = effectiveMode === "pdf" && !!activeId && missingRawId === activeId;
```

を、以下へ置換:

```tsx
  const active = sources.find((s) => s.id === activeSourceId) || sources[0];
  // ハイライト中セクション → 先頭セクションの順でページを決定（0-based を PDF の 1-based へ）。
  const hlSec = active?.sections.find((s) => s.id === highlightSectionId);
  const pdfPage = ((hlSec?.page ?? active?.sections[0]?.page ?? 0) | 0) + 1;
  // 原本タブは全形式で常設。表計算/Office変換はラベルを変える。
  const fileName = active?.title || active?.path || "";
  const originalLabel = isSpreadsheet(fileName)
    ? t.documents.tabSpreadsheet
    : isConvertibleToPdf(fileName)
    ? t.documents.tabConvertedPdf
    : t.documents.tabOriginal;
  const effectiveMode: ViewMode = viewMode;
```

> 注: `useEffect` の import が他で使われていなければ未使用になる。本ファイルはハイライトスクロール用の `useEffect`（63行付近）を残すため、import は維持する。`useRef` も同様に維持。

- [ ] **Step 3: タブ生成を全形式原本へ変更**

Meta 内のビュー切替（現状 182行付近）:

```tsx
            {([["html", t.sources.viewHtml], ["text", t.sources.viewText], ...(isPdf ? [["pdf", t.sources.viewPdf]] as const : [])] as const).map(([mode, label]) => (
```

を以下へ置換:

```tsx
            {([["html", t.sources.viewHtml], ["text", t.sources.viewText], ["original", originalLabel]] as const).map(([mode, label]) => (
```

- [ ] **Step 4: Body の原本分岐を OriginalPreview へ置換**

Body の `effectiveMode === "pdf"` 分岐（現状 199〜219行付近）を置換する。現状:

```tsx
      <div ref={bodyRef} className={cn("min-w-0 overflow-x-hidden overflow-y-auto", effectiveMode === "pdf" ? "p-0" : "px-5 pb-6 pt-[18px] max-md:px-3.5")}>
        {effectiveMode === "pdf" ? (
          rawMissing ? (
            <div className="grid h-full place-items-center px-6 py-10 text-center">
              <div className="max-w-[320px]">
                <div className="mb-1.5 text-[13px] font-semibold text-fg">{t.sources.deletedTitle}</div>
                <div className="mb-3 text-[12px] leading-[1.6] text-muted">{t.sources.deletedDesc}</div>
                <button
                  onClick={() => setViewMode("html")}
                  className="inline-flex items-center rounded-lg border-[0.5px] border-divider-strong bg-surface px-3 py-1.5 text-[12px] font-medium text-fg hover:bg-surface-2"
                >{t.sources.showCitedText}</button>
              </div>
            </div>
          ) : (
            <iframe
              key={pdfPage}
              src={`${rawUrl}#page=${pdfPage}`}
              title={active.title}
              className="h-full w-full border-0"
            />
          )
        ) : (
```

を以下へ置換:

```tsx
      <div ref={bodyRef} className={cn("min-w-0 overflow-x-hidden overflow-y-auto", effectiveMode === "original" ? "p-0" : "px-5 pb-6 pt-[18px] max-md:px-3.5")}>
        {effectiveMode === "original" ? (
          <OriginalPreview
            docId={active.id}
            filename={active.title || active.path}
            pdfPage={pdfPage}
            onShowParsed={() => setViewMode("html")}
          />
        ) : (
```

（この三項の `: (` 以降、`<>` で始まる html/text 整形ビューは現状維持。）

- [ ] **Step 5: lint と型チェック**

Run: `pnpm lint && pnpm exec tsc --noEmit`
Expected: PASS

> この時点で `t.sources.viewPdf` / `deletedTitle` / `deletedDesc` は right-panel から参照されなくなる（Task 5 で辞書から削除する）。

- [ ] **Step 6: コミット**

```bash
git add src/components/sources/right-panel.tsx
git commit -m "feat: 一次資料パネルの原本タブを全形式対応に標準化"
```

---

## Task 5: 未使用化した sources i18n キーを削除

**Files:**
- Modify: `src/i18n/locales/zh/sources.ts`
- Modify: `src/i18n/locales/ja/sources.ts`

- [ ] **Step 1: 参照が無いことを確認**

Run: `grep -rn "viewPdf\|deletedTitle\|deletedDesc" src --include=*.ts --include=*.tsx | grep -v "locales/"`
Expected: 出力なし（辞書定義以外に参照が残っていない）

- [ ] **Step 2: zh 辞書からキーを削除**

`src/i18n/locales/zh/sources.ts` から以下を削除する:

`viewPdf: "原PDF",` の行（`viewHtml` / `viewText` は残す）。

末尾のコメントと3キーを削除:

```ts
  // Deleted-document fallback (original PDF tab)
  deletedTitle: "该文档已被删除",
  deletedDesc: "原始文件已被删除。引用文本可在「HTML格式」「解析文本」标签页中查看。",
  showCitedText: "查看引用文本",
```

→ `showCitedText` は **残す**（OriginalPreview の `onShowParsed` 導線で使用）。`deletedTitle` / `deletedDesc` の2行とコメントのみ削除する。コメントは `// Show parsed-text fallback action` 等へ更新してもよいが、最小変更なら `// Deleted-document fallback (original PDF tab)` を `// Show cited (parsed) text action` に変更し `showCitedText` だけ残す。

結果イメージ（末尾）:

```ts
  // PanelResizer aria-label
  panelResizerAriaLabel: "调整来源面板宽度",

  // Show cited (parsed) text action（原本欠落/非対応時のフォールバック導線）
  showCitedText: "查看引用文本",
};
```

- [ ] **Step 3: ja 辞書からキーを削除**

`src/i18n/locales/ja/sources.ts` から同様に `viewPdf: "元PDF",` の行と `deletedTitle` / `deletedDesc` の2行（+ コメント整理）を削除し、`showCitedText: "引用テキストを表示",` は残す。

結果イメージ（末尾）:

```ts
  // PanelResizer aria-label
  panelResizerAriaLabel: "一次資料パネルの幅を調整",

  // Show cited (parsed) text action（原本欠落/非対応時のフォールバック導線）
  showCitedText: "引用テキストを表示",
};
```

- [ ] **Step 4: parity テストと型チェック**

Run: `pnpm test src/i18n/dictionary.test.ts && pnpm exec tsc --noEmit`
Expected: PASS（zh/ja のキー対等が保たれ、`ja` の `typeof zhSources` 型注釈もエラーなし）

- [ ] **Step 5: コミット**

```bash
git add src/i18n/locales/zh/sources.ts src/i18n/locales/ja/sources.ts
git commit -m "chore: 一次資料パネルで未使用化した sources キーを削除"
```

---

## Task 6: right-panel ストーリーに全形式の原本タブを追加

原本タブで PDF / docx（変換PDF）/ xlsx（表計算）/ txt（テキスト）/ 非対応 の各表示を
Storybook で確認できるようにする。`/api/documents/:id/raw` 等を MSW でモックする。

**Files:**
- Modify: `src/components/sources/right-panel.stories.tsx`

- [ ] **Step 1: 既存ストーリーの MSW 設定を確認**

Run: `grep -n "msw\|handlers\|parameters\|http\.\|HttpResponse" src/components/sources/right-panel.stories.tsx`
Expected: 既存の MSW ハンドラ記述パターン（`parameters.msw.handlers`）を把握する。なければ他ストーリー（例: `documents-modal` 系）の MSW 記法に合わせる。

> 既存ストーリーに MSW 設定が無い場合は、`src/components/documents/*.stories.tsx` を参照し、`import { http, HttpResponse } from "msw";` と `parameters: { msw: { handlers: [...] } }` の形を踏襲する。

- [ ] **Step 2: 原本タブ表示ストーリーを追記**

`right-panel.stories.tsx` の末尾（`export default meta;` より後、他ストーリーと同じ場所）に追記する。`http` / `HttpResponse` 未 import なら先頭 import に追加する:

```tsx
import { http, HttpResponse } from "msw";
import { within, userEvent, waitFor } from "storybook/test";
```

ストーリー追記:

```tsx
// 原本タブを開いた状態を再現する共通 play: 「原本」系タブをクリックする。
const openOriginalTab = async (canvasElement: HTMLElement) => {
  const canvas = within(canvasElement);
  // 原本タブのラベルは形式により「原本/表計算/変換PDF」。3候補のいずれかを押す。
  const labels = ["原本", "表計算", "変換PDF"];
  await waitFor(async () => {
    for (const label of labels) {
      const btn = canvas.queryByRole("button", { name: label });
      if (btn) { await userEvent.click(btn); return; }
    }
    throw new Error("原本タブが見つからない");
  });
};

const sourceWith = (id: string, title: string) => ({
  id,
  type: "doc" as const,
  title,
  path: title,
  author: "",
  date: "",
  sections: [
    { id: `${id}-s1`, heading: "セクション", body: "本文サンプル。", highlight: true, blockType: "paragraph", page: 0 },
  ],
});

/** 原本タブ: PDF（iframe 表示）。 */
export const OriginalPdf: Story = {
  args: {
    sources: [sourceWith("doc-pdf", "10-report.pdf")],
    activeSourceId: "doc-pdf",
    highlightSectionId: "doc-pdf-s1",
  },
  parameters: {
    msw: { handlers: [http.get("/api/documents/:id/raw", () => new HttpResponse("%PDF-1.4 fake", { headers: { "content-type": "application/pdf" } }))] },
  },
  play: async ({ canvasElement }) => { await openOriginalTab(canvasElement); },
};

/** 原本タブ: テキスト（生テキスト表示）。 */
export const OriginalText: Story = {
  args: {
    sources: [sourceWith("doc-txt", "notes.txt")],
    activeSourceId: "doc-txt",
    highlightSectionId: "doc-txt-s1",
  },
  parameters: {
    msw: { handlers: [http.get("/api/documents/:id/raw", () => new HttpResponse("これは原本テキストです。", { headers: { "content-type": "text/plain" } }))] },
  },
  play: async ({ canvasElement }) => { await openOriginalTab(canvasElement); },
};

/** 原本タブ: 表計算（タブラベルが「表計算」になり SpreadsheetPreview を描画）。 */
export const OriginalSpreadsheet: Story = {
  args: {
    sources: [sourceWith("doc-xlsx", "data.xlsx")],
    activeSourceId: "doc-xlsx",
    highlightSectionId: "doc-xlsx-s1",
  },
  parameters: {
    msw: { handlers: [http.get("/api/documents/:id/raw", () => new HttpResponse(new Uint8Array([0x50, 0x4b]), { headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" } }))] },
  },
  play: async ({ canvasElement }) => { await openOriginalTab(canvasElement); },
};

/** 原本タブ: Office 変換（タブラベルが「変換PDF」、/rendered を待つ）。 */
export const OriginalConvertedPdf: Story = {
  args: {
    sources: [sourceWith("doc-docx", "spec.docx")],
    activeSourceId: "doc-docx",
    highlightSectionId: "doc-docx-s1",
  },
  parameters: {
    msw: {
      handlers: [
        http.get("/api/documents/:id/rendered", () => new HttpResponse("%PDF-1.4 fake", { headers: { "content-type": "application/pdf" } })),
      ],
    },
  },
  play: async ({ canvasElement }) => { await openOriginalTab(canvasElement); },
};
```

> 注: `xlsx` の MSW モックは SheetJS の解析に失敗し `SpreadsheetPreview` がフォールバック（ダウンロード導線）を出す可能性がある。本ストーリーの目的は「原本タブが表計算ラベルで開き、SpreadsheetPreview が描画されること」の確認であり、解析成功までは要求しない。play は openOriginalTab までで十分。

- [ ] **Step 3: Storybook テストの前提を用意**

Run: `pnpm exec playwright install`
Expected: ブラウザがインストールされる（未導入時のみ）。

- [ ] **Step 4: Storybook テストを実行**

Run: `pnpm test:storybook`
Expected: PASS（新規 RightPanel ストーリーの play が緑。`OriginalPdf` 等で原本タブが開く）

> もし `xlsx`/`docx` ストーリーが描画タイミングで不安定なら、play の `openOriginalTab` のみに留め、内部描画完了の assert は入れない（YAGNI）。

- [ ] **Step 5: コミット**

```bash
git add src/components/sources/right-panel.stories.tsx
git commit -m "test: 一次資料パネルの原本タブ（全形式）ストーリーを追加"
```

---

## Task 7: 最終ゲート

**Files:** なし（検証のみ）

- [ ] **Step 1: 全ゲートを実行**

Run:
```bash
pnpm lint && pnpm exec tsc --noEmit && pnpm test && pnpm build
```
Expected: すべて PASS。

> `pnpm test`（vitest unit）のうち DB 統合系は Postgres 稼働が前提。本変更は DB スキーマに触れないため、既存の稼働環境でそのまま緑になること。落ちる場合は DB 起動・マイグレーション適用済みかを確認する（CLAUDE.md「テストの前提」参照）。

- [ ] **Step 2: 手動目視（任意・推奨）**

`pnpm dev` でフルスタックを起動し、チャットで引用を開いて一次資料パネルの「原本」タブが
PDF / 画像 / docx / xlsx / txt それぞれで適切に表示されることを確認する。原本欠落時に
「引用テキストを表示」でフォールバックできることも確認する。

---

## 完了条件

- 一次資料パネルの原本タブが全形式で常設され、形式に応じた原本が表示される。
- modal / panel が同一の `OriginalPreview` を使い、原本描画ロジックの重複が解消されている。
- modal の表示は現状維持。
- `lint` / `tsc` / `unit test` / `build` / `storybook test` が緑。
- 未使用化した `sources.viewPdf` / `deletedTitle` / `deletedDesc` が zh/ja から削除され、parity テスト緑。
