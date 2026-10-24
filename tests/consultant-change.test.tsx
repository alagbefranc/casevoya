import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, push() {}, replace() {} }) }));

import { ConsultantDialog, MatterPeople } from "@/components/sheet/designer/matter";
import { LivePortal } from "@/components/portal/live";
import { renderEmail } from "@/modules/email/templates";
import { portalNotices } from "@/modules/portal/notices";
import type { PortalViewer } from "@/modules/portal/load";
import { consultantChangeDone, consultantDialog, parseAudience } from "@/modules/sheet/consultant-change";
import { dialogId } from "@/modules/sheet/matter-wire";

// ORG-06 (#175): Change consultant on the matter's People tab shows who will be told; the client
// gets a portal notice on Home and EX17 by email. Everything here is synthetic.

const WIRE = { organizationId: "00000000-0000-4000-8000-000000000001", matterId: "00000000-0000-4000-8000-000000000002", version: 4 };

describe("Change consultant dialog", () => {
  const data = consultantDialog({
    consultants: [
      { id: "m2", name: "Zoe Second" },
      { id: "m1", name: "Sam First" },
      { id: "m3", name: "Avery Third" },
    ],
    current: "m1",
    audience: [
      { person_id: "p1", name: "Casey Client", role: "applicant", emailed: true },
      { person_id: "p2", name: "Jordan Lee", role: "sponsor", emailed: false },
      { bad: true },
    ],
    sample: false,
  });

  it("lists the current consultant first and who will be told, and how", () => {
    expect(data.consultants.map((row) => row.id)).toEqual(["m1", "m3", "m2"]);
    expect(data.audience).toEqual([
      { name: "Casey Client", role: "Applicant", emailed: true },
      { name: "Jordan Lee", role: "Sponsor", emailed: false },
    ]);
    const html = renderToStaticMarkup(createElement(ConsultantDialog, { data, wire: WIRE }));
    expect(html).toContain('id="dCons"');
    expect(html).toContain("<legend>Who will be told</legend>");
    expect(html).toContain("<b>Casey Client</b><small>Applicant · portal notice and email</small>");
    expect(html).toContain("Sponsor · portal notice only");
    expect(html).toContain('<option value="m1" selected="">Sam First (now)</option>');
    expect(html).toContain('data-act="consultant"');
    expect(html).toContain(`data-version="4"`);
  });

  it("says plainly when nobody will be told", () => {
    const none = renderToStaticMarkup(createElement(ConsultantDialog, { data: { ...data, audience: [] }, wire: WIRE }));
    expect(none).toContain("Nobody yet: no one on this matter has a portal account. Tell the client yourself.");
    const sample = renderToStaticMarkup(createElement(ConsultantDialog, { data: { ...data, sample: true }, wire: WIRE }));
    expect(sample).toContain("Nobody: this is a sample matter.");
    expect(parseAudience(null)).toEqual([]);
  });

  it("opens from the responsible consultant's card, and comes back after a step-up", () => {
    const html = renderToStaticMarkup(
      createElement(MatterPeople, {
        cards: [{ person: { name: "Sam First" }, role: "Licensed consultant", parts: ["Firm staff"], pill: { label: "Responsible" }, staff: "/sheet/settings", consultant: true }],
        relationships: [],
      } as never),
    );
    expect(html).toContain('data-dlg="dCons"');
    expect(html).toContain('title="Change consultant"');
    expect(dialogId("consultant")).toBe("dCons");
  });

  it("says how many were told after saving", () => {
    expect(consultantChangeDone({ told: 2, emailed: 2 })).toBe("2 people got a portal notice and an email. Recorded in the matter’s history.");
    expect(consultantChangeDone({ told: 2, emailed: 1 })).toBe("2 people got a portal notice (1 email sent). Recorded in the matter’s history.");
    expect(consultantChangeDone({ told: 0, emailed: 0 })).toMatch(/^Nobody on the matter has a portal account/);
  });
});

describe("the client's notice", () => {
  const viewer: PortalViewer = {
    organizationId: WIRE.organizationId,
    organizationName: "Test Firm",
    organizationSlug: "test-firm",
    timezone: "America/Toronto",
    role: "client",
    person: null,
    matters: [],
    people: [],
    grants: [],
    shares: [],
    prefs: null,
    sections: [],
  };

  it("names the new consultant and the matter, with Got it, on Home", () => {
    const notices = portalNotices(
      [
        { id: "n1", kind: "consultant_changed", matter_title: "Spousal sponsorship", consultant_name: "Dana Second" },
        { id: "n2", kind: "something_else" },
      ],
      "Test Firm",
    );
    expect(notices).toEqual([
      {
        id: "n1",
        title: "Your consultant has changed",
        body: "Dana Second at Test Firm is now the consultant responsible for your Spousal sponsorship matter. Your file stays with Test Firm. Test Firm may ask you to sign an updated service agreement and, if your previous consultant is your representative with IRCC, a new Use of a Representative form (IMM 5476). If you have questions or don't agree with this change, contact Test Firm.",
      },
    ]);
    const html = renderToStaticMarkup(createElement(LivePortal, { page: "home", viewer, notices } as never));
    expect(html).toContain("<b>Your consultant has changed</b>Dana Second at Test Firm");
    expect(html).toContain(">Got it</button>");
    expect(renderToStaticMarkup(createElement(LivePortal, { page: "home", viewer } as never))).not.toContain("Your consultant has changed");
    expect(portalNotices([{ id: "n3", kind: "consultant_changed", consultant_name: null }], "Test Firm")[0].body).toBe(
      "A different consultant at Test Firm is now responsible for your file. Your file stays with Test Firm. Test Firm may ask you to sign an updated service agreement and, if your previous consultant is your representative with IRCC, a new Use of a Representative form (IMM 5476). If you have questions or don't agree with this change, contact Test Firm.",
    );
  });

  it("emails only that the consultant changed (EX17), never the name or the matter", () => {
    const email = renderEmail({ template: "consultant_changed", firm: "Test Firm", consultant_name: "Dana Second", matter_title: "Spousal sponsorship" });
    expect(email.design).toBe("EX17");
    expect(email.subject).toBe("An update on your file from Test Firm");
    expect(email.text).toContain("Your consultant has changed");
    expect(email.html).toContain("/portal");
    expect(email.html + email.text).not.toMatch(/Dana|Spousal/);
    // The firm is named three times in the body (responsible, stays with, contact), every one filled.
    expect(email.text).toContain("A different consultant at Test Firm is now responsible for your file, and your file stays with Test Firm.");
    expect(email.text).toContain("If you have questions or don't agree with this change, contact Test Firm.");
    expect(email.text + email.html).not.toContain("{firm_name}");
  });
});
