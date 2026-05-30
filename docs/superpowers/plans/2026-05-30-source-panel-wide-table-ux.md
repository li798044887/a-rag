# 一次資料パネル 幅広表UX改善 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 一次資料パネルの幅広表を「横スクロール可と分かる表示＋デスクトップで幅をドラッグ調整＋全画面拡大」で見やすくする。

**Architecture:** 検出ロジック（オーバーフロー判定・幅クランプ）を純関数に切り出して node ユニットテストで担保し、DOM 挙動（フェード表示・全画面シート・リサイズ）は Storybook の play 関数（ブラウザ実行）で検証する。表示は既存トークン（`bg-2` / `surface` / `divider-strong`）とモーダルの `ar-scale-in` アニメを流用する。

**Tech Stack:** Next.js + React + Tailwind v4（globals.css のトークン）、Vitest（unit: node / storybook: chromium ブラウザ）、Storybook 10。

**Commands:**
- node ユニット: `pnpm test`（`vitest --project unit run`、対象 `src/**/*.test.ts`）
- Story ブラウザテスト: `pnpm test:storybook`
- Lint: `pnpm lint`

---

## File Structure

- `src/components/sources/use-overflow.ts`（新規）— 横オーバーフロー検出。純関数 `computeOverflow` ＋ フック `useOverflow`。
- `src/components/sources/use-overflow.test.ts`（新規）— `computeOverflow` の node ユニットテスト。
- `src/components/workspace/panel-width.ts`（新規）— パネル幅の定数・クランプ純関数・localStorage 永続化。
- `src/components/workspace/panel-width.test.ts`（新規）— `clampPanelWidth` の node ユニットテスト。
- `src/components/sources/table-sheet.tsx`（新規）— 表の全画面シート（モーダル）。
- `src/components/sources/panel-resizer.tsx`（新規）— パネル左境界のドラッグ／キーボード・リサイズハンドル。
- `src/components/sources/panel-resizer.stories.tsx`（新規）— リサイザのブラウザテスト。
- `src/components/sources/html-table.tsx`（変更）— スクロール・アフォーダンス、拡大ボタン、シート起動。
- `src/components/sources/html-table.stories.tsx`（変更）— 幅広表のオーバーフロー／拡大シートのブラウザテスト。
- `src/components/sources/right-panel.tsx`（変更）— `resizable` 時に `PanelResizer` を描画、ルートを `relative` 化。
- `src/components/workspace/workspace.tsx`（変更）— グリッド幅を `--rp-width` 可変化、状態＋永続化、`RightPanel` への受け渡し。

---

## Task 1: オーバーフロー検出（純関数＋フック）

**Files:**
- Create: `src/components/sources/use-overflow.ts`
- Test: `src/components/sources/use-overflow.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`src/components/sources/use-overflow.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { computeOverflow } from "@/components/sources/use-overflow";

describe("computeOverflow", () => {
  it("はみ出しが無ければ両方 false", () => {
    expect(computeOverflow({ scrollLeft: 0, scrollWidth: 300, clientWidth: 300 })).toEqual({ left: false, right: false });
  });

  it("先頭ではみ出しがあれば right のみ true", () => {
    expect(computeOverflow({ scrollLeft: 0, scrollWidth: 500, clientWidth: 300 })).toEqual({ left: false, right: true });
  });

  it("中間までスクロールすると両側 true", () => {
    expect(computeOverflow({ scrollLeft: 100, scrollWidth: 500, clientWidth: 300 })).toEqual({ left: true, right: true });
  });

  it("末尾までスクロールすると left のみ true", () => {
    expect(computeOverflow({ scrollLeft: 200, scrollWidth: 500, clientWidth: 300 })).toEqual({ left: true, right: false });
  });

  it("1px 未満の端数は許容する", () => {
    expect(computeOverflow({ scrollLeft: 0.5, scrollWidth: 300.4, clientWidth: 300 })).toEqual({ left: false, right: false });
  });
});
```

- [ ] **Step 2: テストが落ちることを確認**

Run: `pnpm test -- use-overflow`
Expected: FAIL（`computeOverflow` 未定義 / モジュール解決エラー）

- [ ] **Step 3: 実装する**

`src/components/sources/use-overflow.ts`:

```ts
"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface OverflowState {
  left: boolean;
  right: boolean;
}

