# 回答品質評価ハーネス(#4 Phase1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `runAgent` の最終回答と引用を決定的指標（citation precision/recall・answer fact coverage）で評価し、モデル matrix で比較・主モデルを CI ゲート化するハーネスを作る。

**Architecture:** `tools/answer-eval/`（アプリ本体から隔離、observatory と同方式）に純ロジック（metrics/golden/harness/report）と Vite-SSR エントリ（run.mts）を置く。エントリは `vite.ssrLoadModule` で本番 `runAgent` を in-process 起動し、`agentic_rag_demo` の golden を再利用して評価、モデルごとに JSON レポートを出力する。検索は runAgent 内部の rag への HTTP 呼び出しがそのまま走る。

**Tech Stack:** TypeScript（Node 24 型ストリップ）/ Vite SSR ローダ / vitest（ツール独自 config）/ `yaml` / GitHub Actions（self-hosted GPU runner）。

---

## 設計参照
- spec: `docs/superpowers/specs/2026-06-08-answer-quality-harness-design.md`
- 既存 in-process 起動の実証: `tools/observatory/server.mts`（`ssrLoadModule("@/lib/agent/run")`）
- 隔離原則: `tools/observatory/CLAUDE.md`（tools は root の build/lint/test/tsc 対象外。独自 config を持つ）

## ファイル構成（このプランで作成/変更）
```
tools/answer-eval/
  package.json        # 作成: {"type":"module"}
  tsconfig.json       # 作成: ../../tsconfig.json を extends、@->../../src
  vitest.config.ts    # 作成: root 固定、@->../../src、独自テスト対象
  metrics.ts          # 作成: 純粋な指標関数
  golden.ts           # 作成: golden.yaml / answer.yaml ロード + 型
  harness.ts          # 作成: collect / runCase / runModel（runAgent を依存注入）
  report.ts           # 作成: 集計 / gate 判定 / JSON 出力
  run.mts             # 作成: エントリ（Vite-SSR bootstrap + 統括 + 終了コード）
  metrics.test.ts     # 作成
  golden.test.ts      # 作成
  harness.test.ts     # 作成
  report.test.ts      # 作成
rag/eval/suites/agentic_rag_demo/answer.yaml   # 作成: matrix + thresholds
package.json          # 変更: scripts に answer-eval / answer-eval:test、devDeps に yaml
.gitignore           # 変更: eval-reports/ を無視
.github/workflows/answer-eval.yml              # 作成: 専用 workflow
docs/superpowers/specs/2026-06-08-answer-quality-harness-design.md  # 変更: §3/§7/§9 の軽微訂正
```

## 型の単一定義（全タスクで一貫使用）
```ts
// golden.ts が公開
export interface FactGroup { any: string[]; }
export interface GoldenCase {
  id: string;
  query: string;
  top_k?: number;
  relevant_documents: string[];
  key_facts: FactGroup[];
}
export interface Golden { suite: string; owner_user_id: string; cases: GoldenCase[]; }
export interface Thresholds {
  citation_recall: number;
  citation_precision: number;
  answer_fact_coverage: number;
}
export interface AnswerConfig { primary: string; models: string[]; thresholds: Thresholds; }

// metrics.ts が公開
export interface CaseMetrics {
  citation_recall: number;
  citation_precision: number;
  answer_fact_coverage: number;
}

// harness.ts が公開
export interface CaseResult extends CaseMetrics {
  id: string;
  cited_documents: string[];
  relevant_documents: string[];
  fact_groups: { any: string[]; matched: boolean }[];
  answer_excerpt: string;
  duration_ms: number;
  tokens: number;
}
```

---

## Task 1: ツールの足場（隔離・独自 config・スクリプト）

**Files:**
- Create: `tools/answer-eval/package.json`
- Create: `tools/answer-eval/tsconfig.json`
- Create: `tools/answer-eval/vitest.config.ts`
- Create: `tools/answer-eval/metrics.ts`（最小スタブ）
- Create: `tools/answer-eval/metrics.test.ts`（足場確認用の1テスト）
- Modify: `package.json`（scripts + devDeps）
- Modify: `.gitignore`

- [ ] **Step 1: package.json（ESM 宣言）を作成**

`tools/answer-eval/package.json`:
```json
{
  "name": "answer-eval",
  "private": true,
  "type": "module"
}
```

- [ ] **Step 2: tsconfig.json を作成（observatory と同方式）**

`tools/answer-eval/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "types": ["node"],
    "paths": { "@/*": ["../../src/*"] }
  },
  "include": ["**/*.ts", "**/*.mts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: vitest.config.ts を作成（root 固定・@ エイリアス）**

`tools/answer-eval/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// アプリの vitest.config.ts とは独立。root を tools/answer-eval に固定し、
// このツール配下のテストだけを対象にする。`@/` は src を指す。
const here = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: here,
  resolve: { alias: { "@": fileURLToPath(new URL("../../src", import.meta.url)) } },
  test: { environment: "node", include: ["**/*.test.ts"] },
});
```

- [ ] **Step 4: 足場確認用の最小 metrics.ts とテストを作成**

`tools/answer-eval/metrics.ts`:
```ts
/** 回答品質評価の純粋な指標関数。LLM 非依存。 */
export function _scaffold(): true {
  return true;
}
```

`tools/answer-eval/metrics.test.ts`:
```ts
import { expect, test } from "vitest";
import { _scaffold } from "./metrics.ts";

