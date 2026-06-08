/** answer-eval エントリ。Vite-SSR ローダで本番 runAgent を in-process 起動し、
 * golden を再利用してモデル matrix を評価、モデルごとに JSON レポートを出力する。
 * 主モデル(answer.yaml の primary)が閾値を割ったとき --gate なら非ゼロ終了する。 */

import { createServer as createViteServer, loadEnv } from "vite";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { loadGoldenFile, loadAnswerConfig, suiteDir } from "./golden.ts";
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
    // golden を直接指定（未指定なら rag/eval/suites/<suite>/golden.yaml）。beir/hotpot の
    // 生成 golden を host にコピーして渡すために使う。
    golden: { type: "string" },
    // 評価 case 数の上限（0=全件）。大規模 suite のコスト制御用。
    limit: { type: "string", default: "0" },
    gate: { type: "boolean", default: false },
    primary: { type: "string" },
  },
});

const suite = values.suite!;
const outDir = resolve(ROOT, values.out!);
const dir = suiteDir(ROOT, suite);
const goldenPath = values.golden ? resolve(ROOT, values.golden) : join(dir, "golden.yaml");
const golden = loadGoldenFile(goldenPath);
const limit = Number(values.limit ?? "0");
if (limit > 0) golden.cases = golden.cases.slice(0, limit);
const answerCfg = loadAnswerConfig(dir);
const primary = values.primary ?? answerCfg.primary;

// root はツールディレクトリに固定する（observatory と同方針）。ROOT を root にすると
// Vite の依存スキャンが Next アプリ全体を走査して数分かかり、その間に SSR の fetchModule
// トランスポートがタイムアウトする。SSR ロードのみで client バンドルは不要なため、
// optimizeDeps の探索も無効化してスキャンを丸ごと省く。
const vite = await createViteServer({
  root: __dirname,
  appType: "custom",
  server: { middlewareMode: true },
  resolve: { alias: { "@": SRC } },
  optimizeDeps: { noDiscovery: true },
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
let primaryEvaluated = false;

try {
  for (const modelId of answerCfg.models) {
    const r = resolveModels(modelId);
    if (!r.ok) {
      console.warn(`[skip] ${modelId}: ${r.reason ?? "API キー未設定"}`);
      continue;
    }
    const isGate = modelId === primary;
    if (isGate) primaryEvaluated = true;
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

// --gate 時、主モデルがキー欠如等で未評価なら緑で素通りさせず失敗にする（サイレント false-pass 防止）。
if (values.gate && !primaryEvaluated) {
  console.error(`[gate] 主モデル ${primary} が未評価です（API キー未設定で skip された可能性）。`);
  process.exit(1);
}
if (values.gate && gateFailed) {
  console.error("[gate] 主モデルが閾値を割りました。");
  process.exit(1);
}
// CLI ツールとして確実に終了する。ssrLoadModule 経由でロードしたモジュールが保持する
// リソース（DB プール・HTTP エージェント等）を待たず、Vite の close 後に強制終了する。
process.exit(0);
