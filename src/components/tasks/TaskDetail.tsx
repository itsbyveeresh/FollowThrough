"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useApp, useNow } from "@/components/app/AppContext";
import { useMutation } from "@/components/app/useMutation";
import { Button, FormError, Notice, Textarea } from "@/components/ui/controls";
import { Icon } from "@/components/ui/Icon";
import { TaskForm } from "./TaskForm";
import { LogFollowUpDialog, ScheduleDialog, SnoozeDialog, StatusDialog } from "./TaskDialogs";
import { PriorityBadge, StatusBadge } from "./TaskRow";
import { addNoteAction, deleteTaskAction, purgeTaskAction, restoreTaskAction, setStatusAction } from "@/app/actions/tasks";
import { dueLabel, followUpLabel, formatDateTime, snoozeLabel } from "@/lib/domain/format";
import { planningGaps } from "@/lib/domain/today";
import { METHOD_LABELS, REMINDER_KIND_LABELS, REMINDER_STATUS_LABELS, STATUS_LABELS, isActiveStatus, type TaskStatus } from "@/lib/domain/types";
import type { ActivityView, ReminderView, TaskView } from "@/server/services/model";

const KIND_LABELS: Record<string, string> = {
  created: "Created",
  updated: "Edited",
  status_changed: "Status changed",
  follow_up_logged: "Follow-up logged",
  note: "Note",
  rescheduled: "Rescheduled",
  completed: "Completed",
  reopened: "Reopened",
  cancelled: "Cancelled",
  snoozed: "Reminder snoozed",
  deleted: "Moved to trash",
  restored: "Restored",
};

const FIELD_LABELS: Record<string, string> = {
  title: "Title",
  notes: "Notes",
  status: "Status",
  priority: "Priority",
  clientId: "Client",
  projectId: "Project",
  contactId: "Person",
  dueDate: "Due date",
  dueTime: "Due time",
  followUpAt: "Follow-up",
  followUpReminder: "Follow-up reminder",
  deadlineReminderMinutes: "Deadline reminder",
  repeatDaily: "Daily repeat",
  tags: "Tags",
  snoozedUntil: "Snoozed until",
};

