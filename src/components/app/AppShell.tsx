"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Icon, type IconName } from "@/components/ui/Icon";
import { Dialog } from "@/components/ui/Dialog";
import { TaskForm } from "@/components/tasks/TaskForm";
import { PushSessionGuard } from "@/components/pwa/PushSessionGuard";
import { useApp } from "./AppContext";

const NAV: { href: string; label: string; icon: IconName; mobile: boolean }[] = [
  { href: "/today", label: "Today", icon: "today", mobile: true },
  { href: "/inbox", label: "Inbox", icon: "inbox", mobile: true },
  { href: "/waiting", label: "Waiting On", icon: "waiting", mobile: true },
  { href: "/tasks", label: "All Tasks", icon: "tasks", mobile: true },
  { href: "/clients", label: "Clients", icon: "clients", mobile: false },
  { href: "/settings", label: "Settings", icon: "settings", mobile: false },
  { href: "/more", label: "More", icon: "more", mobile: true },
];

function isActive(pathname: string, href: string) {
  if (href === "/more") return ["/more", "/clients", "/settings", "/trash"].some((p) => pathname === p || pathname.startsWith(`${p}/`)) || /^\/(projects|people)\//.test(pathname);
  return pathname === href || pathname.startsWith(`${href}/`) || (href === "/clients" && /^\/(projects|people)\//.test(pathname));
}

function useOnline() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}

export function AppShell({ children, counts }: { children: ReactNode; counts: { inbox: number; waiting: number } }) {
  const pathname = usePathname();
  const { isDemo, email } = useApp();
  const [quickAdd, setQuickAdd] = useState(false);
  const online = useOnline();

  // Desktop shortcut: "n" or "q" opens quick add (ignored while typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName))) return;
      if (document.querySelector("dialog[open]")) return;
      if (e.key === "n" || e.key === "q") {
        e.preventDefault();
        setQuickAdd(true);
      } else if (e.key === "/") {
        const search = document.getElementById("task-search") as HTMLInputElement | null;
        if (search) {
          e.preventDefault();
          search.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const badge = (href: string) => (href === "/inbox" ? counts.inbox : href === "/waiting" ? counts.waiting : 0);

  return (
    <div className="min-h-dvh lg:flex">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2">
        Skip to content
      </a>
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-border bg-surface px-3 py-5 lg:flex">
        <Link href="/today" className="mb-6 flex items-center gap-2 px-2 text-lg font-semibold tracking-tight">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-accent-contrast">
            <Icon name="check" className="h-5 w-5" />
          </span>
          FollowThrough
        </Link>
        <button
          type="button"
          onClick={() => setQuickAdd(true)}
          className="mb-4 inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-accent px-4 font-medium text-accent-contrast hover:bg-accent-hover"
        >
          <Icon name="plus" /> Quick add
          <kbd className="ml-auto rounded border border-accent-contrast/40 px-1.5 text-xs opacity-80">N</kbd>
        </button>
        <nav aria-label="Main" className="flex flex-col gap-1">
          {NAV.filter((n) => n.href !== "/more").map((n) => (
            <Link
              key={n.href}
              href={n.href}
              aria-current={isActive(pathname, n.href) ? "page" : undefined}
              className="flex min-h-10 items-center gap-3 rounded-lg px-3 text-[0.95rem] text-muted hover:bg-surface-2 hover:text-text aria-[current=page]:bg-accent-soft aria-[current=page]:font-medium aria-[current=page]:text-text"
            >
              <Icon name={n.icon} />
              {n.label}
              {badge(n.href) ? <span className="ml-auto rounded-full bg-surface-2 px-2 text-xs text-muted">{badge(n.href)}</span> : null}
            </Link>
          ))}
          <Link
            href="/trash"
            aria-current={isActive(pathname, "/trash") ? "page" : undefined}
            className="flex min-h-10 items-center gap-3 rounded-lg px-3 text-[0.95rem] text-muted hover:bg-surface-2 hover:text-text aria-[current=page]:bg-accent-soft aria-[current=page]:text-text"
          >
            <Icon name="trash" /> Trash
          </Link>
        </nav>
        <p className="mt-auto truncate px-2 text-xs text-muted" title={email ?? undefined}>
          {email}
        </p>
      </aside>

      <div className="min-w-0 flex-1">
        {isDemo ? (
          <div className="border-b border-warn/40 bg-warn-soft px-4 py-2 text-center text-sm">
            <strong>Demo account</strong> — all clients and tasks are fictional. Mobile reminders are disabled for demo accounts.
          </div>
        ) : null}
        {!online ? (
          <div role="status" className="border-b border-danger/40 bg-danger-soft px-4 py-2 text-center text-sm text-danger">
            You&apos;re offline. Nothing can be saved until you reconnect. Server reminders keep running.
          </div>
        ) : null}
        <main id="main" className="mx-auto w-full max-w-4xl px-4 pb-32 pt-5 sm:px-6 lg:pb-12 lg:pt-8">
          {children}
        </main>
      </div>

      {/* Mobile: floating quick-add and bottom navigation */}
      <button
        type="button"
        onClick={() => setQuickAdd(true)}
        className="fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] right-4 z-30 inline-flex h-14 w-14 items-center justify-center rounded-full bg-accent text-accent-contrast shadow-lg hover:bg-accent-hover lg:hidden"
        aria-label="Quick add task"
      >
        <Icon name="plus" className="h-7 w-7" />
      </button>
      <nav aria-label="Main" className="safe-bottom fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface lg:hidden">
        <ul className="grid grid-cols-5">
          {NAV.filter((n) => n.mobile).map((n) => (
            <li key={n.href}>
              <Link
                href={n.href}
                aria-current={isActive(pathname, n.href) ? "page" : undefined}
                className="relative flex h-16 flex-col items-center justify-center gap-0.5 text-[0.7rem] text-muted aria-[current=page]:font-semibold aria-[current=page]:text-accent"
              >
                <Icon name={n.icon} className="h-6 w-6" />
                {n.label === "Waiting On" ? "Waiting" : n.label === "All Tasks" ? "Tasks" : n.label}
                {badge(n.href) ? (
                  <span className="absolute right-[22%] top-2 min-w-4 rounded-full bg-accent px-1 text-center text-[0.65rem] leading-4 text-accent-contrast">
                    {badge(n.href)}
                  </span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <Dialog open={quickAdd} onClose={() => setQuickAdd(false)} title="Quick add" description="Only a title is needed. Type dates naturally, e.g. “tomorrow at 11 AM”." wide>
        <TaskForm quick onDone={() => setQuickAdd(false)} />
      </Dialog>
      <PushSessionGuard />
    </div>
  );
}
