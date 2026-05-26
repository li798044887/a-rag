"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Login } from "@/components/auth/login";
import { Composer } from "@/components/chat/composer";
import { EmptyState } from "@/components/chat/empty-state";
import { AnswerFooter, CancelledNotice } from "@/components/chat/answer-footer";
import { AssistantMessage, StreamingAnswer, UserMessage } from "@/components/chat/messages";
import { ToolSteps } from "@/components/chat/tool-steps";
import { ToastViewport } from "@/components/feedback/toast-viewport";
import { HelpModal } from "@/components/modals/help-modal";
import { SettingsModal } from "@/components/modals/settings-modal";
import { ShareModal } from "@/components/modals/share-modal";
import { RightPanel, type RightPanelAction } from "@/components/sources/right-panel";
import { Sidebar } from "@/components/sidebar/sidebar";
import { DropOverlay, UserAttachments } from "@/components/uploads/uploads";
import { MODELS, SCOPE_PRESETS } from "@/lib/data";
import { useAgent } from "@/hooks/use-agent";
import { useAuth } from "@/hooks/use-auth";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useToasts } from "@/hooks/use-toasts";
import { useTweaks } from "@/hooks/use-tweaks";
import { useUploads } from "@/hooks/use-uploads";
import { cn } from "@/lib/utils";
import type { ModelOption, ScopeValue, Source, ThreadSummary } from "@/lib/types";

type Phase = "empty" | "running" | "done" | "cancelled";

