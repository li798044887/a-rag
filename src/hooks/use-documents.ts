"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DocumentListResponse, DocumentSummary } from "@/lib/types";
import type { PushToast } from "@/hooks/use-toasts";

/** ページ追記時に id 重複を除いてマージする純粋関数。 */
export function mergeNextPage(prev: DocumentSummary[], next: DocumentSummary[]): DocumentSummary[] {
  const seen = new Set(prev.map((d) => d.id));
  return [...prev, ...next.filter((d) => !seen.has(d.id))];
}

const PENDING = new Set(["queued", "processing", "parsing", "chunking", "embedding", "indexing"]);

/** 文書一覧の取得・検索・ページング・削除・再索引・状態ポーリングを担うデータ層。 */
export function useDocuments(open: boolean, onToast?: PushToast) {
  const [items, setItems] = useState<DocumentSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string | null>(null);

  const onToastRef = useRef(onToast);
  useEffect(() => { onToastRef.current = onToast; }, [onToast]);

  const buildQs = useCallback((cursor?: string | null) => {
    const qs = new URLSearchParams({ limit: "30" });
    if (query.trim()) qs.set("q", query.trim());
    if (statusFilter) qs.set("status", statusFilter);
    if (cursor) qs.set("cursor", cursor);
    return qs.toString();
  }, [query, statusFilter]);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetch(`/api/documents?${buildQs()}`).catch(() => null);
    setLoading(false);
    if (!r || !r.ok) return;
    const j = (await r.json()) as DocumentListResponse;
    setItems(j.items);
    setTotal(j.total);
    setNextCursor(j.next_cursor);
  }, [buildQs]);

  const loadMore = useCallback(async () => {
    if (!nextCursor) return;
    const r = await fetch(`/api/documents?${buildQs(nextCursor)}`).catch(() => null);
    if (!r || !r.ok) return;
    const j = (await r.json()) as DocumentListResponse;
    setItems((prev) => mergeNextPage(prev, j.items));
    setTotal(j.total);
    setNextCursor(j.next_cursor);
  }, [buildQs, nextCursor]);

  // モーダルが開いている間、検索/フィルタ変更で先頭から再取得（デバウンス）。
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [open, load]);

  const remove = useCallback(async (id: string) => {
    const prev = items;
    setItems((cur) => cur.filter((d) => d.id !== id));
    setTotal((t) => Math.max(0, t - 1));
    const r = await fetch(`/api/documents/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => null);
    if (!r || !r.ok) {
      setItems(prev);
      setTotal(prev.length);
      onToastRef.current?.("削除に失敗しました", "error");
      return;
    }
    onToastRef.current?.("文書を削除しました", "success");
  }, [items]);

  const retry = useCallback(async (jobId: string, id: string) => {
    setItems((cur) => cur.map((d) => (d.id === id ? { ...d, status: "processing", error: null } : d)));
    const r = await fetch(`/api/uploads/${encodeURIComponent(jobId)}/retry`, { method: "POST" }).catch(() => null);
    if (!r || !r.ok) onToastRef.current?.("再索引に失敗しました", "error");
  }, []);

  // 表示中かつ未完了の文書だけをポーリングして状態を更新する。
  useEffect(() => {
    if (!open) return;
    const pending = items.filter((d) => PENDING.has(d.status) && d.latest_job_id);
    if (!pending.length) return;
    const t = setInterval(async () => {
      for (const d of pending) {
        const r = await fetch(`/api/uploads/${encodeURIComponent(d.latest_job_id!)}`).catch(() => null);
        if (!r || !r.ok) continue;
        const j = (await r.json()) as { status: string; chunks?: number; page_count?: number | null; error?: string };
        setItems((cur) => cur.map((x) => (x.id === d.id ? {
          ...x, status: j.status, chunk_count: j.chunks ?? x.chunk_count,
          page_count: j.page_count ?? x.page_count, error: j.error ?? null,
        } : x)));
      }
    }, 1500);
    return () => clearInterval(t);
  }, [open, items]);

  return {
    items, total, nextCursor, loading, query, statusFilter,
    setQuery, setStatusFilter, load, loadMore, remove, retry,
  };
}
