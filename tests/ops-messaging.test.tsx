import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AnnouncementDialog, ComposeDialog, InboxHeader } from "@/components/sheet/designer/inbox";
import { MessageTemplateDialog } from "@/components/sheet/designer/templates";
import { audienceBlocked, messageEmailState, messageError, readState } from "@/modules/messages/present";
import { fillTemplate, firstNameOf, templateError, unfilledFields, unfilledNotice, unknownFields } from "@/modules/messages/templates";
import { portalNotices } from "@/modules/portal/notices";
import { announcementCard, announcementError, audienceLine, audienceOptions, programLabel, rateLimitedMessage } from "@/modules/sheet/announcements-present";
import { messageMail } from "@/modules/sheet/inbox-reply-present";
import { firmMessageRows, templatesData } from "@/modules/sheet/templates-present";

// OPS-04 presentation: merge fields, delivery and read state, announcement cards and audience
// lines, the live-only dialogs, and the portal notice for an announcement. Synthetic data only.

const ORG = "33333333-3333-4333-8333-333333333333";

describe("message template merge fields", () => {
  it("fills what is known and leaves the rest as a visible gap", () => {
    const body = "Hi {client_first_name}, {consultant_name} at {firm_name} needs the passport for {matter_reference}.";
    const filled = fillTemplate(body, { client_first_name: "Dana", firm_name: "Maple Immigration", matter_reference: null, consultant_name: "  " });
    expect(filled).toBe("Hi Dana, {consultant_name} at Maple Immigration needs the passport for {matter_reference}.");
    expect(unfilledFields(filled)).toEqual(["consultant_name", "matter_reference"]);
    expect(unfilledNotice(filled)).toBe("Fill in {consultant_name}, {matter_reference} before sending.");
    expect(unfilledNotice("Hi Dana")).toBeNull();
    // Braces that aren't a merge field are just text.
    expect(unfilledFields("Use {curly} braces")).toEqual([]);
  });

  it("names the fields the database refuses", () => {
    expect(unknownFields("Fee {fee_amount} for {client_first_name}", false)).toEqual(["fee_amount"]);
    expect(unknownFields("Dear {client_first_name} at {firm_name}", true)).toEqual(["client_first_name"]);
    expect(firstNameOf("  Dana  Lee ")).toBe("Dana");
    expect(firstNameOf(null)).toBeNull();
    expect(templateError("unknown merge field")).toMatch(/field Casevoya can’t fill/);
    expect(templateError("staff access denied")).toMatch(/firm owner or licensed consultant approves/);
  });
});

describe("delivered and read state", () => {
  it("says Delivered until someone reads it, then who", () => {
    expect(readState([])).toBe("Delivered");
    expect(readState(["Dana Lee", "Sam Lee"])).toBe("Read by Dana Lee, Sam Lee");
  });

  it("words the email notice from the outbox in the Inbox's terms, worst first", () => {
    expect(messageEmailState({ eventStatus: null, deliveries: [], sample: false })).toBeNull();
    expect(messageEmailState({ eventStatus: "pending", deliveries: [], sample: false })).toBe("Email queued");
    expect(messageEmailState({ eventStatus: "published", deliveries: [], sample: false })).toBeNull();
    expect(messageEmailState({ eventStatus: "published", deliveries: ["queued"], sample: false })).toBe("Email sent");
    expect(messageEmailState({ eventStatus: "published", deliveries: ["sent", "bounced"], sample: false })).toBe("Email failed: address bounced");
    expect(messageEmailState({ eventStatus: "published", deliveries: ["suppressed"], sample: false })).toBe("Email not sent: on the do-not-send list");
    expect(messageEmailState({ eventStatus: "published", deliveries: ["skipped"], sample: true })).toBe("Email not sent: sample client");
    expect(messageEmailState({ eventStatus: "processing", deliveries: ["sending"], sample: false })).toBe("Email queued");
  });

  it("shows acknowledgement and read state on an Inbox portal message", () => {
    const mail = messageMail({ author: "Sam Example", when: "today 09:12", body: "Bring the original.", channel: "portal", ack: true, acked: ["Dana Lee"], state: "Read by Dana Lee" });
    expect(mail.meta).toEqual(["Sam", "today 09:12", "via portal", "acknowledged by Dana Lee", "Read by Dana Lee"]);
    expect(messageMail({ author: "Dana Lee", when: "today", body: "Hi", channel: "portal", ack: false }).meta).toEqual(["Dana", "today", "via portal"]);
  });
});

