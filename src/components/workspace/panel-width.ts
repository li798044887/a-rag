export const RP_WIDTH_DEFAULT = 420;
export const RP_WIDTH_MIN = 360;
export const RP_WIDTH_MAX = 720;

const STORAGE_KEY = "arag.rp-width";

/** 幅を [最小, min(最大, ビューポート50%)] に丸める。上限が下限を割る場合は上限を優先。 */
export function clampPanelWidth(px: number, viewportWidth: number): number {
  const max = Math.min(RP_WIDTH_MAX, Math.round(viewportWidth * 0.5));
  const lo = Math.min(RP_WIDTH_MIN, max);
  return Math.max(lo, Math.min(max, Math.round(px)));
}

/** 永続化された幅を読む。未保存・不正・SSR 時は既定値。 */
export function loadPanelWidth(): number {
  if (typeof window === "undefined") return RP_WIDTH_DEFAULT;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) ? clampPanelWidth(n, window.innerWidth) : RP_WIDTH_DEFAULT;
}

/** 幅を永続化する。 */
export function savePanelWidth(px: number): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, String(px));
}
