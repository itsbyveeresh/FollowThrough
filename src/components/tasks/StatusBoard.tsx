"use client";

import Link from "next/link";
import { useApp, useNow } from "@/components/app/AppContext";
import { useMutation } from "@/components/app/useMutation";
import { setStatusAction } from "@/app/actions/tasks";
import { STATUS_LABELS, TASK_STATUSES, type TaskStatus } from "@/lib/domain/types";
import { dueLabel, followUpLabel } from "@/lib/domain/format";
import { PriorityBadge } from "./TaskRow";
import type { TaskView } from "@/server/services/model";

/** Optional board view. Cards move with a status menu (no drag-and-drop needed, works with keyboard and touch). */
export function StatusBoard({ tasks }: { tasks: TaskView[] }) {
  const { prefs } = useApp();
  const now = useNow();
  const { run, busy } = useMutation();
  const columns = TASK_STATUSES.filter((s) => s !== "cancelled");
  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-2">
      <div className="grid min-w-[60rem] grid-cols-5 gap-3">
        {columns.map((col) => {
          const items = tasks.filter((t) => t.status === col);
          return (
            <section key={col} aria-label={STATUS_LABELS[col]} className="rounded-xl border border-border bg-surface-2 p-2">
              <h2 className="mb-2 px-1 text-sm font-semibold">
                {STATUS_LABELS[col]} <span className="font-normal text-muted">{items.length}</span>
              </h2>
              <ul className="flex flex-col gap-2">
                {items.slice(0, 100).map((t) => (
                  <li key={t.id} className="rounded-lg border border-border bg-surface p-2.5 text-sm">
                    <Link href={`/tasks/${t.id}`} className="font-medium hover:underline">
                      {t.title}
                    </Link>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <PriorityBadge priority={t.priority} />
                    </div>
                    {t.clientName ? <p className="mt-1 text-xs text-muted">{t.clientName}</p> : null}
                    {t.followUpAt ? <p className="mt-1 text-xs">{followUpLabel(t.followUpAt, prefs, now)}</p> : null}
                    {t.dueDate && t.dueAt ? <p className="mt-0.5 text-xs">{dueLabel(t.dueDate, t.dueTime, t.dueAt, prefs, now)}</p> : null}
                    <label className="mt-2 block text-xs text-muted">
                      <span className="sr-only">Move “{t.title}” to</span>
                      <select
                        className="mt-1 w-full rounded border border-border bg-surface px-1.5 py-1 text-xs"
                        value={t.status}
                        disabled={busy}
                        onChange={(e) => run(() => setStatusAction(t.id, e.target.value as TaskStatus), { success: `Moved to ${STATUS_LABELS[e.target.value as TaskStatus]}` })}
                      >
                        {TASK_STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {STATUS_LABELS[s]}
                          </option>
                        ))}
                      </select>
                    </label>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
