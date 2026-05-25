"use client";

import { useState } from "react";

type Mode = "signin" | "signup" | "reset";

interface LoginProps {
  onSignIn: (input: { email: string; remember: boolean }) => Promise<void> | void;
}

export function Login({ onSignIn }: LoginProps) {
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("hiroshi.tanaka@arag.dev");
  const [password, setPassword] = useState("••••••••••");
  const [remember, setRemember] = useState(true);
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (mode === "signin") {
        await onSignIn({ email, remember });
      } else {
        // Simulated signup/reset round-trip → back to sign-in.
        await new Promise((r) => setTimeout(r, 700));
        setMode("signin");
      }
    } catch {
      setError("サインインに失敗しました。もう一度お試しください。");
    } finally {
      setBusy(false);
    }
  };

  const fieldCls =
    "h-[42px] rounded-[10px] border border-divider-strong bg-surface-2 px-[14px] text-[14px] text-fg outline-none transition-[border-color,box-shadow,background] duration-100 focus:border-accent focus:bg-surface focus:shadow-[0_0_0_3px_var(--accent-soft)]";

  return (
    <div className="grid min-h-screen w-full place-items-center overflow-hidden bg-bg relative">
      {/* Backdrop: blurred accent glows + faint grid */}
      <div className="pointer-events-none absolute inset-0 text-divider" aria-hidden>
        <div
          className="absolute inset-0 opacity-60 blur-[40px]"
          style={{
            background:
              "radial-gradient(circle at 30% 30%, color-mix(in srgb, var(--accent) 30%, transparent), transparent 60%)",
          }}
        />
        <div
          className="absolute inset-0 left-[40%] opacity-60 blur-[40px]"
          style={{
            background: "radial-gradient(circle at 70% 70%, var(--accent-alt-glow), transparent 60%)",
          }}
        />
        <svg className="absolute inset-0 h-full w-full opacity-50" aria-hidden>
          <defs>
            <pattern id="login-grid" width="48" height="48" patternUnits="userSpaceOnUse">
              <path d="M48 0H0V48" fill="none" stroke="currentColor" strokeWidth="0.5" opacity="0.5" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#login-grid)" />
        </svg>
      </div>

      <div className="relative flex w-[420px] max-w-[calc(100vw-48px)] flex-col rounded-[18px] border border-divider-strong bg-surface px-10 pb-7 pt-10 shadow-e3">
        {/* Brand */}
        <div className="mb-8 flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-[10px] bg-accent text-white shadow-[0_2px_6px_var(--accent-glow)]">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
              <path d="M4 6c0-1.1.9-2 2-2h8l6 6v8c0 1.1-.9 2-2 2H6c-1.1 0-2-.9-2-2V6z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
              <circle cx="12" cy="13" r="3" fill="none" stroke="currentColor" strokeWidth="1.8" />
              <path d="M14.2 15.2 16 17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </div>
          <div>
            <div className="text-[17px] font-bold tracking-[-0.01em] text-fg">ARag</div>
            <div className="text-[11px] text-muted">社内ナレッジ・エージェント</div>
          </div>
        </div>

        <h1 className="m-0 mb-1.5 text-[26px] font-bold tracking-[-0.02em] text-fg">
          {mode === "signin" && "おかえりなさい"}
          {mode === "signup" && "アカウント作成"}
          {mode === "reset" && "パスワードリセット"}
        </h1>
        <p className="m-0 mb-7 text-[14px] leading-[1.5] text-muted">
          {mode === "signin" && "社内SSOまたはメールでサインインしてください"}
          {mode === "signup" && "7日間の無料トライアル・クレジットカード不要"}
          {mode === "reset" && "リセット用のリンクをメールで送信します"}
        </p>

        <form onSubmit={submit} className="flex flex-col gap-[14px]">
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-semibold text-fg-2">メールアドレス</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              autoComplete="email"
              required
              className={fieldCls}
            />
          </label>

          {mode !== "reset" && (
            <label className="flex flex-col gap-1.5">
              <span className="flex items-baseline justify-between text-[12px] font-semibold text-fg-2">
                パスワード
                {mode === "signin" && (
                  <a
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      setMode("reset");
                    }}
                    className="text-[12px] font-medium text-accent no-underline hover:underline"
                  >
                    お忘れですか？
                  </a>
                )}
              </span>
              <div className="relative">
                <input
                  type={showPw ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="8文字以上"
                  autoComplete={mode === "signin" ? "current-password" : "new-password"}
                  required
                  className={`${fieldCls} w-full pr-[38px]`}
                />
                <button
                  type="button"
                  onClick={() => setShowPw(!showPw)}
                  aria-label={showPw ? "隠す" : "表示"}
                  className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-md border-0 bg-transparent text-muted hover:bg-divider hover:text-fg"
                >
                  {showPw ? (
                    <svg viewBox="0 0 24 24" width="16" height="16">
                      <path d="M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8M9.4 4.6A9.5 9.5 0 0112 4.5c5 0 9 4 10 7.5-.5 1.4-1.5 3-2.9 4.4M6.1 6.1C4 7.5 2.5 9.7 2 12c1 3.5 5 7.5 10 7.5a9.5 9.5 0 004.6-1.1" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" width="16" height="16">
                      <path d="M2 12s4-7.5 10-7.5S22 12 22 12s-4 7.5-10 7.5S2 12 2 12z" stroke="currentColor" strokeWidth="1.6" fill="none" />
                      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.6" fill="none" />
                    </svg>
                  )}
                </button>
              </div>
            </label>
          )}

          {mode === "signin" && (
            <label className="flex cursor-pointer items-center gap-2 text-[12px] text-muted">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                className="accent-[var(--accent)]"
              />
              <span>
                このデバイスを記憶する{" "}
                <em className="font-mono text-[10.5px] not-italic text-muted-2">
                  (JWT refresh token を 30日間保存)
                </em>
              </span>
            </label>
          )}

          {error && (
            <div className="rounded-lg border-[0.5px] border-[#F0CFC4] bg-[#FDF0EC] px-3 py-2.5 text-[12px] text-[#B83A1F]">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="mt-1.5 inline-flex h-11 items-center justify-center gap-2 rounded-[10px] border-0 bg-accent text-[14px] font-semibold text-white shadow-[0_1px_3px_var(--accent-glow),inset_0_1px_0_rgba(255,255,255,0.15)] transition-[filter,transform] duration-100 hover:brightness-105 active:translate-y-px disabled:cursor-progress disabled:opacity-70"
          >
            {busy && (
              <span className="h-3.5 w-3.5 animate-[ar-spin_0.8s_linear_infinite] rounded-full border-2 border-white/40 border-t-white" />
            )}
            {busy
              ? mode === "signin"
                ? "JWTを発行中…"
                : mode === "signup"
                  ? "作成中…"
                  : "送信中…"
              : mode === "signin"
                ? "サインイン"
                : mode === "signup"
                  ? "アカウントを作成"
                  : "リセットリンクを送信"}
          </button>

          {mode === "signin" && (
            <>
              <div className="mt-[14px] mb-1 flex items-center gap-2.5 text-[11px] text-muted before:h-0 before:flex-1 before:border-t-[0.5px] before:border-divider-strong after:h-0 after:flex-1 after:border-t-[0.5px] after:border-divider-strong">
                または
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => submit()}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-[10px] border border-divider-strong bg-surface text-[13px] font-medium text-fg hover:bg-surface-2"
                >
                  <svg viewBox="0 0 24 24" width="16" height="16">
                    <path d="M21.8 10.2H12v3.9h5.6c-.5 2.6-2.7 4.4-5.6 4.4-3.4 0-6.1-2.8-6.1-6.1S8.6 6.3 12 6.3c1.5 0 2.9.6 4 1.6l2.8-2.8C16.9 3.4 14.6 2.5 12 2.5 6.7 2.5 2.5 6.7 2.5 12s4.2 9.5 9.5 9.5c5.5 0 9.1-3.9 9.1-9.3 0-.7-.1-1.3-.3-2z" fill="currentColor" />
                  </svg>
                  Google Workspace
                </button>
                <button
                  type="button"
                  onClick={() => submit()}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-[10px] border border-divider-strong bg-surface text-[13px] font-medium text-fg hover:bg-surface-2"
                >
                  <svg viewBox="0 0 24 24" width="16" height="16">
                    <path d="M2 3h9.4v9.4H2V3zm10.6 0H22v9.4h-9.4V3zM2 13.6h9.4V23H2v-9.4zm10.6 0H22V23h-9.4v-9.4z" fill="currentColor" />
                  </svg>
                  Microsoft Entra ID
                </button>
              </div>
            </>
          )}
        </form>

        <div className="mt-[22px] text-center text-[13px] text-muted">
          {mode === "signin" && (
            <span>
              初めて？{" "}
              <a href="#" className="text-[12px] font-medium text-accent no-underline hover:underline" onClick={(e) => { e.preventDefault(); setMode("signup"); }}>
                サインアップ
              </a>
            </span>
          )}
          {mode === "signup" && (
            <span>
              既にアカウントがある？{" "}
              <a href="#" className="text-[12px] font-medium text-accent no-underline hover:underline" onClick={(e) => { e.preventDefault(); setMode("signin"); }}>
                サインイン
              </a>
            </span>
          )}
          {mode === "reset" && (
            <a href="#" className="text-[12px] font-medium text-accent no-underline hover:underline" onClick={(e) => { e.preventDefault(); setMode("signin"); }}>
              ← サインインに戻る
            </a>
          )}
        </div>

        <div className="mt-[22px] flex justify-center border-t-[0.5px] border-divider pt-[18px]">
          <div className="inline-flex items-center gap-1.5 font-mono text-[10.5px] tracking-[0.02em] text-muted-2">
            <svg viewBox="0 0 16 16" width="11" height="11">
              <path d="M8 1l5 2v4.5C13 11 10.5 14 8 15c-2.5-1-5-4-5-7.5V3l5-2z" stroke="currentColor" strokeWidth="1.2" fill="none" />
            </svg>
            JWT認証 · HS256 · 24h アクセストークン
          </div>
        </div>
      </div>
    </div>
  );
}
