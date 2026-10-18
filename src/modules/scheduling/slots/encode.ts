/**
 * Compact wire form for slot starts: the first start in minutes since the Unix epoch, then each
 * later start as the minutes since the previous one. Starts are whole minutes, ascending, unique.
 */
import { SlotInputError } from "./errors";

const MINUTE = 60_000;

export function encodeStarts(starts: readonly number[]): number[] {
  const out: number[] = [];
  let previous = 0;
  for (let index = 0; index < starts.length; index++) {
    const start = starts[index];
    if (!Number.isFinite(start) || start % MINUTE !== 0) {
      throw new SlotInputError("invalid_encoding", "Slot starts must be whole minutes.");
    }
    const minutes = start / MINUTE;
    if (index === 0) {
      out.push(minutes);
    } else {
      if (minutes <= previous) throw new SlotInputError("invalid_encoding", "Slot starts must ascend.");
      out.push(minutes - previous);
    }
    previous = minutes;
  }
  return out;
}

export function decodeStarts(encoded: unknown): number[] {
  if (!Array.isArray(encoded)) throw new SlotInputError("invalid_encoding", "Encoded starts must be a list.");
  const out: number[] = [];
  let minutes = 0;
  for (let index = 0; index < encoded.length; index++) {
    const value = encoded[index];
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || (index > 0 && value === 0)) {
      throw new SlotInputError("invalid_encoding", "Encoded starts are positive whole numbers.");
    }
    minutes = index === 0 ? value : minutes + value;
    out.push(minutes * MINUTE);
  }
  return out;
}
