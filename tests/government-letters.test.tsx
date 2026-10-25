import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { IssuerList, LetterFormFields } from "@/components/sheet/designer/letter-form";
import { MatterDecisionsLive } from "@/components/sheet/designer/matter-government";
import { readIssuerPage } from "@/modules/government/issuer-page";
import {
  issuerSourceParts,
  letterError,
  officialIssuerUrl,
  pageModifiedOn,
  readLetterTasks,
  type IssuerRow,
} from "@/modules/government/letters";
import { buildDecisions, type GovernmentContext, type GovernmentRecords, type LetterRow } from "@/modules/sheet/government-present";
import { issuerList, letterForm, letterIssuerParts, letterTaskLines } from "@/modules/sheet/letter-present";

/** GOV-04 presentation: synthetic names only; no real issuer is named in these tests. */
const STAFF = "11111111-1111-4111-8111-111111111111";
const CLIENT = "22222222-2222-4222-8222-222222222222";
const TODAY = "2026-10-24";

function issuer(over: Partial<IssuerRow> = {}): IssuerRow {
  return {
    id: "i1",
    name: "Synthetic Office",
    source_url: "https://www.canada.ca/en/synthetic.html#office",
    checked_on: "2026-10-23",
    retrieved_at: "2026-10-23T15:00:00Z",
    snapshot_sha256: "abcd" + "0".repeat(56) + "ef12",
    page_modified_on: "2026-09-01",
    name_on_page: true,
    status: "approved",
    review_note: null,
    reviewed_at: "2026-10-23T16:00:00Z",
    version: 2,
    ...over,
  };
}

describe("tasks from a letter", () => {
  it("reads complete rows, skips empty ones, and refuses incomplete or past ones", () => {
    const rows = [
      { title: " Upload the passport ", owner: `client:${CLIENT}`, due: "2026-10-30" },
      { title: "", owner: `staff:${STAFF}`, due: "" },
      { title: "Prepare the reply", owner: `staff:${STAFF}`, due: TODAY },
    ];
    expect(readLetterTasks(rows, TODAY)).toEqual({
      tasks: [
        { title: "Upload the passport", owner: "client", owner_id: CLIENT, due_on: "2026-10-30" },
        { title: "Prepare the reply", owner: "staff", owner_id: STAFF, due_on: TODAY },
      ],
    });
    expect(readLetterTasks([{ title: "", owner: `staff:${STAFF}`, due: TODAY }], TODAY)).toEqual({ error: "Describe each task, or clear its row." });
    expect(readLetterTasks([{ title: "X", owner: "staff:nope", due: TODAY }], TODAY)).toEqual({ error: "Choose who owns each task." });
    expect(readLetterTasks([{ title: "X", owner: `staff:${STAFF}`, due: "" }], TODAY)).toEqual({ error: "Give each task a due date." });
    expect(readLetterTasks([{ title: "X", owner: `staff:${STAFF}`, due: "2026-10-23" }], TODAY)).toEqual({ error: "A task’s due date can’t be in the past." });
  });

  it("names each task's owner and due date on the letter", () => {
    const lines = letterTaskLines(
      [
        { correspondence_id: "l1", title: "Prepare the reply", audience: "internal", status: "open", due_on: "2026-10-28", owner_membership_id: "m1", owner_person_id: null },
        { correspondence_id: "l1", title: "Upload the passport", audience: "client", status: "done", due_on: "2027-01-04", owner_membership_id: null, owner_person_id: "p1" },
      ],
      { member: () => "Daniel Ruiz", person: () => "Ana Synthetic" },
      TODAY,
    );
    expect(lines).toEqual(["Task for Daniel Ruiz: Prepare the reply, due 28 Oct", "Client task for Ana Synthetic: Upload the passport, due 4 Jan 2027 (done)"]);
  });
});

