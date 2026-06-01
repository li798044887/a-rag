---
name: new-component
description: ARag の規約に沿って React コンポーネントとコロケーションした Storybook ストーリーを一式で作成する。新しい UI コンポーネントを追加するときに使う。
---

# new-component

`src/components/<area>/` にコンポーネントを追加し、**同じ場所に Storybook ストーリーを必ずコロケーション**する。
このプロジェクトはストーリー必須の文化（a11y アドオン有効、Vitest の storybook プロジェクトで実行される）。

## 規約
- 配置: `src/components/<area>/<name>.tsx`（area 例: `chat` / `sidebar` / `documents` / `workspace` / `modals` / `sources` / `uploads` / `auth` / `feedback`）
- import エイリアス: `@/*` → `src/*`
- className 合成: `cn` を `@/lib/utils` から使う（clsx + tailwind-merge）
- スタイル: Tailwind v4
- ストーリー: `<name>.stories.tsx` を**隣に**置く。`@storybook/react-vite` を使用。
- AI 生成の場合は `tags: ["ai-generated"]` を付ける（既存ストーリーの慣習）。

## 手順

1. **配置先 area を決める**（既存の `src/components/` 配下から最も近いものを選ぶ）。

2. **コンポーネントを作成する** — `src/components/<area>/<name>.tsx`
   ```tsx
   import { cn } from "@/lib/utils";

   export interface <Name>Props {
     className?: string;
   }

   export function <Name>({ className }: <Name>Props) {
     return <div className={cn("", className)}>...</div>;
   }
   ```

3. **ストーリーを作成する** — `src/components/<area>/<name>.stories.tsx`
   既存パターン（`src/components/chat/empty-state.stories.tsx`）に倣う:
   ```tsx
   import type { Meta, StoryObj } from "@storybook/react-vite";
   import { fn } from "storybook/test"; // コールバック引数がある場合
   import { <Name> } from "@/components/<area>/<name>";

   const meta = {
     title: "<Area>/<Name>",
     component: <Name>,
     tags: ["ai-generated"],
     parameters: { layout: "centered" }, // 全画面なら "fullscreen"
     args: { /* デフォルト props。onX 系は fn() */ },
   } satisfies Meta<typeof <Name>>;

   export default meta;
   type Story = StoryObj<typeof meta>;

   export const Default: Story = {};
   ```
   - 結合セルやバリアントなど分岐がある場合は、状態ごとに名前付き Story を追加する。

4. **検証する**
   - 型/ユニット: `pnpm test`
   - ストーリー実行: `pnpm test:storybook`
   - 目視確認が必要なら: `pnpm storybook`（:6006）

## 守ること
- パッケージマネージャは **pnpm**。
- ストーリーを省略しない（コンポーネント追加とストーリーは常にセット）。
- props にコールバックがあるストーリーでは `fn()` を使い、実副作用を持たせない。
