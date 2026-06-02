"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Icon } from "@/components/icons";
import { RenderedSectionBody } from "@/components/sources/rendered-section-body";
import { DocumentsUploadQueue } from "@/components/uploads/uploads";
import { SpreadsheetPreview } from "@/components/documents/spreadsheet-preview";
import { MarkdownView } from "@/components/documents/markdown-view";
import { JsonView, JsonlView } from "@/components/documents/json-view";
import { PlainTextView } from "@/components/documents/plain-text-view";
import { useRawText, type RawTextState } from "@/hooks/use-raw-text";
import { useConfirm } from "@/hooks/use-confirm";
import { useDocuments } from "@/hooks/use-documents";
import { useUploads } from "@/hooks/use-uploads";
import { ACCEPTED_FILE_TYPES } from "@/lib/constants";
import { getFileMeta, getTextPreviewKind, isConvertibleToPdf, isSpreadsheet } from "@/lib/file-types";
import { cn, formatFileSize } from "@/lib/utils";
import type { DocumentPreview, DocumentPreviewChunk, DocumentSummary } from "@/lib/types";
import type { PushToast } from "@/hooks/use-toasts";

// 純正 PDF ビューアの黒いクロムを隠し、紙系の世界観に馴染ませる。
const PDF_VIEW_PARAMS = "#toolbar=0&navpanes=0&statusbar=0&view=FitH";

type Tab = "pdf" | "layout" | "span" | "text" | "html" | "rich" | "images";
const IMG_RE = /!\[[^\]]*\]\((\/api\/documents\/[^)\s]+)\)/g;

const STATUS_LABEL: Record<string, string> = {
  ready: "索引済み", error: "エラー", queued: "待機中", processing: "処理中",
  parsing: "解析中", chunking: "チャンク化", embedding: "埋め込み", indexing: "索引化",
};

/** プレビュー不可フォールバック（原本ダウンロード導線）。 */
function UnsupportedPreview({ docId }: { docId: string }) {
  return (
    <div className="grid h-full place-items-center p-8 text-center">
      <div className="max-w-[380px]">
        <div className="mb-1.5 text-[13px] font-semibold text-fg">この形式はブラウザでプレビューできません</div>
        <div className="mb-4 text-[12px] leading-[1.6] text-muted">「解析テキスト」タブで抽出済みの内容を確認するか、原本をダウンロードしてください。</div>
        <a href={`/api/documents/${encodeURIComponent(docId)}/raw?download=1`} className="inline-flex items-center gap-1.5 rounded-lg border-[0.5px] border-divider-strong bg-surface px-3 py-1.5 text-[12px] font-medium text-fg hover:bg-surface-2">原本をダウンロード</a>
      </div>
    </div>
  );
}

/** Office 原本をサーバ側で PDF 変換し iframe 表示する。初回は数秒の変換待ち、
 *  失敗時はダウンロード導線へ退避する。blob 経由にして HTTP エラーを iframe に晒さない。 */
