/**
 * Sends captured photos to object storage.
 *
 * The capture half has always worked: `attachLocalPhoto` writes a `file://`
 * URI onto the round and the marking screen draws it. Nothing ever uploaded
 * it, so the photo lived and died on one device while the UI gave every
 * impression the feature worked. This is the other half.
 *
 * The bytes never pass through the API. The server signs a short-lived PUT,
 * the device uploads straight to S3, and only then is the object key written
 * to the round — so a failed upload leaves a round with its local photo
 * intact and no key pointing at an object that does not exist.
 */

import { Q } from '@nozbe/watermelondb';

import { collections, database } from '../db';
import Round from '../db/models/Round';
import { UPLOAD_TIMEOUT_MS, fetchWithTimeout } from '../lib/http';

export interface PhotoUploadOptions {
  apiBaseUrl: string;
  getAccessToken: () => Promise<string | null>;
  /** Cap per run so a backlog cannot hold the sync open indefinitely. */
  limit?: number;
}

export interface PhotoUploadResult {
  uploaded: number;
  failed: number;
  /** Rounds still holding a local photo with no key. */
  remaining: number;
}

interface PresignResponse {
  uploadUrl: string;
  photoKey: string;
}

/**
 * Rounds photographed on this device but not yet in object storage.
 *
 * `photo_key` being null is the marker: it is written last, and only after
 * the object is safely uploaded.
 */
async function pendingUploads(limit: number): Promise<Round[]> {
  const rounds = await collections.rounds
    .query(
      Q.where('local_photo_uri', Q.notEq(null)),
      Q.where('photo_key', null),
      Q.take(limit),
    )
    .fetch();

  return rounds;
}

export async function uploadPendingPhotos(
  options: PhotoUploadOptions,
): Promise<PhotoUploadResult> {
  const { apiBaseUrl, getAccessToken, limit = 10 } = options;

  const token = await getAccessToken();
  if (token === null) return { uploaded: 0, failed: 0, remaining: 0 };

  const rounds = await pendingUploads(limit);
  if (rounds.length === 0) return { uploaded: 0, failed: 0, remaining: 0 };

  let uploaded = 0;
  let failed = 0;

  for (const round of rounds) {
    try {
      await uploadOne(round, apiBaseUrl, token);
      uploaded += 1;
    } catch (error) {
      // One unreadable file or expired URL must not stop the rest. The round
      // keeps its local photo and is retried on the next sync.
      console.error('[photos] upload failed for round', round.id, error);
      failed += 1;
    }
  }

  const remaining = await collections.rounds
    .query(
      Q.where('local_photo_uri', Q.notEq(null)),
      Q.where('photo_key', null),
    )
    .fetchCount();

  return { uploaded, failed, remaining };
}

async function uploadOne(
  round: Round,
  apiBaseUrl: string,
  token: string,
): Promise<void> {
  const localUri = round.localPhotoUri;
  if (!localUri) return;

  const presignResponse = await fetchWithTimeout(
    `${apiBaseUrl}/rounds/${round.id}/photo-url`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    },
  );

  if (presignResponse.status === 503) {
    // Photo storage is not configured for this environment. Not an error the
    // archer can act on, and not worth retrying this run.
    throw new Error('photo storage unavailable');
  }

  if (!presignResponse.ok) {
    throw new Error(
      `presign failed (${presignResponse.status}): ${await presignResponse.text()}`,
    );
  }

  const { uploadUrl, photoKey } =
    (await presignResponse.json()) as PresignResponse;

  // Read the local file as bytes. fetch() on a file:// URI is how React
  // Native exposes it without pulling in a filesystem module.
  const fileResponse = await fetch(localUri);
  const blob = await fileResponse.blob();

  const putResponse = await fetchWithTimeout(uploadUrl, {
    method: 'PUT',
    body: blob,
    // Must match the Content-Type the URL was signed with, or S3 rejects it.
    headers: { 'Content-Type': 'image/jpeg' },
    // A photo is a real payload over the same poor connection, so it gets
    // longer than an API call before being abandoned.
    timeoutMs: UPLOAD_TIMEOUT_MS,
  });

  if (!putResponse.ok) {
    throw new Error(
      `upload failed (${putResponse.status}): ${await putResponse.text()}`,
    );
  }

  // Only now is the key recorded. Written locally rather than PATCHed to the
  // API so the change flows through the normal sync path and survives being
  // offline immediately afterwards.
  await database.write(async () => {
    await round.update((r: Round) => {
      r.photoKey = photoKey;
      r.updatedAt = new Date();
    });
  });
}

/**
 * A viewable URL for a round's photo.
 *
 * Prefers the local file — it is instant and works offline. Falls back to a
 * short-lived signed GET, which is how a photo taken on one device becomes
 * visible on another.
 */
export async function resolvePhotoUri(
  round: Round,
  options: { apiBaseUrl: string; getAccessToken: () => Promise<string | null> },
): Promise<string | null> {
  if (round.localPhotoUri) return round.localPhotoUri;
  if (!round.photoKey) return null;

  try {
    const token = await options.getAccessToken();
    if (token === null) return null;

    const response = await fetchWithTimeout(
      `${options.apiBaseUrl}/rounds/${round.id}/photo-url`,
      { headers: { Authorization: `Bearer ${token}` } },
    );

    if (!response.ok) return null;

    const { url } = (await response.json()) as { url: string };
    return url;
  } catch (error) {
    // A missing photo degrades to marking on a blank face, which is the
    // manual-entry path and entirely usable.
    console.error('[photos] could not resolve remote photo', error);
    return null;
  }
}
