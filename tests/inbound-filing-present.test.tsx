import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FileToMatterDialog, InboundAddress } from "@/components/sheet/designer/inbound-filing";
import { MatterRbar, MatterTimeline } from "@/components/sheet/designer/matter";
import { bouncedFollowUp, withFileToMatter } from "@/modules/sheet/inbox-present";
import { firmInboundAddress, matterInboundAddress, timelineEmailEvents } from "@/modules/sheet/inbound-present";

const DISMISS = { label: "Not case mail", attrs: { "data-inbox-dismiss": "e1", "data-org": "o1" } };

describe("File to matter action (OPS-06)", () => {
  it("goes before Not case mail and offers only clean files", () => {
    const actions = withFileToMatter([{ label: "Confirm match", primary: true, attrs: { "data-inbox-file": "e1" } }, DISMISS], {
      emailId: "e1",
      organizationId: "o1",
      ready: true,
      files: [
        { id: "i1", filename: "passport.pdf", upload_state: "clean" },
        { id: "i2", filename: "bad.pdf", upload_state: "quarantined" },
      ],
    });
    expect(actions.map((action) => action.label)).toEqual(["Confirm match", "File to matter", "Not case mail"]);
    expect(actions[1].attrs?.["data-inbox-pick"]).toBe("e1");
    expect(JSON.parse(actions[1].attrs?.["data-files"] ?? "")).toEqual([{ id: "i1", name: "passport.pdf" }]);
  });

  it("is not offered while the email is still arriving", () => {
    expect(withFileToMatter([DISMISS], { emailId: "e1", organizationId: "o1", ready: false, files: [] })).toEqual([DISMISS]);
  });
});

describe("Delivery problems follow-up (OPS-06)", () => {
  it("names the task's owner and state, or says why there is no task", () => {
    expect(bouncedFollowUp({ status: "bounced", critical: true, matterId: "m1", task: { status: "open", owner: "Amara Osei" } })).toEqual(["Amara Osei", "task open"]);
    expect(bouncedFollowUp({ status: "bounced", critical: true, matterId: "m1", task: { status: "done", owner: null } })).toEqual(["Unassigned", "task done"]);
    expect(bouncedFollowUp({ status: "bounced", critical: true, matterId: null, task: null })).toEqual(["No task", "not on a matter, follow it up yourself"]);
    expect(bouncedFollowUp({ status: "failed", critical: false, matterId: null, task: null })).toBe("—");
  });
});

describe("Inbound addresses (OPS-06)", () => {
  it("shows the matter's address with a copy button, and says plainly when it is the firm address", () => {
    const tagged = matterInboundAddress({ address: "northline+0123456789abcdef0123456789abcdef@docs.casevoya.ca", matter_tag: true });
    expect(tagged?.note).toMatch(/no automatic reply/);
    expect(matterInboundAddress({ address: "longfirm@docs.casevoya.ca", matter_tag: false })?.note).toMatch(/too long/);
    expect(matterInboundAddress(null)).toBeNull();
    const html = renderToStaticMarkup(createElement(InboundAddress, { data: tagged! }));
    expect(html).toContain('data-copy="northline+0123456789abcdef0123456789abcdef@docs.casevoya.ca"');
    expect(html).toContain('class="btn s sm"');
    expect(firmInboundAddress("northline@docs.casevoya.ca").address).toBe("northline@docs.casevoya.ca");
  });

  it("adds the address card to the matter's right column only when it is given", () => {
    const base = { agreement: { title: "No agreement yet", state: null, parts: ["x"] } };
    expect(renderToStaticMarkup(createElement(MatterRbar, { data: base }))).not.toContain("Email into this matter");
    const html = renderToStaticMarkup(createElement(MatterRbar, { data: { ...base, inbound: firmInboundAddress("a@docs.casevoya.ca") } }));
    expect(html).toContain("<h4>Email into this matter</h4>");
  });

  it("renders the File to matter dialog from the Designer's dialog parts", () => {
    const html = renderToStaticMarkup(createElement(FileToMatterDialog, { organizationId: "o1" }));
    expect(html).toContain('<dialog class="dlg" id="dlgFileTo"');
    expect(html).toContain('data-inbox-search="1" data-org="o1"');
    expect(html).toContain('data-inbox-file-go="1" data-org="o1"');
    expect(html).toContain("Filing doesn’t give the sender access");
  });
});

describe("Timeline inbound email records (OPS-06)", () => {
  const rows = [
    { id: "e1", from_email: "priya@example.test", subject: "Passport", triage_state: "filed", person_id: "p1", sender_verified: true, created_at: "2026-10-24T12:41:00Z" },
    { id: "e2", from_email: "x@example.test", subject: null, triage_state: "open", person_id: null, sender_verified: false, created_at: "2026-10-20T12:00:00Z" },
    { id: "e3", from_email: "spam@example.test", subject: "Offer", triage_state: "dismissed", person_id: null, sender_verified: false, created_at: "2026-10-19T12:00:00Z" },
  ];

  it("shows filed and waiting email, never dismissed mail", () => {
    const events = timelineEmailEvents(rows, {
      timeZone: "America/Toronto",
      today: "2026-10-24",
      personName: (id) => (id === "p1" ? "Priya Sharma" : null),
      files: new Map([["e1", 2]]),
    });
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({
      dot: "#0075DE",
      title: "Email from priya@example.test: Passport",
      parts: ["Filed to Priya Sharma", "sender verified", "2 attachments"],
      badge: { tone: "blue", label: "Email" },
      when: "Today 08:41",
    });
    expect(events[1].parts[0]).toBe("Waiting in Email to triage");
    expect(events[1].title).toContain("(no subject)");
  });

  it("live, leaves out the audit bar and shows an empty state when there is no email", () => {
    const html = renderToStaticMarkup(createElement(MatterTimeline, { data: { note: "Email received on this matter.", events: [] } }));
    expect(html).not.toContain("Search the audit trail");
    expect(html).toContain("No email on this matter yet");
  });
});
