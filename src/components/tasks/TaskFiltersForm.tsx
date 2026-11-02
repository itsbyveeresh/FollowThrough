"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Input, Select } from "@/components/ui/controls";
import { PRIORITY_LABELS, STATUS_LABELS, TASK_PRIORITIES, TASK_STATUSES } from "@/lib/domain/types";
import type { Option } from "@/components/app/AppContext";

/** Search, filter and sort; state lives in the URL so views can be bookmarked. */
export function TaskFiltersForm({ values, clients, projects }: { values: Record<string, string | undefined>; clients: Option[]; projects: Option[] }) {
  const router = useRouter();
  const [v, setV] = useState(values);
  const [open, setOpen] = useState(Object.keys(values).some((k) => !["q", "view", "sort"].includes(k) && values[k]));
  const apply = (next: Record<string, string | undefined>) => {
    const p = new URLSearchParams(Object.entries(next).filter(([, x]) => x) as [string, string][]);
    router.push(`/tasks?${p.toString()}`);
  };
  const set = (k: string, val: string | undefined) => {
    const next = { ...v, [k]: val || undefined };
    if (k === "client") {
      const proj = projects.find((p) => p.id === next.project);
      if (proj?.clientId && proj.clientId !== val) next.project = undefined;
    }
    setV(next);
    if (k !== "q") apply(next);
  };
  const projectChoices = projects.filter((p) => !v.client || !p.clientId || p.clientId === v.client);

  return (
    <form
      role="search"
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        apply(v);
      }}
    >
      <div className="flex gap-2">
        <label htmlFor="task-search" className="sr-only">
          Search tasks, notes, clients and projects
        </label>
        <Input id="task-search" type="search" placeholder="Search tasks, notes, clients, projects…  ( / )" value={v.q ?? ""} onChange={(e) => setV({ ...v, q: e.target.value })} />
        <Button type="submit" variant="primary">
          Search
        </Button>
        <Button onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls="task-filters">
          Filters
        </Button>
      </div>
      {open ? (
        <div id="task-filters" className="grid grid-cols-2 gap-2 rounded-xl border border-border bg-surface p-3 sm:grid-cols-3">
          <Select aria-label="Client" value={v.client ?? ""} onChange={(e) => set("client", e.target.value)}>
            <option value="">All clients</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <Select aria-label="Project" value={v.project ?? ""} onChange={(e) => set("project", e.target.value)}>
            <option value="">All projects</option>
            {projectChoices.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
          <Select aria-label="Status" value={v.status ?? ""} onChange={(e) => set("status", e.target.value)}>
            <option value="">Open (not completed)</option>
            {TASK_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
            <option value="all">All, including closed</option>
          </Select>
          <Select aria-label="Priority" value={v.priority ?? ""} onChange={(e) => set("priority", e.target.value)}>
            <option value="">Any priority</option>
            {TASK_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABELS[p]}
              </option>
            ))}
          </Select>
          <Select aria-label="Sort by" value={v.sort ?? "due"} onChange={(e) => set("sort", e.target.value)}>
            <option value="due">Sort: deadline</option>
            <option value="follow_up">Sort: next follow-up</option>
            <option value="priority">Sort: priority</option>
            <option value="updated">Sort: recently updated</option>
            <option value="created">Sort: newest</option>
            <option value="title">Sort: title</option>
          </Select>
          <div className="col-span-2 flex flex-wrap items-center gap-4 sm:col-span-3">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="h-5 w-5 accent-[var(--accent)]" checked={v.overdue === "1"} onChange={(e) => set("overdue", e.target.checked ? "1" : undefined)} />
              Overdue only
            </label>
            <label className="flex items-center gap-2 text-sm" title="Inbox items not yet processed, and Waiting On items without a person or follow-up date">
              <input type="checkbox" className="h-5 w-5 accent-[var(--accent)]" checked={v.missing === "1"} onChange={(e) => set("missing", e.target.checked ? "1" : undefined)} />
              Missing next action
            </label>
            <Button size="sm" variant="ghost" onClick={() => { setV({ view: values.view }); apply({ view: values.view }); }}>
              Clear all
            </Button>
          </div>
        </div>
      ) : null}
    </form>
  );
}
