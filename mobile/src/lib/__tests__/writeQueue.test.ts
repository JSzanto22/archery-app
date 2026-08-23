/**
 * The queue exists because the previous busy-flag guard dropped arrows during
 * fast score entry. These tests pin down that it does not.
 */

import { createWriteQueue } from '../writeQueue';

function deferred() {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('createWriteQueue', () => {
  it('applies every submission, even during an in-flight write', async () => {
    // The regression: six arrows tapped faster than the first write completes.
    const first = deferred();
    const order: number[] = [];
    const queue = createWriteQueue();

    queue.push({
      run: async () => {
        await first.promise;
        order.push(1);
      },
      failureMessage: 'x',
    });

    for (let i = 2; i <= 6; i++) {
      queue.push({
        run: async () => {
          order.push(i);
        },
        failureMessage: 'x',
      });
    }

    expect(queue.pending).toBe(6);

    first.resolve();
    await queue.drain();

    expect(order).toEqual([1, 2, 3, 4, 5, 6]);
    expect(queue.pending).toBe(0);
  });

  it('runs tasks strictly in order, never overlapping', async () => {
    const events: string[] = [];
    const queue = createWriteQueue();

    const slow = (name: string, ms: number) => ({
      run: async () => {
        events.push(`start:${name}`);
        await new Promise((r) => setTimeout(r, ms));
        events.push(`end:${name}`);
      },
      failureMessage: 'x',
    });

    // The slower task is queued first: if the queue overlapped, b would start
    // before a finished.
    queue.push(slow('a', 20));
    queue.push(slow('b', 1));
    await queue.drain();

    expect(events).toEqual(['start:a', 'end:a', 'start:b', 'end:b']);
  });

  it('reports a failure without stalling the queue behind it', async () => {
    const errors: string[] = [];
    const queue = createWriteQueue({
      onError: (message) => errors.push(message),
    });

    const done: string[] = [];

    queue.push({
      run: async () => {
        throw new Error('disk full');
      },
      failureMessage: 'That arrow did not save.',
    });
    queue.push({
      run: async () => {
        done.push('after');
      },
      failureMessage: 'x',
    });

    await queue.drain();

    expect(errors).toEqual(['That arrow did not save.']);
    // The critical part: a failed write must not silently kill every write
    // that follows it.
    expect(done).toEqual(['after']);
    expect(queue.pending).toBe(0);
  });

  it('passes the underlying error to the handler for logging', async () => {
    const seen: unknown[] = [];
    const queue = createWriteQueue({ onError: (_m, e) => seen.push(e) });
    const boom = new Error('boom');

    queue.push({
      run: async () => {
        throw boom;
      },
      failureMessage: 'x',
    });
    await queue.drain();

    expect(seen).toEqual([boom]);
  });

  it('resolves push() only once that task has settled', async () => {
    const gate = deferred();
    const queue = createWriteQueue();
    let settled = false;

    const pushed = queue
      .push({
        run: async () => {
          await gate.promise;
        },
        failureMessage: 'x',
      })
      .then(() => {
        settled = true;
      });

    expect(settled).toBe(false);
    gate.resolve();
    await pushed;
    expect(settled).toBe(true);
  });

  it('is reusable after draining', async () => {
    const queue = createWriteQueue();
    const done: number[] = [];

    queue.push({ run: async () => void done.push(1), failureMessage: 'x' });
    await queue.drain();

    queue.push({ run: async () => void done.push(2), failureMessage: 'x' });
    await queue.drain();

    expect(done).toEqual([1, 2]);
  });
});
