"use client";

import { useState } from "react";
import { Button } from "@/components/ui/controls";
import { signOutAction } from "@/app/actions/auth";
import { clearLocalAccountState, unsubscribeThisDevice } from "@/lib/push-client";

/**
 * Sign out: stop push delivery to this installation for this account (server row
 * removed and browser subscription cancelled), end the session, clear local state.
 */
export function SignOutButton() {
  const [busy, setBusy] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-2">
      <Button
        variant="danger"
        busy={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await unsubscribeThisDevice();
          } catch {
            setWarning("Couldn't reach the server to stop reminders on this device; they'll stop when another account signs in here or the subscription expires.");
          }
          await signOutAction().catch(() => null);
          clearLocalAccountState();
          window.location.replace("/login?signedOut=1");
        }}
      >
        Sign out
      </Button>
      {warning ? <p className="text-sm text-warn">{warning}</p> : null}
    </div>
  );
}
