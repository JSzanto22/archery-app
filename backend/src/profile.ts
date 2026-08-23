/**
 * The profile row every other table hangs off.
 *
 * `sessions.owner_id` is a NOT NULL foreign key to `users.id`, so a caller
 * with no row here cannot store anything at all. Cognito never tells us a user
 * exists — it mints them and moves on — which means the row has to be created
 * by whatever request arrives first.
 *
 * That used to be `GET /me` alone, and nothing in the app called it. A brand
 * new account's first sync therefore failed the foreign key and returned a
 * 500, permanently: the device retried, hit the same wall, and reported "sync
 * failed" forever while the archer's sessions sat on their phone.
 *
 * Doing it here, from both entry points, means the guarantee does not depend
 * on a client remembering to call something first.
 */

import { db } from './db/client.js';
import { users } from './db/schema.js';

/**
 * Either the pool or an open transaction.
 *
 * `/sync/push` calls this inside its transaction so the profile and the rows
 * that reference it land together; `/me` calls it directly.
 */
type Inserter = Pick<typeof db, 'insert'>;

/**
 * A placeholder address for a caller whose token carries no email claim.
 *
 * Cognito access tokens normally do not, and `users.email` is NOT NULL. It is
 * deliberately in a reserved TLD that can never receive mail, so nothing can
 * mistake it for a real address later.
 */
export function placeholderEmail(userId: string): string {
  return `${userId}@placeholder.invalid`;
}

/**
 * Create the caller's profile row if it is not already there.
 *
 * `onConflictDoNothing` on the id rather than a select-then-insert: two
 * devices syncing at once would both see no row and both try to insert.
 */
export async function ensureProfile(
  database: Inserter,
  userId: string,
  email: string | null,
): Promise<void> {
  await database
    .insert(users)
    .values({ id: userId, email: email ?? placeholderEmail(userId) })
    .onConflictDoNothing({ target: users.id });
}
