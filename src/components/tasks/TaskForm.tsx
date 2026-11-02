"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "@/components/app/AppContext";
import { useMutation } from "@/components/app/useMutation";
import { Button, Checkbox, Field, FormError, Input, Notice, Select, Textarea } from "@/components/ui/controls";
import { EntitySelect } from "./EntitySelect";
import { DateSuggestion, type AppliedDate } from "./DateSuggestion";
import { FollowUpPicker } from "./FollowUpPicker";
import { createTaskAction, updateTaskAction } from "@/app/actions/tasks";
import { createClientAction, createContactAction, createProjectAction } from "@/app/actions/clients";
import { PRIORITY_LABELS, STATUS_LABELS, TASK_PRIORITIES, TASK_STATUSES, type TaskPriority, type TaskStatus } from "@/lib/domain/types";
import { formatClock } from "@/lib/domain/format";
import { toLocalInput } from "@/lib/domain/presets";
import type { TaskView } from "@/server/services/model";

interface State {
  title: string;
  notes: string;
  status: TaskStatus;
  priority: TaskPriority;
  clientId: string;
  projectId: string;
  contactId: string;
  dueDate: string;
  dueTime: string;
  followUpLocal: string;
  followUpReminder: boolean;
  deadlineReminderMinutes: number | null;
  repeatDaily: boolean;
  tags: string;
}

function initialState(task: TaskView | undefined, zone: string, defaults: Partial<State>, prefs: { defaultFollowUpReminder: boolean; defaultDeadlineReminderMinutes: number | null }): State {
  return {
    title: task?.title ?? "",
    notes: task?.notes ?? "",
    status: task?.status ?? "inbox",
    priority: task?.priority ?? "normal",
    clientId: task?.clientId ?? "",
    projectId: task?.projectId ?? "",
    contactId: task?.contactId ?? "",
    dueDate: task?.dueDate ?? "",
    dueTime: task?.dueTime ?? "",
    followUpLocal: toLocalInput(task?.followUpAt ?? null, zone),
    followUpReminder: task?.followUpReminder ?? prefs.defaultFollowUpReminder,
    deadlineReminderMinutes: task ? task.deadlineReminderMinutes : prefs.defaultDeadlineReminderMinutes,
    repeatDaily: task?.repeatDaily ?? false,
    tags: task?.tags.join(", ") ?? "",
    ...defaults,
  };
}

/**
 * Create or edit a task. In "quick" mode only the title is shown up front; the
 * rest is one tap away. Only the title is ever required.
 */
