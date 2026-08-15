/**
 * Object storage keys are derived, never accepted.
 *
 * The exploit this closes: `PATCH /rounds/:id` used to take `photoKey` as a
 * free string and store it, and `GET /rounds/:id/photo-url` then signed a GET
 * for whatever was stored. So a caller could point one of their own rounds at
 * *any* object in the bucket — `u/<someone-else>/rounds/<their-round>/original.jpg`
 * — and be handed a valid pre-signed URL for it. Ownership was checked on the
 * round and never on the key, which is the classic shape of an insecure direct
 * object reference: the authorisation check and the thing being accessed were
 * two different objects.
 *
 * A photo's location is fully determined by who owns it and which end it
 * belongs to, so there is no reason for a client to have a say in it. Deriving
 * the key server-side means the question "may this caller read this object"
 * reduces to "does this caller own this round", which is already answered.
 */

/** Canonical key for a round's photo. The only key the API will ever sign. */
export function photoKeyFor(userId: string, roundId: string): string {
  // The owner prefix also lets a bucket policy scope access by path, which is
  // how this should be enforced a second time once IaC exists.
  return `u/${userId}/rounds/${roundId}/original.jpg`;
}

/**
 * Accept a client-supplied key only if it is the one we would have generated.
 *
 * Clearing a photo (null) is allowed; anything else is rejected rather than
 * silently corrected, because a mismatch means either a client bug or someone
 * probing, and both are worth surfacing.
 */
export function isCanonicalPhotoKey(
  key: string | null | undefined,
  userId: string,
  roundId: string,
): boolean {
  if (key === null || key === undefined) return true;
  return key === photoKeyFor(userId, roundId);
}
