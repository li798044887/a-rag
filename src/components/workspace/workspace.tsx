"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Login } from "@/components/auth/login";
import { Composer } from "@/components/chat/composer";
import { EmptyState } from "@/components/chat/empty-state";
import { Transcript } from "@/components/chat/messages";
import { ToastViewport } from "@/components/feedback/toast-viewport";
import { DocumentsModal } from "@/components/documents/documents-modal";
import { HelpModal } from "@/components/modals/help-modal";
import { SettingsModal, type SettingsSection } from "@/components/modals/settings-modal";
import { ShareModal } from "@/components/modals/share-modal";
import { RightPanel, type RightPanelAction } from "@/components/sources/right-panel";
import { usePanelWidth } from "@/components/workspace/use-panel-width";
import { Sidebar } from "@/components/sidebar/sidebar";
import { DropOverlay } from "@/components/uploads/uploads";
import { getModels, getScopePresets } from "@/lib/data";
import { LIVE_KEY, isPendingThreadId, useAgent } from "@/hooks/use-agent";
import { useAuth } from "@/hooks/use-auth";
import { useConfirm } from "@/hooks/use-confirm";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useToasts } from "@/hooks/use-toasts";
import { useTweaks } from "@/hooks/use-tweaks";
import { useT } from "@/i18n/context";
import { interpolate } from "@/i18n/interpolate";
import { useAgentCfg } from "@/hooks/use-agent-cfg";
import { useUploads } from "@/hooks/use-uploads";
import { useWorkspaceStats } from "@/hooks/use-workspace-stats";
import { cn } from "@/lib/utils";
import { MODEL_STORAGE_KEY } from "@/lib/constants";
import { buildThreadMarkdown } from "@/lib/export";
import type { CitationMap, ModelOption, ScopeValue, Source, ThreadSummary, ToolCall, Turn } from "@/lib/types";

type Phase = "empty" | "running" | "done" | "cancelled";

// 安定した空配列参照。`view?.turns ?? []` をインラインで使うと毎レンダーで新配列となり
// startRun の useCallback 依存が不安定になるため、モジュールスコープの定数を使う。
const NO_TURNS: Turn[] = [];

