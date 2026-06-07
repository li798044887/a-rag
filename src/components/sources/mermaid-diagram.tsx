"use client";

import { useEffect, useRef, useState } from "react";

// mermaid は重いので動的 import で遅延読込し、初回のみ初期化する。
// securityLevel: "strict" で生成 SVG をサニタイズする（KaTeX 同様、生成済み HTML のみ描画）。
let mermaidPromise: Promise<typeof import("mermaid").default> | null = null;
function getMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((m) => {
      m.default.initialize({
        startOnLoad: false,
        theme: "dark",
        securityLevel: "strict",
        fontFamily: "inherit",
      });
      return m.default;
    });
  }
  return mermaidPromise;
}

let seq = 0;

const codeFallbackCls =
  "my-1 overflow-x-auto rounded-[8px] border-[0.5px] border-divider bg-surface-2 p-3 font-mono text-[12px]";

// 描画結果は対象 code 付きで持ち、code 変更時の同期リセットを避ける
// （古い code の結果は照合で無視する）。
type RenderResult = { code: string; svg: string } | { code: string; failed: true };

/** mermaid 記法（```mermaid ブロックの中身）を SVG 図として描画する。
 *  クライアント専用。描画前/失敗時は元コードをコードブロックでフォールバック表示する。 */
export function MermaidDiagram({ code }: { code: string }) {
  const [result, setResult] = useState<RenderResult | null>(null);
  const idRef = useRef(`mermaid-${seq++}`);

  useEffect(() => {
    let alive = true;
    getMermaid()
      .then((mermaid) => mermaid.render(idRef.current, code))
      .then(({ svg }) => {
        if (alive) setResult({ code, svg });
      })
      .catch(() => {
        if (alive) setResult({ code, failed: true });
      });
    return () => {
      alive = false;
    };
  }, [code]);

  const ready = result?.code === code ? result : null;
  if (ready && "svg" in ready) {
    return (
      <div
        className="my-1 overflow-x-auto rounded-[8px] border-[0.5px] border-divider bg-surface-2 p-3"
        // mermaid が securityLevel:strict で生成・サニタイズした SVG。
        dangerouslySetInnerHTML={{ __html: ready.svg }}
      />
    );
  }
  // 読込中（薄字）/失敗時（通常字）はいずれも元コードを表示する。
  return (
    <pre className={`${codeFallbackCls} ${ready ? "" : "text-muted"}`}>
      <code>{code}</code>
    </pre>
  );
}