describe("external participants", () => {
  it("blocks an employer or sponsor without portal access, and says why", () => {
    expect(audienceBlocked({ personId: "p", name: "Erin", role: "Employer", email: true, portal: false, external: true })).toBe("No portal access");
    expect(audienceBlocked({ personId: "p", name: "Sam", role: "Sponsor", email: false, portal: true, external: true })).toBeNull();
    expect(audienceBlocked({ personId: "p", name: "Pat", role: "Applicant", email: true, portal: false, external: false })).toBeNull();
    expect(messageError("an employer or sponsor needs portal access to this matter")).toMatch(/Invite them to the portal first/);
  });
});

describe("announcements", () => {
  it("shows a sent announcement as the Designer's card", () => {
    const card = announcementCard(
      { title: "Office closed 11 Nov", audienceKind: "program", programKey: "study_permit", recipients: 3, emailed: 2, seen: 1, sample: false, createdAt: "2026-10-24T15:00:00Z" },
      "America/Toronto",
    );
    expect(card).toEqual({ title: "Office closed 11 Nov", audience: ["Study permit clients", "3 clients, 2 by email"], when: ["Sent 24 Oct", "1 read"] });
    expect(announcementCard({ title: "T", audienceKind: "all", programKey: null, recipients: 1, emailed: 0, seen: 0, sample: true, createdAt: "2026-10-24T15:00:00Z" }, "UTC").audience).toEqual([
      "All active clients",
      "1 sample client, no email",
    ]);
    expect(programLabel("express_entry")).toBe("Express entry");
  });

  it("lists the audiences with their counts and says who is left out before sending", () => {
    const options = audienceOptions({
      all: { recipients: 4, emailed: 3, without_portal: 2 },
      programs: [{ program_key: "study_permit", recipients: 1, emailed: 1, without_portal: 0 }],
    });
    expect(options.map((option) => [option.value, option.label, option.count.recipients])).toEqual([
      ["", "All active clients", 4],
      ["study_permit", "Study permit clients", 1],
    ]);
    expect(audienceLine(options[0].count, false)).toBe(
      "4 clients with a portal account see it on their portal home; 3 also get a short email with a portal link. 2 clients without a portal account won’t get it.",
    );
    expect(audienceLine(options[1].count, true)).toBe("1 client with a portal account sees it on their portal home; no email is sent while the firm is in sample mode.");
    expect(audienceLine({ recipients: 0, emailed: 0, withoutPortal: 3 }, false)).toMatch(/no one to send it to/);
    expect(audienceOptions(null)).toEqual([{ value: "", label: "All active clients", count: { recipients: 0, emailed: 0, withoutPortal: 0 } }]);
  });

  it("says the database's answers plainly", () => {
    expect(announcementError("staff access denied")).toBe("Only a firm owner or licensed consultant can send announcements.");
    expect(announcementError("no client in this audience has a portal account")).toMatch(/Nothing was sent/);
    expect(rateLimitedMessage("2026-10-24T15:10:00Z", "America/Toronto")).toBe("Your firm sent an announcement in the last 10 minutes. You can send the next one after 11:10.");
  });

  it("renders the New announcement dialog with the template text, the audience line and Send's attributes", () => {
    const html = renderToStaticMarkup(
      createElement(AnnouncementDialog, {
        data: {
          organizationId: ORG,
          timezone: "America/Toronto",
          templates: [{ id: "t1", version: 2, name: "Holiday", title: "Office closed 11 Nov", body: "Maple Immigration is closed." }],
          audiences: [{ value: "", label: "All active clients", line: "2 clients with a portal account see it.", recipients: 2 }],
          canSend: true,
        },
      }),
    );
    expect(html).toContain('<option value="t1" data-v="2" data-title="Office closed 11 Nov" data-body="Maple Immigration is closed.">Holiday</option>');
    expect(html).toContain('<span id="anL">2 clients with a portal account see it.</span>');
    expect(html).toContain(`<button class="btn p" data-ann-send="1" data-org="${ORG}" data-tz="America/Toronto">Send</button>`);
    expect(html).toContain("By office isn’t available");
    expect(html).not.toContain("data-toast");
  });

  it("without an approved template or permission, Send is off and the dialog says why", () => {
    const html = renderToStaticMarkup(
      createElement(AnnouncementDialog, {
        data: { organizationId: ORG, timezone: "UTC", templates: [], audiences: [{ value: "", label: "All active clients", line: "x", recipients: 2 }], canSend: false },
      }),
    );
    expect(html).toContain("No approved announcement template yet");
    expect(html).toContain('href="/sheet/templates?tab=messages"');
    expect(html).toContain("Only a firm owner or licensed consultant can send announcements.");
    expect(html).toMatch(/data-ann-send="1"[^>]*disabled=""/);
  });

  it("adds New announcement to the Inbox header only when asked (live only)", () => {
    expect(renderToStaticMarkup(createElement(InboxHeader, { tab: "notes", pills: [], announce: true }))).toContain('<button class="btn sm" data-dlg="dlgAnn">');
    expect(renderToStaticMarkup(createElement(InboxHeader, { tab: "notes", pills: [] }))).not.toContain("dlgAnn");
  });
});

