"use client";

import { useState } from "react";
import { Icon } from "@/components/icons";
import { getFileMeta } from "@/lib/file-types";
import { cn, formatFileSize } from "@/lib/utils";
import type { IngestStage, StagedFile } from "@/lib/types";

// rag worker の段階（worker.py の遷移と一致）。索引化後は ready。
const STAGES: { key: IngestStage; label: string }[] = [
  { key: "parsing", label: "解析" },
  { key: "chunking", label: "チャンク化" },
  { key: "embedding", label: "埋め込み" },
  { key: "indexing", label: "索引化" },
];

/** 解析→チャンク化→埋め込み→索引化 の段階ステッパー。SSE の stage で現在位置を点灯する。 */
function IngestStepper({ stage }: { stage?: IngestStage }) {
  // 現在段階のインデックス（ready は全完了扱い、未取得は先頭手前）。
  const active = stage === "ready" ? STAGES.length : stage ? STAGES.findIndex((s) => s.key === stage) : 0;
  return (
    <div className="mt-1.5 flex items-center gap-1">
      {STAGES.map((s, i) => {
        const done = i < active;
        const current = i === active;
        return (
          <div key={s.key} className="flex flex-1 items-center gap-1">
            <span
              className={cn(
                "h-[3px] flex-1 rounded-full transition-colors duration-300",
                done && "bg-accent",
                current && "animate-soft-pulse bg-accent",
                !done && !current && "bg-divider",
              )}
            />
            <span
              className={cn(
                "shrink-0 text-[9px] font-semibold tracking-[0.02em] transition-colors",
                done || current ? "text-accent" : "text-muted-2",
              )}
            >
              {s.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function AttachmentChip({ file, onRemove, onRetry }: { file: StagedFile; onRemove: (id: string) => void; onRetry?: (id: string) => void }) {
  const meta = getFileMeta(file.name);
  const ext = (file.name.split(".").pop() || "").toUpperCase();
  // 解析段階はファイル形式で表示（例: 「PDF 解析中」「XLSX 解析中」）。
  const processingText = file.stage === "parsing" ? `${ext} 解析中` : file.stageDetail || "処理中…";
  const elapsed = file.durationMs != null ? `${(file.durationMs / 1000).toFixed(1)}秒` : null;
  return (
    <div
      className={cn(
        "relative flex items-center gap-2.5 rounded-[9px] border-[0.5px] border-divider-strong bg-surface-2 py-2 pl-2 pr-2.5 transition-colors hover:bg-bg-2",
        file.status === "ready" && "border-accent bg-accent-soft",
        file.status === "error" && "border-[rgba(184,58,31,0.3)] bg-[rgba(184,58,31,0.08)]",
      )}
    >
      <span
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px]"
        style={{ background: meta.color + "20", color: meta.color }}
      >
        <Icon name={meta.iconName} size={14} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12.5px] font-semibold text-fg" title={file.name}>
          {file.name}
        </div>
        <div className="mt-0.5 flex items-center gap-[5px] font-mono text-[10.5px] text-muted">
          {file.status === "uploading" && (
            <>
              <span className="h-[9px] w-[9px] shrink-0 animate-spin-fast rounded-full border-[1.5px] border-divider-strong border-t-accent" />
              <span>アップロード中… {file.progress}%</span>
            </>
          )}
          {file.status === "processing" && (
            <>
              <span className="h-[9px] w-[9px] shrink-0 animate-spin-fast rounded-full border-[1.5px] border-divider-strong border-t-accent" />
              <span>
                {processingText}
                {file.stage === "embedding" && file.chunks ? ` · ${file.chunks}チャンク` : ""}
                {` · ${file.progress}%`}
              </span>
            </>
          )}
          {file.status === "ready" && (
            <>
              <span className="text-accent">✓</span>
              <span>
                {meta.label} · {formatFileSize(file.size)} · {file.pages || file.chunks}件のチャンクを索引化
                {elapsed ? ` · ${elapsed}` : ""}
              </span>
            </>
          )}
          {file.status === "error" && (
            <>
              <span className="text-[#B83A1F]">!</span>
              <span>{file.error || "エラー"}</span>
              {onRetry && file.jobId && (
                <button
                  className="ml-1 rounded-[4px] border-0 bg-transparent px-1.5 py-0.5 text-[10px] font-semibold text-[#B83A1F] hover:bg-[rgba(184,58,31,0.12)]"
                  onClick={() => onRetry(file.id)}
                >
                  再試行
                </button>
              )}
            </>
          )}
        </div>
        {file.status === "uploading" && (
          <div className="mt-1 h-[3px] overflow-hidden rounded-full bg-divider">
            <span className="block h-full rounded-full bg-accent transition-[width] duration-300 ease-out" style={{ width: `${file.progress}%` }} />
          </div>
        )}
        {file.status === "processing" && <IngestStepper stage={file.stage} />}
      </div>
      <button
        className="grid h-[22px] w-[22px] place-items-center rounded-[5px] border-0 bg-transparent text-muted hover:bg-divider hover:text-fg"
        onClick={() => onRemove(file.id)}
        aria-label="削除"
      >
        <svg viewBox="0 0 12 12" width="10" height="10">
          <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

export function AttachmentTray({ files, onRemove, onRetry }: { files: StagedFile[]; onRemove: (id: string) => void; onRetry?: (id: string) => void }) {
  if (!files.length) return null;
  return (
    <div className="flex max-h-[200px] flex-col gap-1.5 overflow-y-auto px-2 pt-2 max-md:max-h-[156px]">
      {files.map((f) => (
        <AttachmentChip key={f.id} file={f} onRemove={onRemove} onRetry={onRetry} />
      ))}
    </div>
  );
}

export function UserAttachments({ files }: { files: StagedFile[] }) {
  if (!files.length) return null;
  return (
    <div className="mb-1 rounded-[10px] border-[0.5px] border-divider bg-surface-2 px-3 py-2.5">
      <div className="mb-2 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.05em] text-muted">
        <Icon name="paperclip" size={11} />
        添付されたファイル
      </div>
      <div className="flex flex-wrap gap-1.5">
        {files.map((f) => {
          const meta = getFileMeta(f.name);
          return (
            <span key={f.id} className="inline-flex items-center gap-2 rounded-full border-[0.5px] border-divider-strong bg-surface py-[5px] pl-[5px] pr-[9px] text-[11.5px]">
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-[5px]" style={{ background: meta.color + "20", color: meta.color }}>
                <Icon name={meta.iconName} size={12} />
              </span>
              <span className="font-semibold text-fg-2">{f.name}</span>
              <span className="font-mono text-[10px] text-muted">
                {meta.label} · {formatFileSize(f.size)}
                {f.pages ? ` · ${f.pages}p` : ""}
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

export function DropOverlay({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <div className="pointer-events-none fixed inset-0 z-[300] grid animate-overlay-in place-items-center bg-[rgba(20,18,15,0.55)] backdrop-blur-[4px] motion-reduce:animate-none">
      <div className="w-[420px] max-w-[80vw] animate-pop-in rounded-[18px] border-2 border-dashed border-accent bg-surface p-10 text-center text-fg shadow-e3 motion-reduce:animate-none max-md:w-[calc(100vw-48px)] max-md:p-7">
        <svg viewBox="0 0 48 48" width="40" height="40" className="mx-auto mb-3 text-accent">
          <path d="M14 28V14a4 4 0 014-4h11l9 9v17a4 4 0 01-4 4H14" stroke="currentColor" strokeWidth="2" fill="none" strokeLinejoin="round" />
          <path d="M29 10v9h9" stroke="currentColor" strokeWidth="2" fill="none" strokeLinejoin="round" />
          <path d="M10 32v9M5 36.5l5-5 5 5" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <div className="mb-1.5 text-[17px] font-bold">ファイルをここにドロップ</div>
        <div className="text-[12.5px] leading-[1.5] text-muted">フォルダもOK · PDF · Word · Excel · PowerPoint · CSV · 画像 — 自動的に索引化されます</div>
      </div>
    </div>
  );
}

/** relPath の先頭ディレクトリでグルーピングする（フラット展開だが UI 上は出自を保つ）。 */
function groupByFolder(files: StagedFile[]): { folder: string | null; files: StagedFile[] }[] {
  const groups = new Map<string, StagedFile[]>();
  for (const f of files) {
    const top = f.relPath?.includes("/") ? f.relPath.split("/")[0] : "";
    const arr = groups.get(top) ?? [];
    arr.push(f);
    groups.set(top, arr);
  }
  return [...groups.entries()].map(([folder, fs]) => ({ folder: folder || null, files: fs }));
}

function QueueGroup({ folder, files, onRemove, onRetry }: {
  folder: string | null; files: StagedFile[]; onRemove: (id: string) => void; onRetry?: (id: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const done = files.filter((f) => f.status === "ready").length;
  const failed = files.filter((f) => f.status === "error").length;
  const active = files.length - done - failed;

  // フォルダ無し（個別ファイル）はヘッダーを出さずにそのまま並べる。
  if (!folder) {
    return (
      <div className="flex flex-col gap-1.5">
        {files.map((f) => <AttachmentChip key={f.id} file={f} onRemove={onRemove} onRetry={onRetry} />)}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-[10px] border-[0.5px] border-divider-strong bg-bg-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-2.5 py-2 text-left hover:bg-divider"
      >
        <Icon name="folder" size={13} />
        <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-fg" title={folder}>{folder}</span>
        <span className="shrink-0 font-mono text-[10.5px] text-muted">
          {done}/{files.length} 完了{failed ? ` · ${failed}失敗` : ""}
        </span>
        {active > 0 && <span className="h-[10px] w-[10px] shrink-0 animate-spin-fast rounded-full border-[1.5px] border-divider-strong border-t-accent" />}
        <svg viewBox="0 0 12 12" width="10" height="10" className={cn("shrink-0 text-muted transition-transform", open && "rotate-90")}>
          <path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className="flex flex-col gap-1.5 px-1.5 pb-1.5">
          {files.map((f) => <AttachmentChip key={f.id} file={f} onRemove={onRemove} onRetry={onRetry} />)}
        </div>
      )}
    </div>
  );
}

/** 文書管理モーダル内のアップロードキュー。フォルダ単位にまとめ、段階進捗を表示する。 */
export function DocumentsUploadQueue({ files, onRemove, onRetry, onClear }: {
  files: StagedFile[]; onRemove: (id: string) => void; onRetry?: (id: string) => void; onClear?: () => void;
}) {
  if (!files.length) return null;
  const groups = groupByFolder(files);
  const total = files.length;
  const done = files.filter((f) => f.status === "ready").length;
  const allDone = done === total;

  return (
    <div className="flex max-h-[40%] shrink-0 flex-col border-b-[0.5px] border-divider bg-surface-2">
      <div className="flex items-center gap-2 px-3 py-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.05em] text-muted">アップロード</span>
        <span className="font-mono text-[10.5px] text-muted">{done}/{total}</span>
        {onClear && (
          <button
            onClick={onClear}
            className="ml-auto rounded-[5px] border-0 bg-transparent px-1.5 py-0.5 text-[10.5px] font-medium text-muted hover:bg-divider hover:text-fg"
          >
            {allDone ? "クリア" : "すべて非表示"}
          </button>
        )}
      </div>
      <div className="flex min-h-0 flex-col gap-1.5 overflow-y-auto px-2 pb-2.5">
        {groups.map((g) => (
          <QueueGroup key={g.folder ?? "__loose__"} folder={g.folder} files={g.files} onRemove={onRemove} onRetry={onRetry} />
        ))}
      </div>
    </div>
  );
}
