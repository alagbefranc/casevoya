import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MatterDocumentReview } from "@/components/sheet/designer/vo-doc-review";
import { VoAutoRead } from "@/components/sheet/designer/vo-auto-read";
import { aiSettings, effectiveSettings } from "@/modules/sheet/vo-present";
import { readingPanel, type VoProposalRow } from "@/modules/sheet/vo-doc-present";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined, replace: () => undefined }) }));

// DOC-05 (#178): "Read documents on upload", and a proposal's page opening the secure preview.
// Synthetic records only.

const ORG = "00000000-0000-4000-8000-00000000000a";

const proposal = (extra: Partial<VoProposalRow>): VoProposalRow => ({
  id: "p1",
  position: 1,
  kind: "field",
  label: "Full name",
  value: "Synthetic Applicant",
  detail: "name",
  page: 2,
  confidence: 91,
  category: null,
  dueOn: null,
  status: "proposed",
  ...extra,
});

const reading = (mediaType: string, versionId?: string) => ({
  id: "d1",
  organizationId: ORG,
  purpose: "Passport bio page",
  versionNumber: 1,
  mediaType,
  sha256: null,
  needsRule: false,
  proposals: [proposal({}), proposal({ id: "p2", position: 2, page: null, kind: "classification", category: "identity" })],
  ...(versionId ? { versionId } : {}),
});

describe("a proposal's page", () => {
  it("links the confidence and page to the secure preview at that page", () => {
    const panel = readingPanel(reading("application/pdf", "v1"))!;
    expect(panel.rows[0].badge).toEqual({ tone: "ok", label: "91%", detail: "p.2" });
    expect(panel.rows[0].pageHref).toBe(`/api/documents/preview/v1?org=${ORG}#page=2`);
    expect(panel.rows[1].pageHref).toBeUndefined();
    const html = renderToStaticMarkup(createElement(MatterDocumentReview, { data: panel }));
    expect(html).toContain(`href="/api/documents/preview/v1?org=${ORG}#page=2" target="_blank"`);
  });

  it("adds no link without the version (the Designer's sample) or for a file the preview can't show", () => {
    expect(readingPanel(reading("application/pdf"))!.rows[0].pageHref).toBeUndefined();
    expect(readingPanel(reading("image/heic", "v1"))!.rows[0].pageHref).toBeUndefined();
  });
});

describe("read documents on upload", () => {
  const viewer = { organizationId: ORG, firmName: "Synthetic Firm", isOwner: true, sampleMode: false, agentReady: true, timeZone: "America/Toronto" };

  it("is a firm switch, off by default, unusable while Vo is off", () => {
    expect(effectiveSettings(null, false).read_on_upload).toBe(false);
    const on = aiSettings(viewer, { ...effectiveSettings({ enabled: true }, false), saved: true });
    expect(on.firm.find((item) => item.id === "swVoUpload")).toMatchObject({ label: "Read documents on upload", on: false, attrs: { "data-vo-setting": "read_on_upload", "data-org": ORG } });
    const off = aiSettings(viewer, effectiveSettings({ enabled: false, read_on_upload: true }, false));
    expect(off.firm.find((item) => item.id === "swVoUpload")).toMatchObject({ on: false, disabled: "Vo is off for the whole firm. Turn it on first." });
  });

  it("shows nothing until it starts reading", () => {
    expect(renderToStaticMarkup(createElement(VoAutoRead, { data: { organizationId: ORG, versionIds: ["v1"] } }))).toBe("");
  });
});
