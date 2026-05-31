"use client";

import { useEffect, useMemo, useState } from "react";
import katex from "katex";
import { Icon } from "@/components/icons";
import { HtmlTable } from "@/components/sources/html-table";
import { parseSectionBody } from "@/components/sources/parse-section-body";
import { useConfirm } from "@/hooks/use-confirm";
import { useDocuments } from "@/hooks/use-documents";
import { getFileMeta } from "@/lib/file-types";
import { cn, formatFileSize } from "@/lib/utils";
import type { DocumentPreview, DocumentPreviewChunk, DocumentSummary } from "@/lib/types";
import type { PushToast } from "@/hooks/use-toasts";

type Tab = "pdf" | "layout" | "text" | "html" | "images";
const IMG_RE = /!\[[^\]]*\]\((\/api\/documents\/[^)\s]+)\)/g;

const STATUS_LABEL: Record<string, string> = {
  ready: "索引済み", error: "エラー", queued: "待機中", processing: "処理中",
  parsing: "解析中", chunking: "チャンク化", embedding: "埋め込み", indexing: "索引化",
};

function renderTex(tex: string, display: boolean): string | null {
  try {
    return katex.renderToString(tex.trim(), { displayMode: display, throwOnError: false });
  } catch {
    return null;
  }
}

/** 素テキスト中の TeX 数式（$$…$$ ディスプレイ / $…$ インライン）を KaTeX で描画し、
 *  数式以外はそのまま表示する。 */
function MathText({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const m of text.matchAll(/\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g)) {
    const idx = m.index ?? 0;
    if (idx > last) parts.push(text.slice(last, idx));
    const display = m[1] !== undefined;
    const html = renderTex(display ? m[1] : m[2], display);
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
  return <div className="whitespace-pre-wrap text-[13px] leading-[1.7] text-fg-2">{parts}</div>;
}

/** チャンク本文を整形描画する（表は HtmlTable、画像は inline、数式は KaTeX、その他は素テキスト）。
 *  一次資料パネルと同じ parseSectionBody を流用する。 */
function RenderedChunk({ chunk }: { chunk: DocumentPreviewChunk }) {
  const segs = parseSectionBody(chunk.text);
  return (
    <div className="mb-5">
      {chunk.heading_path && (
        <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.04em] text-muted">{chunk.heading_path}</div>
      )}
      {segs.map((s, i) => {
        if (s.kind === "table") return <HtmlTable key={i} html={s.html} className="my-1.5" />;
        if (s.kind === "image")
          // eslint-disable-next-line @next/next/no-img-element
          return <img key={i} src={s.src} alt={s.alt} className="my-1.5 max-w-full rounded-lg border-[0.5px] border-divider" />;
        return <MathText key={i} text={s.text} />;
      })}
    </div>
  );
}

