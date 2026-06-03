"use client";

import { useEffect, useState, type ReactNode } from "react";
import { SpreadsheetPreview } from "@/components/documents/spreadsheet-preview";
import { PlainTextView } from "@/components/documents/plain-text-view";
import { useRawText, type RawTextState } from "@/hooks/use-raw-text";
import { getTextPreviewKind, isConvertibleToPdf, isImage, isPdf, isSpreadsheet } from "@/lib/file-types";
import { useT } from "@/i18n/context";
import type { Dictionary } from "@/i18n/dictionary";

/** 原本タブのラベルをファイル種別で決める（modal/panel 共通）。
 *  表計算→スプレッドシート / Office→原本PDF変換 / それ以外→原本。 */
export function originalTabLabel(filename: string, t: Dictionary): string {
  if (isSpreadsheet(filename)) return t.documents.tabSpreadsheet;
  if (isConvertibleToPdf(filename)) return t.documents.tabConvertedPdf;
  return t.documents.tabOriginal;
}

// 純正 PDF ビューアの黒いクロムを隠し、紙系の世界観に馴染ませる。
const PDF_VIEW_PARAMS = "#toolbar=0&navpanes=0&statusbar=0&view=FitH";

/** プレビュー不可フォールバック（原本ダウンロード導線）。
 *  onShowParsed 指定時は「引用テキストを表示」導線も並べる（一次資料パネル用）。 */
export function UnsupportedPreview({ docId, onShowParsed }: { docId: string; onShowParsed?: () => void }) {
  const { t } = useT();
  return (
    <div className="grid h-full place-items-center p-8 text-center">
      <div className="max-w-[380px]">
        <div className="mb-1.5 text-[13px] font-semibold text-fg">{t.documents.unsupportedTitle}</div>
        <div className="mb-4 text-[12px] leading-[1.6] text-muted">{t.documents.unsupportedDescription}</div>
        <div className="flex items-center justify-center gap-2">
          <a
            href={`/api/documents/${encodeURIComponent(docId)}/raw?download=1`}
            className="inline-flex items-center gap-1.5 rounded-lg border-[0.5px] border-divider-strong bg-surface px-3 py-1.5 text-[12px] font-medium text-fg hover:bg-surface-2"
          >{t.documents.unsupportedDownload}</a>
          {onShowParsed && (
            <button
              onClick={onShowParsed}
              className="inline-flex items-center rounded-lg border-[0.5px] border-divider-strong bg-surface px-3 py-1.5 text-[12px] font-medium text-fg hover:bg-surface-2"
            >{t.sources.showCitedText}</button>
          )}
        </div>
      </div>
    </div>
  );
}

/** 原本欠落（削除済み = /raw 404）専用フォールバック。
 *  ダウンロード導線は出さない（404 になるため）。onShowParsed 指定時のみ引用テキスト導線を出す。 */
export function MissingOriginalPreview({ onShowParsed }: { onShowParsed?: () => void }) {
  const { t } = useT();
  return (
    <div className="grid h-full place-items-center p-8 text-center">
      <div className="max-w-[380px]">
        <div className="mb-1.5 text-[13px] font-semibold text-fg">{t.documents.missingTitle}</div>
        <div className="mb-4 text-[12px] leading-[1.6] text-muted">{t.documents.missingDescription}</div>
        {onShowParsed && (
          <button
            onClick={onShowParsed}
            className="inline-flex items-center rounded-lg border-[0.5px] border-divider-strong bg-surface px-3 py-1.5 text-[12px] font-medium text-fg hover:bg-surface-2"
          >{t.sources.showCitedText}</button>
        )}
      </div>
    </div>
  );
}

/** Office 原本をサーバ側で PDF 変換し iframe 表示する。初回は数秒の変換待ち、
 *  失敗時はダウンロード導線へ退避する。blob 経由にして HTTP エラーを iframe に晒さない。
 *  404 は原本欠落として MissingOriginalPreview へ、それ以外のエラーは UnsupportedPreview へ。 */
