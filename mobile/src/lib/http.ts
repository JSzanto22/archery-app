/**
 * HTTP with a deadline.
 *
 * Every network call in the app previously used bare `fetch`, which has no
 * timeout: a connection that opens and then stalls — a phone on one bar at the
 * far end of a field, a captive portal that swallows traffic — leaves the
 * promise pending forever. `useSync` guards against concurrent runs with an
 * in-flight flag cleared in a `finally`, so a promise that never settles never
 * clears it, and sync is dead until the app is restarted.
 */

/** Long enough for a slow connection, short enough to fail before a user does. */
export const DEFAULT_TIMEOUT_MS = 20_000;

/** Uploads move real bytes over the same bad connections. */
export const UPLOAD_TIMEOUT_MS = 60_000;

export class TimeoutError extends Error {
  constructor(url: string, ms: number) {
    super(`Request to ${url} timed out after ${ms}ms`);
    this.name = 'TimeoutError';
  }
}

export interface FetchOptions extends RequestInit {
  timeoutMs?: number;
}

/**
 * `fetch` that always settles.
 *
 * Uses an AbortController rather than racing a timer, so a timed-out request
 * releases the socket instead of continuing in the background.
 */
export async function fetchWithTimeout(
  url: string,
  options: FetchOptions = {},
): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, signal, ...init } = options;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  // Honour a caller's own signal as well as the deadline.
  const onExternalAbort = () => controller.abort();
  signal?.addEventListener('abort', onExternalAbort);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    // An abort is indistinguishable from a network failure to the caller
    // otherwise, and the two want different messages.
    if (controller.signal.aborted && !signal?.aborted) {
      throw new TimeoutError(url, timeoutMs);
    }
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onExternalAbort);
  }
}
