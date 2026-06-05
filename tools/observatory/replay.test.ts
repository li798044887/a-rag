import { afterEach, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createReplayTransport } from "./replay";

const dirs: string[] = [];
function tmp() {
  const d = mkdtempSync(join(tmpdir(), "obs-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

test("live: 実 fetch を呼び応答を保存し、同内容を返す", async () => {
  const dir = tmp();
  let hits = 0;
  const upstream = (async () => {
    hits++;
    return new Response(JSON.stringify({ chunks: [{ id: "c1" }] }), { headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const t = createReplayTransport({ mode: "live", dir, upstream });
  const res = await t("http://rag/retrieve", { method: "POST", body: JSON.stringify({ query: "x" }) });
  expect(await res.json()).toEqual({ chunks: [{ id: "c1" }] });
  expect(hits).toBe(1);
});

test("replay: 保存済みは upstream を呼ばず再生、未保存は live フォールバックして保存", async () => {
  const dir = tmp();
  let hits = 0;
  const upstream = (async () => {
    hits++;
    return new Response("RESP-" + hits, {});
  }) as typeof fetch;
  const live = createReplayTransport({ mode: "live", dir, upstream });
  await live("http://rag/retrieve", { method: "POST", body: JSON.stringify({ query: "x" }) }); // 保存
  const replay = createReplayTransport({ mode: "replay", dir, upstream });
  const r1 = await replay("http://rag/retrieve", { method: "POST", body: JSON.stringify({ query: "x" }) });
  expect(await r1.text()).toBe("RESP-1"); // 再生（upstream 不使用）
  expect(hits).toBe(1);
  const r2 = await replay("http://rag/retrieve", { method: "POST", body: JSON.stringify({ query: "NEW" }) });
  expect(await r2.text()).toBe("RESP-2"); // 未保存 → live フォールバック
  expect(hits).toBe(2);
});

test("JSON ボディのキー順が違っても同一キーになる", async () => {
  const dir = tmp();
  let hits = 0;
  const upstream = (async () => {
    hits++;
    return new Response("R" + hits, {});
  }) as typeof fetch;
  const live = createReplayTransport({ mode: "live", dir, upstream });
  await live("http://rag/retrieve", { method: "POST", body: JSON.stringify({ a: 1, b: 2 }) });
  const replay = createReplayTransport({ mode: "replay", dir, upstream });
  const r = await replay("http://rag/retrieve", { method: "POST", body: JSON.stringify({ b: 2, a: 1 }) });
  expect(await r.text()).toBe("R1"); // キー順が逆でも再生
  expect(hits).toBe(1);
});
