import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { SectionImage } from "@/components/sources/rendered-section-body";

// 見出し/段落/リスト/コード/表/区切り/画像をデザイントークンに合わせて装飾。
// 子孫セレクタで一括指定し、react-markdown の components は再利用が要る a/img のみ上書きする。
const MD_PROSE = [
  "text-[13px] leading-[1.7] text-fg-2 [overflow-wrap:anywhere]",
  "[&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:text-[19px] [&_h1]:font-bold [&_h1]:text-fg",
  "[&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-[16px] [&_h2]:font-bold [&_h2]:text-fg",
  "[&_h3]:mt-3 [&_h3]:mb-1.5 [&_h3]:text-[14px] [&_h3]:font-semibold [&_h3]:text-fg",
  "[&_h4]:mt-3 [&_h4]:mb-1 [&_h4]:text-[13px] [&_h4]:font-semibold [&_h4]:text-fg",
  "[&_p]:my-2",
  "[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5",
  "[&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5",
  "[&_li]:my-0.5",
  "[&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-divider-strong [&_blockquote]:pl-3 [&_blockquote]:text-muted",
  "[&_code]:rounded [&_code]:bg-surface-2 [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[12px]",
  "[&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-[8px] [&_pre]:border-[0.5px] [&_pre]:border-divider [&_pre]:bg-surface-2 [&_pre]:p-3",
  "[&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-[12px]",
  "[&_table]:my-3 [&_table]:w-full [&_table]:border-collapse [&_table]:text-[12px]",
  "[&_th]:border-[0.5px] [&_th]:border-divider [&_th]:bg-surface-2 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:font-semibold",
  "[&_td]:border-[0.5px] [&_td]:border-divider [&_td]:px-2 [&_td]:py-1",
  "[&_hr]:my-4 [&_hr]:border-divider",
  "[&_a]:text-accent [&_a]:underline",
].join(" ");

/** Markdown 原文を整形描画する。GFM(表・取消線・タスクリスト)と数式($…$/$$…$$)に対応。
 *  セキュリティ上、生 HTML は描画しない（rehype-raw 不使用）。 */
export function MarkdownView({ text }: { text: string }) {
  if (!text.trim()) {
    return <div className="p-5 text-[12px] text-muted">表示できる内容がありません</div>;
  }
  return (
    <div className={`mx-auto max-w-[820px] p-5 ${MD_PROSE}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
          ),
          img: ({ src, alt }) => <SectionImage src={typeof src === "string" ? src : ""} alt={alt ?? ""} />,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
