import Link from "next/link";
import type { Metadata } from "next";
import { loadPage } from "@/server/page";
import { getActivities, getTask, getTaskReminders } from "@/server/services/tasks";
import { EmptyState } from "@/components/app/PageHeader";
import { TaskDetail } from "@/components/tasks/TaskDetail";

export const metadata: Metadata = { title: "Task" };

export default async function TaskPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const valid = /^[0-9a-f-]{36}$/i.test(id);
  const data = await loadPage(async ({ tx }) => {
    if (!valid) return null;
    const task = await getTask(tx, id);
    if (!task) return null;
    return { task, activities: await getActivities(tx, id), reminders: await getTaskReminders(tx, id) };
  });
  if (!data) {
    return (
      <EmptyState title="Task not found">
        It may have been permanently deleted, or it belongs to a different account than the one you&apos;re signed in with.{" "}
        <Link href="/today" className="text-accent underline">
          Go to Today
        </Link>
      </EmptyState>
    );
  }
  return <TaskDetail task={data.task} activities={data.activities} reminders={data.reminders} fromNotification={sp.from === "notification"} />;
}
