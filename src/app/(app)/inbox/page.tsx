import type { Metadata } from "next";
import { loadPage } from "@/server/page";
import { searchTasks } from "@/server/services/tasks";
import { EmptyState, PageHeader } from "@/components/app/PageHeader";
import { InboxList } from "@/components/tasks/InboxList";
import { InlineCapture } from "@/components/tasks/InlineCapture";

export const metadata: Metadata = { title: "Inbox" };

export default async function InboxPage() {
  const { tasks } = await loadPage(async ({ tx, now, profile }) => ({
    tasks: await searchTasks(tx, { statuses: ["inbox"], sort: "created" }, now, profile.timezone),
  }));
  return (
    <>
      <PageHeader title="Inbox" subtitle="Capture first, plan later. Process each item into a next action, a waiting item, or the trash." />
      <InlineCapture />
      <div className="mt-5">
        {tasks.length ? (
          <InboxList tasks={tasks} />
        ) : (
          <EmptyState title="Inbox zero">New ideas you capture land here until you plan them.</EmptyState>
        )}
      </div>
    </>
  );
}
