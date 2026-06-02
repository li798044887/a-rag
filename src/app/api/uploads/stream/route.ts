import { getSessionClaims } from "@/lib/auth";
import { ragFetch } from "@/lib/rag-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// rag ジョブ状態をサーバ側でポーリングし、複数ジョブを1本の SSE に多重化して push する。
// rag は無改修。1ファイル=1接続だった旧 /api/uploads/:id/stream を集約し、
// ブラウザの「1オリジン同時6接続」上限の枯渇を防ぐ。
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

/** rag のジョブ status が終端（これ以上更新が来ない）かどうか。 */
export function isTerminalJobStatus(status: string): boolean {
  return status === "ready" || status === "error";
}

/** SSE フレーム文字列を組み立てる（jobId を必ず先頭に含める）。 */
export function formatFrame(jobId: string, snapshot: JobSnapshot): string {
  return `data: ${JSON.stringify({ jobId, ...snapshot })}\n\n`;
}

export async function POST(req: Request) {
  const claims = await getSessionClaims();
  if (!claims) return new Response("unauthorized", { status: 401 });

  let jobIds: string[] = [];
  try {
    const body = (await req.json()) as { jobIds?: unknown };
    if (Array.isArray(body.jobIds)) {
      jobIds = body.jobIds.filter((j): j is string => typeof j === "string");
    }
  } catch {
    return new Response("bad request", { status: 400 });
  }

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
      const send = (text: string) => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(text)); } catch { close(); }
      };

      // クライアント切断（モーダルを閉じる/ナビゲート/再接続）で即停止する。
      req.signal.addEventListener("abort", close);

      // 監視中ジョブの集合。終端に達したものは外し、空になれば終了する。
      const pending = new Set(jobIds);
      if (pending.size === 0) { close(); return; }

      const started = Date.now();
      try {
        while (!closed && pending.size > 0 && Date.now() - started < MAX_MS) {
          // 各ジョブを並列ポーリングし、スナップショットを jobId 付きで push する。
          await Promise.all(
            Array.from(pending).map(async (jobId) => {
              const r = await ragFetch(
                `/jobs/${encodeURIComponent(jobId)}?owner_user_id=${owner}`,
              ).catch(() => null);
              if (!r || !r.ok) {
                send(formatFrame(jobId, { status: "error", progress: 0, stage_detail: "", error: "ジョブが見つかりません" }));
                pending.delete(jobId);
                return;
              }
              const job = (await r.json().catch(() => null)) as JobSnapshot | null;
              if (!job) {
                send(formatFrame(jobId, { status: "error", progress: 0, stage_detail: "", error: "レスポンス解析エラー" }));
                pending.delete(jobId);
                return;
              }
              send(formatFrame(jobId, job));
              if (isTerminalJobStatus(job.status)) pending.delete(jobId);
            }),
          );
          if (pending.size === 0) break;
          await new Promise((res) => setTimeout(res, POLL_MS));
        }
      } catch {
        // 想定外の全体例外時のみ接続を閉じる（個別エラーは各ジョブで送出済み）。
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