/** スクロール量から左右に「続き」があるかを判定する。端数は 1px まで許容。 */
export function computeOverflow(m: {
  scrollLeft: number;
  scrollWidth: number;
  clientWidth: number;
}): OverflowState {
  const EPS = 1;
  const max = m.scrollWidth - m.clientWidth;
  return {
    left: m.scrollLeft > EPS,
    right: m.scrollLeft < max - EPS,
  };
}

/**
 * 横スクロール要素の左右オーバーフロー状態を返すフック。
 * scroll とサイズ変化（ResizeObserver）の両方で再計測する。
 */
export function useOverflow<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [overflow, setOverflow] = useState<OverflowState>({ left: false, right: false });

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setOverflow(computeOverflow(el));
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", measure);
      ro.disconnect();
    };
  }, [measure]);

  return { ref, overflow, measure };
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm test -- use-overflow`
Expected: PASS（5 件）

- [ ] **Step 5: コミット**

```bash
git add src/components/sources/use-overflow.ts src/components/sources/use-overflow.test.ts
git commit -m "feat: 表の横オーバーフロー検出フックを追加"
```

---

## Task 2: パネル幅の計算と永続化

**Files:**
- Create: `src/components/workspace/panel-width.ts`
- Test: `src/components/workspace/panel-width.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`src/components/workspace/panel-width.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { clampPanelWidth, RP_WIDTH_DEFAULT, RP_WIDTH_MIN } from "@/components/workspace/panel-width";

describe("clampPanelWidth", () => {
  it("範囲内はそのまま（小数は丸める）", () => {
    expect(clampPanelWidth(500.4, 2000)).toBe(500);
  });

  it("最小値未満は最小値に丸める", () => {
    expect(clampPanelWidth(100, 2000)).toBe(RP_WIDTH_MIN);
  });

  it("最大値超は最大値(720)に丸める", () => {
    expect(clampPanelWidth(900, 2000)).toBe(720);
  });

  it("狭いビューポートでは 50% で頭打ち", () => {
    expect(clampPanelWidth(500, 800)).toBe(400);
  });

  it("ビューポートが極端に狭く上限<下限なら上限を優先", () => {
    expect(clampPanelWidth(500, 600)).toBe(300);
  });

  it("既定値は 420", () => {
    expect(RP_WIDTH_DEFAULT).toBe(420);
  });
});
```

- [ ] **Step 2: テストが落ちることを確認**

Run: `pnpm test -- panel-width`
Expected: FAIL（`clampPanelWidth` 未定義）

- [ ] **Step 3: 実装する**

`src/components/workspace/panel-width.ts`:

```ts
export const RP_WIDTH_DEFAULT = 420;
export const RP_WIDTH_MIN = 360;
export const RP_WIDTH_MAX = 720;

const STORAGE_KEY = "arag.rp-width";

/** 幅を [最小, min(最大, ビューポート50%)] に丸める。上限が下限を割る場合は上限を優先。 */
export function clampPanelWidth(px: number, viewportWidth: number): number {
  const max = Math.min(RP_WIDTH_MAX, Math.round(viewportWidth * 0.5));
  const lo = Math.min(RP_WIDTH_MIN, max);
  return Math.max(lo, Math.min(max, Math.round(px)));
}

/** 永続化された幅を読む。未保存・不正・SSR 時は既定値。 */
export function loadPanelWidth(): number {
  if (typeof window === "undefined") return RP_WIDTH_DEFAULT;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) ? clampPanelWidth(n, window.innerWidth) : RP_WIDTH_DEFAULT;
}

/** 幅を永続化する。 */
export function savePanelWidth(px: number): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, String(px));
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm test -- panel-width`
Expected: PASS（6 件）

- [ ] **Step 5: コミット**

```bash
git add src/components/workspace/panel-width.ts src/components/workspace/panel-width.test.ts
git commit -m "feat: パネル幅のクランプと永続化ユーティリティを追加"
```

---

## Task 3: 表の全画面シート

**Files:**
- Create: `src/components/sources/table-sheet.tsx`

DOM 挙動は Task 4 の Story で結合テストする（このタスクはコンポーネント追加のみ）。

- [ ] **Step 1: 実装する**

`src/components/sources/table-sheet.tsx`:

