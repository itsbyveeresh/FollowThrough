import "server-only";
import { db, withUser, type Tx } from "./db";
import { requireUser } from "./auth";
import { getProfile } from "./services/profile";
import type { ProfileView } from "./services/model";

export interface PageContext {
  tx: Tx;
  userId: string;
  email: string | null;
  now: Date;
  profile: ProfileView;
}

/** Load data for a signed-in page inside one RLS-scoped, read-only transaction. */
export async function loadPage<T>(fn: (ctx: PageContext) => Promise<T>): Promise<T> {
  const user = await requireUser();
  return withUser(db(), user.id, async (tx) => {
    const profile = await getProfile(tx, user.id); // may create the profile row on first visit
    await tx`set transaction read only`;
    return fn({ tx, userId: user.id, email: user.email, now: new Date(), profile });
  });
}
