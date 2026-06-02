"use client";

import { useEffect, useState } from "react";

// 整形プレビューで読み込む原本テキストの上限。超過分は truncate して全文 DL を案内する。
const MAX_TEXT_PREVIEW_BYTES = 2 * 1024 * 1024;

export interface RawTextState {
  status: "idle" | "loading" | "ready" | "error";
  text: string;
  truncated: boolean;
}

// docId のテキスト原本を /api/documents/[id]/raw から取得する。docId=null で idle。
// docId 変更時に再取得し、競合は cancelled フラグで無視する。
export function useRawText(docId: string | null): RawTextState {
  const [state, setState] = useState<RawTextState>({ status: "idle", text: "", truncated: false });

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!docId) {
        setState({ status: "idle", text: "", truncated: false });
        return;
      }
      setState({ status: "loading", text: "", truncated: false });
      try {
        const res = await fetch(`/api/documents/${encodeURIComponent(docId)}/raw`);
        if (!res.ok) throw new Error(String(res.status));
        const full = await res.text();
        if (cancelled) return;
        const truncated = full.length > MAX_TEXT_PREVIEW_BYTES;
        setState({
          status: "ready",
          text: truncated ? full.slice(0, MAX_TEXT_PREVIEW_BYTES) : full,
          truncated,
        });
      } catch {
        if (!cancelled) setState({ status: "error", text: "", truncated: false });
      }
    };
    void run();
    return () => { cancelled = true; };
  }, [docId]);

  return state;
}
