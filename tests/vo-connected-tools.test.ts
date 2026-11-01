import { describe, expect, it } from "vitest";
import { integrationsData } from "@/modules/sheet/settings-integrations-present";
import { classifyComposioTool } from "@/modules/integrations/composio-policy";
import {
  VO_CONNECTED_ACTIONS,
  VO_CONNECTED_TOOLKITS,
  voConnectedAction,
  voConnectedArguments,
  voConnectedCatalogue,
  voProposalSummary,
  voCompactMail,
} from "@/modules/integrations/vo-connected-tools";

describe("Vo's connected-app tools", () => {
  it("registers a small list for every connected app, and none for Xero or Twilio", () => {
    expect(VO_CONNECTED_TOOLKITS.sort()).toEqual(
      ["calendly", "dropbox", "gmail", "googlecalendar", "googlemeet", "microsoft_teams", "outlook", "outlook_calendar", "quickbooks", "zoom"].sort(),
    );
    expect(voConnectedAction("xero", "XERO_LIST_INVOICES")).toBeNull();
    expect(voConnectedAction("twilio", "TWILIO_SEND_SMS")).toBeNull();
    for (const toolkit of VO_CONNECTED_TOOLKITS) expect(VO_CONNECTED_ACTIONS[toolkit].length, toolkit).toBeGreaterThan(0);
  });

  it("never lists a send, post, delete, move, cancel or invite action", () => {
    for (const toolkit of VO_CONNECTED_TOOLKITS) {
      for (const action of VO_CONNECTED_ACTIONS[toolkit]) {
        expect(action.slug, action.slug).not.toMatch(/SEND|POST|REPLY|FORWARD|DELETE|TRASH|MOVE|CANCEL|REMOVE|INVITE|REGISTRANT|SHARE/);
        expect(action.args, action.slug).not.toContain("attendees");
        expect(action.args, action.slug).not.toContain("attendees_info");
      }
    }
  });

  it("refuses anything not on the list, including real Composio actions", () => {
    expect(voConnectedAction("gmail", "GMAIL_SEND_EMAIL")).toBeNull();
    expect(voConnectedAction("zoom", "ZOOM_DELETE_MEETING_RECORDINGS")).toBeNull();
    expect(voConnectedAction("microsoft_teams", "MICROSOFT_TEAMS_TEAMS_POST_CHAT_MESSAGE")).toBeNull();
    expect(voConnectedAction("dropbox", "DROPBOX_DELETE_FILE_OR_FOLDER")).toBeNull();
    // An action of another app isn't borrowed.
    expect(voConnectedAction("zoom", "GOOGLEMEET_CREATE_MEET")).toBeNull();
    expect(voConnectedAction("zoom", "ZOOM_CREATE_A_MEETING")?.kind).toBe("write");
    expect(voConnectedAction("calendly", "calendly_list_events")?.kind).toBe("read");
  });

  it("keeps only listed arguments, puts the fixed ones on top and keeps Gmail inside the label", () => {
    const zoom = voConnectedAction("zoom", "ZOOM_CREATE_A_MEETING")!;
    expect(voConnectedArguments(zoom, { topic: "Intake call", userId: "someone-else", settings__alternative__hosts: "x@y.z" })).toEqual({ topic: "Intake call", userId: "me" });
    const gmail = voConnectedAction("gmail", "GMAIL_FETCH_EMAILS")!;
    expect(voConnectedArguments(gmail, { query: "label:INBOX from:client", max_results: 500 }, { mailLabel: "Casevoya" })).toEqual({ query: 'label:"Casevoya" from:client', max_results: 10, include_payload: false, verbose: false });
    expect(voConnectedArguments(gmail, {}, { mailLabel: null })).toEqual({ error: "Connect your mailbox first." });
    expect(voConnectedArguments(zoom, { topic: "x".repeat(5000) })).toEqual({ error: "topic is too long." });
  });

  it("summarises a write for the person to confirm, and describes the catalogue", () => {
    const meet = voConnectedAction("zoom", "ZOOM_CREATE_A_MEETING")!;
    expect(voProposalSummary("zoom", meet, { topic: "Intake", userId: "me" })).toBe("zoom: Create a Zoom meeting and its join link. (topic: Intake)");
    expect(voConnectedCatalogue(["dropbox"])).toContain("DROPBOX_CREATE_FOLDER (write, needs the person's confirmation)");
  });

  it("keeps these apps out of the mail/calendar classifier", () => {
    for (const slug of ["QUICKBOOKS_READ_CUSTOMER", "CALENDLY_LIST_EVENTS", "ZOOM_LIST_MEETINGS"]) expect(classifyComposioTool(slug)).toBe("blocked");
  });

  it("shows proposals waiting for confirmation with Confirm and Dismiss", () => {
    const data = integrationsData({
      organizationId: "o1",
      firmSlug: null,
      fromAddress: "no-reply@casevoya.ca",
      inboundDomain: "docs.casevoya.ca",
      isOwner: false,
      composio: { configured: true, enabled: true, acceptedAt: null },
      connections: [],
      busySyncedAt: null,
      stripe: { canSee: false, isOwner: false, account: null },
      timeZone: "America/Winnipeg",
      proposals: [{ id: "p1", toolkit: "zoom", summary: "zoom: Create a Zoom meeting", createdAt: "2026-10-31T14:00:00Z" }],
    });
    const row = (data.lead ?? []).find((item) => item.name === "Vo is waiting for you to confirm")!;
    expect(row.action).toEqual({ label: "Confirm", attrs: { "aria-label": "Confirm: zoom: Create a Zoom meeting", "data-int-confirm": "p1", "data-org": "o1" } });
    // Dismiss is a text button (not an icon), with its own label.
    expect(row.unlink ?? null).toBeNull();
    expect(row.dismiss).toEqual({ label: "Dismiss", attrs: { "aria-label": "Dismiss: zoom: Create a Zoom meeting", "data-int-dismiss": "p1", "data-org": "o1" } });
    // "proposed" is in the firm's zone, with the zone named (14:00Z is 09:00 CDT in Winnipeg).
    expect(String((row.sub as { right: string }).right)).toMatch(/^proposed Oct 31, 2026, 9:00\s?a\.m\. CDT$/);
  });
});

