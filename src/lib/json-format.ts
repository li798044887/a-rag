export type JsonTokenType = "key" | "string" | "number" | "boolean" | "null" | "text";
export interface JsonToken {
  type: JsonTokenType;
  value: string;
}

// JSON 文字列を parse → 2スペース整形。失敗時は ok:false。
export function prettyJson(raw: string): { ok: true; text: string } | { ok: false } {
  try {
    return { ok: true, text: JSON.stringify(JSON.parse(raw), null, 2) };
  } catch {
    return { ok: false };
  }
}

// 文字列・真偽・null・数値にマッチ。文字列がコロンに続く場合はキー。
const JSON_TOKEN_RE =
  /"(?:\\.|[^"\\])*"|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;

// 整形済み JSON 文字列を色分け用トークン列へ分解する。text トークン（区切り・空白）も含め、
// 連結すると元の文字列に一致する。
export function tokenizeJson(pretty: string): JsonToken[] {
  const tokens: JsonToken[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  JSON_TOKEN_RE.lastIndex = 0;
  while ((m = JSON_TOKEN_RE.exec(pretty)) !== null) {
    if (m.index > last) tokens.push({ type: "text", value: pretty.slice(last, m.index) });
    const v = m[0];
    let type: JsonTokenType;
    if (v[0] === '"') {
      // 直後（空白を飛ばして）が ':' ならキー。
      type = /^\s*:/.test(pretty.slice(m.index + v.length)) ? "key" : "string";
    } else if (v === "true" || v === "false") {
      type = "boolean";
    } else if (v === "null") {
      type = "null";
    } else {
      type = "number";
    }
    tokens.push({ type, value: v });
    last = m.index + v.length;
  }
  if (last < pretty.length) tokens.push({ type: "text", value: pretty.slice(last) });
  return tokens;
}

// JSONL/NDJSON を空行を除いた行配列へ分割する。
export function splitJsonl(raw: string): string[] {
  return raw.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
}
