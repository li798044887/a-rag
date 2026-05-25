"use client";

import { useSyncExternalStore } from "react";

/** SSR-safe media-query subscription (no setState-in-effect, no hydration flash). */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const m = window.matchMedia(query);
      m.addEventListener("change", onChange);
      return () => m.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false, // server snapshot
  );
}
