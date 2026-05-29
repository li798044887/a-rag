import type { Source, Turn } from "@/lib/types";

/** スレッド全ターンを Markdown 化する。各ターンの Q&A を順に並べ、出典は id で重複排除して末尾に一覧化。 */
export function buildThreadMarkdown(turns: Turn[]): string {
  if (turns.length === 0) return "";

  const body = turns
    .map((t) => `## ${t.query}\n\n${t.answer}`)
    .join("\n\n---\n\n");

  const seen = new Set<string>();
  const sources: Source[] = [];
  for (const t of turns) {
    for (const s of t.sources) {
      if (seen.has(s.id)) continue;
      seen.add(s.id);
      sources.push(s);
    }
  }

  const refs = sources.length
    ? `\n\n---\n\n## 参考資料\n${sources.map((s, i) => `[${i + 1}] ${s.title} (${s.path})`).join("\n")}\n`
    : "\n";

  return `${body}${refs}`;
}
