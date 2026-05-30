import { describe, expect, it, test } from "vitest";
import { CitationRegistry } from "@/lib/agent/citations";

test("register assigns sequential numbers and dedupes by chunkId", () => {
  const reg = new CitationRegistry();
  const n1 = reg.register({ documentId: "d1", documentTitle: "設計.pdf", chunkId: "c1",
    headingPath: "認証", snippet: "本文1", blockType: "text", page: 0 });
  const n2 = reg.register({ documentId: "d1", documentTitle: "設計.pdf", chunkId: "c2",
    headingPath: "認可", snippet: "本文2", blockType: "text", page: 0 });
  const n1again = reg.register({ documentId: "d1", documentTitle: "設計.pdf", chunkId: "c1",
    headingPath: "認証", snippet: "本文1", blockType: "text", page: 0 });
  expect([n1, n2, n1again]).toEqual([1, 2, 1]);
});

test("toSources groups by document and toCitationMap maps ordinals", () => {
  const reg = new CitationRegistry();
  reg.register({ documentId: "d1", documentTitle: "A", chunkId: "c1", headingPath: "h1", snippet: "s1", blockType: "text", page: 0 });
  reg.register({ documentId: "d1", documentTitle: "A", chunkId: "c2", headingPath: "h2", snippet: "s2", blockType: "text", page: 0 });
  reg.register({ documentId: "d2", documentTitle: "B", chunkId: "c3", headingPath: "h3", snippet: "s3", blockType: "text", page: 0 });

  const sources = reg.toSources();
  expect(sources.map((s) => s.id)).toEqual(["d1", "d2"]);
  expect(sources[0].sections.map((x) => x.id)).toEqual(["c1", "c2"]);

  const map = reg.toCitationMap();
  expect(map[1]).toMatchObject({ sourceId: "d1", sectionId: "c1" });
  expect(map[3]).toMatchObject({ sourceId: "d2", sectionId: "c3" });
});

describe("CitationRegistry メタ伝播", () => {
  it("toSources が blockType と page をセクションに載せる", () => {
    const reg = new CitationRegistry();
    reg.register({
      documentId: "d1", documentTitle: "設計.pdf", chunkId: "c1",
      headingPath: "資格", snippet: "<table><tr><td>A</td></tr></table>",
      blockType: "table", page: 2,
    });
    const sources = reg.toSources();
    expect(sources).toHaveLength(1);
    const sec = sources[0].sections[0];
    expect(sec.blockType).toBe("table");
    expect(sec.page).toBe(2);
  });

  it("メタ未指定でも既定値で動く", () => {
    const reg = new CitationRegistry();
    reg.register({
      documentId: "d1", documentTitle: "x", chunkId: "c1",
      headingPath: "h", snippet: "本文", blockType: "text", page: 0,
    });
    const sec = reg.toSources()[0].sections[0];
    expect(sec.blockType).toBe("text");
    expect(sec.page).toBe(0);
  });

  it("関連度は文書内チャンクの最大スコアを採用する", () => {
    const reg = new CitationRegistry();
    reg.register({ documentId: "d1", documentTitle: "A", chunkId: "c1",
      headingPath: "h1", snippet: "s1", blockType: "text", page: 0, score: 0.42 });
    reg.register({ documentId: "d1", documentTitle: "A", chunkId: "c2",
      headingPath: "h2", snippet: "s2", blockType: "text", page: 0, score: 0.91 });
    expect(reg.toSources()[0].score).toBe(0.91);
  });

  it("スコア未指定なら score は undefined", () => {
    const reg = new CitationRegistry();
    reg.register({ documentId: "d1", documentTitle: "A", chunkId: "c1",
      headingPath: "h1", snippet: "s1", blockType: "text", page: 0 });
    expect(reg.toSources()[0].score).toBeUndefined();
  });
});

describe("引用フィルタ（実際に引用された出典のみ採用）", () => {
  const seed = () => {
    const reg = new CitationRegistry();
    // [1] d1, [2] d2, [3] d1(別チャンク)
    reg.register({ documentId: "d1", documentTitle: "A", chunkId: "c1",
      headingPath: "h1", snippet: "s1", blockType: "text", page: 0, score: 0.2 });
    reg.register({ documentId: "d2", documentTitle: "B", chunkId: "c2",
      headingPath: "h2", snippet: "s2", blockType: "text", page: 0, score: 0.01 });
    reg.register({ documentId: "d1", documentTitle: "A", chunkId: "c3",
      headingPath: "h3", snippet: "s3", blockType: "text", page: 0, score: 0.95 });
    return reg;
  };

  it("引用された番号の資料だけを toSources が返す", () => {
    const sources = seed().toSources(new Set([1, 3]));
    // d2([2]) は未引用なので除外、d1 のみ・引用された 2 セクション
    expect(sources.map((s) => s.id)).toEqual(["d1"]);
    expect(sources[0].sections.map((x) => x.id)).toEqual(["c1", "c3"]);
    // 関連度は引用チャンクの最大スコア
    expect(sources[0].score).toBe(0.95);
  });

  it("toCitationMap は元の番号を維持しつつ未引用を落とす", () => {
    const map = seed().toCitationMap(new Set([1, 3]));
    expect(Object.keys(map)).toEqual(["1", "3"]);
    expect(map[1]).toMatchObject({ sourceId: "d1", sectionId: "c1" });
    expect(map[3]).toMatchObject({ sourceId: "d1", sectionId: "c3" });
  });

  it("引数なしなら全件（フォールバック）", () => {
    expect(seed().toSources().map((s) => s.id)).toEqual(["d1", "d2"]);
  });
});

describe("withDocumentImages（引用文書の図版をパネルに含める）", () => {
  const seed = () => {
    const reg = new CitationRegistry();
    // [1] d1 text, [2] d1 image, [3] d2 text, [4] d2 image
    reg.register({ documentId: "d1", documentTitle: "A", chunkId: "c1",
      headingPath: "h1", snippet: "本文", blockType: "text", page: 0 });
    reg.register({ documentId: "d1", documentTitle: "A", chunkId: "img1",
      headingPath: "図", snippet: "![](/api/documents/d1/assets/images/a.jpg)", blockType: "image", page: 0 });
    reg.register({ documentId: "d2", documentTitle: "B", chunkId: "c2",
      headingPath: "h2", snippet: "本文2", blockType: "text", page: 0 });
    reg.register({ documentId: "d2", documentTitle: "B", chunkId: "img2",
      headingPath: "図2", snippet: "![](/api/documents/d2/assets/images/b.jpg)", blockType: "image", page: 0 });
    return reg;
  };

  it("引用文書(d1)の画像チャンクを cited に追加する", () => {
    // text [1] のみ引用 → 同一文書の画像 [2] も含める。d2 は未引用なので [4] は含めない。
    const expanded = seed().withDocumentImages(new Set([1]));
    expect([...expanded].sort((a, b) => a - b)).toEqual([1, 2]);
  });

  it("拡張した集合を toSources に渡すと画像セクションがパネルに出る", () => {
    const reg = seed();
    const sources = reg.toSources(reg.withDocumentImages(new Set([1])));
    expect(sources.map((s) => s.id)).toEqual(["d1"]);
    expect(sources[0].sections.map((x) => x.id)).toEqual(["c1", "img1"]);
  });

  it("引用が無い文書の画像は追加しない", () => {
    const expanded = seed().withDocumentImages(new Set([3]));
    // d2 text [3] 引用 → d2 image [4] を追加、d1 は無関係
    expect([...expanded].sort((a, b) => a - b)).toEqual([3, 4]);
  });
});
