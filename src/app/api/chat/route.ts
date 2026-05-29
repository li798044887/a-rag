import { NextResponse } from "next/server";
import type { ModelMessage } from "ai";
import { getSessionClaims } from "@/lib/auth";
import { runAgent } from "@/lib/agent/run";
import { createThread, saveCompletedMessage, getThreadMessages, deleteMessagesFrom } from "@/lib/threads";
import { toModelHistory } from "@/lib/agent/history";
import type { AgentEvent, ToolCall } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const claims = await getSessionClaims();
  if (!claims) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { query, threadId, model, regenerateFrom } = (await req.json().catch(() => ({}))) as {
    query?: string; threadId?: string; model?: string; regenerateFrom?: number;
  };
  const q = query || "";

  // スレッドを確定（無ければ作成、タイトルは query から）
  const tid = threadId || (await createThread(claims.sub, q || "新しいスレッド")).id;

  // 既存スレッドへの追記なら過去ターンを履歴として読み込む（直近8ターン窓）。
  // 再生成（regenerateFrom 指定）時は、履歴読込の前に当該index以降を削除し DB を整合させる。
  let history: ModelMessage[] = [];
  if (threadId) {
    // regenerateFrom は 0 も有効（先頭ターン再生成＝全ターン破棄）。truthy 判定ではなく型で判定する。
    // 削除がスローした場合はストリーム構築前なので HTTP 500 が返る（設計上許容）。
    if (typeof regenerateFrom === "number") {
      await deleteMessagesFrom(tid, claims.sub, regenerateFrom);
    }
    const prior = await getThreadMessages(tid, claims.sub);
    if (prior) {
      history = toModelHistory(
        prior.map((p) => ({ query: p.completed.query, answerText: p.completed.answerText })),
        8,
      );
    }
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (data: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));

      let answer = "";
      const steps: ToolCall[] = [];
      let done: Extract<AgentEvent, { type: "done" }> | null = null;

      try {
        for await (const event of runAgent({ query: q, ownerUserId: claims.sub, threadId: tid, modelId: model, history })) {
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
              blockType: sec?.blockType ?? "text",
              page: sec?.page ?? 0,
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
      // クライアントが body 読み取り前に実 threadId を取得し、実行中でもサイドバー履歴へ
      // 即時登録できるようにする（実行中の会話を見失わないため）。
      "X-Thread-Id": tid,
    },
  });
}
