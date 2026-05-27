import { expect, test } from "vitest";
import { CitationRegistry } from "@/lib/agent/citations";

test("register assigns sequential numbers and dedupes by chunkId", () => {
  const reg = new CitationRegistry();
  const n1 = reg.register({ documentId: "d1", documentTitle: "設計.pdf", chunkId: "c1",
    headingPath: "認証", snippet: "本文1" });
  const n2 = reg.register({ documentId: "d1", documentTitle: "設計.pdf", chunkId: "c2",
    headingPath: "認可", snippet: "本文2" });
  const n1again = reg.register({ documentId: "d1", documentTitle: "設計.pdf", chunkId: "c1",
    headingPath: "認証", snippet: "本文1" });
  expect([n1, n2, n1again]).toEqual([1, 2, 1]);
});

test("toSources groups by document and toCitationMap maps ordinals", () => {
  const reg = new CitationRegistry();
  reg.register({ documentId: "d1", documentTitle: "A", chunkId: "c1", headingPath: "h1", snippet: "s1" });
  reg.register({ documentId: "d1", documentTitle: "A", chunkId: "c2", headingPath: "h2", snippet: "s2" });
  reg.register({ documentId: "d2", documentTitle: "B", chunkId: "c3", headingPath: "h3", snippet: "s3" });

  const sources = reg.toSources();
  expect(sources.map((s) => s.id)).toEqual(["d1", "d2"]);
  expect(sources[0].sections.map((x) => x.id)).toEqual(["c1", "c2"]);

  const map = reg.toCitationMap();
  expect(map[1]).toMatchObject({ sourceId: "d1", sectionId: "c1" });
  expect(map[3]).toMatchObject({ sourceId: "d2", sectionId: "c3" });
});