function RenderedPdfPreview({ docId, filename }: { docId: string; filename: string }) {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [url, setUrl] = useState<string | null>(null);

  // docId ごとに key で再マウントされる前提（初期状態 = loading）。
  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    (async () => {
      try {
        const res = await fetch(`/api/documents/${encodeURIComponent(docId)}/rendered`);
        if (!res.ok) throw new Error(String(res.status));
        const blob = await res.blob();
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
        setState("ready");
      } catch {
        if (!cancelled) setState("error");
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [docId]);

  if (state === "error") return <UnsupportedPreview docId={docId} />;
  if (state === "loading" || !url) {
    return <div className="grid h-full place-items-center text-[12px] text-muted">変換中…</div>;
  }
  return <iframe title={filename} src={url + PDF_VIEW_PARAMS} className="h-full w-full border-0" />;
}

/** チャンク本文を HTML整形ビューで描画する。
 *  一次資料パネルと同じ本文レンダラを使う。 */
function RenderedChunk({ chunk }: { chunk: DocumentPreviewChunk }) {
  return (
    <div className="mb-5">
      {chunk.heading_path && (
        <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.04em] text-muted">{chunk.heading_path}</div>
      )}
      <RenderedSectionBody body={chunk.text} blockType={chunk.block_type} />
    </div>
  );
}

/** 原本テキストの読み込み状態をラップする。ready のとき children（整形ビュー）を表示し、
 *  children 無し（原本タブ）のときは生テキストを PlainTextView で表示する。
 *  loading/error と truncate 注記もここで一元的に出す。 */
function RawTextContent({ raw, docId, children }: { raw: RawTextState; docId: string; children?: ReactNode }) {
  if (raw.status === "loading" || raw.status === "idle") {
    return <div className="grid h-full place-items-center text-[12px] text-muted">読み込み中…</div>;
  }
  if (raw.status === "error") return <UnsupportedPreview docId={docId} />;
  return (
    <div>
      {raw.truncated && (
        <div className="border-b-[0.5px] border-divider bg-accent-soft px-5 py-2 text-[11.5px] text-fg-2">
          ファイルが大きいため冒頭のみ表示しています。全文は「原本ダウンロード」から取得してください。
        </div>
      )}
      {children ?? <PlainTextView text={raw.text} />}
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
  const uploads = useUploads(onToast);
  const { confirm, dialog } = useConfirm();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("pdf");
  const [preview, setPreview] = useState<DocumentPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [uploadMenuOpen, setUploadMenuOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);

  // アップロード完了を検知したら一覧を再取得して新規文書を反映する。
  const readyCount = uploads.files.filter((f) => f.status === "ready").length;
  useEffect(() => {
    if (!open || !readyCount) return;
    void docs.load();
    onChanged?.();
    // load/onChanged は参照安定でないため readyCount のみを依存に絞る。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readyCount, open]);

  const selected = docs.items.find((d) => d.id === selectedId) ?? null;
  const isPdf = selected?.mime === "application/pdf";
  const isImage = selected?.mime.startsWith("image/") ?? false;
  // Office 系原本はサーバ側で PDF 変換してプレビューできる（拡張子で判定）。
  const isConvertible = selected ? isConvertibleToPdf(selected.filename) : false;
  // 表計算は PDF 化せず Excel 風グリッドでネイティブ描画する（PDF/画像/Office PDF 変換より優先）。
  const isSheet = selected ? isSpreadsheet(selected.filename) : false;
  // テキスト系（md/json/jsonl/txt 等）は 原本/解析テキスト/整形表示 の3タブに切替える。
  const textKind = selected ? getTextPreviewKind(selected.filename) : null;
  const raw = useRawText(textKind ? selectedId : null);
  // MinerU 注釈 PDF は PDF 入力時のみ生成する。

  // 文書選択時、原本プレビュー可能（PDF/画像/Office）なら原本タブ、それ以外は解析テキストを初期表示にする。
  const selectDoc = (d: DocumentSummary) => {
    setSelectedId(d.id);
    if (getTextPreviewKind(d.filename)) { setTab("rich"); return; }
    const previewable = d.mime === "application/pdf" || d.mime.startsWith("image/") || isSpreadsheet(d.filename) || isConvertibleToPdf(d.filename);
    setTab(previewable ? "pdf" : "text");
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

  const onBulkDelete = async () => {
    const ids = [...docs.selectedIds];
    if (!ids.length) return;
    const ok = await confirm({
      title: `選択した ${ids.length}件の文書を削除しますか？`,
      description: `選択した ${ids.length}件の文書と抽出データ・索引を完全に削除します。元に戻せません。`,
      confirmLabel: "削除する",
      tone: "danger",
    });
    if (!ok) return;
    if (selectedId && ids.includes(selectedId)) setSelectedId(null);
    await docs.removeMany(ids);
    onChanged?.();
  };

  return (
    <div className="fixed inset-0 z-[200] grid animate-overlay-in place-items-center bg-[rgba(20,18,15,0.55)] p-4 backdrop-blur-[3px] motion-reduce:animate-none max-md:p-0" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="documents-modal-title"
        className="flex h-[88vh] w-[90vw] max-w-[1180px] animate-pop-in flex-col overflow-hidden rounded-[16px] border-[0.5px] border-divider-strong bg-surface shadow-e3 motion-reduce:animate-none max-md:h-full max-md:w-full max-md:rounded-none max-md:border-0"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b-[0.5px] border-divider px-4 py-3">
          <div className="flex items-center gap-2 text-[14px] font-bold text-fg">
            <Icon name="database" size={15} />
            <span id="documents-modal-title">アップロード文書</span>
            <span className="font-mono text-[11px] font-normal text-muted">{docs.total}件</span>
          </div>
          <div className="flex items-center gap-2">
            {/* アップロード（スプリットボタン）: 本体=ファイル選択 / ▾=フォルダ選択 */}
            <div className="relative flex">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex h-7 items-center gap-1.5 rounded-l-[7px] bg-accent pl-2.5 pr-2 text-[12.5px] font-semibold text-white transition-[filter] hover:brightness-105"
              >
                <Icon name="plus" size={13} />
                アップロード
              </button>
              <button
                onClick={() => setUploadMenuOpen((v) => !v)}
                aria-label="アップロード方法"
                className="grid h-7 w-6 place-items-center rounded-r-[7px] border-l border-[rgba(255,255,255,0.25)] bg-accent text-white transition-[filter] hover:brightness-105"
              >
                <Icon name="chevronDown" size={12} />
              </button>
              {uploadMenuOpen && (
                <>
                  {/* ボタンとプルダウンメニューの間に透明なブリッジ領域を設け、マウスが隙間を通過した際に onMouseLeave が発火しないようにする */}
                  <div className="absolute left-0 top-[28px] z-10 h-[6px] w-full" />
                  <div className="absolute right-0 top-[34px] z-10 w-[176px] animate-scale-in overflow-hidden rounded-[10px] border-[0.5px] border-divider-strong bg-surface-elev p-1 shadow-e2 motion-reduce:animate-none"
                       onMouseLeave={() => setUploadMenuOpen(false)}>
                    <button
                      onClick={() => { setUploadMenuOpen(false); fileInputRef.current?.click(); }}
                      className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12.5px] font-medium text-fg hover:bg-divider"
                    >
                      <Icon name="doc" size={13} /> ファイルを選択
                    </button>
                    <button
                      onClick={() => { setUploadMenuOpen(false); folderInputRef.current?.click(); }}
                      className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12.5px] font-medium text-fg hover:bg-divider"
                    >
                      <Icon name="folders" size={13} /> フォルダを選択
                    </button>
                  </div>
                </>
              )}
            </div>
            <button className="grid h-7 w-7 place-items-center rounded-[7px] border-0 bg-transparent text-muted hover:bg-divider hover:text-fg" onClick={onClose} aria-label="閉じる">
              <svg viewBox="0 0 12 12" width="12" height="12"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
            </button>
          </div>
        </div>
        {/* 隠し input: ファイル複数選択 / フォルダ選択（webkitdirectory）。値は毎回リセットして同一選択でも発火させる。 */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ACCEPTED_FILE_TYPES}
          className="hidden"
          onChange={(e) => { uploads.addFiles(e.target.files); e.target.value = ""; }}
        />
        <input
          ref={folderInputRef}
          type="file"
          // @ts-expect-error webkitdirectory は標準型に未定義だが Chromium/WebKit で有効。
          webkitdirectory=""
          directory=""
          multiple
          className="hidden"
          onChange={(e) => { uploads.addFiles(e.target.files); e.target.value = ""; }}
        />

        <div className="flex min-h-0 flex-1">
          {/* Left: list（カラム全体がフォルダ対応のドロップ領域） */}
          <div
            className={cn(
              "relative flex w-[320px] shrink-0 flex-col border-r-[0.5px] border-divider max-md:w-full max-md:border-r-0",
              selected && "max-md:hidden",
            )}
            onDragEnter={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); dragDepth.current += 1; setDragging(true); } }}
            onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) e.preventDefault(); }}
            onDragLeave={() => { dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragging(false); }}
            onDrop={(e) => { e.preventDefault(); dragDepth.current = 0; setDragging(false); void uploads.addFromDataTransfer(e.dataTransfer); }}
          >
            {dragging && (
              <div className="pointer-events-none absolute inset-1.5 z-20 grid place-items-center rounded-[12px] border-2 border-dashed border-accent bg-accent-soft backdrop-blur-[2px]">
                <div className="text-center">
                  <span className="inline-flex text-accent"><Icon name="folders" size={26} /></span>
                  <div className="mt-1.5 text-[12.5px] font-bold text-fg">ファイル / フォルダをドロップ</div>
                  <div className="text-[11px] text-muted">そのまま索引化されます</div>
                </div>
              </div>
            )}
            <DocumentsUploadQueue files={uploads.files} onRemove={uploads.removeFile} onRetry={uploads.retry} onClear={uploads.clear} />
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
              {docs.selectionMode ? (
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1.5 text-[11.5px] font-medium text-fg">
                    <input
                      type="checkbox"
                      checked={docs.allVisibleSelected}
                      disabled={docs.deleting}
                      onChange={(e) => (e.target.checked ? docs.selectAllVisible() : docs.clearSelection())}
                      className="accent-accent disabled:opacity-40"
                    />
                    {docs.selectedIds.size}件選択中
                  </label>
                  <div className="ml-auto flex items-center gap-1">
                    <button
                      onClick={onBulkDelete}
                      disabled={docs.selectedIds.size === 0 || docs.deleting}
                      className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-semibold text-[#B83A1F] hover:bg-[rgba(184,58,31,0.12)] disabled:opacity-40 disabled:hover:bg-transparent"
                    >
                      {docs.deleting && <span className="h-3 w-3 animate-spin-fast rounded-full border-[1.5px] border-divider-strong border-t-accent" />}
                      {docs.deleting ? "削除中…" : "削除"}
                    </button>
                    <button
                      onClick={docs.exitSelection}
                      disabled={docs.deleting}
                      className="rounded-md px-2 py-1 text-[12px] font-medium text-muted hover:bg-divider hover:text-fg disabled:opacity-40 disabled:hover:bg-transparent"
                    >キャンセル</button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-1">
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
                  <button
                    onClick={docs.enterSelection}
                    disabled={!docs.items.length}
                    className="ml-auto rounded-md px-2 py-0.5 text-[11px] font-medium text-muted hover:bg-divider hover:text-fg disabled:opacity-40 disabled:hover:bg-transparent"
                  >選択</button>
                </div>
              )}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
              {docs.items.map((d) => {
                const meta = getFileMeta(d.filename);
                return (
                  <button
                    key={d.id}
                    onClick={() => (docs.selectionMode ? docs.toggleSelect(d.id) : selectDoc(d))}
                    className={cn(
                      "group/dr my-px flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors",
                      selectedId === d.id || (docs.selectionMode && docs.selectedIds.has(d.id)) ? "bg-surface-2 shadow-e1" : "hover:bg-divider",
                    )}
                  >
                    {docs.selectionMode && (
                      <input
                        type="checkbox"
                        readOnly
                        checked={docs.selectedIds.has(d.id)}
                        className="shrink-0 accent-accent"
                      />
                    )}
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
          <div className={cn("flex min-w-0 flex-1 flex-col", !selected && "max-md:hidden")}>
            {!selected ? (
              <div className="grid flex-1 place-items-center text-[12.5px] text-muted">左から文書を選択してください</div>
            ) : (
              <>
                <div className="flex items-center gap-2 border-b-[0.5px] border-divider px-3 py-2 max-md:px-2.5">
                  {/* モバイル: プレビューから一覧へ戻る */}
                  <button
                    onClick={() => setSelectedId(null)}
                    aria-label="一覧へ戻る"
                    className="hidden h-7 w-7 shrink-0 place-items-center rounded-[7px] text-muted hover:bg-divider hover:text-fg max-md:grid"
                  >
                    <Icon name="chevronLeft" size={15} />
                  </button>
                  <div className="flex min-w-0 gap-1 overflow-x-auto [scrollbar-width:none]">
                    {(textKind
                      ? ([["pdf", "原本"], ["text", "解析テキスト"], ["rich", "整形表示"]] as [Tab, string][])
                      : ([["pdf", isSheet ? "スプレッドシート" : isConvertible ? "PDF変換原本" : "原本"], ...(isPdf ? [["layout", "レイアウト"], ["span", "Span"]] as [Tab, string][] : []), ["text", "解析テキスト"], ["html", "HTML整形"], ["images", `画像${images.length ? ` (${images.length})` : ""}`]] as [Tab, string][])
                    ).map(([t, label]) => (
                      <button key={t} onClick={() => setTab(t)} className={cn(
                        "shrink-0 rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors",
                        tab === t ? "bg-surface-2 text-fg shadow-e1" : "text-muted hover:text-fg",
                      )}>{label}</button>
                    ))}
                  </div>
                  <div className="ml-auto flex shrink-0 items-center gap-1">
                    {(selected.status === "error" || selected.status === "ready") && selected.latest_job_id && (
                      <button onClick={() => docs.retry(selected.latest_job_id!, selected.id)} className="rounded-md border-0 bg-transparent px-2 py-1 text-[12px] font-medium text-fg-2 hover:bg-divider" title="再索引">再索引</button>
                    )}
                    <a href={`/api/documents/${encodeURIComponent(selected.id)}/raw?download=1`} className="rounded-md border-0 bg-transparent px-2 py-1 text-[12px] font-medium text-fg-2 hover:bg-divider">原本ダウンロード</a>
                    <button onClick={() => onDelete(selected)} className="rounded-md border-0 bg-transparent px-2 py-1 text-[12px] font-medium text-[#B83A1F] hover:bg-[rgba(184,58,31,0.12)]">削除</button>
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-auto bg-bg-2">
                  {tab === "pdf" && isPdf && (
                    <div className="h-full p-3">
                      <iframe title={selected.filename} src={`/api/documents/${encodeURIComponent(selected.id)}/raw${PDF_VIEW_PARAMS}`} className="h-full w-full rounded-[10px] border-[0.5px] border-divider-strong bg-surface shadow-e1" />
                    </div>
                  )}
                  {tab === "pdf" && isImage && (
                    <div className="grid h-full place-items-center p-5">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`/api/documents/${encodeURIComponent(selected.id)}/raw`} alt={selected.filename} className="max-h-full max-w-full rounded-lg border-[0.5px] border-divider" />
                    </div>
                  )}
                  {tab === "pdf" && !isPdf && !isImage && isSheet && (
                    <div className="h-full p-3">
                      <div className="h-full overflow-hidden rounded-[10px] border-[0.5px] border-divider-strong bg-surface shadow-e1">
                        <SpreadsheetPreview key={selected.id} docId={selected.id} filename={selected.filename} />
                      </div>
                    </div>
                  )}
                  {tab === "pdf" && !isPdf && !isImage && !isSheet && isConvertible && (
                    <div className="h-full p-3">
                      <div className="h-full overflow-hidden rounded-[10px] border-[0.5px] border-divider-strong bg-surface shadow-e1">
                        <RenderedPdfPreview key={selected.id} docId={selected.id} filename={selected.filename} />
                      </div>
                    </div>
                  )}
                  {tab === "pdf" && !isPdf && !isImage && !isSheet && !isConvertible && textKind && (
                    <RawTextContent raw={raw} docId={selected.id} />
                  )}
                  {tab === "pdf" && !isPdf && !isImage && !isSheet && !isConvertible && !textKind && (
                    <UnsupportedPreview docId={selected.id} />
                  )}
                  {tab === "layout" && isPdf && (
                    <iframe title={`${selected.filename} レイアウト`} src={`/api/documents/${encodeURIComponent(selected.id)}/layout`} className="h-full w-full border-0" />
                  )}
                  {tab === "span" && isPdf && (
                    <iframe title={`${selected.filename} Span`} src={`/api/documents/${encodeURIComponent(selected.id)}/span`} className="h-full w-full border-0" />
                  )}
                  {tab === "html" && (
                    <div className="mx-auto max-w-[820px] p-5">
                      {previewLoading && <div className="text-[12px] text-muted">読み込み中…</div>}
                      {preview?.chunks.map((c) => <RenderedChunk key={c.chunk_id} chunk={c} />)}
                      {!previewLoading && !preview?.chunks.length && <div className="text-[12px] text-muted">表示できる内容がありません</div>}
                    </div>
                  )}
                  {tab === "rich" && (
                    <RawTextContent raw={raw} docId={selected.id}>
                      {textKind === "markdown" && <MarkdownView text={raw.text} />}
                      {textKind === "json" && <JsonView text={raw.text} />}
                      {textKind === "jsonl" && <JsonlView text={raw.text} />}
                      {(textKind === "text" || !textKind) && <PlainTextView text={raw.text} />}
                    </RawTextContent>
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
