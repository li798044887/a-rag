"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { clampPanelWidth, RP_WIDTH_DEFAULT, RP_WIDTH_STORAGE_KEY } from "@/components/workspace/panel-width";

const EVENT = "arag:rp-width";

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

// 生の文字列を返してスナップショット参照を安定させる（use-tweaks と同方針）。
const getSnapshot = () => localStorage.getItem(RP_WIDTH_STORAGE_KEY) ?? "";
const getServerSnapshot = () => "";

/**
 * 一次資料パネルの幅を localStorage と同期する SSR セーフなフック。
 * サーバ／ハイドレーション時は既定幅を返し、マウント後にクライアントの保存値へ切り替わる
 * （ハイドレーション不整合を避ける）。
 */
export function usePanelWidth(): [number, (px: number) => void] {
  const raw = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const width = useMemo(() => {
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) ? clampPanelWidth(n, window.innerWidth) : RP_WIDTH_DEFAULT;
  }, [raw]);
  const setWidth = useCallback((px: number) => {
    const next = clampPanelWidth(px, window.innerWidth);
    localStorage.setItem(RP_WIDTH_STORAGE_KEY, String(next));
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return [width, setWidth];
}
