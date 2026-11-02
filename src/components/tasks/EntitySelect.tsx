"use client";

import { useState } from "react";
import { Button, Field, Input, Select } from "@/components/ui/controls";
import { useMutation } from "@/components/app/useMutation";
import type { ActionResult } from "@/lib/action-result";
import type { Option } from "@/components/app/AppContext";

const NEW = "__new__";

/** A select with an inline "Add new…" path so capture never stops for a missing client/person. */
export function EntitySelect({
  label,
  value,
  onChange,
  options,
  noneLabel,
  newLabel,
  create,
  error,
  hint,
}: {
  label: string;
  value: string;
  onChange: (id: string) => void;
  options: { id: string; name: string }[];
  noneLabel: string;
  newLabel: string;
  create: (name: string) => Promise<ActionResult<{ id: string }>>;
  error?: string;
  hint?: string;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [extra, setExtra] = useState<Option[]>([]);
  const { run, busy, error: createError } = useMutation();
  const all = [...options, ...extra.filter((e) => !options.some((o) => o.id === e.id))];
  const add = () =>
    run(() => create(name.trim()), {
      success: "Added",
      onSuccess: (d) => {
        setExtra((x) => [...x, { id: d.id, name: name.trim() }]);
        onChange(d.id);
        setName("");
        setAdding(false);
      },
    });

  if (adding) {
    return (
      <div className="flex flex-col gap-1">
        <Field label={newLabel} error={createError ?? undefined}>
          {(p) => (
            <Input
              {...p}
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={200}
              onKeyDown={(e) => {
                if (e.key === "Enter" && name.trim()) {
                  e.preventDefault();
                  void add();
                }
              }}
            />
          )}
        </Field>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="primary"
            busy={busy}
            disabled={!name.trim()}
            onClick={add}
          >
            Add
          </Button>
          <Button size="sm" onClick={() => setAdding(false)}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }
  return (
    <Field label={label} error={error} hint={hint} optional>
      {(p) => (
        <Select
          {...p}
          value={value}
          onChange={(e) => {
            if (e.target.value === NEW) setAdding(true);
            else onChange(e.target.value);
          }}
        >
          <option value="">{noneLabel}</option>
          {all.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
          <option value={NEW}>＋ {newLabel}…</option>
        </Select>
      )}
    </Field>
  );
}
