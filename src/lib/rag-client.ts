const base = () => process.env.RAG_SERVICE_URL || "http://localhost:8000";
const token = () => process.env.RAG_INTERNAL_TOKEN || "dev-internal-token";

/** dev 限定で rag への transport を差し替えるためのフック（snapshot/replay 用）。 */
let transport: typeof fetch | null = null;

/** 観測ツールから rag 通信を横取りする。本番では差し替えを拒否する安全弁付き。 */
export function setRagTransport(t: typeof fetch | null): void {
  if (process.env.NODE_ENV === "production" && t) {
    throw new Error("setRagTransport is dev-only");
  }
  transport = t;
}

/** Server-only fetch to the rag service with the internal auth header. */
export async function ragFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const f = transport ?? fetch;
  return f(base() + path, {
    ...init,
    headers: { "x-internal-token": token(), ...(init.headers || {}) },
  });
}
