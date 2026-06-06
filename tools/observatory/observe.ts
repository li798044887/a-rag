import { wrapLanguageModel, type LanguageModel, type LanguageModelMiddleware } from "ai";

export type Role = "chat" | "grade" | "queryRewrite" | "verify" | "revise";

export interface RoleSystems {
  grade: string;
  queryRewrite: string;
  verify: string;
  revise: string;
}

export interface LlmTrace {
  seq: number;
  role: Role | "rewrite:unknown";
  startedAt: number;
  durationMs: number;
  request: {
    system: string;
    messages: unknown;
    responseFormat?: unknown;
    overridden: boolean;
  };
  response: {
    text: string;
    /** 推論モデルの思考過程（reasoning パート）。無い場合は空。 */
    reasoning?: string;
    toolCalls?: { name: string; input: unknown }[];
    finishReason?: unknown;
    usage?: unknown;
  };
  error?: string;
}

export interface ObserverConfig {
  /** rewrite モデルが取りうる各役割の既定 system 文字列。役割判定に使う。 */
  roleSystems: RoleSystems;
  /** chat モデルの既定 system（参考用。判定は hint=chat で確定）。 */
  chatSystem: string;
  /** 役割ごとの system 上書き。空文字/未指定なら上書きしない。 */
  overrides: Partial<Record<Role, string>>;
  /** trace 確定時に逐次呼ばれる（SSE 送出用）。 */
  onTrace?: (t: LlmTrace) => void;
}

interface PromptMsg {
  role: string;
  content: unknown;
}

function systemOf(prompt: unknown): string {
  const arr = (prompt as PromptMsg[]) ?? [];
  const sys = arr.find((m) => m.role === "system");
  return typeof sys?.content === "string" ? sys.content : "";
}

function setSystem(prompt: unknown, text: string): unknown {
  const arr = [...((prompt as PromptMsg[]) ?? [])];
  const i = arr.findIndex((m) => m.role === "system");
  if (i >= 0) arr[i] = { role: "system", content: text };
  else arr.unshift({ role: "system", content: text });
  return arr;
}

export function createObserver(cfg: ObserverConfig) {
  const traces: LlmTrace[] = [];
  let seq = 0;

  const detect = (system: string, hint: "chat" | "rewrite"): Role | "rewrite:unknown" => {
    if (hint === "chat") return "chat";
    if (system === cfg.roleSystems.grade) return "grade";
    if (system === cfg.roleSystems.queryRewrite) return "queryRewrite";
    if (system === cfg.roleSystems.verify) return "verify";
    if (system === cfg.roleSystems.revise) return "revise";
    return "rewrite:unknown";
  };

  function wrap(model: LanguageModel, hint: "chat" | "rewrite"): LanguageModel {
    const middleware: LanguageModelMiddleware = {
      specificationVersion: "v3",
      transformParams: async ({ params }) => {
        const originalSystem = systemOf(params.prompt);
        const role = detect(originalSystem, hint);
        const overrideKey = role === "rewrite:unknown" ? undefined : (role as Role);
        const override = overrideKey ? cfg.overrides[overrideKey] : undefined;
        const overridden = typeof override === "string" && override.length > 0;
        const t: LlmTrace = {
          seq: ++seq,
          role,
          startedAt: Date.now(),
          durationMs: 0,
          request: {
            system: overridden ? override! : originalSystem,
            messages: params.prompt,
            responseFormat: params.responseFormat,
            overridden,
          },
          response: { text: "" },
        };
        traces.push(t);
        (params as { __traceSeq?: number }).__traceSeq = t.seq;
        if (overridden) {
          return { ...params, prompt: setSystem(params.prompt, override!) as never };
        }
        return params;
      },

      wrapGenerate: async ({ doGenerate, params }) => {
        const t = traces.find((x) => x.seq === (params as { __traceSeq?: number }).__traceSeq);
        try {
          const res = await doGenerate();
          if (t) {
            t.durationMs = Date.now() - t.startedAt;
            const text = res.content
              .filter((c) => c.type === "text")
              .map((c) => (c as { text: string }).text)
              .join("");
            const reasoning = res.content
              .filter((c) => c.type === "reasoning")
              .map((c) => (c as { text: string }).text)
              .join("");
            t.response = {
              text,
              reasoning,
              toolCalls: res.content
                .filter((c) => c.type === "tool-call")
                .map((c) => ({ name: (c as { toolName: string }).toolName, input: (c as { input: unknown }).input })),
              finishReason: res.finishReason,
              usage: res.usage,
            };
            cfg.onTrace?.(t);
          }
          return res;
        } catch (err) {
          if (t) {
            t.error = err instanceof Error ? err.message : String(err);
            t.durationMs = Date.now() - t.startedAt;
            cfg.onTrace?.(t);
          }
          throw err;
        }
      },

      wrapStream: async ({ doStream, params }) => {
        const t = traces.find((x) => x.seq === (params as { __traceSeq?: number }).__traceSeq);
        const { stream, ...rest } = await doStream();
        let text = "";
        let reasoning = "";
        const toolCalls: { name: string; input: unknown }[] = [];
        let finishReason: unknown;
        let usage: unknown;
        const tap = new TransformStream({
          transform(part, controller) {
            const p = part as {
              type: string;
              delta?: string;
              toolName?: string;
              input?: unknown;
              finishReason?: unknown;
              usage?: unknown;
            };
            if (p.type === "text-delta" && typeof p.delta === "string") text += p.delta;
            else if (p.type === "reasoning-delta" && typeof p.delta === "string") reasoning += p.delta;
            else if (p.type === "tool-call") toolCalls.push({ name: p.toolName ?? "", input: p.input });
            else if (p.type === "finish") {
              finishReason = p.finishReason;
              usage = p.usage;
            }
            controller.enqueue(part);
          },
          flush() {
            if (t) {
              t.durationMs = Date.now() - t.startedAt;
              t.response = { text, reasoning, toolCalls, finishReason, usage };
              cfg.onTrace?.(t);
            }
          },
        });
        return { stream: stream.pipeThrough(tap), ...rest };
      },
    };
    return wrapLanguageModel({ model: model as Parameters<typeof wrapLanguageModel>[0]["model"], middleware });
  }

  return { traces, wrap };
}
