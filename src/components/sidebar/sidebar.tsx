"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { cn } from "@/lib/utils";
import type { AppUser, ThreadSummary } from "@/lib/types";

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  threads: ThreadSummary[];
  activeThreadId: string;
  onSelectThread: (id: string) => void;
  onNewChat: () => void;
  onOpenSettings: () => void;
  onOpenHelp: () => void;
  onSignOut: () => void;
  onToggleTheme: () => void;
  onRenameThread: (id: string, title: string) => void | Promise<void>;
  onDeleteThread: (id: string) => void | Promise<void>;
  onToggleStar: (id: string, pinned: boolean) => void | Promise<void>;
  onAddToProject: (id: string) => void;
  dark: boolean;
  user: AppUser;
}

const drawerBase =
  "max-tablet:fixed max-tablet:inset-y-0 max-tablet:left-0 max-tablet:z-[60] max-tablet:w-[284px] max-tablet:max-w-[86vw] max-tablet:border-r-0 max-tablet:shadow-[8px_0_32px_rgba(0,0,0,0.18)] max-tablet:transition-transform max-tablet:duration-[240ms] max-tablet:ease-[cubic-bezier(0.2,0.8,0.2,1)]";

interface MenuAnchor {
  id: string;
  rect: { left: number; top: number; bottom: number; right: number };
}

