/** チャンク本文中の相対 markdown 画像 `![](images/...)` を、絶対 API パスへ書き換える。
 *  URL の真実をこの一箇所に集約する（ライブ・再読込・DB 永続化のいずれもこの結果を使う）。
 *  images/ 以外のリンクや既に絶対な URL は変更しない。 */
const REL_IMAGE_RE = /!\[([^\]]*)\]\((images\/[^)\s]+)\)/g;

export function resolveImageUrls(text: string, documentId: string): string {
  return text.replace(
    REL_IMAGE_RE,
    (_m, alt: string, rel: string) =>
      `![${alt}](/api/documents/${encodeURIComponent(documentId)}/assets/${rel})`,
  );
}
