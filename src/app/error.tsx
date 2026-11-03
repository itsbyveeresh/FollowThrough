"use client";

import { useEffect } from "react";

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Root application error:", error);
  }, [error]);

  const message = error?.message || "An unexpected error occurred.";

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface p-4 text-text">
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface-2 p-6 shadow-sm">
        <div className="flex items-center gap-2 text-danger">
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <h1 className="text-xl font-semibold">Something went wrong</h1>
        </div>
        <p className="mt-3 text-sm text-muted">
          A server or connection error occurred while rendering this page.
        </p>
        <div className="mt-4 rounded-lg bg-surface border border-border p-3 font-mono text-xs text-danger break-all">
          {message}
        </div>
        {error.digest && (
          <p className="mt-2 font-mono text-xs text-muted">
            Error digest: {error.digest}
          </p>
        )}
        <div className="mt-6 flex flex-wrap gap-3">
          <button
            onClick={() => reset()}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover transition-colors"
          >
            Try again
          </button>
          <a
            href="/today"
            className="rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium text-text hover:bg-surface-2 transition-colors"
          >
            Reload
          </a>
          <a
            href="/setup"
            className="rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium text-text hover:bg-surface-2 transition-colors"
          >
            Setup status
          </a>
        </div>
      </div>
    </div>
  );
}