```tsx
"use client";

import { useEffect } from "react";

/** 表を全画面で広く閲覧するためのモーダルシート。Esc / 背景タップ / ✕ で閉じる。 */
export function TableSheet({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="表の全画面表示"
      onClick={onClose}
      className="fixed inset-0 z-[120] flex animate-[ar-scale-in_0.15s_ease-out] flex-col bg-[rgba(20,18,15,0.45)] p-4 backdrop-blur-[4px] max-md:p-0"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="mx-auto flex min-h-0 w-full max-w-[1100px] flex-1 flex-col overflow-hidden rounded-[14px] border-[0.5px] border-divider-strong bg-surface shadow-e3 max-md:rounded-none"
      >
        <div className="flex h-12 shrink-0 items-center justify-between border-b-[0.5px] border-divider px-4">
          <span className="text-[13px] font-semibold text-fg">表</span>
          <button
            type="button"
            onClick={onClose}
            title="閉じる"
            className="grid h-7 w-7 place-items-center rounded-md text-muted hover:bg-divider hover:text-fg"
          >
            <svg viewBox="0 0 16 16" width="13" height="13">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4">{children}</div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 型・lint チェック**

Run: `pnpm lint`
Expected: エラーなし（新規ファイルに警告が出ないこと）

- [ ] **Step 3: コミット**

```bash
git add src/components/sources/table-sheet.tsx
git commit -m "feat: 表の全画面シートコンポーネントを追加"
```

---

## Task 4: HtmlTable にスクロール可視化・拡大ボタンを組み込む

**Files:**
- Modify: `src/components/sources/html-table.tsx`
- Modify: `src/components/sources/html-table.stories.tsx`

- [ ] **Step 1: HtmlTable を書き換える**

`src/components/sources/html-table.tsx` 全体を次に置き換える:

```tsx
"use client";

import { useState } from "react";
import { parseTableHtml, type InlineSegment } from "@/components/sources/parse-table-html";
import { useOverflow } from "@/components/sources/use-overflow";
import { TableSheet } from "@/components/sources/table-sheet";
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
  const { ref, overflow } = useOverflow<HTMLDivElement>();
  const [sheetOpen, setSheetOpen] = useState(false);

  if (!model) {
    return <div className={cn("whitespace-pre-wrap text-[12.5px] leading-[1.65] text-fg-2", className)}>{html}</div>;
  }

  const wide = overflow.left || overflow.right;

  const table = (
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
  );

  return (
    <div className={cn("group/tbl relative", className)}>
      <div
        ref={ref}
        data-overflow-left={overflow.left}
        data-overflow-right={overflow.right}
        className="overflow-x-auto rounded-[8px] border-[0.5px] border-divider"
      >
        {table}
      </div>

      {/* 左に続きがある合図（フェード） */}
      {overflow.left && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-px left-px w-8 rounded-l-[8px] bg-gradient-to-r from-bg-2 to-transparent"
        />
      )}

      {/* 右に続きがある合図（フェード＋シェブロン） */}
      {overflow.right && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-px right-px flex w-12 items-center justify-end rounded-r-[8px] bg-gradient-to-l from-bg-2 via-bg-2 to-transparent pr-1"
        >
          <svg viewBox="0 0 16 16" width="12" height="12" className="text-muted">
            <path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      )}

      {/* 全画面拡大（デスクトップはホバー表示、モバイルは常時表示） */}
      {wide && (
        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          title="表を全画面で開く"
          className="absolute right-1.5 top-1.5 z-[1] inline-flex h-6 items-center gap-1 rounded-[6px] border-[0.5px] border-divider-strong bg-surface/90 px-1.5 text-[10.5px] font-medium text-fg-2 opacity-0 backdrop-blur-sm transition-opacity hover:bg-surface group-hover/tbl:opacity-100 focus-visible:opacity-100 max-md:opacity-100"
        >
          <svg viewBox="0 0 16 16" width="11" height="11">
            <path d="M6 2H2v4M10 14h4v-4M2 2l5 5M14 14l-5-5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          拡大
        </button>
      )}

      {sheetOpen && <TableSheet onClose={() => setSheetOpen(false)}>{table}</TableSheet>}
    </div>
  );
}
```

- [ ] **Step 2: 既存の Story が壊れていないことを確認**

Run: `pnpm test:storybook -- html-table`
Expected: 既存 `Default` が PASS

- [ ] **Step 3: 幅広表のブラウザテストを追加（失敗想定）**

`src/components/sources/html-table.stories.tsx` を次に置き換える:

```tsx
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor } from "storybook/test";
import { HtmlTable } from "@/components/sources/html-table";

const sampleHtml = `
<table>
  <thead>
    <tr><th>四半期</th><th>売上 (百万円)</th><th>前年比</th></tr>
  </thead>
  <tbody>
    <tr><td>2026 Q1</td><td>1,240</td><td>+12%</td></tr>
    <tr><td>2026 Q2</td><td>1,380</td><td>+18%</td></tr>
    <tr><td>2026 Q3</td><td>1,510</td><td>+9%</td></tr>
  </tbody>
</table>`;