export function Workspace() {
  const { tweaks, setTweak } = useTweaks();
  const { t, locale } = useT();
  const { agentCfg, setAgentCfg } = useAgentCfg();
  const { user, claims, status, signIn, register, signOut, setRemember, revokeAllSessions } = useAuth();
  const { toasts, push, dismiss } = useToasts();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const uploads = useUploads(push);
  const agent = useAgent();
  const workspaceStats = useWorkspaceStats(status === "authed");

  const isMobile = useMediaQuery("(max-width: 768px)");
  const isWide = useMediaQuery("(min-width: 1181px)");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [autoOpened, setAutoOpened] = useState(false);
  const [rightPanelOpen, setRightPanelOpen] = useState(false);
  const [panelWidth, handleResizeWidth] = usePanelWidth();
  const [settingsOpen, setSettingsOpen] = useState(false);
  // 設定モーダルを開く際に表示するセクション。null なら SettingsModal 既定のまま。
  const [settingsSection, setSettingsSection] = useState<SettingsSection | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [documentsOpen, setDocumentsOpen] = useState(false);
  const models = getModels(locale);
  const scopePresets = getScopePresets(locale);
  // localStorage から選択モデルを復元（SSR 安全に遅延初期化）。id は不変なので
  // ロケール非依存。表示用の label/desc/tag は下の useEffect で現在ロケールへ再解決する。
  const [model, setModel] = useState<ModelOption>(() => {
    if (typeof window === "undefined") return models[0];
    const saved = localStorage.getItem(MODEL_STORAGE_KEY);
    return models.find((m) => m.id === saved) ?? models[0];
  });

  // 設定モーダルを指定セクションで開く（section 省略時は既定セクション）。
  const openSettings = useCallback((section?: SettingsSection) => {
    setSettingsSection(section ?? null);
    setSettingsOpen(true);
  }, []);

  const [phase, setPhase] = useState<Phase>("empty");
  const [activeThreadId, setActiveThreadId] = useState(LIVE_KEY);
  // 実行中(ライブ)会話の threadId。サイドバーへの即時登録 / アクティブ判定に使う。
  const [liveId, setLiveId] = useState<string | null>(null);
  const [userQuery, setUserQuery] = useState("");
  const [composerValue, setComposerValue] = useState("");
  const [expandedSteps, setExpandedSteps] = useState<Record<string, boolean>>({ t4: true, t6: true });
  const [activeSourceId, setActiveSourceId] = useState("src-1");
  const [highlightSectionId, setHighlightSectionId] = useState<string | null>("s1-2");
  // ターン index をキーにしたフィードバック（クライアントのみ・スレッド切替/新規でリセット）。
  // turns は末尾追加か prefix 切り詰め（再生成）しか起きないため index は安定。挿入/並べ替えを
  // 導入する場合は安定 ID キーへ移行すること。
  const [feedback, setFeedback] = useState<Record<number, "up" | "down">>({});
  const [userAttachments, setUserAttachments] = useState<typeof uploads.files>([]);
  const [scope, setScope] = useState<ScopeValue>(scopePresets[0]);
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
  // ユーザー起点のスレッド移動ごとに +1。run 開始時の値を控え、onThread の
  // 自動切替が「移動後のユーザー」を勝手に引き戻さないようにする世代トークン。
  const navToken = useRef(0);

  // 表示中スレッドの会話状態（ライブ実行 or 取得済みスナップショット）。無ければ空。
  const view = agent.get(activeThreadId);
  const turns = view?.turns ?? NO_TURNS;
  const lastTurn = turns[turns.length - 1];
  const isLive = activeThreadId === liveId;
  const rightPanelShown = rightPanelOpen && phase !== "empty";

  // 右パネル/ヘッダが参照する「アクティブな引用が属するターン」。既定は末尾ターンへ追従。
  const [activeCiteTurn, setActiveCiteTurn] = useState(0);
  const lastTurnIdx = turns.length - 1;
  const [syncedCiteKey, setSyncedCiteKey] = useState("");
  const citeKey = `${activeThreadId}:${lastTurnIdx}`;
  if (citeKey !== syncedCiteKey) {
    setSyncedCiteKey(citeKey);
    setActiveCiteTurn(lastTurnIdx < 0 ? 0 : lastTurnIdx);
  }
  const citeTurn = turns[activeCiteTurn] ?? lastTurn;

  // 表示中スレッドの状態に phase を追従させる（ライブ会話を表示中にバックグラウンドで
  // 完了/中断した場合や、スレッド切替で戻った場合に正しく反映する）。
  // wasMobile と同じ render-phase パターンで、cascading effect を避ける。
  //
  // 空の下書きでは追従させない。実行中の新規 run は pending key を持つため同期対象。
  const activeStatus = activeThreadId === LIVE_KEY ? undefined : lastTurn?.status;
  const statusKey = activeStatus ? `${activeThreadId}:${activeStatus}` : "";
  const [syncedStatusKey, setSyncedStatusKey] = useState("");
  if (statusKey && statusKey !== syncedStatusKey) {
    setSyncedStatusKey(statusKey);
    setPhase(activeStatus === "running" ? "running" : activeStatus === "cancelled" ? "cancelled" : "done");
  }

  // Collapse the sidebar when the viewport crosses into mobile (render-phase
  // "previous value" pattern — avoids a cascading effect).
  const [wasMobile, setWasMobile] = useState(isMobile);
  if (isMobile !== wasMobile) {
    setWasMobile(isMobile);
    if (isMobile) setSidebarCollapsed(true);
  }

  // Auto-open the source panel once enough of the answer has streamed (desktop).
  if (!isMobile && !autoOpened && !rightPanelOpen && lastTurn?.streaming && (lastTurn?.answer.length ?? 0) > 60) {
    setAutoOpened(true);
    setRightPanelOpen(true);
  }

  // ── Auto-scroll while streaming ───────────────────────────────────────
  useEffect(() => {
    if (userScrolled.current) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lastTurn?.answer, lastTurn?.steps?.length, phase, activeThreadId]);

  const onChatScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    userScrolled.current = el.scrollHeight - el.scrollTop - el.clientHeight >= 40;
  };

  // ── Run / control ─────────────────────────────────────────────────────
  const startRun = useCallback(
    async (query: string, opts?: { regenerateFrom?: number }) => {
      const regen = opts?.regenerateFrom;
      const ready = uploads.files.filter((f) => f.status === "ready");
      // 再生成: 対象ターンの query/添付を再利用。通常: 入力 or 添付からフォールバック。
      const regenTurn = regen != null ? turns[regen] : undefined;
      const finalQuery = regen != null
        ? (regenTurn?.query ?? "")
        : query || (ready.length ? t.workspace.attachmentDefaultQuery : "");
      if (!finalQuery) return;
      const attachNames = regen != null ? (regenTurn?.attachments ?? []) : ready.map((f) => f.name);
      const attachDocIds = regen != null
        ? (regenTurn?.attachmentDocIds ?? [])
        : ready.map((f) => f.documentId).filter((x): x is string => !!x);

      setUserQuery(finalQuery);
      setUserAttachments(regen != null ? [] : ready);
      setComposerValue("");
      setPhase("running");
      setExpandedSteps({ t4: true, t6: true });
      setActiveSourceId("src-1");
      setHighlightSectionId("s1-2");
      setRightPanelOpen(false);
      setAutoOpened(false);
      // 再生成時は regen index 以降のフィードバックを破棄、通常は全リセット。
      setFeedback((prev) => {
        if (regen == null) return {};
        const next: Record<number, "up" | "down"> = {};
        for (const [k, v] of Object.entries(prev)) if (Number(k) < regen) next[Number(k)] = v;
        return next;
      });
      userScrolled.current = false;
      if (regen == null) uploads.clear();

      // 再生成は常にアクティブスレッドの継続。通常は完了済みスレッド表示中のみ継続。
      const cur = agent.get(activeThreadId);
      const curLast = cur?.turns[cur.turns.length - 1];
      const continueId = regen != null
        ? activeThreadId
        : (activeThreadId !== LIVE_KEY && !isPendingThreadId(activeThreadId) && cur && curLast?.status !== "running" ? activeThreadId : undefined);
      if (continueId) setLiveId(continueId);

      const navAtStart = navToken.current;

      await agent.run(finalQuery, attachNames, attachDocIds, continueId, model.id, agentCfg, {
        truncateFrom: regen ?? undefined,
        regenerateFrom: regen ?? undefined,
        onPendingThread: (id) => {
          setLiveId(id);
          if (navToken.current === navAtStart) setActiveThreadId(id);
        },
        onThread: (id, previousId) => {
          setLiveId(id);
          setActiveThreadId((current) => (
            current === previousId || navToken.current === navAtStart ? id : current
          ));
        },
        onDone: (id, status) => {
          if (status === "error") push(t.feedback.runFailed, "error");
          refreshThreads();
        },
      });
    },
    [agent, uploads, push, activeThreadId, refreshThreads, model, turns, t, agentCfg],
  );

  const stopRun = () => {
    agent.cancel(activeThreadId);
    setPhase("cancelled");
    push(t.feedback.runStopped, "info");
  };

  const regenerate = (turnIdx: number) => {
    // 実行中の再生成は禁止。許すと truncateFrom が進行中ターンを state から切り落とす一方、
    // その fetch は中断されず、孤立したストリームが再生成ターンへ書き込んで破損する。
    if (phase === "running") {
      push(t.feedback.regenerateBlocked, "info");
      return;
    }
    startRun("", { regenerateFrom: turnIdx });
    push(t.feedback.regenerating, "info");
  };

  const copyAnswer = async (turnIdx: number) => {
    try {
      const text = (turns[turnIdx]?.answer ?? "").replace(/\*\*/g, "").replace(/\[\d+\]/g, "");
      await navigator.clipboard.writeText(text);
      push(t.feedback.answerCopied, "success");
    } catch {
      push(t.feedback.copyFailed, "error");
    }
  };

  const newChat = () => {
    // ライブ実行は中断しない（バックグラウンドで継続、サイドバーから戻れる）。空の下書きへ。
    navToken.current++;
    setActiveThreadId(LIVE_KEY);
    setPhase("empty");
    setUserQuery("");
    setComposerValue("");
    setRightPanelOpen(false);
    setFeedback({});
    if (isMobile) setSidebarCollapsed(true);
  };

  const openCitation = (n: number, turnIdx: number) => {
    const turn = turns[turnIdx];
    const c = turn?.citationMap[n];
    if (!c) return;
    setActiveCiteTurn(turnIdx);
    setActiveSourceId(c.sourceId);
    setHighlightSectionId(c.sectionId);
    setRightPanelOpen(true);
  };

  // フッターの出典チップ用: そのターンの出典でパネルを開く。
  const openSourcesForTurn = (turnIdx: number) => {
    const turn = turns[turnIdx];
    setActiveCiteTurn(turnIdx);
    setActiveSourceId(turn?.sources[0]?.id ?? "src-1");
    setHighlightSectionId(null);
    setRightPanelOpen(true);
  };

  const renameThread = useCallback(
    async (id: string, title: string) => {
      const prev = threads;
      setThreads((cur) => cur.map((t) => (t.id === id ? { ...t, title } : t)));
      try {
        const res = await fetch(`/api/threads/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title }),
        });
        if (!res.ok) throw new Error("failed");
        push(t.feedback.threadRenamed, "success");
      } catch {
        setThreads(prev);
        push(t.feedback.threadRenameFailed, "error");
      }
    },
    [threads, push, t],
  );

  const toggleStar = useCallback(
    async (id: string, pinned: boolean) => {
      const prev = threads;
      setThreads((cur) => cur.map((t) => (t.id === id ? { ...t, pinned } : t)));
      try {
        const res = await fetch(`/api/threads/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pinned }),
        });
        if (!res.ok) throw new Error("failed");
        push(pinned ? t.feedback.starAdded : t.feedback.starRemoved, "success");
      } catch {
        setThreads(prev);
        push(t.feedback.starUpdateFailed, "error");
      }
    },
    [threads, push, t],
  );

  const deleteThread = useCallback(
    async (id: string) => {
      const target = threads.find((t) => t.id === id);
      const ok = await confirm({
        title: t.workspace.deleteThreadTitle,
        description: target
          ? interpolate(t.workspace.deleteThreadDescWithTitle, { title: target.title })
          : t.workspace.deleteThreadDescGeneric,
        confirmLabel: t.workspace.deleteThreadConfirm,
        cancelLabel: t.workspace.deleteThreadCancel,
        tone: "danger",
      });
      if (!ok) return;
      const prev = threads;
      setThreads((cur) => cur.filter((t) => t.id !== id));
      // アクティブだったスレッドを消したら下書きへ戻す。
      if (id === activeThreadId) {
        navToken.current++;
        setActiveThreadId(LIVE_KEY);
        setPhase("empty");
        setUserQuery("");
        setRightPanelOpen(false);
        setFeedback({});
      }
      if (id === liveId) {
        agent.cancel(id);
        setLiveId(null);
      }
      agent.remove(id);
      try {
        const res = await fetch(`/api/threads/${id}`, { method: "DELETE" });
        if (!res.ok) throw new Error("failed");
        push(t.feedback.threadDeleted, "success");
      } catch {
        setThreads(prev);
        push(t.feedback.threadDeleteFailed, "error");
      }
    },
    [threads, activeThreadId, liveId, agent, push, confirm, t],
  );

  const addToProject = useCallback(() => {
    push(t.feedback.projectComingSoon, "info");
  }, [push, t]);

  const selectThread = (id: string) => {
    if (id === activeThreadId) {
      if (isMobile) setSidebarCollapsed(true);
      return;
    }
    navToken.current++;
    setActiveThreadId(id);
    setFeedback({});
    setRightPanelOpen(false);
    if (isMobile) setSidebarCollapsed(true);
    userScrolled.current = false;

    const existing = agent.get(id);
    if (existing) {
      // ライブ実行中 or 取得済みスナップショット。サーバ取得不要でそのまま表示
      // （実行中ならライブ進捗が見える）。phase は同期エフェクトが追従。
      const exTurns = existing.turns;
      setUserQuery(exTurns[exTurns.length - 1]?.query ?? "");
    } else if (id === LIVE_KEY) {
      setUserQuery("");
      setPhase("empty");
    } else {
      // APIからスレッド詳細を取得して履歴を復元
      fetch(`/api/threads/${id}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data: { turns: Turn[] | { completed: { query: string; answerText: string; tokens: number; durationMs: number }; sources: Source[]; citationMap: CitationMap; steps: ToolCall[] }[] } | null) => {
          if (data && data.turns) {
            const loaded = data.turns.map((d) => ("answer" in d ? d as Turn : {
              query: d.completed.query, steps: (d.steps ?? []).map((s) => ({ ...s, status: "done" as const })),
              answer: d.completed.answerText, streaming: false, citationMap: d.citationMap,
              sourceIds: d.sources.map((s) => s.id), sources: d.sources,
              tokens: d.completed.tokens, durationMs: d.completed.durationMs,
              status: "done" as const, attachments: [],
            }));
            setUserAttachments([]);
            agent.loadCompleted(id, loaded);
            setUserQuery(loaded[loaded.length - 1]?.query || "");
            setPhase("done");
          } else {
            setActiveThreadId(LIVE_KEY);
            setPhase("empty");
          }
        })
        .catch(() => {
          setActiveThreadId(LIVE_KEY);
          setPhase("empty");
        });
    }
  };

  // ── Source actions ────────────────────────────────────────────────────
  const downloadSource = (src: Source) => {
    const filename = src.path.split("/").pop() || `${src.id}.md`;
    const body = `# ${src.title}\n${src.author}\n\n` + src.sections.map((s) => `## ${s.heading}\n\n${s.body}\n`).join("\n");
    triggerDownload(new Blob([body], { type: "text/markdown" }), filename);
    push(interpolate(t.feedback.sourceDownloaded, { filename }), "success");
  };

  const openSourceTab = (src: Source) => {
    const win = window.open(`/api/documents/${encodeURIComponent(src.id)}/raw`, "_blank");
    if (!win) push(t.feedback.popupBlocked, "error");
  };

  const handleRPAction = (kind: RightPanelAction, src: Source) => {
    if (kind === "open-source") openSourceTab(src);
    else if (kind === "download") downloadSource(src);
    else setShareTarget({ item: src });
  };

  const exportThread = () => {
    if (turns.length === 0) {
      push(t.feedback.exportEmpty, "info");
      return;
    }
    const md = buildThreadMarkdown(turns);
    triggerDownload(new Blob([md], { type: "text/markdown" }), `arag-thread-${activeThreadId}.md`);
    push(t.feedback.exported, "success");
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
      if (!e.dataTransfer?.items?.length && !e.dataTransfer?.files?.length) return;
      e.preventDefault();
      counter = 0;
      setDragging(false);
      void uploads.addFromDataTransfer(e.dataTransfer);
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
      if (mod && e.key === "k") return e.preventDefault(), openSettings();
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

  // 実行中(ライブ)会話をサイドバーへ即時表示。完了して refreshThreads でサーバ一覧に
  // 載ったら自動的に重複排除される（liveId がサーバ一覧に含まれたら仮エントリを出さない）。
  const liveConv = liveId ? agent.get(liveId) : undefined;
  const liveEntry: ThreadSummary | null =
    liveId && liveConv && !threads.some((t) => t.id === liveId)
      ? { id: liveId, title: liveConv.turns[0]?.query || userQuery || t.workspace.liveThreadTitle, updated: t.workspace.liveThreadUpdated }
      : null;
  const threadList = [
    ...(liveEntry ? [{ ...liveEntry, active: liveEntry.id === activeThreadId }] : []),
    ...threads.map((t) => ({ ...t, active: t.id === activeThreadId })),
  ];
  const backdropVisible = isWide ? false : isMobile ? !sidebarCollapsed || rightPanelShown : rightPanelShown;

  return (
    <div
      className={cn(
        "group/shell grid h-dvh overflow-hidden bg-bg text-[14px]",
        tweaks.density === "compact" && "text-[13px]",
        "grid-cols-[1fr]",
        "tablet:grid-cols-[260px_minmax(0,1fr)] tablet:data-[sb=collapsed]:grid-cols-[48px_minmax(0,1fr)]",
        "wide:grid-cols-[260px_minmax(0,1fr)] wide:data-[sb=collapsed]:grid-cols-[48px_minmax(0,1fr)]",
        "wide:data-[rp=open]:grid-cols-[260px_minmax(0,1fr)_var(--rp-width)] wide:data-[sb=collapsed]:data-[rp=open]:grid-cols-[48px_minmax(0,1fr)_var(--rp-width)]",
      )}
      data-sb={sidebarCollapsed ? "collapsed" : "open"}
      data-rp={rightPanelShown ? "open" : "closed"}
      style={{ ["--rp-width" as string]: `${panelWidth}px` }}
    >
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed((c) => !c)}
        threads={threadList}
        activeThreadId={activeThreadId}
        onSelectThread={selectThread}
        onNewChat={newChat}
        onOpenSettings={() => openSettings()}
        onOpenHelp={() => setHelpOpen(true)}
        onSignOut={signOut}
        onToggleTheme={() => setTweak("dark", !tweaks.dark)}
        onRenameThread={renameThread}
        onDeleteThread={deleteThread}
        onToggleStar={toggleStar}
        onAddToProject={addToProject}
        onOpenDataSources={() => setDocumentsOpen(true)}
        dataSourceCount={workspaceStats.stats.totalDocumentCount}
        dark={tweaks.dark}
        user={user}
      />

      <main className="grid min-h-0 min-w-0 grid-cols-[minmax(0,1fr)] grid-rows-[auto_1fr] overflow-hidden bg-bg">
        {/* Header */}
        <header className="sticky top-0 z-[5] flex h-[52px] items-center gap-2 border-b-[0.5px] border-divider bg-bg px-[18px] max-md:gap-1 max-md:px-2.5">
          <button
            className="hidden h-[34px] w-[34px] shrink-0 -ml-1 place-items-center rounded-lg border-0 bg-transparent text-fg hover:bg-divider max-md:grid"
            onClick={() => setSidebarCollapsed(false)}
            aria-label={t.workspace.openMenuAriaLabel}
          >
            <svg viewBox="0 0 16 16" width="15" height="15">
              <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
          <div className="flex min-w-0 flex-1 items-center gap-2 text-[13.5px] font-semibold text-fg max-md:gap-1.5 max-md:text-[13px]">
            {phase === "empty" ? (
              <span className="font-medium text-muted">{t.workspace.headerNewThread}</span>
            ) : (
              <>
                <span className="min-w-0 flex-1 truncate">{userQuery.slice(0, 56) || t.workspace.headerThreadFallback}</span>
                <span className="shrink-0 whitespace-nowrap font-normal text-[12px] text-muted max-md:hidden">·  {(citeTurn?.sources ?? []).length} sources</span>
                {phase === "cancelled" && (
                  <span className="ml-1.5 inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-[#FDEFEA] px-[7px] py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.04em] text-[#B83A1F] dark:bg-[rgba(184,58,31,0.18)]">
                    {t.workspace.badgeCancelled}
                  </span>
                )}
                {phase === "running" && (
                  <span className="ml-1.5 inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-accent-soft px-[7px] py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.04em] text-accent before:h-[5px] before:w-[5px] before:rounded-full before:bg-accent before:[animation:ar-pulse_1.2s_ease-in-out_infinite]">
                    {t.workspace.badgeRunning}
                  </span>
                )}
              </>
            )}
          </div>
          <div className="flex items-center gap-1.5 max-md:gap-0.5">
            {phase !== "empty" && (
              <>
                <HeaderBtn title={t.workspace.btnShare} onClick={() => setShareTarget({ item: null })} iconOnly>
                  <svg viewBox="0 0 16 16" width="13" height="13">
                    <circle cx="4" cy="8" r="1.5" fill="currentColor" />
                    <circle cx="12" cy="4" r="1.5" fill="currentColor" />
                    <circle cx="12" cy="12" r="1.5" fill="currentColor" />
                    <path d="M5.3 7.3 10.7 4.7M5.3 8.7l5.4 2.6" stroke="currentColor" strokeWidth="1.4" />
                  </svg>
                  {t.workspace.btnShare}
                </HeaderBtn>
                <HeaderBtn title={t.workspace.btnExport} onClick={exportThread} iconOnly>
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
                    {interpolate(t.workspace.btnSources, { n: String((citeTurn?.sources ?? []).length) })}
                  </button>
                )}
              </>
            )}
            <button
              className="grid h-[30px] w-[30px] place-items-center rounded-lg border-0 bg-transparent text-muted hover:bg-divider hover:text-fg"
              onClick={() => setTweak("dark", !tweaks.dark)}
              title={tweaks.dark ? t.workspace.toLight : t.workspace.toDark}
              aria-label={t.workspace.themeToggleAriaLabel}
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
              <EmptyState user={user} stats={workspaceStats.stats} onPickPrompt={startRun} />
            ) : (
              <div
                className={cn(
                  "mx-auto flex max-w-[1020px] flex-col gap-6 px-8 pb-[60px] pt-7 max-md:max-w-none max-md:gap-[18px] max-md:px-3.5 max-md:pb-20 max-md:pt-[18px]",
                  tweaks.density === "compact" && "gap-4 px-5 pb-10 pt-[18px]",
                )}
              >
                <Transcript
                  turns={turns}
                  toolView={tweaks.toolView}
                  expandedSteps={expandedSteps}
                  onToggleStep={(id) => setExpandedSteps((m) => ({ ...m, [id]: !m[id] }))}
                  onCite={openCitation}
                  citationStyle={tweaks.citationStyle}
                  onCopy={copyAnswer}
                  onRegenerate={regenerate}
                  onOpenSources={openSourcesForTurn}
                  onFeedback={(v: "up" | "down", idx: number) => {
                    setFeedback((prev) => {
                      const next = { ...prev };
                      if (next[idx] === v) delete next[idx];
                      else next[idx] = v;
                      return next;
                    });
                    if (feedback[idx] !== v) push(v === "up" ? t.feedback.feedbackSent : t.feedback.feedbackImprovement, "success");
                  }}
                  feedback={feedback}
                  activeCiteTurn={activeCiteTurn}
                  rightPanelOpen={rightPanelShown}
                  liveAttachments={userAttachments}
                  isLiveLastTurn={isLive}
                />
              </div>
            )}
          </div>

          <Composer
            value={composerValue}
            onChange={setComposerValue}
            onSubmit={() => startRun(composerValue)}
            onStop={stopRun}
            model={model}
            onChangeModel={() => openSettings("model")}
            running={phase === "running"}
            attachments={uploads.files}
            onAttachFiles={uploads.addFiles}
            onRemoveAttachment={uploads.removeFile}
            onRetryAttachment={uploads.retry}
            scope={scope}
            onChangeScope={(s) => {
              setScope(s);
              push(interpolate(t.feedback.scopeChanged, { label: s.label }), "info");
            }}
          />
        </div>
      </main>

      {rightPanelShown && (
        <RightPanel
          sources={citeTurn?.sources ?? []}
          contextQuery={citeTurn?.query}
          citationMap={citeTurn?.citationMap ?? {}}
          activeSourceId={activeSourceId}
          highlightSectionId={highlightSectionId}
          onSetActive={(id) => {
            setActiveSourceId(id);
            setHighlightSectionId(null);
          }}
          onClose={() => setRightPanelOpen(false)}
          resizable={isWide}
          panelWidth={panelWidth}
          onResizeWidth={handleResizeWidth}
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
      <DocumentsModal
        open={documentsOpen}
        onClose={() => { setDocumentsOpen(false); workspaceStats.refresh(); }}
        onChanged={workspaceStats.refresh}
        onToast={push}
      />
      <ShareModal
        open={!!shareTarget}
        item={shareTarget?.item ?? null}
        onClose={() => setShareTarget(null)}
        onCopyLink={(err) => push(err ? t.feedback.linkCopyFailed : t.feedback.linkCopied, err ? "error" : "success")}
      />
      <DropOverlay visible={dragging} />
      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        model={model}
        requestedSection={settingsSection}
        onModelChange={(m) => {
          setModel(m);
          localStorage.setItem(MODEL_STORAGE_KEY, m.id);
          setSettingsOpen(false);
          push(interpolate(t.feedback.modelSwitched, { label: m.label }), "success");
        }}
        tweaks={tweaks}
        setTweak={setTweak}
        agentCfg={agentCfg}
        setAgentCfg={setAgentCfg}
        user={user}
        claims={claims}
        onSetRemember={async (v) => {
          try {
            await setRemember(v);
            push(v ? t.feedback.sessionSaved : t.feedback.sessionSaveDisabled, "success");
          } catch {
            push(t.feedback.sessionUpdateFailed, "error");
          }
        }}
        onRevokeAllSessions={async () => {
          const ok = await confirm({
            title: t.workspace.revokeAllTitle,
            description: t.workspace.revokeAllDesc,
            confirmLabel: t.workspace.revokeAllConfirm,
            cancelLabel: t.workspace.revokeAllCancel,
            tone: "danger",
          });
          if (!ok) return;
          try {
            await revokeAllSessions();
            push(t.feedback.signedOutAll, "success");
            setSettingsOpen(false);
          } catch {
            push(t.feedback.signOutFailed, "error");
          }
        }}
      />
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
      {confirmDialog}
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
