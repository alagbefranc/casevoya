/**
 * SRC-09 on the Vo drafts page: each draft's citations are linked (records to their matter tab,
 * official content to its official page, opened in a new tab), an advice-like draft says it needs
 * a licensed member's review and only a licensed viewer gets Accept, and the abstention reads
 * "Vo can't answer this from the file or approved sources".
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SourceTimeline } from "@/components/sheet/designer/drafts";
import * as present from "@/modules/sheet/vo-present";
import { voError } from "@/modules/vo/errors";

const ORG = "7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const THREAD = "11111111-1111-4111-8111-111111111111";
const MATTER = "22222222-2222-4222-8222-222222222222";
const RUN = "33333333-3333-4333-8333-333333333333";
const DRAFT = "44444444-4444-4444-8444-444444444444";
const FEES = "https://ircc.canada.ca/english/information/fees/fees.asp";

const names = { matter: () => "Synthetic Applicant", reference: () => "SF-2026-0001", person: () => "A staff member" };
const viewer = (licensed: boolean): present.VoViewer => ({ organizationId: ORG, firmName: "Synthetic Firm", isOwner: false, sampleMode: false, agentReady: true, timeZone: "America/Toronto", licensed });

function page(licensed: boolean, licensedReview: boolean) {
  return present.draftsPage({
    viewer: viewer(licensed),
    settings: present.effectiveSettings({ enabled: true }, false),
    waiting: [
      {
        id: DRAFT,
        runId: RUN,
        kind: "message_reply",
        title: "Reply to Synthetic Applicant",
        body: "Thanks. The fee is listed on the IRCC fee list.",
        sources: [
          { kind: "message", id: "m", label: "Client message 17 Oct" },
          { kind: "official", id: "f", label: "IRCC fee: Study permit", sourceKind: "fee", url: FEES },
        ],
        matterId: MATTER,
        threadId: THREAD,
        status: "draft",
        edited: null,
        needsRule: false,
        isSample: false,
        createdAt: "2026-10-25T13:00:00Z",
        reviewedAt: null,
        reviewedBy: null,
        latencyMs: 1200,
        licensedReview,
      },
    ],
    week: [],
    running: null,
    abstained: { id: RUN, kind: "ask", result: "abstained", matterId: MATTER, threadId: null, userId: RUN, model: null, promptVersion: "ask-2", sourceCount: null, tools: [], costUsd: null, failure: null, useful: null, createdAt: "2026-10-25T13:00:00Z", draft: null },
    names,
  });
}

describe("Vo drafts page citations and licensed review", () => {
  it("links each citation: the record's matter tab, and the official page in a new tab", () => {
    const card = page(true, true).cards[0];
    expect(card.timeline.items).toEqual([
      { label: "Client message 17 Oct", href: `/sheet/matters/${MATTER}?tab=messages&thread=${THREAD}` },
      { label: "IRCC fee: Study permit", href: FEES },
      "Run logged",
    ]);
    const html = renderToStaticMarkup(createElement(SourceTimeline, { data: card.timeline }));
    expect(html).toContain(`<a href="/sheet/matters/${MATTER}?tab=messages&amp;thread=${THREAD}">Client message 17 Oct</a>`);
    expect(html).toContain(`<a href="${FEES}" target="_blank" rel="noopener noreferrer">IRCC fee: Study permit</a>`);
    expect(html).toContain("<li>Run logged</li>");
  });

  it("marks an advice-like draft and offers Accept only to a licensed member", () => {
    const unlicensed = page(false, true).cards[0];
    expect(unlicensed.meta).toContain("needs a licensed member’s review");
    expect(unlicensed.accept).toMatchObject({ disabled: true, title: "It reads as advice, so a licensed member of the firm reviews and sends it" });
    expect(unlicensed.accept).not.toHaveProperty("data-vo-accept");
    const licensed = page(true, true).cards[0];
    expect(licensed.accept).toMatchObject({ "data-vo-accept": DRAFT, "data-org": ORG });
    const plain = page(false, false).cards[0];
    expect(plain.meta).not.toContain("needs a licensed member’s review");
    expect(plain.accept).toMatchObject({ "data-vo-accept": DRAFT });
  });

  it("shows the abstention plainly", () => {
    const data = page(true, false);
    expect(data.abstain?.title).toBe("Synthetic Applicant: Vo can’t answer this from the file or approved sources");
  });

  it("explains the database's licensed-review and step-up refusals", () => {
    expect(voError("licensed_review")).toMatch(/licensed member of the firm reviews and sends it/);
    expect(voError("step_up")).toMatch(/fresh two-step check/);
  });
});
