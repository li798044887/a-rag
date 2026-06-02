"use client";

import { useRef } from "react";
import { clampPanelWidth, RP_WIDTH_DEFAULT, RP_WIDTH_MAX, RP_WIDTH_MIN } from "@/components/workspace/panel-width";
import { useT } from "@/i18n/context";

/**
 * パネル左境界に置く幅調整ハンドル。ハンドルは左にあるので
 * 左ドラッグ／ArrowLeft で広がり、右ドラッグ／ArrowRight で狭まる。
 * ダブルクリックで既定幅に戻す。
 */
export function PanelResizer({ width, onWidth }: { width: number; onWidth: (px: number) => void }) {
  const { t } = useT();
  const drag = useRef<{ startX: number; startW: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { startX: e.clientX, startW: width };
    document.body.style.userSelect = "none";
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const next = clampPanelWidth(drag.current.startW + (drag.current.startX - e.clientX), window.innerWidth);
    onWidth(next);
  };

  const end = (e: React.PointerEvent) => {
    if (!drag.current) return;
    drag.current = null;
    document.body.style.userSelect = "";
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 48 : 16;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      onWidth(clampPanelWidth(width + step, window.innerWidth));
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      onWidth(clampPanelWidth(width - step, window.innerWidth));
    }
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={t.sources.panelResizerAriaLabel}
      aria-valuenow={width}
      aria-valuemin={RP_WIDTH_MIN}
      aria-valuemax={RP_WIDTH_MAX}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onKeyDown={onKeyDown}
      onDoubleClick={() => onWidth(RP_WIDTH_DEFAULT)}
      className="group/resz absolute left-0 top-0 z-[2] h-full w-2 -translate-x-1/2 cursor-col-resize touch-none select-none"
    >
      <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors group-hover/resz:bg-accent group-focus-visible/resz:bg-accent" />
    </div>
  );
}
