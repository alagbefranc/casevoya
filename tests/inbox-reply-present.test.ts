import { describe, expect, it } from "vitest";
import { cloudflareSendBody, type OutboundEmail } from "@/modules/email/cloudflare";
import { EMAIL_TEMPLATES, staffText } from "@/modules/email/designs/catalog";
import { dispatchOutbound, threadingHeaders, type DispatchDeps } from "@/modules/email/dispatch";
import { designFor, renderEmail } from "@/modules/email/templates";
import {
  MAX_EMAIL_CHARS,
  composeSendAttrs,
  composeValue,
  outboundMail,
  outboundStatus,
  parseComposeValue,
  replyError,
  replySendAttrs,
  sentToast,
} from "@/modules/sheet/inbox-reply-present";
import { templateLabel } from "@/modules/sheet/inbox-present";

const ORG = "33333333-3333-4333-8333-333333333333";
const MATTER = "44444444-4444-4444-8444-444444444444";
const PERSON = "55555555-5555-4555-8555-555555555555";
const EMAIL = "66666666-6666-4666-8666-666666666666";

describe("Inbox replies: presentation", () => {
  it("names each delivery state as queued, sent, failed or not sent", () => {
    expect(outboundStatus(undefined, false)).toEqual({ state: "queued", label: "Queued" });
    expect(outboundStatus("sending", false)).toEqual({ state: "queued", label: "Queued" });
    expect(outboundStatus("queued", false)).toEqual({ state: "sent", label: "Sent" });
    expect(outboundStatus("sent", false)).toEqual({ state: "sent", label: "Sent" });
    expect(outboundStatus("failed", false)).toEqual({ state: "failed", label: "Failed" });
    expect(outboundStatus("bounced", false)).toEqual({ state: "failed", label: "Failed: address bounced" });
    expect(outboundStatus("suppressed", false).state).toBe("not_sent");
    expect(outboundStatus("skipped", true)).toEqual({ state: "not_sent", label: "Not sent: sample client" });
    expect(outboundStatus("skipped", false)).toEqual({ state: "not_sent", label: "Not sent" });
  });

  it("shows a sent email in the thread with who, when, how and its status", () => {
    expect(outboundMail({ author: "Sam Consultant", when: "today 09:12", body: "  Hello  ", status: "Sent" })).toEqual({
      meta: ["Sam", "today 09:12", "by email", "Sent"],
      body: "Hello",
      files: null,
    });
    expect(outboundMail({ author: "Sam", when: "x", body: "", status: "Queued" }).body).toBe("(no text)");
  });

  it("wires the conversation's Send to the database by attributes, or says plainly there is no address", () => {
    expect(replySendAttrs({ organizationId: ORG, matterId: MATTER, personId: PERSON, name: "Dana Lee", hasEmail: true, replyToEmailId: EMAIL })).toEqual({
      "data-inbox-reply": EMAIL,
      "data-org": ORG,
      "data-matter": MATTER,
      "data-person": PERSON,
      "data-name": "Dana",
    });
    expect(replySendAttrs({ organizationId: ORG, matterId: MATTER, personId: PERSON, name: "Dana Lee", hasEmail: true, replyToEmailId: null })["data-inbox-reply"]).toBe("new");
    const none = replySendAttrs({ organizationId: ORG, matterId: MATTER, personId: PERSON, name: "Dana Lee", hasEmail: false, replyToEmailId: EMAIL });
    expect(none["data-inbox-reply"]).toBeUndefined();
    expect(none["data-toast"]).toBe("Dana has no email address on file");
    expect(composeSendAttrs(ORG)).toEqual({ "data-inbox-compose": "1", "data-org": ORG });
  });

  it("encodes the To option as matter and person, and rejects anything else", () => {
    expect(parseComposeValue(composeValue(MATTER, PERSON))).toEqual({ matterId: MATTER, personId: PERSON });
    for (const bad of ["", "x:y", `${MATTER}`, `${MATTER}:${PERSON}:x`, `${MATTER}:dana@example.test`, null, undefined]) {
      expect(parseComposeValue(bad)).toBeNull();
    }
  });

  it("explains refusals in plain words and says a sample client's email was not sent", () => {
    expect(replyError("that person is not on this matter")).toBe("That person isn’t on this matter.");
    expect(replyError("that person has no email address")).toBe("That person has no email address on file.");
    expect(replyError("email text must be 1 to 5000 characters")).toContain(String(MAX_EMAIL_CHARS));
    expect(replyError("this address is on the do-not-send list")).toContain("do-not-send");
    expect(replyError("this person turned off email from the firm")).toContain("portal");
    expect(replyError("email denied")).toBe("You can’t email people on this matter.");
    expect(replyError("something odd")).toBe("The email could not be sent.");
    expect(sentToast("Dana", true)).toMatchObject({ title: "Saved, not sent", kind: "warn" });
    expect(sentToast("Dana", false)).toMatchObject({ title: "Email to Dana queued", kind: "ok" });
    expect(templateLabel("staff_message")).toBe("Email from staff");
  });
});

