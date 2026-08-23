/**
 * Serialises async writes without dropping any.
 *
 * The alternative — a boolean "busy" guard that returns early — silently
 * discards work submitted while a write is in flight. On the marking screen
 * that meant losing arrows during exactly the bursts an archer taps fastest,
 * with no feedback that anything went missing.
 *
 * A queue costs nothing by comparison: submissions are applied in order, and a
 * failure is reported without stalling the ones behind it.
 */

export interface QueuedWrite {
  /** The work to perform. */
  run: () => Promise<void>;
  /** Shown to the user if `run` throws. */
  failureMessage: string;
}

export interface WriteQueueOptions {
  /** Called with the failure message of any task that throws. */
  onError?: (message: string, error: unknown) => void;
}

export interface WriteQueue {
  /** Submit work. Resolves when this task has settled. */
  push: (write: QueuedWrite) => Promise<void>;
  /** Resolves when everything currently queued has settled. */
  drain: () => Promise<void>;
  /** How many tasks are queued or running. Diagnostics and tests. */
  readonly pending: number;
}

export function createWriteQueue(options: WriteQueueOptions = {}): WriteQueue {
  let tail: Promise<void> = Promise.resolve();
  let pending = 0;

  const push = (write: QueuedWrite): Promise<void> => {
    pending += 1;

    // Chaining off `tail` — not off the previous task's result — is what keeps
    // ordering intact while letting each task settle independently.
    tail = tail.then(async () => {
      try {
        await write.run();
      } catch (error) {
        // Deliberately swallowed after reporting: rethrowing would poison the
        // chain and every write queued behind this one would never run.
        options.onError?.(write.failureMessage, error);
      } finally {
        pending -= 1;
      }
    });

    return tail;
  };

  return {
    push,
    drain: () => tail,
    get pending() {
      return pending;
    },
  };
}
