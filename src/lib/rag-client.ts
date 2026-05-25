const base = () => process.env.RAG_SERVICE_URL || "http://localhost:8000";
const token = () => process.env.RAG_INTERNAL_TOKEN || "dev-internal-token";

/** Server-only fetch to the rag service with the internal auth header. */
export async function ragFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(base() + path, {
    ...init,
    headers: { "x-internal-token": token(), ...(init.headers || {}) },
  });
}
