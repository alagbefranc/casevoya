/**
 * Privacy-notice drafts. The model is a stub. These tests are not a call to Workers AI.
 */
import { describe, expect, it } from "vitest";
import { draftNoticeFromFacts } from "@/modules/portal-policies/notice-draft";
import { acceptNoticeDraft, noticeFacts, noticePrompt, readNoticeAnswers, type NoticeAnswers, type NoticeFacts } from "@/modules/portal-policies/notice-facts";
import { readPolicyDraft } from "@/modules/portal-policies/defaults";

const answers: NoticeAnswers = {
  clientInfo: ["identity", "immigration"],
  otherPurpose: "",
  sharing: "casevoya_only",
  copies: "none",
  retention: "professional_rules",
  enquiries: "90_days",
  complaintName: "",
};

function facts(): NoticeFacts {
  const built = noticeFacts({ firmName: "North Shore Immigration", contactName: "Ada Owner", contactEmail: "ada@northshore.test", requestDays: null }, answers);
  if ("error" in built) throw new Error(built.error);
  return built;
}

function complete(source: NoticeFacts, extra = ""): string {
  return [
    "Who is responsible",
    `${source.firmName} is responsible. Write to ${source.contactName}, ${source.contactEmail}.`,
    "What we collect",
    source.collects.join("; "),
    "Why we use it",
    source.purposes.join("; "),
    "Who we share it with",
    source.recipients.join("; "),
    "Where it is stored",
    source.storage,
    "How long we keep it",
    `${source.retention} ${source.enquiries}`,
    "How we protect it",
    source.safeguards.join(" "),
    "Your choices",
    source.requestAnswer,
    "Questions and complaints",
    source.complaint,
    "Changes to this notice",
    "A new version is published and the earlier one stays on record.",
    extra,
  ].join("\n\n");
}

describe("privacy notice facts", () => {
  it("refuses a draft until the owner chooses the missing facts", () => {
    expect(readNoticeAnswers({ ...answers, sharing: "" as NoticeAnswers["sharing"] })).toEqual({ error: expect.stringContaining("who else") });
    expect(readNoticeAnswers({ ...answers, clientInfo: [] })).toEqual({ error: expect.stringContaining("at least one") });
  });

  it("does not put a storage country or a client file into the prompt", () => {
    const source = facts();
    const prompt = noticePrompt(source);
    expect(prompt).toContain("North Shore Immigration");
    expect(prompt).toContain("ada@northshore.test");
    expect(prompt).not.toMatch(/Canada|United States|passport|PIPEDA/);
    expect(prompt.length).toBeLessThanOrEqual(4000);
  });

  it("keeps a complete draft and drops invented claims", () => {
    const source = facts();
    const kept = acceptNoticeDraft(complete(source, "This is not legal advice."), source);
    expect("body" in kept).toBe(true);
    if ("body" in kept) {
      expect(kept.body).not.toMatch(/legal advice/i);
      expect(readPolicyDraft({ kind: "privacy_notice", versionLabel: "1", title: "Privacy notice", body: kept.body })).toHaveProperty("input");
    }
    const country = acceptNoticeDraft(complete(source, "Files are stored in Ireland."), source);
    const years = acceptNoticeDraft(complete(source, "We keep files for 7 years."), source);
    const recipient = acceptNoticeDraft(complete(source, "We share files with IRCC."), source);
    const blank = acceptNoticeDraft(complete(source, "[Add a regulator]"), source);
    for (const result of [country, years, recipient, blank]) {
      expect("body" in result).toBe(true);
      if ("body" in result) expect(result.body).not.toMatch(/Ireland|7 years|IRCC|\[Add/);
    }
    const titled = acceptNoticeDraft(complete(source).replace("Who is responsible", "Who Is Responsible"), source);
    expect("body" in titled).toBe(true);
    const hollow = acceptNoticeDraft(complete(source).replace(source.recipients.join("; "), "We share files with IRCC."), source);
    expect(hollow).toEqual({ error: "The draft did not cover every section." });
  });

  it("allows a country that is already part of the firm name", () => {
    const built = noticeFacts(
      { firmName: "Canada Path Immigration", contactName: "Ada Owner", contactEmail: "ada@northshore.test", requestDays: 30 },
      { ...answers, retention: "2" },
    );
    if ("error" in built) throw new Error(built.error);
    const kept = acceptNoticeDraft(complete(built, "We answer within 5 days."), built);
    expect("body" in kept).toBe(true);
    if ("body" in kept) {
      expect(kept.body).toContain("Canada Path Immigration");
      expect(kept.body).toContain("2 years");
      expect(kept.body).not.toMatch(/5 days/);
    }
  });

  it("discards a stub model that invents a placeholder and reports when AI is absent", async () => {
    const source = facts();
    const cleaned = await draftNoticeFromFacts(source, { ai: { run: async () => ({ response: complete(source, "[Add your regulator]") }) } });
    expect(cleaned).toMatchObject({ body: expect.not.stringContaining("[Add") });
    const rejected = await draftNoticeFromFacts(source, { ai: { run: async () => ({ response: "Stored in Ireland." }) } });
    expect(rejected).toEqual({ error: "rejected" });
    const unavailable = await draftNoticeFromFacts(source, { ai: null });
    expect(unavailable).toEqual({ error: "unavailable" });
    const accepted = await draftNoticeFromFacts(source, { ai: { run: async () => ({ response: complete(source) }) } });
    expect(accepted).toMatchObject({ model: expect.stringContaining("llama"), body: expect.stringContaining("North Shore Immigration") });
  });
});