export function RenderedPdfPreview({ docId, filename }: { docId: string; filename: string }) {
  const [state, setState] = useState<"loading" | "ready" | "error" | "missing">("loading");
  const [url, setUrl] = useState<string | null>(null);

  // docId ごとに key で再マウントされる前提（初期状態 = loading）。
  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    (async () => {
      try {
        const res = await fetch(`/api/documents/${encodeURIComponent(docId)}/rendered`);
        if (res.status === 404) {
          if (!cancelled) setState("missing");
          return;
        }
        if (!res.ok) throw new Error(String(res.status));
        const blob = await res.blob();
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
        setState("ready");
      } catch {
        if (!cancelled) setState("error");
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [docId]);

  const { t } = useT();
  if (state === "missing") return <MissingOriginalPreview />;
  if (state === "error") return <UnsupportedPreview docId={docId} />;
  if (state === "loading" || !url) {
    return <div className="grid h-full place-items-center text-[12px] text-muted">{t.documents.pdfConverting}</div>;
  }
  return <iframe title={filename} src={url + PDF_VIEW_PARAMS} className="h-full w-full border-0" />;
}

/** 原本テキストの読み込み状態をラップする。ready のとき children（整形ビュー）を表示し、
 *  children 無し（原本タブ）のときは生テキストを PlainTextView で表示する。
 *  loading/error と truncate 注記もここで一元的に出す。 */
export function RawTextContent({
  raw,
  docId,
  children,
  onShowParsed,
}: { raw: RawTextState; docId: string; children?: ReactNode; onShowParsed?: () => void }) {
  const { t } = useT();
  if (raw.status === "loading" || raw.status === "idle") {
    return <div className="grid h-full place-items-center text-[12px] text-muted">{t.common.loading}</div>;
  }
  if (raw.status === "missing") return <MissingOriginalPreview onShowParsed={onShowParsed} />;
  if (raw.status === "error") return <UnsupportedPreview docId={docId} onShowParsed={onShowParsed} />;
  return (
    <div>
      {raw.truncated && (
        <div className="border-b-[0.5px] border-divider bg-accent-soft px-5 py-2 text-[11.5px] text-fg-2">
          {t.documents.rawTruncated}
        </div>
      )}
      {children ?? <PlainTextView text={raw.text} />}
    </div>
  );
}

/** raw 原本（PDF/画像）を表示しつつ、HEAD で存在を確認する。404（削除済み）が判明したら
 *  フォールバック（ダウンロード/引用テキスト）へ差し替える。存在判明までは楽観表示し、
 *  正常な原本のストリーミング表示を妨げない。 */
function RawObjectPreview({ docId, onShowParsed, children }: { docId: string; onShowParsed?: () => void; children: ReactNode }) {
  // docId が変わった時点で欠落判定を破棄するため、判定対象の docId を併記する。
  // （effect 内での同期 setState を避け、レンダー中に派生値として再計算する。）
  const [missingFor, setMissingFor] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/documents/${encodeURIComponent(docId)}/raw`, { method: "HEAD" })
      // 成功時は null へ戻して自己回復させる（一過性404や同一IDの再アップロードに追従）。
      .then((r) => { if (!cancelled) setMissingFor(r.ok ? null : docId); })
      .catch(() => { if (!cancelled) setMissingFor(docId); });
    return () => { cancelled = true; };
  }, [docId]);
  if (missingFor === docId) return <MissingOriginalPreview onShowParsed={onShowParsed} />;
  return <>{children}</>;
}

interface OriginalPreviewProps {
  docId: string;
  filename: string;
  /** PDF のときだけ #page=N へジャンプ。1-based。省略時はジャンプしない。 */
  pdfPage?: number;
  /** true で modal 風の角丸カード枠、false（既定）でフラッシュ表示（panel 用）。 */
  framed?: boolean;
  /** 指定時、非対応/原本欠落フォールバックに「引用テキストを表示」導線を出す。 */
  onShowParsed?: () => void;
}

/** 文書の原本を形式に応じて描画する共有ディスパッチ。modal/panel 共通。
 *  優先順位: PDF → 画像 → 表計算 → Office変換 → テキスト → 非対応フォールバック。 */
export function OriginalPreview({ docId, filename, pdfPage, framed, onShowParsed }: OriginalPreviewProps) {
  const textKind = getTextPreviewKind(filename);
  const raw = useRawText(textKind ? docId : null);

  const card = (node: ReactNode) =>
    framed ? (
      <div className="h-full p-3">
        <div className="h-full overflow-hidden rounded-[10px] border-[0.5px] border-divider-strong bg-surface shadow-e1">{node}</div>
      </div>
    ) : (
      <div className="h-full">{node}</div>
    );

  if (isPdf(filename)) {
    const base = `/api/documents/${encodeURIComponent(docId)}/raw`;
    const src = pdfPage ? `${base}#page=${pdfPage}&toolbar=0&navpanes=0&statusbar=0&view=FitH` : `${base}${PDF_VIEW_PARAMS}`;
    return (
      <RawObjectPreview docId={docId} onShowParsed={onShowParsed}>
        {card(<iframe key={pdfPage ?? 0} title={filename} src={src} className="h-full w-full border-0" />)}
      </RawObjectPreview>
    );
  }
  if (isImage(filename)) {
    return (
      <RawObjectPreview docId={docId} onShowParsed={onShowParsed}>
        <div className="grid h-full place-items-center p-5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/documents/${encodeURIComponent(docId)}/raw`} alt={filename} className="max-h-full max-w-full rounded-lg border-[0.5px] border-divider" />
        </div>
      </RawObjectPreview>
    );
  }
  if (isSpreadsheet(filename)) {
    return card(<SpreadsheetPreview key={docId} docId={docId} filename={filename} />);
  }
  if (isConvertibleToPdf(filename)) {
    return card(<RenderedPdfPreview key={docId} docId={docId} filename={filename} />);
  }
  if (textKind) {
    return <RawTextContent raw={raw} docId={docId} onShowParsed={onShowParsed} />;
  }
  return <UnsupportedPreview docId={docId} onShowParsed={onShowParsed} />;
}
