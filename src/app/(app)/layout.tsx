import type { ReactNode } from "react";
import { AppProvider } from "@/components/app/AppContext";
import { AppShell } from "@/components/app/AppShell";
import { ToastProvider } from "@/components/ui/Toast";
import { loadPage } from "@/server/page";
import { listClients, listContacts, listProjects } from "@/server/services/clients";
import { serverConfig } from "@/server/env";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const data = await loadPage(async ({ tx, profile, email, now }) => {
    const [clients, projects, contacts, counts] = await Promise.all([
      listClients(tx),
      listProjects(tx),
      listContacts(tx),
      tx`select count(*) filter (where status = 'inbox')::int as inbox, count(*) filter (where status = 'waiting_on')::int as waiting
           from ft.tasks where deleted_at is null`,
    ]);
    return { profile, email, now, clients, projects, contacts, counts: counts[0] as unknown as { inbox: number; waiting: number } };
  });
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
