"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DocumentListResponse, DocumentSummary } from "@/lib/types";
import type { PushToast } from "@/hooks/use-toasts";

/** ページ追記時に id 重複を除いてマージする純粋関数。 */
export function mergeNextPage(prev: DocumentSummary[], next: DocumentSummary[]): DocumentSummary[] {
  const seen = new Set(prev.map((d) => d.id));
  return [...prev, ...next.filter((d) => !seen.has(d.id))];
}

/** items から ids に一致する文書を除去し、除去件数も返す純粋関数。 */
export function removeByIds(items: DocumentSummary[], ids: string[]): { items: DocumentSummary[]; removed: number } {
  const idSet = new Set(ids);
  const next = items.filter((d) => !idSet.has(d.id));
  return { items: next, removed: items.length - next.length };
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
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);

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
    const prevTotal = total;
    setItems((cur) => cur.filter((d) => d.id !== id));
    setTotal((t) => Math.max(0, t - 1));
    const r = await fetch(`/api/documents/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => null);
    if (!r || !r.ok) {
      setItems(prev);
      setTotal(prevTotal);
      onToastRef.current?.("削除に失敗しました", "error");
      return;
    }
    onToastRef.current?.("文書を削除しました", "success");
  }, [items, total]);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);
  const selectAllVisible = useCallback(() => setSelectedIds(new Set(items.map((d) => d.id))), [items]);
  const enterSelection = useCallback(() => setSelectionMode(true), []);
  const exitSelection = useCallback(() => { setSelectionMode(false); setSelectedIds(new Set()); }, []);

  const removeMany = useCallback(async (ids: string[]) => {
    if (!ids.length) return;
    const prev = items;
    const prevTotal = total;
    const { items: next, removed } = removeByIds(items, ids);
    setItems(next);
    setTotal((t) => Math.max(0, t - removed));
    setDeleting(true);
    try {
      const r = await fetch("/api/documents/bulk-delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ document_ids: ids }),
      }).catch(() => null);
      if (!r || !r.ok) {
        setItems(prev);
        setTotal(prevTotal);
        onToastRef.current?.("削除に失敗しました", "error");
        return;
      }
      onToastRef.current?.(`${removed}件の文書を削除しました`, "success");
      setSelectionMode(false);
      setSelectedIds(new Set());
    } finally {
      setDeleting(false);
    }
  }, [items, total]);

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

  const allVisibleSelected = items.length > 0 && items.every((d) => selectedIds.has(d.id));

  return {
    items, total, nextCursor, loading, query, statusFilter,
    setQuery, setStatusFilter, load, loadMore, remove, retry,
    selectionMode, selectedIds, allVisibleSelected, deleting,
    enterSelection, exitSelection, toggleSelect, clearSelection, selectAllVisible, removeMany,
  };
}
