"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onClose: () => void;
}

type Tab = "overview" | "workflow" | "features" | "shortcuts" | "tips";

const TABS: { id: Tab; label: string; icon: NavIconName }[] = [
  { id: "overview", label: "概要", icon: "sparkles" },
  { id: "workflow", label: "基本の流れ", icon: "route" },
  { id: "features", label: "主要機能", icon: "layers" },
  { id: "shortcuts", label: "ショートカット", icon: "keyboard" },
  { id: "tips", label: "うまく使うコツ", icon: "lightbulb" },
];

export function HelpModal({ open, onClose }: Props) {
  const [tab, setTab] = useState<Tab>("overview");
  // Reset to the overview tab whenever the modal transitions to open — done in
  // render via the "previous value" pattern rather than an effect.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setTab("overview");
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[90] grid animate-[ar-scale-in_0.15s_ease-out] place-items-center bg-[rgba(20,18,15,0.48)] p-6 max-md:p-0"
      role="dialog"
      aria-modal="true"
      aria-label="ARag ヘルプ"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="grid h-[min(680px,92vh)] w-[min(960px,100%)] grid-cols-[220px_1fr] overflow-hidden rounded-[16px] border-[0.5px] border-divider-strong bg-surface shadow-[0_30px_80px_rgba(0,0,0,0.32)] max-md:h-full max-md:max-h-screen max-md:w-full max-md:grid-cols-1 max-md:grid-rows-[auto_1fr] max-md:rounded-none max-md:border-0">
        {/* Sidebar */}
        <aside className="flex flex-col border-r-[0.5px] border-divider bg-surface-2 p-[18px_12px_14px] max-md:flex-row max-md:items-center max-md:gap-2 max-md:overflow-x-auto max-md:border-b-[0.5px] max-md:border-r-0 max-md:p-2.5">
          <div className="mb-2.5 flex items-center gap-2.5 border-b-[0.5px] border-divider px-2 pb-3.5 pt-0.5 max-md:m-0 max-md:shrink-0 max-md:border-b-0 max-md:border-r-[0.5px] max-md:border-divider max-md:px-1 max-md:pr-2.5 max-md:pb-0">
            <div className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-accent text-white">
              <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden>
                <path d="M4 6c0-1.1.9-2 2-2h8l6 6v8c0 1.1-.9 2-2 2H6c-1.1 0-2-.9-2-2V6z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                <circle cx="12" cy="13" r="3" fill="none" stroke="currentColor" strokeWidth="1.8" />
              </svg>
            </div>
            <div className="max-md:hidden">
              <div className="text-[14px] font-bold tracking-[-0.01em]">ARag</div>
              <div className="mt-px font-mono text-[10.5px] text-muted">v2.4 · ヘルプ</div>
            </div>
          </div>
          <nav className="flex flex-1 flex-col gap-0.5 max-md:flex-row max-md:gap-1">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg border-0 bg-transparent px-2.5 py-2 text-left text-[13px] font-medium transition-colors max-md:shrink-0 max-md:px-2.5 max-md:text-[12.5px]",
                  tab === t.id ? "bg-surface font-semibold text-fg shadow-e1 [&_svg]:text-accent" : "text-fg-2 hover:bg-divider hover:text-fg",
                )}
              >
                <NavIcon name={t.icon} />
                <span>{t.label}</span>
              </button>
            ))}
          </nav>
          <div className="flex flex-col gap-0.5 border-t-[0.5px] border-divider pt-2.5 max-md:hidden">
            {["ドキュメント", "サポートに連絡"].map((l) => (
              <a key={l} href="#" onClick={(e) => e.preventDefault()} className="flex items-center justify-between rounded-[7px] px-2.5 py-[7px] text-[12px] text-muted no-underline transition-colors hover:bg-divider hover:text-fg-2">
                <span>{l}</span>
                <svg viewBox="0 0 16 16" width="11" height="11">
                  <path d="M6 3h7v7M13 3 6 10M3 6v7h7" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" />
                </svg>
              </a>
            ))}
          </div>
        </aside>

        {/* Main */}
        <section className="grid min-h-0 grid-rows-[auto_1fr]">
          <header className="flex items-center justify-between border-b-[0.5px] border-divider px-7 pb-3.5 pt-[18px]">
            <h2 className="m-0 text-[18px] font-bold tracking-[-0.015em]">{TABS.find((t) => t.id === tab)?.label}</h2>
            <button className="grid h-[30px] w-[30px] place-items-center rounded-lg border-0 bg-transparent text-muted hover:bg-divider hover:text-fg" onClick={onClose} aria-label="閉じる">
              <svg viewBox="0 0 16 16" width="14" height="14">
                <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>
          </header>
          <div className="overflow-y-auto px-7 pb-7 pt-[22px]">
            {tab === "overview" && <Overview onJump={setTab} />}
            {tab === "workflow" && <Workflow />}
            {tab === "features" && <Features />}
            {tab === "shortcuts" && <Shortcuts />}
            {tab === "tips" && <Tips />}
          </div>
        </section>
      </div>
    </div>
  );
}

