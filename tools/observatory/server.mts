import { createServer as createViteServer, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { createServer as createHttpServer } from "node:http";
import { rmSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createObserver, type RoleSystems, type LlmTrace } from "./observe.ts";
import { createReplayTransport } from "./replay.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const SRC = join(ROOT, "src");

// .env.local 等を読み込んで process.env に注入（API キー / RAG_SERVICE_URL を有効化）。
Object.assign(process.env, loadEnv("development", ROOT, ""));

const PORT = Number(process.env.OBSERVE_PORT ?? 3030);
const OWNER = process.env.OBSERVE_OWNER_ID ?? "observe-owner";
const SNAP_DIR = join(__dirname, "snapshots");
mkdirSync(SNAP_DIR, { recursive: true });

const vite = await createViteServer({
  root: __dirname,
  plugins: [react()],
  server: { middlewareMode: true },
  // spa: Vite が index.html の配信/HMR 変換を担う（/api は上で先取りしてから委譲）。
  appType: "spa",
  resolve: { alias: { "@": SRC } },
});

// アプリの SDK モジュールをエイリアス解決込みで SSR ローダから読む。
const run = await vite.ssrLoadModule("@/lib/agent/run");
const prompts = await vite.ssrLoadModule("@/lib/agent/prompts");
const cfgMod = await vite.ssrLoadModule("@/lib/agent/config");
const ragClient = await vite.ssrLoadModule("@/lib/rag-client");

function roleSystemsFor(locale: string): { roleSystems: RoleSystems; chatSystemOf: (cfg: unknown) => string } {
  const p = prompts.getAgentPrompts(locale);
  return {
    roleSystems: {
      grade: p.grade.system,
      queryRewrite: p.queryRewrite.system,
      verify: p.verify.system,
      revise: p.revise.system,
    },
    chatSystemOf: (cfg: unknown) => cfgMod.buildSystemPrompt(cfg, locale),
  };
}

const http = createHttpServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");

  if (url.pathname === "/api/defaults") {
    const locale = url.searchParams.get("locale") ?? "ja";
    const { roleSystems, chatSystemOf } = roleSystemsFor(locale);
    const cfg = cfgMod.AGENT_CFG_DEFAULTS;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ chat: chatSystemOf(cfg), ...roleSystems, cfg }));
    return;
  }

  if (url.pathname === "/api/run" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      const { query, model, locale = "ja", cfg, overrides = {}, retrieveMode = "replay" } = JSON.parse(body || "{}");
      res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache" });
      const send = (o: unknown) => res.write(`data: ${JSON.stringify(o)}\n\n`);

      const { roleSystems, chatSystemOf } = roleSystemsFor(locale);
      const resolvedCfg = cfg ?? cfgMod.AGENT_CFG_DEFAULTS;
      const observer = createObserver({
        roleSystems,
        chatSystem: chatSystemOf(resolvedCfg),
        overrides,
        onTrace: (t: LlmTrace) => send({ kind: "trace", trace: t }),
      });
      ragClient.setRagTransport(createReplayTransport({ mode: retrieveMode, dir: SNAP_DIR }));
      try {
        for await (const ev of run.runAgent({
          query,
          ownerUserId: OWNER,
          threadId: "observe",
          modelId: model,
          locale,
          agentCfg: resolvedCfg,
          observe: { wrap: observer.wrap },
        })) {
          send({ kind: "event", event: ev });
        }
      } catch (err) {
        send({ kind: "error", message: err instanceof Error ? err.message : String(err) });
      } finally {
        ragClient.setRagTransport(null);
        send({ kind: "end" });
        res.end();
      }
    });
    return;
  }

  if (url.pathname === "/api/snapshots" && req.method === "DELETE") {
    rmSync(SNAP_DIR, { recursive: true, force: true });
    mkdirSync(SNAP_DIR, { recursive: true });
    res.setHeader("content-type", "application/json");
    res.end("{}");
    return;
  }

  // それ以外は Vite に委譲（UI を HMR 配信）。
  vite.middlewares(req, res);
});

http.listen(PORT, () => console.log(`observatory: http://localhost:${PORT}`));
