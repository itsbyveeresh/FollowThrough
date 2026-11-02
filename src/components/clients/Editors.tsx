"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "@/components/app/AppContext";
import { useMutation } from "@/components/app/useMutation";
import { Button, Field, FormError, Input, Select, Textarea } from "@/components/ui/controls";
import { Dialog } from "@/components/ui/Dialog";
import {
  archiveClientAction,
  archiveContactAction,
  archiveProjectAction,
  createClientAction,
  createContactAction,
  createProjectAction,
  updateClientAction,
  updateContactAction,
  updateProjectAction,
} from "@/app/actions/clients";

type Kind = "client" | "project" | "person";
interface Values {
  name: string;
  notes: string;
  clientId: string;
  email: string;
  phone: string;
}

/** Create or edit a client, project or person (lightweight contact details only). */
export function EntityEditor({
  kind,
  id,
  initial,
  archived,
  onDone,
}: {
  kind: Kind;
  id?: string;
  initial?: Partial<Values>;
  archived?: boolean;
  onDone?: (id: string) => void;
}) {
  const { clients } = useApp();
  const router = useRouter();
  const [v, setV] = useState<Values>({ name: "", notes: "", clientId: "", email: "", phone: "", ...initial });
  const { run, busy, error, fields } = useMutation();
  const set = (k: keyof Values, val: string) => setV((x) => ({ ...x, [k]: val }));

  async function save() {
    const payload =
      kind === "client"
        ? { name: v.name, notes: v.notes }
        : kind === "project"
          ? { name: v.name, notes: v.notes, clientId: v.clientId || null }
          : { name: v.name, notes: v.notes, clientId: v.clientId || null, email: v.email, phone: v.phone };
    const fn =
      kind === "client"
        ? id ? () => updateClientAction(id, payload) : () => createClientAction(payload)
        : kind === "project"
          ? id ? () => updateProjectAction(id, payload) : () => createProjectAction(payload)
          : id ? () => updateContactAction(id, payload) : () => createContactAction(payload);
    await run(fn, {
      success: id ? "Saved" : "Added",
      onSuccess: (d) => {
        if (!id) setV({ name: "", notes: "", clientId: initial?.clientId ?? "", email: "", phone: "" });
        onDone?.(d.id);
      },
    });
  }

  const archive = (flag: boolean) => {
    if (!id) return;
    const fn = kind === "client" ? archiveClientAction : kind === "project" ? archiveProjectAction : archiveContactAction;
    void run(() => fn(id, flag), { success: flag ? "Archived" : "Restored", onSuccess: () => router.refresh() });
  };

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <Field label="Name" error={fields.name}>
        {(p) => <Input {...p} required maxLength={200} value={v.name} onChange={(e) => set("name", e.target.value)} />}
      </Field>
      {kind !== "client" ? (
        <Field label="Client" error={fields.clientId} optional>
          {(p) => (
            <Select {...p} value={v.clientId} onChange={(e) => set("clientId", e.target.value)}>
              <option value="">No client</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      ) : null}
      {kind === "person" ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Email" error={fields.email} optional>
            {(p) => <Input {...p} type="email" value={v.email} onChange={(e) => set("email", e.target.value)} />}
          </Field>
          <Field label="Phone" error={fields.phone} optional>
            {(p) => <Input {...p} type="tel" value={v.phone} onChange={(e) => set("phone", e.target.value)} />}
          </Field>
        </div>
      ) : null}
      <Field label="Notes" error={fields.notes} optional>
        {(p) => <Textarea {...p} value={v.notes} onChange={(e) => set("notes", e.target.value)} />}
      </Field>
      <FormError message={error} />
      <div className="flex flex-wrap justify-between gap-2">
        {id ? (
          <Button variant="ghost" onClick={() => archive(!archived)}>
            {archived ? "Restore from archive" : "Archive"}
          </Button>
        ) : (
          <span />
        )}
        <Button type="submit" variant="primary" busy={busy} disabled={!v.name.trim()}>
          {id ? "Save" : "Add"}
        </Button>
      </div>
    </form>
  );
}

export function AddEntityButton({ kind, label, clientId }: { kind: Kind; label: string; clientId?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        {label}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={label}>
        <EntityEditor kind={kind} initial={{ clientId: clientId ?? "" }} onDone={() => setOpen(false)} />
      </Dialog>
    </>
  );
}

export function EditEntityButton(props: { kind: Kind; id: string; initial: Partial<Values>; archived: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        Edit
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={`Edit ${props.kind}`}>
        <EntityEditor {...props} onDone={() => setOpen(false)} />
      </Dialog>
    </>
  );
}
