import { describe, it, expect } from "vitest";
import { buildLocaleCookie } from "./cookie";

describe("buildLocaleCookie", () => {
  it("生成 1 年有効、path=/、SameSite=Lax 的 cookie 串", () => {
    expect(buildLocaleCookie("ja"))
      .toBe("arag_locale=ja; path=/; max-age=31536000; samesite=lax");
    expect(buildLocaleCookie("zh"))
      .toBe("arag_locale=zh; path=/; max-age=31536000; samesite=lax");
  });
});
