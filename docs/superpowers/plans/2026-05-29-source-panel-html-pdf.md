# 一次資料パネル強化（テーブル整形描画 + 元PDF表示）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 一次資料パネルで、テーブルを生HTMLではなく整形された表として描画し、引用元の本来のPDFを「構造化 ⇄ 元PDF」トグルでページジャンプ付き表示できるようにする。

**Architecture:** 引用に `blockType`/`page` を最後まで運ぶ小さな配管を追加し、フロントで (1) 依存ゼロの自前HTMLパーサでテーブルセクションを整形描画、(2) `Document.raw_path` を返す新エンドポイント + Next プロキシ経由で `<iframe>` に元PDFを表示する。

**Tech Stack:** Next.js 16 / React 19 / TypeScript / Tailwind v4 / Drizzle ORM(Postgres) / FastAPI(rag service) / vitest / pytest

---

## File Structure

新規作成:
- `src/components/sources/parse-table-html.ts` — テーブルHTML文字列を正規化モデルへ変換する純粋関数（DOM非依存・SSR安全・テスト可能）
- `src/components/sources/parse-table-html.test.ts` — パーサの unit テスト
- `src/components/sources/html-table.tsx` — 正規化モデルを Tailwind 付きの `<table>` として描画する表示コンポーネント
- `src/app/api/documents/[id]/raw/route.ts` — 元ファイルを rag service から中継する Next プロキシ
- `src/lib/agent/citations.test.ts` — `CitationRegistry` のメタ伝播テスト
- `drizzle/000N_*.sql` — `citations` への `block_type`/`page` カラム追加（`drizzle-kit generate` で自動生成）

変更:
- `src/lib/types.ts` — `SourceSection` に `blockType?`/`page?`
- `src/lib/agent/citations.ts` — `CitationInput`/`toSources` にメタ追加
- `src/lib/agent/tools.ts` — `register()` 呼び出しに `blockType`/`page` を渡す
- `src/lib/db/schema.ts` — `citations` テーブルにカラム追加
- `src/lib/threads.ts` — `SaveInput.citations` 形 + `sourcesFromCitations` の復元にメタ追加
- `src/app/api/chat/route.ts` — 永続化する `cites` にメタ追加
- `src/components/sources/right-panel.tsx` — テーブル整形描画 + 構造化⇄PDFトグル + iframe
- `src/components/workspace/workspace.tsx` — `openSourceTab` を raw エンドポイントへ向ける
- `rag/app/routers/documents.py` — `GET /documents/{id}/raw` 追加
- `rag/tests/test_documents_api.py` — raw エンドポイントのテスト追加

---

## Task 1: SourceSection と CitationRegistry にメタ情報を通す

**Files:**
- Modify: `src/lib/types.ts`（`SourceSection`）
- Modify: `src/lib/agent/citations.ts`（`CitationInput`, `toSources`）
- Test: `src/lib/agent/citations.test.ts`（新規）

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/agent/citations.test.ts` を新規作成:

```ts
import { describe, expect, it } from "vitest";
import { CitationRegistry } from "@/lib/agent/citations";

