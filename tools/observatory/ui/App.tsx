import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

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

interface StepObj {
  id: string; name: string; label: string; status: "running" | "done" | "error";
  durationMs: number; parentId?: string; summary?: string; output?: unknown;
}
interface StepEvent { type: "step"; step: StepObj }
interface AnswerDelta { type: "answer-delta"; text: string }

/** JSON としてパースできれば整形して返す（structured 出力を読みやすく）。 */
function prettyMaybe(text: string): string {
  const s = text.trim();
  if (!s || (s[0] !== "{" && s[0] !== "[")) return text;
  try { return JSON.stringify(JSON.parse(s), null, 2); } catch { return text; }
}

/** usage から入出力トークンを最善努力で取り出す。 */
function tokenLine(usage: unknown): string | null {
  if (!usage || typeof usage !== "object") return null;
  const u = usage as Record<string, unknown>;
  const pick = (v: unknown): number | undefined => {
    if (typeof v === "number") return v;
    if (v && typeof v === "object" && typeof (v as { total?: unknown }).total === "number") return (v as { total: number }).total;
    return undefined;
  };
  const inp = pick(u.inputTokens); const out = pick(u.outputTokens);
  if (inp == null && out == null) return null;
  return `↓${inp ?? "?"} ↑${out ?? "?"}`;
}

