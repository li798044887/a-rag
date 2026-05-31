"use client";

import katex from "katex";
import type { ReactNode } from "react";

export function renderTexToHtml(tex: string, display: boolean): string | null {
  try {
    return katex.renderToString(tex.trim(), { displayMode: display, throwOnError: false });
  } catch {
    return null;
  }
}

/** 文字列中の TeX 数式（$$…$$ ディスプレイ / $…$ インライン）を KaTeX で描画し、
 *  数式以外はそのまま返す。ラッパ要素は付けず、断片（テキスト＋数式 span）を返す。 */
export function TeXText({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const m of text.matchAll(/\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g)) {
    const idx = m.index ?? 0;
    if (idx > last) parts.push(text.slice(last, idx));
    const display = m[1] !== undefined;
    const html = renderTexToHtml(display ? m[1] : m[2], display);
    if (html) {
      parts.push(
        <span
          key={`m${key++}`}
          className={display ? "my-2 block overflow-x-auto" : ""}
          dangerouslySetInnerHTML={{ __html: html }}
        />,
      );
    } else {
      parts.push(m[0]); // 解析失敗時は生のまま
    }
    last = idx + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

/** MinerU の equation ブロックは `$...$` なしの LaTeX として保存されるため、
 *  文字列全体をディスプレイ数式として描画する。 */
export function TeXBlock({ text }: { text: string }) {
  const html = renderTexToHtml(text, true);
  if (!html) {
    return <div className="whitespace-pre-wrap text-[12.5px] leading-[1.65] text-fg-2 [overflow-wrap:anywhere]">{text}</div>;
  }
  return (
    <div
      className="my-2 overflow-x-auto rounded-[8px] border-[0.5px] border-divider bg-surface px-3 py-2 text-fg"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
