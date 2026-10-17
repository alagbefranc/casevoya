import { safeAccessError } from "@/lib/auth/step-up";

/** Maps database refusals to short portal copy. Never returns the raw message. */
export function agreementError(message: string): string {
  if (/consent/i.test(message)) return "Confirm that you agree to sign electronically.";
  if (/not your turn/i.test(message)) return "Someone else signs before you.";
  if (/expired/i.test(message)) return "This agreement expired. Ask your firm for a new copy.";
  if (/no longer open|cannot be edited|cannot be voided|cannot be declined/i.test(message)) {
    return "This agreement is no longer open for signature.";
  }
  if (/identity does not match/i.test(message)) return "This signature is waiting for someone else.";
  if (/licence blocks/i.test(message)) return "A licence hold is blocking new agreements.";
  if (/quote/i.test(message)) return "That quote cannot be accepted.";
  if (/sample mode/i.test(message)) return "This firm is still in sample mode.";
  return safeAccessError(message);
}