export function App() {
  const [defaults, setDefaults] = useState<Record<string, string>>({});
  const [overrides, setOverrides] = useState<Partial<Record<Role, string>>>({});
  const [query, setQuery] = useState("");
  const [model, setModel] = useState(MODELS[0].id);
  const [locale, setLocale] = useState("ja");
  const [owner, setOwner] = useState("");
  const [retrieveMode, setRetrieveMode] = useState<"live" | "replay">("replay");
  const [multiHop, setMultiHop] = useState(false);
  // /api/defaults が返す完全な AgentCfg。multiHop だけ差し替えて /api/run へ送る
  // （runAgent は cfg を無 clamp で信頼するため、部分 cfg ではなく完全形を渡す必要がある）。
  const [baseCfg, setBaseCfg] = useState<Record<string, unknown> | null>(null);
  const [traces, setTraces] = useState<Trace[]>([]);
  const [meta, setMeta] = useState<{ ownerUserId: string; model: string | null; retrieveMode: string } | null>(null);
  const [events, setEvents] = useState<unknown[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState<"idle" | "ok" | "fail">("idle");

  // トレース全体を JSON でクリップボードへ。成否をボタン文言で短時間フィードバックする。
  async function copyTrace() {
    const text = JSON.stringify({ meta, traces, events }, null, 2);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        // セキュアコンテキスト外など clipboard API 不在時のフォールバック。
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(ta);
        if (!ok) throw new Error("execCommand failed");
      }
      setCopied("ok");
    } catch {
      setCopied("fail");
    }
    setTimeout(() => setCopied("idle"), 1500);
  }

  useEffect(() => {
    fetch(`/api/defaults?locale=${locale}`).then((r) => r.json()).then((d) => {
      setDefaults(d);
      setBaseCfg((d.cfg as Record<string, unknown>) ?? null);
      setOwner((cur) => cur || d.owner || "");
    }).catch(() => {});
  }, [locale]);

  async function runIt() {
    setTraces([]); setEvents([]); setMeta(null); setError(""); setRunning(true);
    try {
      // baseCfg があれば multiHop を差し替えた完全 cfg を送る。未ロード時は cfg を送らず
      // サーバ既定（AGENT_CFG_DEFAULTS, multiHop=false）に委ねる（既定 OFF と等価）。
      const cfg = baseCfg ? { ...baseCfg, multiHop } : undefined;
      const res = await fetch("/api/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query, model, locale, retrieveMode, overrides, owner, ...(cfg ? { cfg } : {}) }),
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
          if (msg.kind === "meta") setMeta(msg.meta);
          else if (msg.kind === "trace") setTraces((t) => [...t.filter((x) => x.seq !== msg.trace.seq), msg.trace].sort((a, b) => a.seq - b.seq));
          else if (msg.kind === "event") setEvents((e) => [...e, msg.event]);
          else if (msg.kind === "error") setError(msg.message);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  // step イベントを id で集約（running→done を上書き）し、初出順＋親子の深さで描く。
  const steps = useMemo(() => {
    const byId = new Map<string, StepObj>();
    const order: string[] = [];
    for (const e of events) {
      if ((e as { type?: string }).type !== "step") continue;
      const s = (e as StepEvent).step;
      if (!byId.has(s.id)) order.push(s.id);
      byId.set(s.id, s);
    }
    const depth = (s: StepObj): number => {
      let d = 0; let p = s.parentId;
      while (p && byId.has(p)) { d++; p = byId.get(p)!.parentId; }
      return d;
    };
    return order.map((id) => ({ s: byId.get(id)!, depth: depth(byId.get(id)!) }));
  }, [events]);

  const answer = useMemo(() => events
    .filter((e): e is AnswerDelta => (e as { type?: string }).type === "answer-delta")
    .map((e) => e.text).join(""), [events]);

  return (
    <>
      <div className="left">
        <h4>観測実行</h4>
        <div className="row">
          <div style={{ flex: 1 }}>
            <label>質問</label>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="質問を入力" />
          </div>
          <button className="primary" disabled={running || !query} onClick={runIt}>{running ? "実行中…" : "▶ Run"}</button>
        </div>
        <div className="row">
          <div style={{ flex: 1 }}>
            <label>model</label>
            <select value={model} onChange={(e) => setModel(e.target.value)}>
              {MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </div>
        </div>
        <div className="row">
          <div style={{ flex: 1 }}>
            <label>locale</label>
            <select value={locale} onChange={(e) => setLocale(e.target.value)}>
              <option value="ja">ja</option>
              <option value="zh">zh</option>
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label>retrieve</label>
            <select value={retrieveMode} onChange={(e) => setRetrieveMode(e.target.value as "live" | "replay")}>
              <option value="replay">replay</option>
              <option value="live">live</option>
            </select>
          </div>
        </div>
        <div className="row">
          <div style={{ flex: 1 }}>
            <label>owner（検索スコープ）</label>
            <input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="owner id" />
          </div>
        </div>
        <div className="row">
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input type="checkbox" checked={multiHop} onChange={(e) => setMultiHop(e.target.checked)} />
            多ホップ（multi_hop / hop-2 を発火・検索ステップに「2 ホップ目」が出る）
          </label>
        </div>
        {error && <pre className="err">{error}</pre>}

        <h4>プロンプト上書き</h4>
        {ROLES.map((r) => (
          <details key={r}>
            <summary>{r}{overrides[r] != null ? " ✎" : ""}</summary>
            <textarea
              value={overrides[r] ?? defaults[r] ?? ""}
              onChange={(e) => setOverrides((o) => ({ ...o, [r]: e.target.value }))}
            />
            <button className="link" onClick={() => setOverrides((o) => { const n = { ...o }; delete n[r]; return n; })}>既定に戻す</button>
          </details>
        ))}
      </div>

      <div className="right">
        {meta && (
          <div className="meta">
            owner=<b>{meta.ownerUserId}</b> · model={meta.model ?? "(既定)"} · retrieve={meta.retrieveMode}
          </div>
        )}

        {steps.length > 0 && (
          <>
            <h4>エージェント / 検索ステップ</h4>
            <div className="steps">
              {steps.map(({ s, depth }) => {
                const ico = s.status === "done" ? <span className="ico ok">✓</span>
                  : s.status === "error" ? <span className="ico er">✕</span>
                  : <span className="ico run">◌</span>;
                return (
                  <div className="step" key={s.id} style={{ paddingLeft: 4 + depth * 18 }}>
                    {ico}
                    <span className="nm">{s.name}</span>
                    <span className="sum">{s.summary ?? s.label}</span>
                    {s.durationMs > 0 && <span className="ms">{s.durationMs}ms</span>}
                  </div>
                );
              })}
            </div>
          </>
        )}

        <h4>LLM トレース（{traces.length}）</h4>
        {traces.map((t, i) => {
          const prev = traces[i - 1];
          const isRetry = prev && prev.role === t.role && !!prev.error;
          const tok = tokenLine(t.response.usage);
          const cls = `trace ${t.error ? "failed" : t.role}`;
          return (
            <div className={cls} key={t.seq}>
              <div className="thead">
                <span className="seq">#{t.seq}</span>
                <span className="role">{t.role}</span>
                {t.request.overridden && <span className="chip amber">上書き</span>}
                {isRetry && <span className="chip blue">リトライ</span>}
                {t.error && <span className="chip red">失敗</span>}
                <span className="tok">{tok ? `${tok} · ` : ""}{t.durationMs}ms</span>
              </div>
              {t.error && <pre className="err">{t.error}</pre>}
              {t.response.reasoning && (
                <details open><summary>思考過程（reasoning）</summary><pre className="reason">{t.response.reasoning}</pre></details>
              )}
              {!t.error && (
                <details open><summary>出力</summary><pre>{prettyMaybe(t.response.text) || "(空)"}</pre></details>
              )}
              {t.response.toolCalls && t.response.toolCalls.length > 0 && (
                <details><summary>tool-calls</summary><pre>{JSON.stringify(t.response.toolCalls, null, 2)}</pre></details>
              )}
              <details><summary>送信 system</summary><pre>{t.request.system}</pre></details>
              <details><summary>送信 messages</summary><pre>{JSON.stringify(t.request.messages, null, 2)}</pre></details>
              <details><summary>usage</summary><pre>{JSON.stringify(t.response.usage, null, 2)}</pre></details>
            </div>
          );
        })}

        <h4>最終回答</h4>
        {answer
          ? <div className="md"><ReactMarkdown remarkPlugins={[remarkGfm]}>{answer}</ReactMarkdown></div>
          : <div className="md" style={{ color: "#9aa1ab" }}>(まだありません)</div>}
        <div style={{ marginTop: 10 }}>
          <button onClick={copyTrace}>
            {copied === "ok" ? "コピーしました" : copied === "fail" ? "コピーに失敗しました" : "トレース全体をコピー"}
          </button>
        </div>
      </div>
    </>
  );
}
