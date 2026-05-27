import type { CitationMap, Source } from "@/lib/types";

export interface CitationInput {
  documentId: string;
  documentTitle: string;
  chunkId: string;
  headingPath: string;
  snippet: string;
}

/** 1ターンスコープの引用番号付け。chunkId をキーに通し番号 [n] を割り当てる。 */
export class CitationRegistry {
  private order: CitationInput[] = [];
  private index = new Map<string, number>(); // chunkId -> n

  register(c: CitationInput): number {
    const existing = this.index.get(c.chunkId);
    if (existing) return existing;
    const n = this.order.length + 1;
    this.order.push(c);
    this.index.set(c.chunkId, n);
    return n;
  }

  /** document 単位に束ねた Source[]（登録順を保持）。 */
  toSources(): Source[] {
    const byDoc = new Map<string, Source>();
    for (const c of this.order) {
      let src = byDoc.get(c.documentId);
      if (!src) {
        src = { id: c.documentId, type: "doc", title: c.documentTitle, path: c.documentTitle,
                author: "", date: "", sections: [] };
        byDoc.set(c.documentId, src);
      }
      if (!src.sections.some((s) => s.id === c.chunkId)) {
        src.sections.push({ id: c.chunkId, heading: c.headingPath, body: c.snippet, highlight: true });
      }
    }
    return [...byDoc.values()];
  }

  toCitationMap(): CitationMap {
    const map: CitationMap = {};
    this.order.forEach((c, i) => { map[i + 1] = { sourceId: c.documentId, sectionId: c.chunkId }; });
    return map;
  }

  get size(): number {
    return this.order.length;
  }
}
