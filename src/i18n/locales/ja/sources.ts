import { sources as zhSources } from "../zh/sources";

export const sources: typeof zhSources = {
  // Panel header
  panelTitle: "一次資料",
  closePanelTitle: "閉じる",

  // Panel empty state
  emptyState: "回答の生成が完了すると、参照された一次資料がここに表示されます。",

  // Panel header buttons
  openInNewTab: "ソースを新しいタブで開く",

  // Context label
  contextLabel: "「{query}」の出典",

  // Meta bar
  metaPath: "パス",
  viewHtml: "HTML整形",
  viewText: "解析テキスト",
  viewPdf: "元PDF",

  // Citation highlight badge
  citedSection: "引用箇所",

  // Footer actions
  download: "ダウンロード",
  share: "共有",
  relevance: "関連度",

  // Table sheet (full-screen modal)
  tableSheetAriaLabel: "表の全画面表示",
  tableSheetTitle: "表",
  tableSheetClose: "閉じる",

  // Image load error (rendered-section-body)
  imageLoadFailed: "画像を読み込めませんでした",
  imageLoadFailedWithAlt: "画像を読み込めませんでした（{alt}）",

  // HtmlTable expand button
  expandTable: "表を全画面で開く",
  expand: "拡大",

  // PanelResizer aria-label
  panelResizerAriaLabel: "一次資料パネルの幅を調整",
};
