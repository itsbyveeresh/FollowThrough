"use client";

import { Button } from "@/components/ui/controls";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const config = /missing configuration/i.test(error.message);
  return (
    <div className="mx-auto max-w-md rounded-xl border border-border bg-surface p-6">
      <h1 className="text-lg font-semibold">{config ? "Setup incomplete" : "This page couldn't load"}</h1>
      <p className="mt-2 text-sm text-muted">
        {config
          ? error.message
          : "The server didn't respond as expected. Nothing you saved earlier is lost. Check your connection and try again."}
      </p>
      <Button className="mt-4" variant="primary" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
