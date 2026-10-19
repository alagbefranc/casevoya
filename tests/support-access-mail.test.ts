import { describe, expect, it } from "vitest";
import { EMAIL_TEMPLATES } from "@/modules/email/designs/catalog";
import { designFor, renderEmail } from "@/modules/email/templates";
import { IN_APP_ROWS } from "@/modules/notifications/preferences";
import { templateLabel } from "@/modules/sheet/inbox-present";
import { notificationParts, readItems, SYSTEM_KINDS, type NotificationItem } from "@/modules/sheet/notifications-present";

// Support access (SEC-09): EX11 and EM17 are wired to the support_requested / support_granted
// templates the database queues for the firm's owners; the Sheet names the templates and the
// in-app "support" notification.

describe("support access mail", () => {
  it("renders EX11 from the request event: the minutes only, a Review request button to Access grants", () => {
    expect(EMAIL_TEMPLATES.EX11.status).toBe("wired");
    expect(designFor({ template: "support_requested" })).toBe("EX11");
    const email = renderEmail({ template: "support_requested", firm: "Maple Example", minutes: 45, reason: "Synthetic secret reason", matter_id: "m1" });
    expect(email.design).toBe("EX11");
    expect(email.subject).toBe("Casevoya support asked for access");
    expect(email.text).toContain("45 minutes of access to one matter at Maple Example");
    expect(email.text).toContain("/sheet/grants");
    expect(email.text).not.toMatch(/Synthetic secret|m1/);
    // No minutes, or nonsense minutes: the approved copy without a number.
    expect(renderEmail({ template: "support_requested", firm: "Maple Example" }).text).toContain("asked for access to one matter");
    expect(renderEmail({ template: "support_requested", firm: "Maple Example", minutes: "60" }).text).toContain("asked for access to one matter");
  });

  it("renders EM17 from the approval event: who approved, the minutes, the end time in the firm's zone", () => {
    expect(EMAIL_TEMPLATES.EM17.status).toBe("wired");
    expect(designFor({ template: "support_granted" })).toBe("EM17");
    const email = renderEmail({
      template: "support_granted",
      firm: "Maple Example",
      approver: "Sam Example",
      minutes: 90,
      ends_at: "2026-10-22T15:40:00Z",
      time_zone: "America/Toronto",
    });
    expect(email.design).toBe("EM17");
    expect(email.subject).toBe("You gave Casevoya support access");
    expect(email.text).toContain("Sam Example approved 90 minutes of support access on one matter.");
    expect(email.text).toMatch(/It ends .*11:40/);
    expect(email.text).toContain("you can end it now");
    expect(renderEmail({ template: "support_granted", firm: "Maple Example" }).text).toContain("A firm owner approved support access on one matter.");
  });

  it("names the templates in the Inbox and lists the in-app support notification", () => {
    expect(templateLabel("support_requested")).toBe("Support access requested");
    expect(templateLabel("support_granted")).toBe("Support access granted");
    expect(IN_APP_ROWS.map((row) => row.kind)).toContain("support");
    const item: NotificationItem = {
      id: "r1",
      kind: "support",
      occurred_at: "2026-10-18T14:00:00Z",
      matter_id: "m1",
      actor_name: "Jordan Reid",
      subject: "NL-2026-0131",
      detail: "60",
      href: "/sheet/grants?tab=support",
      read: false,
    };
    expect(readItems([item])).toEqual([item]);
    expect(SYSTEM_KINDS.has("support")).toBe(true);
    expect(notificationParts(item, () => "x")).toEqual(["Casevoya support asked for ", { b: "60 minutes of access" }, " to NL-2026-0131. Nothing opens until you approve"]);
    expect(notificationParts({ ...item, subject: null, detail: null }, () => "x")).toEqual(["Casevoya support asked for ", { b: "access" }, " to your firm. Nothing opens until you approve"]);
  });
});