export function Sidebar(props: SidebarProps) {
  const {
    collapsed, onToggle, threads, activeThreadId, onSelectThread, onNewChat,
    onRenameThread, onDeleteThread, onToggleStar, onAddToProject,
  } = props;
  const [filter, setFilter] = useState("");
  const [menuAnchor, setMenuAnchor] = useState<MenuAnchor | null>(null);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const filtered = threads.filter((t) => !filter || t.title.toLowerCase().includes(filter.toLowerCase()));

  if (collapsed) {
    // Icon rail (desktop ≥769px). Hidden entirely on mobile (drawer closes instead).
    return (
      <aside className="relative flex flex-col items-center gap-2 overflow-hidden border-r-[0.5px] border-divider bg-bg-2 py-3 max-tablet:hidden">
        <button
          className="grid h-8 w-8 place-items-center rounded-lg border-0 bg-transparent text-muted hover:bg-divider hover:text-fg"
          onClick={onToggle}
          aria-label="サイドバーを開く"
        >
          <Icon name="chevronRight" size={14} />
        </button>
        <button
          className="grid h-8 w-8 place-items-center rounded-lg border-0 bg-transparent text-fg hover:bg-divider"
          onClick={onNewChat}
          aria-label="新規スレッド"
          title="新規スレッド"
        >
          <Icon name="plus" size={14} />
        </button>
      </aside>
    );
  }

  // relativeTime() の実出力（たった今 / X分前 / X時間前 / X日前 / X週間前 / Xヶ月前 / X年前）に
  // 合わせて振り分ける。どれにも当たらないものは「以前」に落とし、スレッドが
  // どのグループからも漏れて消えないようにする（catch-all）。
  const isToday = (u: string) => u === "今" || u === "たった今" || u.includes("分前") || u.includes("時間");
  const isWeek = (u: string) => u === "昨日" || u.includes("日前");
  const pinned = filtered.filter((t) => t.pinned);
  const rest = filtered.filter((t) => !t.pinned);
  const groups = [
    { label: "ピン留め", items: pinned },
    { label: "今日", items: rest.filter((t) => isToday(t.updated)) },
    { label: "今週", items: rest.filter((t) => !isToday(t.updated) && isWeek(t.updated)) },
    { label: "以前", items: rest.filter((t) => !isToday(t.updated) && !isWeek(t.updated)) },
  ].filter((g) => g.items.length > 0);

  const beginRename = (t: ThreadSummary) => {
    setMenuAnchor(null);
    setRenameId(t.id);
    setRenameValue(t.title);
  };
  const commitRename = async () => {
    const id = renameId;
    const next = renameValue.trim();
    setRenameId(null);
    setRenameValue("");
    if (!id || !next) return;
    const original = threads.find((x) => x.id === id);
    if (!original || next === original.title) return;
    await onRenameThread(id, next);
  };
  const cancelRename = () => {
    setRenameId(null);
    setRenameValue("");
  };

  const menuThread = menuAnchor ? threads.find((t) => t.id === menuAnchor.id) ?? null : null;

  return (
    <aside
      className={cn(
        "relative flex flex-col overflow-hidden border-r-[0.5px] border-divider bg-bg-2",
        drawerBase,
        "max-tablet:translate-x-0",
      )}
    >
      {/* Head */}
      <div className="flex items-center justify-between py-3 pl-[14px] pr-3 pb-2">
        <div className="flex items-center gap-2 text-[14px] font-bold tracking-[-0.01em]">
          <div className="grid h-[22px] w-[22px] place-items-center rounded-md bg-accent text-white">
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden>
              <path d="M4 6c0-1.1.9-2 2-2h8l6 6v8c0 1.1-.9 2-2 2H6c-1.1 0-2-.9-2-2V6z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
              <circle cx="12" cy="13" r="3" fill="none" stroke="currentColor" strokeWidth="1.8" />
            </svg>
          </div>
          <span>ARag</span>
        </div>
        <button
          className="grid h-[26px] w-[26px] place-items-center rounded-md border-0 bg-transparent text-muted hover:bg-divider hover:text-fg"
          onClick={onToggle}
          aria-label="サイドバーを閉じる"
          title="サイドバーを閉じる"
        >
          <Icon name="chevronLeft" size={13} />
        </button>
      </div>

      {/* New thread */}
      <button
        className="mx-3 mb-2 flex h-9 items-center gap-2 rounded-[10px] border border-divider-strong bg-surface px-3 text-[13px] font-medium text-fg shadow-e1 hover:bg-surface-2"
        onClick={onNewChat}
      >
        <Icon name="plus" size={13} />
        <span className="flex-1 text-left">新規スレッド</span>
        <kbd>⌘N</kbd>
      </button>

      {/* Search */}
      <div className="relative mx-3 mb-3">
        <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-2">
          <Icon name="search" size={12} />
        </span>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="スレッドを検索…"
          className="h-[30px] w-full rounded-lg border-0 bg-transparent pl-[30px] pr-2.5 text-[12.5px] text-fg outline-none placeholder:text-muted-2 focus:bg-surface focus:shadow-[0_0_0_1px_var(--divider-strong)]"
        />
      </div>

      {/* List */}
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
        {groups.map((g) => (
          <div key={g.label} className="mb-2">
            <div className="px-2 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted-2">
              {g.label}
            </div>
            {g.items.map((t) => (
              <ThreadRow
                key={t.id}
                thread={t}
                active={t.id === activeThreadId}
                renaming={renameId === t.id}
                renameValue={renameValue}
                menuOpen={menuAnchor?.id === t.id}
                onRenameChange={setRenameValue}
                onRenameCommit={commitRename}
                onRenameCancel={cancelRename}
                onSelect={() => onSelectThread(t.id)}
                onOpenMenu={(rect) => setMenuAnchor({ id: t.id, rect })}
              />
            ))}
          </div>
        ))}

        <div className="mx-2 my-3 h-px bg-divider" />
        <div className="mb-2">
          <div className="px-2 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted-2">
            コレクション
          </div>
          <CollectionItem icon="star" label="スター付き" count={String(pinned.length)} />
          <CollectionItem icon="folder" label="プロジェクト" count="4" />
          <CollectionItem icon="database" label="データソース" count="8" />
        </div>
      </div>

      <SidebarFooter {...props} />

      {menuAnchor && menuThread && (
        <ThreadMenu
          thread={menuThread}
          anchor={menuAnchor.rect}
          onClose={() => setMenuAnchor(null)}
          onStar={() => {
            const target = menuThread;
            setMenuAnchor(null);
            onToggleStar(target.id, !target.pinned);
          }}
          onRename={() => beginRename(menuThread)}
          onAddProject={() => {
            const target = menuThread;
            setMenuAnchor(null);
            onAddToProject(target.id);
          }}
          onDelete={() => {
            const target = menuThread;
            setMenuAnchor(null);
            onDeleteThread(target.id);
          }}
        />
      )}
    </aside>
  );
}

interface ThreadRowProps {
  thread: ThreadSummary;
  active: boolean;
  renaming: boolean;
  renameValue: string;
  menuOpen: boolean;
  onRenameChange: (v: string) => void;
  onRenameCommit: () => void;
  onRenameCancel: () => void;
  onSelect: () => void;
  onOpenMenu: (rect: { left: number; top: number; bottom: number; right: number }) => void;
}

