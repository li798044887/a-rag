"use client";

import { useCallback, useRef, useState } from "react";
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

  const clearTimers = (id: string) => {
    timers.current[id]?.forEach(clearInterval);
    delete timers.current[id];
  };

  const removeFile = useCallback((id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
    clearTimers(id);
  }, []);

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
            setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, status: "processing", progress: 100 } : f)));
            const data = (await res.json()) as { pages: number | null; chunks: number };
            // Brief "parsing/chunking" beat before marking ready.
            setTimeout(() => {
              setFiles((prev) =>
                prev.map((f) => (f.id === id ? { ...f, status: "ready", pages: data.pages, chunks: data.chunks } : f)),
              );
              onToast?.(`「${file.name}」を索引化しました`, "success");
            }, 500);
          })
          .catch(() => {
            clearTimers(id);
            setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, status: "error", error: "ネットワークエラー" } : f)));
          });
      });

      if (rejected.length) onToast?.(`未対応の形式: ${rejected.join(", ")}`, "error");
    },
    [onToast],
  );

  const clear = useCallback(() => {
    Object.keys(timers.current).forEach(clearTimers);
    setFiles([]);
  }, []);

  return { files, addFiles, removeFile, clear };
}