describe("issuer source", () => {
  it("shows the URL, date checked and what the server read, or says the page wasn't read", () => {
    expect(issuerSourceParts(issuer())).toEqual([
      "Source canada.ca/en/synthetic.html#office",
      "checked 23 Oct 2026",
      "page read 23 Oct 2026, sha256 abcd…ef12",
      "page’s Date modified 2026-09-01",
    ]);
    expect(issuerSourceParts(issuer({ name_on_page: false, page_modified_on: null }))).toContain("name not found in the page’s text");
    expect(issuerSourceParts(issuer({ retrieved_at: null, snapshot_sha256: null, page_modified_on: null, name_on_page: null }))).toEqual([
      "Source canada.ca/en/synthetic.html#office",
      "checked 23 Oct 2026",
      "page not read by the server",
    ]);
    expect(letterIssuerParts("Typed Authority", null, [])).toEqual(["From Typed Authority", "typed by staff, no official source on file"]);
    expect(letterIssuerParts("Synthetic Office", "i1", [issuer()])?.[1]).toBe("Source canada.ca/en/synthetic.html#office");
    expect(letterIssuerParts(null, null, [])).toBeNull();
  });

  it("accepts only Government of Canada pages, and reads Date modified", () => {
    expect(officialIssuerUrl("https://www.canada.ca/en/x.html#a")).toBe(true);
    expect(officialIssuerUrl("https://irb-cisr.gc.ca/en/")).toBe(true);
    expect(officialIssuerUrl("http://www.canada.ca/en/x.html")).toBe(false);
    expect(officialIssuerUrl("https://canada.ca.example.com/")).toBe(false);
    expect(officialIssuerUrl("https://user@www.canada.ca/")).toBe(false);
    expect(pageModifiedOn('<dl><dt>Date modified:</dt><dd><time property="dateModified">2025-01-31</time></dd></dl>')).toBe("2025-01-31");
    expect(pageModifiedOn("<p>nothing</p>")).toBeNull();
  });

  it("reads the page on the server: hash, time, Date modified, and whether the name is on it", async () => {
    const html = '<main><h1>Synthetic&nbsp;Office</h1><time property="dateModified">2026-09-01</time></main>';
    const fetcher = (async () => new Response(html, { status: 200 })) as unknown as typeof fetch;
    const read = await readIssuerPage(fetcher, "https://www.canada.ca/en/synthetic.html#office", "Synthetic Office", () => new Date("2026-10-24T12:00:00Z"));
    expect(read).toMatchObject({ retrievedAt: "2026-10-24T12:00:00.000Z", modifiedOn: "2026-09-01", nameOnPage: true });
    expect(read?.sha256).toMatch(/^[0-9a-f]{64}$/);
    const missing = await readIssuerPage(fetcher, "https://www.canada.ca/en/synthetic.html", "Another Office");
    expect(missing?.nameOnPage).toBe(false);
    const failing = (async () => {
      throw new Error("timeout");
    }) as unknown as typeof fetch;
    expect(await readIssuerPage(failing, "https://www.canada.ca/en/synthetic.html", "Synthetic Office")).toBeNull();
    expect(await readIssuerPage(fetcher, "https://example.com/", "Synthetic Office")).toBeNull();
  });

  it("puts the database's refusals in plain words", () => {
    expect(letterError("that issuer is not on the firm's approved list")).toContain("approved list");
    expect(letterError("a task's due date cannot be in the past")).toBe("A task’s due date can’t be in the past.");
    expect(letterError("something else")).toBeNull();
  });
});

