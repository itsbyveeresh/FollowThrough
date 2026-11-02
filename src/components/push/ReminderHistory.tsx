"use client";

import Link from "next/link";
import { useApp, useNow } from "@/components/app/AppContext";
import { formatDateTime } from "@/lib/domain/format";
import { REMINDER_KIND_LABELS, REMINDER_STATUS_LABELS } from "@/lib/domain/types";
import type { ReminderView } from "@/server/services/model";
import type { AttemptView } from "@/server/services/devices";

const OUTCOME: Record<string, string> = {
  accepted: "accepted by push service",
  transient_failure: "temporary failure (retried)",
  permanent_failure: "rejected",
  subscription_gone: "subscription expired (device disabled)",
};

/** What was scheduled, when it was attempted, and what each device's push service said. */
export function ReminderHistory({ reminders, attempts }: { reminders: ReminderView[]; attempts: AttemptView[] }) {
  const { prefs } = useApp();
  const now = useNow();
  if (!reminders.length) return <p className="text-sm text-muted">No reminders yet.</p>;
  return (
    <ul className="overflow-hidden rounded-xl border border-border bg-surface text-sm">
      {reminders.map((r) => {
        const own = attempts.filter((a) => a.reminderId === r.id);
        return (
          <li key={r.id} className="border-b border-border px-4 py-3 last:border-b-0">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="font-medium">
                {REMINDER_KIND_LABELS[r.kind]}
                {r.taskId ? (
                  <>
                    {" · "}
                    <Link className="font-normal text-accent hover:underline" href={`/tasks/${r.taskId}`}>
                      {r.taskTitle ?? "task"}
                    </Link>
                  </>
                ) : null}
              </p>
              <span
                className={`rounded-full px-2 py-0.5 text-xs ${
                  r.status === "sent" ? "bg-ok-soft text-ok" : ["failed", "missed", "no_devices"].includes(r.status) ? "bg-danger-soft text-danger" : "bg-surface-2 text-muted"
                }`}
              >
                {REMINDER_STATUS_LABELS[r.status]}
              </span>
            </div>
            <p className="text-xs text-muted">
              Scheduled for {formatDateTime(r.scheduledFor, prefs, now)}
              {r.availableAt.getTime() !== r.scheduledFor.getTime() && r.status === "pending"
                ? ` · ${r.deferredReason === "quiet_hours" ? "held for quiet hours" : "next try"} ${formatDateTime(r.availableAt, prefs, now)}`
                : ""}
              {r.statusReason ? ` · ${r.statusReason.replace(/_/g, " ")}` : ""}
              {r.lastError ? ` · ${r.lastError}` : ""}
            </p>
            {own.length ? (
              <ul className="mt-1 text-xs">
                {own.map((a) => (
                  <li key={a.id}>
                    {a.deviceLabel ?? "Removed device"}: {OUTCOME[a.outcome] ?? a.outcome}
                    {a.httpStatus ? ` (HTTP ${a.httpStatus})` : ""} · {formatDateTime(new Date(a.createdAt), prefs, now)}
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
