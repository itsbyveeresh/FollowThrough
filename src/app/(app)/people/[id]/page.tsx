import Link from "next/link";
import { loadPage } from "@/server/page";
import { getContact, recentActivity } from "@/server/services/clients";
import { searchTasks } from "@/server/services/tasks";
import { EmptyState, PageHeader } from "@/components/app/PageHeader";
import { EditEntityButton } from "@/components/clients/Editors";
import { Overview } from "@/components/clients/Overview";

export default async function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await loadPage(async ({ tx, profile, now }) => {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    const person = await getContact(tx, id);
    if (!person) return null;
    return {
      person,
      tasks: await searchTasks(tx, { contactId: id }, now, profile.timezone),
      activity: await recentActivity(tx, { contactId: id }),
      profile,
      now,
    };
  });
  if (!d) return <EmptyState title="Person not found" />;
  const c = d.person;
  return (
    <>
      <PageHeader
        title={c.name}
        subtitle={
          <>
            {c.clientId ? (
              <Link className="text-accent hover:underline" href={`/clients/${c.clientId}`}>
                {c.clientName}
              </Link>
            ) : (
              "No client"
            )}
            {c.email ? (
              <>
                {" · "}
                <a className="hover:underline" href={`mailto:${c.email}`}>
                  {c.email}
                </a>
              </>
            ) : null}
            {c.phone ? (
              <>
                {" · "}
                <a className="hover:underline" href={`tel:${c.phone}`}>
                  {c.phone}
                </a>
              </>
            ) : null}
          </>
        }
        actions={
          <EditEntityButton
            kind="person"
            id={c.id}
            initial={{ name: c.name, notes: c.notes ?? "", clientId: c.clientId ?? "", email: c.email ?? "", phone: c.phone ?? "" }}
            archived={!!c.archivedAt}
          />
        }
      />
      {c.notes ? <p className="mb-5 whitespace-pre-wrap text-sm">{c.notes}</p> : null}
      <Overview tasks={d.tasks} activity={d.activity} prefs={d.profile} now={d.now} />
    </>
  );
}
