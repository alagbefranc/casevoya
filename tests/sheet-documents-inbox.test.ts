import { describe, expect, it } from "vitest";
import { abandoned, cardStates, currentVersions, fileIcon, queueEntry, versionTitle, whenLabel, type VersionFacts } from "@/modules/sheet/documents-present";
import { readDocumentReview, reviewStepUpLocation } from "@/modules/sheet/documents-review";
import { attachmentImage, deliveryProblem, inboxTab, listWhen, noticeLabel, snippet, suggest, type Candidate } from "@/modules/sheet/inbox-present";

const NOW = new Date("2026-10-18T14:00:00Z");
const TODAY = "2026-10-18";
const V = "11111111-1111-4111-8111-111111111111";

function version(over: Partial<VersionFacts> = {}): VersionFacts {
  return {
    id: V,
    documentId: "d1",
    versionNumber: 1,
    uploadState: "clean",
    scanResult: "structural_only",
    reviewState: "pending",
    declaredMediaType: "application/pdf",
    expiresOn: null,
    supersededAt: null,
    intentExpiresAt: "2026-10-18T13:00:00Z",
    createdAt: "2026-10-16T10:00:00Z",
    ...over,
  };
}

describe("Documents page presentation (DOC-02, DOC-04, DOC-06)", () => {
  it("keeps the newest settled version as current, skipping uploads nobody finished", () => {
    const old = version({ id: "a", versionNumber: 1, reviewState: "rejected" });
    const lapsed = version({ id: "b", versionNumber: 2, uploadState: "failed", scanResult: "intent_expired" });
    const pending = version({ id: "c", versionNumber: 3, uploadState: "uploading", intentExpiresAt: "2026-10-18T13:59:00Z" });
    expect(abandoned(lapsed, NOW)).toBe(true);
    expect(abandoned(pending, NOW)).toBe(true);
    expect(currentVersions([old, lapsed, pending], NOW).get("d1")?.id).toBe("a");
    const fresh = version({ id: "e", versionNumber: 4, uploadState: "uploading", intentExpiresAt: "2026-10-18T14:10:00Z" });
    expect(currentVersions([old, fresh], NOW).get("d1")?.id).toBe("e");
  });

  it("puts clean pending, quarantined, failed and expiring files in To review, and nothing else", () => {
    expect(queueEntry(version(), TODAY)).toMatchObject({ review: { tone: "rev", label: "Awaiting review" }, flag: "review", reviewable: true });
    expect(queueEntry(version({ uploadState: "quarantined", scanResult: "extension_mismatch" }), TODAY)).toMatchObject({
      scan: { tone: "bad", pair: ["Quarantined", "not a PDF"] },
      review: "Can’t open",
      flag: "quarantined",
      reviewable: false,
    });
    expect(queueEntry(version({ uploadState: "failed", scanResult: "unrecognized_type" }), TODAY)?.scan).toEqual({ tone: "bad", pair: ["Check failed", "unknown file type"] });
    expect(queueEntry(version({ reviewState: "accepted", expiresOn: "2026-11-07" }), TODAY)?.review).toEqual({ tone: "chg", label: "Expires in 20 days" });
    expect(queueEntry(version({ reviewState: "accepted", expiresOn: "2026-10-17" }), TODAY)?.review).toEqual({ tone: "bad", label: "Expired" });
    expect(queueEntry(version({ reviewState: "accepted", expiresOn: "2027-06-01" }), TODAY)).toBeNull();
    expect(queueEntry(version({ reviewState: "accepted" }), TODAY)).toBeNull();
    expect(queueEntry(version({ reviewState: "rejected" }), TODAY)).toBeNull();
    expect(queueEntry(version({ uploadState: "scanning" }), TODAY)).toBeNull();
    expect(queueEntry(version({ supersededAt: "2026-10-17T00:00:00Z" }), TODAY)).toBeNull();
  });

  it("keeps upload state and firm review apart on the cards, in the Designer's words", () => {
    expect(cardStates(version({ reviewState: "accepted" }), TODAY)).toEqual([
      { tone: "unv", label: "Uploaded" },
      { tone: "ok", label: "Accepted" },
    ]);
    expect(cardStates(version({ reviewState: "rejected" }), TODAY)[1]).toEqual({ tone: "chg", label: "Changes needed" });
    expect(cardStates(version({ uploadState: "failed" }), TODAY)).toEqual([{ tone: "bad", label: "Upload failed" }]);
    expect(cardStates(version({ uploadState: "uploading" }), TODAY)).toEqual([{ tone: "unv", label: "Checking file" }]);
    expect(cardStates(null, TODAY)).toEqual([{ tone: "chg", label: "Requested" }]);
    expect(cardStates(version({ uploadState: "quarantined" }), TODAY).map((chip) => chip.label)).not.toContain("Accepted");
  });

  it("formats times, titles and icons", () => {
    expect(whenLabel("2026-10-18T12:41:00Z", "America/Toronto", TODAY)).toBe("Today 08:41");
    expect(whenLabel("2026-10-16T12:41:00Z", "America/Toronto", TODAY)).toBe("16 Oct");
    expect(versionTitle("Marriage certificate", 2)).toBe("Marriage certificate v2");
    expect(versionTitle("Passport", 1)).toBe("Passport");
    expect(fileIcon("image/png")).toBe("file-png");
    expect(fileIcon("image/heic")).toBe("file");
  });

  it("reads the review dialog and requires a reason", () => {
    expect(readDocumentReview({ versionId: V, version: "3", decision: "accepted", reason: "ok" })).toEqual({ error: "Say briefly why it is accepted." });
    expect(readDocumentReview({ versionId: V, version: "3", decision: "changes_requested", reason: "" })).toEqual({ error: "Say what the client needs to change." });
    expect(readDocumentReview({ versionId: "x", version: "3", decision: "accepted", reason: "Clear copy" })).toHaveProperty("error");
    expect(readDocumentReview({ versionId: V, version: "3", decision: "accepted", reason: " Clear copy ", expires: "2027-01-01", previousExpires: "" })).toEqual({
      input: { versionId: V, expectedVersion: 3, decision: "accepted", reason: "Clear copy", expiry: "2027-01-01" },
    });
    expect(readDocumentReview({ versionId: V, version: "3", decision: "accepted", reason: "Clear copy", expires: "2027-01-01", previousExpires: "2027-01-01" })).toMatchObject({ input: { expiry: undefined } });
    expect(readDocumentReview({ versionId: V, version: "3", decision: "accepted", reason: "Clear copy", expires: "", previousExpires: "2027-01-01" })).toMatchObject({ input: { expiry: null } });
    expect(reviewStepUpLocation("/sheet/documents", "?tab=review", V)).toBe(`/mfa?step=6&next=${encodeURIComponent(`/sheet/documents?tab=review&dlg=review&doc=${V}`)}`);
  });
});