export function DocumentsModal({ open, onClose, onChanged, onToast }: {
  open: boolean;
  onClose: () => void;
  onChanged?: () => void;
  onToast?: PushToast;
}) {
  const docs = useDocuments(open, onToast);
  const { confirm, dialog } = useConfirm();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("pdf");
  const [preview, setPreview] = useState<DocumentPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const selected = docs.items.find((d) => d.id === selectedId) ?? null;
  const isPdf = selected?.mime === "application/pdf";
  const isImage = selected?.mime.startsWith("image/") ?? false;
  // レイアウト注釈 PDF は MinerU が PDF 入力時のみ生成する。原本は PDF/画像のみブラウザで表示できる。

  // 文書選択時、ブラウザで表示できない形式（Excel 等）は解析テキストを初期表示にする。
  const selectDoc = (d: DocumentSummary) => {
    setSelectedId(d.id);
    setTab(d.mime === "application/pdf" || d.mime.startsWith("image/") ? "pdf" : "text");
  };

  // 選択文書のプレビュー（全チャンク）を取得。
  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    const run = async () => {
      setPreviewLoading(true);
      setPreview(null);
      try {
        const r = await fetch(`/api/documents/${encodeURIComponent(selectedId)}/preview`);
        const j = r.ok ? await r.json() : null;
        if (!cancelled) setPreview(j);
      } catch {
        if (!cancelled) setPreview(null);
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    };
    void run();
    return () => { cancelled = true; };
  }, [selectedId]);

  const images = useMemo(() => {
    if (!preview) return [] as string[];
    const urls = new Set<string>();
    for (const c of preview.chunks) {
      for (const m of c.text.matchAll(IMG_RE)) urls.add(m[1]);
    }
    return [...urls];
  }, [preview]);

  if (!open) return null;

  const onDelete = async (d: DocumentSummary) => {
    const ok = await confirm({
      title: "この文書を削除しますか？",
      description: `「${d.filename}」と抽出データ・索引を完全に削除します。元に戻せません。`,
      confirmLabel: "削除する",
      tone: "danger",
    });
    if (!ok) return;
    if (selectedId === d.id) setSelectedId(null);
    await docs.remove(d.id);
    onChanged?.();
  };

  return (
    <div className="fixed inset-0 z-[200] grid animate-[ar-fade-up_0.12s_ease-out] place-items-center bg-[rgba(20,18,15,0.55)] p-4 backdrop-blur-[3px]" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="documents-modal-title"
        className="flex h-[88vh] w-[90vw] max-w-[1180px] flex-col overflow-hidden rounded-[16px] border-[0.5px] border-divider-strong bg-surface shadow-e3 max-md:h-[92vh] max-md:w-full"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b-[0.5px] border-divider px-4 py-3">
          <div className="flex items-center gap-2 text-[14px] font-bold text-fg">
            <Icon name="database" size={15} />
            <span id="documents-modal-title">アップロード文書</span>
            <span className="font-mono text-[11px] font-normal text-muted">{docs.total}件</span>
          </div>
          <button className="grid h-7 w-7 place-items-center rounded-[7px] border-0 bg-transparent text-muted hover:bg-divider hover:text-fg" onClick={onClose} aria-label="閉じる">
            <svg viewBox="0 0 12 12" width="12" height="12"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* Left: list */}
          <div className="flex w-[320px] shrink-0 flex-col border-r-[0.5px] border-divider max-md:w-[180px]">
            <div className="flex flex-col gap-2 p-2.5">
              <div className="relative">
                <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-2"><Icon name="search" size={12} /></span>
                <input
                  value={docs.query}
                  onChange={(e) => docs.setQuery(e.target.value)}
                  placeholder="ファイル名で検索…"
                  className="h-[30px] w-full rounded-lg border-[0.5px] border-divider-strong bg-bg-2 pl-[30px] pr-2.5 text-[12.5px] text-fg outline-none placeholder:text-muted-2 focus:bg-surface"
                />
              </div>
              <div className="flex flex-wrap gap-1">
                {[["", "すべて"], ["ready", "索引済み"], ["error", "エラー"], ["processing", "処理中"]].map(([v, label]) => (
                  <button
                    key={v}
                    onClick={() => docs.setStatusFilter(v || null)}
                    className={cn(
                      "rounded-full border-[0.5px] px-2 py-0.5 text-[11px] font-medium transition-colors",
                      (docs.statusFilter ?? "") === v ? "border-accent bg-accent-soft text-accent" : "border-divider-strong bg-transparent text-muted hover:text-fg",
                    )}
                  >{label}</button>
                ))}
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
              {docs.items.map((d) => {
                const meta = getFileMeta(d.filename);
                return (
                  <button
                    key={d.id}
                    onClick={() => selectDoc(d)}
                    className={cn(
                      "group/dr my-px flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors",
                      selectedId === d.id ? "bg-surface-2 shadow-e1" : "hover:bg-divider",
                    )}
                  >
                    <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px]" style={{ background: meta.color + "20", color: meta.color }}>
                      <Icon name={meta.iconName} size={14} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] font-semibold text-fg" title={d.filename}>{d.filename}</span>
                      <span className="mt-0.5 block truncate font-mono text-[10.5px] text-muted">
                        {formatFileSize(d.size)}{d.page_count ? ` · ${d.page_count}p` : ""} · {d.chunk_count}ch
                      </span>
                    </span>
                    <span className={cn(
                      "shrink-0 rounded-full px-1.5 py-0.5 text-[9.5px] font-semibold",
                      d.status === "ready" && "bg-accent-soft text-accent",
                      d.status === "error" && "bg-[rgba(184,58,31,0.12)] text-[#B83A1F]",
                      d.status !== "ready" && d.status !== "error" && "bg-divider text-muted",
                    )}>{STATUS_LABEL[d.status] ?? d.status}</span>
                  </button>
                );
              })}
              {docs.nextCursor && (
                <button onClick={docs.loadMore} className="mx-auto my-2 block rounded-lg border-[0.5px] border-divider-strong bg-transparent px-3 py-1.5 text-[12px] font-medium text-fg-2 hover:bg-divider">
                  さらに読み込む
                </button>
              )}
              {!docs.loading && !docs.items.length && (
                <div className="px-3 py-8 text-center text-[12px] text-muted">該当する文書がありません</div>
              )}
            </div>
          </div>

          {/* Right: preview */}
          <div className="flex min-w-0 flex-1 flex-col">
            {!selected ? (
              <div className="grid flex-1 place-items-center text-[12.5px] text-muted">左から文書を選択してください</div>
            ) : (
              <>
                <div className="flex items-center gap-2 border-b-[0.5px] border-divider px-3 py-2">
                  <div className="flex gap-1">
                    {([["pdf", "原本"], ...(isPdf ? [["layout", "レイアウト"] as [Tab, string]] : []), ["text", "解析テキスト"], ["html", "HTML整形"], ["images", `画像${images.length ? ` (${images.length})` : ""}`]] as [Tab, string][]).map(([t, label]) => (
                      <button key={t} onClick={() => setTab(t)} className={cn(
                        "rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors",
                        tab === t ? "bg-surface-2 text-fg shadow-e1" : "text-muted hover:text-fg",
                      )}>{label}</button>
                    ))}
                  </div>
                  <div className="ml-auto flex items-center gap-1">
                    {(selected.status === "error" || selected.status === "ready") && selected.latest_job_id && (
                      <button onClick={() => docs.retry(selected.latest_job_id!, selected.id)} className="rounded-md border-0 bg-transparent px-2 py-1 text-[12px] font-medium text-fg-2 hover:bg-divider" title="再索引">再索引</button>
                    )}
                    <a href={`/api/documents/${encodeURIComponent(selected.id)}/raw?download=1`} className="rounded-md border-0 bg-transparent px-2 py-1 text-[12px] font-medium text-fg-2 hover:bg-divider">ダウンロード</a>
                    <button onClick={() => onDelete(selected)} className="rounded-md border-0 bg-transparent px-2 py-1 text-[12px] font-medium text-[#B83A1F] hover:bg-[rgba(184,58,31,0.12)]">削除</button>
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-auto bg-bg-2">
                  {tab === "pdf" && isPdf && (
                    <iframe title={selected.filename} src={`/api/documents/${encodeURIComponent(selected.id)}/raw`} className="h-full w-full border-0" />
                  )}
                  {tab === "pdf" && isImage && (
                    <div className="grid h-full place-items-center p-5">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`/api/documents/${encodeURIComponent(selected.id)}/raw`} alt={selected.filename} className="max-h-full max-w-full rounded-lg border-[0.5px] border-divider" />
                    </div>
                  )}
                  {tab === "pdf" && !isPdf && !isImage && (
                    <div className="grid h-full place-items-center p-8 text-center">
                      <div className="max-w-[380px]">
                        <div className="mb-1.5 text-[13px] font-semibold text-fg">この形式はブラウザでプレビューできません</div>
                        <div className="mb-4 text-[12px] leading-[1.6] text-muted">「解析テキスト」タブで抽出済みの内容を確認するか、原本をダウンロードしてください。</div>
                        <a href={`/api/documents/${encodeURIComponent(selected.id)}/raw?download=1`} className="inline-flex items-center gap-1.5 rounded-lg border-[0.5px] border-divider-strong bg-surface px-3 py-1.5 text-[12px] font-medium text-fg hover:bg-surface-2">原本をダウンロード</a>
                      </div>
                    </div>
                  )}
                  {tab === "layout" && isPdf && (
                    <iframe title={`${selected.filename} レイアウト`} src={`/api/documents/${encodeURIComponent(selected.id)}/layout`} className="h-full w-full border-0" />
                  )}
                  {tab === "html" && (
                    <div className="mx-auto max-w-[820px] p-5">
                      {previewLoading && <div className="text-[12px] text-muted">読み込み中…</div>}
                      {preview?.chunks.map((c) => <RenderedChunk key={c.chunk_id} chunk={c} />)}
                      {!previewLoading && !preview?.chunks.length && <div className="text-[12px] text-muted">表示できる内容がありません</div>}
                    </div>
                  )}
                  {tab === "text" && (
                    <div className="mx-auto max-w-[760px] p-5">
                      {previewLoading && <div className="text-[12px] text-muted">読み込み中…</div>}
                      {preview?.chunks.map((c) => (
                        <div key={c.chunk_id} className="mb-4">
                          {c.heading_path && <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.04em] text-muted">{c.heading_path}</div>}
                          <div className="whitespace-pre-wrap text-[13px] leading-[1.7] text-fg-2">{c.text}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  {tab === "images" && (
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3 p-5">
                      {previewLoading && <div className="text-[12px] text-muted">読み込み中…</div>}
                      {images.map((src) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img key={src} src={src} alt="" className="w-full rounded-lg border-[0.5px] border-divider" />
                      ))}
                      {!previewLoading && !images.length && <div className="text-[12px] text-muted">抽出画像はありません</div>}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
      {dialog}
    </div>
  );
}
