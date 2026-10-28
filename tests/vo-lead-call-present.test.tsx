import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CallNotesPanel, LeadVoPanel } from "@/components/sheet/designer/vo-crm";
import { callVoView, leadVoView, type CallVoInput, type LeadVoInput } from "@/modules/sheet/vo-crm-present";
import { effectiveSettings } from "@/modules/sheet/vo-present";
import { categoryBlockedMessage } from "@/modules/vo/crm";

/**
 * AI-01 panels: the Lead page's "Follow-up with Vo" and the consultation record's "Call notes with
 * Vo". With Vo off (or a capability off, or the service not set up) the buttons disappear and the
 * manual paths stay; no consent to contact means no button and a plain reason; a waiting draft is
 * shown with what Vo read and the consent it was drafted under. Synthetic values only.
 */
const ORG = "11111111-1111-4111-8111-111111111111";
const ON = effectiveSettings({ enabled: true }, false);
const NOW = Date.parse("2026-10-24T15:00:00Z");

const consent = (purpose: string, granted: boolean) => ({ purpose, granted, captured_via: "web_form", recorded_at: "2026-10-20T15:00:00Z" });

const leadInput = (over: Partial<LeadVoInput> = {}): LeadVoInput => ({
  organizationId: ORG,
  lead: { id: "lead-1", email: "sam@example.test", phone: null, convertedMatterId: null },
  consents: [consent("enquiry_reply", true)],
  settings: ON,
  agentReady: true,
  draft: null,
  mailboxes: [],
  ...over,
});

const DRAFT = {
  id: "draft-1",
  body: "Hi Sam, would you like to book a consultation?",
  sources: [
    { kind: "lead", id: "lead-1", label: "Sam Example" },
    { kind: "lead_note", id: "n1", label: "Enquiry, 2026-10-20" },
  ],
  needs_rule: false,
  marketing_consent: false,
  left_out: 1,
};

describe("Follow-up with Vo", () => {
  it("disappears with Vo off, a capability off or the service not set up, unless a draft waits", () => {
    expect(leadVoView(leadInput({ settings: effectiveSettings({ enabled: false }, false) }))).toBeNull();
    expect(leadVoView(leadInput({ settings: effectiveSettings({ enabled: true, reply_drafts: false }, false) }))).toBeNull();
    expect(leadVoView(leadInput({ settings: effectiveSettings({ enabled: true, read_client_messages: false }, false) }))).toBeNull();
    expect(leadVoView(leadInput({ agentReady: false }))).toBeNull();
    // A real firm with no saved switches: Vo is off.
    expect(leadVoView(leadInput({ settings: effectiveSettings(null, false) }))).toBeNull();
    const waiting = leadVoView(leadInput({ settings: effectiveSettings({ enabled: false }, false), draft: DRAFT }));
    expect(waiting?.draft?.id).toBe("draft-1");
    expect(waiting?.action).toBeNull();
  });

  it("offers a draft only with consent to contact, and says why not otherwise", () => {
    const ok = leadVoView(leadInput())!;
    expect(ok.action).toEqual({ "data-org": ORG, "data-lead": "lead-1", "data-vo-crm": "lead-draft" });
    expect(ok.consent).toMatch(/No marketing consent: Vo keeps the draft to their enquiry, with no promotional content/);
    const none = leadVoView(leadInput({ consents: [consent("enquiry_reply", true), { ...consent("enquiry_reply", false), recorded_at: "2026-10-21T15:00:00Z" }] }))!;
    expect(none.action).toBeNull();
    expect(none.blocked?.title).toBe("No consent to contact");
    const converted = leadVoView(leadInput({ lead: { id: "lead-1", email: null, phone: null, convertedMatterId: "m1" } }))!;
    expect(converted.blocked?.title).toBe("This lead is now a client");
    const marketing = leadVoView(leadInput({ consents: [consent("enquiry_reply", true), consent("marketing", true)] }))!;
    expect(marketing.consent).toMatch(/Marketing consent given/);
  });

  it("shows a waiting draft with what Vo read, what it was not given, and the person's choices", () => {
    const view = leadVoView(leadInput({ draft: { ...DRAFT, needs_rule: true }, mailboxes: [{ toolkit: "gmail", status: "active" }, { toolkit: "outlook", status: "disconnected" }] }))!;
    const html = renderToStaticMarkup(createElement(LeadVoPanel, { data: view }));
    expect(html).toContain("Drafted by Vo");
    expect(html).toContain("needs your review");
    expect(html).toContain("Vo read: Sam Example, Enquiry, 2026-10-20.");
    expect(html).toContain("Vo wasn’t given 1 note: it mentions details the firm keeps from Vo.");
    expect(html).toContain("Drafted without marketing consent: kept to their enquiry, no promotional content.");
    expect(html).toContain("[needs a sourced rule]");
    expect(html).toContain('data-vo-crm="lead-sent"');
    expect(html).toContain("Mark as sent");
    expect(html).toContain("Save to my Gmail drafts");
    expect(html).not.toContain("Outlook");
    expect(html).toContain('data-vo-crm="discard"');
    expect(html).not.toContain("Draft follow-up with Vo");
  });
});

