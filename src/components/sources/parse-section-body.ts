/** セクション本文を順序付きセグメントへ分割する。
 *  本文は素のテキスト・HTML 表・markdown 画像の混在を取りうる。
 *  画像の src は tools.ts で絶対 API パスへ解決済み。 */
export type BodySegment =
  | { kind: "text"; text: string }
  | { kind: "table"; html: string }
  | { kind: "image"; src: string; alt: string };

// <table>…</table> ブロック、または markdown 画像 ![alt](src) のいずれかにマッチ。
const SEG_RE = /<table[\s\S]*?<\/table>|!\[([^\]]*)\]\(([^)\s]+)\)/gi;

export function parseSectionBody(body: string): BodySegment[] {
  const segs: BodySegment[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  const pushText = (raw: string) => {
    const text = raw.trim();
    if (text) segs.push({ kind: "text", text });
  };
  SEG_RE.lastIndex = 0;
  while ((m = SEG_RE.exec(body)) !== null) {
    pushText(body.slice(last, m.index));
    if (m[0][0] === "<") {
      segs.push({ kind: "table", html: m[0] });
    } else {
      segs.push({ kind: "image", alt: m[1] ?? "", src: m[2] ?? "" });
    }
    last = m.index + m[0].length;
  }
  pushText(body.slice(last));
  return segs;
}
