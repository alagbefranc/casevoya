import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PersonHistory } from "@/components/sheet/designer/person-history";
import { latestAnswers, reviewFlags, type AnswerVersion } from "@/modules/intake/present";
import type { IntakeField } from "@/modules/sheet/intake-builder-present";
import { currentEntries, historyError, identityFlags, maskNumber, personHistoryPanel, recordedNames, type IdentityEntry } from "@/modules/sheet/person-history-present";

// INT-05 (#177): a person's other names, passports and addresses, and the review flags on them.
// Synthetic records only.

let n = 0;
const entry = (kind: IdentityEntry["kind"], data: Record<string, unknown>, extra: Partial<IdentityEntry> = {}): IdentityEntry => ({
  id: `e${++n}`,
  kind,
  data,
  replacesId: null,
  retired: false,
  createdAt: `2026-10-${String(10 + n).padStart(2, "0")}T09:00:00Z`,
  createdBy: "u-staff",
  ...extra,
});

const who = (id: string | null) => (id === "u-staff" ? "Dana Staff" : "Someone");
const base = { displayName: "Casey Client", dateOfBirth: "1984-03-12", birthPrecision: "day", today: "2026-10-24" };

describe("identity history", () => {
  it("keeps only entries no later row replaces or removes, and masks passport numbers", () => {
    const alias = entry("name", { name_kind: "alias", name: "Casey C" });
    const changed = entry("name", { name_kind: "alias", name: "K. Client" }, { replacesId: alias.id });
    const old = entry("address", { address: "1 Road", from_on: "2019-01-01" });
    const removed = entry("address", { address: "1 Road", from_on: "2019-01-01" }, { replacesId: old.id, retired: true });
    expect(currentEntries([alias, changed, old, removed]).map((row) => row.id)).toEqual([changed.id]);
    expect(recordedNames([alias, changed, old, removed])).toEqual(["K. Client"]);
    expect(maskNumber("A12345678")).toBe("•••• 5678");
    expect(maskNumber("A123")).toBe("••••");
  });

  it("flags overlapping and missing address periods, an expired passport, and a passport name or birth date that differs", () => {
    const flags = identityFlags({
      ...base,
      entries: [
        entry("address", { address: "1 Road", from_on: "2018-01-01", to_on: "2020-06-30" }),
        entry("address", { address: "2 Street", from_on: "2020-06-01", to_on: "2022-01-31" }),
        entry("address", { address: "3 Lane", from_on: "2022-05-01" }),
        entry("passport", { country: "NG", number: "A12345678", expires_on: "2024-03-03", name: "Casey Klient", birth_date: "1984-03-21" }),
        entry("passport", { country: "CA", number: "GA123456", expires_on: "2033-01-01", name: "Casey Client", current: true }),
      ],
    });
    expect(flags.map((flag) => [flag.kind, flag.label, flag.detail])).toEqual([
      ["overlap", "Overlap", "Addresses: “1 Road” runs to 30 Jun 2020 and “2 Street” starts 1 Jun 2020"],
      ["gap", "Gap", "Addresses: nothing between 31 Jan 2022 and 1 May 2022"],
      ["expired", "Expired", "Passport NG •••• 5678 expired 3 Mar 2024"],
      ["name", "Name differs", "Passport NG •••• 5678 reads “Casey Klient”; the record says “Casey Client” and no other name recorded matches"],
      ["birth", "Differs from record", "Passport NG •••• 5678 gives the date of birth as 21 Mar 1984; the record says 1984-03-12"],
    ]);
    // No wording ever calls a flag fraud.
    expect(JSON.stringify(flags)).not.toMatch(/fraud/i);
    // A move on the next day is neither a gap nor an overlap; an address with no end date before a later one overlaps.
    expect(identityFlags({ ...base, entries: [entry("address", { address: "A", from_on: "2020-01-01", to_on: "2020-05-31" }), entry("address", { address: "B", from_on: "2020-06-01" })] })).toEqual([]);
    expect(identityFlags({ ...base, entries: [entry("address", { address: "A", from_on: "2020-01-01" }), entry("address", { address: "B", from_on: "2021-06-01" })] })[0].kind).toBe("overlap");
  });

  it("doesn't flag a passport name a recorded other name covers", () => {
    const entries = [entry("name", { name_kind: "maiden", name: "Casey Klient" }), entry("passport", { country: "NG", number: "A12345678", expires_on: "2030-01-01", name: "Klient, Casey" })];
    expect(identityFlags({ ...base, entries })).toEqual([]);
  });

  it("puts a resolved flag under Resolved with its note, and counts the earlier entries on record", () => {
    const passport = entry("passport", { country: "NG", number: "A12345678", expires_on: "2024-03-03", current: false });
    const panel = personHistoryPanel(
      {
        organizationId: "o1",
        personId: "p1",
        name: "Casey Client",
        dateOfBirth: null,
        birthPrecision: null,
        entries: [entry("name", { name_kind: "transliteration", name: "Кейси", script: "Cyrillic" }), passport, entry("passport", { country: "CA", number: "GA123456", expires_on: "2033-01-01", current: true })],
        resolutions: [{ flagKey: `expired:${passport.id}`, detail: "Passport NG •••• 5678 expired 3 Mar 2024", note: "Replaced by the Canadian passport", createdAt: "2026-10-23T15:00:00Z", createdBy: "u-staff" }],
        edit: true,
        resolve: true,
      },
      who,
      "UTC",
      "2026-10-24",
    );
    expect(panel.flags).toEqual([]);
    expect(panel.resolved).toEqual([{ label: "Expired", detail: "Passport NG •••• 5678 expired 3 Mar 2024", note: "Replaced by the Canadian passport", by: "Dana Staff, 23 Oct" }]);
    expect(panel.names[0].cells).toEqual(["Кейси", "Transliteration", "Cyrillic"]);
    expect(panel.passports.map((row) => [row.cells[0], row.cells[1], row.badge?.label])).toEqual([
      ["Canada", "•••• 3456", "Current"],
      ["Nigeria", "•••• 5678", "Expired"],
    ]);
    expect(panel.earlier).toBe(0);

    const html = renderToStaticMarkup(createElement(PersonHistory, { panel, index: 3 }));
    expect(html).toContain("Casey Client: names, passports and addresses");
    expect(html).toContain('<span class="bd ok"><i></i>Resolved</span>');
    expect(html).toContain("“Replaced by the Canadian passport”, Dana Staff, 23 Oct");
    expect(html).not.toContain("A12345678");
    expect(html).toContain('data-ph-add="passport" data-person="p1" data-org="o1"');
    expect(html).toContain("Flags are things to check, never a finding of fraud.");
  });

  it("shows an open flag with Resolve only to a reviewer, and no Add or Remove to someone who can't edit", () => {
    const panel = personHistoryPanel(
      { organizationId: "o1", personId: "p1", name: "Casey Client", dateOfBirth: null, birthPrecision: null, entries: [entry("passport", { country: "NG", number: "A12345678", expires_on: "2024-03-03" })], resolutions: [], edit: false, resolve: false },
      who,
      "UTC",
      "2026-10-24",
    );
    const html = renderToStaticMarkup(createElement(PersonHistory, { panel, index: 3 }));
    expect(html).toContain('<span class="bd chg"><i></i>1 to check</span>');
    expect(html).not.toContain("data-ph-resolve");
    expect(html).not.toContain("data-ph-add");
    expect(html).not.toContain("data-ph-remove");
    const reviewer = renderToStaticMarkup(createElement(PersonHistory, { panel: { ...panel, resolve: true }, index: 3 }));
    expect(reviewer).toMatch(/data-ph-resolve="expired:e\d+" data-detail="Passport NG •••• 5678 expired 3 Mar 2024"/);
  });

  it("words the database's refusals for people", () => {
    expect(historyError("person history denied")).toBe("You can’t change this person’s record.");
    expect(historyError("a transliteration needs its script")).toBe("A transliteration needs its script.");
    expect(historyError("that entry was already changed; reload to see the latest")).toBe("Someone changed this entry already. Reload to see the latest.");
    expect(historyError("relation does not exist")).toBe("That didn’t save. Try again.");
  });
});

describe("the Intake tab's name check", () => {
  const fields: IntakeField[] = [{ key: "full_name", type: "text", labels: { en: "Full name" } }];
  const answers = latestAnswers([{ id: "a1", fieldKey: "full_name", presence: "provided", value: { text: "Casey Klient" }, createdAt: "2026-10-20T09:00:00Z", createdBy: null } satisfies AnswerVersion]);
  it("doesn't flag a name a recorded other name covers", () => {
    expect(reviewFlags({ fields, answers, record: { displayName: "Casey Client", dateOfBirth: null, birthPrecision: null }, today: "2026-10-24" }).map((flag) => flag.kind)).toEqual(["name"]);
    expect(reviewFlags({ fields, answers, record: { displayName: "Casey Client", dateOfBirth: null, birthPrecision: null, aliases: ["Casey Klient"] }, today: "2026-10-24" })).toEqual([]);
  });
});