test("scaffold wiring works", () => {
  expect(_scaffold()).toBe(true);
});
```

- [ ] **Step 5: root の package.json に scripts と yaml を追加**

`package.json` の `scripts` に追加（`observe` の近くに置く）:
```json
"answer-eval": "node tools/answer-eval/run.mts",
"answer-eval:test": "vitest --config tools/answer-eval/vitest.config.ts run"
```

Run（yaml を devDependency に追加）:
```bash
pnpm add -D yaml
```
Expected: `yaml` が devDependencies に入り、`pnpm-lock.yaml` が更新される。

- [ ] **Step 6: .gitignore に eval-reports/ を追加**

`.gitignore` の末尾に追記（既に存在すれば不要）:
```
# 回答品質評価ハーネスのローカル出力
eval-reports/
```

- [ ] **Step 7: 足場テストが通ることを確認**

Run: `pnpm answer-eval:test`
Expected: PASS（`scaffold wiring works` 1 件）。

- [ ] **Step 8: ツールの型チェックが通ることを確認**

Run: `pnpm exec tsc -p tools/answer-eval/tsconfig.json --noEmit`
Expected: エラーなし（終了コード 0）。

- [ ] **Step 9: Commit**

```bash
git add tools/answer-eval/ package.json pnpm-lock.yaml .gitignore
git commit -m "chore: answer-eval ハーネスの足場と独自テスト/型設定を追加"
```

---

## Task 2: 指標関数（metrics.ts）

**Files:**
- Modify: `tools/answer-eval/metrics.ts`
- Modify: `tools/answer-eval/metrics.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`tools/answer-eval/metrics.test.ts`（全置換）:
```ts
import { expect, test } from "vitest";
import {
  factGroupMatched,
  factCoverage,
  citationRecall,
  citationPrecision,
} from "./metrics.ts";

test("factGroupMatched は any のいずれかが回答に含まれれば true", () => {
  expect(factGroupMatched("バイパス弁 V-12 を点検", { any: ["V-12", "Ｖ-12"] })).toBe(true);
  // 全角表記でも、回答に全角があれば一致する（正規化なしの素の substring）。
  expect(factGroupMatched("点検対象は Ｖ-12 です", { any: ["V-12", "Ｖ-12"] })).toBe(true);
  expect(factGroupMatched("該当なし", { any: ["V-12", "Ｖ-12"] })).toBe(false);
});

test("factCoverage は充足グループ比率と各グループの真偽を返す", () => {
  const groups = [{ any: ["N9"] }, { any: ["翌営業日AM", "翌営業日"] }, { any: ["0.91"] }];
  const r = factCoverage("コードN9。翌営業日に対応。", groups);
  expect(r.matched).toEqual([true, true, false]);
  expect(r.coverage).toBeCloseTo(2 / 3);
});

test("factCoverage はグループ空なら coverage=1", () => {
  expect(factCoverage("何でも", []).coverage).toBe(1);
});

test("citationRecall は関連文書のうち引用できた比率", () => {
  const cited = new Set(["A.pdf", "B.pdf"]);
  expect(citationRecall(cited, ["A.pdf", "C.pdf"])).toBeCloseTo(1 / 2);
  expect(citationRecall(cited, ["A.pdf", "B.pdf"])).toBe(1);
});

test("citationRecall は relevant 空なら 1", () => {
  expect(citationRecall(new Set(["A.pdf"]), [])).toBe(1);
});

test("citationPrecision は引用のうち関連文書だった比率（引用ゼロは 0）", () => {
  const cited = new Set(["A.pdf", "X.pdf"]);
  expect(citationPrecision(cited, ["A.pdf", "B.pdf"])).toBeCloseTo(1 / 2);
  expect(citationPrecision(new Set<string>(), ["A.pdf"])).toBe(0);
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `pnpm answer-eval:test metrics`
Expected: FAIL（`factGroupMatched is not a function` 等）。

- [ ] **Step 3: 最小実装を書く**

`tools/answer-eval/metrics.ts`（全置換）:
```ts
/** 回答品質評価の純粋な指標関数。LLM 非依存。
 *
 * fact_coverage は Python eval（rag/eval）と同一の部分一致セマンティクスを踏襲する:
 * 正規化なしの素の substring。golden が半角/全角を両方列挙しているのはこの前提のため。 */

import type { FactGroup, CaseMetrics } from "./golden.ts";

export type { CaseMetrics };

/** グループの any のいずれかが回答テキストに（素の substring として）含まれるか。 */
export function factGroupMatched(answer: string, group: FactGroup): boolean {
  return group.any.some((s) => answer.includes(s));
}

/** 充足グループ比率と、各グループの真偽配列を返す。グループ空なら coverage=1。 */
export function factCoverage(
  answer: string,
  groups: FactGroup[],
): { coverage: number; matched: boolean[] } {
  const matched = groups.map((g) => factGroupMatched(answer, g));
  const coverage = groups.length === 0 ? 1 : matched.filter(Boolean).length / groups.length;
  return { coverage, matched };
}

