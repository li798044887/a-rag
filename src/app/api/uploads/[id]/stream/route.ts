import { getSessionClaims } from "@/lib/auth";
import { ragFetch } from "@/lib/rag-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// rag ジョブ状態をサーバ側でポーリングし、段階遷移を SSE で push する。
// rag は無改修。クライアントの 1秒ポーリング群を置き換えるための薄いプロキシ。
const POLL_MS = 600;
const MAX_MS = 10 * 60 * 1000; // 上限10分（迷子ストリーム防止）。

interface JobSnapshot {
  status: string;
  progress: number;
  stage_detail: string;
  chunks?: number;
  page_count?: number | null;
  error?: string | null;
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const claims = await getSessionClaims();
  if (!claims) return new Response("unauthorized", { status: 401 });

  const { id } = await ctx.params;
  const owner = encodeURIComponent(claims.sub);
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        try { controller.close(); } catch { /* already closed */ }
      };
      const send = (data: unknown) => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`)); } catch { close(); }
      };

      // クライアント切断（モーダルを閉じる/ナビゲート）で即停止する。
      req.signal.addEventListener("abort", close);

      const started = Date.now();
      try {
        while (!closed && Date.now() - started < MAX_MS) {
          const r = await ragFetch(`/jobs/${encodeURIComponent(id)}?owner_user_id=${owner}`).catch(() => null);
          if (!r || !r.ok) {
            send({ status: "error", progress: 0, stage_detail: "", error: "ジョブが見つかりません" } satisfies JobSnapshot);
            break;
          }
          const job = (await r.json()) as JobSnapshot;
          send(job);
          if (job.status === "ready" || job.status === "error") break;
          await new Promise((res) => setTimeout(res, POLL_MS));
        }
      } catch {
        send({ status: "error", progress: 0, stage_detail: "", error: "ストリームエラー" } satisfies JobSnapshot);
      } finally {
        close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // リバースプロキシのバッファリングを無効化（Nginx 等）。
      "X-Accel-Buffering": "no",
    },
  });
}
