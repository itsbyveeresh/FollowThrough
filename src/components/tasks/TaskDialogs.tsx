"use client";

import { useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Button, Field, FormError, Input, Notice, Select, Textarea } from "@/components/ui/controls";
import { useMutation } from "@/components/app/useMutation";
import { useApp, useNow } from "@/components/app/AppContext";
import { FollowUpPicker } from "./FollowUpPicker";
import { clearSnoozeAction, logFollowUpAction, setStatusAction, snoozeAction, updateTaskAction } from "@/app/actions/tasks";
import { FOLLOW_UP_METHODS, METHOD_LABELS, STATUS_LABELS, TASK_STATUSES, type FollowUpMethod, type TaskStatus } from "@/lib/domain/types";
import { formatClock, formatRelativeDateTime } from "@/lib/domain/format";
import { toLocalInput } from "@/lib/domain/presets";
import type { TaskView } from "@/server/services/model";

export function LogFollowUpDialog({ task, open, onClose }: { task: TaskView; open: boolean; onClose: () => void }) {
  const { run, busy, error, fields } = useMutation();
  const [method, setMethod] = useState<FollowUpMethod>("phone");
  const [note, setNote] = useState("");
  const [outcome, setOutcome] = useState("");
  const [next, setNext] = useState("");
  const [status, setStatus] = useState<TaskStatus | "">("");

  async function save() {
    const ok = await run(
      () => logFollowUpAction(task.id, { method, note, outcome, nextFollowUpLocal: next || null, status: status || null }),
      { success: next ? "Follow-up logged and next one scheduled" : "Follow-up logged" },
    );
    if (ok) {
      setNote("");
      setOutcome("");
      setNext("");
      setStatus("");
      onClose();
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Log follow-up" description={task.title}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <fieldset>
          <legend className="mb-1 text-sm font-medium">How did you follow up?</legend>
          <div className="flex flex-wrap gap-2">
            {FOLLOW_UP_METHODS.map((m) => (
              <label key={m} className="cursor-pointer">
                <input type="radio" name="method" value={m} checked={method === m} onChange={() => setMethod(m)} className="peer sr-only" />
                <span className="inline-flex min-h-10 items-center rounded-full border border-border px-3.5 text-sm peer-checked:border-accent peer-checked:bg-accent-soft peer-checked:font-medium peer-focus-visible:outline-2 peer-focus-visible:outline-[var(--focus)]">
                  {METHOD_LABELS[m]}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <Field label="What happened?" error={fields.note} optional>
          {(p) => (
            <Textarea {...p} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Called; Anita promised a revision Wednesday." maxLength={5000} />
          )}
        </Field>
        <Field label="Outcome" error={fields.outcome} optional hint="A short result, e.g. “Promised Friday”, “No answer”.">
          {(p) => <Input {...p} value={outcome} onChange={(e) => setOutcome(e.target.value)} maxLength={2000} />}
        </Field>
        <FollowUpPicker value={next} onChange={setNext} error={fields.nextFollowUpLocal} allowNone />
        {!next && task.status === "waiting_on" ? (
          <Notice tone="warn">Without a next follow-up, this waiting item will appear under “Needs planning”.</Notice>
        ) : null}
        <Field label="Status" optional>
          {(p) => (
            <Select {...p} value={status} onChange={(e) => setStatus(e.target.value as TaskStatus | "")}>
              <option value="">Keep as {STATUS_LABELS[task.status]}</option>
              {TASK_STATUSES.filter((s) => s !== task.status).map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <p className="text-xs text-muted">Saved with today&apos;s date and time; the note, outcome and schedule change are saved together.</p>
        <FormError message={error} />
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" busy={busy}>
            Save follow-up
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function SnoozeDialog({ task, open, onClose }: { task: TaskView; open: boolean; onClose: () => void }) {
  const { prefs } = useApp();
  const now = useNow();
  const { run, busy, error } = useMutation();
  const [custom, setCustom] = useState("");
  const snoozed = task.snoozedUntil && task.snoozedUntil.getTime() > now.getTime();

  const snooze = async (option: "15m" | "1h" | "tomorrow_morning" | "custom") => {
    const res = await run(() => snoozeAction(task.id, { option, customLocal: option === "custom" ? custom : null }), {
      success: "Reminder snoozed",
    });
    if (res) onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} title="Snooze reminder" description={task.title}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">
          Snoozing only delays this task&apos;s reminder. The deadline and follow-up date stay exactly as they are.
        </p>
        {snoozed ? (
          <Notice>
            Currently snoozed until {formatRelativeDateTime(task.snoozedUntil!, prefs, now)}.{" "}
            <button
              type="button"
              className="font-medium text-accent underline"
              onClick={async () => {
                if (await run(() => clearSnoozeAction(task.id), { success: "Snooze cancelled" })) onClose();
              }}
            >
              Cancel snooze
            </button>
          </Notice>
        ) : null}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Button onClick={() => snooze("15m")} disabled={busy}>
            15 minutes
          </Button>
          <Button onClick={() => snooze("1h")} disabled={busy}>
            1 hour
          </Button>
          <Button onClick={() => snooze("tomorrow_morning")} disabled={busy}>
            Tomorrow {formatClock(prefs.workStart, prefs)}
          </Button>
        </div>
        <form
          className="flex flex-col gap-2 sm:flex-row sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            void snooze("custom");
          }}
        >
          <Field label="Custom time" className="flex-1">
            {(p) => <Input {...p} type="datetime-local" value={custom} onChange={(e) => setCustom(e.target.value)} required />}
          </Field>
          <Button type="submit" variant="primary" busy={busy} disabled={!custom}>
            Snooze
          </Button>
        </form>
        <FormError message={error} />
      </div>
    </Dialog>
  );
}

export function ScheduleDialog({ task, open, onClose }: { task: TaskView; open: boolean; onClose: () => void }) {
  const { prefs } = useApp();
  const { run, busy, error, fields } = useMutation();
  const [value, setValue] = useState(toLocalInput(task.followUpAt, prefs.timezone));
  const [remind, setRemind] = useState(task.followUpReminder);
  return (
    <Dialog open={open} onClose={onClose} title="Schedule next follow-up" description={task.title}>
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const ok = await run(() => updateTaskAction(task.id, { followUpLocal: value || null, followUpReminder: remind }), {
            success: value ? "Follow-up scheduled" : "Follow-up cleared",
          });
          if (ok) onClose();
        }}
      >
        <FollowUpPicker value={value} onChange={setValue} error={fields.followUpLocal} allowNone />
        <label className="flex items-center gap-3 text-[0.95rem]">
          <input type="checkbox" className="h-5 w-5 accent-[var(--accent)]" checked={remind} onChange={(e) => setRemind(e.target.checked)} />
          Send me a reminder at the follow-up time
        </label>
        <FormError message={error} />
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" busy={busy}>
            Save
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function StatusDialog({ task, open, onClose }: { task: TaskView; open: boolean; onClose: () => void }) {
  const { run, busy, error } = useMutation();
  return (
    <Dialog open={open} onClose={onClose} title="Change status" description={task.title}>
      <div className="flex flex-col gap-2">
        {TASK_STATUSES.map((s) => (
          <Button
            key={s}
            variant={s === task.status ? "primary" : "secondary"}
            disabled={busy || s === task.status}
            className="justify-start"
            onClick={async () => {
              if (await run(() => setStatusAction(task.id, s), { success: `Moved to ${STATUS_LABELS[s]}` })) onClose();
            }}
          >
            {STATUS_LABELS[s]}
            {s === task.status ? " (current)" : ""}
          </Button>
        ))}
        <FormError message={error} />
      </div>
    </Dialog>
  );
}
