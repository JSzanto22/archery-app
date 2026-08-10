/**
 * A timeout that has never fired is a guess.
 *
 * The failure this guards is specific: `useSync` clears its in-flight flag in
 * a `finally`, so a fetch that never settles never clears it and sync is dead
 * for the lifetime of the app — silently, because nothing threw.
 */

import { TimeoutError, fetchWithTimeout } from '../http';

const realFetch = global.fetch;

afterEach(() => {
  global.fetch = realFetch;
  jest.useRealTimers();
});

/** A fetch that resolves only when the caller's signal aborts. */
function stallingFetch(): jest.Mock {
  return jest.fn((_url: string, init?: RequestInit) => {
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        const error = new Error('Aborted');
        error.name = 'AbortError';
        reject(error);
      });
    });
  });
}

describe('fetchWithTimeout', () => {
  it('returns the response when the server answers in time', async () => {
    const body = new Response('ok', { status: 200 });
    global.fetch = jest.fn().mockResolvedValue(body);

    const res = await fetchWithTimeout('https://example.test/health');

    expect(res.status).toBe(200);
  });

  it('rejects with TimeoutError when the connection stalls', async () => {
    global.fetch = stallingFetch();

    await expect(
      fetchWithTimeout('https://example.test/sync/pull', { timeoutMs: 20 }),
    ).rejects.toBeInstanceOf(TimeoutError);
  });

  it('names the url and deadline, so a log says which call hung', async () => {
    global.fetch = stallingFetch();

    await expect(
      fetchWithTimeout('https://example.test/slow', { timeoutMs: 15 }),
    ).rejects.toThrow(/example\.test\/slow.*15ms/);
  });

  it('aborts the request rather than leaving it running', async () => {
    const spy = stallingFetch();
    global.fetch = spy;

    await expect(
      fetchWithTimeout('https://example.test/x', { timeoutMs: 10 }),
    ).rejects.toBeInstanceOf(TimeoutError);

    // The socket is released, not merely ignored.
    const passedSignal = spy.mock.calls[0]![1]!.signal!;
    expect(passedSignal.aborted).toBe(true);
  });

  it('passes a network failure through untouched', async () => {
    // A genuine failure and a deadline want different messages, so they must
    // stay distinguishable.
    const failure = new TypeError('Network request failed');
    global.fetch = jest.fn().mockRejectedValue(failure);

    await expect(fetchWithTimeout('https://example.test/x')).rejects.toBe(
      failure,
    );
  });

  it("honours a caller's own abort signal", async () => {
    global.fetch = stallingFetch();
    const controller = new AbortController();

    const pending = fetchWithTimeout('https://example.test/x', {
      signal: controller.signal,
      timeoutMs: 10_000,
    });
    controller.abort();

    // A caller-initiated abort is not a timeout and must not be reported as one.
    await expect(pending).rejects.not.toBeInstanceOf(TimeoutError);
  });

  it('does not leave a timer running after a fast response', async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn().mockResolvedValue(new Response('ok'));

    await fetchWithTimeout('https://example.test/x', { timeoutMs: 5000 });

    // A leaked timer keeps a React Native app awake and stalls Jest teardown.
    expect(jest.getTimerCount()).toBe(0);
  });
});
