"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

type Tone = "ok" | "error" | "info";
interface ToastAction {
  label: string;
  onClick: () => void;
}
interface Toast {
  id: number;
  message: string;
  tone: Tone;
  action?: ToastAction;
}

const ToastContext = createContext<(message: string, tone?: Tone, action?: ToastAction) => void>(() => {});

export function useToast() {
  return useContext(ToastContext);
}

/** Polite live region for confirmations that the server accepted a change. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((message: string, tone: Tone = "ok", action?: ToastAction) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-2), { id, message, tone, action }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === "error" || action ? 7000 : 3500);
  }, []);
  const tones: Record<Tone, string> = {
    ok: "border-ok/40 bg-surface",
    error: "border-danger/50 bg-danger-soft text-danger",
    info: "border-border bg-surface",
  };
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex flex-col items-center gap-2 px-4 lg:bottom-6">
        {toasts.map((t) => (
          <div key={t.id} role={t.tone === "error" ? "alert" : "status"} className={`pointer-events-auto max-w-md rounded-lg border px-4 py-2.5 text-sm shadow-lg ${tones[t.tone]}`}>
            {t.message}
            {t.action ? (
              <button
                type="button"
                className="ml-3 font-semibold text-accent underline underline-offset-2"
                onClick={() => {
                  t.action?.onClick();
                  setToasts((all) => all.filter((x) => x.id !== t.id));
                }}
              >
                {t.action.label}
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
