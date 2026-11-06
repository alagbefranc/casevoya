/**
 * Facts a privacy-notice draft is allowed to use. The firm name and privacy contact come from the
 * firm record. The other lines are choices the owner makes in the dialog. Nothing here is a claim
 * that the notice complies with a law.
 */

export const CLIENT_INFO = ["identity", "immigration", "family", "fees"] as const;
export type ClientInfo = (typeof CLIENT_INFO)[number];

export const SHARING = ["casevoya_only", "government_when_asked"] as const;
export type SharingChoice = (typeof SHARING)[number];

export const COPIES = ["none", "office"] as const;
export type CopiesChoice = (typeof COPIES)[number];

export const RETENTION = ["professional_rules", "2", "6", "10"] as const;
export type RetentionChoice = (typeof RETENTION)[number];

export const ENQUIRIES = ["same", "90_days"] as const;
export type EnquiryChoice = (typeof ENQUIRIES)[number];

export const CLIENT_INFO_LABEL: Record<ClientInfo, string> = {
  identity: "name, contact details and identity documents",
  immigration: "immigration history and the documents a file needs",
  family: "family members the client names on a file",
  fees: "fee and payment details for the firm’s services",
};

const HEADINGS = [
  "Who is responsible",
  "What we collect",
  "Why we use it",
  "Who we share it with",
  "Where it is stored",
  "How long we keep it",
  "How we protect it",
  "Your choices",
  "Questions and complaints",
  "Changes to this notice",
] as const;