function intersectionSize(cited: Set<string>, relevant: string[]): number {
  return relevant.reduce((n, r) => (cited.has(r) ? n + 1 : n), 0);
}

/** 関連文書のうち引用できた比率。relevant 空なら 1。 */
export function citationRecall(cited: Set<string>, relevant: string[]): number {
  if (relevant.length === 0) return 1;
  return intersectionSize(cited, relevant) / relevant.length;
}

/** 引用のうち関連文書だった比率。引用ゼロは 0。 */
export function citationPrecision(cited: Set<string>, relevant: string[]): number {
  if (cited.size === 0) return 0;
  return intersectionSize(cited, relevant) / cited.size;
}
```

注: `FactGroup` / `CaseMetrics` は Task 3 で `golden.ts` に定義する。型のみの import なので Task 3 完了まで `tsc` は通らないが、`metrics.test.ts` の実行は vitest のトランスパイルで型を消すため通る。Task 3 完了後に Step で tsc を確認する。

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm answer-eval:test metrics`
Expected: PASS（6 件）。

- [ ] **Step 5: Commit**

```bash
git add tools/answer-eval/metrics.ts tools/answer-eval/metrics.test.ts
git commit -m "feat: answer-eval の指標関数(fact coverage / citation precision・recall)を追加"
```

---

## Task 3: golden / answer 設定ローダ（golden.ts）と answer.yaml

**Files:**
- Create: `tools/answer-eval/golden.ts`
- Create: `tools/answer-eval/golden.test.ts`
- Create: `rag/eval/suites/agentic_rag_demo/answer.yaml`

- [ ] **Step 1: answer.yaml（matrix + thresholds）を作成**

`rag/eval/suites/agentic_rag_demo/answer.yaml`:
```yaml
# answer-eval（回答品質ハーネス）専用設定。Python 文書レベル eval の golden.yaml とは
# 別ファイルにして相互汚染を避ける。queries/key_facts/relevant_documents は golden.yaml を再利用。
primary: gpt-4.1                   # gate 対象 = 本番既定
models:                           # キーが無いモデルは run.mts が skip + warning する
  - gpt-4.1
  - gpt-4o
  - deepseek-flash
  - deepseek-v4-pro
thresholds:                       # 初回実測 - マージンで確定する暫定値（要キャリブレーション）
  citation_recall: 0.80
  citation_precision: 0.75
  answer_fact_coverage: 0.80
```

- [ ] **Step 2: 失敗するテストを書く**

`tools/answer-eval/golden.test.ts`:
```ts
import { expect, test } from "vitest";
import { fileURLToPath } from "node:url";
import { loadGolden, loadAnswerConfig, suiteDir } from "./golden.ts";

const REPO = fileURLToPath(new URL("../..", import.meta.url));

test("loadGolden は agentic_rag_demo の golden を読む", () => {
  const g = loadGolden(suiteDir(REPO, "agentic_rag_demo"));
  expect(g.owner_user_id).toBe("__eval_agentic_rag_demo__");
  expect(g.cases.length).toBeGreaterThan(0);
  const c1 = g.cases.find((c) => c.id === "case1-cross-page-table");
  expect(c1).toBeDefined();
  expect(c1!.relevant_documents).toContain("04-cross-page-table-semantic-loss.pdf");
  // key_facts は { any: string[] } の配列としてパースされる。
  expect(Array.isArray(c1!.key_facts)).toBe(true);
  expect(c1!.key_facts[0].any.length).toBeGreaterThan(0);
});

test("loadAnswerConfig は matrix と thresholds を読む", () => {
  const cfg = loadAnswerConfig(suiteDir(REPO, "agentic_rag_demo"));
  expect(cfg.primary).toBe("gpt-4.1");
  expect(cfg.models).toContain("gpt-4o");
  expect(cfg.thresholds.citation_recall).toBeGreaterThan(0);
});
```

- [ ] **Step 3: テストを実行して失敗を確認**

Run: `pnpm answer-eval:test golden`
Expected: FAIL（`loadGolden is not a function`）。

- [ ] **Step 4: golden.ts を実装**

`tools/answer-eval/golden.ts`:
```ts
/** golden.yaml（Python eval と共有）と answer.yaml（answer-eval 専用）のローダと型。 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

export interface FactGroup { any: string[]; }
export interface GoldenCase {
  id: string;
  query: string;
  top_k?: number;
  relevant_documents: string[];
  key_facts: FactGroup[];
}
export interface Golden { suite: string; owner_user_id: string; cases: GoldenCase[]; }

export interface Thresholds {
  citation_recall: number;
  citation_precision: number;
  answer_fact_coverage: number;
}
export interface AnswerConfig { primary: string; models: string[]; thresholds: Thresholds; }

export interface CaseMetrics {
  citation_recall: number;
  citation_precision: number;
  answer_fact_coverage: number;
}

/** リポジトリ root から suite ディレクトリの絶対パスを返す。 */
export function suiteDir(repoRoot: string, suite: string): string {
  return join(repoRoot, "rag", "eval", "suites", suite);
}

export function loadGolden(dir: string): Golden {
  const raw = parse(readFileSync(join(dir, "golden.yaml"), "utf8")) as Golden;
  return raw;
}

export function loadAnswerConfig(dir: string): AnswerConfig {
  const raw = parse(readFileSync(join(dir, "answer.yaml"), "utf8")) as AnswerConfig;
  return raw;
}
```

