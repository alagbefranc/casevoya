import { describe, expect, it } from "vitest";
import { saveQueue } from "@/modules/sheet/save-queue";

/** A send whose answers the test releases one at a time. */
function gate() {
  const calls: { resolve: (ok: boolean) => void; reject: (error: unknown) => void }[] = [];
  const send = () => new Promise<boolean>((resolve, reject) => calls.push({ resolve, reject }));
  return { calls, send };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("saveQueue (intake builder autosave)", () => {
  it("runs one save at a time and sends a change made meanwhile right after, once", async () => {
    const { calls, send } = gate();
    const queue = saveQueue(send);
    const first = queue.save();
    void queue.save();
    void queue.save();
    expect(calls).toHaveLength(1);
    expect(queue.busy).toBe(true);
    calls[0].resolve(true);
    await tick();
    // The two changes made during the first save go out together, after it.
    expect(calls).toHaveLength(2);
    calls[1].resolve(true);
    expect(await first).toBe(true);
    expect(queue.busy).toBe(false);
    expect(calls).toHaveLength(2);
  });

  it("a save that throws frees the queue: nothing sticks, the next save goes out, and it isn't retried on its own", async () => {
    const { calls, send } = gate();
    const thrown: unknown[] = [];
    const queue = saveQueue(send, (error) => thrown.push(error));
    const failed = queue.save();
    void queue.save();
    calls[0].reject(new Error("Failed to fetch"));
    expect(await failed).toBe(false);
    expect(thrown).toHaveLength(1);
    expect(queue.busy).toBe(false);
    // The change queued behind the failure isn't hammered at a dead connection.
    expect(calls).toHaveLength(1);
    expect(await queue.settled()).toBe(true);

    const next = queue.save();
    expect(calls).toHaveLength(2);
    calls[1].resolve(true);
    expect(await next).toBe(true);
  });

  it("stops after a refused save (a conflict) and reports it to whoever waits, like Publish", async () => {
    const { calls, send } = gate();
    const queue = saveQueue(send);
    const first = queue.save();
    void queue.save();
    const waiting = queue.settled();
    calls[0].resolve(false);
    expect(await first).toBe(false);
    expect(await waiting).toBe(false);
    expect(calls).toHaveLength(1);
  });
});
