"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface OverflowState {
  left: boolean;
  right: boolean;
}

/** スクロール量から左右に「続き」があるかを判定する。端数は 1px まで許容。 */
export function computeOverflow(m: {
  scrollLeft: number;
  scrollWidth: number;
  clientWidth: number;
}): OverflowState {
  const EPS = 1;
  const max = m.scrollWidth - m.clientWidth;
  return {
    left: m.scrollLeft > EPS,
    right: m.scrollLeft < max - EPS,
  };
}

/**
 * 横スクロール要素の左右オーバーフロー状態を返すフック。
 * scroll とサイズ変化（ResizeObserver）の両方で再計測する。
 */
export function useOverflow<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [overflow, setOverflow] = useState<OverflowState>({ left: false, right: false });

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setOverflow(computeOverflow(el));
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", measure);
      ro.disconnect();
    };
  }, [measure]);

  return { ref, overflow, measure };
}
