/** A tiny, swappable retrieval layer over the seed corpus.
 *
 * Production swaps this for pgvector / Qdrant; the interface (rank a query to an
 * ordered list of sources with scores) stays identical, so the agent and routes
 * don't change. Scoring here is lexical term-overlap — deterministic and
 * dependency-free so the flow runs without external infrastructure. */

import { SAMPLE_SOURCES } from "@/lib/data";
import type { Source } from "@/lib/types";

export interface ScoredSource {
  source: Source;
  score: number;
}

const STOP = new Set(["の", "を", "に", "は", "が", "で", "と", "て", "た", "し", "について", "教えて"]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[、。・,.!?「」（）()[\]]/g, " ")
    .split(/\s+/)
    .flatMap((w) => {
      // Lightweight bigram split for CJK runs so JP queries still overlap.
      if (/[぀-ヿ一-鿿]/.test(w) && w.length > 2) {
        const grams: string[] = [w];
        for (let i = 0; i < w.length - 1; i++) grams.push(w.slice(i, i + 2));
        return grams;
      }
      return [w];
    })
    .filter((w) => w && !STOP.has(w));
}

function sourceText(s: Source): string {
  return [s.title, ...s.sections.map((sec) => sec.heading + " " + sec.body)].join(" ");
}

/** Rank all sources against a query. Always returns the full corpus, ordered. */
export function retrieve(query: string): ScoredSource[] {
  const terms = tokenize(query);
  const scored = SAMPLE_SOURCES.map((source) => {
    const hay = sourceText(source).toLowerCase();
    let score = 0;
    for (const t of terms) {
      if (hay.includes(t)) score += t.length >= 2 ? 1 : 0.4;
    }
    // Stable tie-break preserving the curated order.
    return { source, score: score + (4 - SAMPLE_SOURCES.indexOf(source)) * 0.001 };
  });
  return scored.sort((a, b) => b.score - a.score);
}

/** Return the highlight section id for a source (first flagged, else first). */
export function highlightSectionFor(source: Source): string {
  return (source.sections.find((s) => s.highlight) || source.sections[0]).id;
}
