import { describe, expect, it } from "vitest";
import { resolveImageUrls } from "@/lib/agent/image-urls";

describe("resolveImageUrls", () => {
  const doc = "doc-123";

  it("相対 images/ パスを絶対 API パスに書き換える", () => {
    expect(resolveImageUrls("![図1](images/a.jpg)", doc)).toBe(
      "![図1](/api/documents/doc-123/assets/images/a.jpg)",
    );
  });

  it("alt が空でも書き換える", () => {
    expect(resolveImageUrls("![](images/b.png)", doc)).toBe(
      "![](/api/documents/doc-123/assets/images/b.png)",
    );
  });

  it("1 つの本文中の複数画像を書き換える", () => {
    const out = resolveImageUrls("前 ![](images/a.jpg) 中 ![x](images/b.png) 後", doc);
    expect(out).toBe(
      "前 ![](/api/documents/doc-123/assets/images/a.jpg) 中 ![x](/api/documents/doc-123/assets/images/b.png) 後",
    );
  });

  it("images/ 以外のリンクや通常テキストは変更しない", () => {
    expect(resolveImageUrls("通常テキスト [link](https://x/y)", doc)).toBe(
      "通常テキスト [link](https://x/y)",
    );
  });

  it("既に絶対 URL の画像は二重変換しない", () => {
    const already = "![](https://cdn/x.jpg)";
    expect(resolveImageUrls(already, doc)).toBe(already);
  });

  it("表 HTML と混在しても表を壊さない", () => {
    const body = "<table><tr><td>A</td></tr></table>\n![](images/c.jpg)";
    expect(resolveImageUrls(body, doc)).toBe(
      "<table><tr><td>A</td></tr></table>\n![](/api/documents/doc-123/assets/images/c.jpg)",
    );
  });
});
