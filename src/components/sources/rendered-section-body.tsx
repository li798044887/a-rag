"use client";

import { useState } from "react";
import { HtmlTable } from "@/components/sources/html-table";
import { MermaidDiagram } from "@/components/sources/mermaid-diagram";
import { parseSectionBody } from "@/components/sources/parse-section-body";
import { TeXBlock, TeXText } from "@/components/sources/tex-text";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/context";
import { interpolate } from "@/i18n/interpolate";

const proseCls = "whitespace-pre-wrap text-[12.5px] leading-[1.65] text-fg-2 [overflow-wrap:anywhere]";

export function SectionImage({ src, alt }: { src: string; alt: string }) {
  const { t } = useT();
  const [failed, setFailed] = useState(false);
  if (failed) {
    const msg = alt
      ? interpolate(t.sources.imageLoadFailedWithAlt, { alt })
      : t.sources.imageLoadFailed;
    return (
      <div className="rounded-[8px] border-[0.5px] border-divider bg-surface-2 px-3 py-4 text-center text-[11.5px] text-muted">
        {msg}
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- 認証付き動的アセットのため next/image は使わない
    <img
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => setFailed(true)}
      className="my-1 max-w-full rounded-[8px] border-[0.5px] border-divider"
    />
  );
}

export function PlainSectionBody({ body, className }: { body: string; className?: string }) {
  return <div className={cn(proseCls, className)}>{body}</div>;
}

/** 文書本文を HTML整形ビューとして描画する。
 *  表・画像・TeX をアップロード文書モーダルと一次資料パネルで同じ規則で扱う。 */
export function RenderedSectionBody({ body, blockType, className }: { body: string; blockType?: string; className?: string }) {
  if (blockType === "equation") {
    return <TeXBlock text={body} />;
  }

  const segs = parseSectionBody(body);
  if (segs.length === 0) return <PlainSectionBody body={body} className={className} />;

  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      {segs.map((s, i) => {
        if (s.kind === "table") return <HtmlTable key={i} html={s.html} className="my-1" renderMath />;
        if (s.kind === "image") return <SectionImage key={i} src={s.src} alt={s.alt} />;
        if (s.kind === "mermaid") return <MermaidDiagram key={i} code={s.code} />;
        return (
          <div key={i} className={proseCls}>
            <TeXText text={s.text} />
          </div>
        );
      })}
    </div>
  );
}
