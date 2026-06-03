/** 辞書文字列中の {var} を vars で置換する。vars 省略時はそのまま返す。
 *  欠落キーは {key} を残す（翻訳漏れの可視化のため）。 */
export function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    key in vars ? String(vars[key]) : `{${key}}`,
  );
}
