import { describe, it, expect, vi, beforeEach } from "vitest";

const getMock = vi.fn();
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: getMock }),
}));

import { getLocale } from "./server";

describe("getLocale", () => {
  beforeEach(() => getMock.mockReset());

  it("Cookie 为 ja 时返回 ja", async () => {
    getMock.mockReturnValue({ value: "ja" });
    expect(await getLocale()).toBe("ja");
  });
  it("Cookie 为 zh 时返回 zh", async () => {
    getMock.mockReturnValue({ value: "zh" });
    expect(await getLocale()).toBe("zh");
  });
  it("缺失时回退默认 zh", async () => {
    getMock.mockReturnValue(undefined);
    expect(await getLocale()).toBe("zh");
  });
  it("非法值回退默认 zh", async () => {
    getMock.mockReturnValue({ value: "en" });
    expect(await getLocale()).toBe("zh");
  });
});
