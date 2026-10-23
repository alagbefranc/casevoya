import { describe, expect, it } from "vitest";
import { agreementFlags } from "@/modules/sheet/agreements-present";
import { readDocumentReview } from "@/modules/sheet/documents-review";
import { suggest, type Candidate } from "@/modules/sheet/inbox-present";

const V = "11111111-1111-4111-8111-111111111111";

describe("Documents: review", () => {
  it("won't accept a document with an expiry date already past (it would be expired at once)", () => {
    const fields = { versionId: V, version: "2", decision: "accepted", reason: "Clear copy", expires: "2026-10-01", previousExpires: "", today: "2026-10-23" };
    expect(readDocumentReview(fields)).toEqual({ error: expect.stringContaining("already passed") });
    expect(readDocumentReview({ ...fields, expires: "2026-10-23" })).toMatchObject({ input: { expiry: "2026-10-23" } });
    // Asking for changes doesn't set an expiry, so an old date there isn't in the way.
    expect(readDocumentReview({ ...fields, decision: "changes_requested" })).toHaveProperty("input");
  });
});

describe("Inbox: suggestion", () => {
  const org = "33333333-3333-4333-8333-333333333333";
  const dana: Candidate = { personId: "p1", name: "Dana Lee", matterId: "m1", matter: "MI-1", email: "dana@example.test" };

  it("says the sender is verified only when the email's sender check passed", () => {
    const base = { emailId: "e1", organizationId: org, from: "dana@example.test", ready: true, addressMatter: { id: "m1", label: "MI-1", people: [dana] }, byEmail: [] };
    expect(suggest(base).why).toEqual(["Sent to this matter’s reply address", "email matches, sender not verified"]);
    expect(suggest({ ...base, verified: true }).why).toEqual(["Sent to this matter’s reply address", "email matches, sender verified"]);
  });
});

describe("Agreements: filter chips", () => {
  it("counts a sent agreement as waiting for signatures, but never a quote (quotes are issued, not signed)", () => {
    expect(agreementFlags("sent", "service_agreement")).toContain("waiting");
    expect(agreementFlags("partially_signed", "service_agreement")).toContain("waiting");
    expect(agreementFlags("sent", "quote")).toEqual(["quote"]);
    expect(agreementFlags("expired", "service_agreement")).toEqual(["closed"]);
  });
});
