/**
 * Pure helpers for the firm's client portal terms of use and privacy notice
 * (public.portal_policy_documents, published through public.publish_portal_policy):
 * the starting drafts a firm edits before publishing, what the publish dialog sends,
 * the next version label, and where a step-up goes. The database decides every publish.
 *
 * The drafts are a starting point, not legal advice. The privacy notice is also the firm's public
 * notice (/privacy/<firm>, #263-A); its template is neutral and names no law (see
 * defaultPrivacyNotice; sources for the terms: docs/legal/portal-policy-sources.md).
 */

import { stepUpHref } from "@/lib/auth/mfa-step";

export const POLICY_KINDS = ["portal_terms", "privacy_notice"] as const;
export type PolicyKind = (typeof POLICY_KINDS)[number];

/** The database's limits (portal_policy_documents check constraints). */
export const POLICY_BODY_MAX = 8000;
export const POLICY_TITLE_MAX = 200;
const VERSION_LABEL = /^[A-Za-z0-9._-]{1,40}$/;

/** Roles public.publish_portal_policy accepts (with aal2 and a recent step-up). */
export const POLICY_PUBLISHERS = ["firm_owner", "licensed_consultant"] as const;

export function canPublishPolicies(role: string): boolean {
  return (POLICY_PUBLISHERS as readonly string[]).includes(role);
}

/** The Settings tab that shows and publishes them. */
export const POLICY_PAGE = "/sheet/settings?tab=portal";

/** `?dlg=` values that reopen each publish dialog after a step-up, and the dialog ids. */
export const POLICY_DIALOG: Record<PolicyKind, { param: string; id: string }> = {
  portal_terms: { param: "terms", id: "dlgTerms" },
  privacy_notice: { param: "privacy", id: "dlgPrivacy" },
};

export function policyKindForDialog(param: string | null | undefined): PolicyKind | null {
  return POLICY_KINDS.find((kind) => POLICY_DIALOG[kind].param === param) ?? null;
}

export function isPolicyKind(value: string): value is PolicyKind {
  return (POLICY_KINDS as readonly string[]).includes(value);
}

export const POLICY_NAME: Record<PolicyKind, string> = {
  portal_terms: "Portal terms of use",
  privacy_notice: "Privacy notice",
};

export type CurrentPolicy = {
  id: string;
  kind: PolicyKind;
  versionLabel: string;
  title: string;
  body: string;
  publishedAt: string;
};

export type CurrentPolicies = Record<PolicyKind, CurrentPolicy | null>;

/** The newest published row of each kind, as app.current_portal_policy picks it. */
export function currentPolicies(
  rows: readonly { id: string; kind: string; version_label: string; title: string; body: string; published_at: string }[],
  options: { privacyWithdrawnAt?: string | null } = {},
): CurrentPolicies {
  const current: CurrentPolicies = { portal_terms: null, privacy_notice: null };
  const sorted = [...rows].sort((a, b) => b.published_at.localeCompare(a.published_at) || b.id.localeCompare(a.id));
  // #263-A: a privacy notice published at or before the firm's last unpublish is not current.
  const withdrawn = options.privacyWithdrawnAt ? Date.parse(options.privacyWithdrawnAt) : Number.NaN;
  for (const row of sorted) {
    if (!isPolicyKind(row.kind) || current[row.kind]) continue;
    if (row.kind === "privacy_notice" && Number.isFinite(withdrawn) && !(Date.parse(row.published_at) > withdrawn)) continue;
    current[row.kind] = { id: row.id, kind: row.kind, versionLabel: row.version_label, title: row.title, body: row.body, publishedAt: row.published_at };
  }
  return current;
}

/** The kinds a client still cannot accept, in the order the accept screen asks for them. */
export function missingPolicies(current: CurrentPolicies): PolicyKind[] {
  return POLICY_KINDS.filter((kind) => !current[kind]);
}

/** Why an invitation is not sent while either document is unpublished. */
export const POLICIES_MISSING =
  "Publish your client portal terms and privacy notice first (Settings > Client portal). Until then an invited client can’t join.";

/** "1" first; then the trailing number goes up ("1" → "2", "v1.4" → "v1.5"); otherwise "-2" is added. */
export function nextVersionLabel(current: string | null | undefined): string {
  const label = (current ?? "").trim();
  if (!label) return "1";
  const match = /^(.*?)(\d+)$/.exec(label);
  const next = match ? `${match[1]}${Number(match[2]) + 1}` : `${label}-2`;
  return next.length <= 40 ? next : "1";
}

