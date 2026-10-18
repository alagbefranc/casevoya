/**
 * Pure helpers for the firm's client portal terms of use and privacy notice
 * (public.portal_policy_documents, published through public.publish_portal_policy):
 * the starting drafts a firm edits before publishing, what the publish dialog sends,
 * the next version label, and where a step-up goes. The database decides every publish.
 *
 * The drafts are a starting point, not legal advice. The privacy notice follows the Office
 * of the Privacy Commissioner of Canada's guidance on PIPEDA's fair information principles
 * and meaningful consent (sources: docs/legal/portal-policy-sources.md).
 */

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
): CurrentPolicies {
  const current: CurrentPolicies = { portal_terms: null, privacy_notice: null };
  const sorted = [...rows].sort((a, b) => b.published_at.localeCompare(a.published_at) || b.id.localeCompare(a.id));
  for (const row of sorted) {
    if (!isPolicyKind(row.kind) || current[row.kind]) continue;
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
 * A plain-language privacy notice for a Canadian immigration consultancy's client portal, built on
 * PIPEDA's ten fair information principles (accountability, purposes, consent, limiting collection,
 * limiting use, disclosure and retention, accuracy, safeguards, openness, access, challenging
 * compliance) and the OPC's meaningful consent guidance (what, who, why, risks, choices, withdrawal).
 */
export function defaultPrivacyNotice(firm: FirmFacts): { title: string; body: string } {
  const name = firmName(firm);
  const body = `This notice explains how ${name} ("we", "us") handles your personal information when we work on your immigration file and when you use our client portal. We follow Canada's private-sector privacy law, the Personal Information Protection and Electronic Documents Act (PIPEDA), and any provincial privacy law that applies to us.

Who is responsible
${name} is responsible for the personal information we hold about you. Our privacy officer answers questions and handles requests: ${contactLine(firm)}.

What we collect
We collect only what we need for your file. This can include:
- your name, contact details, date of birth and identity documents, such as your passport;
- your immigration, travel, education, work, family and financial history;
- police certificates, and medical information when an application requires it;
- information about family members, sponsors or employers who are part of your application;
- portal records, such as when you sign in and what you upload, which we keep for security.
If you give us information about another person, please make sure they know and agree.

Why we collect it
We use your information to:
- assess your options and give you immigration advice;
- prepare, submit and follow up on your applications;
- communicate with you and remind you of tasks and deadlines;
- bill for our services under your retainer agreement;
- meet our legal and professional obligations, including the rules of the College of Immigration and Citizenship Consultants;
- keep the portal and your records secure.
We will not use your information for any other purpose without asking you first, unless the law requires or allows it.

Your choices and consent
When you join the portal, you agree to these essential uses. Some uses are optional, such as text message reminders. You can say no to an optional use and we will still work on your file. You can withdraw your consent at any time by contacting us. If you withdraw consent that we need to do the work, we will explain what that means for your file. Legal and contract limits may apply.

Who we share it with
- Immigration, Refugees and Citizenship Canada and other government offices, when we submit or follow up on an application for you.
- Service providers who help us run our practice, such as our client portal and case management software (Casevoya), email, e-signature and cloud hosting providers. They may use your information only to provide their service to us, and they must protect it.
- Others only with your consent, or when the law requires it, for example our regulator during an audit or a complaint, or a court order.
We do not sell your personal information.

Information stored outside your province or Canada
Some of our service providers may store or process information outside your province or outside Canada. [Add where your providers store client data, for example: in Canada and the United States.] Information held in another country can be accessed by that country's courts, law enforcement and national security authorities under its laws.

How long we keep it
We keep your information only as long as we need it for the purposes above and as the law and our professional rules require. [Add your retention period, for example: we keep closed client files for at least six years after the file closes, then destroy them securely.]

How we protect it
We use encrypted connections, two-step sign-in for our staff, access limited to the people who work on your file, and activity logs. Tell us right away if you think someone else has used your account. If a privacy breach creates a real risk of significant harm to you, we will tell you and report it to the Privacy Commissioner of Canada, as the law requires.

Accuracy, access and correction
Please help us keep your information accurate and up to date. You can ask to see the personal information we hold about you and ask us to correct it. Send your request to our privacy officer. We will answer within 30 days, or tell you if we need more time and why.

Questions and complaints
Contact our privacy officer first: ${contactLine(firm)}. If you are not satisfied with our answer, you can complain to the Office of the Privacy Commissioner of Canada (www.priv.gc.ca, 1-800-282-1376) or, where it applies, to your provincial privacy commissioner.

Changes to this notice
If we change this notice, we publish a new version and ask you to accept it before you continue. Earlier versions stay on record.`;
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
  return `/mfa?step=6&next=${encodeURIComponent(`${pathname}?${params.toString()}`)}`;
}
