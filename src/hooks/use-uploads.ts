"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ACCEPTED_FILE_TYPES } from "@/lib/constants";
import { uid } from "@/lib/utils";
import type { IngestStage, StagedFile, UploadStatus } from "@/lib/types";
import type { PushToast } from "@/hooks/use-toasts";

const ACCEPTED = ACCEPTED_FILE_TYPES.split(",");

/** ステージ済みファイル候補（フォルダ走査で相対パスが付くことがある）。 */
interface PickedFile {
  file: File;
  relPath?: string;
}

/** rag のステージ status を粗い UploadStatus に丸める。 */
function toUploadStatus(s: string): UploadStatus {
  if (s === "ready") return "ready";
  if (s === "error") return "error";
  return "processing";
}

const STAGE_KEYS: IngestStage[] = ["parsing", "chunking", "embedding", "indexing", "ready"];
const asStage = (s: string): IngestStage | undefined => (STAGE_KEYS.includes(s as IngestStage) ? (s as IngestStage) : undefined);

const isAccepted = (name: string) => ACCEPTED.includes("." + (name.split(".").pop() || "").toLowerCase());

/** DataTransfer からフォルダを再帰展開してファイルを収集する（フラット展開）。
 *  entry API 非対応ブラウザでは dataTransfer.files にフォールバックする。 */
async function pickFromDataTransfer(dt: DataTransfer): Promise<PickedFile[]> {
  const items = Array.from(dt.items || []);
  const getEntry = (it: DataTransferItem): FileSystemEntry | null =>
    (it as DataTransferItem & { webkitGetAsEntry?: () => FileSystemEntry | null }).webkitGetAsEntry?.() ?? null;

  const entries = items.filter((it) => it.kind === "file").map(getEntry).filter(Boolean) as FileSystemEntry[];
  if (!entries.length) return Array.from(dt.files || []).map((file) => ({ file }));

  const out: PickedFile[] = [];
  const readDir = (reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> =>
    new Promise((resolve) => reader.readEntries((batch) => resolve(batch), () => resolve([])));

  const walk = async (entry: FileSystemEntry, prefix: string): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File | null>((resolve) =>
        (entry as FileSystemFileEntry).file((f) => resolve(f), () => resolve(null)),
      );
      if (file) out.push({ file, relPath: prefix + entry.name });
      return;
    }
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    // readEntries は1回で全件返さない実装があるので空になるまで反復する。
    for (;;) {
      const batch = await readDir(reader);
      if (!batch.length) break;
      for (const child of batch) await walk(child, prefix + entry.name + "/");
    }
  };

  for (const entry of entries) await walk(entry, "");
  return out;
}

/** Stages files, POSTs each to /api/upload, and tracks an upload→process→ready
 * pipeline. The processing phase is driven by an SSE stream (per-stage detail). */
