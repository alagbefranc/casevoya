/**
 * ORG-06: the client's portal notices (public.portal_notices_for_me): their consultant changed,
 * and (OPS-04) the firm's announcements, shown as the firm wrote them. Pure parsing and wording; the page loads them and Home shows them.
 */
export type PortalNotice = { id: string; title: string; body: string };

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** The notices as Home shows them, newest first. Anything not recognised is left out. */
export function portalNotices(raw: unknown, firmName: string): PortalNotice[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((row): PortalNotice[] => {
    if (!row || typeof row !== "object") return [];
    const item = row as Record<string, unknown>;
    const id = text(item.id);
    if (!id) return [];
    if (item.kind === "announcement") {
      const title = text(item.title);
      const body = text(item.body);
      return title && body ? [{ id, title, body }] : [];
    }
    if (item.kind !== "consultant_changed") return [];
    const matter = text(item.matter_title);
    const name = text(item.consultant_name);
    const where = matter ? `your ${matter} matter` : "your file";
    return [
      {
        id,
        title: "Your consultant has changed",
        body: name
          ? `${name} at ${firmName} is now the consultant responsible for ${where}. Your file stays with ${firmName}. ${firmName} may ask you to sign an updated service agreement and, if your previous consultant is your representative with IRCC, a new Use of a Representative form (IMM 5476). If you have questions or don't agree with this change, contact ${firmName}.`
          : `A different consultant at ${firmName} is now responsible for ${where}. Your file stays with ${firmName}. ${firmName} may ask you to sign an updated service agreement and, if your previous consultant is your representative with IRCC, a new Use of a Representative form (IMM 5476). If you have questions or don't agree with this change, contact ${firmName}.`,
      },
    ];
  });
}