- [ ] **Step 5: テストが通ることを確認**

Run: `pnpm answer-eval:test golden`
Expected: PASS（2 件）。

- [ ] **Step 6: 型チェック（metrics の型 import も解決される）**

Run: `pnpm exec tsc -p tools/answer-eval/tsconfig.json --noEmit`
Expected: エラーなし。

- [ ] **Step 7: Commit**

```bash
git add tools/answer-eval/golden.ts tools/answer-eval/golden.test.ts rag/eval/suites/agentic_rag_demo/answer.yaml
git commit -m "feat: answer-eval の golden/answer 設定ローダと agentic_rag_demo の answer.yaml を追加"
```

---

## Task 4: ハーネス本体（harness.ts、runAgent 依存注入）

**Files:**
- Create: `tools/answer-eval/harness.ts`
- Create: `tools/answer-eval/harness.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`tools/answer-eval/harness.test.ts`:
```ts
import { expect, test } from "vitest";
import type { AgentEvent } from "@/lib/types";
import { citedDocumentTitles, collect, runCase, type RunAgentFn } from "./harness.ts";
import type { GoldenCase } from "./golden.ts";

// done イベントの最小生成。citationMap の sourceId は sources の id（documentId）と対応する。
function doneEvent(over: Partial<Extract<AgentEvent, { type: "done" }>>): Extract<AgentEvent, { type: "done" }> {
  return {
    type: "done", tokens: 0, durationMs: 0,
    citationMap: {}, sourceIds: [], sources: [], threadId: "t", ...over,
  };
}

test("citedDocumentTitles は citationMap の sourceId を sources の title へ写像する", () => {
  const done = doneEvent({
    citationMap: { 1: { sourceId: "d1", sectionId: "c1" }, 2: { sourceId: "d1", sectionId: "c2" } },
    sources: [
      { id: "d1", type: "doc", title: "A.pdf", path: "A.pdf", author: "", date: "", sections: [] },
      { id: "d2", type: "doc", title: "B.pdf", path: "B.pdf", author: "", date: "", sections: [] },
    ],
  });
  // d1 のみ引用 → 重複排除して ["A.pdf"]。
  expect(citedDocumentTitles(done)).toEqual(["A.pdf"]);
});

test("collect は answer-delta を連結し done を取り出す", async () => {
  async function* gen(): AsyncGenerator<AgentEvent> {
    yield { type: "answer-start" };
    yield { type: "answer-delta", text: "あ" };
    yield { type: "answer-delta", text: "い[1]" };
    yield doneEvent({ tokens: 42 });
  }
  const r = await collect(gen());
  expect(r.answer).toBe("あい[1]");
  expect(r.done?.tokens).toBe(42);
});

