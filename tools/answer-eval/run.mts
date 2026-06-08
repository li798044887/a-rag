/** answer-eval エントリ。Vite-SSR ローダで本番 runAgent を in-process 起動し、
 * golden を再利用してモデル matrix を評価、モデルごとに JSON レポートを出力する。
 * 主モデル(answer.yaml の primary)が閾値を割ったとき --gate なら非ゼロ終了する。 */

import { createServer as createViteServer, loadEnv } from "vite";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
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
