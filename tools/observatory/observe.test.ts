import { expect, test } from "vitest";
import { generateText, Output, simulateReadableStream, streamText } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { z } from "zod";
import { createObserver } from "./observe";

const ROLE_SYSTEMS = { grade: "GRADE_SYS", queryRewrite: "REWRITE_SYS", verify: "VERIFY_SYS", revise: "REVISE_SYS" };

function genModel(text: string, onParams?: (sys: string) => void) {
  return new MockLanguageModelV3({
    doGenerate: async (opts) => {
      const sys = (opts.prompt as Array<{ role: string; content: unknown }>).find((m) => m.role === "system");
      onParams?.(sys?.content as string);
      // 実 SDK の result 型は厳密に進化中。テスト fixture なので実行時値のみ合わせ never でキャストする。
      return {
        content: [{ type: "text", text }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: { inputTokens: 5, outputTokens: 7, totalTokens: 12 },
        warnings: [],
      } as never;
    },
  });
}

test("rewrite モデルの system 文字列から役割を判定し trace に記録する", async () => {
  const observer = createObserver({ roleSystems: ROLE_SYSTEMS, chatSystem: "CHAT_SYS", overrides: {} });
  const wrapped = observer.wrap(genModel("ok"), "rewrite");
  await generateText({ model: wrapped, system: "GRADE_SYS", prompt: "{}" });
  const t = observer.traces.at(-1)!;
  expect(t.role).toBe("grade");
  expect(t.response.text).toBe("ok");
  expect(t.request.overridden).toBe(false);
  expect(t.response.usage).toMatchObject({ totalTokens: 12 });
});

test("未知の system は rewrite:unknown として記録（観測は壊さない）", async () => {
  const observer = createObserver({ roleSystems: ROLE_SYSTEMS, chatSystem: "CHAT_SYS", overrides: {} });
  const wrapped = observer.wrap(genModel("x"), "rewrite");
  await generateText({ model: wrapped, system: "SOMETHING_ELSE", prompt: "{}" });
  expect(observer.traces.at(-1)!.role).toBe("rewrite:unknown");
});

test("overrides があれば system を差し替え overridden=true", async () => {
  const observer = createObserver({ roleSystems: ROLE_SYSTEMS, chatSystem: "CHAT_SYS", overrides: { grade: "NEW_GRADE" } });
  let sentSystem = "";
  const wrapped = observer.wrap(genModel("x", (s) => { sentSystem = s; }), "rewrite");
  await generateText({ model: wrapped, system: "GRADE_SYS", prompt: "{}" });
  expect(sentSystem).toBe("NEW_GRADE");
  expect(observer.traces.at(-1)!.request.overridden).toBe(true);
  expect(observer.traces.at(-1)!.request.system).toBe("NEW_GRADE");
});

test("chat hint は常に role=chat、structured 出力も text を取得", async () => {
  const observer = createObserver({ roleSystems: ROLE_SYSTEMS, chatSystem: "CHAT_SYS", overrides: {} });
  const wrapped = observer.wrap(genModel('{"relevantIds":["a"]}'), "chat");
  await generateText({
    model: wrapped,
    output: Output.object({ schema: z.object({ relevantIds: z.array(z.string()) }) }),
    system: "CHAT_SYS",
    prompt: "{}",
  });
  expect(observer.traces.at(-1)!.role).toBe("chat");
});

test("stream を消費しつつ全 delta を連結して trace に残す", async () => {
  const observer = createObserver({ roleSystems: ROLE_SYSTEMS, chatSystem: "CHAT_SYS", overrides: {} });
  const model = new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: "text-start", id: "t" },
          { type: "text-delta", id: "t", delta: "Hello " },
          { type: "text-delta", id: "t", delta: "world" },
          { type: "text-end", id: "t" },
          { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 } },
        ] as never,
      }),
    }),
  });
  const wrapped = observer.wrap(model, "chat");
  const result = streamText({ model: wrapped, system: "CHAT_SYS", prompt: "hi" });
  let consumed = "";
  for await (const d of result.textStream) consumed += d;
  expect(consumed).toBe("Hello world");
  expect(observer.traces.at(-1)!.response.text).toBe("Hello world");
});