test("runCase は注入した runAgent の結果から指標を算出する", async () => {
  const fakeRun: RunAgentFn = async function* () {
    yield { type: "answer-delta", text: "コードN9。翌営業日AM対応。詳細は[1]。" };
    yield doneEvent({
      tokens: 10,
      citationMap: { 1: { sourceId: "d1", sectionId: "c1" } },
      sources: [{ id: "d1", type: "doc", title: "04-cross-page-table-semantic-loss.pdf", path: "", author: "", date: "", sections: [] }],
    });
  };
  const gc: GoldenCase = {
    id: "case1", query: "q",
    relevant_documents: ["04-cross-page-table-semantic-loss.pdf"],
    key_facts: [{ any: ["N9"] }, { any: ["翌営業日AM", "翌営業日"] }, { any: ["0.91"] }],
  };
  const res = await runCase(fakeRun, { ownerUserId: "owner", modelId: "gpt-4.1" }, gc);
  expect(res.id).toBe("case1");
  expect(res.citation_recall).toBe(1);
  expect(res.citation_precision).toBe(1);
  expect(res.answer_fact_coverage).toBeCloseTo(2 / 3);
  expect(res.cited_documents).toEqual(["04-cross-page-table-semantic-loss.pdf"]);
  expect(res.fact_groups.map((g) => g.matched)).toEqual([true, true, false]);
  expect(res.tokens).toBe(10);
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `pnpm answer-eval:test harness`
Expected: FAIL（`citedDocumentTitles is not a function`）。

- [ ] **Step 3: harness.ts を実装**

`tools/answer-eval/harness.ts`:
```ts
/** 1 case / 1 model の実行と指標算出。runAgent は依存注入で受け、スタック非依存にテスト可能にする。 */

import type { AgentEvent } from "@/lib/types";
import type { Golden, GoldenCase, CaseMetrics } from "./golden.ts";
import { factCoverage, citationRecall, citationPrecision } from "./metrics.ts";

type DoneEvent = Extract<AgentEvent, { type: "done" }>;

/** runAgent の評価で必要な最小シグネチャ。run.mts が本番 runAgent を渡す。 */
export type RunAgentFn = (input: {
  query: string;
  ownerUserId: string;
  threadId: string;
  modelId: string;
  locale?: string;
}) => AsyncIterable<AgentEvent>;

export interface CaseResult extends CaseMetrics {
  id: string;
  cited_documents: string[];
  relevant_documents: string[];
  fact_groups: { any: string[]; matched: boolean }[];
  answer_excerpt: string;
  duration_ms: number;
  tokens: number;
}

export interface RunOpts { ownerUserId: string; modelId: string; locale?: string; }

/** done.citationMap の sourceId(documentId) を sources の title(documentTitle) へ写像（重複排除）。 */
export function citedDocumentTitles(done: DoneEvent): string[] {
  const idToTitle = new Map(done.sources.map((s) => [s.id, s.title]));
  const ids = new Set(Object.values(done.citationMap).map((c) => c.sourceId));
  return [...ids].map((id) => idToTitle.get(id) ?? id);
}

/** answer-delta を連結し、done を取り出す。 */
export async function collect(
  events: AsyncIterable<AgentEvent>,
): Promise<{ answer: string; done: DoneEvent | null }> {
  let answer = "";
  let done: DoneEvent | null = null;
  for await (const ev of events) {
    if (ev.type === "answer-delta") answer += ev.text;
    else if (ev.type === "done") done = ev;
  }
  return { answer, done };
}

export async function runCase(run: RunAgentFn, opts: RunOpts, gc: GoldenCase): Promise<CaseResult> {
  const started = Date.now();
  const { answer, done } = await collect(
    run({
      query: gc.query,
      ownerUserId: opts.ownerUserId,
      threadId: `answer-eval:${gc.id}`,
      modelId: opts.modelId,
      locale: opts.locale ?? "ja",
    }),
  );
  const cited = done ? citedDocumentTitles(done) : [];
  const citedSet = new Set(cited);
  const { coverage, matched } = factCoverage(answer, gc.key_facts);
  return {
    id: gc.id,
    citation_recall: citationRecall(citedSet, gc.relevant_documents),
    citation_precision: citationPrecision(citedSet, gc.relevant_documents),
    answer_fact_coverage: coverage,
    cited_documents: cited,
    relevant_documents: gc.relevant_documents,
    fact_groups: gc.key_facts.map((g, i) => ({ any: g.any, matched: matched[i] })),
    answer_excerpt: answer.slice(0, 200),
    duration_ms: Date.now() - started,
    tokens: done?.tokens ?? 0,
  };
}

/** golden の全 case を 1 モデルで順次実行する。 */
export async function runModel(
  run: RunAgentFn,
  golden: Golden,
  modelId: string,
  locale = "ja",
): Promise<CaseResult[]> {
  const results: CaseResult[] = [];
  for (const gc of golden.cases) {
    results.push(await runCase(run, { ownerUserId: golden.owner_user_id, modelId, locale }, gc));
  }
  return results;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm answer-eval:test harness`
Expected: PASS（3 件）。

- [ ] **Step 5: 型チェック**

Run: `pnpm exec tsc -p tools/answer-eval/tsconfig.json --noEmit`
Expected: エラーなし。

- [ ] **Step 6: Commit**

```bash
git add tools/answer-eval/harness.ts tools/answer-eval/harness.test.ts
git commit -m "feat: answer-eval の case/model 実行ロジック(runAgent 依存注入)を追加"
```

---

## Task 5: 集計・gate・レポート出力（report.ts）

**Files:**
- Create: `tools/answer-eval/report.ts`
- Create: `tools/answer-eval/report.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`tools/answer-eval/report.test.ts`:
```ts
import { expect, test } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { aggregate, evaluateGate, buildReport, writeReport } from "./report.ts";
import type { CaseResult } from "./harness.ts";

const cases: CaseResult[] = [
  { id: "a", citation_recall: 1, citation_precision: 1, answer_fact_coverage: 1,
    cited_documents: ["A.pdf"], relevant_documents: ["A.pdf"], fact_groups: [], answer_excerpt: "", duration_ms: 1, tokens: 1 },
  { id: "b", citation_recall: 0, citation_precision: 0.5, answer_fact_coverage: 0.5,
    cited_documents: ["X.pdf"], relevant_documents: ["B.pdf"], fact_groups: [], answer_excerpt: "", duration_ms: 1, tokens: 1 },
];

test("aggregate は case 平均を返す", () => {
  const m = aggregate(cases);
  expect(m.citation_recall).toBe(0.5);
  expect(m.citation_precision).toBe(0.75);
  expect(m.answer_fact_coverage).toBe(0.75);
});

test("evaluateGate は全指標が閾値以上のとき true", () => {
  const m = { citation_recall: 0.8, citation_precision: 0.8, answer_fact_coverage: 0.8 };
  expect(evaluateGate(m, { citation_recall: 0.8, citation_precision: 0.75, answer_fact_coverage: 0.8 })).toBe(true);
  expect(evaluateGate(m, { citation_recall: 0.9, citation_precision: 0.75, answer_fact_coverage: 0.8 })).toBe(false);
});

test("buildReport は gate モデルで passed を判定し、writeReport が JSON を書く", () => {
  const report = buildReport({
    suite: "agentic_rag_demo", model: "gpt-4.1", rewriteModel: "gpt-4.1-mini",
    ownerUserId: "__eval_agentic_rag_demo__", gate: true,
    thresholds: { citation_recall: 0.4, citation_precision: 0.4, answer_fact_coverage: 0.4 },
    cases,
  });
  expect(report.gate).toBe(true);
  expect(report.passed).toBe(true);
  expect(report.metrics.citation_recall).toBe(0.5);

  const dir = mkdtempSync(join(tmpdir(), "answer-eval-"));
  const path = writeReport(dir, report);
  expect(path.endsWith("agentic_rag_demo__gpt-4.1.json")).toBe(true);
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  expect(parsed.model).toBe("gpt-4.1");
  expect(parsed.cases.length).toBe(2);
});

test("buildReport は非 gate モデルで passed=null", () => {
  const report = buildReport({
    suite: "s", model: "gpt-4o", rewriteModel: "gpt-4.1-mini",
    ownerUserId: "o", gate: false,
    thresholds: { citation_recall: 1, citation_precision: 1, answer_fact_coverage: 1 },
    cases,
  });
  expect(report.gate).toBe(false);
  expect(report.passed).toBeNull();
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `pnpm answer-eval:test report`
Expected: FAIL（`aggregate is not a function`）。

- [ ] **Step 3: report.ts を実装**

`tools/answer-eval/report.ts`:
```ts
/** case 結果の集計・gate 判定・モデルごとの JSON レポート出力。 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CaseMetrics, Thresholds } from "./golden.ts";
import type { CaseResult } from "./harness.ts";

export function aggregate(cases: CaseResult[]): CaseMetrics {
  const n = cases.length || 1;
  const sum = (k: keyof CaseMetrics) => cases.reduce((a, c) => a + c[k], 0);
  return {
    citation_recall: sum("citation_recall") / n,
    citation_precision: sum("citation_precision") / n,
    answer_fact_coverage: sum("answer_fact_coverage") / n,
  };
}

export function evaluateGate(m: CaseMetrics, t: Thresholds): boolean {
  return (
    m.citation_recall >= t.citation_recall &&
    m.citation_precision >= t.citation_precision &&
    m.answer_fact_coverage >= t.answer_fact_coverage
  );
}

export interface Report {
  suite: string;
  model: string;
  rewrite_model: string;
  owner_user_id: string;
  generated_at: string;
  gate: boolean;
  thresholds: Thresholds;
  metrics: CaseMetrics;
  passed: boolean | null;
  cases: CaseResult[];
}

export function buildReport(args: {
  suite: string;
  model: string;
  rewriteModel: string;
  ownerUserId: string;
  gate: boolean;
  thresholds: Thresholds;
  cases: CaseResult[];
}): Report {
  const metrics = aggregate(args.cases);
  return {
    suite: args.suite,
    model: args.model,
    rewrite_model: args.rewriteModel,
    owner_user_id: args.ownerUserId,
    generated_at: new Date().toISOString(),
    gate: args.gate,
    thresholds: args.thresholds,
    metrics,
    // gate 対象モデルのみ合否を判定する。参考モデルは null。
    passed: args.gate ? evaluateGate(metrics, args.thresholds) : null,
    cases: args.cases,
  };
}

/** `<dir>/<suite>__<model>.json` に書き、書いたパスを返す。 */
export function writeReport(dir: string, report: Report): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${report.suite}__${report.model}.json`);
  writeFileSync(path, JSON.stringify(report, null, 2), "utf8");
  return path;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm answer-eval:test report`
Expected: PASS（4 件）。

- [ ] **Step 5: 全ツールテストと型チェック**

Run: `pnpm answer-eval:test`
Expected: 全 PASS（metrics/golden/harness/report 合計）。
Run: `pnpm exec tsc -p tools/answer-eval/tsconfig.json --noEmit`
Expected: エラーなし。

- [ ] **Step 6: Commit**

```bash
git add tools/answer-eval/report.ts tools/answer-eval/report.test.ts
git commit -m "feat: answer-eval の集計・gate 判定・JSON レポート出力を追加"
```

---

## Task 6: エントリ（run.mts、Vite-SSR bootstrap + 統括）

**Files:**
- Create: `tools/answer-eval/run.mts`

run.mts は実 `runAgent` とフルスタックに依存するため単体テストは作らない（CI 実行が統合確認を兼ねる）。型チェックと、スタック起動下でのスモーク実行で確認する。

- [ ] **Step 1: run.mts を実装**

`tools/answer-eval/run.mts`:
```ts
/** answer-eval エントリ。Vite-SSR ローダで本番 runAgent を in-process 起動し、
 * golden を再利用してモデル matrix を評価、モデルごとに JSON レポートを出力する。
 * 主モデル(answer.yaml の primary)が閾値を割ったとき --gate なら非ゼロ終了する。 */

import { createServer as createViteServer, loadEnv } from "vite";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { AgentEvent } from "@/lib/types";
import { loadGolden, loadAnswerConfig, suiteDir } from "./golden.ts";
import { runModel, type RunAgentFn } from "./harness.ts";
import { buildReport, writeReport } from "./report.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const SRC = join(ROOT, "src");

// .env.local 等を読み込んで process.env に注入（API キー / RAG_SERVICE_URL / RAG_INTERNAL_TOKEN）。
Object.assign(process.env, loadEnv("development", ROOT, ""));

const { values } = parseArgs({
  options: {
    suite: { type: "string", default: "agentic_rag_demo" },
    out: { type: "string", default: "eval-reports/answer" },
    gate: { type: "boolean", default: false },
    primary: { type: "string" },
  },
});

const suite = values.suite!;
const outDir = resolve(ROOT, values.out!);
const dir = suiteDir(ROOT, suite);
const golden = loadGolden(dir);
const answerCfg = loadAnswerConfig(dir);
const primary = values.primary ?? answerCfg.primary;

const vite = await createViteServer({
  root: ROOT,
  appType: "custom",
  server: { middlewareMode: true },
  resolve: { alias: { "@": SRC } },
});

// 本番と同一の runAgent / モデル解決をエイリアス解決込みで読む。
const runMod = await vite.ssrLoadModule("@/lib/agent/run");
const modelsMod = await vite.ssrLoadModule("@/lib/agent/models");
const run = runMod.runAgent as RunAgentFn;
const resolveModels = modelsMod.resolveModels as (id: string) => {
  ok: boolean;
  models?: { modelNames: { chat: string; rewrite: string } };
  reason?: string;
};

let gateFailed = false;

try {
  for (const modelId of answerCfg.models) {
    const r = resolveModels(modelId);
    if (!r.ok) {
      console.warn(`[skip] ${modelId}: ${r.reason ?? "API キー未設定"}`);
      continue;
    }
    const isGate = modelId === primary;
    console.log(`[run] ${modelId}${isGate ? " (gate)" : ""} ...`);
    const cases = await runModel(run, golden, modelId, "ja");
    const report = buildReport({
      suite,
      model: modelId,
      rewriteModel: r.models!.modelNames.rewrite,
      ownerUserId: golden.owner_user_id,
      gate: isGate,
      thresholds: answerCfg.thresholds,
      cases,
    });
    const path = writeReport(outDir, report);
    const m = report.metrics;
    console.log(
      `[done] ${modelId} recall=${m.citation_recall.toFixed(3)} ` +
        `precision=${m.citation_precision.toFixed(3)} fact=${m.answer_fact_coverage.toFixed(3)} ` +
        `${isGate ? (report.passed ? "PASS" : "FAIL") : "(ref)"} -> ${path}`,
    );
    if (isGate && !report.passed) gateFailed = true;
  }
} finally {
  await vite.close();
}

if (values.gate && gateFailed) {
  console.error("[gate] 主モデルが閾値を割りました。");
  process.exit(1);
}
// AgentEvent は型参照のみ（runtime では未使用だが import の意図を明示）。
void (null as unknown as AgentEvent);
```

注: 末尾の `void (null as ...)` は不要なら削除可。`AgentEvent` を実際に使わないなら import 自体を消してよい（型整合のためのプレースホルダではない）。

- [ ] **Step 2: 型チェック**

Run: `pnpm exec tsc -p tools/answer-eval/tsconfig.json --noEmit`
Expected: エラーなし。`AgentEvent` 未使用エラーが出る場合は import と末尾 `void` 行を削除する。

- [ ] **Step 3: スモーク実行（フルスタック + キー前提）**

前提: `docker compose --profile worker up -d` でスタック起動済み、`.env.local` に `OPENAI_API_KEY` 設定済み、`agentic_rag_demo` を ingest 済み（未なら下記）。
```bash
docker compose exec -T rag uv run python -m eval ingest --suite agentic_rag_demo
pnpm answer-eval --suite agentic_rag_demo --out eval-reports/answer
```
Expected: `eval-reports/answer/agentic_rag_demo__gpt-4.1.json` 等が生成され、各モデルの recall/precision/fact がログされる。キー未設定モデルは `[skip]`。

- [ ] **Step 4: Commit**

```bash
git add tools/answer-eval/run.mts
git commit -m "feat: answer-eval エントリ(Vite-SSR で runAgent を in-process 起動)を追加"
```

---

## Task 7: CI workflow（answer-eval.yml）

**Files:**
- Create: `.github/workflows/answer-eval.yml`

- [ ] **Step 1: workflow を作成（rag-eval-full.yml と同型）**

`.github/workflows/answer-eval.yml`:
```yaml
name: answer-eval

# 既定オフ。手動 or 夜間のみ（フルスタック + 実 LLM が必要なためセルフホスト GPU runner 前提）。
on:
  workflow_dispatch:
    inputs:
      primary:
        description: "Gate target model id (overrides answer.yaml primary)"
        required: false
        default: ""
  schedule:
    - cron: "30 18 * * *"  # 03:30 JST（rag-eval-full の 18:00 とずらす）

jobs:
  answer-eval:
    runs-on: [self-hosted, Windows, rag, gpu]
    env:
      SUITE: agentic_rag_demo
      MINERU_MODEL_SOURCE: modelscope
      OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
      DEEPSEEK_API_KEY: ${{ secrets.DEEPSEEK_API_KEY }}
      ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
      # runner host から rag の公開ポート(8000)へ到達する。トークンは compose 既定に合わせる。
      RAG_SERVICE_URL: http://localhost:8000
      RAG_INTERNAL_TOKEN: ${{ secrets.RAG_INTERNAL_TOKEN || 'dev-internal-token' }}
    defaults:
      run:
        shell: powershell
    steps:
      - uses: actions/checkout@v6
      - name: Prepare report directory
        run: New-Item -ItemType Directory -Force -Path "artifacts/answer-eval" | Out-Null
      - name: Bring up full stack (rebuild rag to bake eval/)
        run: docker compose -f docker-compose.yml -f docker-compose.gpu.yml --profile worker up -d --build rag
      - name: Verify CUDA in rag container
        run: docker compose -f docker-compose.yml -f docker-compose.gpu.yml exec -T rag uv run python -c "import torch; assert torch.cuda.is_available(); print(torch.cuda.get_device_name(0))"
      - name: Ingest golden documents
        run: docker compose -f docker-compose.yml -f docker-compose.gpu.yml exec -T rag uv run python -m eval ingest --suite $env:SUITE
      - name: Install web deps
        run: pnpm install --frozen-lockfile
      - name: Run answer-eval with gate
        run: |
          $primaryArg = if ($env:INPUT_PRIMARY) { "--primary", $env:INPUT_PRIMARY } else { @() }
          pnpm answer-eval --suite $env:SUITE --gate --out "artifacts/answer-eval" @primaryArg
          exit $LASTEXITCODE
        env:
          INPUT_PRIMARY: ${{ inputs.primary }}
      - name: Publish report summary
        if: always()
        run: |
          Get-ChildItem "artifacts/answer-eval/*.json" | ForEach-Object {
            $r = Get-Content $_.FullName | ConvertFrom-Json
            "## $($r.model) $(if ($r.gate) { '(gate)' } else { '(ref)' })" | Add-Content $env:GITHUB_STEP_SUMMARY
            "recall=$($r.metrics.citation_recall) precision=$($r.metrics.citation_precision) fact=$($r.metrics.answer_fact_coverage) passed=$($r.passed)" | Add-Content $env:GITHUB_STEP_SUMMARY
          }
      - name: Upload reports
        if: always()
        uses: actions/upload-artifact@v7
        with:
          name: answer-eval-${{ env.SUITE }}
          path: artifacts/answer-eval/*
```

- [ ] **Step 2: workflow の YAML 妥当性を目視確認**

`.github/workflows/rag-eval-full.yml` と並べ、`runs-on` / `shell` / compose の `-f` 並び / `exit $LASTEXITCODE` が揃っていることを確認する。

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/answer-eval.yml
git commit -m "ci: answer-eval の専用 workflow(手動/夜間・主モデル gate)を追加"
```

---

## Task 8: 設計書の軽微訂正

**Files:**
- Modify: `docs/superpowers/specs/2026-06-08-answer-quality-harness-design.md`

実装で判明した差分を spec に反映する（後続の読者の混乱を防ぐ）。

- [ ] **Step 1: テスト実行手段の訂正**

§7 の「`metrics.test.ts`（既定 `pnpm test`・スタック不要）」を、ツールは root の test 対象外であることに合わせて訂正する。該当文を以下へ置換:
```
- `metrics.test.ts` ほかツールの単体テストは **独自 vitest config**（`pnpm answer-eval:test`、
  `tools/answer-eval/vitest.config.ts`）で回す（observatory と同じく root の `pnpm test` 対象外）。
  スタック/API キー不要。
```

- [ ] **Step 2: rag ポートの確定を反映**

§9 の「rag の host 公開ポート（`RAG_SERVICE_URL` の値）」の行を削除し、§6 の統合ポイント末尾に追記:
```
rag は compose で `8000:8000` を公開し、`rag-client` の既定が `http://localhost:8000` /
`dev-internal-token` のため、runner host からは既定で到達できる（必要時のみ env 上書き）。
```

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-06-08-answer-quality-harness-design.md
git commit -m "docs: answer-eval 設計書のテスト手段と rag ポートを実装に合わせて訂正"
```

---

## Self-Review（記録）

- **Spec coverage**: §1 目的→全タスク / §3 ファイル構成→Task1-7 / §4 指標→Task2,4 / §5 レポート・gate・answer.yaml→Task3,5 / §6 CI→Task7 / §7 テスト→各 *.test.ts + Task8 訂正 / §8 既存コード事実→Task4,6 で参照済み。
- **Placeholder scan**: 各コード step に完全なコードを記載。`answer.yaml` の thresholds は「暫定・要キャリブレーション」で、初回 CI 実測後に値を更新する運用（spec §5 既述）。
- **Type consistency**: `FactGroup`/`GoldenCase`/`Thresholds`/`CaseMetrics` は `golden.ts` 単一定義、`CaseResult` は `harness.ts`、`Report` は `report.ts`。`metrics.ts` は `golden.ts` の型を re-export。`RunAgentFn` は `harness.ts` 定義を `run.mts` が使用。関数名（`citationRecall`/`citationPrecision`/`factCoverage`/`citedDocumentTitles`/`collect`/`runCase`/`runModel`/`aggregate`/`evaluateGate`/`buildReport`/`writeReport`）はタスク間で一致。

## 未確定（実装中に確認）
- `documentTitle` が golden のファイル名と拡張子込みで一致するか（Task6 スモークで `cited_documents` を実値確認。不一致なら `golden.ts` か `harness.ts` で正規化を足す）。
- 閾値の確定値（Task6/CI 初回実測後に `answer.yaml` を更新）。
