import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { OutboundEmail } from "@/modules/email/cloudflare";
import { dispatchOutbound, type DispatchDeps } from "@/modules/email/dispatch";
import { invitationTokenHash, isInviteLink, openInviteLink, sealInviteLink } from "@/modules/email/invite-link-seal";
import { INVITE_WITHOUT_LINK, renderEmail } from "@/modules/email/templates";

const SECRET = "synthetic-dispatch-secret-0123456789";
const TOKEN = "0123456789abcdef".repeat(4);
const LINK = `https://app.casevoya.ca/accept/client?token=${TOKEN}`;

function tamper(sealed: string): string {
  const bytes = Buffer.from(sealed, "base64");
  bytes[bytes.length - 1] ^= 0x01;
  return bytes.toString("base64");
}

describe("sealed invitation links", () => {
  it("round-trips a link for its own invitation only", async () => {
    const invitationId = randomUUID();
    const sealed = await sealInviteLink(SECRET, LINK, invitationId);
    expect(sealed).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    expect(sealed).not.toContain(TOKEN);
    expect(sealed!.length).toBeLessThanOrEqual(1024);
    expect(await openInviteLink(SECRET, sealed!, invitationId)).toBe(LINK);
    expect(await openInviteLink(SECRET, sealed!, invitationId.toUpperCase())).toBe(LINK);
    // A fresh IV each time.
    expect(await sealInviteLink(SECRET, LINK, invitationId)).not.toBe(sealed);

    expect(await openInviteLink(SECRET, sealed!, randomUUID())).toBeNull();
    expect(await openInviteLink(`${SECRET}-rotated`, sealed!, invitationId)).toBeNull();
    expect(await openInviteLink("", sealed!, invitationId)).toBeNull();
  });

  it("returns null for a tampered or malformed seal instead of throwing", async () => {
    const invitationId = randomUUID();
    const sealed = (await sealInviteLink(SECRET, LINK, invitationId))!;
    expect(await openInviteLink(SECRET, tamper(sealed), invitationId)).toBeNull();
    expect(await openInviteLink(SECRET, "not base64!", invitationId)).toBeNull();
    expect(await openInviteLink(SECRET, "AAAA", invitationId)).toBeNull();
    expect(await openInviteLink(SECRET, sealed.slice(0, 40), invitationId)).toBeNull();
  });

  it("only seals an accept link, and only with a real secret", async () => {
    const invitationId = randomUUID();
    expect(await sealInviteLink("short", LINK, invitationId)).toBeNull();
    expect(await sealInviteLink(SECRET, "javascript:alert(1)", invitationId)).toBeNull();
    expect(await sealInviteLink(SECRET, "https://evil.example/elsewhere", invitationId)).toBeNull();
    expect(isInviteLink(`https://app.casevoya.ca/invite/${TOKEN}`)).toBe(true);
    expect(isInviteLink("https://user:pass@app.casevoya.ca/invite/x")).toBe(false);
  });

  it("hashes the token the way the database stores it", async () => {
    expect(await invitationTokenHash(TOKEN)).toBe(createHash("sha256").update(TOKEN, "utf8").digest("hex"));
  });
});

describe("invitation email copy", () => {
  it("includes the private link, escaped, when the worker opened one", () => {
    const link = `${LINK}&x="<b>"`;
    const email = renderEmail({ template: "invite", kind: "staff", firm: "North <Firm>", link });
    expect(email.text).toContain("North <Firm> invited you to a staff seat.");
    expect(email.text).toContain(`${LINK}&x=%22%3Cb%3E%22`);
    expect(email.text).not.toContain(link);
    expect(email.text).toContain("It works once and expires in 7 days.");
    expect(email.text).not.toContain(INVITE_WITHOUT_LINK);
    expect(email.html).toContain(`<a href="${LINK}&amp;x=%22%3Cb%3E%22">`);
    expect(email.html).not.toContain("<b>");
    expect(email.html).toContain("North &lt;Firm&gt;");
  });

  it("says the link is not in the email when there is none, and carries no token", () => {
    const email = renderEmail({ template: "invite", kind: "portal", firm: "Northline", sealed_link: "abc", invitation_id: randomUUID() });
    expect(email.text).toContain(INVITE_WITHOUT_LINK);
    expect(email.html).not.toContain("href");
    expect(email.text).not.toMatch(/[0-9a-f]{64}/);
    expect(email.text).not.toContain("abc");
    const unsafe = renderEmail({ template: "invite", kind: "portal", firm: "Northline", link: "javascript:alert(1)" });
    expect(unsafe.text).toContain(INVITE_WITHOUT_LINK);
    expect(unsafe.html).not.toContain("javascript");
  });
});

describe("dispatching a sealed invitation", () => {
  async function run(context: Record<string, unknown>, openLink?: DispatchDeps["openLink"]) {
    const sent: OutboundEmail[] = [];
    const outcomes: string[] = [];
    await dispatchOutbound(
      {
        claim: async () => [{ id: "event-1" }],
        prepare: async () => ({
          action: "send",
          messages: [
            {
              delivery_id: "delivery-1",
              to: "invitee@example.test",
              from_address: "notices@casevoya.ca",
              from_name: "Northline",
              reply_to_address: "northline@docs.casevoya.ca",
              reply_to_name: "Northline",
              template: "invite",
              context,
            },
          ],
        }),
        send: async (email) => {
          sent.push(email);
          return { ok: true, messageId: "m", delivered: [email.to], queued: [], permanentBounces: [], suppressed: [] };
        },
        finish: async (_id, _worker, outcome) => {
          outcomes.push(outcome);
        },
        openLink,
      },
      { worker: "test", limit: 1, inboundDomain: "docs.casevoya.ca", fromAddress: "notices@casevoya.ca" },
    );
    return { email: sent[0], outcomes };
  }

  it("opens the sealed link and puts it in the email", async () => {
    const invitationId = randomUUID();
    const sealed = (await sealInviteLink(SECRET, LINK, invitationId))!;
    const { email, outcomes } = await run(
      { firm: "Northline", template: "invite", kind: "portal", sealed_link: sealed, invitation_id: invitationId },
      (value, id) => openInviteLink(SECRET, value, id),
    );
    expect(email.text).toContain(LINK);
    expect(email.html).toContain(`href="${LINK}"`);
    expect(email.text).not.toContain(sealed);
    expect(outcomes).toEqual(["sent"]);
  });

  it("sends the linkless email when the seal was tampered with, the key is wrong, or opening throws", async () => {
    const invitationId = randomUUID();
    const sealed = (await sealInviteLink(SECRET, LINK, invitationId))!;
    const base = { firm: "Northline", template: "invite", kind: "portal", invitation_id: invitationId };
    const cases: [Record<string, unknown>, DispatchDeps["openLink"]][] = [
      [{ ...base, sealed_link: tamper(sealed) }, (value, id) => openInviteLink(SECRET, value, id)],
      [{ ...base, sealed_link: sealed }, (value, id) => openInviteLink("another-secret-0123456789", value, id)],
      [{ ...base, sealed_link: sealed }, async () => { throw new Error("boom"); }],
      [{ ...base, sealed_link: sealed, link: "https://evil.example/accept/x" }, undefined],
    ];
    for (const [context, openLink] of cases) {
      const { email, outcomes } = await run(context, openLink);
      expect(email.text).toContain(INVITE_WITHOUT_LINK);
      expect(email.text).not.toContain(TOKEN);
      expect(email.html).not.toContain(sealed);
      expect(email.html).not.toContain("evil.example");
      expect(outcomes).toEqual(["sent"]);
    }
  });
});
