"use client";

import { useCallback, useEffect, useState } from "react";
import type { AppUser } from "@/lib/types";

type Status = "loading" | "authed" | "guest";

/** JWT のうち UI で扱う最小サブセット（/api/auth/me が返す形）。 */
export interface SessionClaims {
  sub: string;
  email: string;
  org: string;
  role: string;
  scopes: string[];
  iat: number | null;
  exp: number | null;
  iss: string | null;
  aud: string | string[] | null;
  rem: boolean;
}

interface MeResponse {
  user: AppUser | null;
  claims?: SessionClaims;
}

/** Client auth: checks the session cookie on mount, exposes sign in/out and session controls. */
export function useAuth() {
  const [user, setUser] = useState<AppUser | null>(null);
  const [claims, setClaims] = useState<SessionClaims | null>(null);
  const [status, setStatus] = useState<Status>("loading");

  const refresh = useCallback(async () => {
    const res = await fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null) as MeResponse | null;
    if (res?.user) {
      setUser(res.user);
      setClaims(res.claims ?? null);
      setStatus("authed");
    } else {
      setUser(null);
      setClaims(null);
      setStatus("guest");
    }
  }, []);

  useEffect(() => {
    let active = true;
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: MeResponse | null) => {
        if (!active) return;
        if (data?.user) {
          setUser(data.user);
          setClaims(data.claims ?? null);
          setStatus("authed");
        } else {
          setStatus("guest");
        }
      })
      .catch(() => active && setStatus("guest"));
    return () => { active = false; };
  }, []);

  const signIn = useCallback(async (input: { email: string; password: string; remember: boolean }) => {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!res.ok) throw new Error("login failed");
    await refresh();
  }, [refresh]);

  const register = useCallback(async (input: { email: string; password: string; name: string }) => {
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!res.ok) throw new Error("register failed");
    await refresh();
  }, [refresh]);

  const signOut = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    setUser(null);
    setClaims(null);
    setStatus("guest");
  }, []);

  /** 表示名をユーザーデータへ永続化し、アバター頭文字や挨拶も即時反映する。 */
  const updateName = useCallback(async (name: string) => {
    const res = await fetch("/api/account/name", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) throw new Error("update name failed");
    await refresh();
  }, [refresh]);

  /** "Refresh Token を保存" トグル。Cookie 永続化と JWT の rem クレームを切り替える。 */
  const setRemember = useCallback(async (value: boolean) => {
    const res = await fetch("/api/auth/remember", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value }),
    });
    if (!res.ok) throw new Error("remember failed");
    await refresh();
  }, [refresh]);

  /** 「全デバイスでサインアウト」。tokenRevokedAt を更新して自分の Cookie も破棄。 */
  const revokeAllSessions = useCallback(async () => {
    const res = await fetch("/api/auth/revoke-all", { method: "POST" });
    if (!res.ok) throw new Error("revoke failed");
    setUser(null);
    setClaims(null);
    setStatus("guest");
  }, []);

  return { user, claims, status, signIn, register, signOut, updateName, setRemember, revokeAllSessions };
}
