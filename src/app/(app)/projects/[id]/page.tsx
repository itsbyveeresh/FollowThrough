import Link from "next/link";
import { loadPage } from "@/server/page";
import { getProject, recentActivity } from "@/server/services/clients";
import { searchTasks } from "@/server/services/tasks";
import { EmptyState, PageHeader } from "@/components/app/PageHeader";
import { EditEntityButton } from "@/components/clients/Editors";
import { Overview } from "@/components/clients/Overview";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await loadPage(async ({ tx, profile, now }) => {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    const project = await getProject(tx, id);
    if (!project) return null;
    return {
      project,
      tasks: await searchTasks(tx, { projectId: id }, now, profile.timezone),
      activity: await recentActivity(tx, { projectId: id }),
      profile,
      now,
    };
  });
  if (!d) return <EmptyState title="Project not found" />;
  const p = d.project;
  return (
    <>
      <PageHeader
        title={p.name}
        subtitle={
          p.clientId ? (
            <>
              Project for{" "}
              <Link className="text-accent hover:underline" href={`/clients/${p.clientId}`}>
                {p.clientName}
              </Link>
            </>
          ) : (
            "Project (no client)"
          )
        }
        actions={<EditEntityButton kind="project" id={p.id} initial={{ name: p.name, notes: p.notes ?? "", clientId: p.clientId ?? "" }} archived={!!p.archivedAt} />}
      />
      {p.notes ? <p className="mb-5 whitespace-pre-wrap text-sm">{p.notes}</p> : null}
      <Overview tasks={d.tasks} activity={d.activity} prefs={d.profile} now={d.now} />
    </>
  );
}