export function TaskForm({
  task,
  quick,
  defaults,
  onDone,
  submitLabel,
}: {
  task?: TaskView;
  quick?: boolean;
  defaults?: Partial<State>;
  onDone?: (id: string) => void;
  submitLabel?: string;
}) {
  const app = useApp();
  const { prefs } = app;
  const router = useRouter();
  const [s, setS] = useState<State>(() => initialState(task, prefs.timezone, defaults ?? {}, prefs));
  const [expanded, setExpanded] = useState(!quick);
  const { run, busy, error, fields } = useMutation();
  const set = <K extends keyof State>(k: K, v: State[K]) => setS((x) => ({ ...x, [k]: v }));

  const projectOptions = app.projects
    .filter((p) => !s.clientId || !p.clientId || p.clientId === s.clientId)
    .map((p) => ({ id: p.id, name: !s.clientId && p.clientId ? `${p.name} (${app.clients.find((c) => c.id === p.clientId)?.name ?? "client"})` : p.name }));
  const contactOptions = [...app.contacts].sort((a, b) => Number(b.clientId === s.clientId) - Number(a.clientId === s.clientId));

  function onClient(id: string) {
    setS((x) => {
      const proj = app.projects.find((p) => p.id === x.projectId);
      const keepProject = !proj || !proj.clientId || proj.clientId === id || !id;
      return { ...x, clientId: id, projectId: keepProject ? x.projectId : "" };
    });
  }
  function onProject(id: string) {
    const proj = app.projects.find((p) => p.id === id);
    setS((x) => ({ ...x, projectId: id, clientId: proj?.clientId ? proj.clientId : x.clientId }));
  }
  function applySuggestion(a: AppliedDate) {
    if (a.field === "follow_up") {
      setS((x) => ({ ...x, followUpLocal: `${a.date}T${a.time ?? prefs.defaultFollowUpTime}`, status: x.status === "inbox" ? "next_action" : x.status }));
    } else {
      setS((x) => ({ ...x, dueDate: a.date, dueTime: a.time ?? "" }));
    }
    setExpanded(true);
  }

  async function submit() {
    const payload = {
      title: s.title,
      notes: s.notes,
      status: s.status,
      priority: s.priority,
      clientId: s.clientId || null,
      projectId: s.projectId || null,
      contactId: s.contactId || null,
      dueDate: s.dueDate || null,
      dueTime: s.dueDate ? s.dueTime || null : null,
      followUpLocal: s.followUpLocal || null,
      followUpReminder: s.followUpReminder,
      deadlineReminderMinutes: s.dueDate ? s.deadlineReminderMinutes : null,
      repeatDaily: s.repeatDaily,
      tags: s.tags.split(",").map((t) => t.trim()).filter(Boolean),
    };
    await run(() => (task ? updateTaskAction(task.id, payload) : createTaskAction(payload)), {
      success: task ? "Changes saved" : "Task added",
      onSuccess: (d) => {
        if (!task) setS(initialState(undefined, prefs.timezone, defaults ?? {}, prefs));
        if (onDone) onDone(d.id);
        else if (!task) router.refresh();
      },
    });
  }

  const waitingGaps = s.status === "waiting_on" && (!s.contactId || !s.followUpLocal);
  const dlOptions = s.dueTime
    ? [
        [null, "No deadline reminder"],
        [0, "At the deadline"],
        [15, "15 minutes before"],
        [30, "30 minutes before"],
        [60, "1 hour before"],
        [120, "2 hours before"],
        [1440, "1 day before"],
      ]
    : [
        [null, "No deadline reminder"],
        [0, `On the day at ${formatClock(prefs.dateOnlyReminderTime, prefs)}`],
        [1440, `The day before at ${formatClock(prefs.dateOnlyReminderTime, prefs)}`],
        [2880, `2 days before at ${formatClock(prefs.dateOnlyReminderTime, prefs)}`],
      ];
  const dlValue = s.deadlineReminderMinutes === null ? "" : String(s.deadlineReminderMinutes);
  const dlKnown = dlOptions.some(([v]) => (v === null ? "" : String(v)) === dlValue);

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <Field label="Title" error={fields.title}>
        {(p) => (
          <Input
            {...p}
            autoFocus={quick}
            required
            maxLength={300}
            value={s.title}
            onChange={(e) => set("title", e.target.value)}
            placeholder="e.g. Follow up with Raj tomorrow at 11 AM"
            enterKeyHint="done"
          />
        )}
      </Field>
      <DateSuggestion text={s.title} onApply={applySuggestion} />

      <fieldset>
        <legend className="mb-1 text-sm font-medium">Status</legend>
        <div className="flex flex-wrap gap-2">
          {TASK_STATUSES.filter((x) => (task ? true : x !== "completed" && x !== "cancelled")).map((x) => (
            <label key={x} className="cursor-pointer">
              <input type="radio" name="status" className="peer sr-only" checked={s.status === x} onChange={() => set("status", x)} />
              <span className="inline-flex min-h-10 items-center rounded-full border border-border px-3.5 text-sm peer-checked:border-accent peer-checked:bg-accent-soft peer-checked:font-medium peer-focus-visible:outline-2 peer-focus-visible:outline-[var(--focus)]">
                {STATUS_LABELS[x]}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      {waitingGaps ? (
        <Notice tone="warn">
          Who are you waiting on, and when will you follow up? You can save without them — the task will appear under “Needs planning”.
        </Notice>
      ) : null}

      {!expanded ? (
        <button type="button" className="self-start text-sm font-medium text-accent underline underline-offset-2" onClick={() => setExpanded(true)}>
          Add client, person, dates and reminders
        </button>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <EntitySelect
              label="Client"
              value={s.clientId}
              onChange={onClient}
              options={app.clients}
              noneLabel="No client"
              newLabel="New client"
              error={fields.clientId}
              create={(name) => createClientAction({ name })}
            />
            <EntitySelect
              label="Project"
              value={s.projectId}
              onChange={onProject}
              options={projectOptions}
              noneLabel="No project"
              newLabel="New project"
              error={fields.projectId}
              hint={s.clientId ? "Only this client's projects are listed." : undefined}
              create={(name) => createProjectAction({ name, clientId: s.clientId || null })}
            />
            <EntitySelect
              label={s.status === "waiting_on" ? "Waiting on (person)" : "Person"}
              value={s.contactId}
              onChange={(id) => set("contactId", id)}
              options={contactOptions}
              noneLabel="Nobody"
              newLabel="New person"
              error={fields.contactId}
              create={(name) => createContactAction({ name, clientId: s.clientId || null })}
            />
            <Field label="Priority">
              {(p) => (
                <Select {...p} value={s.priority} onChange={(e) => set("priority", e.target.value as TaskPriority)}>
                  {TASK_PRIORITIES.map((x) => (
                    <option key={x} value={x}>
                      {PRIORITY_LABELS[x]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>

          <div className="rounded-xl border border-border p-3 sm:p-4">
            <h3 className="text-sm font-semibold">Next follow-up</h3>
            <p className="mb-3 text-xs text-muted">When you should act or contact someone again. Can be before the deadline.</p>
            <FollowUpPicker value={s.followUpLocal} onChange={(v) => set("followUpLocal", v)} error={fields.followUpLocal} label="Follow up at" allowNone />
            <div className="mt-3">
              <Checkbox
                label="Remind me at the follow-up time"
                checked={s.followUpReminder}
                onChange={(e) => set("followUpReminder", e.target.checked)}
              />
            </div>
            <div className="mt-2">
              <Checkbox
                label="Repeat the reminder daily until I log a follow-up"
                hint={`At most ${prefs.repeatMaxPerTask} repeats; stops when completed, cancelled or rescheduled. Respects quiet hours.`}
                checked={s.repeatDaily}
                onChange={(e) => set("repeatDaily", e.target.checked)}
              />
            </div>
          </div>

          <div className="rounded-xl border border-border p-3 sm:p-4">
            <h3 className="text-sm font-semibold">Deadline</h3>
            <p className="mb-3 text-xs text-muted">When the work must be finished. Leave the time empty for an all-day deadline.</p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Due date" error={fields.dueDate}>
                {(p) => <Input {...p} type="date" value={s.dueDate} onChange={(e) => set("dueDate", e.target.value)} />}
              </Field>
              <Field label="Due time" error={fields.dueTime} optional>
                {(p) => <Input {...p} type="time" value={s.dueTime} disabled={!s.dueDate} onChange={(e) => set("dueTime", e.target.value)} />}
              </Field>
            </div>
            {s.dueDate ? (
              <Field label="Deadline reminder" className="mt-3">
                {(p) => (
                  <Select
                    {...p}
                    value={dlValue}
                    onChange={(e) => set("deadlineReminderMinutes", e.target.value === "" ? null : Number(e.target.value))}
                  >
                    {!dlKnown ? <option value={dlValue}>{Number(dlValue)} minutes before</option> : null}
                    {dlOptions.map(([v, label]) => (
                      <option key={String(v)} value={v === null ? "" : String(v)}>
                        {label}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            ) : null}
          </div>

          <Field label="Notes" error={fields.notes} optional>
            {(p) => <Textarea {...p} value={s.notes} onChange={(e) => set("notes", e.target.value)} maxLength={20000} />}
          </Field>
          <Field label="Tags" hint="Separate with commas." error={fields.tags} optional>
            {(p) => <Input {...p} value={s.tags} onChange={(e) => set("tags", e.target.value)} placeholder="proposal, legal" />}
          </Field>
        </>
      )}

      <FormError message={error} />
      <div className="flex justify-end gap-2">
        <Button type="submit" variant="primary" busy={busy} disabled={!s.title.trim()}>
          {submitLabel ?? (task ? "Save changes" : "Add task")}
        </Button>
      </div>
    </form>
  );
}
