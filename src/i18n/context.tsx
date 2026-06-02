"use client";

import { createContext, useContext } from "react";
import type { Locale } from "./config";
import type { Dictionary } from "./dictionary";

interface LocaleContextValue {
  locale: Locale;
  /** 解決済み辞書。t.common.cancel のように参照する。 */
  t: Dictionary;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({
  locale,
  dict,
  children,
}: {
  locale: Locale;
  dict: Dictionary;
  children: React.ReactNode;
}) {
  return (
    <LocaleContext.Provider value={{ locale, t: dict }}>
      {children}
    </LocaleContext.Provider>
  );
}

export function useT(): LocaleContextValue {
  const value = useContext(LocaleContext);
  if (!value) throw new Error("useT must be used within LocaleProvider");
  return value;
}
