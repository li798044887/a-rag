import { describe, it, expect, vi, beforeEach } from "vitest";

const cookieGetMock = vi.fn();
const headerGetMock = vi.fn();
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: cookieGetMock }),
  headers: async () => ({ get: headerGetMock }),
}));

import { getLocale, negotiateLocale } from "./server";

describe("getLocale", () => {
  beforeEach(() => {
    cookieGetMock.mockReset();
    headerGetMock.mockReset();
    headerGetMock.mockReturnValue(null);
  });

  it("Cookie 为 ja 时返回 ja", async () => {
    cookieGetMock.mockReturnValue({ value: "ja" });
    expect(await getLocale()).toBe("ja");
  });
  it("Cookie 为 zh 时返回 zh", async () => {
    cookieGetMock.mockReturnValue({ value: "zh" });
    expect(await getLocale()).toBe("zh");
  });
  it("Cookie 优先于 Accept-Language", async () => {
    cookieGetMock.mockReturnValue({ value: "ja" });
    headerGetMock.mockReturnValue("zh-CN");
    expect(await getLocale()).toBe("ja");
  });
  it("无 Cookie 时按 Accept-Language 解析为 zh", async () => {
    cookieGetMock.mockReturnValue(undefined);
    headerGetMock.mockReturnValue("zh-CN,zh;q=0.9,en;q=0.8");
    expect(await getLocale()).toBe("zh");
  });
  it("无 Cookie 时按 Accept-Language 解析为 ja", async () => {
    cookieGetMock.mockReturnValue(undefined);
    headerGetMock.mockReturnValue("ja-JP,ja;q=0.9");
    expect(await getLocale()).toBe("ja");
  });
  it("缺失 Cookie 与 Accept-Language 时回退默认 ja", async () => {
    cookieGetMock.mockReturnValue(undefined);
    headerGetMock.mockReturnValue(null);
    expect(await getLocale()).toBe("ja");
  });
  it("非法 Cookie 值回退到 Accept-Language", async () => {
    cookieGetMock.mockReturnValue({ value: "en" });
    headerGetMock.mockReturnValue("zh");
    expect(await getLocale()).toBe("zh");
  });
});

describe("negotiateLocale", () => {
  it("空值返回 null", () => {
    expect(negotiateLocale(null)).toBeNull();
    expect(negotiateLocale("")).toBeNull();
  });
  it("不支持的语言返回 null", () => {
    expect(negotiateLocale("en-US,en;q=0.9,fr;q=0.8")).toBeNull();
  });
  it("按 q 值高低择优", () => {
    expect(negotiateLocale("en;q=0.9,ja;q=0.5,zh;q=0.8")).toBe("zh");
  });
  it("先頭一致で言語サブタグを無視", () => {
    expect(negotiateLocale("zh-Hant-TW")).toBe("zh");
  });
});
