export type EmailContent = { subject: string; html: string; text: string };

type Context = Record<string, unknown>;

function textOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function firmName(context: Context): string {
  const firm = textOf(context.firm).trim();
  return firm || "Your firm";
}

function document(subject: string, paragraph: string, firm: string): EmailContent {
  const html = `<!DOCTYPE html><html><body><p>${escapeHtml(paragraph)}</p><p>${escapeHtml(firm)}</p></body></html>`;
  return { subject, html, text: `${paragraph}\n\n${firm}\n` };
}

/**
 * The invitation email's paragraph in two parts: who invited them, then where the link is.
 * The staff screens preview exactly this copy before an invitation is sent.
 */
export function inviteEmailLines(firm: string, kind: "staff" | "portal"): { lead: string; rest: string } {
  const name = firm.trim() || "Your firm";
  return {
    lead: `${name} invited you to ${kind === "staff" ? "a staff seat" : "the client portal"}.`,
    rest: "The private link is not in this email. Use the link the firm gives you.",
  };
}

/** HTML and text for one template. Copy stays generic: no token, no file body, no case narrative. */
export function renderEmail(context: Context): EmailContent {
  const firm = firmName(context);
  const template = textOf(context.template);
  if (template === "invite") {
    const lines = inviteEmailLines(firm, textOf(context.kind) === "staff" ? "staff" : "portal");
    return document(`Invitation from ${firm}`, `${lines.lead} ${lines.rest}`, firm);
  }
  if (template === "reminder") {
    const due = textOf(context.due_on).trim();
    const paragraph = due
      ? `${firm} has a date on your file (${due}). Open the portal for what to do next.`
      : `${firm} has a date on your file. Open the portal for what to do next.`;
    return document(`Reminder from ${firm}`, paragraph, firm);
  }
  if (template === "agreement") {
    return document(
      `Agreement ready to sign — ${firm}`,
      `${firm} has an agreement ready for you to review and sign in the portal.`,
      firm,
    );
  }
  if (template === "signature") {
    return document(
      `Agreement signed — ${firm}`,
      `An agreement with ${firm} is fully signed. Your copy is in the portal.`,
      firm,
    );
  }
  if (template === "document_request") {
    const purpose = textOf(context.purpose).trim();
    const due = textOf(context.due_on).trim();
    const detail = purpose ? ` They asked for: ${purpose}.` : "";
    const when = due ? ` Due ${due}.` : "";
    return document(
      `Document requested — ${firm}`,
      `${firm} asked you to upload a document.${detail}${when} Use the portal upload.`,
      firm,
    );
  }
  return document(`Document received — ${firm}`, `${firm} received a document on your file. It is in the portal.`, firm);
}
