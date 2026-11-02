import Link from "next/link";
import type { ReactNode } from "react";

export const dynamic = "force-dynamic";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <Link href="/login" className="mb-6 flex items-center gap-2 text-xl font-semibold tracking-tight">
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-accent-contrast" aria-hidden="true">
          ✓
        </span>
        FollowThrough
      </Link>
      <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-6 shadow-sm">{children}</div>
      <p className="mt-6 max-w-sm text-center text-xs text-muted">Your follow-ups, waiting-on items and next actions — with reminders that arrive even when the app is closed.</p>
    </main>
  );
}