const ALWAYS_BANNED = [/PIPEDA/i, /GDPR/i, /SOC\s*2/i, /ISO\s*27001/i, /compliant/i, /legal advice/i, /encrypt/i, /\[/];

export type NoticeAnswers = {
  clientInfo: ClientInfo[];
  otherPurpose: string;
  sharing: SharingChoice;
  copies: CopiesChoice;
  retention: RetentionChoice;
  enquiries: EnquiryChoice;
  complaintName: string;
};

export type FirmNoticeRecord = {
  firmName: string;
  contactName: string;
  contactEmail: string;
  /** Saved compliance_settings.privacy_response_days, or null when the firm has not set one. */
  requestDays: number | null;
};

export type NoticeFacts = {
  firmName: string;
  contactName: string;
  contactEmail: string;
  collects: string[];
  purposes: string[];
  recipients: string[];
  storage: string;
  copies: string;
  retention: string;
  enquiries: string;
  safeguards: string[];
  requestAnswer: string;
  complaint: string;
};

function clean(value: unknown, max: number): string {
  return String(value ?? "")
    .replace(/[\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return allowed.includes(value as T) ? (value as T) : null;
}

/** The owner’s answers, or the first problem. Empty optional lines mean “do not add that fact”. */
export function readNoticeAnswers(input: Partial<NoticeAnswers> | null | undefined): { answers: NoticeAnswers } | { error: string } {
  const picked = Array.isArray(input?.clientInfo) ? input.clientInfo : [];
  const clientInfo = [...new Set(picked.filter((item): item is ClientInfo => oneOf(item, CLIENT_INFO) !== null))];
  if (clientInfo.length === 0) return { error: "Choose at least one kind of client information." };
  const sharing = oneOf(input?.sharing, SHARING);
  if (!sharing) return { error: "Choose who else, besides Casevoya, this notice may name." };
  const copies = oneOf(input?.copies, COPIES);
  if (!copies) return { error: "Choose whether you keep your own copies outside Casevoya." };
  const retention = oneOf(input?.retention, RETENTION);
  if (!retention) return { error: "Choose how long a closed client file is kept." };
  const enquiries = oneOf(input?.enquiries, ENQUIRIES);
  if (!enquiries) return { error: "Choose how long an enquiry that does not become a client is kept." };
  const otherPurpose = clean(input?.otherPurpose, 180);
  const complaintName = clean(input?.complaintName, 120);
  if (/\[/.test(otherPurpose) || /\[/.test(complaintName)) return { error: "Don’t use square brackets in an answer." };
  return { answers: { clientInfo, otherPurpose, sharing, copies, retention, enquiries, complaintName } };
}

/** The only sentences the model is allowed to turn into a notice. */
export function noticeFacts(firm: FirmNoticeRecord, answers: NoticeAnswers): NoticeFacts | { error: string } {
  const firmName = clean(firm.firmName, 200);
  const contactName = clean(firm.contactName, 200);
  const contactEmail = clean(firm.contactEmail, 320);
  if (!firmName) return { error: "Set the firm’s display name before drafting." };
  if (!contactName || !contactEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contactEmail)) {
    return { error: "Set a privacy contact name and email under Settings > Firm before drafting." };
  }
  const days = firm.requestDays;
  const requestDays = typeof days === "number" && Number.isInteger(days) && days >= 1 && days <= 365 ? days : null;
  const retention =
    answers.retention === "professional_rules"
      ? "Closed client files are kept for as long as the firm’s professional rules require. This notice does not name a number of years."
      : `Closed client files are kept for ${answers.retention} years after the file closes.`;
  const enquiries =
    answers.enquiries === "same"
      ? "Enquiries that do not become clients are kept for the same period."
      : "Enquiries that do not become clients are kept for 90 days.";
  return {
    firmName,
    contactName,
    contactEmail,
    collects: answers.clientInfo.map((item) => CLIENT_INFO_LABEL[item]),
    purposes: [
      "to reply to an enquiry and arrange a consultation",
      "to provide the services the client asks for",
      "to keep the client informed about their file",
      ...(answers.otherPurpose ? [answers.otherPurpose] : []),
    ],
    recipients:
      answers.sharing === "government_when_asked"
        ? [
            "Casevoya, which provides the firm’s case files, booking pages and client portal and handles personal information for the firm",
            "a government office, only when the client asks the firm to deal with that office",
          ]
        : ["Casevoya, which provides the firm’s case files, booking pages and client portal and handles personal information for the firm"],
    storage: "This notice does not name a storage country. None is recorded for this firm.",
    copies: answers.copies === "office" ? "The firm also keeps copies in its office." : "The firm does not describe any copy kept outside Casevoya.",
    retention,
    enquiries,
    safeguards: ["Access in Casevoya is limited to staff given a role.", "Staff sign in with two-step verification."],
    requestAnswer: requestDays
      ? `The firm’s saved target is to answer a privacy request within ${requestDays} days.`
      : "This notice does not name a number of days for answering a request. The firm has not saved one.",
    complaint: answers.complaintName
      ? `A person who is not satisfied can contact ${answers.complaintName}.`
      : "A person who is not satisfied contacts the privacy contact. This notice names no other body.",
  };
}

export function noticePrompt(facts: NoticeFacts): string {
  return [
    "Write a privacy notice in plain English for the firm named in the facts.",
    "Use only the facts. Do not add a country, a law, a regulator, a certification, a number of years, a number of days, or a recipient that the facts do not already state.",
    "Do not use square brackets. Do not say the notice is legal advice or that it complies with any law.",
    `Use these headings, each on its own line: ${HEADINGS.join("; ")}.`,
    "Facts:",
    JSON.stringify(facts),
  ].join("\n");
}

/** A model draft the editor may show, or why it was discarded. */
export function acceptNoticeDraft(text: string, facts: NoticeFacts): { body: string } | { error: string } {
  const body = text.replace(/\r\n/g, "\n").replace(/^```[a-z]*\n?|```$/g, "").trim();
  if (!body) return { error: "The draft came back empty." };
  if (body.length > 8000) return { error: "The draft was too long." };
  if (!HEADINGS.every((heading) => body.includes(heading))) return { error: "The draft did not cover every section." };
  if (!body.includes(facts.firmName) || !body.includes(facts.contactEmail)) return { error: "The draft left out the firm or the privacy contact." };
  if (ALWAYS_BANNED.some((pattern) => pattern.test(body))) return { error: "The draft added a claim that was not in the facts." };
  if (facts.storage.includes("does not name a storage country") && /\b(Canada|United States|USA|England|Europe)\b/i.test(body)) {
    return { error: "The draft named a storage country that was not on file." };
  }
  if (facts.retention.includes("does not name a number of years") && /\d+\s+years/i.test(body)) return { error: "The draft named a number of years that was not chosen." };
  if (!facts.recipients.some((line) => /government office/i.test(line)) && /government|IRCC/i.test(body)) return { error: "The draft named a recipient that was not chosen." };
  if (facts.copies.startsWith("The firm does not") && /our office/i.test(body)) return { error: "The draft described office copies that were not chosen." };
  if (facts.complaint.includes("names no other body") && /regulator|commissioner|college of immigration/i.test(body)) {
    return { error: "The draft named a complaint body that was not chosen." };
  }
  if (facts.requestAnswer.includes("does not name a number of days")) {
    const dayCount = body.match(/\b(\d+)\s+days\b/gi) ?? [];
    const allowed = facts.enquiries.includes("90 days") ? new Set(["90"]) : new Set<string>();
    if (dayCount.some((item) => !allowed.has(item.match(/\d+/)?.[0] ?? ""))) return { error: "The draft named a number of days that was not saved." };
  }
  return { body };
}
