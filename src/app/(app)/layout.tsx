import type { ReactNode } from "react";
import { AppProvider } from "@/components/app/AppContext";
import { AppShell } from "@/components/app/AppShell";
import { ToastProvider } from "@/components/ui/Toast";
import { loadPage } from "@/server/page";
import { listClients, listContacts, listProjects } from "@/server/services/clients";
import { serverConfig } from "@/server/env";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  let data;
  try {
    data = await loadPage(async ({ tx, profile, email, now }) => {
      const [clients, projects, contacts, counts] = await Promise.all([
        listClients(tx),
        listProjects(tx),
        listContacts(tx),
        tx`select count(*) filter (where status = 'inbox')::int as inbox, count(*) filter (where status = 'waiting_on')::int as waiting
             from ft.tasks where deleted_at is null`,
      ]);
      return { profile, email, now, clients, projects, contacts, counts: counts[0] as unknown as { inbox: number; waiting: number } };
    });
  } catch (err: unknown) {
    // Re-throw Next.js navigation / redirect errors (e.g. requireUser -> /login)
    if (typeof err === "object" && err !== null && "digest" in err && String((err as { digest: unknown }).digest).startsWith("NEXT_REDIRECT")) {
      throw err;
    }
    const message = err instanceof Error ? err.message : String(err);
    return (
      <main className="mx-auto max-w-xl px-4 py-12 text-text">
        <div className="rounded-2xl border border-danger/30 bg-surface p-6 shadow-sm">
          <div className="flex items-center gap-2 text-danger">
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <h1 className="text-xl font-semibold">Database Connection or Schema Error</h1>
          </div>
          <p className="mt-3 text-sm text-muted">
            The application could not load data from the database.
          </p>
          <div className="mt-4 rounded-lg bg-surface-2 p-3 font-mono text-xs text-danger break-all border border-border">
            {message}
          </div>
          <div className="mt-4 text-xs text-muted space-y-2">
            <p className="font-semibold text-text">How to fix this:</p>
            <ul className="list-disc pl-5 space-y-1.5">
              <li>
                <strong>Run Database Migrations:</strong> In the Supabase Dashboard, open <strong>SQL Editor → New query</strong>, then copy and run:
                <ul className="list-circle pl-4 mt-1 space-y-1 font-mono text-[11px]">
                  <li>supabase/migrations/20261026000001_schema.sql</li>
                  <li>supabase/migrations/20261026000002_security_and_queue.sql</li>
                </ul>
              </li>
              <li>
                <strong>Check DATABASE_URL in Vercel:</strong> In Vercel Project Settings → Environment Variables, verify <code>DATABASE_URL</code> is set to the Supabase <em>Transaction pooler</em> string (port <strong>6543</strong>) with your real database password.
              </li>
              <li>
                <strong>Password Encoding:</strong> If your database password contains special characters (e.g. <code>@</code>, <code>#</code>, <code>!</code>, <code>$</code>), ensure they are URL-encoded.
              </li>
            </ul>
          </div>
          <div className="mt-6 flex flex-wrap gap-3">
            <a href="/today" className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover transition-colors">
              Retry
            </a>
            <a href="/setup" className="rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium text-text hover:bg-surface-2 transition-colors">
              Check Setup Status
            </a>
          </div>
        </div>
      </main>
    );
  }

  const { profile } = data;
  return (
    <AppProvider
      nowIso={data.now.toISOString()}
      data={{
        prefs: profile,
        isDemo: profile.isDemo,
        email: data.email,
        clients: data.clients.map((c) => ({ id: c.id, name: c.name })),
        projects: data.projects.map((p) => ({ id: p.id, name: p.name, clientId: p.clientId })),
        contacts: data.contacts.map((c) => ({ id: c.id, name: c.name, clientId: c.clientId })),
        vapidPublicKey: serverConfig().vapidPublicKey,
      }}
    >
      <ToastProvider>
        <AppShell counts={data.counts}>{children}</AppShell>
      </ToastProvider>
    </AppProvider>
  );
}
