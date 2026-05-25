"use client";

import { useCallback, useState } from "react";
import { uid } from "@/lib/utils";
import type { Toast, ToastKind } from "@/lib/types";

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((msg: string, kind: ToastKind = "info", ms = 2400) => {
    const id = uid();
    setToasts((prev) => [...prev, { id, msg, kind }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), ms);
  }, []);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return { toasts, push, dismiss };
}

export type PushToast = ReturnType<typeof useToasts>["push"];