// 列数が多くパネル幅に収まらない表（はみ出しケース）。
const wideHtml = `
<table>
  <thead>
    <tr><th>設備ID</th><th>振動</th><th>温度</th><th>電流</th><th>暫定判定</th><th>注記コード</th><th>部品到着予定</th><th>備考メモ欄</th></tr>
  </thead>
  <tbody>
    <tr><td>MX-11</td><td>0.42</td><td>0.55</td><td>0.37</td><td>監視継続</td><td>N1</td><td>在庫あり即時</td><td>特記事項なし</td></tr>
    <tr><td>MX-17</td><td>0.91</td><td>0.88</td><td>0.74</td><td>停止候補</td><td>N9</td><td>翌営業日AM到着</td><td>夜間停止枠まで継続</td></tr>
  </tbody>
</table>`;

const meta = {
  title: "Sources/HtmlTable",
  component: HtmlTable,
  tags: ["ai-generated"],
  parameters: { layout: "padded" },
  args: { html: sampleHtml },
} satisfies Meta<typeof HtmlTable>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** 幅に収まらない表。右フェードと拡大ボタンが出て、シートが開閉できる。 */
export const WideOverflow: Story = {
  args: { html: wideHtml },
  decorators: [
    (Story) => (
      <div style={{ width: 280 }}>
        <Story />
      </div>
    ),
  ],
  play: async ({ canvas, userEvent }) => {
    // 検出は scroll/ResizeObserver 後に反映されるため待つ。
    const scroller = canvas.getByRole("table").closest("[data-overflow-right]")!;
    await waitFor(() => expect(scroller.getAttribute("data-overflow-right")).toBe("true"));

    // 拡大ボタン → シートが開く。
    await userEvent.click(canvas.getByRole("button", { name: /拡大/ }));
    const dialog = await canvas.findByRole("dialog");
    await expect(dialog).toBeInTheDocument();

    // Esc で閉じる。
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(canvas.queryByRole("dialog")).toBeNull());
  },
};
```

- [ ] **Step 4: ブラウザテストが通ることを確認**

Run: `pnpm test:storybook -- html-table`
Expected: `Default` と `WideOverflow` が PASS

- [ ] **Step 5: コミット**

```bash
git add src/components/sources/html-table.tsx src/components/sources/html-table.stories.tsx
git commit -m "feat: 幅広表に横スクロール可視化と全画面拡大を追加"
```

---

## Task 5: パネル・リサイザ（ドラッグ／キーボード）

**Files:**
- Create: `src/components/sources/panel-resizer.tsx`
- Create: `src/components/sources/panel-resizer.stories.tsx`

- [ ] **Step 1: 実装する**

`src/components/sources/panel-resizer.tsx`:

```tsx
"use client";

import { useRef } from "react";
import { clampPanelWidth, RP_WIDTH_DEFAULT, RP_WIDTH_MAX, RP_WIDTH_MIN } from "@/components/workspace/panel-width";

/**
 * パネル左境界に置く幅調整ハンドル。ハンドルは左にあるので
 * 左ドラッグ／ArrowLeft で広がり、右ドラッグ／ArrowRight で狭まる。
 * ダブルクリックで既定幅に戻す。
 */
export function PanelResizer({ width, onWidth }: { width: number; onWidth: (px: number) => void }) {
  const drag = useRef<{ startX: number; startW: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { startX: e.clientX, startW: width };
    document.body.style.userSelect = "none";
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const next = clampPanelWidth(drag.current.startW + (drag.current.startX - e.clientX), window.innerWidth);
    onWidth(next);
  };

  const end = (e: React.PointerEvent) => {
    if (!drag.current) return;
    drag.current = null;
    document.body.style.userSelect = "";
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 48 : 16;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      onWidth(clampPanelWidth(width + step, window.innerWidth));
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      onWidth(clampPanelWidth(width - step, window.innerWidth));
    }
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="一次資料パネルの幅を調整"
      aria-valuenow={width}
      aria-valuemin={RP_WIDTH_MIN}
      aria-valuemax={RP_WIDTH_MAX}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onKeyDown={onKeyDown}
      onDoubleClick={() => onWidth(RP_WIDTH_DEFAULT)}
      className="group/resz absolute left-0 top-0 z-[2] h-full w-2 -translate-x-1/2 cursor-col-resize touch-none select-none"
    >
      <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors group-hover/resz:bg-accent group-focus-visible/resz:bg-accent" />
    </div>
  );
}
```

- [ ] **Step 2: ブラウザテストを書く（失敗想定）**

`src/components/sources/panel-resizer.stories.tsx`:

```tsx
import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor } from "storybook/test";
import { PanelResizer } from "@/components/sources/panel-resizer";

