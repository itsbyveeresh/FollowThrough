"use client";

import { useApp, useNow } from "@/components/app/AppContext";
import { useMutation } from "@/components/app/useMutation";
import { Button } from "@/components/ui/controls";
import { purgeTaskAction, restoreTaskAction } from "@/app/actions/tasks";
import { formatDateTime } from "@/lib/domain/format";
import type { TaskView } from "@/server/services/model";

export function TrashList({ tasks }: { tasks: TaskView[] }) {
  const { prefs } = useApp();
  const now = useNow();
  const { run, busy } = useMutation();
  return (
    <ul className="overflow-hidden rounded-xl border border-border bg-surface">
      {tasks.map((t) => (
        <li key={t.id} className="flex flex-col gap-2 border-b border-border px-4 py-3 last:border-b-0 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <p className="font-medium">{t.title}</p>
            <p className="text-xs text-muted">
              {t.clientName ? `${t.clientName} · ` : ""}Deleted {t.deletedAt ? formatDateTime(t.deletedAt, prefs, now) : ""}
            </p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="primary" disabled={busy} onClick={() => run(() => restoreTaskAction(t.id), { success: "Restored" })}>
              Restore
            </Button>
            <Button
              size="sm"
              variant="danger"
              disabled={busy}
              onClick={() => {
                if (confirm(`Permanently delete “${t.title}” and its history? This cannot be undone.`))
                  void run(() => purgeTaskAction(t.id), { success: "Deleted permanently" });
              }}
            >
              Delete permanently
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}
