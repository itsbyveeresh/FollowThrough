"use client";

import { useState } from "react";
import { createTaskAction } from "@/app/actions/tasks";
import { useMutation } from "@/components/app/useMutation";
import { Button, FormError, Input } from "@/components/ui/controls";

/** One-line capture: type, press Enter, done. */
export function InlineCapture() {
  const [title, setTitle] = useState("");
  const { run, busy, error } = useMutation();
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!title.trim()) return;
        if (await run(() => createTaskAction({ title, status: "inbox" }), { success: "Captured" })) setTitle("");
      }}
    >
      <label htmlFor="capture" className="sr-only">
        New inbox item
      </label>
      <div className="flex gap-2">
        <Input id="capture" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Capture an idea or commitment…" maxLength={300} enterKeyHint="done" />
        <Button type="submit" variant="primary" busy={busy} disabled={!title.trim()}>
          Add
        </Button>
      </div>
      <FormError message={error} />
    </form>
  );
}
