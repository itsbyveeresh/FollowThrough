"use client";

import Link from "next/link";
import { useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/controls";
import { useApp, useNow } from "@/components/app/AppContext";
import { useMutation } from "@/components/app/useMutation";
import { LogFollowUpDialog, ScheduleDialog, SnoozeDialog, StatusDialog } from "./TaskDialogs";
import { deleteTaskAction, restoreTaskAction, setStatusAction } from "@/app/actions/tasks";
import { dueLabel, followUpLabel, snoozeLabel } from "@/lib/domain/format";
import { isDeadlineOverdue, isFollowUpOverdue, planningGaps } from "@/lib/domain/today";
import { PRIORITY_LABELS, STATUS_LABELS, isActiveStatus } from "@/lib/domain/types";
import type { TaskView } from "@/server/services/model";

export function PriorityBadge({ priority }: { priority: TaskView["priority"] }) {
  if (priority === "normal") return null;
  const tone =
    priority === "urgent"
      ? "bg-danger-soft text-danger border-danger/40"
      : priority === "high"
        ? "bg-warn-soft text-warn border-warn/40"
        : "bg-surface-2 text-muted border-border";
  return <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${tone}`}>{PRIORITY_LABELS[priority]}</span>;
}

export function StatusBadge({ status }: { status: TaskView["status"] }) {
  return <span className="rounded-full border border-border bg-surface-2 px-2 py-0.5 text-xs text-muted">{STATUS_LABELS[status]}</span>;
}

type DialogKind = null | "log" | "snooze" | "schedule" | "status" | "more";

export function TaskRow({ task, showStatus = false }: { task: TaskView; showStatus?: boolean }) {
  const { prefs } = useApp();
  const now = useNow();
  const [dialog, setDialog] = useState<DialogKind>(null);
  const { run, busy } = useMutation();
  const active = isActiveStatus(task.status) && !task.deletedAt;
  const fuOverdue = isFollowUpOverdue(task, now, prefs.timezone) || (!!task.followUpAt && task.followUpAt.getTime() <= now.getTime());
  const dueOverdue = isDeadlineOverdue(task, now);
  const snoozed = task.snoozedUntil && task.snoozedUntil.getTime() > now.getTime();
  const gaps = planningGaps(task);
  const meta = [task.clientName, task.contactName ? `Waiting on ${task.contactName}` : null, task.projectName].filter(Boolean);
  const close = () => setDialog(null);

  const complete = () =>
    run(() => setStatusAction(task.id, "completed"), {
      success: "Task completed",
      undo: { label: "Undo", onClick: () => void run(() => setStatusAction(task.id, task.status), { success: "Task reopened" }) },
    });

  return (
    <li className="group flex gap-3 border-b border-border px-3 py-3 last:border-b-0 sm:px-4">
      {active ? (
        <button
          type="button"
          onClick={complete}
          disabled={busy}
          className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-border text-transparent hover:border-ok hover:text-ok focus-visible:text-ok disabled:opacity-50"
          aria-label={`Complete “${task.title}”`}
          title="Complete"
        >
          <Icon name="check" className="h-4 w-4" />
        </button>
      ) : (
        <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ok-soft text-ok" aria-hidden="true">
          <Icon name="check" className="h-4 w-4" />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Link href={`/tasks/${task.id}`} className="font-medium leading-snug hover:underline">
            {task.title}
          </Link>
          <PriorityBadge priority={task.priority} />
          {showStatus ? <StatusBadge status={task.status} /> : null}
        </div>
        {meta.length ? <p className="mt-0.5 truncate text-sm text-muted">{meta.join(" · ")}</p> : null}
        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-sm">
          {task.followUpAt ? (
            <span className={fuOverdue && active ? "font-medium text-danger" : "text-text"}>
              <Icon name="phone" className="mr-1 inline h-3.5 w-3.5 align-[-2px]" />
              {followUpLabel(task.followUpAt, prefs, now)}
            </span>
          ) : null}
          {task.dueDate && task.dueAt ? (
            <span className={dueOverdue ? "font-medium text-danger" : "text-text"}>
              <Icon name="calendar" className="mr-1 inline h-3.5 w-3.5 align-[-2px]" />
              {dueLabel(task.dueDate, task.dueTime, task.dueAt, prefs, now)}
            </span>
          ) : null}
          {snoozed && active ? (
            <span className="text-muted">
              <Icon name="snooze" className="mr-1 inline h-3.5 w-3.5 align-[-2px]" />
              {snoozeLabel(task.snoozedUntil!, prefs, now)}
            </span>
          ) : null}
          {gaps.length ? <span className="text-warn">{gaps.join(" · ")}</span> : null}
        </div>
        {active ? (
          <div className="mt-2 flex flex-wrap gap-1.5 [&>button]:px-2.5 sm:[&>button]:px-3">
            <Button size="sm" onClick={() => setDialog("log")}>
              <Icon name="log" className="hidden h-4 w-4 sm:block" />
              Log follow-up
            </Button>
            <Button size="sm" onClick={() => setDialog("schedule")}>
              <Icon name="calendar" className="hidden h-4 w-4 sm:block" />
              {task.followUpAt ? "Reschedule" : "Schedule"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setDialog("more")} aria-label={`More actions for “${task.title}”`}>
              <Icon name="more" className="h-4 w-4" />
              <span className="hidden sm:inline">More</span>
            </Button>
          </div>
        ) : null}
      </div>
      {dialog === "log" ? <LogFollowUpDialog task={task} open onClose={close} /> : null}
      {dialog === "snooze" ? <SnoozeDialog task={task} open onClose={close} /> : null}
      {dialog === "schedule" ? <ScheduleDialog task={task} open onClose={close} /> : null}
      {dialog === "status" ? <StatusDialog task={task} open onClose={close} /> : null}
      {dialog === "more" ? (
        <Dialog open onClose={close} title="Task actions" description={task.title}>
          <div className="flex flex-col gap-2">
            <Button className="justify-start" onClick={() => setDialog("snooze")}>
              <Icon name="snooze" /> Snooze reminder
            </Button>
            <Button className="justify-start" onClick={() => setDialog("status")}>
              <Icon name="tasks" /> Change status
            </Button>
            <Link href={`/tasks/${task.id}`} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border px-4 hover:bg-surface-2">
              <Icon name="edit" /> Open and edit
            </Link>
            <Button
              variant="danger"
              className="justify-start"
              onClick={async () => {
                const ok = await run(() => deleteTaskAction(task.id), {
                  success: "Moved to trash",
                  undo: { label: "Undo", onClick: () => void run(() => restoreTaskAction(task.id), { success: "Restored" }) },
                });
                if (ok) close();
              }}
            >
              <Icon name="trash" /> Move to trash
            </Button>
          </div>
        </Dialog>
      ) : null}
    </li>
  );
}

export function TaskList({ tasks, empty, showStatus }: { tasks: TaskView[]; empty?: React.ReactNode; showStatus?: boolean }) {
  if (!tasks.length) return empty ? <div>{empty}</div> : null;
  return (
    <ul className="overflow-hidden rounded-xl border border-border bg-surface">
      {tasks.map((t) => (
        <TaskRow key={t.id} task={t} showStatus={showStatus} />
      ))}
    </ul>
  );
}
