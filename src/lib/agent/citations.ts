import type { CitationMap, Source } from "@/lib/types";

export interface CitationInput {
  documentId: string;
  documentTitle: string;
  chunkId: string;
  headingPath: string;
  snippet: string;
  blockType: string;
  page: number;
  /** 再ランクスコア(0–1)。retrieve 由来のみ持ち、fetch_document 由来では undefined。 */
  score?: number;
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

  /** 引用番号 [n] から登録済みの出典を引く。未登録なら undefined。 */
  resolve(n: number): CitationInput | undefined {
    if (!Number.isInteger(n) || n < 1) return undefined;
    return this.order[n - 1];
  }

  /**
   * document 単位に束ねた Source[]（登録順を保持）。
   * cited を渡すと、その出典番号 [n] に対応するチャンクのみを採用する
   * （= 回答が実際に引用した資料だけをパネルに出す）。
   */
  toSources(cited?: Set<number>): Source[] {
    const byDoc = new Map<string, Source>();
    this.order.forEach((c, i) => {
      if (cited && !cited.has(i + 1)) return;
      let src = byDoc.get(c.documentId);
      if (!src) {
        src = { id: c.documentId, type: "doc", title: c.documentTitle, path: c.documentTitle,
                author: "", date: "", sections: [] };
        byDoc.set(c.documentId, src);
      }
      if (!src.sections.some((s) => s.id === c.chunkId)) {
        src.sections.push({
          id: c.chunkId, heading: c.headingPath, body: c.snippet,
          highlight: true, blockType: c.blockType, page: c.page,
        });
      }
      // 関連度は文書内チャンクの最大スコアを採用する。
      if (typeof c.score === "number") {
        src.score = src.score === undefined ? c.score : Math.max(src.score, c.score);
      }
    });
    return [...byDoc.values()];
  }

  /** cited を渡すと、引用された出典番号のエントリだけを残す（番号は元のまま維持）。 */
  toCitationMap(cited?: Set<number>): CitationMap {
    const map: CitationMap = {};
    this.order.forEach((c, i) => {
      const n = i + 1;
      if (cited && !cited.has(n)) return;
      map[n] = { sourceId: c.documentId, sectionId: c.chunkId };
    });
    return map;
  }

  /**
   * 引用集合 cited に、引用された文書に属する画像チャンクの番号を加えて返す。
   * 画像は本文で [n] 参照されにくい（回答にはインライン画像として出る）が、
   * 引用文書の図版は一次資料パネルに出すべきため、文書単位で取り込む。
   */
  withDocumentImages(cited: Set<number>): Set<number> {
    const citedDocs = new Set<string>();
    this.order.forEach((c, i) => {
      if (cited.has(i + 1)) citedDocs.add(c.documentId);
    });
    const expanded = new Set(cited);
    this.order.forEach((c, i) => {
      if (c.blockType === "image" && citedDocs.has(c.documentId)) expanded.add(i + 1);
    });
    return expanded;
  }

  /** verify 用に、登録済み出典を引用番号 n 付きで列挙する（登録順）。 */
  listSources(): { n: number; title: string; heading: string; snippet: string }[] {
    return this.order.map((c, i) => ({
      n: i + 1, title: c.documentTitle, heading: c.headingPath, snippet: c.snippet,
    }));
  }

  get size(): number {
    return this.order.length;
  }
}
