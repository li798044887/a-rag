import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export interface ReplayOptions {
  mode: "live" | "replay";
  dir: string;
  /** 既定は実 fetch。テストでは差し替える。 */
  upstream?: typeof fetch;
}

interface Snapshot {
  status: number;
  headers: [string, string][];
  bodyB64: string;
}

function keyOf(url: string, init?: RequestInit): string {
  const method = (init?.method ?? "GET").toUpperCase();
  const path = new URL(url, "http://x").pathname;
  const body = typeof init?.body === "string" ? init.body : "";
  // JSON ボディはキー順を正規化して同条件が同キーになるようにする。
  let canon = body;
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    canon = JSON.stringify(parsed, Object.keys(parsed).sort());
  } catch {
    // 非 JSON はそのまま。
  }
  return createHash("sha256").update(`${method}:${path}:${canon}`).digest("hex").slice(0, 32);
}

async function toSnapshot(res: Response): Promise<Snapshot> {
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, headers: [...res.headers.entries()], bodyB64: buf.toString("base64") };
}

function fromSnapshot(s: Snapshot): Response {
  return new Response(Buffer.from(s.bodyB64, "base64"), { status: s.status, headers: s.headers });
}

export function createReplayTransport(opts: ReplayOptions): typeof fetch {
  mkdirSync(opts.dir, { recursive: true });
  const up = opts.upstream ?? fetch;
  const transport = (async (input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const file = join(opts.dir, keyOf(url, init) + ".json");
    if (opts.mode === "replay" && existsSync(file)) {
      return fromSnapshot(JSON.parse(readFileSync(file, "utf8")) as Snapshot);
    }
    // live、または replay で未保存：上流を呼び全バイトをバッファして保存し、複製を返す。
    const res = await up(input as never, init);
    const snap = await toSnapshot(res);
    writeFileSync(file, JSON.stringify(snap));
    return fromSnapshot(snap);
  }) as typeof fetch;
  return transport;
}
