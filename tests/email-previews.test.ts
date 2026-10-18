/**
 * Review copies of every email, rendered from synthetic data, kept in docs/email as file
 * snapshots: this test fails when a renderer changes and the committed preview was not refreshed.
 * Refresh with `pnpm email:previews` (vitest -u on this file).
 *
 *   docs/email/previews/*.html        every design; wired ones go through renderEmail exactly as
 *                                      the mail worker calls it (database template + context)
 *   docs/email/supabase-auth/*.html   ready-to-paste Supabase Auth templates (EM03, EM04, EX01)
 */
import { describe, expect, it } from "vitest";
import { EMAIL_TEMPLATES, type TemplateId } from "@/modules/email/designs/catalog";
import { DEFAULT_EMAIL_ORIGIN, escapeHtml, renderCopy, type EmailCopy } from "@/modules/email/designs/layout";
import { renderEmail } from "@/modules/email/templates";

const FIRM = "Maple Example Immigration";
const TOKEN = "0".repeat(64);
const INVOICE = "00000000-0000-4000-8000-000000000010";

/** Wired designs, rendered from the context prepare_email_delivery queues for them. */
const WIRED: Record<string, Record<string, unknown>> = {
  EM01: { template: "invite", firm: FIRM, kind: "staff", role: "case_manager", inviter: "Sam Example", link: `${DEFAULT_EMAIL_ORIGIN}/invite/${TOKEN}` },
  EM02: { template: "invite", firm: FIRM, kind: "portal", role: "client", inviter: "Sam Example", link: `${DEFAULT_EMAIL_ORIGIN}/accept/client?token=${TOKEN}` },
  EX04: { template: "invite", firm: FIRM, kind: "portal", role: "adult_dependant", inviter: "Sam Example", link: `${DEFAULT_EMAIL_ORIGIN}/accept/family?token=${TOKEN}` },
  EM06: { template: "document_request", firm: FIRM, due_on: "2026-11-06" },
  EM07: { template: "reminder", firm: FIRM, reminder_kind: "routine", due_on: "2026-10-30" },
  EM08: { template: "agreement", firm: FIRM, agreement_kind: "service" },
  "EM08-staff": { template: "agreement", firm: FIRM, audience: "staff", agreement_kind: "service" },
  EM09: { template: "signature", firm: FIRM, agreement_kind: "service" },
  "EM09-staff": { template: "signature", firm: FIRM, audience: "staff", agreement_kind: "service" },
  EX06: { template: "document_receipt", firm: FIRM, status: "accepted" },
  "EX06-received": { template: "document_receipt", firm: FIRM, status: "received" },
  EM10: { template: "invoice", firm: FIRM, invoice_id: INVOICE, invoice_number: "INV-0001", due_on: "2026-11-06" },
  EX08: { template: "payment_failed", firm: FIRM, invoice_id: INVOICE, invoice_number: "INV-0001", due_on: "2026-11-06" },
  EX09: { template: "refund_started", firm: FIRM, invoice_id: INVOICE, invoice_number: "INV-0001" },
  EX10: { template: "refund_complete", firm: FIRM, invoice_id: INVOICE, invoice_number: "INV-0001" },
};

