# テキスト系ファイルの整形プレビュー Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** アップロード文書モーダルで md/json/jsonl/txt 等のテキスト系ファイルを `原本 / 解析テキスト / 整形表示` の3タブで表示し、整形表示で見やすくレンダリングする。

**Architecture:** 拡張子で「テキスト系種別」を判定する純関数を `file-types.ts` に追加。テキスト系のときモーダルのタブを3つに切替え、原本ファイル本文を1回だけ取得（`useRawText` フック）して `原本`（生テキスト）と `整形表示`（種別ごとの専用ビュー）で共有する。整形表示は `MarkdownView`（react-markdown）/`JsonView`/`JsonlView`/`PlainTextView` に分岐。JSON の整形・トークン化・jsonl 分割は純関数として切り出しユニットテストする。

**Tech Stack:** Next.js 16 / React 19 / TypeScript / Tailwind / react-markdown 10 + remark-gfm 4 + remark-math 6 + rehype-katex 7 / Vitest（unit=node, storybook=browser）

参照spec: `docs/superpowers/specs/2026-06-02-text-preview-design.md`

---

## File Structure

- `src/lib/file-types.ts`（変更）— `TextPreviewKind` 型と `getTextPreviewKind()` を追加。
- `src/lib/file-types.test.ts`（変更）— 分類のユニットテストを追加。
- `src/lib/json-format.ts`（新規）— `prettyJson` / `tokenizeJson` / `splitJsonl` の純関数。
- `src/lib/json-format.test.ts`（新規）— 上記のユニットテスト。
- `src/hooks/use-raw-text.ts`（新規）— 原本本文を取得する React フック（上限・truncate・キャンセル制御）。
- `src/components/documents/plain-text-view.tsx`（新規）— 等幅プレーンテキスト表示。
- `src/components/documents/plain-text-view.stories.tsx`（新規）
- `src/components/documents/json-view.tsx`（新規）— `JsonView` / `JsonlView`（色分け）。
- `src/components/documents/json-view.stories.tsx`（新規）
- `src/components/documents/markdown-view.tsx`（新規）— react-markdown ベースの整形表示。
- `src/components/documents/markdown-view.stories.tsx`（新規, 描画スモークテスト含む）
- `src/components/documents/documents-modal.tsx`（変更）— タブ切替・原本取得・整形表示の配線。

---

## Task 1: テキスト系種別の判定（getTextPreviewKind）

**Files:**
- Modify: `src/lib/file-types.ts`
- Test: `src/lib/file-types.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/file-types.test.ts` の先頭の import を更新し、ファイル末尾にテストを追加する。

import 行を次に置換:
```ts
import { getTextPreviewKind, isConvertibleToPdf, isSpreadsheet } from "@/lib/file-types";
```

末尾に追加:
```ts
test("getTextPreviewKind: 種別を拡張子で判定（大小無視）", () => {
  const cases: [string, string][] = [
    ["README.md", "markdown"],
    ["NOTES.MARKDOWN", "markdown"],
    ["data.json", "json"],
    ["golden_qa.jsonl", "jsonl"],
    ["stream.ndjson", "jsonl"],
    ["notes.txt", "text"],
    ["server.log", "text"],
    ["table.csv", "text"],
    ["table.tsv", "text"],
    ["conf.yaml", "text"],
    ["conf.yml", "text"],
    ["feed.xml", "text"],
  ];
  for (const [name, kind] of cases) {
    expect(getTextPreviewKind(name), name).toBe(kind);
  }
});

test("getTextPreviewKind: テキスト系でない/拡張子なしは null", () => {
  for (const name of ["a.pdf", "a.png", "a.docx", "a.xlsx", "a.ods", "noext", ""]) {
    expect(getTextPreviewKind(name), name).toBeNull();
  }
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm test src/lib/file-types.test.ts`
Expected: FAIL（`getTextPreviewKind` is not exported / not a function）

- [ ] **Step 3: 実装する**

