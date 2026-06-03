import { PlainTextView } from "@/components/documents/plain-text-view";
import { prettyJson, splitJsonl, tokenizeJson, type JsonTokenType } from "@/lib/json-format";
import { useT } from "@/i18n/context";

const TOKEN_COLOR: Record<JsonTokenType, string> = {
  key: "text-accent",
  string: "text-[#1F7244]",
  number: "text-[#7A5AE0]",
  boolean: "text-[#B83A1F]",
  null: "text-muted",
  text: "text-fg-2",
};

/** 整形済み JSON 文字列を色分けして 1ブロック描画する（共通部品）。 */
function HighlightedJson({ pretty }: { pretty: string }) {
  return (
    <pre className="m-0 overflow-x-auto whitespace-pre rounded-[8px] border-[0.5px] border-divider bg-surface-2 p-3 font-mono text-[12px] leading-[1.6]">
      {tokenizeJson(pretty).map((t, i) => (
        <span key={i} className={TOKEN_COLOR[t.type]}>{t.value}</span>
      ))}
    </pre>
  );
}

/** 単一 JSON。パース不能ならプレーンテキストへフォールバック。 */
export function JsonView({ text }: { text: string }) {
  const { t } = useT();
  const r = prettyJson(text);
  if (!r.ok) {
    return (
      <div className="p-5">
        <div className="mb-2 text-[11.5px] text-muted">{t.documents.jsonParseError}</div>
        <PlainTextView text={text} />
      </div>
    );
  }
  return <div className="p-5"><HighlightedJson pretty={r.text} /></div>;
}

/** JSONL/NDJSON。行ごとに整形ブロックを連番付きで描画。パース不能行は生表示。 */
export function JsonlView({ text }: { text: string }) {
  const { t } = useT();
  const lines = splitJsonl(text);
  if (!lines.length) {
    return <div className="p-5 text-[12px] text-muted">{t.documents.previewEmpty}</div>;
  }
  return (
    <div className="flex flex-col gap-3 p-5">
      {lines.map((line, i) => {
        const r = prettyJson(line);
        return (
          <div key={i}>
            <div className="mb-1 font-mono text-[10.5px] text-muted-2">#{i + 1}</div>
            {r.ok ? (
              <HighlightedJson pretty={r.text} />
            ) : (
              <pre className="m-0 overflow-x-auto whitespace-pre-wrap rounded-[8px] border-[0.5px] border-[rgba(184,58,31,0.4)] bg-surface-2 p-3 font-mono text-[12px] text-fg-2">{line}</pre>
            )}
          </div>
        );
      })}
    </div>
  );
}
