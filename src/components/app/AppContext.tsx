"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Prefs } from "@/lib/domain/types";

export interface Option {
  id: string;
  name: string;
  clientId?: string | null;
}

export interface AppData {
  prefs: Prefs;
  isDemo: boolean;
  email: string | null;
  clients: Option[];
  projects: Option[];
  contacts: Option[];
  vapidPublicKey: string | null;
}

const Ctx = createContext<AppData | null>(null);
const NowCtx = createContext<Date>(new Date(0));

export function AppProvider({ data, nowIso, children }: { data: AppData; nowIso: string; children: ReactNode }) {
  // Start from the server's clock so server and client render identical labels,
  // then tick every minute so "due in…" labels stay current.
  const [now, setNow] = useState(() => new Date(nowIso));
  useEffect(() => {
    const first = setTimeout(() => setNow(new Date()), 0);
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [nowIso]);
  return (
    <Ctx.Provider value={data}>
      <NowCtx.Provider value={now}>{children}</NowCtx.Provider>
    </Ctx.Provider>
  );
}

export function useApp(): AppData {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp outside AppProvider");
  return v;
}

export function useNow(): Date {
  return useContext(NowCtx);
}