`src/lib/file-types.ts` の末尾に追加:
```ts
export type TextPreviewKind = "markdown" | "json" | "jsonl" | "text";

// 整形プレビュー対象のテキスト系拡張子 → 種別。表計算(xlsx/xls/ods)は isSpreadsheet が優先するため除外。
const TEXT_PREVIEW_KINDS: Record<string, TextPreviewKind> = {
  md: "markdown", markdown: "markdown",
  json: "json",
  jsonl: "jsonl", ndjson: "jsonl",
  txt: "text", log: "text", csv: "text", tsv: "text",
  yaml: "text", yml: "text", xml: "text",
};

// 文書をブラウザ上で整形表示できるテキスト系種別を拡張子で判定する。非対象は null。
export function getTextPreviewKind(name: string): TextPreviewKind | null {
  const ext = (name.split(".").pop() || "").toLowerCase();
  if (!name.includes(".")) return null;
  return TEXT_PREVIEW_KINDS[ext] ?? null;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm test src/lib/file-types.test.ts`
Expected: PASS（全テスト）

- [ ] **Step 5: コミット**

```bash
git add src/lib/file-types.ts src/lib/file-types.test.ts
git commit -m "feat: テキスト系ファイルの整形プレビュー種別判定を追加"
```

---

## Task 2: 依存ライブラリの追加

**Files:**
- Modify: `package.json` / `pnpm-lock.yaml`（pnpm が自動更新）

- [ ] **Step 1: インストール**

Run:
```bash
pnpm add react-markdown@^10.1.0 remark-gfm@^4.0.1 remark-math@^6.0.0 rehype-katex@^7.0.1
```
Expected: 4パッケージが dependencies に追加される。katex CSS は既に `src/app/layout.tsx` で `import "katex/dist/katex.min.css";` 済みのため追加対応不要。

- [ ] **Step 2: 型・ビルドが壊れていないことを確認**

Run: `pnpm lint`
Expected: エラーなし（警告のみ許容）

- [ ] **Step 3: コミット**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: Markdown 整形表示のため react-markdown 等を追加"
```

---

## Task 3: JSON 整形・トークン化・jsonl 分割の純関数

**Files:**
- Create: `src/lib/json-format.ts`
- Test: `src/lib/json-format.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/json-format.test.ts`:
```ts
import { expect, test } from "vitest";
import { prettyJson, splitJsonl, tokenizeJson } from "@/lib/json-format";

test("prettyJson: 妥当な JSON を 2スペースで整形", () => {
  const r = prettyJson('{"a":1,"b":[true,null]}');
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.text).toBe('{\n  "a": 1,\n  "b": [\n    true,\n    null\n  ]\n}');
});

test("prettyJson: 不正な JSON は ok:false", () => {
  expect(prettyJson("{not json}").ok).toBe(false);
});

test("tokenizeJson: キー/文字列/数値/真偽/null を分類", () => {
  const toks = tokenizeJson('{\n  "a": "x",\n  "b": 1,\n  "c": true,\n  "d": null\n}');
  const typed = toks.filter((t) => t.type !== "text");
  expect(typed).toEqual([
    { type: "key", value: '"a"' },
    { type: "string", value: '"x"' },
    { type: "key", value: '"b"' },
    { type: "number", value: "1" },
    { type: "key", value: '"c"' },
    { type: "boolean", value: "true" },
    { type: "key", value: '"d"' },
    { type: "null", value: "null" },
  ]);
});

test("tokenizeJson: 連結すると元の文字列に戻る", () => {
  const src = '{\n  "n": -2.5e3,\n  "s": "he said \\"hi\\""\n}';
  expect(tokenizeJson(src).map((t) => t.value).join("")).toBe(src);
});