describe("Start from a template and the template dialog", () => {
  it("carries each template's text and each person's merge values as attributes", () => {
    const html = renderToStaticMarkup(
      createElement(ComposeDialog, {
        data: {
          to: [["Dana Lee", "MI-1"]],
          toValues: ["m1:p1"],
          toMerge: [{ "data-first": "Dana", "data-ref": "MI-1", "data-consultant": "" }],
          templates: ["None", "Passport reminder"],
          templateValues: [
            { value: "", body: "" },
            { value: "t1", body: "Hi {client_first_name}" },
          ],
          firmName: "Maple Immigration",
          send: { attrs: { "data-inbox-compose": "1" } },
        },
      }),
    );
    expect(html).toContain('data-firm="Maple Immigration"');
    expect(html).toContain('<option value="m1:p1" data-first="Dana" data-ref="MI-1" data-consultant="">');
    expect(html).toContain('<option value="">None</option><option value="t1" data-body="Hi {client_first_name}">Passport reminder</option>');
  });

  it("offers Approve on a draft only to an owner or licensed consultant, and opens itself for ?view=", () => {
    const edit = { id: "t1", version: 3, useFor: "announcement" as const, name: "Holiday", title: "Closed", body: "{firm_name} is closed.", status: "draft" as const };
    const owner = renderToStaticMarkup(createElement(MessageTemplateDialog, { data: { organizationId: ORG, edit, canApprove: true, canWrite: true } }));
    expect(owner).toContain('data-autoopen="1"');
    expect(owner).toContain(`<button class="btn" data-mt-approve="1" data-org="${ORG}" data-id="t1" data-v="3">Approve</button>`);
    expect(owner).not.toMatch(/id="mtTf" hidden/);
    const manager = renderToStaticMarkup(createElement(MessageTemplateDialog, { data: { organizationId: ORG, edit, canApprove: false, canWrite: true } }));
    expect(manager).not.toContain("data-mt-approve");
    const fresh = renderToStaticMarkup(createElement(MessageTemplateDialog, { data: { organizationId: ORG, edit: null, canApprove: true, canWrite: true } }));
    expect(fresh).toContain("New message template");
    expect(fresh).toMatch(/id="mtTf" hidden/);
    expect(fresh).not.toContain("data-autoopen");
  });

  it("lists the firm's templates above the email catalog and opens the dialog from New template", () => {
    const rows = firmMessageRows(
      [
        { id: "t1", useFor: "message", name: "Passport reminder", status: "approved", approvedAt: "2026-10-20T15:00:00Z", approvedBy: "Sam Example" },
        { id: "t2", useFor: "announcement", name: "Holiday", status: "draft", approvedAt: null, approvedBy: null },
      ],
      "America/Toronto",
    );
    expect(rows[0]).toMatchObject({ template: "Passport reminder", channel: "Portal message", state: { tone: "ok", label: "Approved" }, href: "/sheet/templates?tab=messages&view=t1" });
    expect(rows[0].state.detail).toMatch(/^Sam Example, /);
    expect(rows[1]).toMatchObject({ channel: { left: "Announcement", right: "portal and email notice" }, state: { tone: "rev", label: "Draft, needs approval" } });
    const data = templatesData({ tab: "messages", program: [], messages: rows, rules: [], packs: 0, selected: null, today: "2026-10-24" });
    expect(data).toMatchObject({ newTemplateLabel: "New message template", newTemplateDialog: "dlgMt" });
    expect(templatesData({ tab: "program", program: [], messages: [], rules: [], packs: 0, selected: null, today: "2026-10-24" }).newTemplateDialog).toBeUndefined();
  });
});

describe("portal notices", () => {
  it("shows an announcement as the firm wrote it, next to a consultant change", () => {
    const notices = portalNotices(
      [
        { id: "a1", kind: "announcement", title: "Office closed 11 Nov", body: "Maple Immigration is closed on 11 November." },
        { id: "a2", kind: "announcement", title: "", body: "No title" },
        { id: "c1", kind: "consultant_changed", matter_title: "Study permit", consultant_name: "Sam Example" },
      ],
      "Maple Immigration",
    );
    expect(notices.map((notice) => [notice.id, notice.title])).toEqual([
      ["a1", "Office closed 11 Nov"],
      ["c1", "Your consultant has changed"],
    ]);
    expect(notices[0].body).toBe("Maple Immigration is closed on 11 November.");
  });
});
