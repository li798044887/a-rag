/** プレーンテキストを等幅・折返しありで表示する。原本タブと整形表示(kind=text)で共用。 */
export function PlainTextView({ text }: { text: string }) {
  if (!text.trim()) {
    return <div className="p-5 text-[12px] text-muted">表示できる内容がありません</div>;
  }
  return (
    <pre className="m-0 whitespace-pre-wrap break-words p-5 font-mono text-[12.5px] leading-[1.7] text-fg-2">
      {text}
    </pre>
  );
}