const lead = "m-0 text-[13.5px] leading-[1.65] text-fg-2 [&_strong]:font-semibold [&_strong]:text-fg";

function Overview({ onJump }: { onJump: (t: Tab) => void }) {
  const cards: { n: string; t: Tab; title: string; desc: string }[] = [
    { n: "01", t: "workflow", title: "基本の流れ", desc: "質問 → エージェント実行 → 引用付き回答までの3ステップ。" },
    { n: "02", t: "features", title: "主要機能", desc: "スコープ・添付・ツール可視化・引用パネル・共有の使い方。" },
    { n: "03", t: "shortcuts", title: "ショートカット", desc: "⌘N / ⌘K / ⌘B など、手を止めずに操作するためのキー。" },
    { n: "04", t: "tips", title: "うまく使うコツ", desc: "質問の書き方・精度を上げる小ワザ・避けたい使い方。" },
  ];
  return (
    <div className="flex flex-col gap-[22px]">
      <div className="flex flex-col gap-3.5 rounded-[14px] border-[0.5px] border-divider-strong bg-gradient-to-b from-surface-2 to-surface p-[22px_24px_24px]">
        <div className="self-start rounded-full border-[0.5px] border-accent/55 bg-accent/[0.08] px-[9px] py-[3px] font-mono text-[10px] font-bold tracking-[0.12em] text-accent">
          AGENTIC RAG
        </div>
        <h3 className="m-0 text-[22px] font-bold leading-[1.25] tracking-[-0.02em]">社内ナレッジに、エージェントの目で。</h3>
        <p className="m-0 max-w-[56ch] text-[13.5px] leading-[1.7] text-fg-2">
          ARag は議事録・Wiki・Slack・DB を横断して質問に答える <strong className="font-semibold text-fg">エージェント型 RAG アシスタント</strong> です。
          単純な検索ではなく、複数ステップで情報源を辿り、引用付きで根拠を示します。
        </p>
        <div className="mt-1.5 grid grid-cols-3 gap-px overflow-hidden rounded-[10px] border-[0.5px] border-divider bg-divider">
          {[
            { n: "26,194", l: "索引中のドキュメント" },
            { n: "8", l: "接続データソース" },
            { n: "~2.6s", l: "平均回答時間" },
          ].map((s) => (
            <div key={s.l} className="bg-surface px-3.5 py-3">
              <div className="font-mono text-[19px] font-bold tracking-[-0.02em] text-accent">{s.n}</div>
              <div className="mt-0.5 text-[11px] text-muted">{s.l}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2.5 max-md:grid-cols-1">
        {cards.map((c) => (
          <button
            key={c.n}
            onClick={() => onJump(c.t)}
            className="group/jc flex items-center gap-3.5 rounded-xl border-[0.5px] border-divider-strong bg-surface px-4 py-3.5 text-left transition-[border-color,background,transform] hover:-translate-y-px hover:border-accent hover:bg-accent-soft"
          >
            <div className="font-mono text-[11px] font-semibold tracking-[0.04em] text-muted">{c.n}</div>
            <div className="min-w-0 flex-1">
              <div className="text-[13.5px] font-semibold tracking-[-0.005em]">{c.title}</div>
              <div className="mt-[3px] text-[11.5px] leading-[1.5] text-muted">{c.desc}</div>
            </div>
            <span className="inline-flex text-accent opacity-60 transition-[transform,opacity] group-hover/jc:translate-x-[3px] group-hover/jc:opacity-100">
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none">
                <path d="M5 3l5 5-5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function Workflow() {
  const steps = [
    { n: "01", title: "質問を入力する", body: "画面下のコンポーザーに自然文で質問を入力します。「いつ」「誰が」「なぜ」など5W1Hを含めると精度が上がります。", hint: "左のスコープピッカーで対象範囲（全社・プロジェクト・特定チーム）を絞り込めます。" },
    { n: "02", title: "エージェントが情報源を辿る", body: "クエリ分解 → ベクトル検索 → 一次資料の取得 → 重複排除 → 回答生成、と複数ステップで動作します。途中経過はツール実行カードでリアルタイムに確認できます。", hint: "誤った方向に進んだら ⌘⌫ または停止ボタンで即座にキャンセル可能。" },
    { n: "03", title: "引用付きの回答を受け取る", body: "回答中の番号 [1] [2] が一次資料への引用です。クリックすると右パネルで該当セクションがハイライトされ、根拠を確認できます。", hint: "👍/👎 でフィードバック、コピー・再生成・Markdown エクスポートにも対応。" },
  ];
  return (
    <div className="flex flex-col gap-[22px]">
      <p className={lead}>
        ARag は <strong>3つのフェーズ</strong> で動きます。各フェーズはすべて画面上で可視化され、いつでも介入できます。
      </p>
      <ol className="m-0 ml-3 flex list-none flex-col border-l-[0.5px] border-dashed border-divider-strong p-0">
        {steps.map((s) => (
          <li key={s.n} className="grid grid-cols-[56px_1fr] pb-[22px] last:pb-0">
            <div className="-ml-[19px] grid h-[38px] w-[38px] place-items-center rounded-full border-[1.5px] border-accent bg-surface font-mono text-[11.5px] font-bold tracking-[-0.01em] text-accent">
              {s.n}
            </div>
            <div className="pl-1 pt-1.5">
              <div className="text-[15px] font-semibold tracking-[-0.01em]">{s.title}</div>
              <p className="my-1.5 mb-2.5 text-[13px] leading-[1.65] text-fg-2">{s.body}</p>
              <div className="flex items-start gap-2.5 rounded-[0_8px_8px_0] border-l-2 border-accent bg-surface-2 px-3 py-2.5 text-[12px] leading-[1.6] text-fg-2">
                <span className="shrink-0 pt-px font-mono text-[10px] font-bold tracking-[0.08em] text-accent">TIP</span>
                <span>{s.hint}</span>
              </div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Features() {
  const features: { icon: FeatIconName; title: string; body: string }[] = [
    { icon: "scope", title: "検索範囲のスコープ", body: "コンポーザー左のピッカーから「全社」「プロジェクト単位」「データソース指定」など対象を絞り込めます。広すぎる範囲はノイズの原因に。まずは狭く始めて広げるのがおすすめ。" },
    { icon: "paperclip", title: "ファイル添付", body: "PDF・Word・スプレッドシート・画像をドラッグ＆ドロップで質問に添付できます。「この資料の要点をまとめて」「決定事項を抽出して」など、添付ファイル前提の質問にそのまま対応。" },
    { icon: "steps", title: "ツール実行の可視化", body: "各ステップ（クエリ分解・検索・取得・要約）がカードで表示されます。Tweaks パネルから「カード」「タイムライン」「ターミナル風ログ」の3表示に切り替え可能。" },
    { icon: "cite", title: "引用と一次資料パネル", body: "回答中の [1] [2] をクリックすると右パネルが開き、該当箇所がハイライトされます。一次資料はそのままダウンロード・新規タブで閲覧・共有リンクで配布できます。" },
    { icon: "thread", title: "スレッド管理", body: "過去の質問はサイドバーから即座に再オープン。検索ボックスで履歴を絞り込み、スター・プロジェクト・データソースのコレクションにまとめられます。" },
    { icon: "share", title: "共有とエクスポート", body: "スレッド全体を共有リンク or Markdown でエクスポート。一次資料は単体でも共有できます。社内向けは閲覧権限を引き継ぎ、社外向けはマスク済みコピーを生成。" },
  ];
  return (
    <div className="flex flex-col gap-[22px]">
      <p className={lead}>
        ARag の各機能は <strong>少ない操作で深く掘る</strong> ことを目的に設計されています。
      </p>
      <div className="grid grid-cols-2 gap-2.5 max-md:grid-cols-1">
        {features.map((f) => (
          <div key={f.title} className="grid grid-cols-[36px_1fr] gap-3 rounded-xl border-[0.5px] border-divider-strong bg-surface p-3.5">
            <div className="grid h-9 w-9 place-items-center rounded-[9px] bg-accent/[0.08] text-accent">
              <FeatIcon name={f.icon} />
            </div>
            <div>
              <div className="text-[13.5px] font-semibold tracking-[-0.005em]">{f.title}</div>
              <p className="mt-1 text-[12.5px] leading-[1.6] text-muted">{f.body}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Shortcuts() {
  const groups = [
    { label: "基本操作", items: [
      { keys: ["⌘", "N"], desc: "新規スレッドを開く" },
      { keys: ["⌘", "K"], desc: "設定を開く" },
      { keys: ["⌘", "B"], desc: "サイドバーを開閉" },
      { keys: ["⌘", "/"], desc: "サイドバーを開く" },
      { keys: ["Esc"], desc: "モーダル / パネルを閉じる" },
    ] },
    { label: "実行中", items: [
      { keys: ["⌘", "⌫"], desc: "エージェントの実行を停止" },
      { keys: ["Enter"], desc: "質問を送信" },
      { keys: ["⇧", "Enter"], desc: "コンポーザーで改行" },
    ] },
    { label: "回答", items: [
      { keys: ["C"], desc: "回答をコピー（フォーカス時）" },
      { keys: ["R"], desc: "回答を再生成" },
      { keys: ["1", "〜", "9"], desc: "引用 [N] にジャンプ" },
    ] },
  ];
  return (
    <div className="flex flex-col gap-[22px]">
      <p className={lead}>
        <strong>⌘</strong> は macOS、Windows / Linux では <strong>Ctrl</strong> に読み替えてください。
      </p>
      <div className="flex flex-col gap-4">
        {groups.map((g) => (
          <div key={g.label} className="flex flex-col gap-2">
            <div className="font-mono text-[10.5px] font-bold uppercase tracking-[0.1em] text-accent">{g.label}</div>
            <div className="overflow-hidden rounded-[10px] border-[0.5px] border-divider-strong">
              {g.items.map((it, i) => (
                <div key={i} className="grid grid-cols-[180px_1fr] items-center border-b-[0.5px] border-divider bg-surface px-3.5 py-2.5 text-[13px] last:border-b-0 max-md:grid-cols-[120px_1fr]">
                  <div className="flex items-center gap-1">
                    {it.keys.map((k, j) => (
                      <span key={j} className="flex items-center gap-1">
                        <Kbd>{k}</Kbd>
                        {j < it.keys.length - 1 && <span className="font-mono text-[11px] text-muted-2">+</span>}
                      </span>
                    ))}
                  </div>
                  <div className="text-[12.5px] text-fg-2">{it.desc}</div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Tips() {
  const tips = [
    { kind: "do", title: "具体的な制約を含める", body: "「2024年Q3の」「営業チームの」など期間・主体・対象を明示すると、エージェントが検索範囲を絞れます。" },
    { kind: "do", title: "複数の質問は分割する", body: "「Aの背景と、Bの今後の方針」のような複合質問は精度が下がります。スレッドを分けるか、順番に聞きましょう。" },
    { kind: "do", title: "略語は展開する", body: "社内特有の略語（例: PJK, OKR-Q3）は初出で展開すると、エージェントが正しい索引にヒットしやすくなります。" },
    { kind: "dont", title: "機密情報の社外共有", body: "スレッド共有時は権限が引き継がれます。社外向けには「マスク済みコピー」を選択してください。" },
    { kind: "dont", title: "広すぎるスコープ", body: "常に「全社」で検索するとノイズが増えます。プロジェクト / チーム単位に絞ると速度も精度も向上します。" },
    { kind: "dont", title: "回答の鵜呑み", body: "エージェントは引用元を示しますが、解釈は必ず一次資料で確認してください。👎 フィードバックは改善に反映されます。" },
  ] as const;
  return (
    <div className="flex flex-col gap-[22px]">
      <p className={lead}>質問の書き方ひとつで、エージェントの体感速度と精度は大きく変わります。</p>
      <div className="grid grid-cols-2 gap-2.5 max-md:grid-cols-1">
        {tips.map((t, i) => (
          <div key={i} className="grid grid-cols-[28px_1fr] gap-3 rounded-xl border-[0.5px] border-divider-strong bg-surface p-3.5">
            <div className={cn("grid h-7 w-7 place-items-center rounded-full", t.kind === "do" ? "bg-accent-soft text-accent" : "bg-[rgba(192,83,58,0.13)] text-[#C0533A]")}>
              {t.kind === "do" ? (
                <svg viewBox="0 0 16 16" width="13" height="13">
                  <path d="M3 8.5l3 3 7-7" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : (
                <svg viewBox="0 0 16 16" width="13" height="13">
                  <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              )}
            </div>
            <div>
              <div className={cn("font-mono text-[10px] font-bold tracking-[0.1em]", t.kind === "do" ? "text-accent" : "text-[#C0533A]")}>
                {t.kind === "do" ? "DO" : "DON'T"}
              </div>
              <div className="mt-0.5 text-[13.5px] font-semibold tracking-[-0.005em]">{t.title}</div>
              <p className="mt-1.5 text-[12px] leading-[1.6] text-muted">{t.body}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-1 flex items-center justify-between gap-3.5 rounded-xl border-[0.5px] border-accent/40 bg-accent/[0.05] px-[18px] py-3.5 max-md:flex-col max-md:items-start">
        <div>
          <div className="text-[13.5px] font-semibold tracking-[-0.005em]">まずは試してみる</div>
          <div className="mt-0.5 text-[11.5px] leading-[1.5] text-muted">空のスレッドにあるサジェスト質問から、エージェントの動きを体感できます。</div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Kbd>⌘</Kbd>
          <span className="font-mono text-[11px] text-muted-2">+</span>
          <Kbd>N</Kbd>
          <span className="ml-2 text-[12px] text-muted">で新規スレッド</span>
        </div>
      </div>
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-grid h-[22px] min-w-[22px] place-items-center rounded-[5px] border-[0.5px] border-b-[1.5px] border-divider-strong bg-surface px-1.5 font-mono text-[11px] font-semibold text-fg-2 shadow-[0_1px_0_var(--divider)]">
      {children}
    </kbd>
  );
}

type NavIconName = "sparkles" | "route" | "layers" | "keyboard" | "lightbulb";
function NavIcon({ name }: { name: NavIconName }) {
  const p = { viewBox: "0 0 16 16", width: 14, height: 14, fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, className: "shrink-0 opacity-85" };
  if (name === "sparkles") return <svg {...p}><path d="M8 2v3M8 11v3M2 8h3M11 8h3M4 4l2 2M10 10l2 2M4 12l2-2M10 6l2-2" /></svg>;
  if (name === "route") return <svg {...p}><circle cx="4" cy="4" r="1.5" /><circle cx="12" cy="12" r="1.5" /><path d="M4 5.5v3a3 3 0 003 3h2a3 3 0 013 3" /></svg>;
  if (name === "layers") return <svg {...p}><path d="M8 2 2 5l6 3 6-3-6-3z" /><path d="m2 8 6 3 6-3M2 11l6 3 6-3" /></svg>;
  if (name === "keyboard") return <svg {...p}><rect x="2" y="4.5" width="12" height="7" rx="1.5" /><path d="M4.5 7h.01M7 7h.01M9.5 7h.01M12 7h.01M5 9.5h6" /></svg>;
  return <svg {...p}><path d="M6 13h4M6.5 11h3M5 8.5A3.5 3.5 0 118 5a3.5 3.5 0 013 5.5" /></svg>;
}

type FeatIconName = "scope" | "paperclip" | "steps" | "cite" | "thread" | "share";
function FeatIcon({ name }: { name: FeatIconName }) {
  const p = { viewBox: "0 0 20 20", width: 18, height: 18, fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (name === "scope") return <svg {...p}><circle cx="10" cy="10" r="6" /><circle cx="10" cy="10" r="2.2" /><path d="M10 2v2M10 16v2M2 10h2M16 10h2" /></svg>;
  if (name === "paperclip") return <svg {...p}><path d="M13.5 8.5l-5 5a3 3 0 11-4.2-4.2L11 2.5a2 2 0 012.8 2.8L7.2 12a1 1 0 11-1.4-1.4l5.7-5.6" /></svg>;
  if (name === "steps") return <svg {...p}><path d="M3 5h6M3 10h10M3 15h14" /><circle cx="9" cy="5" r="1.2" fill="currentColor" /><circle cx="13" cy="10" r="1.2" fill="currentColor" /><circle cx="17" cy="15" r="1.2" fill="currentColor" /></svg>;
  if (name === "cite") return <svg {...p}><path d="M3 4h11v8H8l-3 3v-3H3z" /><path d="M6.5 7.5h5M6.5 9.5h3" /></svg>;
  if (name === "thread") return <svg {...p}><path d="M3 5h14M3 10h10M3 15h12" /></svg>;
  return <svg {...p}><circle cx="5" cy="10" r="2" /><circle cx="15" cy="5" r="2" /><circle cx="15" cy="15" r="2" /><path d="M6.7 9.1 13.3 5.9M6.7 10.9l6.6 3.2" /></svg>;
}
