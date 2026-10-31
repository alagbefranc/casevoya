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
    expect(voConnectedArguments(gmail, { query: "label:INBOX from:client", max_results: 500 }, { mailLabel: "Casevoya" })).toEqual({ query: 'label:"Casevoya" from:client', max_results: 20 });
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
    expect(row.action).toEqual({ label: "Confirm", attrs: { "data-int-confirm": "p1", "data-org": "o1" } });
    expect(row.unlink).toEqual({ "aria-label": "Dismiss", "data-int-dismiss": "p1", "data-org": "o1" });
  });
});
