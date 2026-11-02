"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Refresh server data when the app returns to the foreground and every few minutes while visible. */
export function AutoRefresh({ everyMs = 5 * 60_000 }: { everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && !document.querySelector("dialog[open]")) router.refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    const t = setInterval(onVisible, everyMs);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(t);
    };
  }, [router, everyMs]);
  return null;
}
