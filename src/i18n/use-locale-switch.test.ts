import { describe, it, expect, vi } from "vitest";
import { performLocaleSwitch } from "./use-locale-switch";

describe("performLocaleSwitch", () => {
  it("写入 cookie 并触发 reload", () => {
    const setCookie = vi.fn();
    const reload = vi.fn();
    performLocaleSwitch("ja", { setCookie, reload });
    expect(setCookie).toHaveBeenCalledWith("arag_locale=ja; path=/; max-age=31536000; samesite=lax");
    expect(reload).toHaveBeenCalledOnce();
  });
});
