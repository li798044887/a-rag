"use client";

import { useEffect, useState } from "react";
import { BrandMark } from "@/components/icons";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/context";

interface Props {
  open: boolean;
  onClose: () => void;
}

type Tab = "overview" | "workflow" | "features" | "shortcuts" | "tips";

export function HelpModal({ open, onClose }: Props) {
  const { t } = useT();
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

  const TABS: { id: Tab; label: string; icon: NavIconName }[] = [
    { id: "overview", label: t.modals.helpTabOverview, icon: "sparkles" },
    { id: "workflow", label: t.modals.helpTabWorkflow, icon: "route" },
    { id: "features", label: t.modals.helpTabFeatures, icon: "layers" },
    { id: "shortcuts", label: t.modals.helpTabShortcuts, icon: "keyboard" },
    { id: "tips", label: t.modals.helpTabTips, icon: "lightbulb" },
  ];

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[90] grid animate-overlay-in place-items-center bg-[rgba(20,18,15,0.48)] p-6 motion-reduce:animate-none max-md:p-0"
      role="dialog"
      aria-modal="true"
      aria-label={t.modals.helpAriaLabel}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="grid h-[min(680px,92vh)] w-[min(960px,100%)] animate-pop-in grid-cols-[220px_1fr] overflow-hidden rounded-[16px] border-[0.5px] border-divider-strong bg-surface shadow-[0_30px_80px_rgba(0,0,0,0.32)] motion-reduce:animate-none max-md:h-full max-md:max-h-screen max-md:w-full max-md:grid-cols-1 max-md:grid-rows-[auto_1fr] max-md:rounded-none max-md:border-0">
        {/* Sidebar */}
        <aside className="flex flex-col border-r-[0.5px] border-divider bg-surface-2 p-[18px_12px_14px] max-md:flex-row max-md:items-center max-md:gap-2 max-md:overflow-x-auto max-md:border-b-[0.5px] max-md:border-r-0 max-md:p-2.5">
          <div className="mb-2.5 flex items-center gap-2.5 border-b-[0.5px] border-divider px-2 pb-3.5 pt-0.5 max-md:m-0 max-md:shrink-0 max-md:border-b-0 max-md:border-r-[0.5px] max-md:border-divider max-md:px-1 max-md:pr-2.5 max-md:pb-0">
            <div className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-accent text-white">
              <BrandMark size={15} />
            </div>
            <div className="max-md:hidden">
              <div className="text-[14px] font-bold tracking-[-0.01em]">ARag</div>
              <div className="mt-px font-mono text-[10.5px] text-muted">{t.modals.helpVersion}</div>
            </div>
          </div>
          <nav className="flex flex-1 flex-col gap-0.5 max-md:flex-row max-md:gap-1">
            {TABS.map((tb) => (
              <button
                key={tb.id}
                onClick={() => setTab(tb.id)}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg border-0 bg-transparent px-2.5 py-2 text-left text-[13px] font-medium transition-colors max-md:shrink-0 max-md:px-2.5 max-md:text-[12.5px]",
                  tab === tb.id ? "bg-surface font-semibold text-fg shadow-e1 [&_svg]:text-accent" : "text-fg-2 hover:bg-divider hover:text-fg",
                )}
              >
                <NavIcon name={tb.icon} />
                <span>{tb.label}</span>
              </button>
            ))}
          </nav>
          <div className="flex flex-col gap-0.5 border-t-[0.5px] border-divider pt-2.5 max-md:hidden">
            {[t.modals.helpDocs, t.modals.helpContactSupport].map((l) => (
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
            <h2 className="m-0 text-[18px] font-bold tracking-[-0.015em]">{TABS.find((tb) => tb.id === tab)?.label}</h2>
            <button className="grid h-[30px] w-[30px] place-items-center rounded-lg border-0 bg-transparent text-muted hover:bg-divider hover:text-fg" onClick={onClose} aria-label={t.common.close}>
              <svg viewBox="0 0 16 16" width="14" height="14">
                <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>
          </header>
          <div className="overflow-y-auto px-7 pb-7 pt-[22px]">
            {tab === "overview" && <Overview onJump={setTab} t={t.modals} />}
            {tab === "workflow" && <Workflow t={t.modals} />}
            {tab === "features" && <Features t={t.modals} />}
            {tab === "shortcuts" && <Shortcuts t={t.modals} />}
            {tab === "tips" && <Tips t={t.modals} />}
          </div>
        </section>
      </div>
    </div>
  );
}

const lead = "m-0 text-[13.5px] leading-[1.65] text-fg-2 [&_strong]:font-semibold [&_strong]:text-fg";

// Helper to safely render strings containing <strong> tags.
function RichText({ text, className }: { text: string; className?: string }) {
  return <span className={className} dangerouslySetInnerHTML={{ __html: text }} />;
}

type ModalsT = ReturnType<typeof useT>["t"]["modals"];

function Overview({ onJump, t }: { onJump: (tab: Tab) => void; t: ModalsT }) {
  const cards: { n: string; t: Tab; title: string; desc: string }[] = [
    { n: "01", t: "workflow", title: t.overviewCard01Title, desc: t.overviewCard01Desc },
    { n: "02", t: "features", title: t.overviewCard02Title, desc: t.overviewCard02Desc },
    { n: "03", t: "shortcuts", title: t.overviewCard03Title, desc: t.overviewCard03Desc },
    { n: "04", t: "tips", title: t.overviewCard04Title, desc: t.overviewCard04Desc },
  ];
  return (
    <div className="flex flex-col gap-[22px]">
      <div className="flex flex-col gap-3.5 rounded-[14px] border-[0.5px] border-divider-strong bg-gradient-to-b from-surface-2 to-surface p-[22px_24px_24px]">
        <div className="self-start rounded-full border-[0.5px] border-accent/55 bg-accent/[0.08] px-[9px] py-[3px] font-mono text-[10px] font-bold tracking-[0.12em] text-accent">
          {t.overviewHeroTag}
        </div>
        <h3 className="m-0 text-[22px] font-bold leading-[1.25] tracking-[-0.02em]">{t.overviewHeroTitle}</h3>
        <p className="m-0 max-w-[56ch] text-[13.5px] leading-[1.7] text-fg-2">
          <RichText text={t.overviewHeroBody} />
        </p>
        <div className="mt-1.5 grid grid-cols-3 gap-px overflow-hidden rounded-[10px] border-[0.5px] border-divider bg-divider">
          {[
            { n: "26,194", l: t.overviewStatDocs },
            { n: "8", l: t.overviewStatSources },
            { n: "~2.6s", l: t.overviewStatSpeed },
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

function Workflow({ t }: { t: ModalsT }) {
  const steps = [
    { n: "01", title: t.workflowStep01Title, body: t.workflowStep01Body, hint: t.workflowStep01Hint },
    { n: "02", title: t.workflowStep02Title, body: t.workflowStep02Body, hint: t.workflowStep02Hint },
    { n: "03", title: t.workflowStep03Title, body: t.workflowStep03Body, hint: t.workflowStep03Hint },
  ];
  return (
    <div className="flex flex-col gap-[22px]">
      <p className={lead}>
        <RichText text={t.workflowLead} />
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

function Features({ t }: { t: ModalsT }) {
  const features: { icon: FeatIconName; title: string; body: string }[] = [
    { icon: "scope", title: t.featScopeTitle, body: t.featScopeBody },
    { icon: "paperclip", title: t.featAttachTitle, body: t.featAttachBody },
    { icon: "steps", title: t.featStepsTitle, body: t.featStepsBody },
    { icon: "cite", title: t.featCiteTitle, body: t.featCiteBody },
    { icon: "thread", title: t.featThreadTitle, body: t.featThreadBody },
    { icon: "share", title: t.featShareTitle, body: t.featShareBody },
  ];
  return (
    <div className="flex flex-col gap-[22px]">
      <p className={lead}>
        <RichText text={t.featuresLead} />
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

function Shortcuts({ t }: { t: ModalsT }) {
  const groups = [
    { label: t.shortcutsGroupBasic, items: [
      { keys: ["⌘", "N"], desc: t.shortcutsNewThread },
      { keys: ["⌘", "K"], desc: t.shortcutsOpenSettings },
      { keys: ["⌘", "B"], desc: t.shortcutsToggleSidebar },
      { keys: ["⌘", "/"], desc: t.shortcutsOpenSidebar },
      { keys: ["Esc"], desc: t.shortcutsCloseModal },
    ] },
    { label: t.shortcutsGroupRunning, items: [
      { keys: ["⌘", "⌫"], desc: t.shortcutsStopAgent },
      { keys: ["Enter"], desc: t.shortcutsSend },
      { keys: ["⇧", "Enter"], desc: t.shortcutsNewline },
    ] },
    { label: t.shortcutsGroupAnswer, items: [
      { keys: ["C"], desc: t.shortcutsCopyAnswer },
      { keys: ["R"], desc: t.shortcutsRegenerate },
      { keys: ["1", "〜", "9"], desc: t.shortcutsJumpCitation },
    ] },
  ];
  return (
    <div className="flex flex-col gap-[22px]">
      <p className={lead}>
        <RichText text={t.shortcutsLead} />
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

function Tips({ t }: { t: ModalsT }) {
  const tips = [
    { kind: "do" as const, title: t.tipDo01Title, body: t.tipDo01Body },
    { kind: "do" as const, title: t.tipDo02Title, body: t.tipDo02Body },
    { kind: "do" as const, title: t.tipDo03Title, body: t.tipDo03Body },
    { kind: "dont" as const, title: t.tipDont01Title, body: t.tipDont01Body },
    { kind: "dont" as const, title: t.tipDont02Title, body: t.tipDont02Body },
    { kind: "dont" as const, title: t.tipDont03Title, body: t.tipDont03Body },
  ];
  return (
    <div className="flex flex-col gap-[22px]">
      <p className={lead}>{t.tipsLead}</p>
      <div className="grid grid-cols-2 gap-2.5 max-md:grid-cols-1">
        {tips.map((tip, i) => (
          <div key={i} className="grid grid-cols-[28px_1fr] gap-3 rounded-xl border-[0.5px] border-divider-strong bg-surface p-3.5">
            <div className={cn("grid h-7 w-7 place-items-center rounded-full", tip.kind === "do" ? "bg-accent-soft text-accent" : "bg-[rgba(192,83,58,0.13)] text-[#C0533A]")}>
              {tip.kind === "do" ? (
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
              <div className={cn("font-mono text-[10px] font-bold tracking-[0.1em]", tip.kind === "do" ? "text-accent" : "text-[#C0533A]")}>
                {tip.kind === "do" ? "DO" : "DON'T"}
              </div>
              <div className="mt-0.5 text-[13.5px] font-semibold tracking-[-0.005em]">{tip.title}</div>
              <p className="mt-1.5 text-[12px] leading-[1.6] text-muted">{tip.body}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-1 flex items-center justify-between gap-3.5 rounded-xl border-[0.5px] border-accent/40 bg-accent/[0.05] px-[18px] py-3.5 max-md:flex-col max-md:items-start">
        <div>
          <div className="text-[13.5px] font-semibold tracking-[-0.005em]">{t.tipsTryTitle}</div>
          <div className="mt-0.5 text-[11.5px] leading-[1.5] text-muted">{t.tipsTryDesc}</div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Kbd>⌘</Kbd>
          <span className="font-mono text-[11px] text-muted-2">+</span>
          <Kbd>N</Kbd>
          <span className="ml-2 text-[12px] text-muted">{t.tipsTryNewThread}</span>
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