export function Workspace() {
  const { tweaks, setTweak } = useTweaks();
  const { user, status, signIn, register, signOut } = useAuth();
  const { toasts, push, dismiss } = useToasts();
  const uploads = useUploads(push);
  const agent = useAgent();

  const isMobile = useMediaQuery("(max-width: 768px)");
  const isWide = useMediaQuery("(min-width: 1181px)");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [autoOpened, setAutoOpened] = useState(false);
  const [rightPanelOpen, setRightPanelOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [model, setModel] = useState<ModelOption>(MODELS[0]);

  const [phase, setPhase] = useState<Phase>("empty");
  const [activeThreadId, setActiveThreadId] = useState("th-current");
  const [userQuery, setUserQuery] = useState("");
  const [composerValue, setComposerValue] = useState("");
  const [expandedSteps, setExpandedSteps] = useState<Record<string, boolean>>({ t4: true, t6: true });
  const [activeSourceId, setActiveSourceId] = useState("src-1");
  const [highlightSectionId, setHighlightSectionId] = useState<string | null>("s1-2");
  const [feedback, setFeedback] = useState<"up" | "down" | null>(null);
  const [userAttachments, setUserAttachments] = useState<typeof uploads.files>([]);
  const [scope, setScope] = useState<ScopeValue>(SCOPE_PRESETS[0]);
  const [shareTarget, setShareTarget] = useState<{ item: Source | null } | null>(null);
  const [threads, setThreads] = useState<ThreadSummary[]>([]);

  const refreshThreads = useCallback(() => {
    fetch("/api/threads")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { threads: ThreadSummary[] } | null) => { if (data) setThreads(data.threads); })
      .catch(() => {});
  }, []);

  // 認証済みになったらスレッド一覧を取得
  useEffect(() => {
    if (status === "authed") refreshThreads();
  }, [status, refreshThreads]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const userScrolled = useRef(false);

  const isLive = activeThreadId === "th-current";
  const rightPanelShown = rightPanelOpen && phase !== "empty";

  // Collapse the sidebar when the viewport crosses into mobile (render-phase
  // "previous value" pattern — avoids a cascading effect).
  const [wasMobile, setWasMobile] = useState(isMobile);
  if (isMobile !== wasMobile) {
    setWasMobile(isMobile);
    if (isMobile) setSidebarCollapsed(true);
  }

  // Auto-open the source panel once enough of the answer has streamed (desktop).
  if (!isMobile && !autoOpened && !rightPanelOpen && agent.streaming && agent.answer.length > 60) {
    setAutoOpened(true);
    setRightPanelOpen(true);
  }

  // ── Auto-scroll while streaming ───────────────────────────────────────
  useEffect(() => {
    if (userScrolled.current) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [agent.answer, agent.steps, phase, activeThreadId]);

  const onChatScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    userScrolled.current = el.scrollHeight - el.scrollTop - el.clientHeight >= 40;
  };

  // ── Run / control ─────────────────────────────────────────────────────
  const startRun = useCallback(
    async (query: string) => {
      const ready = uploads.files.filter((f) => f.status === "ready");
      const finalQuery = query || (ready.length ? "添付ファイルについて要点をまとめて" : "");
      if (!finalQuery) return;
      setActiveThreadId("th-current");
      setUserQuery(finalQuery);
      setUserAttachments(ready);
      setComposerValue("");
      setPhase("running");
      setExpandedSteps({ t4: true, t6: true });
      setActiveSourceId("src-1");
      setHighlightSectionId("s1-2");
      setRightPanelOpen(false);
      setAutoOpened(false);
      setFeedback(null);
      userScrolled.current = false;
      uploads.clear();

      const { status, threadId } = await agent.run(
        finalQuery,
        ready.map((f) => f.name),
        activeThreadId !== "th-current" ? activeThreadId : undefined,
      );
      if (status === "done") {
        setPhase("done");
        // done で確定した threadId をアクティブにし、一覧を再取得。
        // 以降の質問は同一スレッドへ追記される（別スレッドが乱立しない）。
        if (threadId) setActiveThreadId(threadId);
        refreshThreads();
      } else if (status === "cancelled") setPhase("cancelled");
      else {
        push("実行に失敗しました", "error");
        setPhase("cancelled");
      }
    },
    [agent, uploads, push, activeThreadId, refreshThreads],
  );

  const stopRun = () => {
    agent.cancel();
    setPhase("cancelled");
    push("実行を停止しました", "info");
  };

  const regenerate = () => {
    const q = userQuery;
    if (q) {
      startRun(q);
      push("回答を再生成しています", "info");
    }
  };

  const copyAnswer = async () => {
    try {
      const text = agent.answer.replace(/\*\*/g, "").replace(/\[\d+\]/g, "");
      await navigator.clipboard.writeText(text);
      push("回答をコピーしました", "success");
    } catch {
      push("コピーに失敗しました", "error");
    }
  };

  const newChat = () => {
    agent.reset();
    setPhase("empty");
    setUserQuery("");
    setComposerValue("");
    setActiveThreadId("th-current");
    setRightPanelOpen(false);
    setFeedback(null);
    if (isMobile) setSidebarCollapsed(true);
  };

  const openCitation = (n: number) => {
    const c = agent.citationMap[n];
    if (!c) return;
    setActiveSourceId(c.sourceId);
    setHighlightSectionId(c.sectionId);
    setRightPanelOpen(true);
  };

  const selectThread = (id: string) => {
    if (id === activeThreadId) {
      if (isMobile) setSidebarCollapsed(true);
      return;
    }
    setActiveThreadId(id);
    setFeedback(null);
    setRightPanelOpen(false);
    if (isMobile) setSidebarCollapsed(true);
    userScrolled.current = false;
    if (id === "th-current") {
      if (userQuery) setPhase(phase === "cancelled" ? "cancelled" : "done");
      else setPhase("empty");
    } else {
      // APIからスレッド詳細を取得して履歴を復元
      fetch(`/api/threads/${id}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((detail) => {
          if (detail) {
            setUserQuery(detail.completed.query || "");
            setUserAttachments([]);
            agent.loadCompleted(detail);
            setPhase("done");
          } else {
            setActiveThreadId("th-current");
            setPhase("empty");
          }
        })
        .catch(() => {
          setActiveThreadId("th-current");
          setPhase("empty");
        });
    }
  };

  // ── Source actions ────────────────────────────────────────────────────
  const downloadSource = (src: Source) => {
    const filename = src.path.split("/").pop() || `${src.id}.md`;
    const body = `# ${src.title}\n${src.author}\n\n` + src.sections.map((s) => `## ${s.heading}\n\n${s.body}\n`).join("\n");
    triggerDownload(new Blob([body], { type: "text/markdown" }), filename);
    push(`「${filename}」をダウンロードしました`, "success");
  };

  const openSourceTab = (src: Source) => {
    const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>${src.title} · ARag</title>
<style>body{font:15px/1.7 -apple-system,system-ui,sans-serif;max-width:760px;margin:48px auto;padding:0 24px;color:#1f1b16;background:#faf8f3}header{padding-bottom:18px;border-bottom:0.5px solid #1f1b1622;margin-bottom:24px}h1{font-size:24px;letter-spacing:-0.01em;margin:0 0 8px}.meta{color:#7a736b;font-size:13px;font-family:ui-monospace,monospace}h2{font-size:15px;margin:24px 0 8px}pre{white-space:pre-wrap;font:inherit;margin:0;color:#2e2a23}.badge{display:inline-block;font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#3FA77E;background:#3FA77E22;padding:2px 8px;border-radius:999px;margin-bottom:14px;font-family:ui-monospace,monospace}</style></head><body>
<div class="badge">ARag · Primary Source</div><header><h1>${src.title}</h1><div class="meta">${src.author} · ${src.path}</div></header>
${src.sections.map((s) => `<h2>${s.heading}</h2><pre>${s.body.replace(/</g, "&lt;")}</pre>`).join("")}
</body></html>`;
    const win = window.open("", "_blank");
    if (win) {
      win.document.write(html);
      win.document.close();
    } else push("ポップアップがブロックされています", "error");
  };

  const handleRPAction = (kind: RightPanelAction, src: Source) => {
    if (kind === "open-source") openSourceTab(src);
    else if (kind === "download") downloadSource(src);
    else setShareTarget({ item: src });
  };

  const exportThread = () => {
    if (!userQuery) {
      push("エクスポートするスレッドがありません", "info");
      return;
    }
    const md = `# ${userQuery}\n\n${agent.answer}\n\n---\n\n## 参考資料\n${agent.sources.map((s, i) => `[${i + 1}] ${s.title} (${s.path})`).join("\n")}\n`;
    triggerDownload(new Blob([md], { type: "text/markdown" }), `arag-thread-${activeThreadId}.md`);
    push("スレッドをMarkdownでエクスポートしました", "success");
  };

  // ── Drag & drop ───────────────────────────────────────────────────────
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    if (status !== "authed") return;
    let counter = 0;
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types?.includes("Files");
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      counter++;
      setDragging(true);
    };
    const onLeave = () => {
      counter--;
      if (counter <= 0) {
        counter = 0;
        setDragging(false);
      }
    };
    const onOver = (e: DragEvent) => hasFiles(e) && e.preventDefault();
    const onDrop = (e: DragEvent) => {
      if (!e.dataTransfer?.files?.length) return;
      e.preventDefault();
      counter = 0;
      setDragging(false);
      uploads.addFiles(e.dataTransfer.files);
    };
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("dragover", onOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("drop", onDrop);
    };
  }, [status, uploads]);

  // ── Keyboard shortcuts ────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (mod && e.key === "n") return e.preventDefault(), newChat();
      if (mod && e.key === "k") return e.preventDefault(), setSettingsOpen(true);
      if (mod && e.key === "b") return e.preventDefault(), setSidebarCollapsed((c) => !c);
      if (mod && e.key === "/") return e.preventDefault(), setSidebarCollapsed(false);
      if (e.key === "?" && e.shiftKey && !mod && tag !== "input" && tag !== "textarea") {
        return e.preventDefault(), setHelpOpen(true);
      }
      if (mod && e.key === "Backspace" && phase === "running") return e.preventDefault(), stopRun();
      if (e.key === "Escape") {
        if (helpOpen) setHelpOpen(false);
        else if (settingsOpen) setSettingsOpen(false);
        else if (rightPanelOpen) setRightPanelOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, settingsOpen, rightPanelOpen, helpOpen, isMobile]);

  // ── Loading / login gates ─────────────────────────────────────────────
  if (status === "loading") {
    return (
      <div className="grid h-dvh place-items-center bg-bg">
        <span className="h-7 w-7 animate-[ar-spin_0.8s_linear_infinite] rounded-full border-2 border-divider-strong border-t-accent" />
      </div>
    );
  }

  if (status === "guest" || !user) {
    return (
      <div className="h-dvh">
        <Login onSignIn={signIn} onRegister={register} />
        <ToastViewport toasts={toasts} onDismiss={dismiss} />
      </div>
    );
  }

  const threadList = threads.map((t) => ({ ...t, active: t.id === activeThreadId }));
  const backdropVisible = isWide ? false : isMobile ? !sidebarCollapsed || rightPanelShown : rightPanelShown;

  return (
    <div
      className={cn(
        "group/shell grid h-dvh overflow-hidden bg-bg text-[14px]",
        tweaks.density === "compact" && "text-[13px]",
        "grid-cols-[1fr]",
        "tablet:grid-cols-[260px_minmax(0,1fr)] tablet:data-[sb=collapsed]:grid-cols-[48px_minmax(0,1fr)]",
        "wide:grid-cols-[260px_minmax(0,1fr)] wide:data-[sb=collapsed]:grid-cols-[48px_minmax(0,1fr)]",
        "wide:data-[rp=open]:grid-cols-[260px_minmax(0,1fr)_420px] wide:data-[sb=collapsed]:data-[rp=open]:grid-cols-[48px_minmax(0,1fr)_420px]",
      )}
      data-sb={sidebarCollapsed ? "collapsed" : "open"}
      data-rp={rightPanelShown ? "open" : "closed"}
    >
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed((c) => !c)}
        threads={threadList}
        activeThreadId={activeThreadId}
        onSelectThread={selectThread}
        onNewChat={newChat}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenHelp={() => setHelpOpen(true)}
        onSignOut={signOut}
        onToggleTheme={() => setTweak("dark", !tweaks.dark)}
        dark={tweaks.dark}
        user={user}
      />

      <main className="grid min-h-0 min-w-0 grid-cols-[minmax(0,1fr)] grid-rows-[auto_1fr] overflow-hidden bg-bg">
        {/* Header */}
        <header className="sticky top-0 z-[5] flex h-[52px] items-center gap-2 border-b-[0.5px] border-divider bg-bg px-[18px] max-md:gap-1 max-md:px-2.5">
          <button
            className="hidden h-[34px] w-[34px] shrink-0 -ml-1 place-items-center rounded-lg border-0 bg-transparent text-fg hover:bg-divider max-md:grid"
            onClick={() => setSidebarCollapsed(false)}
            aria-label="メニューを開く"
          >
            <svg viewBox="0 0 16 16" width="15" height="15">
              <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
          <div className="flex min-w-0 flex-1 items-center gap-2 text-[13.5px] font-semibold text-fg max-md:gap-1.5 max-md:text-[13px]">
            {phase === "empty" ? (
              <span className="font-medium text-muted">新規スレッド</span>
            ) : (
              <>
                <span className="truncate">{userQuery.slice(0, 56) || "スレッド"}</span>
                <span className="font-normal text-[12px] text-muted max-md:hidden">·  {agent.sources.length} sources</span>
                {phase === "cancelled" && (
                  <span className="ml-1.5 inline-flex items-center gap-1 rounded-full bg-[#FDEFEA] px-[7px] py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.04em] text-[#B83A1F] dark:bg-[rgba(184,58,31,0.18)]">
                    キャンセル済
                  </span>
                )}
                {phase === "running" && (
                  <span className="ml-1.5 inline-flex items-center gap-1 rounded-full bg-accent-soft px-[7px] py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.04em] text-accent before:h-[5px] before:w-[5px] before:rounded-full before:bg-accent before:[animation:ar-pulse_1.2s_ease-in-out_infinite]">
                    実行中
                  </span>
                )}
              </>
            )}
          </div>
          <div className="flex items-center gap-1.5 max-md:gap-0.5">
            {phase !== "empty" && (
              <>
                <HeaderBtn title="共有" onClick={() => setShareTarget({ item: null })} iconOnly>
                  <svg viewBox="0 0 16 16" width="13" height="13">
                    <circle cx="4" cy="8" r="1.5" fill="currentColor" />
                    <circle cx="12" cy="4" r="1.5" fill="currentColor" />
                    <circle cx="12" cy="12" r="1.5" fill="currentColor" />
                    <path d="M5.3 7.3 10.7 4.7M5.3 8.7l5.4 2.6" stroke="currentColor" strokeWidth="1.4" />
                  </svg>
                  共有
                </HeaderBtn>
                <HeaderBtn title="Markdownでエクスポート" onClick={exportThread} iconOnly>
                  <svg viewBox="0 0 16 16" width="13" height="13">
                    <path d="M8 2v8M5 7l3 3 3-3M3 13h10" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </HeaderBtn>
                {!rightPanelOpen && (
                  <button
                    className="inline-flex h-[30px] items-center gap-1.5 rounded-lg border border-accent bg-transparent px-2.5 text-[12px] font-medium text-accent hover:bg-accent-soft max-md:h-8 max-md:px-2.5 max-md:text-[11.5px]"
                    onClick={() => setRightPanelOpen(true)}
                  >
                    <svg viewBox="0 0 16 16" width="13" height="13">
                      <path d="M3 3h10v10H3z" stroke="currentColor" strokeWidth="1.4" fill="none" />
                      <path d="M10 3v10" stroke="currentColor" strokeWidth="1.4" />
                    </svg>
                    一次資料 ({agent.sources.length})
                  </button>
                )}
              </>
            )}
            <button
              className="grid h-[30px] w-[30px] place-items-center rounded-lg border-0 bg-transparent text-muted hover:bg-divider hover:text-fg"
              onClick={() => setTweak("dark", !tweaks.dark)}
              title={tweaks.dark ? "ライトモードへ" : "ダークモードへ"}
              aria-label="テーマ切替"
            >
              {tweaks.dark ? (
                <svg viewBox="0 0 16 16" width="14" height="14">
                  <circle cx="8" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.4" fill="none" />
                  <path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.5 3.5l1.1 1.1M11.4 11.4l1.1 1.1M3.5 12.5l1.1-1.1M11.4 4.6l1.1-1.1" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" />
                </svg>
              ) : (
                <svg viewBox="0 0 16 16" width="14" height="14">
                  <path d="M13 9.2A5.5 5.5 0 016.8 3a.5.5 0 00-.6-.6 6.5 6.5 0 107.4 7.4.5.5 0 00-.6-.6z" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinejoin="round" />
                </svg>
              )}
            </button>
          </div>
        </header>

        {/* Body */}
        <div className="grid min-h-0 min-w-0 grid-cols-[minmax(0,1fr)] grid-rows-[1fr_auto] overflow-hidden">
          <div ref={scrollRef} onScroll={onChatScroll} className="overflow-y-auto overflow-x-hidden scroll-smooth">
            {phase === "empty" ? (
              <EmptyState user={user} onPickPrompt={startRun} />
            ) : (
              <div
                className={cn(
                  "mx-auto flex max-w-[1020px] flex-col gap-6 px-8 pb-[60px] pt-7 max-md:max-w-none max-md:gap-[18px] max-md:px-3.5 max-md:pb-20 max-md:pt-[18px]",
                  tweaks.density === "compact" && "gap-4 px-5 pb-10 pt-[18px]",
                )}
              >
                <UserMessage text={userQuery} />
                <AssistantMessage>
                  {userAttachments.length > 0 && isLive && <UserAttachments files={userAttachments} />}
                  <ToolSteps
                    steps={agent.steps}
                    variant={tweaks.toolView}
                    expandedMap={expandedSteps}
                    onToggleStep={(id) => setExpandedSteps((m) => ({ ...m, [id]: !m[id] }))}
                  />
                  {phase === "cancelled" ? (
                    <CancelledNotice onRetry={regenerate} />
                  ) : (
                    (agent.answer.length > 0 || agent.streaming) && (
                      <StreamingAnswer
                        text={agent.answer}
                        streaming={agent.streaming}
                        onCite={openCitation}
                        citationStyle={tweaks.citationStyle}
                      />
                    )
                  )}
                  {phase === "done" && (
                    <AnswerFooter
                      tokens={agent.tokens}
                      durationMs={agent.durationMs}
                      sources={agent.sources}
                      onCopy={copyAnswer}
                      onRegenerate={regenerate}
                      onFeedback={(v) => {
                        setFeedback((prev) => (prev === v ? null : v));
                        if (feedback !== v) push(v === "up" ? "フィードバックを送信しました" : "改善要望を受け付けました", "success");
                      }}
                      feedback={feedback}
                    />
                  )}
                </AssistantMessage>
              </div>
            )}
          </div>

          <Composer
            value={composerValue}
            onChange={setComposerValue}
            onSubmit={() => startRun(composerValue)}
            onStop={stopRun}
            model={model}
            onChangeModel={() => setSettingsOpen(true)}
            running={phase === "running"}
            attachments={uploads.files}
            onAttachFiles={uploads.addFiles}
            onRemoveAttachment={uploads.removeFile}
            scope={scope}
            onChangeScope={(s) => {
              setScope(s);
              push(`検索範囲: ${s.label}`, "info");
            }}
          />
        </div>
      </main>

      {rightPanelShown && (
        <RightPanel
          sources={agent.sources}
          citationMap={agent.citationMap}
          activeSourceId={activeSourceId}
          highlightSectionId={highlightSectionId}
          onSetActive={(id) => {
            setActiveSourceId(id);
            setHighlightSectionId(null);
          }}
          onClose={() => setRightPanelOpen(false)}
          onAction={handleRPAction}
        />
      )}

      {/* Drawer backdrop (mobile + tablet) */}
      <div
        className="hidden fixed inset-0 z-[55] bg-[rgba(15,13,10,0.42)] opacity-0 backdrop-blur-[2px] transition-opacity duration-150 [pointer-events:none] data-[visible=true]:opacity-100 data-[visible=true]:[pointer-events:auto] max-wide:block"
        data-visible={backdropVisible ? "true" : "false"}
        onClick={() => {
          setSidebarCollapsed(true);
          setRightPanelOpen(false);
        }}
        aria-hidden
      />

      <HelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />
      <ShareModal
        open={!!shareTarget}
        item={shareTarget?.item ?? null}
        onClose={() => setShareTarget(null)}
        onCopyLink={(err) => push(err ? "コピーに失敗しました" : "共有リンクをコピーしました", err ? "error" : "success")}
      />
      <DropOverlay visible={dragging} />
      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        model={model}
        onModelChange={(m) => {
          setModel(m);
          setSettingsOpen(false);
          push(`${m.label} に切り替えました`, "success");
        }}
        tweaks={tweaks}
        setTweak={setTweak}
      />
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}

function HeaderBtn({
  title,
  onClick,
  iconOnly,
  children,
}: {
  title: string;
  onClick: () => void;
  iconOnly?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={cn(
        "inline-flex h-[30px] items-center gap-1.5 rounded-lg border border-divider-strong bg-surface px-2.5 text-[12px] font-medium text-fg hover:bg-surface-2",
        iconOnly && "max-md:w-8 max-md:justify-center max-md:px-0 max-md:text-[0px] max-md:[&_svg]:text-[13px]",
      )}
    >
      {children}
    </button>
  );
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}
