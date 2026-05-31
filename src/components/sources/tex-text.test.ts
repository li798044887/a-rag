import { describe, expect, it } from "vitest";
import { renderTexToHtml } from "@/components/sources/tex-text";

describe("renderTexToHtml", () => {
  it("LaTeX 単体をディスプレイ数式として HTML 化できる", () => {
    const html = renderTexToHtml("\\frac{a}{b}=c", true);
    expect(html).toContain("katex-display");
    expect(html).toContain("mfrac");
  });

  it("壊れた式でも KaTeX のエラー表示 HTML を返す", () => {
    const html = renderTexToHtml("\\notacommand{", true);
    expect(html).toContain("katex");
  });
});