export function TaskDetail({
  task,
  activities,
  reminders,
  fromNotification,
}: {
  task: TaskView;
  activities: ActivityView[];
  reminders: ReminderView[];
  fromNotification: boolean;
}) {
  const { prefs } = useApp();
  const now = useNow();
  const router = useRouter();
  const [dialog, setDialog] = useState<null | "log" | "snooze" | "schedule" | "status">(null);
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState("");
  const { run, busy, error } = useMutation();
  const noteMutation = useMutation();
  const active = isActiveStatus(task.status) && !task.deletedAt;
  const gaps = planningGaps(task);
  const snoozed = task.snoozedUntil && task.snoozedUntil.getTime() > now.getTime();

  const describe = (v: unknown, key: string) => {
    if (v === null || v === undefined || v === "") return "—";
    if (key === "status") return STATUS_LABELS[v as TaskStatus] ?? String(v);
    if (key === "followUpAt" || key === "snoozedUntil") {
      const d = new Date(String(v));
      return isNaN(d.getTime()) ? String(v) : formatDateTime(d, prefs, now);
    }
    if (["clientId", "projectId", "contactId"].includes(key)) return "changed";
    if (Array.isArray(v)) return v.join(", ") || "—";
    if (typeof v === "boolean") return v ? "on" : "off";
    return String(v);
  };

  return (
    <article>
      <Link href="/today" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-text">
        <Icon name="back" className="h-4 w-4" /> Today
      </Link>
      {fromNotification ? (
        <div className="mb-4">
          <Notice>Opened from a reminder. Nothing has been marked as done — log a follow-up or complete the task when you&apos;ve acted.</Notice>
        </div>
      ) : null}
      {task.deletedAt ? (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-warn/40 bg-warn-soft p-3 text-sm">
          This task is in the trash. Its reminders are cancelled.
          <Button size="sm" variant="primary" busy={busy} onClick={() => run(() => restoreTaskAction(task.id), { success: "Restored" })}>
            Restore
          </Button>
          <Button
            size="sm"
            variant="danger"
            onClick={() => {
              if (confirm("Delete this task and its history permanently? This cannot be undone."))
                void run(() => purgeTaskAction(task.id), { success: "Deleted permanently", onSuccess: () => router.push("/trash") });
            }}
          >
            Delete permanently
          </Button>
        </div>
      ) : null}

      <header className="mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={task.status} />
          <PriorityBadge priority={task.priority} />
          {task.tags.map((t) => (
            <span key={t} className="rounded-full bg-surface-2 px-2 py-0.5 text-xs text-muted">
              #{t}
            </span>
          ))}
        </div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{task.title}</h1>
        <p className="mt-1 text-sm text-muted">
          {[task.clientName, task.projectName, task.contactName ? `Waiting on ${task.contactName}` : null].filter(Boolean).join(" · ") || "No client or person"}
        </p>
        <div className="mt-3 flex flex-col gap-1 text-sm">
          {task.followUpAt ? <span>{followUpLabel(task.followUpAt, prefs, now)}</span> : <span className="text-muted">No follow-up scheduled</span>}
          {task.dueDate && task.dueAt ? <span>{dueLabel(task.dueDate, task.dueTime, task.dueAt, prefs, now)}</span> : null}
          {snoozed && active ? <span className="text-muted">{snoozeLabel(task.snoozedUntil!, prefs, now)}</span> : null}
          {task.lastFollowedUpAt ? <span className="text-muted">Last followed up {formatDateTime(task.lastFollowedUpAt, prefs, now)}</span> : null}
          {gaps.length ? <span className="text-warn">Needs planning: {gaps.join(", ")}</span> : null}
        </div>
      </header>

      {!task.deletedAt ? (
        <div className="mb-6 flex flex-wrap gap-2">
          {active ? (
            <>
              <Button variant="primary" busy={busy} onClick={() => run(() => setStatusAction(task.id, "completed"), { success: "Task completed — pending reminders cancelled" })}>
                <Icon name="check" /> Complete
              </Button>
              <Button onClick={() => setDialog("log")}>
                <Icon name="log" /> Log follow-up
              </Button>
              <Button onClick={() => setDialog("schedule")}>
                <Icon name="calendar" /> {task.followUpAt ? "Reschedule follow-up" : "Schedule follow-up"}
              </Button>
              <Button onClick={() => setDialog("snooze")}>
                <Icon name="snooze" /> Snooze
              </Button>
            </>
          ) : (
            <Button variant="primary" busy={busy} onClick={() => run(() => setStatusAction(task.id, "next_action"), { success: "Reopened" })}>
              Reopen
            </Button>
          )}
          <Button onClick={() => setDialog("status")}>Change status</Button>
          <Button
            variant="danger"
            onClick={() =>
              run(() => deleteTaskAction(task.id), {
                success: "Moved to trash",
                undo: { label: "Undo", onClick: () => void run(() => restoreTaskAction(task.id), { success: "Restored" }) },
              })
            }
          >
            <Icon name="trash" /> Trash
          </Button>
        </div>
      ) : null}
      <FormError message={error} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section aria-labelledby="details-h" className="rounded-xl border border-border bg-surface p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 id="details-h" className="font-semibold">
              Details
            </h2>
            {!task.deletedAt ? (
              <Button size="sm" onClick={() => setEditing((e) => !e)} aria-expanded={editing}>
                {editing ? "Close editor" : "Edit"}
              </Button>
            ) : null}
          </div>
          {editing ? (
            <TaskForm key={task.updatedAt.toISOString()} task={task} onDone={() => setEditing(false)} />
          ) : (
            <div className="whitespace-pre-wrap text-[0.95rem]">{task.notes || <span className="text-muted">No notes.</span>}</div>
          )}
        </section>

        <aside className="flex flex-col gap-6">
          <section aria-labelledby="history-h">
            <h2 id="history-h" className="mb-2 font-semibold">
              Activity
            </h2>
            {!task.deletedAt ? (
              <form
                className="mb-3 flex flex-col gap-2"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (await noteMutation.run(() => addNoteAction(task.id, { note }), { success: "Note added" })) setNote("");
                }}
              >
                <label htmlFor="note" className="sr-only">
                  Add a note
                </label>
                <Textarea id="note" className="min-h-16" placeholder="Add a note…" value={note} onChange={(e) => setNote(e.target.value)} maxLength={5000} />
                <FormError message={noteMutation.error} />
                <Button type="submit" size="sm" busy={noteMutation.busy} disabled={!note.trim()} className="self-end">
                  Add note
                </Button>
              </form>
            ) : null}
            <ol className="flex flex-col gap-3 border-l border-border pl-4">
              {activities.map((a) => (
                <li key={a.id} className="relative text-sm">
                  <span className="absolute -left-[1.3rem] top-1.5 h-2 w-2 rounded-full bg-accent" aria-hidden="true" />
                  <p className="font-medium">
                    {KIND_LABELS[a.kind] ?? a.kind}
                    {a.method ? ` · ${METHOD_LABELS[a.method]}` : ""}
                  </p>
                  <p className="text-xs text-muted">
                    <time dateTime={new Date(a.occurredAt).toISOString()}>{formatDateTime(new Date(a.occurredAt), prefs, now)}</time>
                  </p>
                  {a.note ? <p className="mt-1 whitespace-pre-wrap">{a.note}</p> : null}
                  {a.outcome ? <p className="mt-1 text-muted">Outcome: {a.outcome}</p> : null}
                  {a.kind !== "created" && a.changes && Object.keys(a.changes).length ? (
                    <ul className="mt-1 text-xs text-muted">
                      {Object.entries(a.changes as Record<string, { from?: unknown; to?: unknown }>).map(([k, v]) => (
                        <li key={k}>
                          {FIELD_LABELS[k] ?? k}
                          {k === "notes" ? " edited" : `: ${describe(v?.from, k)} → ${describe(v?.to, k)}`}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ol>
          </section>

          <section aria-labelledby="reminders-h">
            <h2 id="reminders-h" className="mb-2 font-semibold">
              Reminders for this task
            </h2>
            {reminders.length === 0 ? (
              <p className="text-sm text-muted">No reminders scheduled.</p>
            ) : (
              <ul className="flex flex-col gap-2 text-sm">
                {reminders.map((r) => (
                  <li key={r.id} className="rounded-lg border border-border bg-surface px-3 py-2">
                    <p className="font-medium">
                      {REMINDER_KIND_LABELS[r.kind]} · {REMINDER_STATUS_LABELS[r.status]}
                    </p>
                    <p className="text-xs text-muted">
                      For {formatDateTime(r.scheduledFor, prefs, now)}
                      {r.deferredReason === "quiet_hours" && r.availableAt.getTime() !== r.scheduledFor.getTime()
                        ? ` · held for quiet hours until ${formatDateTime(r.availableAt, prefs, now)}`
                        : ""}
                      {r.statusReason ? ` · ${r.statusReason.replace(/_/g, " ")}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            <Link href="/settings/notifications#history" className="mt-2 inline-block text-sm text-accent underline">
              All reminder history
            </Link>
          </section>
        </aside>
      </div>

      {dialog === "log" ? <LogFollowUpDialog task={task} open onClose={() => setDialog(null)} /> : null}
      {dialog === "snooze" ? <SnoozeDialog task={task} open onClose={() => setDialog(null)} /> : null}
      {dialog === "schedule" ? <ScheduleDialog task={task} open onClose={() => setDialog(null)} /> : null}
      {dialog === "status" ? <StatusDialog task={task} open onClose={() => setDialog(null)} /> : null}
    </article>
  );
}
