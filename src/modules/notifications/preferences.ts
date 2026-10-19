/**
 * Staff notification kinds and which of them a person may turn off (Settings > Notifications).
 * Pure; the database enforces the same list (app.staff_notification_switchable, migration
 * 20261019214000).
 *
 * Email the app actually sends a staff member today (src/modules/email/designs/catalog.ts):
 *   agreement_executed     EM09-staff  executed copy to a staff signer        switchable
 *   agreement_signer_turn  EM08-staff  "your turn to countersign"            LOCKED: a client's agreement waits on it
 *   security               EM01 staff invite, sign-in, MFA and password mail  LOCKED: security notices
 * In-app items (Sheet > Notifications) are never emailed and always shown; client notices follow
 * each client's own contact preferences and their critical notices can't be turned off.
 */

export type StaffEmailKind = "agreement_executed";

export const SWITCHABLE_EMAIL_KINDS: readonly StaffEmailKind[] = ["agreement_executed"];

export function isSwitchableEmailKind(kind: string): kind is StaffEmailKind {
  return (SWITCHABLE_EMAIL_KINDS as readonly string[]).includes(kind);
}

/** What the page lists, in order. `locked` rows are always sent; `inApp` rows are never emailed. */
export const STAFF_EMAIL_ROWS: readonly { kind: string; label: string; small: string; locked: boolean; why?: string }[] = [
  {
    kind: "agreement_executed",
    label: "An agreement I signed is fully signed",
    small: "The executed copy, with a link to it in Casevoya",
    locked: false,
  },
  {
    kind: "agreement_signer_turn",
    label: "It’s my turn to countersign an agreement",
    small: "A client’s agreement waits on your signature",
    locked: true,
    why: "can’t be turned off",
  },
  {
    kind: "security",
    label: "Sign-in, security and invitation emails",
    small: "Two-step verification, password and access notices",
    locked: true,
    why: "can’t be turned off",
  },
];

/** The kinds Sheet > Notifications lists (app.staff_notification_items). Not emailed. */
export const IN_APP_ROWS: readonly { kind: string; label: string; small: string }[] = [
  { kind: "message", label: "A client sends a message", small: "On matters you can open" },
  { kind: "document", label: "A client uploads a document", small: "Once the file check passes, on matters you can open" },
  { kind: "payment", label: "A card payment is received", small: "For the staff who handle that matter’s billing" },
  { kind: "booking", label: "A consultation is booked", small: "From the firm’s booking page, for scheduling staff" },
  { kind: "deadline", label: "A deadline reminder comes due", small: "On matters you can open" },
  { kind: "support", label: "Casevoya support asks for access", small: "Firm owners only. Nothing opens until you approve" },
];

/** Quiet hours turned on from Settings use the Designer's 21:00–08:00. */
export const DEFAULT_QUIET_HOURS = { start: "21:00", end: "08:00" } as const;
