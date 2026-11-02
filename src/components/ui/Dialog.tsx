"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { Icon } from "./Icon";

/**
 * Modal built on the native <dialog> element (focus trapping, Escape to close,
 * inert background). Renders as a bottom sheet on small screens.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    const handle = (e: Event) => {
      e.preventDefault();
      onClose();
    };
    d.addEventListener("cancel", handle);
    return () => d.removeEventListener("cancel", handle);
  }, [onClose]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className={`m-0 mt-auto w-full max-w-none rounded-t-2xl border border-border bg-surface p-0 shadow-xl sm:m-auto sm:rounded-2xl ${wide ? "sm:max-w-2xl" : "sm:max-w-lg"}`}
    >
      {open ? (
        <div className="flex max-h-[88dvh] flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
            <div>
              <h2 id={titleId} className="text-lg font-semibold">
                {title}
              </h2>
              {description ? <div className="mt-0.5 text-sm text-muted">{description}</div> : null}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="-mr-2 inline-flex h-10 w-10 items-center justify-center rounded-lg text-muted hover:bg-surface-2"
              aria-label="Close"
            >
              <Icon name="close" />
            </button>
          </div>
          <div className="safe-bottom overflow-y-auto px-5 py-4">{children}</div>
        </div>
      ) : null}
    </dialog>
  );
}
