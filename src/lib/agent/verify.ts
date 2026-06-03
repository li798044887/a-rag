/** 生成回答の根拠検証（groundedness）と訂正再生成。
 *  回答中の主張を出典 snippet と突合し、未裏付けがあれば（上限内で）出典のみに基づき書き直す。 */
import { generateText, Output, type LanguageModel } from "ai";
import { z } from "zod";
import type { AgentPrompts } from "@/lib/agent/prompts";

export interface VerifySource {
  n: number;
  title: string;
  heading: string;
  snippet: string;
}

export interface VerifyResult {
  /** 出典で裏付けられない主張。 */
  unsupported: string[];
  /** 訂正再生成した本文（行わなかった場合は null）。 */
  revised: string | null;
}

export async function verifyAnswer(input: {
  query: string;
  answer: string;
  sources: VerifySource[];
  model: LanguageModel;
  prompts: AgentPrompts;
  maxRevisions: number;
}): Promise<VerifyResult> {
  const { query, answer, sources, model, prompts, maxRevisions } = input;

  let unsupported: string[] = [];
  try {
    const { output } = await generateText({
      model,
      output: Output.object({ schema: z.object({ unsupported: z.array(z.string()) }) }),
      system: prompts.verify.system,
      prompt: JSON.stringify({ query, answer, sources }),
    });
    unsupported = output.unsupported;
  } catch {
    // 検証失敗時は素通し（回答は必ず出す方針）。
    return { unsupported: [], revised: null };
  }

  if (unsupported.length === 0 || maxRevisions <= 0) {
    return { unsupported, revised: null };
  }

  try {
    const { text } = await generateText({
      model,
      system: prompts.revise.system,
      prompt: JSON.stringify({ answer, unsupported, sources }),
    });
    return { unsupported, revised: text.trim() || null };
  } catch {
    return { unsupported, revised: null };
  }
}