function Harness() {
  const [w, setW] = useState(420);
  return (
    <div style={{ position: "relative", height: 200, width: 480, border: "1px solid #ccc" }}>
      <PanelResizer width={w} onWidth={setW} />
      <span data-testid="w">{w}</span>
    </div>
  );
}

const meta = {
  title: "Sources/PanelResizer",
  component: Harness,
  tags: ["ai-generated"],
  parameters: { layout: "centered" },
} satisfies Meta<typeof Harness>;

export default meta;
type Story = StoryObj<typeof meta>;

/** ArrowLeft で広がり、ダブルクリックで既定幅に戻る。 */
export const Keyboard: Story = {
  play: async ({ canvas, userEvent }) => {
    const sep = canvas.getByRole("separator");
    sep.focus();
    await userEvent.keyboard("{ArrowLeft}");
    await waitFor(() => expect(canvas.getByTestId("w").textContent).toBe("436"));

    await userEvent.dblClick(sep);
    await waitFor(() => expect(canvas.getByTestId("w").textContent).toBe("420"));
  },
};
```

- [ ] **Step 3: テストが落ちる→通ることを確認**

Run: `pnpm test:storybook -- panel-resizer`
Expected: `Keyboard` が PASS（ブラウザ幅は十分広く、436 はクランプ上限 720 未満）

- [ ] **Step 4: コミット**

```bash
git add src/components/sources/panel-resizer.tsx src/components/sources/panel-resizer.stories.tsx
git commit -m "feat: パネル幅のドラッグ／キーボード調整ハンドルを追加"
```

---

## Task 6: RightPanel と Workspace に配線する

**Files:**
- Modify: `src/components/sources/right-panel.tsx`
- Modify: `src/components/workspace/workspace.tsx`

- [ ] **Step 1: RightPanel に props を追加し、リサイザを描画する**

`src/components/sources/right-panel.tsx` の import に追加:

```tsx
import { PanelResizer } from "@/components/sources/panel-resizer";
```

`Props` インターフェースに追加（末尾）:

```tsx
  resizable?: boolean;
  panelWidth?: number;
  onResizeWidth?: (px: number) => void;
