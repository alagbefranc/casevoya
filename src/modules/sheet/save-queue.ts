/**
 * One save at a time, for an autosaving screen whose saves carry a version (the intake builder).
 * A save asked for while one is on its way runs right after it, so it sends the version the
 * first one returned instead of the same stale one. `send` answers whether the save went
 * through; a save that throws (offline, a server error, a deploy in between) counts as failed,
 * and the queue is always free again afterwards. After a failure nothing is retried on its own:
 * the next change, or Publish, asks again.
 */
export function saveQueue(send: () => Promise<boolean>, onThrow?: (error: unknown) => void) {
  let current: Promise<boolean> | null = null;
  let again = false;

  const drain = async (): Promise<boolean> => {
    let ok = false;
    try {
      do {
        again = false;
        try {
          ok = await send();
        } catch (error) {
          ok = false;
          onThrow?.(error);
        }
      } while (again && ok);
    } finally {
      current = null;
    }
    return ok;
  };

  return {
    /** Saves now, or right after the save on its way. Resolves once nothing is left to send. */
    save(): Promise<boolean> {
      if (current) {
        again = true;
        return current;
      }
      current = drain();
      return current;
    },
    get busy(): boolean {
      return current !== null;
    },
    /** Waits for the saves on their way: false when the last one failed. */
    settled(): Promise<boolean> {
      return current ?? Promise.resolve(true);
    },
  };
}