const callInput = (over: Partial<CallVoInput> = {}): CallVoInput => ({
  organizationId: ORG,
  booking: { id: "b1", locationKind: "video", status: "completed", startsAt: "2026-10-24T13:00:00Z", isSample: false },
  callStarted: false,
  target: { lead: "Sam Example", matter: null },
  settings: ON,
  agentReady: true,
  draft: null,
  now: NOW,
  ...over,
});

describe("Call notes with Vo", () => {
  it("is only on Casevoya video calls, after the call, with Vo and summaries on", () => {
    expect(callVoView(callInput({ booking: { ...callInput().booking, locationKind: "phone" } }))).toBeNull();
    expect(callVoView(callInput({ settings: effectiveSettings({ enabled: true, staff_answers: false }, false) }))).toBeNull();
    expect(callVoView(callInput({ settings: effectiveSettings({ enabled: false }, false) }))).toBeNull();
    expect(callVoView(callInput({ booking: { ...callInput().booking, startsAt: "2026-10-25T13:00:00Z", status: "confirmed" } }))).toBeNull();
    const notYet = callVoView(callInput({ booking: { ...callInput().booking, status: "confirmed" } }))!;
    expect(notYet.form).toBeNull();
    expect(notYet.blocked?.title).toBe("After the call");
    const happened = callVoView(callInput({ booking: { ...callInput().booking, status: "confirmed" }, callStarted: true }))!;
    expect(happened.form).toEqual({ "data-org": ORG, "data-booking": "b1", "data-vo-crm": "call-draft" });
    const nowhere = callVoView(callInput({ target: { lead: null, matter: null } }))!;
    expect(nowhere.blocked?.title).toBe("Nowhere to keep a summary yet");
  });

  it("says calls aren't recorded and pasted notes aren't stored, and saves to the right place", () => {
    const view = callVoView(callInput())!;
    const html = renderToStaticMarkup(createElement(CallNotesPanel, { data: view }));
    expect(html).toContain("Casevoya doesn’t record calls.");
    expect(html).toContain("Your pasted notes aren’t stored");
    expect(html).toContain('accept=".txt,.md,text/plain,text/markdown"');
    expect(html).toContain('maxLength="12000"');
    const onMatter = callVoView(callInput({ target: { lead: null, matter: "NL-2026-0001" }, draft: { ...DRAFT, marketing_consent: null, left_out: 0 } }))!;
    const drafted = renderToStaticMarkup(createElement(CallNotesPanel, { data: onMatter }));
    expect(drafted).toContain("Save to the matter’s notes");
    expect(drafted).toContain('data-vo-crm="call-save"');
    expect(drafted).toContain("Kept as a staff note on the matter NL-2026-0001. Clients never see it.");
    expect(drafted).not.toContain("Summarise with Vo");
  });

  it("names the switch that keeps sensitive notes from Vo", () => {
    expect(categoryBlockedMessage("criminal")).toMatch(/criminal-history details.*Criminal history in Vo and AI/);
  });
});