test("splitJsonl: 空行を除いた行配列", () => {
  expect(splitJsonl('{"a":1}\n\n{"b":2}\n')).toEqual(['{"a":1}', '{"b":2}']);
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm test src/lib/json-format.test.ts`
Expected: FAIL（モジュール未作成）

- [ ] **Step 3: 実装する**

`src/lib/json-format.ts`:
```ts
export type JsonTokenType = "key" | "string" | "number" | "boolean" | "null" | "text";
export interface JsonToken {
  type: JsonTokenType;
  value: string;
}

// JSON 文字列を parse → 2スペース整形。失敗時は ok:false。
export function prettyJson(raw: string): { ok: true; text: string } | { ok: false } {
  try {
    return { ok: true, text: JSON.stringify(JSON.parse(raw), null, 2) };
  } catch {
    return { ok: false };
  }
}

// 文字列・真偽・null・数値にマッチ。文字列がコロンに続く場合はキー。
const JSON_TOKEN_RE =
  /"(?:\\.|[^"\\])*"|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;

// 整形済み JSON 文字列を色分け用トークン列へ分解する。text トークン（区切り・空白）も含め、
// 連結すると元の文字列に一致する。
export function tokenizeJson(pretty: string): JsonToken[] {
  const tokens: JsonToken[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  JSON_TOKEN_RE.lastIndex = 0;
  while ((m = JSON_TOKEN_RE.exec(pretty)) !== null) {
    if (m.index > last) tokens.push({ type: "text", value: pretty.slice(last, m.index) });
    const v = m[0];
    let type: JsonTokenType;
    if (v[0] === '"') {
      // 直後（空白を飛ばして）が ':' ならキー。
      type = /^\s*:/.test(pretty.slice(m.index + v.length)) ? "key" : "string";
    } else if (v === "true" || v === "false") {
      type = "boolean";
    } else if (v === "null") {
      type = "null";
    } else {
      type = "number";
    }
    tokens.push({ type, value: v });
    last = m.index + v.length;
  }
  if (last < pretty.length) tokens.push({ type: "text", value: pretty.slice(last) });
  return tokens;
}

// JSONL/NDJSON を空行を除いた行配列へ分割する。
export function splitJsonl(raw: string): string[] {
  return raw.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm test src/lib/json-format.test.ts`
Expected: PASS（全テスト）

- [ ] **Step 5: コミット**

```bash
git add src/lib/json-format.ts src/lib/json-format.test.ts
git commit -m "feat: JSON 整形・トークン化・jsonl 分割の純関数を追加"
```

---

## Task 4: PlainTextView コンポーネント

**Files:**
- Create: `src/components/documents/plain-text-view.tsx`
- Create: `src/components/documents/plain-text-view.stories.tsx`

- [ ] **Step 1: コンポーネントを実装**

`src/components/documents/plain-text-view.tsx`:
```tsx
/** プレーンテキストを等幅・折返しありで表示する。原本タブと整形表示(kind=text)で共用。 */
export function PlainTextView({ text }: { text: string }) {
  if (!text.trim()) {
    return <div className="p-5 text-[12px] text-muted">表示できる内容がありません</div>;
  }
  return (
    <pre className="m-0 whitespace-pre-wrap break-words p-5 font-mono text-[12.5px] leading-[1.7] text-fg-2">
      {text}
    </pre>
  );
}
```

- [ ] **Step 2: ストーリーを実装**

`src/components/documents/plain-text-view.stories.tsx`:
```tsx
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { PlainTextView } from "@/components/documents/plain-text-view";

const meta = {
  title: "Documents/PlainTextView",
  component: PlainTextView,
  tags: ["ai-generated"],
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof PlainTextView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Basic: Story = {
  args: { text: "1行目\n2行目\n  インデント付き\n長い行のサンプルテキストです。" },
  play: async ({ canvas }) => {
    await expect(canvas.getByText(/1行目/)).toBeInTheDocument();
  },
};

export const Empty: Story = {
  args: { text: "   \n  " },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("表示できる内容がありません")).toBeInTheDocument();
  },
};
```

- [ ] **Step 3: ストーリーテストが通ることを確認**

Run: `pnpm test:storybook -t "Documents/PlainTextView"`
Expected: PASS

- [ ] **Step 4: コミット**

```bash
git add src/components/documents/plain-text-view.tsx src/components/documents/plain-text-view.stories.tsx
git commit -m "feat: プレーンテキスト表示コンポーネントを追加"
```

---

## Task 5: JsonView / JsonlView コンポーネント

**Files:**
- Create: `src/components/documents/json-view.tsx`
- Create: `src/components/documents/json-view.stories.tsx`

- [ ] **Step 1: コンポーネントを実装**

`src/components/documents/json-view.tsx`:
```tsx
import { PlainTextView } from "@/components/documents/plain-text-view";
import { prettyJson, splitJsonl, tokenizeJson, type JsonTokenType } from "@/lib/json-format";

const TOKEN_COLOR: Record<JsonTokenType, string> = {
  key: "text-accent",
  string: "text-[#1F7244]",
  number: "text-[#7A5AE0]",
  boolean: "text-[#B83A1F]",
  null: "text-muted",
  text: "text-fg-2",
};

/** 整形済み JSON 文字列を色分けして 1ブロック描画する（共通部品）。 */
function HighlightedJson({ pretty }: { pretty: string }) {
  return (
    <pre className="m-0 overflow-x-auto whitespace-pre rounded-[8px] border-[0.5px] border-divider bg-surface-2 p-3 font-mono text-[12px] leading-[1.6]">
      {tokenizeJson(pretty).map((t, i) => (
        <span key={i} className={TOKEN_COLOR[t.type]}>{t.value}</span>
      ))}
    </pre>
  );
}

/** 単一 JSON。パース不能ならプレーンテキストへフォールバック。 */
export function JsonView({ text }: { text: string }) {
  const r = prettyJson(text);
  if (!r.ok) {
    return (
      <div className="p-5">
        <div className="mb-2 text-[11.5px] text-muted">JSON として解析できませんでした。原文を表示します。</div>
        <PlainTextView text={text} />
      </div>
    );
  }
  return <div className="p-5"><HighlightedJson pretty={r.text} /></div>;
}

/** JSONL/NDJSON。行ごとに整形ブロックを連番付きで描画。パース不能行は生表示。 */
export function JsonlView({ text }: { text: string }) {
  const lines = splitJsonl(text);
  if (!lines.length) {
    return <div className="p-5 text-[12px] text-muted">表示できる内容がありません</div>;
  }
  return (
    <div className="flex flex-col gap-3 p-5">
      {lines.map((line, i) => {
        const r = prettyJson(line);
        return (
          <div key={i}>
            <div className="mb-1 font-mono text-[10.5px] text-muted-2">#{i + 1}</div>
            {r.ok ? (
              <HighlightedJson pretty={r.text} />
            ) : (
              <pre className="m-0 overflow-x-auto whitespace-pre-wrap rounded-[8px] border-[0.5px] border-[rgba(184,58,31,0.4)] bg-surface-2 p-3 font-mono text-[12px] text-fg-2">{line}</pre>
            )}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: ストーリーを実装**

`src/components/documents/json-view.stories.tsx`:
```tsx
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { JsonView, JsonlView } from "@/components/documents/json-view";

const meta = {
  title: "Documents/JsonView",
  tags: ["ai-generated"],
  parameters: { layout: "fullscreen" },
};

export default meta;
type Story = StoryObj;

export const Object_: Story = {
  render: () => <JsonView text='{"name":"康脉","items":[1,2,3],"ok":true,"note":null}' />,
  play: async ({ canvas }) => {
    await expect(canvas.getByText('"name"')).toBeInTheDocument();
    await expect(canvas.getByText("true")).toBeInTheDocument();
  },
};

export const Invalid: Story = {
  render: () => <JsonView text="{これは JSON ではない}" />,
  play: async ({ canvas }) => {
    await expect(canvas.getByText(/解析できませんでした/)).toBeInTheDocument();
  },
};

export const Lines: Story = {
  render: () => <JsonlView text={'{"q":"Q1","a":"A1"}\n{"q":"Q2","a":"A2"}'} />,
  play: async ({ canvas }) => {
    await expect(canvas.getByText("#1")).toBeInTheDocument();
    await expect(canvas.getByText("#2")).toBeInTheDocument();
  },
};
```

- [ ] **Step 3: ストーリーテストが通ることを確認**

Run: `pnpm test:storybook -t "Documents/JsonView"`
Expected: PASS

- [ ] **Step 4: コミット**

```bash
git add src/components/documents/json-view.tsx src/components/documents/json-view.stories.tsx
git commit -m "feat: JSON/JSONL の色分け整形表示コンポーネントを追加"
```

---

## Task 6: MarkdownView コンポーネント

**Files:**
- Create: `src/components/documents/markdown-view.tsx`
- Create: `src/components/documents/markdown-view.stories.tsx`

- [ ] **Step 1: コンポーネントを実装**

`src/components/documents/markdown-view.tsx`:
```tsx
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { SectionImage } from "@/components/sources/rendered-section-body";

// 見出し/段落/リスト/コード/表/区切り/画像をデザイントークンに合わせて装飾。
// 子孫セレクタで一括指定し、react-markdown の components は再利用が要る a/img のみ上書きする。
const MD_PROSE = [
  "text-[13px] leading-[1.7] text-fg-2 [overflow-wrap:anywhere]",
  "[&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:text-[19px] [&_h1]:font-bold [&_h1]:text-fg",
  "[&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-[16px] [&_h2]:font-bold [&_h2]:text-fg",
  "[&_h3]:mt-3 [&_h3]:mb-1.5 [&_h3]:text-[14px] [&_h3]:font-semibold [&_h3]:text-fg",
  "[&_h4]:mt-3 [&_h4]:mb-1 [&_h4]:text-[13px] [&_h4]:font-semibold [&_h4]:text-fg",
  "[&_p]:my-2",
  "[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5",
  "[&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5",
  "[&_li]:my-0.5",
  "[&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-divider-strong [&_blockquote]:pl-3 [&_blockquote]:text-muted",
  "[&_code]:rounded [&_code]:bg-surface-2 [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[12px]",
  "[&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-[8px] [&_pre]:border-[0.5px] [&_pre]:border-divider [&_pre]:bg-surface-2 [&_pre]:p-3",
  "[&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-[12px]",
  "[&_table]:my-3 [&_table]:w-full [&_table]:border-collapse [&_table]:text-[12px]",
  "[&_th]:border-[0.5px] [&_th]:border-divider [&_th]:bg-surface-2 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:font-semibold",
  "[&_td]:border-[0.5px] [&_td]:border-divider [&_td]:px-2 [&_td]:py-1",
  "[&_hr]:my-4 [&_hr]:border-divider",
  "[&_a]:text-accent [&_a]:underline",
].join(" ");

/** Markdown 原文を整形描画する。GFM(表・取消線・タスクリスト)と数式($…$/$$…$$)に対応。
 *  セキュリティ上、生 HTML は描画しない（rehype-raw 不使用）。 */
export function MarkdownView({ text }: { text: string }) {
  if (!text.trim()) {
    return <div className="p-5 text-[12px] text-muted">表示できる内容がありません</div>;
  }
  return (
    <div className={`mx-auto max-w-[820px] p-5 ${MD_PROSE}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
          ),
          img: ({ src, alt }) => <SectionImage src={typeof src === "string" ? src : ""} alt={alt ?? ""} />,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
```

- [ ] **Step 2: `SectionImage` を export する**

`src/components/sources/rendered-section-body.tsx:11` の関数宣言を export 付きに変更する。

変更前:
```tsx
function SectionImage({ src, alt }: { src: string; alt: string }) {
```
変更後:
```tsx
export function SectionImage({ src, alt }: { src: string; alt: string }) {
```

- [ ] **Step 3: ストーリー（描画スモークテスト）を実装**

`src/components/documents/markdown-view.stories.tsx`:
```tsx
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { MarkdownView } from "@/components/documents/markdown-view";

const SAMPLE = `# 見出し1

本文の段落です。**強調** と \`inline code\` を含みます。

## リスト

- 項目A
- 項目B

## コード

\`\`\`
const x = 1;
\`\`\`

## 表

| 列1 | 列2 |
| --- | --- |
| a | b |
`;

const meta = {
  title: "Documents/MarkdownView",
  component: MarkdownView,
  tags: ["ai-generated"],
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof MarkdownView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Basic: Story = {
  args: { text: SAMPLE },
  play: async ({ canvas }) => {
    // 見出しが <h1> として描画される
    await expect(canvas.getByRole("heading", { level: 1, name: "見出し1" })).toBeInTheDocument();
    // リスト項目
    await expect(canvas.getByText("項目A")).toBeInTheDocument();
    // GFM 表のセル
    await expect(canvas.getByRole("table")).toBeInTheDocument();
    // コードブロック
    await expect(canvas.getByText("const x = 1;")).toBeInTheDocument();
  },
};

export const RawHtmlNotExecuted: Story = {
  args: { text: "テキスト <script>alert(1)</script> と <b>raw</b>" },
  play: async ({ canvas }) => {
    // 生 HTML はタグごと無害化され、テキストとして現れる（要素化されない）
    await expect(canvas.getByText(/<b>raw<\/b>/)).toBeInTheDocument();
  },
};
```

- [ ] **Step 4: ストーリーテストが通ることを確認**

Run: `pnpm test:storybook -t "Documents/MarkdownView"`
Expected: PASS（見出し・リスト・表・コードが描画、生 HTML は無害化）

- [ ] **Step 5: 既存テストへの影響がないことを確認**

Run: `pnpm test src/components/sources`
Expected: PASS（`SectionImage` の export 化で既存挙動は不変）

- [ ] **Step 6: コミット**

```bash
git add src/components/documents/markdown-view.tsx src/components/documents/markdown-view.stories.tsx src/components/sources/rendered-section-body.tsx
git commit -m "feat: Markdown 整形表示コンポーネントを追加"
```

---

## Task 7: 原本本文取得フック（useRawText）

**Files:**
- Create: `src/hooks/use-raw-text.ts`

- [ ] **Step 1: フックを実装**

`src/hooks/use-raw-text.ts`:
```ts
"use client";

import { useEffect, useState } from "react";

// 整形プレビューで読み込む原本テキストの上限。超過分は truncate して全文 DL を案内する。
const MAX_TEXT_PREVIEW_BYTES = 2 * 1024 * 1024;

export interface RawTextState {
  status: "idle" | "loading" | "ready" | "error";
  text: string;
  truncated: boolean;
}

// docId のテキスト原本を /api/documents/[id]/raw から取得する。docId=null で idle。
// docId 変更時に再取得し、競合は cancelled フラグで無視する。
export function useRawText(docId: string | null): RawTextState {
  const [state, setState] = useState<RawTextState>({ status: "idle", text: "", truncated: false });

  useEffect(() => {
    if (!docId) {
      setState({ status: "idle", text: "", truncated: false });
      return;
    }
    let cancelled = false;
    setState({ status: "loading", text: "", truncated: false });
    (async () => {
      try {
        const res = await fetch(`/api/documents/${encodeURIComponent(docId)}/raw`);
        if (!res.ok) throw new Error(String(res.status));
        const full = await res.text();
        if (cancelled) return;
        const truncated = full.length > MAX_TEXT_PREVIEW_BYTES;
        setState({
          status: "ready",
          text: truncated ? full.slice(0, MAX_TEXT_PREVIEW_BYTES) : full,
          truncated,
        });
      } catch {
        if (!cancelled) setState({ status: "error", text: "", truncated: false });
      }
    })();
    return () => { cancelled = true; };
  }, [docId]);

  return state;
}
```

- [ ] **Step 2: 型・lint を確認**

Run: `pnpm lint`
Expected: エラーなし

- [ ] **Step 3: コミット**

```bash
git add src/hooks/use-raw-text.ts
git commit -m "feat: 原本テキストを取得する useRawText フックを追加"
```

---

## Task 8: documents-modal への配線

**Files:**
- Modify: `src/components/documents/documents-modal.tsx`

- [ ] **Step 1: import と Tab 型を更新**

`src/components/documents/documents-modal.tsx:7` の直後（SpreadsheetPreview import の下）に追加:
```tsx
import { MarkdownView } from "@/components/documents/markdown-view";
import { JsonView, JsonlView } from "@/components/documents/json-view";
import { PlainTextView } from "@/components/documents/plain-text-view";
import { useRawText } from "@/hooks/use-raw-text";
```

`src/components/documents/documents-modal.tsx:12` の file-types import に `getTextPreviewKind` を追加:
```tsx
import { getFileMeta, getTextPreviewKind, isConvertibleToPdf, isSpreadsheet } from "@/lib/file-types";
```

`src/components/documents/documents-modal.tsx:20` の Tab 型に `"rich"` を追加:
```tsx
type Tab = "pdf" | "layout" | "span" | "text" | "html" | "rich" | "images";
```

- [ ] **Step 2: テキスト系判定と原本取得を組み込む**

`src/components/documents/documents-modal.tsx:125`（`const isSheet = ...` の行）の直後に追加:
```tsx
  // テキスト系（md/json/jsonl/txt 等）は 原本/解析テキスト/整形表示 の3タブに切替える。
  const textKind = selected ? getTextPreviewKind(selected.filename) : null;
  const raw = useRawText(textKind ? selectedId : null);
```

- [ ] **Step 3: 選択時デフォルトタブをテキスト系で整形表示にする**

`src/components/documents/documents-modal.tsx:129-133` の `selectDoc` を次に置換:
```tsx
  const selectDoc = (d: DocumentSummary) => {
    setSelectedId(d.id);
    if (getTextPreviewKind(d.filename)) { setTab("rich"); return; }
    const previewable = d.mime === "application/pdf" || d.mime.startsWith("image/") || isSpreadsheet(d.filename) || isConvertibleToPdf(d.filename);
    setTab(previewable ? "pdf" : "text");
  };
```

- [ ] **Step 4: タブ配列をテキスト系で差し替える**

`src/components/documents/documents-modal.tsx:421-428` のタブ描画ブロック（`<div className="flex min-w-0 gap-1 ...">` 内の `.map`）を次に置換:
```tsx
                  <div className="flex min-w-0 gap-1 overflow-x-auto [scrollbar-width:none]">
                    {(textKind
                      ? ([["pdf", "原本"], ["text", "解析テキスト"], ["rich", "整形表示"]] as [Tab, string][])
                      : ([["pdf", isSheet ? "スプレッドシート" : isConvertible ? "PDF変換原本" : "原本"], ...(isPdf ? [["layout", "レイアウト"], ["span", "Span"]] as [Tab, string][] : []), ["text", "解析テキスト"], ["html", "HTML整形"], ["images", `画像${images.length ? ` (${images.length})` : ""}`]] as [Tab, string][])
                    ).map(([t, label]) => (
                      <button key={t} onClick={() => setTab(t)} className={cn(
                        "shrink-0 rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors",
                        tab === t ? "bg-surface-2 text-fg shadow-e1" : "text-muted hover:text-fg",
                      )}>{label}</button>
                    ))}
                  </div>
```

- [ ] **Step 5: 原本タブのテキスト系分岐を追加し、未対応フォールバックを除外**

`src/components/documents/documents-modal.tsx:463-465`（`{tab === "pdf" && !isPdf && !isImage && !isSheet && !isConvertible && (` のブロック）を次に置換:
```tsx
                  {tab === "pdf" && !isPdf && !isImage && !isSheet && !isConvertible && textKind && (
                    <RawTextContent raw={raw} docId={selected.id} />
                  )}
                  {tab === "pdf" && !isPdf && !isImage && !isSheet && !isConvertible && !textKind && (
                    <UnsupportedPreview docId={selected.id} />
                  )}
```

- [ ] **Step 6: 整形表示タブの描画を追加**

`src/components/documents/documents-modal.tsx` の `{tab === "html" && (...)}` ブロック（478行付近の閉じ `)}` ）の直後に追加:
```tsx
                  {tab === "rich" && (
                    <RawTextContent raw={raw} docId={selected.id}>
                      {textKind === "markdown" && <MarkdownView text={raw.text} />}
                      {textKind === "json" && <JsonView text={raw.text} />}
                      {textKind === "jsonl" && <JsonlView text={raw.text} />}
                      {(textKind === "text" || !textKind) && <PlainTextView text={raw.text} />}
                    </RawTextContent>
                  )}
```

- [ ] **Step 7: import を補い RawTextContent ヘルパコンポーネントを追加**

まず `src/components/documents/documents-modal.tsx:3` の import を変更（`ReactNode` 型を追加）:
```tsx
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
```

`useRawText` の import 行を変更（`RawTextState` 型を追加）:
```tsx
import { useRawText, type RawTextState } from "@/hooks/use-raw-text";
```

`src/components/documents/documents-modal.tsx:88`（`RenderedChunk` 関数の閉じ括弧の直後）に追加:
```tsx
/** 原本テキストの読み込み状態をラップする。ready のとき children（整形ビュー）を表示し、
 *  children 無し（原本タブ）のときは生テキストを PlainTextView で表示する。
 *  loading/error と truncate 注記もここで一元的に出す。 */
function RawTextContent({ raw, docId, children }: { raw: RawTextState; docId: string; children?: ReactNode }) {
  if (raw.status === "loading" || raw.status === "idle") {
    return <div className="grid h-full place-items-center text-[12px] text-muted">読み込み中…</div>;
  }
  if (raw.status === "error") return <UnsupportedPreview docId={docId} />;
  return (
    <div>
      {raw.truncated && (
        <div className="border-b-[0.5px] border-divider bg-accent-soft px-5 py-2 text-[11.5px] text-fg-2">
          ファイルが大きいため冒頭のみ表示しています。全文は「原本ダウンロード」から取得してください。
        </div>
      )}
      {children ?? <PlainTextView text={raw.text} />}
    </div>
  );
}
```

- [ ] **Step 8: lint と型チェック**

Run: `pnpm lint`
Expected: エラーなし（未使用 import 等が無いこと）

- [ ] **Step 9: 既存ユニットテストが壊れていないことを確認**

Run: `pnpm test`
Expected: PASS（全 unit テスト）

- [ ] **Step 10: 動作確認（手動）**

Run: `pnpm dev` を起動し、md / json / jsonl / txt 各1件をアップロード済みの状態でモーダルを開く。
Expected:
- 選択直後に「整形表示」タブが開く。
- md: 見出し・リスト・コード・表が整形描画。
- json: 色分け整形。jsonl: 行ごとに #1, #2 … と整形。txt: 等幅本文。
- 「原本」タブ: 生テキスト。「解析テキスト」タブ: 従来どおりチャンク。
- PDF/画像/Excel/Word 文書は従来のタブ・挙動のまま（回帰なし）。

- [ ] **Step 11: コミット**

```bash
git add src/components/documents/documents-modal.tsx
git commit -m "feat: テキスト系文書を原本/解析/整形表示の3タブで表示"
```

---

## Self-Review メモ（spec 対応確認）

- spec §1 分類 → Task 1。
- spec §2 タブ構成（rich 追加・配列差替・デフォルトタブ）→ Task 8 Step 1,3,4。
- spec §3 原本取得（共有・2MB・truncate・キャンセル）→ Task 7 + Task 8 Step 2,7。
- spec §4 各ビュー（Markdown/Json/Jsonl/PlainText・SectionImage 再利用・rehype-raw 不使用・JSON 失敗フォールバック）→ Task 4,5,6。
- spec §5 依存追加 → Task 2。
- spec エラー/境界（取得失敗・空・大容量・JSON 失敗）→ Task 4,5,7,8。
- spec テスト（分類・JSONハイライタ/jsonl・各ストーリー・MD スモーク）→ Task 1,3,4,5,6。
- spec スコープ外（折りたたみ・言語別ハイライト・csv 表・生HTML）→ 実装しない。

型整合: `getTextPreviewKind`/`TextPreviewKind`、`prettyJson`/`tokenizeJson`/`splitJsonl`/`JsonToken(Type)`、`RawTextState`/`useRawText`、`SectionImage`、各ビューの `{ text }` props は全タスクで一貫。