describe("Vo's compact Gmail result", () => {
  const big = "x".repeat(20000);
  const msgs = [1, 2, 3, 4].map((n) => ({
    messageId: `m${n}`, threadId: `t${n}`, messageTimestamp: `2026-11-0${n}T10:00:00Z`, sender: `Sender ${n} <s${n}@example.com>`,
    subject: `Subject ${n}`, messageText: big, preview: { body: `Preview ${n} ${big}` }, labelIds: ["INBOX", "Label_1"], payload: { parts: [{ body: big }] },
  }));
  it("keeps every message up to the count, with from and subject, and no bodies", () => {
    const out = voCompactMail({ messages: msgs }, 3);
    expect(out.map((m) => [m.id, m.threadId, m.from, m.subject])).toEqual([
      ["m1", "t1", "Sender 1 <s1@example.com>", "Subject 1"], ["m2", "t2", "Sender 2 <s2@example.com>", "Subject 2"], ["m3", "t3", "Sender 3 <s3@example.com>", "Subject 3"],
    ]);
    expect(out[0].snippet.length).toBeLessThanOrEqual(200);
    expect(out[0].labels).toEqual(["INBOX", "Label_1"]);
    expect(JSON.stringify(out).length).toBeLessThan(6000);
  });
  it("caps at 10 and reads Gmail API style headers", () => {
    expect(voCompactMail({ messages: Array.from({ length: 30 }, () => msgs[0]) }, 50)).toHaveLength(10);
    const api = voCompactMail({ messages: [{ id: "a", threadId: "b", snippet: "hi", payload: { headers: [{ name: "From", value: "A <a@example.com>" }, { name: "Subject", value: "S" }, { name: "Date", value: "D" }] } }] });
    expect(api[0]).toMatchObject({ id: "a", from: "A <a@example.com>", subject: "S", date: "D", snippet: "hi" });
    expect(voCompactMail(null)).toEqual([]);
  });
});
