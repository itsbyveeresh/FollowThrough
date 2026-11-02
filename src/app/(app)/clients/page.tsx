import Link from "next/link";
import type { Metadata } from "next";
import { loadPage } from "@/server/page";
import { listClients, listContacts, listProjects } from "@/server/services/clients";
import { listOpenTasks } from "@/server/services/tasks";
import { EmptyState, PageHeader } from "@/components/app/PageHeader";
import { AddEntityButton } from "@/components/clients/Editors";
import { lacksNextAction } from "@/components/clients/Overview";
import { isOverdue } from "@/lib/domain/today";
import type { TaskView } from "@/server/services/model";

export const metadata: Metadata = { title: "Clients" };

type Tab = "clients" | "projects" | "people";

export default async function ClientsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const tab: Tab = sp.tab === "projects" || sp.tab === "people" ? sp.tab : "clients";
  const showArchived = sp.archived === "1";
  const d = await loadPage(async ({ tx, profile, now }) => ({
    clients: await listClients(tx, showArchived),
    projects: await listProjects(tx, showArchived),
    contacts: await listContacts(tx, showArchived),
    tasks: await listOpenTasks(tx),
    profile,
    now,
  }));
  const stats = (pick: (t: TaskView) => boolean) => {
    const open = d.tasks.filter(pick);
    return {
      open: open.length,
      waiting: open.filter((t) => t.status === "waiting_on").length,
      overdue: open.filter((t) => isOverdue(t, d.now, d.profile.timezone)).length,
      noNext: lacksNextAction(open),
    };
  };
  const rows =
    tab === "clients"
      ? d.clients.map((c) => ({ id: c.id, href: `/clients/${c.id}`, name: c.name, sub: null as string | null, archived: !!c.archivedAt, s: stats((t) => t.clientId === c.id) }))
      : tab === "projects"
        ? d.projects.map((p) => ({ id: p.id, href: `/projects/${p.id}`, name: p.name, sub: p.clientName, archived: !!p.archivedAt, s: stats((t) => t.projectId === p.id) }))
        : d.contacts.map((c) => ({ id: c.id, href: `/people/${c.id}`, name: c.name, sub: c.clientName ?? c.email, archived: !!c.archivedAt, s: stats((t) => t.contactId === c.id) }));

  return (
    <>
      <PageHeader
        title="Clients & projects"
        actions={<AddEntityButton kind={tab === "clients" ? "client" : tab === "projects" ? "project" : "person"} label={tab === "clients" ? "Add client" : tab === "projects" ? "Add project" : "Add person"} />}
      />
      <nav aria-label="Sections" className="mb-4 flex flex-wrap gap-2">
        {(["clients", "projects", "people"] as const).map((t) => (
          <Link
            key={t}
            href={`/clients?tab=${t}${showArchived ? "&archived=1" : ""}`}
            aria-current={tab === t ? "page" : undefined}
            className="rounded-full border border-border px-3.5 py-1.5 text-sm capitalize hover:bg-surface-2 aria-[current=page]:border-accent aria-[current=page]:bg-accent-soft aria-[current=page]:font-medium"
          >
            {t}
          </Link>
        ))}
        <Link href={`/clients?tab=${tab}${showArchived ? "" : "&archived=1"}`} className="ml-auto self-center text-sm text-muted underline">
          {showArchived ? "Hide archived" : "Show archived"}
        </Link>
      </nav>
      {rows.length === 0 ? (
        <EmptyState title={`No ${tab} yet`}>You can also add them while creating a task.</EmptyState>
      ) : (
        <ul className="overflow-hidden rounded-xl border border-border bg-surface">
          {rows.map((r) => (
            <li key={r.id} className="border-b border-border last:border-b-0">
              <Link href={r.href} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-surface-2">
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{r.name}</span>
                  {r.archived ? <span className="ml-2 text-xs text-muted">(archived)</span> : null}
                  {r.sub ? <span className="block truncate text-sm text-muted">{r.sub}</span> : null}
                </span>
                <span className="flex flex-wrap gap-3 text-sm text-muted">
                  <span>{r.s.open} open</span>
                  <span>{r.s.waiting} waiting</span>
                  {r.s.overdue ? <span className="font-medium text-danger">{r.s.overdue} overdue</span> : null}
                  {r.s.noNext ? <span className="text-warn">No next action</span> : null}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
