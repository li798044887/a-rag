import type { ModelMessage } from "ai";

export interface HistoryTurn {
  query: string;
  answerText: string;
}

/** 過去ターン（古い順）を直近 maxTurns に窓掛けして user/assistant メッセージ列へ変換。
 *  回答が空のターン（実行中/失敗）は履歴から除外する。 */
export function toModelHistory(turns: HistoryTurn[], maxTurns: number): ModelMessage[] {
  const valid = turns.filter((t) => t.answerText.trim().length > 0);
  const windowed = valid.slice(-maxTurns);
  const out: ModelMessage[] = [];
  for (const t of windowed) {
    out.push({ role: "user", content: t.query });
    out.push({ role: "assistant", content: t.answerText });
  }
  return out;
}
