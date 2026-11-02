import Link from "next/link";
import type { Metadata } from "next";
import { loadPage } from "@/server/page";
import { searchTasks, type TaskFilters } from "@/server/services/tasks";
import { listClients, listProjects } from "@/server/services/clients";
import { EmptyState, PageHeader } from "@/components/app/PageHeader";
import { TaskList } from "@/components/tasks/TaskRow";
import { StatusBoard } from "@/components/tasks/StatusBoard";
import { TaskFiltersForm } from "@/components/tasks/TaskFiltersForm";
import { TASK_PRIORITIES, TASK_STATUSES, type TaskStatus } from "@/lib/domain/types";

export const metadata: Metadata = { title: "All Tasks" };

const SORTS = ["due", "follow_up", "priority", "updated", "created", "title"] as const;
const isUuid = (v?: string) => !!v && /^[0-9a-f-]{36}$/i.test(v);

export default async function TasksPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const status = sp.status;
  const filters: TaskFilters = {
    q: sp.q?.slice(0, 200),
    clientId: isUuid(sp.client) ? sp.client : undefined,
    projectId: isUuid(sp.project) ? sp.project : undefined,
    statuses: status && TASK_STATUSES.includes(status as TaskStatus) ? [status as TaskStatus] : undefined,
    includeClosed: status === "all",
    priorities: sp.priority && (TASK_PRIORITIES as readonly string[]).includes(sp.priority) ? [sp.priority] : undefined,
    overdue: sp.overdue === "1",
    missingNextAction: sp.missing === "1",
    sort: (SORTS as readonly string[]).includes(sp.sort ?? "") ? (sp.sort as TaskFilters["sort"]) : "due",
  };
  const view = sp.view === "board" ? "board" : "list";
  const data = await loadPage(async ({ tx, now, profile }) => ({
    tasks: await searchTasks(tx, { ...filters, includeClosed: view === "board" ? true : filters.includeClosed }, now, profile.timezone),
    clients: await listClients(tx),
    projects: await listProjects(tx),
  }));
  const qs = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams(Object.entries({ ...sp, ...patch }).filter(([, v]) => v) as [string, string][]);
    return `/tasks?${p.toString()}`;
  };
  const filtered = Object.entries(sp).some(([k, v]) => v && !["view", "sort"].includes(k));

  return (
    <>
      <PageHeader
        title="All Tasks"
        subtitle={`${data.tasks.length}${data.tasks.length === 500 ? "+" : ""} task${data.tasks.length === 1 ? "" : "s"}`}
        actions={
          <div className="flex rounded-lg border border-border bg-surface p-0.5" role="group" aria-label="View">
            <Link href={qs({ view: undefined })} aria-current={view === "list" ? "page" : undefined} className="rounded-md px-3 py-1.5 text-sm aria-[current=page]:bg-accent-soft aria-[current=page]:font-medium">
              List
            </Link>
            <Link href={qs({ view: "board" })} aria-current={view === "board" ? "page" : undefined} className="rounded-md px-3 py-1.5 text-sm aria-[current=page]:bg-accent-soft aria-[current=page]:font-medium">
              Board
            </Link>
          </div>
        }
      />
      <TaskFiltersForm
        values={sp}
        clients={data.clients.map((c) => ({ id: c.id, name: c.name }))}
        projects={data.projects.map((p) => ({ id: p.id, name: p.name, clientId: p.clientId }))}
      />
      <div className="mt-5">
        {data.tasks.length === 0 ? (
          <EmptyState title={filtered ? "No tasks match these filters" : "No tasks yet"}>
            {filtered ? (
              <Link className="text-accent underline" href="/tasks">
                Clear filters
              </Link>
            ) : (
              "Use Quick add to capture your first task."
            )}
          </EmptyState>
        ) : view === "board" ? (
          <StatusBoard tasks={data.tasks} />
        ) : (
          <TaskList tasks={data.tasks} showStatus />
        )}
      </div>
    </>
  );
}