describe("issuer list and the letter dialog", () => {
  it("offers review only to a licensed member, and adding to staff", () => {
    const issuers = [issuer(), issuer({ id: "i2", name: "Waiting Office", status: "pending_review", version: 1 }), issuer({ id: "i3", name: "Old Office", status: "retired", review_note: "Renamed" })];
    const reviewer = issuerList({ organizationId: "org", today: TODAY, issuers, canAdd: true, canReview: true });
    expect(reviewer.rows.map((row) => [row.name, row.badge.label])).toEqual([
      ["Waiting Office", "Waiting for review"],
      ["Synthetic Office", "Approved"],
      ["Old Office", "Retired"],
    ]);
    expect(reviewer.rows[0].approve).toEqual({ "data-issuer": "approved", "data-org": "org", "data-id": "i2", "data-version": "1" });
    expect(reviewer.rows[1].retire).toMatchObject({ "data-issuer": "retired" });
    expect(reviewer.rows[2].note).toBe("Review note: Renamed");
    const staff = issuerList({ organizationId: "org", today: TODAY, issuers, canAdd: true, canReview: false });
    expect(staff.rows.every((row) => !row.approve && !row.reject && !row.retire)).toBe(true);
    expect(staff.add?.wire).toEqual({ "data-issuer": "propose", "data-org": "org" });
    const html = renderToStaticMarkup(createElement(IssuerList, { data: reviewer, start: 0 }));
    expect(html).toContain('id="dIssuer"');
    expect(html).toContain("data-issuer-note");
  });

  it("offers only approved issuers, staff and client owners, and the filed-email files", () => {
    const form = letterForm({
      today: TODAY,
      issuers: [issuer(), issuer({ id: "i2", name: "Waiting Office", status: "pending_review" })],
      staff: [{ id: STAFF, name: "Daniel Ruiz" }],
      clients: [{ id: CLIENT, name: "Ana Synthetic" }],
      me: STAFF,
      filed: [{ versionId: "v1", filename: "letter.pdf", subject: "Your application", receivedOn: "2026-10-22" }],
    });
    expect(form.issuers.map((row) => row.name)).toEqual(["Synthetic Office"]);
    expect(form.owners).toEqual([
      { value: `staff:${STAFF}`, label: "Daniel Ruiz" },
      { value: `client:${CLIENT}`, label: "Ana Synthetic (client, shows in their portal)" },
    ]);
    expect(form.defaultOwner).toBe(`staff:${STAFF}`);
    expect(form.filed[0].label).toBe("letter.pdf, from “Your application”, 22 Oct");
    const html = renderToStaticMarkup(createElement(LetterFormFields, { data: form }));
    expect(html).toContain('id="ltI"');
    expect(html).toContain('id="ltDd"');
    expect(html).toContain("Other (type the issuer)");
    expect(html.match(/data-letter-task=""/g)).toHaveLength(form.rows);
    // With an empty list, the dialog still works: Other is chosen and the typed field shows.
    const empty = renderToStaticMarkup(createElement(LetterFormFields, { data: { ...form, issuers: [] } }));
    expect(empty).toContain('<option value="other" data-src="" selected="">');
    expect(empty).not.toContain('id="ltIoL" hidden');
  });

  it("shows the issuer with its source and the letter's tasks on the Decisions tab", () => {
    const ctx: GovernmentContext = {
      organizationId: "org",
      matterId: "matter",
      stage: "government_processing",
      timezone: "America/Toronto",
      today: TODAY,
      now: new Date("2026-10-24T14:00:00Z"),
      memberName: () => "Daniel Ruiz",
      userName: () => "Daniel Ruiz",
      consultant: null,
      me: "Daniel Ruiz",
      role: "licensed_consultant",
      licensed: true,
      representatives: [],
    };
    const letter: LetterRow = {
      id: "l1",
      kind: "request",
      channel: "portal_message",
      received_on: "2026-10-22",
      document_date: "2026-10-20",
      action_requested: null,
      stated_deadline: null,
      evidence_version_id: null,
      evidence_locator: null,
      verified_by_membership_id: null,
      verified_at: null,
      shared_with_client_at: null,
      created_by: "u1",
      created_at: "2026-10-22T15:00:00Z",
      version: 1,
      issuer: "Synthetic Office",
      issuer_id: "i1",
    };
    const records: GovernmentRecords = {
      handoffs: [],
      letters: [letter],
      decisions: [],
      followUps: [],
      steps: [],
      checks: [],
      transitions: [],
      deadlines: [],
      representation: true,
      documents: { total: 0, open: 0 },
      expiring: [],
      issuers: [issuer()],
      people: new Map([["p1", "Ana Synthetic"]]),
      letterTasks: [
        { correspondence_id: "l1", title: "Prepare the reply", audience: "internal", status: "open", due_on: "2026-10-28", owner_membership_id: "m1", owner_person_id: null },
        { correspondence_id: "l1", title: "Upload the passport", audience: "client", status: "open", due_on: "2026-10-30", owner_membership_id: null, owner_person_id: "p1" },
      ],
    };
    const built = buildDecisions(records, ctx);
    expect(built.letters[0].parts.slice(0, 2)).toEqual(["Received 22 Oct by portal message", "dated 20 Oct"]);
    expect(built.letters[0].issuer?.[0]).toBe("From Synthetic Office");
    expect(built.letters[0].tasks).toEqual(["Task for Daniel Ruiz: Prepare the reply, due 28 Oct", "Client task for Ana Synthetic: Upload the passport, due 30 Oct"]);
    expect(built.issuers?.rows).toHaveLength(1);
    const html = renderToStaticMarkup(createElement(MatterDecisionsLive, { data: built }));
    expect(html).toContain("From Synthetic Office");
    expect(html).toContain("Client task for Ana Synthetic: Upload the passport, due 30 Oct");
    expect(html).toContain("Issuers of government letters");
    // The Government status page reads no issuer list, so it shows none.
    expect(buildDecisions({ ...records, issuers: undefined }, ctx).issuers).toBeNull();
  });
});
