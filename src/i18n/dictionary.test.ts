import { describe, it, expect } from "vitest";
import { getDictionary } from "./dictionary";
import { zh } from "./locales/zh";
import { ja } from "./locales/ja";

/** 任意のネスト辞書からキー経路を全列挙する。 */
function keyPaths(obj: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([k, v]) => {
    const path = prefix ? `${prefix}.${k}` : k;
    return typeof v === "object" && v !== null
      ? keyPaths(v as Record<string, unknown>, path)
      : [path];
  });
}

describe("dictionary", () => {
  it("getDictionary 按 locale 返回对应词典", () => {
    expect(getDictionary("zh")).toBe(zh);
    expect(getDictionary("ja")).toBe(ja);
  });
  it("zh / ja 键完全对等（运行时双保险）", () => {
    expect(keyPaths(ja).sort()).toEqual(keyPaths(zh).sort());
  });
  it("common 含基础动作文案", () => {
    expect(zh.common.cancel).toBe("取消");
    expect(ja.common.cancel).toBe("キャンセル");
  });
});
