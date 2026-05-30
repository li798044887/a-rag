import { describe, expect, it } from "vitest";
import { parseSectionBody } from "@/components/sources/parse-section-body";

describe("parseSectionBody", () => {
  it("プレーンテキストは 1 つの text セグメント", () => {
    expect(parseSectionBody("ただの本文")).toEqual([{ kind: "text", text: "ただの本文" }]);
  });

  it("空文字は空配列", () => {
    expect(parseSectionBody("   ")).toEqual([]);
  });

  it("表のみ", () => {
    const html = "<table><tr><td>A</td></tr></table>";
    expect(parseSectionBody(html)).toEqual([{ kind: "table", html }]);
  });

  it("画像のみ（src と alt を取り出す）", () => {
    expect(parseSectionBody("![冷却図](/api/documents/d/assets/images/a.jpg)")).toEqual([
      { kind: "image", alt: "冷却図", src: "/api/documents/d/assets/images/a.jpg" },
    ]);
  });

  it("テキスト→画像→テキストの順序を保つ", () => {
    const segs = parseSectionBody("前\n![](/x/a.jpg)\n後");
    expect(segs).toEqual([
      { kind: "text", text: "前" },
      { kind: "image", alt: "", src: "/x/a.jpg" },
      { kind: "text", text: "後" },
    ]);
  });

  it("テキストと表の混在", () => {
    const segs = parseSectionBody("見出し\n<table><tr><td>A</td></tr></table>");
    expect(segs).toEqual([
      { kind: "text", text: "見出し" },
      { kind: "table", html: "<table><tr><td>A</td></tr></table>" },
    ]);
  });
});
