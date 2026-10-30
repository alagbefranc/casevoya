/** The minimal DOM this helper needs (kept small so it can be tested without a DOM library). */
type BadgeDoc = { createElement(tag: "i"): Node; createTextNode(text: string): Node };
type Badge = { replaceChildren(...nodes: Node[]): void };

/**
 * Writes "For <email>" into the accept-staff invitation badge. The email comes from the server, so
 * it is set as a text node, never parsed as HTML.
 */
export function writeInviteBadge(badge: Badge, email: string, doc: BadgeDoc = document): void {
  badge.replaceChildren(doc.createElement("i"), doc.createTextNode(`For ${email}`));
}
