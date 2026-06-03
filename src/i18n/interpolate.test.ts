import { describe, it, expect } from "vitest";
import { interpolate } from "./interpolate";

describe("interpolate", () => {
  it("替换 {var} 占位符", () => {
    expect(interpolate("全 {total} 件中 {shown} 件", { total: 100, shown: 20 }))
      .toBe("全 100 件中 20 件");
  });
  it("无 vars 时原样返回", () => {
    expect(interpolate("質問を入力")).toBe("質問を入力");
  });
  it("缺失变量保留占位符", () => {
    expect(interpolate("{a} と {b}", { a: "x" })).toBe("x と {b}");
  });
});
