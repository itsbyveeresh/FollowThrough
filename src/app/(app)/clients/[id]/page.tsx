import Link from "next/link";
import { loadPage } from "@/server/page";
import { getClient, listContacts, listProjects, recentActivity } from "@/server/services/clients";
import { searchTasks } from "@/server/services/tasks";
import { EmptyState, PageHeader } from "@/components/app/PageHeader";
import { AddEntityButton, EditEntityButton } from "@/components/clients/Editors";
import { Overview } from "@/components/clients/Overview";

export default async function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await loadPage(async ({ tx, profile, now }) => {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    const client = await getClient(tx, id);
    if (!client) return null;
    return {
      client,
      projects: (await listProjects(tx, true)).filter((p) => p.clientId === id),
      people: (await listContacts(tx, true)).filter((c) => c.clientId === id),
      tasks: await searchTasks(tx, { clientId: id }, now, profile.timezone),
      activity: await recentActivity(tx, { clientId: id }),
      profile,
      now,
    };
  });
  if (!d) return <EmptyState title="Client not found" />;
  return (
    <>
      <PageHeader
        title={d.client.name}
        subtitle={d.client.archivedAt ? "Archived client" : "Client"}
        actions={
          <>
            <EditEntityButton kind="client" id={d.client.id} initial={{ name: d.client.name, notes: d.client.notes ?? "" }} archived={!!d.client.archivedAt} />
            <Link href={`/tasks?client=${d.client.id}&status=all`} className="inline-flex min-h-9 items-center rounded-lg border border-border px-3 text-sm hover:bg-surface-2">
              All tasks
            </Link>
          </>
        }
      />
      {d.client.notes ? <p className="mb-5 whitespace-pre-wrap text-sm">{d.client.notes}</p> : null}
      <div className="mb-6 grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-border bg-surface p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-semibold">Projects</h2>
            <AddEntityButton kind="project" label="Add project" clientId={d.client.id} />
          </div>
          {d.projects.length ? (
            <ul className="text-sm">
              {d.projects.map((p) => (
                <li key={p.id}>
                  <Link className="text-accent hover:underline" href={`/projects/${p.id}`}>
                    {p.name}
                  </Link>
                  {p.archivedAt ? <span className="text-muted"> (archived)</span> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">No projects.</p>
          )}
        </div>
        <div className="rounded-xl border border-border bg-surface p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-semibold">People</h2>
            <AddEntityButton kind="person" label="Add person" clientId={d.client.id} />
          </div>
          {d.people.length ? (
            <ul className="text-sm">
              {d.people.map((c) => (
                <li key={c.id}>
                  <Link className="text-accent hover:underline" href={`/people/${c.id}`}>
                    {c.name}
                  </Link>
                  {c.email ? <span className="text-muted"> · {c.email}</span> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">No people.</p>
          )}
        </div>
      </div>
      <Overview tasks={d.tasks} activity={d.activity} prefs={d.profile} now={d.now} />
    </>
  );
}