export type FirmFacts = {
  /** organizations.display_name. */
  firmName: string;
  /** organizations.privacy_contact_name / privacy_contact_email; null when the firm has not set them. */
  privacyContactName: string | null;
  privacyContactEmail: string | null;
};

/** A blank the firm must fill before publishing. The publish check refuses text that still has one. */
const BLANK = /\[Add [^\]]*\]/;

function contactLine(firm: FirmFacts): string {
  const name = firm.privacyContactName?.trim() || "[Add the name of your privacy officer]";
  const email = firm.privacyContactEmail?.trim() || "[Add your privacy contact email]";
  return `${name}, ${email}`;
}

function firmName(firm: FirmFacts): string {
  return firm.firmName.trim() || "[Add your firm’s name]";
}

/** A short client portal terms of use, in plain language, with the firm's details filled in. */
export function defaultPortalTerms(firm: FirmFacts): { title: string; body: string } {
  const name = firmName(firm);
  const body = `These terms cover your use of the secure client portal that ${name} ("we", "us") gives you for your immigration file. They sit alongside your retainer agreement with us. If the two say different things, your retainer agreement applies.

1. Who can use the portal
Only the person we invited can use their portal account. Your invitation link works once and expires. Keep your sign-in details private and do not share your account. Each adult on a file gets their own account. A parent or legal guardian may act for a child only when we have their authority on file.

2. What the portal is for
You can use the portal to send us documents, answer our questions, see your tasks and deadlines, read messages from us and sign documents. The portal does not replace advice from your licensed consultant. If something in the portal is unclear, ask us before you act on it.

3. Government status
Any application status shown in the portal is what our team has recorded. It is not a live feed from Immigration, Refugees and Citizenship Canada (IRCC) or any other government office. Always read the letters and messages you receive from IRCC, and send us a copy as soon as you get them.

4. Your information must be true and complete
Give us information and documents that are true, complete and up to date, and tell us quickly when something changes. Giving false or incomplete information to IRCC can lead to a refusal or a finding of misrepresentation. Only upload documents that are yours or that you have permission to share.

5. Deadlines and reminders
We send reminders by email, and by text if you choose. Reminders can be delayed or fail, so keep your contact details current and check the portal regularly. Tell us right away if you cannot meet a deadline.

6. Using the portal safely
Do not try to reach information that is not yours, upload harmful files or interfere with the portal. We may pause your access to protect you, other clients or our records. We will tell you why when we can.

7. Availability
We work to keep the portal available, but it may sometimes be offline for maintenance or for reasons outside our control. Keep your own copies of important documents.

8. Your privacy
Our privacy notice explains what personal information we collect, why, who we share it with and your choices. You accept it separately when you join.

9. Ending your access
You can ask us to close your portal account at any time. We close access when your file ends or if these terms are not followed. We keep your file records for as long as the law and our professional rules require.

10. Changes to these terms
If we change these terms, we publish a new version and ask you to accept it before you continue. Earlier versions stay on record.

Questions
Contact ${name} through the portal, or our privacy contact: ${contactLine(firm)}.`;
  return { title: "Client portal terms of use", body };
}

/**
 * The firm's privacy notice template (#263-A). One notice serves the public page (/privacy/<firm>,
 * linked from the booking and enquiry pages) and the client portal. It is a template the firm
 * reviews, not legal advice: plain, neutral wording, no claim about which law applies or what it
 * requires, only that the firm is responsible. Every part the firm must decide is an `[Add …]`
 * blank, and the first line asks for the review itself, so the publish check (readPolicyDraft)
 * refuses the template until the firm has worked through it.
 */
export const PRIVACY_TEMPLATE_REVIEW =
  "[Add your review: this is a starting template, not legal advice. Read every section, change anything that doesn’t match how your firm works, then delete this line.]";

