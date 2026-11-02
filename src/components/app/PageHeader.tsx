import type { ReactNode } from "react";

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle ? <p className="mt-0.5 text-sm text-muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}

export function Section({ title, hint, count, children, id }: { title: string; hint?: string; count?: number; children: ReactNode; id?: string }) {
  return (
    <section className="mb-7" aria-labelledby={id}>
      <div className="mb-2 flex items-baseline gap-2">
        <h2 id={id} className="text-base font-semibold">
          {title}
        </h2>
        {count !== undefined ? <span className="text-sm text-muted">{count}</span> : null}
      </div>
      {hint ? <p className="-mt-1 mb-2 text-xs text-muted">{hint}</p> : null}
      {children}
    </section>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-surface px-5 py-8 text-center">
      <p className="font-medium">{title}</p>
      {children ? <div className="mt-1 text-sm text-muted">{children}</div> : null}
    </div>
  );
}