describe("Inbox presentation (OPS-06)", () => {
  const org = "33333333-3333-4333-8333-333333333333";
  const dana: Candidate = { personId: "p1", name: "Dana Lee", matterId: "m1", matter: "MI-1", email: "dana@example.test" };
  const sam: Candidate = { personId: "p2", name: "Sam Lee", matterId: "m1", matter: "MI-1", email: "family@example.test" };
  const kim: Candidate = { personId: "p3", name: "Kim Lee", matterId: "m2", matter: "MI-2", email: "family@example.test" };

  it("suggests the person on the matter a reply address names, without trusting the sender", () => {
    const result = suggest({ emailId: "e1", organizationId: org, from: "DANA@example.test", ready: true, addressMatter: { id: "m1", label: "MI-1", people: [dana, sam] }, byEmail: [] });
    expect(result.suggestion).toEqual(["MI-1", "Dana Lee"]);
    expect(result.why).toEqual(["Sent to this matter’s reply address", "email matches, sender not verified"]);
    expect(result.actions.map((action) => action.label)).toEqual(["Confirm match", "Sam", "Not case mail"]);
    expect(result.actions[0]).toMatchObject({ primary: true, attrs: { "data-inbox-file": "e1", "data-person": "p1", "data-matter": "m1", "data-org": org } });
  });

  it("never matches a shared email to one person, and offers only dismissal with no match", () => {
    const shared = suggest({ emailId: "e2", organizationId: org, from: "family@example.test", ready: true, addressMatter: null, byEmail: [sam, kim] });
    expect(shared.suggestion).toBe("2 possible people");
    expect(shared.why).toEqual(["Shared email", "can’t match on email alone"]);
    expect(shared.actions.some((action) => action.primary)).toBe(false);
    expect(shared.actions.map((action) => action.label)).toEqual(["Sam, MI-1", "Kim, MI-2", "Not case mail"]);
    const none = suggest({ emailId: "e3", organizationId: org, from: "x@example.test", ready: true, addressMatter: null, byEmail: [] });
    expect(none).toEqual({ suggestion: "No match", why: "—", actions: [{ label: "Not case mail", attrs: { "data-inbox-dismiss": "e3", "data-org": org } }] });
    const arriving = suggest({ emailId: "e4", organizationId: org, from: "x@example.test", ready: false, addressMatter: null, byEmail: [dana] });
    // Still being checked: nothing is filed yet, but plain junk can be dismissed already.
    expect(arriving.actions).toEqual([{ label: "Not case mail", attrs: { "data-inbox-dismiss": "e4", "data-org": org } }]);
  });

  it("names tabs, notices, problems and previews plainly", () => {
    expect(inboxTab("triage")).toBe("triage");
    expect(inboxTab("nope")).toBe("conv");
    expect(noticeLabel("reminder", true)).toBe("Deadline reminder (critical)");
    expect(deliveryProblem("failed", 3)).toEqual(["Sending failed", "3 attempts"]);
    expect(attachmentImage("quarantined", "application/pdf")).toBe("preview-quarantined");
    expect(attachmentImage("clean", "application/pdf")).toBeNull();
    expect(attachmentImage("clean", "image/heic")).toBe("fallback-heic");
    expect(listWhen("2026-10-17T15:00:00Z", "America/Toronto", TODAY)).toBe("Yesterday");
    expect(snippet(null, "  Hello\n there ")).toBe("Hello there");
  });
});
