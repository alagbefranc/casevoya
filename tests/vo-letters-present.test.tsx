/**
 * AI-01 letters on a matter, presented (src/modules/sheet/letters-present.ts and
 * src/components/sheet/designer/matter-letters.tsx): the DRAFT label until a licensed member
 * approves it, Approve only for licensed members, Download only once approved, each cited fact
 * with its form and approver, each official source with its URL, date checked and fingerprint,
 * what was left out, and "Draft letter with Vo" only while Vo and its letter switch are on (New
 * letter always). Synthetic records only.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MatterLetterDialogs, MatterLetters } from "@/components/sheet/designer/matter-letters";
import { MatterRbar } from "@/components/sheet/designer/matter";
import { letterDialogId, lettersDialogs, lettersRbar, voLetterCard, type LetterRow, type LetterVersionRow, type LettersViewer } from "@/modules/sheet/letters-present";

const ORG = "11111111-1111-4111-8111-111111111111";
const MATTER = "22222222-2222-4222-8222-222222222222";
const LETTER = "33333333-3333-4333-8333-333333333333";
const MEMBER = "44444444-4444-4444-8444-444444444444";

const viewer = (extra: Partial<LettersViewer> = {}): LettersViewer => ({
  organizationId: ORG,
  matterId: MATTER,
  timeZone: "America/Toronto",
  canWrite: true,
  licensed: false,
  vo: "on",
  ...extra,
});

const names = { member: (id: string | null) => (id === MEMBER ? "Synthetic Consultant" : "a licensed member"), user: () => "Synthetic Manager" };

const row = (extra: Partial<LetterRow> = {}): LetterRow => ({
  id: LETTER,
  letter_type: "cover_letter",
  title: "Cover letter",
  origin: "vo",
  status: "draft",
  current_version: 1,
  approved_version: null,
  approved_by_membership_id: null,
  approved_at: null,
  approved_self: null,
  created_at: "2026-10-24T14:00:00Z",
  updated_at: "2026-10-24T14:00:00Z",
  version: 1,
  is_sample: true,
  ...extra,
});

const version: LetterVersionRow = {
  letter_id: LETTER,
  version_number: 1,
  title: "Cover letter",
  body: "Dear officer,\n\nThis letter is for Synthetic Applicant [F1]. The Synthetic test fee of CAD 12.34 was paid [S1].",
  facts: [{ ref: "F1", person: "Synthetic Applicant", form: "Background questions", label: "Full name", value: "Synthetic Applicant", field_type: "text", reviewer_membership_id: MEMBER, reviewed_at: "2026-10-20T15:00:00Z" }],
  official: [
    {
      ref: "S1",
      kind: "fee",
      content: "Synthetic test fee: CAD 12.34",
      source_url: "https://ircc.canada.ca/english/information/fees/fees.asp",
      source_section: "Synthetic section",
      checked_on: "2026-10-23",
      snapshot_sha256: "a".repeat(64),
      reviewed_at: "2026-10-23T16:00:00Z",
    },
  ],
  left_out: ["Left out: Biometrics fee: no approved source"],
  origin: "vo",
  created_by: "55555555-5555-4555-8555-555555555555",
  created_at: "2026-10-24T14:00:00Z",
};

describe("Letters on a matter", () => {
  it("offers Draft letter with Vo only while Vo and its letter switch are on; New letter always", () => {
    expect(lettersRbar([], viewer()).vo).toEqual({ "data-dlg": "dlgVoLetter" });
    expect(lettersRbar([], viewer({ vo: "unavailable" })).vo).toMatchObject({ disabled: true });
    expect(lettersRbar([], viewer({ vo: "off" })).vo).toBeNull();
    expect(lettersRbar([], viewer({ vo: "off" })).manual).toEqual({ "data-dlg": "dlgLetterNew" });
    const off = renderToStaticMarkup(createElement(MatterLetters, { data: lettersRbar([], viewer({ vo: "off" })) }));
    expect(off).not.toContain("Draft letter with Vo");
    expect(off).toContain("New letter");
    expect(off).toContain("No letters on this matter yet.");
    const dialogs = lettersDialogs([], [], viewer({ vo: "off" }), names);
    expect(dialogs.vo).toBeNull();
    expect(renderToStaticMarkup(createElement(MatterLetterDialogs, { data: dialogs }))).not.toContain("dlgVoLetter");
  });

  it("labels a draft, shows its cited facts and sources with their provenance and what was left out, and can't be released", () => {
    const data = lettersDialogs([row()], [version], viewer(), names);
    const letter = data.letters[0];
    expect(letter.id).toBe(letterDialogId(LETTER));
    expect(letter.badge).toEqual({ tone: "chg", label: "Draft, needs licensed review" });
    expect(letter.download).toBeNull();
    expect(letter.approve).toMatchObject({ disabled: true, title: "Only a licensed member of the firm can approve a letter" });
    expect(letter.facts).toEqual([
      { ref: "F1", text: "Synthetic Applicant: Full name: Synthetic Applicant", detail: "From the intake form “Background questions” · approved by Synthetic Consultant on 20 Oct 2026" },
    ]);
    expect(letter.sources[0]).toMatchObject({
      ref: "S1",
      text: "IRCC fee: Synthetic test fee: CAD 12.34",
      href: "https://ircc.canada.ca/english/information/fees/fees.asp",
      detail: "section: Synthetic section · checked 23 Oct 2026 · page fingerprint (SHA-256) aaaaaaaaaaaa… · approved by a licensed member on 23 Oct 2026",
    });
    expect(letter.leftOut).toEqual(["Left out: Biometrics fee: no approved source"]);
    const html = renderToStaticMarkup(createElement(MatterLetterDialogs, { data }));
    expect(html).toContain("Letter (DRAFT)");
    expect(html).toContain("can’t be released or used as final until a licensed member");
    expect(html).not.toContain("Download final letter");
    expect(html).toContain('href="https://ircc.canada.ca/english/information/fees/fees.asp"');
  });

  it("lets a licensed member approve a draft, and offers the download only once approved", () => {
    const draft = lettersDialogs([row()], [version], viewer({ licensed: true }), names).letters[0];
    expect(draft.approve).toMatchObject({ "data-letter-approve": LETTER, "data-org": ORG, "data-version": "1" });
    const approved = lettersDialogs(
      [row({ status: "approved", approved_version: 1, approved_by_membership_id: MEMBER, approved_at: "2026-10-24T16:00:00Z", approved_self: false, version: 2 })],
      [version],
      viewer({ licensed: true }),
      names,
    ).letters[0];
    expect(approved.approve).toBeNull();
    expect(approved.revise).toBeNull();
    expect(approved.editable).toBe(false);
    expect(approved.download).toBe(`/api/letters/${LETTER}?organizationId=${ORG}`);
    expect(approved.review).toMatch(/^Approved by Synthetic Consultant on 24 Oct 2026 \(version 1\)\./);
  });

  it("puts the newest Vo draft in Vo's Assist card, whose buttons open it or discard it", () => {
    const card = voLetterCard([row()], [version], viewer());
    expect(card).toMatchObject({
      sources: "Cites 1 approved fact and 1 official source · a licensed member approves it before release",
      accept: { "data-dlg": letterDialogId(LETTER) },
      reject: { "data-letter-discard": LETTER },
    });
    expect(card?.draft).not.toContain("[F1]");
    expect(voLetterCard([row({ origin: "staff" })], [version], viewer())).toBeNull();
    const html = renderToStaticMarkup(
      createElement(MatterRbar, {
        data: { vo: card, letters: lettersRbar([row()], viewer()), agreement: { title: "No agreement yet", state: null, parts: [] } },
      }),
    );
    expect(html).toContain(`data-ai="ok" data-dlg="${letterDialogId(LETTER)}" title="Open the letter to review and approve it"`);
    expect(html).toContain("Draft letter with Vo");
  });
});