export function useUploads(onToast?: PushToast) {
  const [files, setFiles] = useState<StagedFile[]>([]);
  // アップロード進捗アニメ用の interval と、SSE 用の AbortController を id ごとに保持。
  const timers = useRef<Record<string, ReturnType<typeof setInterval>>>({});
  const streams = useRef<Record<string, AbortController>>({});

  const filesRef = useRef(files);
  useEffect(() => { filesRef.current = files; }, [files]);
  const onToastRef = useRef(onToast);
  useEffect(() => { onToastRef.current = onToast; }, [onToast]);

  const clearTimer = useCallback((id: string) => {
    if (timers.current[id]) { clearInterval(timers.current[id]); delete timers.current[id]; }
  }, []);
  const clearStream = useCallback((id: string) => {
    streams.current[id]?.abort();
    delete streams.current[id];
  }, []);

  /** /api/uploads/:jobId/stream を購読し、段階ごとに StagedFile を更新する。 */
  const startStreaming = useCallback(
    (id: string, jobId: string, fileName: string) => {
      clearStream(id);
      const ctrl = new AbortController();
      streams.current[id] = ctrl;

      (async () => {
        try {
          const res = await fetch(`/api/uploads/${jobId}/stream`, { signal: ctrl.signal });
          if (!res.ok || !res.body) throw new Error("stream failed");
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";

          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const frames = buffer.split("\n\n");
            buffer = frames.pop() ?? "";
            for (const frame of frames) {
              const line = frame.split("\n").find((l) => l.startsWith("data:"));
              if (!line) continue;
              const j = JSON.parse(line.slice(5).trim()) as {
                status: string; progress: number; stage_detail: string;
                chunks?: number; page_count?: number | null; error?: string | null;
              };
              setFiles((prev) =>
                prev.map((f) =>
                  f.id === id
                    ? {
                        ...f,
                        status: toUploadStatus(j.status),
                        progress: j.progress,
                        stage: asStage(j.status),
                        stageDetail: j.stage_detail || undefined,
                        chunks: j.chunks ?? f.chunks,
                        pages: j.page_count ?? f.pages,
                        error: j.error ?? undefined,
                        // 完了時に所要時間を確定（開始時刻からの差分）。
                        durationMs: j.status === "ready" && f.startedAt ? Date.now() - f.startedAt : f.durationMs,
                      }
                    : f,
                ),
              );
              if (j.status === "ready") onToastRef.current?.(`「${fileName}」を索引化しました`, "success");
              if (j.status === "error") onToastRef.current?.(j.error || "索引化に失敗しました", "error");
            }
          }
        } catch {
          if (ctrl.signal.aborted) return;
          setFiles((prev) => prev.map((f) => (f.id === id && f.status === "processing" ? { ...f, status: "error", error: "進捗の取得に失敗しました" } : f)));
        } finally {
          delete streams.current[id];
        }
      })();
    },
    [clearStream],
  );

  const removeFile = useCallback((id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
    clearTimer(id);
    clearStream(id);
  }, [clearTimer, clearStream]);

  /** 受理済みファイル群をステージし、各々を /api/upload に送る内部処理。 */
  const enqueue = useCallback(
    (picked: PickedFile[]) => {
      if (!picked.length) return;
      const accepted = picked.filter((p) => isAccepted(p.file.name));
      const rejected = picked.filter((p) => !isAccepted(p.file.name));

      // 未対応フォーマットはアップロードせず、スキップとしてキューに可視化する。
      if (rejected.length) {
        setFiles((prev) => [
          ...prev,
          ...rejected.map(({ file, relPath }) => ({
            id: uid("f_"), name: file.name, size: file.size, status: "skipped" as const, progress: 0, relPath,
          })),
        ]);
        onToastRef.current?.(`未対応の形式 ${rejected.length}件をスキップしました`, "info");
      }

      accepted.forEach(({ file, relPath }) => {
        const id = uid("f_");
        setFiles((prev) => [...prev, { id, name: file.name, size: file.size, status: "uploading", progress: 0, relPath, startedAt: Date.now() }]);

        // サーバ応答までクライアント側で 90% までアニメーションさせる。
        timers.current[id] = setInterval(() => {
          setFiles((prev) =>
            prev.map((f) =>
              f.id === id && f.status === "uploading"
                ? { ...f, progress: Math.min(90, f.progress + Math.floor(12 + Math.random() * 18)) }
                : f,
            ),
          );
        }, 200);

        const form = new FormData();
        form.append("file", file);
        fetch("/api/upload", { method: "POST", body: form })
          .then(async (res) => {
            clearTimer(id);
            if (!res.ok) {
              const { error } = await res.json().catch(() => ({ error: "アップロードに失敗しました" }));
              setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, status: "error", error } : f)));
              return;
            }
            const { jobId } = (await res.json()) as { documentId: string; jobId: string };
            setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, status: "processing", progress: 10, jobId } : f)));
            startStreaming(id, jobId, file.name);
          })
          .catch(() => {
            clearTimer(id);
            setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, status: "error", error: "ネットワークエラー" } : f)));
          });
      });
    },
    [clearTimer, startStreaming],
  );

  // 既存 API 互換：FileList / File[] を受ける（フォルダ input の webkitRelativePath も拾う）。
  const addFiles = useCallback(
    (fileList: FileList | File[] | null) => {
      const list = Array.from(fileList || []);
      enqueue(list.map((file) => ({ file, relPath: (file as File & { webkitRelativePath?: string }).webkitRelativePath || undefined })));
    },
    [enqueue],
  );

  // ドラッグ&ドロップ：フォルダを再帰展開してから取り込む。
  const addFromDataTransfer = useCallback(
    async (dt: DataTransfer) => {
      enqueue(await pickFromDataTransfer(dt));
    },
    [enqueue],
  );

  const retry = useCallback(
    (id: string) => {
      const file = filesRef.current.find((f) => f.id === id);
      if (!file?.jobId) return;
      const { jobId, name } = file;

      clearStream(id);
      setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, status: "processing", progress: 0, stage: undefined, stageDetail: undefined, error: undefined, startedAt: Date.now(), durationMs: undefined } : f)));

      fetch(`/api/uploads/${jobId}/retry`, { method: "POST" })
        .then(async (res) => {
          if (!res.ok) {
            const { error } = await res.json().catch(() => ({ error: "再試行に失敗しました" }));
            setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, status: "error", error } : f)));
            return;
          }
          startStreaming(id, jobId, name);
        })
        .catch(() => {
          setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, status: "error", error: "ネットワークエラー" } : f)));
        });
    },
    [clearStream, startStreaming],
  );

  const clear = useCallback(() => {
    Object.keys(timers.current).forEach(clearTimer);
    Object.keys(streams.current).forEach(clearStream);
    setFiles([]);
  }, [clearTimer, clearStream]);

  return { files, addFiles, addFromDataTransfer, removeFile, retry, clear };
}
