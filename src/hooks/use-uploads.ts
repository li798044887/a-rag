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

/** ✕ ボタンの操作種別を状態から決める。
 *  uploading=送信中POSTのabort / queued=サーバ側キャンセル / processing=不可 / それ以外=ローカル除去。 */
export function uploadActionFor(status: UploadStatus): "abort" | "cancel" | "none" | "remove" {
  if (status === "uploading") return "abort";
  if (status === "queued") return "cancel";
  if (status === "processing") return "none";
  return "remove";
}

/** 進捗監視が必要なファイル（queued/processing）の jobId を返す。 */
export function activeJobIds(files: StagedFile[]): string[] {
  return files
    .filter((f) => (f.status === "queued" || f.status === "processing") && !!f.jobId)
    .map((f) => f.jobId as string);
}

/** jobId 集合を順序非依存・重複排除した安定キーにする（再接続判定に使う）。 */
export function reconnectKey(jobIds: string[]): string {
  return Array.from(new Set(jobIds)).sort().join(",");
}

/** rag のステージ status を粗い UploadStatus に丸める。 */
function toUploadStatus(s: string): UploadStatus {
  if (s === "ready") return "ready";
  if (s === "error") return "error";
  if (s === "queued") return "queued";
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
 * pipeline. The processing phase is driven by a single multiplexed SSE stream. */
export function useUploads(onToast?: PushToast) {
  const [files, setFiles] = useState<StagedFile[]>([]);
  // アップロード進捗アニメ用の interval、送信中POSTのAbortController を id ごとに保持。
  const timers = useRef<Record<string, ReturnType<typeof setInterval>>>({});
  const uploads = useRef<Record<string, AbortController>>({});
  // 進捗は全ジョブを1本の多重化ストリームで購読する。
  const progressStream = useRef<AbortController | null>(null);
  const streamKey = useRef<string>("");
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncRef = useRef<() => void>(() => {});

  const filesRef = useRef(files);
  useEffect(() => { filesRef.current = files; }, [files]);
  const onToastRef = useRef(onToast);
  useEffect(() => { onToastRef.current = onToast; }, [onToast]);

  const clearTimer = useCallback((id: string) => {
    if (timers.current[id]) { clearInterval(timers.current[id]); delete timers.current[id]; }
  }, []);

  interface ProgressFrame {
    jobId: string;
    status: string;
    progress: number;
    stage_detail: string;
    chunks?: number;
    page_count?: number | null;
    error?: string | null;
  }

  /** 1フレームを jobId で該当ファイルに反映し、ready/error はトースト通知する。 */
  const applyFrame = useCallback((j: ProgressFrame) => {
    const target = filesRef.current.find((f) => f.jobId === j.jobId);
    setFiles((prev) =>
      prev.map((f) => {
        if (f.jobId !== j.jobId) return f;
        const status = toUploadStatus(j.status);
        // queued→processing の遷移で計測を開始し、直列処理のキュー待機時間を所要時間に含めない
        // （各ファイル自身の索引化所要時間を表示する）。
        const startedAt = status === "processing" && f.status === "queued" ? Date.now() : f.startedAt;
        return {
          ...f,
          status,
          progress: j.progress,
          stage: asStage(j.status),
          stageDetail: j.stage_detail || undefined,
          chunks: j.chunks ?? f.chunks,
          pages: j.page_count ?? f.pages,
          error: j.error ?? undefined,
          startedAt,
          durationMs: j.status === "ready" && startedAt ? Date.now() - startedAt : f.durationMs,
        };
      }),
    );
    if (j.status === "ready") onToastRef.current?.(`「${target?.name ?? ""}」を索引化しました`, "success");
    if (j.status === "error") onToastRef.current?.(j.error || "索引化に失敗しました", "error");
  }, []);

  /** POST /api/uploads/stream を購読し、jobId 付きフレームを reduce する。 */
  const readStream = useCallback(
    async (ctrl: AbortController, key: string) => {
      try {
        const res = await fetch("/api/uploads/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobIds: key ? key.split(",") : [] }),
          signal: ctrl.signal,
        });
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
            applyFrame(JSON.parse(line.slice(5).trim()) as ProgressFrame);
          }
        }
        // 正常終了（サーバが全ジョブ完了で close）。状態を片付けるのみ。
        // 新規ジョブは enqueue/retry の scheduleSync が拾う。ここで再同期すると
        // filesRef 更新前で完了ジョブを再購読し、トースト二重発火やループを招くため行わない。
        if (progressStream.current === ctrl) {
          progressStream.current = null;
          streamKey.current = "";
        }
      } catch {
        if (ctrl.signal.aborted) return; // 切り替え/clear による中断は無視。
        if (progressStream.current !== ctrl) return; // すでに別接続に置き換わっている。
        // 予期せぬ切断: 未完了ジョブが残っていれば backoff 再接続（全件 error にはしない）。
        progressStream.current = null;
        streamKey.current = "";
        if (activeJobIds(filesRef.current).length > 0) {
          setTimeout(() => syncRef.current(), 1000);
        }
      }
    },
    [applyFrame],
  );

  /** アクティブ jobId 集合に合わせてストリームを1本に保つ。変化が無ければ no-op。 */
  const syncProgressStream = useCallback(() => {
    const key = reconnectKey(activeJobIds(filesRef.current));
    if (key === streamKey.current && progressStream.current) return;
    progressStream.current?.abort();
    progressStream.current = null;
    streamKey.current = key;
    if (!key) return; // 監視対象なし。
    const ctrl = new AbortController();
    progressStream.current = ctrl;
    void readStream(ctrl, key);
  }, [readStream]);

  useEffect(() => { syncRef.current = syncProgressStream; }, [syncProgressStream]);

  /** バースト（連続アップロード）を1回の再接続にまとめる。 */
  const scheduleSync = useCallback(() => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => { debounce.current = null; syncRef.current(); }, 300);
  }, []);

  // アンマウント時に接続・タイマーを片付ける。
  useEffect(
    () => () => {
      progressStream.current?.abort();
      if (debounce.current) clearTimeout(debounce.current);
      Object.values(timers.current).forEach((t) => clearInterval(t));
    },
    [],
  );

  const removeFile = useCallback((id: string) => {
    const file = filesRef.current.find((f) => f.id === id);
    const action = file ? uploadActionFor(file.status) : "remove";

    // processing は取り消し不可（✕ は出さないが、保険でここでも no-op）。
    if (action === "none") return;

    // uploading: 送信中の upload POST を中断してから除去。
    if (action === "abort") {
      uploads.current[id]?.abort();
      delete uploads.current[id];
      // この後、共通のローカル除去へフォールスルーする。
    }

    // queued: サーバ側キャンセルAPIを呼ぶ。成功で除去、409 は処理中として残す。
    if (action === "cancel" && file?.jobId) {
      const jobId = file.jobId;
      fetch(`/api/uploads/${jobId}/cancel`, { method: "POST" })
        .then((res) => {
          if (res.status === 409) {
            onToastRef.current?.("処理中のため取り消せません", "info");
            setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, status: "processing" } : f)));
            return;
          }
          if (!res.ok) {
            onToastRef.current?.("取り消しに失敗しました", "error");
            return;
          }
          clearTimer(id);
          setFiles((prev) => prev.filter((f) => f.id !== id));
          scheduleSync();
        })
        .catch(() => onToastRef.current?.("取り消しに失敗しました", "error"));
      return;
    }

    // abort / remove: ローカル除去。
    setFiles((prev) => prev.filter((f) => f.id !== id));
    clearTimer(id);
    scheduleSync();
  }, [clearTimer, scheduleSync]);

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
        const uploadCtrl = new AbortController();
        uploads.current[id] = uploadCtrl;
        fetch("/api/upload", { method: "POST", body: form, signal: uploadCtrl.signal })
          .then(async (res) => {
            // ✕ で中断済みなら何もしない（ストリーム開始や削除済みファイルへの更新を避ける）。
            if (uploadCtrl.signal.aborted) return;
            clearTimer(id);
            delete uploads.current[id];
            if (!res.ok) {
              const { error } = await res.json().catch(() => ({ error: "アップロードに失敗しました" }));
              setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, status: "error", error } : f)));
              return;
            }
            const { documentId, jobId } = (await res.json()) as { documentId: string; jobId: string };
            setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, status: "queued", progress: 0, jobId, documentId } : f)));
            scheduleSync();
          })
          .catch(() => {
            clearTimer(id);
            delete uploads.current[id];
            if (uploadCtrl.signal.aborted) return; // ✕ による中断はエラー表示しない
            setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, status: "error", error: "ネットワークエラー" } : f)));
          });
      });
    },
    [clearTimer, scheduleSync],
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
      const { jobId } = file;

      setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, status: "processing", progress: 0, stage: undefined, stageDetail: undefined, error: undefined, startedAt: Date.now(), durationMs: undefined } : f)));

      fetch(`/api/uploads/${jobId}/retry`, { method: "POST" })
        .then(async (res) => {
          if (!res.ok) {
            const { error } = await res.json().catch(() => ({ error: "再試行に失敗しました" }));
            setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, status: "error", error } : f)));
            return;
          }
          scheduleSync();
        })
        .catch(() => {
          setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, status: "error", error: "ネットワークエラー" } : f)));
        });
    },
    [scheduleSync],
  );

  const clear = useCallback(() => {
    Object.keys(timers.current).forEach(clearTimer);
    if (debounce.current) { clearTimeout(debounce.current); debounce.current = null; }
    progressStream.current?.abort();
    progressStream.current = null;
    streamKey.current = "";
    Object.values(uploads.current).forEach((c) => c.abort());
    uploads.current = {};
    setFiles([]);
  }, [clearTimer]);

  return { files, addFiles, addFromDataTransfer, removeFile, retry, clear };
}
