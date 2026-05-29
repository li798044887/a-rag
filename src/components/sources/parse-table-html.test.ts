import { describe, expect, it } from "vitest";
import { parseTableHtml } from "@/components/sources/parse-table-html";

describe("parseTableHtml", () => {
  it("table でない入力は null", () => {
    expect(parseTableHtml("ただのテキスト")).toBeNull();
    expect(parseTableHtml("")).toBeNull();
  });

  it("基本的な行とセルを解析する", () => {
    const m = parseTableHtml("<table><tr><th>名前</th><td>汪</td></tr></table>")!;
    expect(m.rows).toHaveLength(1);
    expect(m.rows[0].cells[0].header).toBe(true);
    expect(m.rows[0].cells[0].lines[0][0].text).toBe("名前");
    expect(m.rows[0].cells[1].header).toBe(false);
    expect(m.rows[0].cells[1].lines[0][0].text).toBe("汪");
  });

  it("colspan/rowspan を読む", () => {
    const m = parseTableHtml('<table><tr><th colspan="3" rowspan="5"><p>資格</p></th></tr></table>')!;
    expect(m.rows[0].cells[0].colspan).toBe(3);
    expect(m.rows[0].cells[0].rowspan).toBe(5);
    expect(m.rows[0].cells[0].lines[0][0].text).toBe("資格");
  });

  it("<br> と </p> で行を分ける", () => {
    const m = parseTableHtml("<table><tr><td>A<br>B</td></tr></table>")!;
    const lines = m.rows[0].cells[0].lines;
    expect(lines).toHaveLength(2);
    expect(lines[0][0].text).toBe("A");
    expect(lines[1][0].text).toBe("B");
  });

  it("u/strong/em の装飾フラグを立てる", () => {
    const m = parseTableHtml("<table><tr><td><u>x</u><strong>y</strong></td></tr></table>")!;
    const segs = m.rows[0].cells[0].lines[0];
    expect(segs[0]).toMatchObject({ text: "x", underline: true });
    expect(segs[1]).toMatchObject({ text: "y", bold: true });
  });

  it("安全な href のみ採用し javascript: は捨てる", () => {
    const ok = parseTableHtml('<table><tr><td><a href="https://e.com">L</a></td></tr></table>')!;
    expect(ok.rows[0].cells[0].lines[0][0].href).toBe("https://e.com");
    const bad = parseTableHtml('<table><tr><td><a href="javascript:alert(1)">L</a></td></tr></table>')!;
    expect(bad.rows[0].cells[0].lines[0][0].href).toBeUndefined();
    expect(bad.rows[0].cells[0].lines[0][0].text).toBe("L");
  });

  it("script/style の中身は描画対象に含めない", () => {
    const m = parseTableHtml("<table><tr><td><script>alert(1)</script>safe</td></tr></table>")!;
    const texts = m.rows[0].cells[0].lines.flat().map((s) => s.text).join("");
    expect(texts).toBe("safe");
  });

  it("HTML エンティティをデコードする", () => {
    const m = parseTableHtml("<table><tr><td>a&amp;b&nbsp;c</td></tr></table>")!;
    expect(m.rows[0].cells[0].lines[0][0].text).toBe("a&b c");
  });
});