function ThreadRow({
  thread, active, renaming, renameValue, menuOpen,
  onRenameChange, onRenameCommit, onRenameCancel,
  onSelect, onOpenMenu,
}: ThreadRowProps) {
  if (renaming) {
    return (
      <div className="my-px flex w-full items-center gap-2 rounded-md bg-surface px-2 py-1 shadow-e1">
        {thread.pinned && (
          <span className="shrink-0 text-accent">
            <Icon name="starFilled" size={11} />
          </span>
        )}
        <input
          autoFocus
          value={renameValue}
          onChange={(e) => onRenameChange(e.target.value)}
          onBlur={onRenameCommit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onRenameCommit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              onRenameCancel();
            }
          }}
          className="min-w-0 flex-1 border-0 bg-transparent py-1 text-[12.5px] text-fg outline-none"
        />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "group/row relative my-px flex w-full items-stretch rounded-md transition-colors",
        active ? "bg-surface shadow-e1" : "bg-transparent hover:bg-divider",
        menuOpen && "bg-divider",
      )}
    >
      <button
        title={thread.title}
        onClick={onSelect}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-2 rounded-md py-1.5 pl-2 pr-8 text-left text-[12.5px] transition-colors",
          active ? "font-medium text-fg" : "text-fg-2",
        )}
      >
        {thread.pinned && (
          <span className="shrink-0 text-accent">
            <Icon name="starFilled" size={11} />
          </span>
        )}
        <span className="min-w-0 flex-1 truncate">{thread.title}</span>
      </button>
      {active && (
        <span
          className={cn(
            "pointer-events-none absolute right-3 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-accent transition-opacity",
            "group-hover/row:opacity-0",
            menuOpen && "opacity-0",
          )}
        />
      )}
      <button
        type="button"
        aria-label="スレッド操作メニュー"
        onClick={(e) => {
          e.stopPropagation();
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
          onOpenMenu({ left: rect.left, top: rect.top, bottom: rect.bottom, right: rect.right });
        }}
        className={cn(
          "absolute right-1 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-md border-0 bg-transparent text-muted opacity-0 transition-opacity hover:bg-bg-2 hover:text-fg focus-visible:opacity-100 group-hover/row:opacity-100",
          menuOpen && "bg-bg-2 text-fg opacity-100",
        )}
      >
        <Icon name="more" size={13} />
      </button>
    </div>
  );
}

interface ThreadMenuProps {
  thread: ThreadSummary;
  anchor: { left: number; top: number; bottom: number; right: number };
  onClose: () => void;
  onStar: () => void;
  onRename: () => void;
  onAddProject: () => void;
  onDelete: () => void;
}

function ThreadMenu({ thread, anchor, onClose, onStar, onRename, onAddProject, onDelete }: ThreadMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<React.CSSProperties>(() => ({
    left: anchor.right + 4,
    top: anchor.top,
    width: 200,
    visibility: "hidden",
  }));

  // Re-position after mount: prefer right of trigger, fall back to left or below.
  useEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const { offsetWidth: w, offsetHeight: h } = el;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = anchor.right + 4;
    if (left + w > vw - 8) left = Math.max(8, anchor.left - w - 4);
    let top = anchor.top;
    if (top + h > vh - 8) top = Math.max(8, vh - h - 8);
    setStyle({ left, top, width: w });
  }, [anchor]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const itemCls =
    "group/mi flex w-full items-center gap-3 rounded-[7px] border-0 bg-transparent px-2.5 py-2 text-left text-[13px] text-fg transition-colors hover:bg-divider";
  const iconCls = "inline-flex w-[18px] shrink-0 items-center justify-center text-muted group-hover/mi:text-fg";

  return (
    <div
      ref={menuRef}
      role="menu"
      style={style}
      className="fixed z-[90] flex min-w-[200px] animate-pop-in flex-col rounded-xl border-[0.5px] border-divider-strong bg-surface p-1.5 shadow-e3"
    >
      <button className={itemCls} role="menuitem" onClick={onStar}>
        <span className={iconCls}>
          <Icon name={thread.pinned ? "starFilled" : "star"} size={14} />
        </span>
        <span className="min-w-0 flex-1">{thread.pinned ? "スターを外す" : "スター"}</span>
      </button>
      <button className={itemCls} role="menuitem" onClick={onRename}>
        <span className={iconCls}>
          <Icon name="pencil" size={14} />
        </span>
        <span className="min-w-0 flex-1">名前を変更</span>
      </button>
      <button className={itemCls} role="menuitem" onClick={onAddProject}>
        <span className={iconCls}>
          <Icon name="inbox" size={14} />
        </span>
        <span className="min-w-0 flex-1">プロジェクトに追加</span>
      </button>
      <div className="mx-1.5 my-1 h-px bg-divider" />
      <button
        className={cn(itemCls, "text-[#B83A1F] hover:bg-[#FDEFEA] dark:hover:bg-[rgba(184,58,31,0.16)]")}
        role="menuitem"
        onClick={onDelete}
      >
        <span className="inline-flex w-[18px] shrink-0 items-center justify-center text-[#B83A1F]">
          <Icon name="trash" size={14} />
        </span>
        <span className="min-w-0 flex-1">削除</span>
      </button>
    </div>
  );
}

function CollectionItem({ icon, label, count }: { icon: "star" | "folder" | "database"; label: string; count: string }) {
  return (
    <button className="my-px flex w-full items-center gap-2 rounded-md bg-transparent px-2 py-1.5 text-left text-[12.5px] text-fg-2 hover:bg-divider">
      <span className="w-4 text-center">
        <Icon name={icon} size={13} />
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="font-mono text-[10.5px] text-muted">{count}</span>
    </button>
  );
}

