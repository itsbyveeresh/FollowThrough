"use client";

import Link from "next/link";
import { useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/controls";
import { useMutation } from "@/components/app/useMutation";
import { useApp, useNow } from "@/components/app/AppContext";
import { TaskForm } from "./TaskForm";
import { deleteTaskAction, restoreTaskAction } from "@/app/actions/tasks";
import { formatRelativeDateTime } from "@/lib/domain/format";
import type { TaskView } from "@/server/services/model";

/** Inbox items with a one-tap "Plan" flow that turns them into next actions or waiting items. */
export function InboxList({ tasks }: { tasks: TaskView[] }) {
  const [planning, setPlanning] = useState<{ task: TaskView; status: "next_action" | "waiting_on" } | null>(null);
  const { run } = useMutation();
  const { prefs } = useApp();
  const now = useNow();
  return (
    <>
      <ul className="overflow-hidden rounded-xl border border-border bg-surface">
        {tasks.map((t) => (
          <li key={t.id} className="flex flex-col gap-2 border-b border-border px-4 py-3 last:border-b-0 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <Link href={`/tasks/${t.id}`} className="font-medium hover:underline">
                {t.title}
              </Link>
              <p className="text-xs text-muted">Captured {formatRelativeDateTime(t.createdAt, prefs, now)}</p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Button size="sm" variant="primary" onClick={() => setPlanning({ task: t, status: "next_action" })}>
                Plan as next action
              </Button>
              <Button size="sm" onClick={() => setPlanning({ task: t, status: "waiting_on" })}>
                Waiting on someone
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  run(() => deleteTaskAction(t.id), {
                    success: "Moved to trash",
                    undo: { label: "Undo", onClick: () => void run(() => restoreTaskAction(t.id), { success: "Restored" }) },
                  })
                }
              >
                Discard
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {planning ? (
        <Dialog open onClose={() => setPlanning(null)} title="Plan this item" description="Decide the next step, who it involves and when." wide>
          <TaskForm task={{ ...planning.task, status: planning.status }} onDone={() => setPlanning(null)} submitLabel="Save plan" />
        </Dialog>
      ) : null}
    </>
  );
}