function slug(name: string): string {
  return name.toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function previewFile(id: TemplateId): string {
  return `${id}-${slug(EMAIL_TEMPLATES[id].name)}.html`;
}

function preview(id: TemplateId) {
  const wired = WIRED[id];
  if (EMAIL_TEMPLATES[id].status === "wired") {
    expect(wired, `${id} is wired, so it previews through renderEmail`).toBeDefined();
    const email = renderEmail(wired);
    expect(email.design).toBe(id);
    return email;
  }
  const def = EMAIL_TEMPLATES[id];
  return renderCopy(def.build(def.sample as never, DEFAULT_EMAIL_ORIGIN), DEFAULT_EMAIL_ORIGIN);
}

/** Puts the subject and preheader where a reviewer sees them, as an HTML comment. */
function withHeader(id: string, subject: string, preheaderText: string, html: string): string {
  const inner = `${id} · synthetic preview data only · Subject: ${subject} · Preheader: ${preheaderText}`.replaceAll("--", "- -");
  return html.replace("<body", `<!-- ${inner} -->\n<body`);
}

const IDS = Object.keys(EMAIL_TEMPLATES) as TemplateId[];

describe("email previews", () => {
  it.each(IDS)("%s preview is current", async (id) => {
    const email = preview(id);
    await expect(withHeader(id, email.subject, email.preheader, email.html)).toMatchFileSnapshot(
      `../docs/email/previews/${previewFile(id)}`,
    );
  });

  it("indexes every preview with its subject, preheader and status", async () => {
    const rows = IDS.map((id) => {
      const def = EMAIL_TEMPLATES[id];
      const email = preview(id);
      return (
        `<tr><td><a href="${previewFile(id)}">${escapeHtml(id)}</a></td><td>${escapeHtml(def.name)}</td>` +
        `<td>${escapeHtml(def.status)}</td><td>${escapeHtml(email.subject)}</td><td>${escapeHtml(email.preheader)}</td></tr>`
      );
    });
    const html =
      `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>Casevoya email previews</title>` +
      `<style>body{font-family:Georgia,serif;margin:24px;color:#111}table{border-collapse:collapse;width:100%}` +
      `td,th{border-bottom:1px solid #eeebe6;padding:6px 8px;text-align:left;font-size:14px;vertical-align:top}</style></head><body>\n` +
      `<h1>Casevoya email previews</h1>\n<p>Synthetic data only. Generated by tests/email-previews.test.ts; see docs/EMAIL-TEMPLATES.md.</p>\n` +
      `<table><thead><tr><th>ID</th><th>Name</th><th>Status</th><th>Subject</th><th>Preheader</th></tr></thead><tbody>\n` +
      `${rows.join("\n")}\n</tbody></table>\n</body></html>\n`;
    await expect(html).toMatchFileSnapshot("../docs/email/previews/index.html");
  });
});

/**
 * Supabase Auth sends verify, sign-in code and password reset mail itself. These are the approved
 * designs with Supabase's Go template variables in place of the merge values, to paste into
 * Authentication > Email Templates. Not switched on by this change.
 */
const AUTH: { file: string; copy: EmailCopy }[] = [
  {
    file: "confirm-signup.html",
    copy: {
      subject: "Verify your email",
      preheader: "Confirm your email to finish setting up Casevoya.",
      heading: "Verify your email",
      body: "Use code {{ .Token }} or the button below to confirm your email and finish setting up Casevoya. If this wasn’t you, ignore this email.",
      cta: { label: "Verify email", href: `${DEFAULT_EMAIL_ORIGIN}/__CONFIRMATION_URL__` },
      spot: "verify",
      brand: { kind: "platform" },
    },
  },
  {
    file: "magic-link.html",
    copy: {
      subject: "Your sign-in code",
      preheader: "Use this code to finish signing in.",
      heading: "Your sign-in code",
      body: "Use code {{ .Token }} to finish signing in. It expires in 10 minutes. If this wasn’t you, ignore this email.",
      cta: null,
      spot: "sign-in-code",
      brand: { kind: "platform" },
    },
  },
  {
    file: "reset-password.html",
    copy: {
      subject: "Reset your password",
      preheader: "Use the code or the button to choose a new password.",
      heading: "Reset your password",
      body: "Use code {{ .Token }} within 15 minutes to choose a new password. If you didn’t ask, you can ignore this email; your password stays the same.",
      cta: { label: "Choose a new password", href: `${DEFAULT_EMAIL_ORIGIN}/__CONFIRMATION_URL__` },
      spot: "sign-in-code",
      brand: { kind: "platform" },
    },
  },
];

describe("Supabase Auth templates", () => {
  it.each(AUTH)("$file is current", async ({ file, copy }) => {
    const html = renderCopy(copy).html.replaceAll(`${DEFAULT_EMAIL_ORIGIN}/__CONFIRMATION_URL__`, "{{ .ConfirmationURL }}");
    expect(html).toContain("{{ .Token }}");
    expect(html).not.toContain("__CONFIRMATION_URL__");
    await expect(html).toMatchFileSnapshot(`../docs/email/supabase-auth/${file}`);
  });
});
