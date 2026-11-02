import Link from "next/link";
import { Section, EmptyState } from "@/components/app/PageHeader";
import { TaskList } from "@/components/tasks/TaskRow";
import { isOverdue } from "@/lib/domain/today";
import { formatDateTime } from "@/lib/domain/format";
import type { Prefs } from "@/lib/domain/types";
import type { TaskView } from "@/server/services/model";

export interface ActivityItem {
  id: string;
  taskId: string;
  kind: string;
  note: string | null;
  outcome: string | null;
  occurredAt: Date;
  taskTitle: string;
}

/** True when a set of open tasks has no clear next step. */
export function lacksNextAction(open: TaskView[]): boolean {
  if (!open.length) return false;
  return !open.some((t) => t.status === "next_action" || t.status === "in_progress" || (t.status === "waiting_on" && t.followUpAt));
}

const KIND: Record<string, string> = {
  follow_up_logged: "Followed up",
  note: "Note",
  created: "Created",
  completed: "Completed",
  rescheduled: "Rescheduled",
  status_changed: "Status changed",
  updated: "Edited",
  snoozed: "Snoozed",
  reopened: "Reopened",
  cancelled: "Cancelled",
  deleted: "Trashed",
  restored: "Restored",
};

/** Overdue, waiting, active tasks and recent activity for a client, project or person. */
export function Overview({ tasks, activity, prefs, now }: { tasks: TaskView[]; activity: ActivityItem[]; prefs: Prefs; now: Date }) {
  const overdue = tasks.filter((t) => isOverdue(t, now, prefs.timezone));
  const waiting = tasks.filter((t) => t.status === "waiting_on" && !overdue.includes(t));
  const activeTasks = tasks.filter((t) => !overdue.includes(t) && !waiting.includes(t));
  return (
    <>
      {lacksNextAction(tasks) ? (
        <p className="mb-4 rounded-lg border border-warn/40 bg-warn-soft px-3 py-2 text-sm">
          No next action: nothing here is marked Next Action or In Progress, and no waiting item has a follow-up date.
        </p>
      ) : null}
      {tasks.length === 0 ? <EmptyState title="No open tasks" /> : null}
      {overdue.length ? (
        <Section title="Overdue" count={overdue.length}>
          <TaskList tasks={overdue} showStatus />
        </Section>
      ) : null}
      {waiting.length ? (
        <Section title="Waiting on" count={waiting.length}>
          <TaskList tasks={waiting} />
        </Section>
      ) : null}
      {activeTasks.length ? (
        <Section title="Active tasks" count={activeTasks.length}>
          <TaskList tasks={activeTasks} showStatus />
        </Section>
      ) : null}
      <Section title="Recent activity">
        {activity.length === 0 ? (
          <p className="text-sm text-muted">No activity yet.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-xl border border-border bg-surface">
            {activity.map((a) => (
              <li key={a.id} className="px-4 py-2.5 text-sm">
                <p>
                  <span className="font-medium">{KIND[a.kind] ?? a.kind}</span> ·{" "}
                  <Link href={`/tasks/${a.taskId}`} className="hover:underline">
                    {a.taskTitle}
                  </Link>
                </p>
                {a.note ? <p className="mt-0.5 line-clamp-2 text-muted">{a.note}</p> : null}
                {a.outcome ? <p className="mt-0.5 text-muted">Outcome: {a.outcome}</p> : null}
                <p className="text-xs text-muted">{formatDateTime(new Date(a.occurredAt), prefs, now)}</p>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}
