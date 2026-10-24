import type { TemplateId } from "@/modules/email/designs/catalog";

/**
 * The header tagline of each firm email in English (ORG-01), naming what the email is about in a
 * word or two, in place of the shell's one line for every email. Generic on purpose: no file
 * details. Platform emails use the Casevoya header image, which has no tagline; the French drafts
 * (EM14a-c) and any French email keep the approved shared French tagline.
 */
export const TAGLINES: Partial<Record<TemplateId | "generic", string>> = {
  generic: "Updates on your file",
  EM02: "Your client portal",
  EM06: "Documents",
  EM07: "Reminders",
  EM08: "Agreements",
  EM09: "Agreements",
  EM10: "Invoices",
  EM11: "Receipts",
  EM15: "Updates on your file",
  EM16a: "Consultations",
  EM16b: "Consultations",
  EM16c: "Consultations",
  EX04: "Your client portal",
  EX05: "Documents",
  EX06: "Documents",
  "EX06-received": "Documents",
  EX07: "Messages",
  EX08: "Payments",
  EX09: "Refunds",
  EX10: "Refunds",
  EX13: "Privacy requests",
  EX14: "Complaints",
  EX15: "Messages",
  EX16: "Agreements",
};
