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
  const sql = db();

  // The fallback profile creation is a write and must happen before opening
  // the read-only transaction used to render the page.
  await withUser(sql, user.id, async (tx) => {
    await getProfile(tx, user.id);
  });

  return withUser(sql, user.id, async (tx) => {
    await tx`set transaction read only`;
    const profile = await getProfile(tx, user.id);
    return fn({ tx, userId: user.id, email: user.email, now: new Date(), profile });
  });
}
