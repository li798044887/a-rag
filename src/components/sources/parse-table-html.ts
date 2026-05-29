export interface InlineSegment {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  href?: string;
}

export interface TableCell {
  header: boolean;
  colspan: number;
  rowspan: number;
  lines: InlineSegment[][]; // 各行 = セグメント配列
}

export interface TableRow {
  cells: TableCell[];
}

export interface TableModel {
  rows: TableRow[];
}

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X"
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[body] ?? m;
  });
}

function safeHref(raw: string): string | undefined {
  const href = decodeEntities(raw).trim();
  return /^(https?:\/\/|mailto:|\/|#)/i.test(href) ? href : undefined;
}

// セル内 HTML を「行(セグメント配列)の配列」に変換する。
function parseInline(html: string): InlineSegment[][] {
  const lines: InlineSegment[][] = [[]];
  let bold = 0, italic = 0, underline = 0, skip = 0;
  let href: string | undefined;

  const pushText = (text: string) => {
    if (skip > 0) return;
    const decoded = decodeEntities(text);
    if (!decoded) return;
    const seg: InlineSegment = { text: decoded };
    if (bold) seg.bold = true;
    if (italic) seg.italic = true;
    if (underline) seg.underline = true;
    if (href) seg.href = href;
    lines[lines.length - 1].push(seg);
  };
  const newline = () => { lines.push([]); };

  const re = /<\/?([a-zA-Z0-9]+)([^>]*)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const textRun = m[3];
    if (textRun !== undefined) { pushText(textRun); continue; }
    const tag = m[1].toLowerCase();
    const attrs = m[2] || "";
    const closing = m[0][1] === "/";
    if (tag === "br") { newline(); continue; }
    if (tag === "p") { if (closing) newline(); continue; }
    if (tag === "script" || tag === "style") { skip += closing ? -1 : 1; if (skip < 0) skip = 0; continue; }
    if (tag === "strong" || tag === "b") { bold += closing ? -1 : 1; continue; }
    if (tag === "em" || tag === "i") { italic += closing ? -1 : 1; continue; }
    if (tag === "u") { underline += closing ? -1 : 1; continue; }
    if (tag === "a") {
      if (closing) { href = undefined; }
      else {
        const hm = /href\s*=\s*"([^"]*)"|href\s*=\s*'([^']*)'/i.exec(attrs);
        href = hm ? safeHref(hm[1] ?? hm[2] ?? "") : undefined;
      }
      continue;
    }
    // それ以外の許可外タグは無視（テキストは別マッチで拾う）
  }
  const cleaned = lines.filter((l) => l.length > 0);
  return cleaned.length ? cleaned : [[]];
}

function parseCells(rowHtml: string): TableCell[] {
  const cells: TableCell[] = [];
  const re = /<(t[hd])\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rowHtml))) {
    const tag = m[1].toLowerCase();
    const attrs = m[2] || "";
    const span = (name: string): number => {
      const sm = new RegExp(name + '\\s*=\\s*"?(\\d+)"?', "i").exec(attrs);
      const v = sm ? parseInt(sm[1], 10) : 1;
      return Number.isFinite(v) && v > 0 ? v : 1;
    };
    cells.push({
      header: tag === "th",
      colspan: span("colspan"),
      rowspan: span("rowspan"),
      lines: parseInline(m[3]),
    });
  }
  return cells;
}

/** テーブルHTML文字列を正規化モデルへ。table 要素や行が無ければ null。 */
export function parseTableHtml(html: string): TableModel | null {
  if (!html || !/<table[\s>]/i.test(html)) return null;
  const rows: TableRow[] = [];
  const re = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const cells = parseCells(m[1]);
    if (cells.length) rows.push({ cells });
  }
  return rows.length ? { rows } : null;
}
