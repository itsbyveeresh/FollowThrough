import Link from "next/link";
import type { Metadata } from "next";
import { loadPage } from "@/server/page";
import { searchTasks } from "@/server/services/tasks";
import { EmptyState, PageHeader, Section } from "@/components/app/PageHeader";
import { TaskList } from "@/components/tasks/TaskRow";
import { isFollowUpOverdue } from "@/lib/domain/today";
import { localDate, diffDays } from "@/lib/domain/time";
import { formatDate } from "@/lib/domain/format";
import type { TaskView } from "@/server/services/model";

export const metadata: Metadata = { title: "Waiting On" };

type Group = "date" | "person" | "client";

export default async function WaitingPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const group: Group = sp.group === "person" || sp.group === "client" ? sp.group : "date";
  const { tasks, profile, now } = await loadPage(async ({ tx, now, profile }) => ({
    tasks: await searchTasks(tx, { statuses: ["waiting_on"], sort: "follow_up" }, now, profile.timezone),
    profile,
    now,
  }));
  const today = localDate(now, profile.timezone);
  const groups = new Map<string, TaskView[]>();
  const add = (k: string, t: TaskView) => groups.set(k, [...(groups.get(k) ?? []), t]);
  for (const t of tasks) {
    if (group === "person") add(t.contactName ?? "No person set", t);
    else if (group === "client") add(t.clientName ?? "No client", t);
    else {
      if (!t.followUpAt) add("No follow-up date", t);
      else if (isFollowUpOverdue(t, now, profile.timezone) || t.followUpAt.getTime() <= now.getTime()) add("Follow-up overdue", t);
      else {
        const d = localDate(t.followUpAt, profile.timezone);
        const days = diffDays(d, today);
        add(days === 0 ? "Today" : days === 1 ? "Tomorrow" : days < 7 ? "This week" : days < 14 ? "Next week" : "Later", t);
      }
    }
  }
  const dateOrder = ["Follow-up overdue", "Today", "Tomorrow", "This week", "Next week", "Later", "No follow-up date"];
  const keys = [...groups.keys()].sort((a, b) =>
    group === "date" ? dateOrder.indexOf(a) - dateOrder.indexOf(b) : a.startsWith("No ") ? 1 : b.startsWith("No ") ? -1 : a.localeCompare(b),
  );
  const overdueCount = groups.get("Follow-up overdue")?.length ?? 0;

  return (
    <>
      <PageHeader
        title="Waiting On"
        subtitle={`${tasks.length} open item${tasks.length === 1 ? "" : "s"} · as of ${formatDate(today, profile, now)}`}
      />
      <nav aria-label="Group by" className="mb-5 flex flex-wrap gap-2">
        {(
          [
            ["date", "By follow-up date"],
            ["person", "By person"],
            ["client", "By client"],
          ] as const
        ).map(([g, label]) => (
          <Link
            key={g}
            href={`/waiting?group=${g}`}
            aria-current={group === g ? "page" : undefined}
            className="rounded-full border border-border px-3.5 py-1.5 text-sm hover:bg-surface-2 aria-[current=page]:border-accent aria-[current=page]:bg-accent-soft aria-[current=page]:font-medium"
          >
            {label}
          </Link>
        ))}
      </nav>
      {overdueCount && group !== "date" ? (
        <p className="mb-4 rounded-lg border border-danger/40 bg-danger-soft px-3 py-2 text-sm text-danger">
          {overdueCount} follow-up{overdueCount === 1 ? " is" : "s are"} overdue (shown in red).
        </p>
      ) : null}
      {tasks.length === 0 ? (
        <EmptyState title="You're not waiting on anyone">Set a task&apos;s status to “Waiting On” to track it here.</EmptyState>
      ) : (
        keys.map((k) => (
          <Section key={k} title={k} count={groups.get(k)!.length}>
            <div className={k === "Follow-up overdue" ? "rounded-xl ring-2 ring-danger/50" : ""}>
              <TaskList tasks={groups.get(k)!} />
            </div>
          </Section>
        ))
      )}
    </>
  );
}