describe("CitationRegistry メタ伝播", () => {
  it("toSources が blockType と page をセクションに載せる", () => {
    const reg = new CitationRegistry();
    reg.register({
      documentId: "d1", documentTitle: "設計.pdf", chunkId: "c1",
      headingPath: "資格", snippet: "<table><tr><td>A</td></tr></table>",
      blockType: "table", page: 2,
    });
    const sources = reg.toSources();
    expect(sources).toHaveLength(1);
    const sec = sources[0].sections[0];
    expect(sec.blockType).toBe("table");
    expect(sec.page).toBe(2);
  });

  it("メタ未指定でも既定値で動く", () => {
    const reg = new CitationRegistry();
    reg.register({
      documentId: "d1", documentTitle: "x", chunkId: "c1",
      headingPath: "h", snippet: "本文", blockType: "text", page: 0,
    });
    const sec = reg.toSources()[0].sections[0];
    expect(sec.blockType).toBe("text");
    expect(sec.page).toBe(0);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm vitest run src/lib/agent/citations.test.ts`
Expected: FAIL（`CitationInput` に `blockType`/`page` が無く型エラー、または `sec.blockType` が undefined）

- [ ] **Step 3: 型を追加する**

`src/lib/types.ts` の `SourceSection`（`interface SourceSection {` ブロック）に2フィールド追加:

```ts
export interface SourceSection {
  id: string;
  heading: string;
  body: string;
  highlight?: boolean;
  blockType?: string; // "text" | "table" | "equation" | "image"
  page?: number;      // 0-based のページ番号（PDFジャンプ用）
}
```

> 注: 既存の `SourceSection` のフィールド構成（`id`/`heading`/`body`/`highlight?`）は現状のものに合わせること。上記の既存4フィールドが違う場合は、既存分は残したまま `blockType?`/`page?` の2行だけ追加する。

- [ ] **Step 4: CitationInput と toSources を更新**

`src/lib/agent/citations.ts` の `CitationInput` にフィールド追加:

```ts
export interface CitationInput {
  documentId: string;
  documentTitle: string;
  chunkId: string;
  headingPath: string;
  snippet: string;
  blockType: string;
  page: number;
}
```

同ファイルの `toSources()` 内、セクション push 箇所を更新:

```ts
      if (!src.sections.some((s) => s.id === c.chunkId)) {
        src.sections.push({
          id: c.chunkId, heading: c.headingPath, body: c.snippet,
          highlight: true, blockType: c.blockType, page: c.page,
        });
      }
```

- [ ] **Step 5: テストが通ることを確認**

Run: `pnpm vitest run src/lib/agent/citations.test.ts`
Expected: PASS（2 件）

- [ ] **Step 6: コミット**

```bash
git add src/lib/types.ts src/lib/agent/citations.ts src/lib/agent/citations.test.ts
git commit -m "feat: 引用にブロック種別とページ番号を持たせる"
```

---

## Task 2: tools.ts の register 呼び出しにメタを渡す

**Files:**
- Modify: `src/lib/agent/tools.ts`（`retrieve` の register: 現状 `:111-114`、`fetch_document` の register: 現状 `:139-142`）

- [ ] **Step 1: retrieve 側の register を更新**

`src/lib/agent/tools.ts` の `retrieve` 内、`registry.register({...})` を更新:

```ts
          const n = registry.register({
            documentId: c.documentId, documentTitle: c.documentTitle, chunkId: c.chunkId,
            headingPath: c.headingPath, snippet: c.text,
            blockType: c.blockType, page: c.pageStart,
          });
```

> `c` は `RetrievedChunk`（`src/lib/agent/retrieve-client.ts`）で `blockType`/`pageStart` を既に持つ。

- [ ] **Step 2: fetch_document 側の register を更新**

同ファイルの `fetch_document` 内、`registry.register({...})` を更新:

```ts
          const n = registry.register({
            documentId: doc.documentId, documentTitle: doc.documentTitle, chunkId: c.chunkId,
            headingPath: c.headingPath, snippet: c.text,
            blockType: c.blockType, page: c.pageStart,
          });
```

> ここの `c` は `FetchedDocChunk`（`fetchDocument` の戻り）で `blockType`/`pageStart` を持つ。

- [ ] **Step 3: 型チェックと既存テストが通ることを確認**

Run: `pnpm exec tsc --noEmit -p tsconfig.json && pnpm vitest run src/lib/agent/tools.test.ts`
Expected: 型エラー無し、tools.test.ts PASS

- [ ] **Step 4: コミット**

```bash
git add src/lib/agent/tools.ts
git commit -m "feat: ツールの引用登録にブロック種別とページ番号を渡す"
```

---

## Task 3: citations テーブルに block_type / page カラムを追加

**Files:**
- Modify: `src/lib/db/schema.ts`（`citations`）
- Create: `drizzle/000N_*.sql`（generate で自動生成）

- [ ] **Step 1: スキーマにカラム追加**

`src/lib/db/schema.ts` の `citations` 定義（`export const citations = pgTable("citations", {` ブロック）の最後のフィールドの後に追加:

```ts
export const citations = pgTable("citations", {
  id: uuid("id").defaultRandom().primaryKey(),
  messageId: uuid("message_id").notNull().references(() => messages.id, { onDelete: "cascade" }),
  ordinal: integer("ordinal").notNull(),
  documentId: text("document_id").notNull(),
  documentTitle: text("document_title").notNull(),
  chunkId: text("chunk_id").notNull(),
  sectionId: text("section_id").notNull(),
  headingPath: text("heading_path").notNull().default(""),
  snippet: text("snippet").notNull(),
  blockType: text("block_type").notNull().default("text"),
  page: integer("page").notNull().default(0),
});
```

- [ ] **Step 2: マイグレーションを生成**

Run: `pnpm drizzle-kit generate`
Expected: `drizzle/000N_*.sql`（N は連番）が新規生成される。中身に以下2行が含まれること:

```sql
ALTER TABLE "citations" ADD COLUMN "block_type" text DEFAULT 'text' NOT NULL;
ALTER TABLE "citations" ADD COLUMN "page" integer DEFAULT 0 NOT NULL;
```

- [ ] **Step 3: マイグレーションを適用**

Run: `pnpm drizzle-kit migrate`
Expected: エラーなく適用完了（DB が起動している前提。未起動なら `docker compose up -d db` 後に再実行）。

- [ ] **Step 4: 型チェック**

Run: `pnpm exec tsc --noEmit -p tsconfig.json`
Expected: 型エラー無し

- [ ] **Step 5: コミット**

```bash
git add src/lib/db/schema.ts drizzle/
git commit -m "feat: citations にブロック種別とページ列を追加"
```

---

## Task 4: 永続化チェーンにメタを通す（保存・復元）

**Files:**
- Modify: `src/app/api/chat/route.ts`（`cites` 構築: 現状 `:66-79` 付近）
- Modify: `src/lib/threads.ts`（`SaveInput.citations` 形, `sourcesFromCitations`: 現状 `:133-147`）

- [ ] **Step 1: SaveInput の citations 形にフィールド追加**

`src/lib/threads.ts` の `SaveInput` 内 `citations` 配列要素の型に追加:

```ts
  citations: Array<{
    ordinal: number; documentId: string; documentTitle: string;
    chunkId: string; sectionId: string; headingPath: string; snippet: string;
    blockType: string; page: number;
  }>;
```

- [ ] **Step 2: sourcesFromCitations の復元にメタ追加**

同ファイル `sourcesFromCitations` 内のセクション push を更新:

```ts
    if (!src.sections.some((s) => s.id === c.sectionId)) {
      src.sections.push({
        id: c.sectionId, heading: c.headingPath, body: c.snippet,
        highlight: true, blockType: c.blockType, page: c.page,
      });
    }
```

> `c` は `CitationRow`（`citations.$inferSelect`）。Task 3 のカラム追加で `blockType`/`page` を持つ。

- [ ] **Step 3: chat route の cites にメタ追加**

`src/app/api/chat/route.ts` の `done.citationMap` を map して `cites` を作る箇所の return オブジェクトに追加:

```ts
            return {
              ordinal: Number(ord),
              documentId: ref.sourceId,
              documentTitle: src?.title ?? ref.sourceId,
              chunkId: ref.sectionId,
              sectionId: ref.sectionId,
              headingPath: sec?.heading ?? "",
              snippet: sec?.body ?? "",
              blockType: sec?.blockType ?? "text",
              page: sec?.page ?? 0,
            };
```

- [ ] **Step 4: 型チェックと全ユニットテスト**

Run: `pnpm exec tsc --noEmit -p tsconfig.json && pnpm vitest run`
Expected: 型エラー無し、全テスト PASS

- [ ] **Step 5: コミット**

```bash
git add src/lib/threads.ts src/app/api/chat/route.ts
git commit -m "feat: 引用の保存と復元でブロック種別・ページを永続化する"
```

---

## Task 5: テーブルHTMLパーサ（依存ゼロの純粋関数）

**Files:**
- Create: `src/components/sources/parse-table-html.ts`
- Test: `src/components/sources/parse-table-html.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`src/components/sources/parse-table-html.test.ts` を新規作成:

```ts
import { describe, expect, it } from "vitest";
import { parseTableHtml } from "@/components/sources/parse-table-html";

describe("parseTableHtml", () => {
  it("table でない入力は null", () => {
    expect(parseTableHtml("ただのテキスト")).toBeNull();
    expect(parseTableHtml("")).toBeNull();
  });

  it("基本的な行とセルを解析する", () => {
    const m = parseTableHtml("<table><tr><th>名前</th><td>汪</td></tr></table>")!;
    expect(m.rows).toHaveLength(1);
    expect(m.rows[0].cells[0].header).toBe(true);
    expect(m.rows[0].cells[0].lines[0][0].text).toBe("名前");
    expect(m.rows[0].cells[1].header).toBe(false);
    expect(m.rows[0].cells[1].lines[0][0].text).toBe("汪");
  });

  it("colspan/rowspan を読む", () => {
    const m = parseTableHtml('<table><tr><th colspan="3" rowspan="5"><p>資格</p></th></tr></table>')!;
    expect(m.rows[0].cells[0].colspan).toBe(3);
    expect(m.rows[0].cells[0].rowspan).toBe(5);
    expect(m.rows[0].cells[0].lines[0][0].text).toBe("資格");
  });

  it("<br> と </p> で行を分ける", () => {
    const m = parseTableHtml("<table><tr><td>A<br>B</td></tr></table>")!;
    const lines = m.rows[0].cells[0].lines;
    expect(lines).toHaveLength(2);
    expect(lines[0][0].text).toBe("A");
    expect(lines[1][0].text).toBe("B");
  });

  it("u/strong/em の装飾フラグを立てる", () => {
    const m = parseTableHtml("<table><tr><td><u>x</u><strong>y</strong></td></tr></table>")!;
    const segs = m.rows[0].cells[0].lines[0];
    expect(segs[0]).toMatchObject({ text: "x", underline: true });
    expect(segs[1]).toMatchObject({ text: "y", bold: true });
  });

  it("安全な href のみ採用し javascript: は捨てる", () => {
    const ok = parseTableHtml('<table><tr><td><a href="https://e.com">L</a></td></tr></table>')!;
    expect(ok.rows[0].cells[0].lines[0][0].href).toBe("https://e.com");
    const bad = parseTableHtml('<table><tr><td><a href="javascript:alert(1)">L</a></td></tr></table>')!;
    expect(bad.rows[0].cells[0].lines[0][0].href).toBeUndefined();
    expect(bad.rows[0].cells[0].lines[0][0].text).toBe("L");
  });

  it("script/style の中身は描画対象に含めない", () => {
    const m = parseTableHtml("<table><tr><td><script>alert(1)</script>safe</td></tr></table>")!;
    const texts = m.rows[0].cells[0].lines.flat().map((s) => s.text).join("");
    expect(texts).toBe("safe");
  });

  it("HTML エンティティをデコードする", () => {
    const m = parseTableHtml("<table><tr><td>a&amp;b&nbsp;c</td></tr></table>")!;
    expect(m.rows[0].cells[0].lines[0][0].text).toBe("a&b c");
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm vitest run src/components/sources/parse-table-html.test.ts`
Expected: FAIL（`parse-table-html` モジュールが存在しない）

- [ ] **Step 3: パーサを実装**

`src/components/sources/parse-table-html.ts` を新規作成:

```ts
export interface InlineSegment {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  href?: string;
}

export interface TableCell {
  header: boolean;
  colspan: number;
  rowspan: number;
  lines: InlineSegment[][]; // 各行 = セグメント配列
}

export interface TableRow {
  cells: TableCell[];
}

export interface TableModel {
  rows: TableRow[];
}

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X"
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[body] ?? m;
  });
}

function safeHref(raw: string): string | undefined {
  const href = decodeEntities(raw).trim();
  return /^(https?:\/\/|mailto:|\/|#)/i.test(href) ? href : undefined;
}

// セル内 HTML を「行(セグメント配列)の配列」に変換する。
function parseInline(html: string): InlineSegment[][] {
  const lines: InlineSegment[][] = [[]];
  let bold = 0, italic = 0, underline = 0, skip = 0;
  let href: string | undefined;

  const pushText = (text: string) => {
    if (skip > 0) return;
    const decoded = decodeEntities(text);
    if (!decoded) return;
    const seg: InlineSegment = { text: decoded };
    if (bold) seg.bold = true;
    if (italic) seg.italic = true;
    if (underline) seg.underline = true;
    if (href) seg.href = href;
    lines[lines.length - 1].push(seg);
  };
  const newline = () => { lines.push([]); };

  const re = /<\/?([a-zA-Z0-9]+)([^>]*)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const textRun = m[3];
    if (textRun !== undefined) { pushText(textRun); continue; }
    const tag = m[1].toLowerCase();
    const attrs = m[2] || "";
    const closing = m[0][1] === "/";
    if (tag === "br") { newline(); continue; }
    if (tag === "p") { if (closing) newline(); continue; }
    if (tag === "script" || tag === "style") { skip += closing ? -1 : 1; if (skip < 0) skip = 0; continue; }
    if (tag === "strong" || tag === "b") { bold += closing ? -1 : 1; continue; }
    if (tag === "em" || tag === "i") { italic += closing ? -1 : 1; continue; }
    if (tag === "u") { underline += closing ? -1 : 1; continue; }
    if (tag === "a") {
      if (closing) { href = undefined; }
      else {
        const hm = /href\s*=\s*"([^"]*)"|href\s*=\s*'([^']*)'/i.exec(attrs);
        href = hm ? safeHref(hm[1] ?? hm[2] ?? "") : undefined;
      }
      continue;
    }
    // それ以外の許可外タグは無視（テキストは別マッチで拾う）
  }
  const cleaned = lines.filter((l) => l.length > 0);
  return cleaned.length ? cleaned : [[]];
}

function parseCells(rowHtml: string): TableCell[] {
  const cells: TableCell[] = [];
  const re = /<(t[hd])\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rowHtml))) {
    const tag = m[1].toLowerCase();
    const attrs = m[2] || "";
    const span = (name: string): number => {
      const sm = new RegExp(name + '\\s*=\\s*"?(\\d+)"?', "i").exec(attrs);
      const v = sm ? parseInt(sm[1], 10) : 1;
      return Number.isFinite(v) && v > 0 ? v : 1;
    };
    cells.push({
      header: tag === "th",
      colspan: span("colspan"),
      rowspan: span("rowspan"),
      lines: parseInline(m[3]),
    });
  }
  return cells;
}

/** テーブルHTML文字列を正規化モデルへ。table 要素や行が無ければ null。 */
export function parseTableHtml(html: string): TableModel | null {
  if (!html || !/<table[\s>]/i.test(html)) return null;
  const rows: TableRow[] = [];
  const re = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const cells = parseCells(m[1]);
    if (cells.length) rows.push({ cells });
  }
  return rows.length ? { rows } : null;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm vitest run src/components/sources/parse-table-html.test.ts`
Expected: PASS（8 件）

- [ ] **Step 5: コミット**

```bash
git add src/components/sources/parse-table-html.ts src/components/sources/parse-table-html.test.ts
git commit -m "feat: テーブルHTMLの依存ゼロパーサを追加"
```

---

## Task 6: HtmlTable 表示コンポーネント

**Files:**
- Create: `src/components/sources/html-table.tsx`

- [ ] **Step 1: コンポーネントを実装**

`src/components/sources/html-table.tsx` を新規作成:

```tsx
import { parseTableHtml, type InlineSegment } from "@/components/sources/parse-table-html";
import { cn } from "@/lib/utils";

function Seg({ s }: { s: InlineSegment }) {
  const cls = cn(s.bold && "font-semibold", s.italic && "italic", s.underline && "underline");
  if (s.href) {
    return (
      <a href={s.href} target="_blank" rel="noopener noreferrer" className={cn(cls, "text-accent underline")}>
        {s.text}
      </a>
    );
  }
  return cls ? <span className={cls}>{s.text}</span> : <>{s.text}</>;
}

function Lines({ lines }: { lines: InlineSegment[][] }) {
  return (
    <>
      {lines.map((line, i) => (
        <span key={i} className="block">
          {line.map((s, j) => <Seg key={j} s={s} />)}
        </span>
      ))}
    </>
  );
}

/** テーブルHTML文字列を整形描画する。解析できない場合は素のテキストにフォールバック。 */
export function HtmlTable({ html, className }: { html: string; className?: string }) {
  const model = parseTableHtml(html);
  if (!model) {
    return <div className={cn("whitespace-pre-wrap text-[12.5px] leading-[1.65] text-fg-2", className)}>{html}</div>;
  }
  return (
    <div className={cn("overflow-x-auto rounded-[8px] border-[0.5px] border-divider", className)}>
      <table className="w-full border-collapse text-[11.5px] leading-[1.5]">
        <tbody>
          {model.rows.map((row, ri) => (
            <tr key={ri}>
              {row.cells.map((c, ci) => {
                const Tag = c.header ? "th" : "td";
                return (
                  <Tag
                    key={ci}
                    colSpan={c.colspan}
                    rowSpan={c.rowspan}
                    className={cn(
                      "border-[0.5px] border-divider px-2.5 py-1.5 align-top",
                      c.header ? "bg-surface-2 text-left font-semibold text-fg" : "text-fg-2",
                    )}
                  >
                    <Lines lines={c.lines} />
                  </Tag>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: 型チェック**

Run: `pnpm exec tsc --noEmit -p tsconfig.json`
Expected: 型エラー無し

> `cn` は `@/lib/utils` に存在する（`right-panel.tsx` が同じ import を使用）。`text-fg`/`text-fg-2`/`text-accent`/`bg-surface-2`/`border-divider` 等は既存 Tailwind トークン（`right-panel.tsx` で使用済み）。

- [ ] **Step 3: コミット**

```bash
git add src/components/sources/html-table.tsx
git commit -m "feat: テーブル整形描画コンポーネント HtmlTable を追加"
```

---

## Task 7: 一次資料パネルでテーブルセクションを整形描画

**Files:**
- Modify: `src/components/sources/right-panel.tsx`（Body のセクション描画: 現状 `:153-176`）

- [ ] **Step 1: HtmlTable を import**

`src/components/sources/right-panel.tsx` 冒頭の import 群に追加:

```ts
import { HtmlTable } from "@/components/sources/html-table";
```

- [ ] **Step 2: セクション本文の描画を分岐**

`right-panel.tsx` の Body 内、セクションをマップしている箇所の本文描画（現状 `<div className="whitespace-pre-wrap text-[12.5px] leading-[1.65] text-fg-2">{sec.body}</div>`）を以下に置き換える:

```tsx
              <h3 className="mb-1.5 text-[12.5px] font-bold tracking-[-0.005em] text-fg">{sec.heading}</h3>
              {sec.blockType === "table" || sec.body.trimStart().startsWith("<table") ? (
                <HtmlTable html={sec.body} />
              ) : (
                <div className="whitespace-pre-wrap text-[12.5px] leading-[1.65] text-fg-2">{sec.body}</div>
              )}
```

> `<h3>…</h3>` の行は既存のものをそのまま残し、その直後の本文 `<div>` だけを三項分岐に差し替える。

- [ ] **Step 3: 型チェック**

Run: `pnpm exec tsc --noEmit -p tsconfig.json`
Expected: 型エラー無し

- [ ] **Step 4: コミット**

```bash
git add src/components/sources/right-panel.tsx
git commit -m "feat: 一次資料パネルでテーブルを整形描画する"
```

---

## Task 8: rag service に元ファイル配信エンドポイントを追加

**Files:**
- Modify: `rag/app/routers/documents.py`（`GET /documents/{id}/raw` 追加）
- Test: `rag/tests/test_documents_api.py`（テスト追加）

- [ ] **Step 1: 失敗するテストを書く**

`rag/tests/test_documents_api.py` の末尾に追加（既存 import に合わせ、必要なら先頭で `from app.config import settings`、`from app.routers import documents as documents_router` を追加。既存テストの import 形に倣う）:

```python
def test_raw_requires_token(client):
    res = client.get("/documents/d1/raw")
    assert res.status_code == 401


def test_raw_streams_file(client, monkeypatch, tmp_path):
    pdf = tmp_path / "src.pdf"
    pdf.write_bytes(b"%PDF-1.7\n...")

    class _Doc:
        owner_user_id = "u1"
        mime = "application/pdf"
        raw_path = str(pdf)
        filename = "src.pdf"

    class _Session:
        def get(self, model, _id):
            return _Doc()
        def close(self):
            pass

    monkeypatch.setattr(documents_router, "SessionLocal", lambda: _Session())
    res = client.get("/documents/d1/raw?owner_user_id=u1",
                     headers={"x-internal-token": settings.rag_internal_token})
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("application/pdf")
    assert res.content.startswith(b"%PDF")


def test_raw_404_when_not_owner(client, monkeypatch):
    class _Doc:
        owner_user_id = "owner-A"
        mime = "application/pdf"
        raw_path = "/nope.pdf"
        filename = "x.pdf"

    class _Session:
        def get(self, model, _id):
            return _Doc()
        def close(self):
            pass

    monkeypatch.setattr(documents_router, "SessionLocal", lambda: _Session())
    res = client.get("/documents/d1/raw?owner_user_id=intruder-B",
                     headers={"x-internal-token": settings.rag_internal_token})
    assert res.status_code == 404
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd rag && uv run pytest tests/test_documents_api.py -k raw -v`
Expected: FAIL（ルート未定義で 404/405）

- [ ] **Step 3: エンドポイントを実装**

`rag/app/routers/documents.py` の import に追加:

```python
from fastapi.responses import FileResponse
```

同ファイルの末尾（`fetch_document_chunks` の後）に追加:

```python
@router.get("/documents/{document_id}/raw",
            dependencies=[Depends(require_internal_token)])
def get_document_raw(document_id: str, owner_user_id: str):
    session = SessionLocal()
    try:
        doc = session.get(Document, document_id)
        if not doc or doc.owner_user_id != owner_user_id:
            raise HTTPException(status_code=404, detail="document not found")
        raw_path = Path(doc.raw_path)
        mime = doc.mime
        filename = doc.filename
    finally:
        session.close()
    if not raw_path.exists():
        raise HTTPException(status_code=404, detail="file not found")
    return FileResponse(
        str(raw_path),
        media_type=mime or "application/octet-stream",
        filename=filename,
        content_disposition_type="inline",
    )
```

- [ ] **Step 4: テストが通ることを確認**

Run: `cd rag && uv run pytest tests/test_documents_api.py -k raw -v`
Expected: PASS（3 件）

- [ ] **Step 5: コミット**

```bash
git add rag/app/routers/documents.py rag/tests/test_documents_api.py
git commit -m "feat: 元ファイルをinline配信するエンドポイントを追加"
```

---

## Task 9: Next プロキシ route（元ファイル中継）

**Files:**
- Create: `src/app/api/documents/[id]/raw/route.ts`

- [ ] **Step 1: プロキシ route を実装**

`src/app/api/documents/[id]/raw/route.ts` を新規作成（`src/app/api/uploads/[id]/route.ts` の認証パターンに倣う）:

```ts
import { NextResponse } from "next/server";
import { getSessionClaims } from "@/lib/auth";
import { ragFetch } from "@/lib/rag-client";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const claims = await getSessionClaims();
  if (!claims) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const res = await ragFetch(
    `/documents/${encodeURIComponent(id)}/raw?owner_user_id=${encodeURIComponent(claims.sub)}`,
  );
  if (!res.ok || !res.body) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const headers = new Headers();
  headers.set("content-type", res.headers.get("content-type") || "application/octet-stream");
  headers.set("content-disposition", res.headers.get("content-disposition") || "inline");
  const len = res.headers.get("content-length");
  if (len) headers.set("content-length", len);
  return new NextResponse(res.body, { status: 200, headers });
}
```

- [ ] **Step 2: 型チェック**

Run: `pnpm exec tsc --noEmit -p tsconfig.json`
Expected: 型エラー無し

> `getSessionClaims` の import パスと `claims.sub` の使い方は `src/app/api/uploads/[id]/route.ts` と同一。差異があればそちらに合わせること。

- [ ] **Step 3: コミット**

```bash
git add src/app/api/documents/
git commit -m "feat: 元ファイルを中継するNextプロキシrouteを追加"
```

---

## Task 10: パネルに構造化⇄PDFトグルとiframeを追加

**Files:**
- Modify: `src/components/sources/right-panel.tsx`（モード state, トグル UI, PDF iframe）
- Modify: `src/components/workspace/workspace.tsx`（`openSourceTab` を raw URL へ）

- [ ] **Step 1: モード state とヘルパを追加**

`src/components/sources/right-panel.tsx` 冒頭の `import { useEffect, useRef } from "react";` を更新:

```ts
import { useEffect, useRef, useState } from "react";
```

`RightPanel` 本体の `const active = sources.find(...)` の直後に追加:

```ts
  const [viewMode, setViewMode] = useState<"structured" | "pdf">("structured");
  const isPdf = active ? /\.pdf$/i.test(active.title || active.path) : false;
  const rawUrl = active ? `/api/documents/${encodeURIComponent(active.id)}/raw` : "";
  // ハイライト中セクション → 先頭セクションの順でページを決定（0-based を PDF の 1-based へ）。
  const hlSec = active?.sections.find((s) => s.id === highlightSectionId);
  const pdfPage = ((hlSec?.page ?? active?.sections[0]?.page ?? 0) | 0) + 1;

  // PDF を持たない資料へ切り替わったら構造化に戻す。
  useEffect(() => {
    if (!isPdf) setViewMode("structured");
  }, [activeSourceId, isPdf]);
```

> `active` が undefined の早期 return より前に上記フックを置くこと（フックの数を不変に保つため）。`const active = ...` と早期 `if (!active)` の間に挿入する。

- [ ] **Step 2: トグル UI を追加**

`right-panel.tsx` の Meta セクション（`{/* Meta */}` の `<div>…パス…</div>`）の直後に、PDF があるときだけ出すトグルを追加:

```tsx
      {isPdf && (
        <div className="flex gap-1 border-b-[0.5px] border-divider bg-surface-2 px-4 pb-2.5 max-md:px-3.5">
          {([["structured", "構造化"], ["pdf", "元PDF"]] as const).map(([mode, label]) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              className={cn(
                "rounded-[7px] px-2.5 py-1 text-[11.5px] font-medium",
                viewMode === mode ? "bg-surface text-fg shadow-e1" : "text-fg-2 hover:bg-divider",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      )}
```

- [ ] **Step 3: Body を PDF / 構造化で出し分け**

`right-panel.tsx` の Body コンテナ（`<div ref={bodyRef} className="overflow-y-auto …">`）の中身を、PDF モード時は iframe に差し替える。Body の開始タグを次のように変更し、

```tsx
      <div ref={bodyRef} className={cn("overflow-y-auto", viewMode === "pdf" ? "p-0" : "px-5 pb-6 pt-[18px] max-md:px-3.5")}>
        {viewMode === "pdf" ? (
          <iframe
            key={pdfPage}
            src={`${rawUrl}#page=${pdfPage}`}
            title={active.title}
            className="h-full w-full border-0"
          />
        ) : (
          <>
```

既存の Body 中身（`<div className="mb-4 flex items-start gap-2.5">…</div>` と `active.sections.map(...)`）をこの `<>` の中に入れ、Body コンテナを閉じる直前で `</>` と `)}` を追加して閉じる:

```tsx
          </>
        )}
      </div>
```

> 既存の Body 中身（見出しブロックと `active.sections.map(...)`）は一字一句変えず、`<>` … `</>` で囲うだけ。

- [ ] **Step 4: ヘッダの「新しいタブで開く」を raw URL に**

`src/components/workspace/workspace.tsx` の `openSourceTab` 関数本体を、合成HTMLの生成をやめて元ファイルを直接開く実装に置き換える:

```ts
  const openSourceTab = (src: Source) => {
    const win = window.open(`/api/documents/${encodeURIComponent(src.id)}/raw`, "_blank");
    if (!win) push("ポップアップがブロックされています", "error");
  };
```

- [ ] **Step 5: 型チェックと全ユニットテスト**

Run: `pnpm exec tsc --noEmit -p tsconfig.json && pnpm vitest run`
Expected: 型エラー無し、全テスト PASS

- [ ] **Step 6: 手動確認（dev サーバ）**

Run: `pnpm dev`（別ターミナル）
確認手順:
1. PDF をアップロードして質問し、回答にテーブル由来の引用が出る資料を開く。
2. パネルでテーブルが罫線付きの表として描画されること。
3. `.pdf` 資料で「構造化 / 元PDF」トグルが出ること。「元PDF」でPDFが表示され、引用箇所のページ付近が開くこと。
4. 非PDF資料ではトグルが出ないこと、ヘッダの「新しいタブで開く」で元ファイルが開くこと。

- [ ] **Step 7: コミット**

```bash
git add src/components/sources/right-panel.tsx src/components/workspace/workspace.tsx
git commit -m "feat: 一次資料パネルに構造化⇄元PDFトグルとPDF表示を追加"
```

---

## Self-Review メモ

- **Spec カバレッジ:** A(メタ伝播)=Task1,2,4 / DBマイグレーション=Task3 / B(テーブル整形)=Task5,6,7 / C(PDF配信)=Task8,9 / D(トグル+iframe)=Task10。後方互換フォールバック=Task7 のヒューリスティック。全節カバー。
- **依存ゼロ:** パーサは DOMParser を使わず正規表現ベースの純粋関数。SSR でも安全。`dangerouslySetInnerHTML` 不使用。
- **セキュリティ:** href は allowlist、script/style 中身は破棄、属性は colspan/rowspan/href のみ参照。
- **型整合:** `blockType`/`page` は CitationInput → SourceSection → CitationRow → SaveInput まで一貫。`parseTableHtml`/`TableModel`/`InlineSegment` の名称は Task5/6 で一致。
- **既知の前提:** ブラウザ標準 PDF ビューアの `#page=` は環境差あり（許容）。元ファイルが PDF 以外のときトグルは非表示。
