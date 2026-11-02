"use client";

import { useState } from "react";
import { useMutation } from "@/components/app/useMutation";
import { Button, Checkbox, Field, FormError, Input, Select } from "@/components/ui/controls";
import { updateSettingsAction } from "@/app/actions/settings";
import type { Prefs } from "@/lib/domain/types";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function SettingsForm({ initial, displayName, timezones }: { initial: Prefs; displayName: string | null; timezones: string[] }) {
  const [v, setV] = useState({ ...initial, displayName: displayName ?? "" });
  const { run, busy, error, fields } = useMutation();
  const set = <K extends keyof typeof v>(k: K, val: (typeof v)[K]) => setV((x) => ({ ...x, [k]: val }));
  const deviceZone = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : null;

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        void run(() => updateSettingsAction(v), { success: "Settings saved" });
      }}
    >
      <fieldset className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
        <legend className="px-1 font-semibold">Time and display</legend>
        <Field label="Your name" optional error={fields.displayName}>
          {(p) => <Input {...p} value={v.displayName} maxLength={100} onChange={(e) => set("displayName", e.target.value)} />}
        </Field>
        <Field
          label="Time zone"
          error={fields.timezone}
          hint={
            <>
              All dates and reminders use this zone.{" "}
              {deviceZone && deviceZone !== v.timezone ? (
                <button type="button" className="text-accent underline" onClick={() => set("timezone", deviceZone)}>
                  Use this device&apos;s zone ({deviceZone})
                </button>
              ) : null}
            </>
          }
        >
          {(p) => (
            <Select {...p} value={v.timezone} onChange={(e) => set("timezone", e.target.value)}>
              {timezones.map((z) => (
                <option key={z} value={z}>
                  {z.replace(/_/g, " ")}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date format">
            {(p) => (
              <Select {...p} value={v.dateStyle} onChange={(e) => set("dateStyle", e.target.value as Prefs["dateStyle"])}>
                <option value="d MMM">28 Oct</option>
                <option value="MMM d">Oct 28</option>
                <option value="dd/MM">28/10</option>
                <option value="MM/dd">10/28</option>
                <option value="yyyy-MM-dd">2026-10-28</option>
              </Select>
            )}
          </Field>
          <Field label="Time format">
            {(p) => (
              <Select {...p} value={v.timeStyle} onChange={(e) => set("timeStyle", e.target.value as Prefs["timeStyle"])}>
                <option value="12h">11:30 AM</option>
                <option value="24h">11:30</option>
              </Select>
            )}
          </Field>
        </div>
        <p className="text-xs text-muted">
          Daylight-saving changes: a time that doesn&apos;t exist (clocks jump forward) moves forward by the gap; a time that happens twice
          (clocks go back) uses the first occurrence. If you change time zone, deadlines keep their local date and time, and follow-ups
          keep their exact moment.
        </p>
      </fieldset>

      <fieldset className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
        <legend className="px-1 font-semibold">Working days and hours</legend>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Working days">
          {DAYS.map((d, i) => {
            const day = i + 1;
            const on = v.workingDays.includes(day);
            return (
              <label key={d} className="cursor-pointer">
                <input
                  type="checkbox"
                  className="peer sr-only"
                  checked={on}
                  onChange={() => set("workingDays", on ? v.workingDays.filter((x) => x !== day) : [...v.workingDays, day].sort())}
                />
                <span className="inline-flex min-h-10 min-w-12 items-center justify-center rounded-lg border border-border px-2 text-sm peer-checked:border-accent peer-checked:bg-accent-soft peer-checked:font-medium peer-focus-visible:outline-2 peer-focus-visible:outline-[var(--focus)]">
                  {d}
                </span>
              </label>
            );
          })}
        </div>
        {fields.workingDays ? <p className="text-sm text-danger">{fields.workingDays}</p> : null}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Day starts" error={fields.workStart} hint="Used for “tomorrow morning” snoozes.">
            {(p) => <Input {...p} type="time" value={v.workStart} onChange={(e) => set("workStart", e.target.value)} />}
          </Field>
          <Field label="Day ends" error={fields.workEnd} hint="Used for “end of day”.">
            {(p) => <Input {...p} type="time" value={v.workEnd} onChange={(e) => set("workEnd", e.target.value)} />}
          </Field>
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
        <legend className="px-1 font-semibold">Quiet hours</legend>
        <Checkbox label="Hold notifications during quiet hours" checked={v.quietHoursEnabled} onChange={(e) => set("quietHoursEnabled", e.target.checked)} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="From" error={fields.quietStart}>
            {(p) => <Input {...p} type="time" value={v.quietStart} disabled={!v.quietHoursEnabled} onChange={(e) => set("quietStart", e.target.value)} />}
          </Field>
          <Field label="Until" error={fields.quietEnd}>
            {(p) => <Input {...p} type="time" value={v.quietEnd} disabled={!v.quietHoursEnabled} onChange={(e) => set("quietEnd", e.target.value)} />}
          </Field>
        </div>
        <Checkbox
          label="Let urgent tasks notify during quiet hours"
          checked={v.urgentBypassesQuiet}
          disabled={!v.quietHoursEnabled}
          onChange={(e) => set("urgentBypassesQuiet", e.target.checked)}
        />
        <p className="text-xs text-muted">
          A reminder that falls inside quiet hours is held and sent when quiet hours end (e.g. a 10:30 PM follow-up arrives at 7:30 AM). The
          task&apos;s deadline and follow-up time never change. Quiet hours may cross midnight. Test notifications are not held.
        </p>
      </fieldset>

      <fieldset className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
        <legend className="px-1 font-semibold">Reminder defaults</legend>
        <Checkbox label="New tasks remind me at their follow-up time" checked={v.defaultFollowUpReminder} onChange={(e) => set("defaultFollowUpReminder", e.target.checked)} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Default follow-up time" hint="Used when you pick a follow-up day without a time.">
            {(p) => <Input {...p} type="time" value={v.defaultFollowUpTime} onChange={(e) => set("defaultFollowUpTime", e.target.value)} />}
          </Field>
          <Field label="Reminder time for all-day deadlines" hint="Date-only deadlines are never treated as midnight.">
            {(p) => <Input {...p} type="time" value={v.dateOnlyReminderTime} onChange={(e) => set("dateOnlyReminderTime", e.target.value)} />}
          </Field>
          <Field label="Default deadline reminder">
            {(p) => (
              <Select
                {...p}
                value={v.defaultDeadlineReminderMinutes === null ? "" : String(v.defaultDeadlineReminderMinutes)}
                onChange={(e) => set("defaultDeadlineReminderMinutes", e.target.value === "" ? null : Number(e.target.value))}
              >
                <option value="">None</option>
                <option value="0">At the deadline (all-day: on the day)</option>
                <option value="60">1 hour before (all-day: on the day)</option>
                <option value="120">2 hours before (all-day: on the day)</option>
                <option value="1440">1 day before</option>
              </Select>
            )}
          </Field>
          <Field label="Maximum daily repeats per task" hint="Only for tasks where you switch on daily repeats (off by default).">
            {(p) => (
              <Select {...p} value={String(v.repeatMaxPerTask)} onChange={(e) => set("repeatMaxPerTask", Number(e.target.value))}>
                {[1, 2, 3, 5, 7, 10, 14].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
        <legend className="px-1 font-semibold">Daily briefing</legend>
        <Checkbox
          label="Send a daily briefing"
          hint="Counts of overdue items, today's follow-ups and important deadlines in the next 3 days. Tapping it opens Today."
          checked={v.briefingEnabled}
          onChange={(e) => set("briefingEnabled", e.target.checked)}
        />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Time">
            {(p) => <Input {...p} type="time" value={v.briefingTime} disabled={!v.briefingEnabled} onChange={(e) => set("briefingTime", e.target.value)} />}
          </Field>
        </div>
        <Checkbox label="Working days only" checked={v.briefingWorkingDaysOnly} disabled={!v.briefingEnabled} onChange={(e) => set("briefingWorkingDaysOnly", e.target.checked)} />
      </fieldset>

      <fieldset className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
        <legend className="px-1 font-semibold">Lock-screen privacy</legend>
        <label className="flex items-start gap-3">
          <input type="radio" name="detail" className="mt-1 h-5 w-5 accent-[var(--accent)]" checked={v.notificationDetail === "discreet"} onChange={() => set("notificationDetail", "discreet")} />
          <span>
            Discreet <span className="block text-xs text-muted">“You have a follow-up due.” No task, client or person names.</span>
          </span>
        </label>
        <label className="flex items-start gap-3">
          <input type="radio" name="detail" className="mt-1 h-5 w-5 accent-[var(--accent)]" checked={v.notificationDetail === "detailed"} onChange={() => set("notificationDetail", "detailed")} />
          <span>
            Detailed <span className="block text-xs text-muted">Shows the task title, client and person on the lock screen.</span>
          </span>
        </label>
      </fieldset>

      <FormError message={error} />
      <div className="sticky bottom-20 flex justify-end lg:bottom-4">
        <Button type="submit" variant="primary" busy={busy} className="shadow-md">
          Save settings
        </Button>
      </div>
    </form>
  );
}
