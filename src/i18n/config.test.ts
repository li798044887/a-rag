import { describe, it, expect } from "vitest";
import { isLocale, htmlLang, DEFAULT_LOCALE, LOCALES, LOCALE_LABELS, LOCALE_COOKIE } from "./config";

describe("i18n config", () => {
  it("默认语言为日语", () => {
    expect(DEFAULT_LOCALE).toBe("ja");
  });
  it("支持 zh / ja 两种语言", () => {
    expect(LOCALES).toEqual(["ja", "zh"]);
    expect(LOCALE_LABELS).toEqual({ zh: "中文", ja: "日本語" });
  });
  it("Cookie 名为 arag_locale", () => {
    expect(LOCALE_COOKIE).toBe("arag_locale");
  });
  it("isLocale 仅接受合法值", () => {
    expect(isLocale("zh")).toBe(true);
    expect(isLocale("ja")).toBe(true);
    expect(isLocale("en")).toBe(false);
    expect(isLocale(undefined)).toBe(false);
  });
  it("htmlLang 映射 BCP47", () => {
    expect(htmlLang("zh")).toBe("zh-CN");
    expect(htmlLang("ja")).toBe("ja");
  });
});
