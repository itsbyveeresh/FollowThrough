import type { Metadata } from "next";
import { loadPage } from "@/server/page";
import { searchTasks } from "@/server/services/tasks";
import { EmptyState, PageHeader } from "@/components/app/PageHeader";
import { TrashList } from "@/components/tasks/TrashList";

export const metadata: Metadata = { title: "Trash" };

export default async function TrashPage() {
  const { tasks } = await loadPage(async ({ tx, now, profile }) => ({
    tasks: await searchTasks(tx, { trash: true, sort: "updated" }, now, profile.timezone),
  }));
  return (
    <>
      <PageHeader title="Trash" subtitle="Deleted tasks stay here until you delete them permanently. Their reminders are cancelled." />
      {tasks.length ? <TrashList tasks={tasks} /> : <EmptyState title="Trash is empty" />}
    </>
  );
}
