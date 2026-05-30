export const RP_WIDTH_DEFAULT = 420;
export const RP_WIDTH_MIN = 360;
export const RP_WIDTH_MAX = 720;

export const RP_WIDTH_STORAGE_KEY = "arag.rp-width";

/** 幅を [最小, min(最大, ビューポート50%)] に丸める。上限が下限を割る場合は上限を優先。 */
export function clampPanelWidth(px: number, viewportWidth: number): number {
  const max = Math.min(RP_WIDTH_MAX, Math.round(viewportWidth * 0.5));
  const lo = Math.min(RP_WIDTH_MIN, max);
  return Math.max(lo, Math.min(max, Math.round(px)));
}
