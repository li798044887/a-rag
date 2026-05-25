"use client";

import { useCallback, useEffect, useState } from "react";
import type { AppUser } from "@/lib/types";

type Status = "loading" | "authed" | "guest";

/** Client auth: checks the session cookie on mount, exposes sign in/out. */
export function useAuth() {
  const [user, setUser] = useState<AppUser | null>(null);
  const [status, setStatus] = useState<Status>("loading");

  useEffect(() => {
    let active = true;
    fetch("/api/auth/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!active) return;
        if (data?.user) {
          setUser(data.user);
          setStatus("authed");
        } else {
          setStatus("guest");
        }
      })
      .catch(() => active && setStatus("guest"));
    return () => {
      active = false;
    };
  }, []);

  const signIn = useCallback(async (input: { email: string; password: string; remember: boolean }) => {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!res.ok) throw new Error("login failed");
    const data = (await res.json()) as { user: AppUser };
    setUser(data.user);
    setStatus("authed");
  }, []);

  const register = useCallback(async (input: { email: string; password: string; name: string }) => {
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!res.ok) throw new Error("register failed");
    const data = (await res.json()) as { user: AppUser };
    setUser(data.user);
    setStatus("authed");
  }, []);

  const signOut = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    setUser(null);
    setStatus("guest");
  }, []);

  return { user, status, signIn, register, signOut };
}
