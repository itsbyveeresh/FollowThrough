"use client";

import { useEffect, useState } from "react";
import { reminderHealth, type HealthInput, type HealthItem } from "@/lib/health";
import { detectCapabilities, pushSupported, syncThisDevice } from "@/lib/push-client";
import { useNow } from "@/components/app/AppContext";

type ServerFacts = Omit<HealthInput, "now" | "browser">;

const TONE: Record<HealthItem["level"], string> = {
  ok: "border-ok/40 bg-ok-soft",
  info: "border-border bg-surface",
  warning: "border-warn/40 bg-warn-soft",
  problem: "border-danger/40 bg-danger-soft",
};
const MARK: Record<HealthItem["level"], string> = { ok: "✓", info: "i", warning: "!", problem: "✕" };

/** Plain-language reminder status for this account and this browser. */
export function HealthPanel({ facts }: { facts: ServerFacts }) {
  const now = useNow();
  const [browser, setBrowser] = useState<HealthInput["browser"]>();
  useEffect(() => {
    const t = setTimeout(() => {
      const c = detectCapabilities();
      const base = {
        supported: pushSupported(c),
        permission: c.permission,
        subscribedHere: false,
        registeredToThisAccount: false,
        standalone: c.standalone,
        iosNeedsInstall: c.ios && !c.standalone,
      };
      setBrowser(base);
      syncThisDevice()
        .then((s) => s && setBrowser({ ...base, subscribedHere: true, registeredToThisAccount: s.registered && s.enabled }))
        .catch(() => {});
    }, 0);
    return () => clearTimeout(t);
  }, []);
  const items = reminderHealth({ ...facts, now, browser });
  return (
    <ul className="flex flex-col gap-2" aria-live="polite">
      {items.map((i) => (
        <li key={i.id} className={`flex gap-3 rounded-lg border px-3 py-2 text-sm ${TONE[i.level]}`}>
          <span aria-hidden="true" className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface text-xs font-bold">
            {MARK[i.level]}
          </span>
          <span>
            <span className="font-medium">{i.title}</span>
            <span className="block text-muted">{i.detail}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