describe("Inbox replies: the EX15 email", () => {
  it("maps staff_message to EX15 and sends the staff text verbatim, line breaks kept and escaped", () => {
    expect(designFor({ template: "staff_message" })).toBe("EX15");
    const email = renderEmail({
      template: "staff_message",
      firm: "Maple & Birch Immigration",
      sender: "Sam Example",
      portal: false,
      subject: "Re: Photos",
      body: "Hello <Dana>,\r\n\r\n\r\n\r\nLine two & more.\u0007",
    });
    expect(email.design).toBe("EX15");
    expect(email.subject).toBe("Re: Photos");
    expect(email.html).toContain("Hello &lt;Dana&gt;,<br><br>Line two &amp; more.<br><br>Sam Example<br>Maple &amp; Birch Immigration<br><br>Reply to this email to answer.");
    expect(email.text).toContain("Hello <Dana>,\n\nLine two & more.\n\nSam Example\nMaple & Birch Immigration\n\nReply to this email to answer.");
    expect(email.html).toContain("Sent by Maple &amp; Birch Immigration via Casevoya");
    // No portal login: no button, no link at all.
    expect(email.html).not.toMatch(/href=/);
    const portal = renderEmail({ template: "staff_message", firm: "Maple Example", portal: true, body: "Hi" });
    expect(portal.subject).toBe("Message from Maple Example");
    expect(portal.text).toContain("Open your portal: https://app.casevoya.ca/portal");
  });

  it("stays English for a recipient who prefers French (the staff member's words are sent as written)", () => {
    const email = renderEmail({ template: "staff_message", firm: "Maple Example", body: "Bonjour", locale: "fr-CA" });
    expect(email.lang).toBe("en");
    expect(email.html).toContain('<html lang="en"');
  });

  it("is in the catalog as wired, engineering-built and pending Francis", () => {
    const def = EMAIL_TEMPLATES.EX15;
    expect(def.status).toBe("wired");
    expect(def.trigger).toMatch(/pending Francis/);
    expect(staffText("a\n\n\n\nb  \n")).toBe("a\n\nb");
    expect(staffText("x".repeat(6000))).toHaveLength(5000);
  });
});

describe("Inbox replies: dispatch", () => {
  it("passes threading headers to Cloudflare only when well-formed, and only In-Reply-To and References", () => {
    expect(threadingHeaders({ "In-Reply-To": "<a@b>", References: "<a@b>", "X-Other": "y", Bcc: "x@evil.test" })).toEqual({ "In-Reply-To": "<a@b>", References: "<a@b>" });
    expect(threadingHeaders({ "In-Reply-To": "a@b\r\nBcc: x@evil.test" })).toBeUndefined();
    expect(threadingHeaders({ "In-Reply-To": "<a b>" })).toBeUndefined();
    expect(threadingHeaders(null)).toBeUndefined();
    const base: OutboundEmail = { to: "a@example.test", fromAddress: "notices@casevoya.ca", fromName: "F", replyToAddress: "f@docs.casevoya.ca", replyToName: "F", subject: "s", html: "h", text: "t" };
    expect(cloudflareSendBody(base)).not.toHaveProperty("headers");
    expect(cloudflareSendBody({ ...base, headers: { "In-Reply-To": "<a@b>" } }).headers).toEqual({ "In-Reply-To": "<a@b>" });
  });

  it("renders a staff email from the message's body and subject, never from the context", async () => {
    const sent: OutboundEmail[] = [];
    const deps: DispatchDeps = {
      claim: async () => [{ id: "event-1" }],
      prepare: async () => ({
        action: "send",
        event_id: "event-1",
        messages: [
          {
            delivery_id: "d1",
            to: "dana@example.test",
            from_address: "notices@casevoya.ca",
            from_name: "Maple Example",
            reply_to_address: "maple+0123456789abcdef0123456789abcdef@docs.casevoya.ca",
            reply_to_name: "Maple Example",
            template: "staff_message",
            context: { firm: "Maple Example", template: "staff_message", sender: "Sam Example", portal: true, body: "from the context" },
            body: "Synthetic: please send the dates.",
            subject: "Re: Photos",
            headers: { "In-Reply-To": "<m-1@mail.example.test>", References: "<m-1@mail.example.test>" },
          },
          {
            delivery_id: "d2",
            to: "lee@example.test",
            from_address: "notices@casevoya.ca",
            from_name: "Maple Example",
            reply_to_address: "maple@docs.casevoya.ca",
            reply_to_name: "Maple Example",
            template: "message",
            context: { firm: "Maple Example", template: "message" },
            body: "never used",
            headers: { "In-Reply-To": "<m-2@mail.example.test>" },
          },
        ],
      }),
      send: async (email) => {
        sent.push(email);
        return { ok: true, messageId: "m", delivered: [email.to], queued: [], permanentBounces: [], suppressed: [] };
      },
      finish: async () => {},
    };
    await dispatchOutbound(deps, { worker: "w", limit: 5, inboundDomain: "docs.casevoya.ca", fromAddress: "notices@casevoya.ca" });
    expect(sent).toHaveLength(2);
    expect(sent[0].subject).toBe("Re: Photos");
    expect(sent[0].text).toContain("Synthetic: please send the dates.");
    expect(sent[0].text).not.toContain("from the context");
    expect(sent[0].replyToAddress).toBe("maple+0123456789abcdef0123456789abcdef@docs.casevoya.ca");
    expect(sent[0].headers).toEqual({ "In-Reply-To": "<m-1@mail.example.test>", References: "<m-1@mail.example.test>" });
    // Another template never takes a body or headers from the message.
    expect(sent[1].text).not.toContain("never used");
    expect(sent[1].headers).toBeUndefined();
  });
});
