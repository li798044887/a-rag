"use client";

import { useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "@/components/icons";
import { getModels } from "@/lib/data";
import { ACCENT_PRESETS } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { SessionClaims } from "@/hooks/use-auth";
import type { AgentCfg, AppUser, ModelOption, Tweaks } from "@/lib/types";
import { useT } from "@/i18n/context";
import { interpolate } from "@/i18n/interpolate";
import { LOCALES, LOCALE_LABELS, type Locale } from "@/i18n/config";
import { persistAndSwitchLocale, browserLocaleEffects } from "@/i18n/use-locale-switch";
import { useConfirm } from "@/hooks/use-confirm";
import { TOP_K_MIN, TOP_K_MAX, CANDIDATE_K_MIN, CANDIDATE_K_MAX } from "@/lib/agent/config";

interface Props {
  open: boolean;
  onClose: () => void;
  model: ModelOption;
  onModelChange: (m: ModelOption) => void;
  /** open になったとき表示するセクション。null/未指定なら現在のセクションを維持。 */
  requestedSection?: SettingsSection | null;
  tweaks: Tweaks;
  setTweak: <K extends keyof Tweaks>(key: K, value: Tweaks[K]) => void;
  agentCfg: AgentCfg;
  setAgentCfg: <K extends keyof AgentCfg>(key: K, value: AgentCfg[K]) => void;
  user: AppUser;
  claims: SessionClaims | null;
  onSetRemember: (value: boolean) => Promise<void> | void;
  onRevokeAllSessions: () => Promise<void> | void;
  /** 表示名を永続化する。成功で resolve、失敗で reject。 */
  onSaveName: (name: string) => Promise<void>;
}

export type SettingsSection = "model" | "sources" | "agent" | "appearance" | "security" | "account";
type Section = SettingsSection;

const CONNECTORS: { name: string; desc: string; enabled: boolean; icon: IconName }[] = [
  { name: "Confluence", desc: "15,234 pages", enabled: true, icon: "confluence" },
  { name: "Notion", desc: "8,420 pages", enabled: true, icon: "notion" },
  { name: "Google Drive", desc: "2,108 docs", enabled: true, icon: "drive" },
  { name: "Slack", desc: "42 channels", enabled: true, icon: "slack" },
  { name: "GitHub", desc: "38 repos", enabled: false, icon: "github" },
  { name: "PostgreSQL", desc: "analytics_warehouse", enabled: true, icon: "postgres" },
  { name: "Linear", desc: "12 teams", enabled: false, icon: "linear" },
];

/** exp(秒) − 現在を表示用にフォーマット。期限切れは辞書の文言を使う。 */
function formatRemainingRaw(expSec: number | null | undefined): { expired: boolean; h: number; m: number; s: number } | null {
  if (!expSec) return null;
  const diffSec = expSec - Math.floor(Date.now() / 1000);
  if (diffSec <= 0) return { expired: true, h: 0, m: 0, s: 0 };
  const h = Math.floor(diffSec / 3600);
  const m = Math.floor((diffSec % 3600) / 60);
  const s = diffSec % 60;
  return { expired: false, h, m, s };
}

function formatLifetimeHours(claims: SessionClaims | null): number | null {
  if (!claims?.iat || !claims?.exp) return null;
  const totalSec = claims.exp - claims.iat;
  return Math.round(totalSec / 3600);
}

/** Accessible on/off switch (button so width/height apply in any layout context). */
function Switch({ on, onToggle, label }: { on: boolean; onToggle: () => void; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onToggle}
      className={cn("relative h-[18px] w-8 shrink-0 rounded-full p-0 transition-colors", on ? "bg-accent" : "bg-divider-strong")}
    >
      <i className={cn("absolute left-0.5 top-0.5 h-[14px] w-[14px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.2)] transition-transform", on && "translate-x-[14px]")} />
    </button>
  );
}

