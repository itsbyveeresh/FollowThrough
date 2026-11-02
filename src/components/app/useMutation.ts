"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/action-result";
import { useToast } from "@/components/ui/Toast";

/**
 * Runs a server action and reports the outcome honestly: success is shown only
 * after the server confirms; network/offline failures say the change was not saved.
 * Resolves to true on success; the result data is passed to onSuccess.
 */
export function useMutation() {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  const run = useCallback(
    async <T,>(
      fn: () => Promise<ActionResult<T>>,
      opts: { success?: string; onSuccess?: (data: T) => void; undo?: { label: string; onClick: () => void } } = {},
    ): Promise<boolean> => {
      setBusy(true);
      setError(null);
      setFields({});
      let res: ActionResult<T>;
      try {
        res = await fn();
      } catch {
        res = {
          ok: false,
          error:
            typeof navigator !== "undefined" && !navigator.onLine
              ? "You're offline. Your change was not saved."
              : "Could not reach the server. Your change was not saved.",
        };
      }
      setBusy(false);
      if (!res.ok) {
        setError(res.error);
        setFields(res.fields ?? {});
        if (res.code === "not_authenticated") {
          router.push(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
        }
        return false;
      }
      if (opts.success) toast(opts.success, "ok", opts.undo);
      res.notices?.forEach((n) => toast(n, "info"));
      opts.onSuccess?.(res.data);
      router.refresh();
      return true;
    },
    [router, toast],
  );

  const reset = useCallback(() => {
    setError(null);
    setFields({});
  }, []);

  return { run, busy, error, fields, reset };
}
