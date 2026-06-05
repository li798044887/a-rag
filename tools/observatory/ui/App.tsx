import { useEffect, useState } from "react";

type Role = "chat" | "grade" | "queryRewrite" | "verify" | "revise";
const ROLES: Role[] = ["chat", "grade", "queryRewrite", "verify", "revise"];

// アプリの設定>モデルと同じ id（src/lib/data.ts）。プロバイダのキーが要る点に注意。
const MODELS = [
  { id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5 (ANTHROPIC_API_KEY)" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5 (ANTHROPIC_API_KEY)" },
  { id: "gpt-4o", label: "GPT-4o (OPENAI_API_KEY)" },
  { id: "deepseek-flash", label: "DeepSeek Flash (DEEPSEEK_API_KEY)" },
  { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro (DEEPSEEK_API_KEY)" },
];

interface Trace {
  seq: number;
  role: string;
  durationMs: number;
  request: { system: string; messages: unknown; responseFormat?: unknown; overridden: boolean };
  response: { text: string; reasoning?: string; toolCalls?: { name: string; input: unknown }[]; usage?: unknown };
  error?: string;
}

interface AnswerDelta { type: "answer-delta"; text: string }

export function App() {
  const [defaults, setDefaults] = useState<Record<string, string>>({});
  const [overrides, setOverrides] = useState<Partial<Record<Role, string>>>({});
  const [query, setQuery] = useState("");
  const [model, setModel] = useState(MODELS[0].id);
  const [locale, setLocale] = useState("ja");
  const [owner, setOwner] = useState("");
  const [retrieveMode, setRetrieveMode] = useState<"live" | "replay">("replay");
  const [traces, setTraces] = useState<Trace[]>([]);
  const [meta, setMeta] = useState<{ ownerUserId: string; model: string | null; retrieveMode: string } | null>(null);
  const [events, setEvents] = useState<unknown[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`/api/defaults?locale=${locale}`).then((r) => r.json()).then((d) => {
      setDefaults(d);
      setOwner((cur) => cur || d.owner || "");
    }).catch(() => {});
  }, [locale]);

  async function runIt() {
    setTraces([]); setEvents([]); setMeta(null); setError(""); setRunning(true);
    try {
      const res = await fetch("/api/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query, model, locale, retrieveMode, overrides, owner }),
      });
      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";
        for (const p of parts) {
          const line = p.replace(/^data: /, "");
          if (!line) continue;
          const msg = JSON.parse(line);
          if (msg.kind === "meta") {
            setMeta(msg.meta);
          } else if (msg.kind === "trace") {
            setTraces((t) => [...t.filter((x) => x.seq !== msg.trace.seq), msg.trace].sort((a, b) => a.seq - b.seq));
          } else if (msg.kind === "event") {
            setEvents((e) => [...e, msg.event]);
          } else if (msg.kind === "error") {
            setError(msg.message);
          }
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  const answer = events
    .filter((e): e is AnswerDelta => (e as { type?: string }).type === "answer-delta")
    .map((e) => e.text)
    .join("");

  return (
    <>
      <div className="left">
        <h4>観測実行</h4>
        <div className="row">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="質問" style={{ flex: 1 }} />
          <button disabled={running || !query} onClick={runIt}>{running ? "実行中…" : "▶ Run"}</button>
        </div>
        <div className="row">
          <label style={{ flex: 1 }}>model
            <select value={model} onChange={(e) => setModel(e.target.value)} style={{ width: "100%" }}>
              {MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </label>
        </div>
        <div className="row">
          <label>locale
            <select value={locale} onChange={(e) => setLocale(e.target.value)}>
              <option value="ja">ja</option>
              <option value="zh">zh</option>
            </select>
          </label>
          <label>retrieve
            <select value={retrieveMode} onChange={(e) => setRetrieveMode(e.target.value as "live" | "replay")}>
              <option value="replay">replay</option>
              <option value="live">live</option>
            </select>
          </label>
        </div>
        <div className="row">
          <label style={{ flex: 1 }}>owner
            <input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="検索スコープの owner id" style={{ width: "100%" }} />
          </label>
        </div>
        {error && <pre className="err">{error}</pre>}

        <h4>プロンプト上書き</h4>
        {ROLES.map((r) => (
          <details key={r}>
            <summary>{r}{overrides[r] != null ? " *" : ""}</summary>
            <textarea
              value={overrides[r] ?? defaults[r] ?? ""}
              onChange={(e) => setOverrides((o) => ({ ...o, [r]: e.target.value }))}
            />
            <button onClick={() => setOverrides((o) => { const n = { ...o }; delete n[r]; return n; })}>既定に戻す</button>
          </details>
        ))}
      </div>

      <div className="right">
        {meta && (
          <div style={{ background: "#eee", padding: "4px 8px", borderRadius: 4, marginBottom: 8 }}>
            実行設定: owner=<b>{meta.ownerUserId}</b> / model={meta.model ?? "(既定)"} / retrieve={meta.retrieveMode}
          </div>
        )}
        <h4>実行トレース（{traces.length}）</h4>
        {traces.map((t) => (
          <div className="trace" key={t.seq}>
            <span className="role">{t.seq} {t.role}</span>{" "}
            {t.request.overridden && <span className="badge">overridden</span>}{" "}
            <small>{t.durationMs}ms</small>
            {t.error && <pre className="err">{t.error}</pre>}
            <details><summary>送信 system</summary><pre>{t.request.system}</pre></details>
            <details><summary>送信 messages</summary><pre>{JSON.stringify(t.request.messages, null, 2)}</pre></details>
            {t.response.reasoning && (
              <details open><summary>思考過程（reasoning）</summary><pre>{t.response.reasoning}</pre></details>
            )}
            <details open><summary>出力</summary><pre>{t.response.text || "(空)"}</pre></details>
            {t.response.toolCalls && t.response.toolCalls.length > 0 && (
              <details><summary>tool-calls</summary><pre>{JSON.stringify(t.response.toolCalls, null, 2)}</pre></details>
            )}
            <details><summary>usage</summary><pre>{JSON.stringify(t.response.usage, null, 2)}</pre></details>
          </div>
        ))}

        <h4>最終回答</h4>
        <pre>{answer || "(まだありません)"}</pre>
        <button onClick={() => navigator.clipboard.writeText(JSON.stringify({ traces, events }, null, 2))}>
          トレース全体をコピー
        </button>
      </div>
    </>
  );
}