function SidebarFooter({ user, onOpenSettings, onOpenHelp, onSignOut, onToggleTheme, dark }: SidebarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);

  return (
    <div className="border-t-[0.5px] border-divider p-2">
      <button
        ref={btnRef}
        className={cn(
          "flex w-full items-center gap-2.5 rounded-lg bg-transparent px-2 py-1.5 hover:bg-divider",
          menuOpen && "bg-divider",
        )}
        onClick={() => setMenuOpen((o) => !o)}
      >
        <div className="grid h-[30px] w-[30px] place-items-center rounded-full bg-accent text-[11px] font-semibold tracking-[0.02em] text-white">
          {user.initials}
        </div>
        <div className="min-w-0 flex-1 text-left">
          <div className="truncate text-[12.5px] font-semibold text-fg">{user.name}</div>
          <div className="truncate text-[10.5px] text-muted">{user.org}</div>
        </div>
        <svg viewBox="0 0 16 16" width="12" height="12" className="text-muted-2">
          <path d="M3 6l3 3 3-3M3 10l3 3 3-3" transform="translate(2 -2)" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <UserMenu
        open={menuOpen}
        anchorRef={btnRef}
        onClose={() => setMenuOpen(false)}
        user={user}
        dark={dark}
        onOpenSettings={() => { setMenuOpen(false); onOpenSettings(); }}
        onOpenHelp={() => { setMenuOpen(false); onOpenHelp(); }}
        onToggleTheme={onToggleTheme}
        onSignOut={() => { setMenuOpen(false); onSignOut(); }}
      />
    </div>
  );
}

interface UserMenuProps {
  open: boolean;
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  user: AppUser;
  dark: boolean;
  onOpenSettings: () => void;
  onOpenHelp: () => void;
  onToggleTheme: () => void;
  onSignOut: () => void;
}

function UserMenu({ open, anchorRef, onClose, user, dark, onOpenSettings, onOpenHelp, onToggleTheme, onSignOut }: UserMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<React.CSSProperties>({});

  // Position above the anchor button (fixed coords escape the sidebar's clip).
  useEffect(() => {
    if (!open || !anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    setStyle({
      left: Math.max(8, rect.left),
      bottom: window.innerHeight - rect.top + 6,
      width: Math.max(220, Math.min(280, rect.width + 16)),
    });
  }, [open, anchorRef]);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      if (anchorRef.current?.contains(e.target as Node)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose, anchorRef]);

  if (!open) return null;

  const itemCls =
    "group/mi flex w-full items-center gap-3 rounded-[7px] border-0 bg-transparent px-2.5 py-2 text-left text-[13px] text-fg transition-colors hover:bg-divider";
  const iconCls = "inline-flex w-[18px] shrink-0 items-center justify-center text-muted group-hover/mi:text-fg";

  return (
    <div
      ref={menuRef}
      role="menu"
      style={style}
      className="fixed z-[90] flex min-w-[220px] animate-pop-in flex-col rounded-xl border-[0.5px] border-divider-strong bg-surface p-1.5 shadow-e3"
    >
      <div className="truncate px-3 pb-2 pt-2.5 font-mono text-[11.5px] tracking-[-0.005em] text-muted" title={user.email}>
        {user.email}
      </div>
      <button className={itemCls} role="menuitem" onClick={onOpenSettings}>
        <span className={iconCls}>
          <Icon name="cog" size={14} />
        </span>
        <span className="min-w-0 flex-1">設定</span>
        <span className="text-[11px] text-muted-2">
          <kbd className="border-0 bg-transparent p-0 text-muted-2">⌘K</kbd>
        </span>
      </button>
      <button className={itemCls} role="menuitem" onClick={onToggleTheme}>
        <span className={iconCls}>
          <Icon name={dark ? "sun" : "moon"} size={14} />
        </span>
        <span className="min-w-0 flex-1">{dark ? "ライトモード" : "ダークモード"}</span>
      </button>
      <button className={itemCls} role="menuitem" onClick={onOpenHelp}>
        <span className={iconCls}>
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none">
            <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.4" />
            <path d="M6 6.5a2 2 0 014 0c0 .8-.5 1.2-1 1.5s-1 .5-1 1.2M8 11.4v.1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </span>
        <span className="min-w-0 flex-1">ヘルプを表示</span>
        <span className="text-[11px] text-muted-2">
          <kbd className="border-0 bg-transparent p-0 text-muted-2">?</kbd>
        </span>
      </button>
      <div className="mx-1.5 my-1 h-px bg-divider" />
      <button className={itemCls} role="menuitem" onClick={onSignOut}>
        <span className={iconCls}>
          <Icon name="signout" size={14} />
        </span>
        <span className="min-w-0 flex-1">ログアウト</span>
      </button>
    </div>
  );
}
