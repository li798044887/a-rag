import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { verifyAccessToken, authCookieName } from "@/lib/auth";
import { runAgent } from "@/lib/agent/run";
import { createThread, saveCompletedMessage } from "@/lib/threads";
import type { AgentEvent, ToolCall } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const jar = await cookies();
  const token = jar.get(authCookieName)?.value;
  const claims = token ? await verifyAccessToken(token) : null;
  if (!claims) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { query, threadId, model } = (await req.json().catch(() => ({}))) as {
    query?: string; threadId?: string; model?: string;
  };
  const q = query || "";

  // スレッドを確定（無ければ作成、タイトルは query から）
  const tid = threadId || (await createThread(claims.sub, q || "新しいスレッド")).id;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (data: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));

      let answer = "";
      const steps: ToolCall[] = [];
      let done: Extract<AgentEvent, { type: "done" }> | null = null;

      try {
        for await (const event of runAgent({ query: q, ownerUserId: claims.sub, threadId: tid, modelId: model })) {
          if (event.type === "answer-delta") answer += event.text;
          if (event.type === "step") {
            const idx = steps.findIndex((s) => s.id === event.step.id);
            if (idx >= 0) steps[idx] = event.step; else steps.push(event.step);
          }
          if (event.type === "done") done = event;
          send(event);
        }

        // 永続化（done が来た正常終了時のみ）
        if (done) {
          const cites = Object.entries(done.citationMap).map(([ord, ref]) => {
            const src = done!.sources.find((s) => s.id === ref.sourceId);
            const sec = src?.sections.find((x) => x.id === ref.sectionId);
            return {
              ordinal: Number(ord),
              documentId: ref.sourceId,
              documentTitle: src?.title ?? ref.sourceId,
              chunkId: ref.sectionId,
              sectionId: ref.sectionId,
              headingPath: sec?.heading ?? "",
              snippet: sec?.body ?? "",
            };
          });
          // 永続化の失敗は done 送出後なのでクライアントへ error を送らずログのみ。
          try {
            await saveCompletedMessage({
              threadId: tid, query: q, answerText: answer,
              tokens: done.tokens, durationMs: done.durationMs, steps, citations: cites,
            });
          } catch (err) {
            console.error("[chat] persistence failed", err);
          }
        }
      } catch (err) {
        send({ type: "error", message: err instanceof Error ? err.message : "error" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