function Segmented({
  value,
  options,
  onChange,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex w-[180px] gap-1 rounded-lg bg-divider p-0.5 max-md:w-full">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            "min-h-[26px] flex-1 whitespace-nowrap rounded-md px-3 py-1 text-[12px] font-medium leading-tight transition-colors",
            value === o.value ? "bg-surface text-fg shadow-e1" : "text-muted",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function SettingsModal({
  open,
  onClose,
  model,
  onModelChange,
  requestedSection,
  tweaks,
  setTweak,
  agentCfg,
  setAgentCfg,
  user,
  claims,
  onSetRemember,
  onRevokeAllSessions,
  onSaveName,
}: Props) {
  const [section, setSection] = useState<Section>(() =>
    typeof window !== "undefined" && window.matchMedia("(max-width: 768px)").matches ? "account" : "model",
  );
  // モーダルが閉→開に変わった時、要求セクションがあればそこへ移動（例: 対話BOXのモデルボタン → モデルタブ）。
  const prevOpen = useRef(false);
  useEffect(() => {
    if (open && !prevOpen.current && requestedSection) setSection(requestedSection);
    prevOpen.current = open;
  }, [open, requestedSection]);
  // Mock settings (no backend in scope). The modal stays mounted across open/close,
  // so this state persists for the session — only a full reload resets it.
  const [connectors, setConnectors] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(CONNECTORS.map((c) => [c.name, c.enabled])),
  );
  const [jwtCopied, setJwtCopied] = useState(false);
  const [rememberPending, setRememberPending] = useState(false);
  const [revoking, setRevoking] = useState(false);
  // 表示名の編集ドラフト。保存(/api)成功や非同期ロードで user.name が変わったら追従する
  // （レンダー中に前回値と比較して調整する React 推奨パターン）。
  const [nameDraft, setNameDraft] = useState(user.name);
  const [nameSaving, setNameSaving] = useState(false);
  const [prevUserName, setPrevUserName] = useState(user.name);
  if (user.name !== prevUserName) {
    setPrevUserName(user.name);
    setNameDraft(user.name);
  }
  // 「残り時間」を 30 秒ごとに再計算（モーダル開いている間のみ）。
  const [nowTick, setNowTick] = useState(0);
  useEffect(() => {
    if (!open || section !== "security") return;
    const id = window.setInterval(() => setNowTick((n) => n + 1), 30_000);
    return () => window.clearInterval(id);
  }, [open, section]);
  // nowTick を参照することで eslint と再描画を成立させる（値自体は使わない）。
  void nowTick;

  // 言語切替：現在ロケールと翻訳辞書、確認ダイアログ。
  const { locale, t } = useT();
  const models = getModels(locale);
  const { confirm, dialog } = useConfirm();

  // NAV と TITLES を辞書から生成（t が必要なので関数スコープ内に置く）。
  const NAV: { id: Section; label: string; icon: IconName }[] = [
    { id: "model", label: t.modals.navModel, icon: "brain" },
    { id: "sources", label: t.modals.navSources, icon: "folders" },
    { id: "agent", label: t.modals.navAgent, icon: "sliders" },
    { id: "appearance", label: t.modals.navAppearance, icon: "sun" },
    { id: "security", label: t.modals.navSecurity, icon: "shield" },
    { id: "account", label: t.modals.navAccount, icon: "user" },
  ];

  const TITLES: Record<Section, string> = {
    model: t.modals.navModel,
    sources: t.modals.navSources,
    agent: t.modals.navAgent,
    appearance: t.modals.navAppearance,
    security: t.modals.navSecurity,
    account: t.modals.navAccount,
  };

  const onLocaleSelect = async (next: Locale) => {
    if (next === locale) return;
    const ok = await confirm({
      title: t.modals.languageSwitchTitle,
      description: t.modals.languageSwitchDesc,
      confirmLabel: t.common.confirm,
      cancelLabel: t.common.cancel,
    });
    if (ok) {
      try {
        await persistAndSwitchLocale(next, browserLocaleEffects);
      } catch {
        // 保存失敗時はリロードしない（言語は変わらないまま）。
      }
    }
  };

  // セキュリティ画面: JWT クレームを読みやすい順に並べて JSON 表示する。null/undefined は省略。
  const claimsJson = (() => {
    if (!claims) return `{\n  ${t.modals.securityClaimsLoading}\n}`;
    const ordered: Record<string, unknown> = {
      sub: claims.sub,
      email: claims.email,
      org: claims.org,
      role: claims.role,
      scopes: claims.scopes,
      rem: claims.rem,
      iat: claims.iat,
      exp: claims.exp,
      iss: claims.iss,
      aud: claims.aud,
    };
    for (const key of Object.keys(ordered)) {
      if (ordered[key] === null || ordered[key] === undefined) delete ordered[key];
    }
    return JSON.stringify(ordered, null, 2);
  })();

  // 残り時間の表示文字列を生成。
  const remainingStr = (() => {
    const raw = formatRemainingRaw(claims?.exp);
    if (!raw) return "—";
    if (raw.expired) return t.modals.securityTokenExpired;
    if (raw.h >= 1) return `${raw.h}h ${raw.m}m`;
    return `${raw.m}m ${raw.s}s`;
  })();

  const lifetimeStr = (() => {
    const h = formatLifetimeHours(claims);
    if (h === null) return "—";
    return interpolate(t.modals.securityTokenLifetimeHours, { h: String(h) });
  })();

  const tokenExpiryDisplay = interpolate(t.modals.securityTokenRemainingFormat, {
    lifetime: lifetimeStr,
    remaining: remainingStr,
  });

  const copyJwt = async () => {
    try {
      await navigator.clipboard.writeText(claimsJson);
      setJwtCopied(true);
      setTimeout(() => setJwtCopied(false), 1500);
    } catch {
      /* clipboard unavailable (e.g. insecure context) — no-op */
    }
  };

  // 表示名をコミット（フォーカス外し / Enter）。空欄・未変更は元へ戻すだけ。失敗時も元へ戻す。
  const commitName = async () => {
    if (nameSaving) return;
    const next = nameDraft.trim();
    if (!next || next === user.name) {
      setNameDraft(user.name);
      return;
    }
    setNameSaving(true);
    try {
      await onSaveName(next);
    } catch {
      setNameDraft(user.name);
    } finally {
      setNameSaving(false);
    }
  };

  const handleRememberToggle = async () => {
    if (!claims || rememberPending) return;
    setRememberPending(true);
    try {
      await onSetRemember(!claims.rem);
    } finally {
      setRememberPending(false);
    }
  };

  const handleRevokeAll = async () => {
    if (revoking) return;
    setRevoking(true);
    try {
      await onRevokeAllSessions();
    } finally {
      setRevoking(false);
    }
  };

  if (!open) return null;

  const fieldInput = "h-[30px] w-[120px] rounded-[7px] border border-divider-strong bg-surface px-2 text-[12.5px] text-fg outline-none max-md:w-full";
  const selectInput = "h-[30px] w-[180px] rounded-[7px] border border-divider-strong bg-surface px-2 text-[12.5px] text-fg outline-none max-md:w-full";

  return (
    <>
    <div className="fixed inset-0 z-[100] grid animate-overlay-in place-items-center bg-[rgba(20,18,15,0.45)] p-6 backdrop-blur-[4px] motion-reduce:animate-none max-md:p-0" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="grid h-[540px] max-h-full w-[760px] max-w-full animate-pop-in grid-cols-[200px_1fr] overflow-hidden rounded-[16px] border-[0.5px] border-divider-strong bg-surface shadow-e3 motion-reduce:animate-none max-md:h-full max-md:max-h-none max-md:w-full max-md:grid-cols-1 max-md:grid-rows-[auto_1fr] max-md:rounded-none max-md:border-0"
      >
        {/* Side nav */}
        <div className="flex flex-col gap-0.5 border-r-[0.5px] border-divider bg-bg-2 p-[16px_10px] max-md:flex-row max-md:overflow-x-auto max-md:border-b-[0.5px] max-md:border-r-0 max-md:p-[8px_10px] max-md:[scrollbar-width:none]">
          <div className="px-2.5 pb-3 pt-1 text-[11px] font-bold uppercase tracking-[0.06em] text-muted-2 max-md:hidden">{t.modals.settingsTitle}</div>
          {NAV.map((s) => (
            <button
              key={s.id}
              onClick={() => setSection(s.id)}
              className={cn(
                "flex items-center gap-2.5 rounded-[7px] px-2.5 py-[7px] text-left text-[13px] max-md:shrink-0 max-md:whitespace-nowrap max-md:px-3 max-md:text-[12.5px]",
                s.id === section ? "bg-surface font-medium text-fg shadow-e1" : "bg-transparent text-fg-2 hover:bg-divider",
              )}
            >
              <span className="inline-flex">
                <Icon name={s.icon} size={13} />
              </span>
              {s.label}
            </button>
          ))}
        </div>

        {/* Main */}
        <div className="grid min-h-0 grid-rows-[auto_1fr]">
          <div className="flex items-center justify-between border-b-[0.5px] border-divider px-6 pb-3 pt-[18px] max-md:px-4 max-md:pt-3.5">
            <h2 className="m-0 text-[17px] font-bold tracking-[-0.01em] max-md:text-[16px]">{TITLES[section]}</h2>
            <button className="grid h-7 w-7 place-items-center rounded-[7px] border-0 bg-transparent text-muted hover:bg-divider hover:text-fg" onClick={onClose} aria-label={t.common.close}>
              <svg viewBox="0 0 16 16" width="13" height="13">
                <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          <div className="overflow-y-auto px-6 pb-6 pt-[18px] max-md:px-4">
            {section === "model" && (
              <div className="flex flex-col gap-1.5">
                {models.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => onModelChange(m)}
                    className={cn(
                      "flex items-start gap-3 rounded-[10px] border p-3 text-left transition-colors",
                      m.id === model.id ? "border-accent bg-accent-soft" : "border-divider-strong bg-surface hover:bg-surface-2",
                    )}
                  >
                    <span className={cn("mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border-[1.5px]", m.id === model.id ? "border-accent" : "border-divider-strong")}>
                      {m.id === model.id && <span className="h-2 w-2 rounded-full bg-accent" />}
                    </span>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 text-[13px] font-semibold">
                        {m.label}
                        {m.tag && <span className="rounded border-[0.5px] border-accent px-1.5 py-px text-[9.5px] font-semibold tracking-[0.02em] text-accent">{m.tag}</span>}
                      </div>
                      <div className="mt-0.5 text-[11.5px] text-muted">{m.desc}</div>
                    </div>
                  </button>
                ))}
                <div className="mt-3.5 rounded-lg border-[0.5px] border-divider bg-surface-2 px-3 py-2.5 text-[11.5px] leading-[1.55] text-muted">
                  {t.modals.modelPrivacyNote}
                </div>
              </div>
            )}

            {section === "sources" && (
              <div className="flex flex-col gap-1.5">
                {CONNECTORS.map((s) => (
                  <div key={s.name} className="flex items-center gap-3 rounded-[10px] border border-divider-strong bg-surface px-3 py-2.5">
                    <span className="inline-flex w-[18px] items-center justify-center">
                      <Icon name={s.icon} size={16} />
                    </span>
                    <div className="flex-1">
                      <div className="text-[13px] font-semibold">{s.name}</div>
                      <div className="font-mono text-[11px] text-muted">{s.desc}</div>
                    </div>
                    <Switch
                      on={connectors[s.name]}
                      onToggle={() => setConnectors((c) => ({ ...c, [s.name]: !c[s.name] }))}
                      label={s.name}
                    />
                  </div>
                ))}
              </div>
            )}

            {section === "agent" && (
              <div className="flex flex-col gap-3.5">
                <Field label={t.modals.agentMaxStepsLabel} hint={t.modals.agentMaxStepsHint}>
                  <input
                    type="number"
                    min={1}
                    value={agentCfg.maxSteps}
                    onChange={(e) => setAgentCfg("maxSteps", Number(e.target.value))}
                    className={fieldInput}
                  />
                </Field>
                <Field label={t.modals.agentParallelToolsLabel} hint={t.modals.agentParallelToolsHint}>
                  <input
                    type="number"
                    min={1}
                    value={agentCfg.parallelTools}
                    onChange={(e) => setAgentCfg("parallelTools", Number(e.target.value))}
                    className={fieldInput}
                  />
                </Field>
                <Field label={t.modals.agentTopKLabel} hint={t.modals.agentTopKHint}>
                  <input
                    type="number"
                    min={TOP_K_MIN}
                    max={TOP_K_MAX}
                    value={agentCfg.topK}
                    onChange={(e) => setAgentCfg("topK", Number(e.target.value))}
                    className={fieldInput}
                  />
                </Field>
                <Field label={t.modals.agentCandidateKLabel} hint={t.modals.agentCandidateKHint}>
                  <input
                    type="number"
                    min={CANDIDATE_K_MIN}
                    max={CANDIDATE_K_MAX}
                    value={agentCfg.candidateK}
                    onChange={(e) => setAgentCfg("candidateK", Number(e.target.value))}
                    className={fieldInput}
                  />
                </Field>
                <Field label={t.modals.agentRequireCitationsLabel} hint={t.modals.agentRequireCitationsHint}>
                  <Switch
                    on={agentCfg.requireCitations}
                    onToggle={() => setAgentCfg("requireCitations", !agentCfg.requireCitations)}
                    label={t.modals.agentRequireCitationsLabel}
                  />
                </Field>
                <Field label={t.modals.agentAdmitUnknownLabel}>
                  <Switch
                    on={agentCfg.admitUnknown}
                    onToggle={() => setAgentCfg("admitUnknown", !agentCfg.admitUnknown)}
                    label={t.modals.agentAdmitUnknownLabel}
                  />
                </Field>
              </div>
            )}

            {section === "appearance" && (
              <div className="flex flex-col gap-3.5">
                <Field label={t.modals.appearanceDarkModeLabel} hint={t.modals.appearanceDarkModeHint}>
                  <Switch on={tweaks.dark} onToggle={() => setTweak("dark", !tweaks.dark)} label={t.modals.appearanceDarkModeLabel} />
                </Field>

                <div className="rounded-[10px] border-[0.5px] border-divider bg-surface-2 px-3 py-2.5">
                  <label className="text-[12.5px] font-semibold text-fg-2">{t.modals.appearanceAccentColorLabel}</label>
                  <div className="mt-2 flex gap-1.5">
                    {ACCENT_PRESETS.map((c) => {
                      const on = tweaks.accent.toLowerCase() === c.toLowerCase();
                      return (
                        <button
                          key={c}
                          type="button"
                          aria-label={c}
                          onClick={() => setTweak("accent", c)}
                          style={{ background: c }}
                          className={cn(
                            "relative h-[42px] flex-1 rounded-lg transition-transform hover:-translate-y-px",
                            on
                              ? "shadow-[0_0_0_1.5px_rgba(0,0,0,0.85),0_2px_6px_rgba(0,0,0,0.15)]"
                              : "shadow-[0_0_0_0.5px_rgba(0,0,0,0.12),0_1px_2px_rgba(0,0,0,0.06)]",
                          )}
                        >
                          {on && (
                            <svg viewBox="0 0 14 14" className="absolute left-2 top-2 h-3.5 w-3.5 drop-shadow" aria-hidden>
                              <path d="M3 7.2 5.8 10 11 4.2" fill="none" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" stroke="#fff" />
                            </svg>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <Field label={t.modals.appearanceToolViewLabel} hint={t.modals.appearanceToolViewHint}>
                  <select
                    value={tweaks.toolView}
                    onChange={(e) => setTweak("toolView", e.target.value as Tweaks["toolView"])}
                    className={selectInput}
                  >
                    <option value="card">{t.modals.appearanceToolViewCard}</option>
                    <option value="timeline">{t.modals.appearanceToolViewTimeline}</option>
                    <option value="log">{t.modals.appearanceToolViewLog}</option>
                  </select>
                </Field>

                <Field label={t.modals.appearanceDensityLabel}>
                  <Segmented
                    value={tweaks.density}
                    options={[
                      { value: "compact", label: t.modals.appearanceDensityCompact },
                      { value: "comfy", label: t.modals.appearanceDensityComfy },
                    ]}
                    onChange={(v) => setTweak("density", v as Tweaks["density"])}
                  />
                </Field>

                <Field label={t.modals.appearanceCitationStyleLabel}>
                  <select
                    value={tweaks.citationStyle}
                    onChange={(e) => setTweak("citationStyle", e.target.value as Tweaks["citationStyle"])}
                    className={selectInput}
                  >
                    <option value="numbered">{t.modals.appearanceCitationStyleNumbered}</option>
                    <option value="chip">{t.modals.appearanceCitationStyleChip}</option>
                    <option value="pill">{t.modals.appearanceCitationStylePill}</option>
                  </select>
                </Field>
              </div>
            )}

            {section === "security" && (
              <div className="flex flex-col gap-3.5">
                <div className="rounded-[10px] border-[0.5px] border-divider bg-surface-2 p-3">
                  <div className="mb-2 flex items-center justify-between font-mono text-[11.5px] text-muted">
                    <span>{t.modals.securityJwtTitle}</span>
                    <button
                      type="button"
                      onClick={copyJwt}
                      disabled={!claims}
                      className="border-0 bg-transparent font-mono text-[11px] font-semibold text-accent hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {jwtCopied ? t.modals.securityCopiedBtn : t.modals.securityCopyBtn}
                    </button>
                  </div>
                  <pre className="m-0 max-h-[180px] overflow-auto rounded-lg border-[0.5px] border-divider bg-code-bg px-3 py-2.5 font-mono text-[11px] leading-[1.6] text-fg-2">{claimsJson}</pre>
                </div>
                <Field label={t.modals.securityTokenExpiryLabel} hint={t.modals.securityTokenExpiryHint}>
                  <span className="font-mono text-[12px] text-muted">
                    {tokenExpiryDisplay}
                  </span>
                </Field>
                <Field
                  label={t.modals.securityRememberTokenLabel}
                  hint={t.modals.securityRememberTokenHint}
                >
                  <Switch
                    on={Boolean(claims?.rem) && !rememberPending}
                    onToggle={handleRememberToggle}
                    label={t.modals.securityRememberTokenLabel}
                  />
                </Field>
                <button
                  type="button"
                  onClick={handleRevokeAll}
                  disabled={revoking || !claims}
                  className="h-8 self-start rounded-lg border-[0.5px] border-[#B83A1F] bg-transparent px-3.5 text-[12px] font-medium text-[#B83A1F] hover:bg-[#B83A1F] hover:text-white disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent disabled:hover:text-[#B83A1F]"
                >
                  {revoking ? t.modals.securityRevokingBtn : t.modals.securityRevokeAllBtn}
                </button>
              </div>
            )}

            {section === "account" && (
              <div className="flex flex-col gap-3.5">
                <div className="mb-1 flex items-center gap-3.5">
                  <div className="grid h-12 w-12 place-items-center rounded-full bg-accent text-[16px] font-semibold text-white">{user.initials}</div>
                  <div>
                    <div className="text-[14.5px] font-semibold">{user.name}</div>
                    <div className="font-mono text-[11.5px] text-muted">{user.email}</div>
                  </div>
                </div>
                <Field label={t.modals.accountDisplayNameLabel}>
                  <input
                    type="text"
                    value={nameDraft}
                    onChange={(e) => setNameDraft(e.target.value)}
                    onBlur={commitName}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        e.currentTarget.blur();
                      }
                    }}
                    disabled={nameSaving}
                    maxLength={80}
                    className={cn(fieldInput, "disabled:opacity-60")}
                  />
                </Field>
                <Field label={t.modals.accountLanguageLabel} hint={t.modals.languageHint}>
                  <select
                    value={locale}
                    onChange={(e) => onLocaleSelect(e.target.value as Locale)}
                    className={fieldInput}
                  >
                    {LOCALES.map((l) => (
                      <option key={l} value={l}>{LOCALE_LABELS[l]}</option>
                    ))}
                  </select>
                </Field>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
    {/* 言語切替確認ダイアログ */}
    {dialog}
    </>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-x-3.5 gap-y-1.5 rounded-[10px] border-[0.5px] border-divider bg-surface-2 px-3 py-2.5 max-md:grid-cols-1">
      <label className="text-[12.5px] font-semibold text-fg-2">{label}</label>
      <div className="max-md:justify-self-start">{children}</div>
      {hint && <div className="col-span-full mt-0.5 text-[11px] text-muted">{hint}</div>}
    </div>
  );
}