```

関数シグネチャを次に変更（`onAction` の後に分割代入を追加）:

```tsx
export function RightPanel({ sources, citationMap, contextQuery, activeSourceId, highlightSectionId, onSetActive, onClose, onAction, resizable, panelWidth = 420, onResizeWidth }: Props) {
```

本体のルート `div`（`active` がある場合の `return` の最初の要素、現状 `className="grid min-h-0 min-w-0 grid-rows-[auto_auto_auto_1fr_auto] overflow-hidden border-l-[0.5px] ... wide:static wide:z-auto wide:w-auto wide:shadow-none"`）の className 内の `wide:static` を `relative` に置き換える。置換後の該当クラス並びは次のとおり:

```
"grid min-h-0 min-w-0 grid-rows-[auto_auto_auto_1fr_auto] overflow-hidden border-l-[0.5px] border-divider bg-bg-2 relative max-wide:fixed max-wide:inset-y-0 max-wide:right-0 max-wide:z-[60] max-wide:w-[min(440px,50vw)] max-wide:border-l-0 max-wide:shadow-[-8px_0_32px_rgba(0,0,0,0.16)] max-md:w-[min(440px,92vw)] wide:z-auto wide:w-auto wide:shadow-none"
```

そのルート `div` の開きタグ直後（`{/* Head ... */}` コメントの直前）に追加:

```tsx
      {resizable && onResizeWidth && <PanelResizer width={panelWidth} onWidth={onResizeWidth} />}
```

- [ ] **Step 2: Workspace に状態・永続化・グリッド可変化を追加する**

`src/components/workspace/workspace.tsx` の import に追加:

```tsx
import { clampPanelWidth, loadPanelWidth, RP_WIDTH_DEFAULT, savePanelWidth } from "@/components/workspace/panel-width";
```

`const [rightPanelOpen, setRightPanelOpen] = useState(false);`（`workspace.tsx:46`）の直後に追加:

```tsx
  const [panelWidth, setPanelWidth] = useState(RP_WIDTH_DEFAULT);
  useEffect(() => {
    setPanelWidth(loadPanelWidth());
  }, []);
  const handleResizeWidth = useCallback((px: number) => {
    const next = clampPanelWidth(px, window.innerWidth);
    setPanelWidth(next);
    savePanelWidth(next);
  }, []);
```

> 注: `useEffect` / `useCallback` が未 import の場合は `react` の import 文に追加する。

シェルの `div`（`return (` 直後、`className={cn(` を持つ最上位 `div`）に `style` 属性を追加する。`data-rp={...}` 属性の隣に挿入:

```tsx
      style={{ ["--rp-width" as string]: `${panelWidth}px` }}
```

同 `div` の `cn(...)` 内、グリッド定義の `420px` を `var(--rp-width)` に置換（2 箇所）:

置換前（`workspace.tsx:532`）:

```tsx
        "wide:data-[rp=open]:grid-cols-[260px_minmax(0,1fr)_420px] wide:data-[sb=collapsed]:data-[rp=open]:grid-cols-[48px_minmax(0,1fr)_420px]",
```

置換後:

```tsx
        "wide:data-[rp=open]:grid-cols-[260px_minmax(0,1fr)_var(--rp-width)] wide:data-[sb=collapsed]:data-[rp=open]:grid-cols-[48px_minmax(0,1fr)_var(--rp-width)]",
```

- [ ] **Step 3: RightPanel 呼び出しに props を渡す**

`<RightPanel`（`workspace.tsx:702` 付近）の props に追加（`onClose={() => setRightPanelOpen(false)}` の隣）:

```tsx
          resizable={isWide}
          panelWidth={panelWidth}
          onResizeWidth={handleResizeWidth}
```

- [ ] **Step 4: lint と既存テストを確認**

Run: `pnpm lint && pnpm test`
Expected: lint エラーなし、node ユニット全 PASS

- [ ] **Step 5: 既存の Story 群が壊れていないことを確認**

Run: `pnpm test:storybook -- right-panel`
Expected: 既存 `right-panel` Story が PASS（`resizable` 未指定時はリサイザ非表示で従来どおり）

- [ ] **Step 6: コミット**

```bash
git add src/components/sources/right-panel.tsx src/components/workspace/workspace.tsx
git commit -m "feat: 一次資料パネルをデスクトップで幅可変にする"
```

---

## Task 7: 最終確認（ビルドと目視）

**Files:** なし（検証のみ）

- [ ] **Step 1: 本番ビルドが通ることを確認**

Run: `pnpm build`
Expected: 成功（型エラーなし）

- [ ] **Step 2: 目視確認（dev サーバ）**

Run: `pnpm dev` で起動し、幅広表を含む一次資料（例: `04-cross-page-table-semantic-loss.pdf` の構造化表示）を開く。
確認項目:
1. 表の右端にフェード＋シェブロンが出る。横スクロールすると右フェードが消え、左フェードが出る。
2. デスクトップ: パネル左境界をドラッグで幅が変わる／リロード後も保持／ハンドル・ダブルクリックで 420px に戻る。
3. 表の右上「拡大」→ 全画面シートが開き、Esc / 背景 / ✕ で閉じる。
4. モバイル幅（~390px）: 拡大ボタンが常時表示され、シートが全画面で開く。

- [ ] **Step 3: 完了**

`superpowers:finishing-a-development-branch` で統合方法（マージ / PR）を選ぶ。

---

## Self-Review メモ

- **Spec パート1（アフォーダンス）** → Task 1（検出）＋ Task 4（フェード・シェブロン・常時可視スクロール）。スクロールバー常時可視は globals.css の `scrollbar-width: thin` 既定（`globals.css:122`）で担保済みのため追加 CSS 不要。
- **Spec パート2（リサイズ）** → Task 2（幅計算・永続化）＋ Task 5（ハンドル）＋ Task 6（配線・グリッド可変）。クランプ 360〜min(720,50vw)、localStorage、ダブルクリックリセット、キーボード、`role="separator"` すべて反映。
- **Spec パート3（全画面拡大）** → Task 3（シート）＋ Task 4（拡大ボタン・はみ出し時のみ）。
- **型整合**: `computeOverflow`/`OverflowState`、`clampPanelWidth`/`RP_WIDTH_*`、`PanelResizer({width,onWidth})`、`RightPanel` の `resizable/panelWidth/onResizeWidth` がタスク間で一致。
- **プレースホルダ無し**: 各コード手順は完全な実装を含む。
