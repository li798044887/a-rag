import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { renderTexToHtml, TeXBlock } from "@/components/sources/tex-text";

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

describe("TeXBlock", () => {
  it("$$…$$ で囲まれた equation ブロックを区切り文字を剥がして描画する", () => {
    const html = renderToStaticMarkup(
      <TeXBlock text="$$ \phi = \phi_{\mathrm{h}} - \phi_{0}\tag{……(H.1)} $$" />,
    );
    expect(html).toContain("katex-display");
    expect(html).not.toContain("katex-error");
  });

  it("囲みなしの LaTeX もそのまま描画する", () => {
    const html = renderToStaticMarkup(<TeXBlock text="\frac{a}{b}=c" />);
    expect(html).toContain("katex-display");
    expect(html).not.toContain("katex-error");
  });
});
