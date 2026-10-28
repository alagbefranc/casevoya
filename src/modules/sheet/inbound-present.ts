/**
 * Pure presentation for inbound email capture (OPS-06): the matter's and the firm's inbound
 * addresses, and inbound email records on the matter's Timeline. No database access.
 */
import type { MatterEvent } from "@/components/sheet/designer/matter";
import type { InboundAddressData } from "@/components/sheet/designer/inbound-filing";
import { eventWhen } from "@/modules/sheet/matter-present";

/** The matter's address (from public.matter_inbound_address), or null when it couldn't be read. */
export function matterInboundAddress(value: unknown): InboundAddressData | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as { address?: unknown; matter_tag?: unknown };
  if (typeof record.address !== "string" || !record.address.includes("@")) return null;
  if (record.matter_tag !== true) {
    // A firm address too long for a matter tag (64-character local part): say so plainly.
    return {
      address: record.address,
      note: "Your firm’s address is too long to add a matter tag, so this is the firm address: mail sent here waits in Email to triage.",
    };
  }
  return {
    address: record.address,
    note: "Cc or forward email here to put it on this matter. It waits in Email to triage until someone files it; the sender gets no access and no automatic reply.",
  };
}

/** The firm's inbound address (Settings › Firm), slug@domain. */
export function firmInboundAddress(address: string): InboundAddressData {
  return {
    address,
    note: "Email sent or forwarded here lands in Inbox › Email to triage. Each matter also has its own address, shown on the matter. Senders get no automatic reply and no access to any matter.",
  };
}

export type TimelineEmailRow = {
  id: string;
  from_email: string;
  subject: string | null;
  triage_state: string;
  person_id: string | null;
  sender_verified: boolean;
  created_at: string;
};

/** Inbound email on a matter, newest first, as the Designer's Timeline rows (`.li`). */
export function timelineEmailEvents(
  rows: TimelineEmailRow[],
  input: { timeZone: string; today: string; personName: (id: string) => string | null; files: Map<string, number> },
): MatterEvent[] {
  return rows
    .filter((row) => row.triage_state !== "dismissed")
    .map((row) => {
      const filed = row.triage_state === "filed";
      const who = row.person_id ? input.personName(row.person_id) : null;
      const count = input.files.get(row.id) ?? 0;
      return {
        dot: filed ? "#0075DE" : "#c9c5c0",
        title: `Email from ${row.from_email}: ${(row.subject ?? "").trim() || "(no subject)"}`,
        parts: [
          filed ? (who ? `Filed to ${who}` : "Filed") : "Waiting in Email to triage",
          row.sender_verified ? "sender verified" : "sender not verified",
          ...(count ? [`${count} ${count === 1 ? "attachment" : "attachments"}`] : []),
        ],
        badge: filed ? { tone: "blue", label: "Email" } : { tone: "unv", label: "To triage" },
        when: eventWhen(row.created_at, input.timeZone, input.today),
      };
    });
}