export function defaultPrivacyNotice(firm: FirmFacts): { title: string; body: string } {
  const name = firmName(firm);
  const body = `${PRIVACY_TEMPLATE_REVIEW}

This notice explains how ${name} ("we", "us") handles personal information about people who contact us, book a consultation with us, or become our clients.

Who is responsible
${name} is responsible for the personal information described here and for meeting the privacy obligations that apply to it. Questions and requests go to: ${contactLine(firm)}.

What we collect
- When you send us an enquiry or book a consultation: your name, how to reach you, and what you choose to tell us about your situation.
- When you become a client: the information and documents your file needs. [Add the main kinds of information your firm collects from clients.]
- When you use our client portal: a record of when you sign in and what you upload, kept for security.

Why we use it
- to reply to your enquiry and arrange consultations;
- to provide the services you ask us for;
- to keep you informed about your file;
- [Add any other purposes your firm uses personal information for.]
We don't use your information for a purpose not listed here without asking you first, unless we are required or allowed to.

Who we share it with
[Add who your firm shares personal information with, and why.]
We use Casevoya for our case management, booking pages and client portal. It handles information on our behalf.

Where it is stored
[Add where your firm and its service providers store personal information.]

How long we keep it
[Add how long you keep enquiries that don't become clients, and client files after they close.]

How we protect it
Access is limited to the people who need it for their work, and our staff use two-step sign-in. [Add any other safeguards your firm uses.]

Your choices
You can ask us what personal information we hold about you, ask us to correct it, or withdraw your consent to a use that is optional, by contacting us at the address above. [Add how and when your firm answers these requests.]

Questions and complaints
Contact us first at the address above. [Add where someone can take a complaint if they aren't satisfied with our answer.]

Changes to this notice
If we change this notice, we publish a new version. Earlier versions stay on record.`;
  return { title: "Privacy notice", body };
}

export function defaultPolicy(kind: PolicyKind, firm: FirmFacts): { title: string; body: string } {
  return kind === "portal_terms" ? defaultPortalTerms(firm) : defaultPrivacyNotice(firm);
}

export type PolicyDraft = { kind: PolicyKind; versionLabel: string; title: string; body: string };

/** What the publish dialog sends, or the first thing to fix. The database checks all of it again. */
export function readPolicyDraft(fields: {
  kind?: string | null;
  versionLabel?: string | null;
  title?: string | null;
  body?: string | null;
}): { input: PolicyDraft } | { error: string } {
  const kind = (fields.kind ?? "").trim();
  if (!isPolicyKind(kind)) return { error: "Choose the terms of use or the privacy notice." };
  const versionLabel = (fields.versionLabel ?? "").trim();
  if (!versionLabel) return { error: "Add a version label, for example 1 or 2026-10." };
  if (!VERSION_LABEL.test(versionLabel)) return { error: "Use only letters, numbers, dots, dashes or underscores in the version label (up to 40)." };
  const title = (fields.title ?? "").trim();
  if (!title) return { error: "Add a title." };
  if (title.length > POLICY_TITLE_MAX) return { error: `Keep the title under ${POLICY_TITLE_MAX} characters.` };
  const body = (fields.body ?? "").replace(/\r\n/g, "\n").trim();
  if (!body) return { error: "Add the text clients will read." };
  if (body.length > POLICY_BODY_MAX) return { error: `Keep the text to ${POLICY_BODY_MAX.toLocaleString("en-CA")} characters. It has ${body.length.toLocaleString("en-CA")}.` };
  const blanks = body.match(new RegExp(BLANK.source, "g"));
  if (blanks) {
    const first = blanks[0].length > 70 ? `${blanks[0].slice(0, 67)}…]` : blanks[0];
    const more = blanks.length > 1 ? ` (${blanks.length} left)` : "";
    return { error: `Replace or delete each part in square brackets that starts with “Add”${more}. Next one: ${first}` };
  }
  return { input: { kind, versionLabel, title, body } };
}

/** User-facing copy for a refused publish. Never passes a database message through. */
export function policyPublishError(error: { code?: string | null; message: string }): string | null {
  if (error.code === "23505" || /duplicate key|unique/i.test(error.message)) return "That version label is already published. Use a new one.";
  if (/incomplete/i.test(error.message)) return "Check the version label, title and text, then try again.";
  return null;
}

/** The step-up screen, coming back to Settings > Client portal with the same dialog open again. */
export function policyStepUpLocation(pathname: string, search: string, kind: PolicyKind): string {
  const params = new URLSearchParams(search);
  params.set("tab", "portal");
  params.set("dlg", POLICY_DIALOG[kind].param);
  return stepUpHref(`${pathname}?${params.toString()}`, "portal_policy");
}
