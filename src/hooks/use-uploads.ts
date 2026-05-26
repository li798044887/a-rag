"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ACCEPTED_FILE_TYPES } from "@/lib/constants";
import { uid } from "@/lib/utils";
import type { StagedFile } from "@/lib/types";
import type { PushToast } from "@/hooks/use-toasts";

const ACCEPTED = ACCEPTED_FILE_TYPES.split(",");

/** Stages files, POSTs each to /api/upload, and tracks an upload→process→ready
 * pipeline. Progress is animated client-side while the real round-trip runs. */
export function useUploads(onToast?: PushToast) {
  const [files, setFiles] = useState<StagedFile[]>([]);
  const timers = useRef<Record<string, ReturnType<typeof setInterval>[]>>({});

  // Keep latest files/onToast in refs so stable callbacks read fresh values
  // without re-creating on every render (avoids stale closures + re-poll churn).
  const filesRef = useRef(files);
  useEffect(() => { filesRef.current = files; }, [files]);
  const onToastRef = useRef(onToast);
  useEffect(() => { onToastRef.current = onToast; }, [onToast]);

  const clearTimers = useCallback((id: string) => {
    timers.current[id]?.forEach(clearInterval);
    delete timers.current[id];
  }, []);

  /** Polls /api/uploads/:jobId until ready/error, syncing each tick into the
   * matching StagedFile. Shared by the upload and retry flows. */
  const startPolling = useCallback(
    (id: string, jobId: string, fileName: string) => {
      clearTimers(id);
      const poll = setInterval(async () => {
        const r = await fetch(`/api/uploads/${jobId}`).catch(() => null);
        if (!r || !r.ok) return;
        const j = (await r.json()) as {
          status: string; progress: number; page_count?: number | null;
          chunks?: number; error?: string;
        };
        setFiles((prev) =>
          prev.map((f) =>
            f.id === id
              ? {
                  ...f,
                  progress: j.progress,
                  pages: j.page_count ?? f.pages,
                  chunks: j.chunks ?? f.chunks,
                  status: j.status === "ready" ? "ready" : j.status === "error" ? "error" : "processing",
                  error: j.error ?? undefined,
                }
              : f,
          ),
        );
        if (j.status === "ready") {
          clearTimers(id);
          onToastRef.current?.(`「${fileName}」を索引化しました`, "success");
        }
        if (j.status === "error") {
          clearTimers(id);
          onToastRef.current?.(j.error || "索引化に失敗しました", "error");
        }
      }, 1000);
      timers.current[id] = [poll];
    },
    [clearTimers],
  );

  const removeFile = useCallback((id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
    clearTimers(id);
  }, [clearTimers]);

  const addFiles = useCallback(
    (fileList: FileList | File[] | null) => {
      const list = Array.from(fileList || []);
      if (!list.length) return;
      const rejected: string[] = [];

      list.forEach((file) => {
        const ext = "." + (file.name.split(".").pop() || "").toLowerCase();
        if (!ACCEPTED.includes(ext)) {
          rejected.push(file.name);
          return;
        }
        const id = uid("f_");
        setFiles((prev) => [...prev, { id, name: file.name, size: file.size, status: "uploading", progress: 0 }]);

        // Animate upload progress toward 90% until the server responds.
        const tick = setInterval(() => {
          setFiles((prev) =>
            prev.map((f) =>
              f.id === id && f.status === "uploading"
                ? { ...f, progress: Math.min(90, f.progress + Math.floor(12 + Math.random() * 18)) }
                : f,
            ),
          );
        }, 200);
        timers.current[id] = [tick];

        const form = new FormData();
        form.append("file", file);
        fetch("/api/upload", { method: "POST", body: form })
          .then(async (res) => {
            clearTimers(id);
            if (!res.ok) {
              const { error } = await res.json().catch(() => ({ error: "アップロードに失敗しました" }));
              setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, status: "error", error } : f)));
              return;
            }
            const { jobId } = (await res.json()) as { documentId: string; jobId: string };
            setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, status: "processing", progress: 10, jobId } : f)));
            startPolling(id, jobId, file.name);
          })
          .catch(() => {
            clearTimers(id);
            setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, status: "error", error: "ネットワークエラー" } : f)));
          });
      });

      if (rejected.length) onToastRef.current?.(`未対応の形式: ${rejected.join(", ")}`, "error");
    },
    [clearTimers, startPolling],
  );

  const retry = useCallback(
    (id: string) => {
      const file = filesRef.current.find((f) => f.id === id);
      if (!file?.jobId) return;
      const { jobId, name } = file;

      clearTimers(id);
      setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, status: "processing", progress: 0, error: undefined } : f)));

      fetch(`/api/uploads/${jobId}/retry`, { method: "POST" })
        .then(async (res) => {
          if (!res.ok) {
            const { error } = await res.json().catch(() => ({ error: "再試行に失敗しました" }));
            setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, status: "error", error } : f)));
            return;
          }
          startPolling(id, jobId, name);
        })
        .catch(() => {
          setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, status: "error", error: "ネットワークエラー" } : f)));
        });
    },
    [clearTimers, startPolling],
  );

  const clear = useCallback(() => {
    Object.keys(timers.current).forEach(clearTimers);
    setFiles([]);
  }, [clearTimers]);

  return { files, addFiles, removeFile, retry, clear };
}
