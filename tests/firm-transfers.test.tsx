import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FirmTransferDialogs, FirmTransfersPanel } from "@/components/sheet/designer/firm-transfers";
import { transferError, transferViews } from "@/modules/sheet/firm-transfers-present";

// ORG-06 (#175): the firm owner's transfer record on Settings > Team and seats. Synthetic data.

const ORG = "00000000-0000-4000-8000-000000000001";
const RAW = [
  {
    id: "t1",
    receiving_firm: "Receiving Immigration Inc.",
    contact_name: "Pat Receiver",
    contact_email: "pat@receiving.test",
    note: "Retiring.",
    status: "open",
    created_at: "2026-10-20T15:00:00Z",
    closed_at: null,
    items: [
      { id: "i1", matter_id: "m1", matter: "ON-2026-0002", authority: "authorised", authority_note: "Signed 20 Oct.", reviewed_at: "2026-10-21T15:00:00Z", export: { id: "x1", ready_at: "2026-10-22T15:00:00Z" } },
      { id: "i2", matter_id: "m2", matter: "ON-2026-0003", authority: "pending", authority_note: null, reviewed_at: null, export: null },
    ],
  },
  { id: "t0", receiving_firm: "Old Firm", status: "cancelled", created_at: "2026-09-01T15:00:00Z", closed_at: "2026-09-02T15:00:00Z", items: [] },
];

describe("firm transfers", () => {
  const views = transferViews(RAW);

  it("shows each transfer's status, each matter's authority and export, and progress", () => {
    const [open, closed] = views;
    expect(open).toMatchObject({ title: "To Receiving Immigration Inc.", status: { label: "Open" }, open: true, canComplete: false });
    expect(open.meta).toBe("Recorded 20 Oct · Pat Receiver, pat@receiving.test");
    expect(open.progress).toBe("1 of 2 authority reviewed · 1 of 2 exported");
    expect(open.items[0]).toMatchObject({ authority: { tone: "ok", label: "Client authorised" }, export: { label: "Export ready 22 Oct", href: "/sheet/exports" } });
    expect(open.items[1]).toMatchObject({ authority: { tone: "chg", label: "Authority not reviewed" }, export: { label: "Create the export" } });
    expect(closed).toMatchObject({ status: { label: "Cancelled" }, open: false });
    expect(transferViews(null)).toEqual([]);
  });

  it("renders the panel with Review authority per matter, and the three dialogs", () => {
    const data = { organizationId: ORG, transfers: views, matters: [{ id: "m1", label: "ON-2026-0002 · Work permit" }] };
    const panel = renderToStaticMarkup(createElement(FirmTransfersPanel, { data }));
    expect(panel).toContain("Firm transfers");
    expect(panel).toContain("Nothing moves on its own");
    expect(panel).toContain('data-xfer-item="i2" data-xfer-matter="ON-2026-0003">Review authority</button>');
    expect(panel).toContain(">Review again</button>");
    expect(panel).toContain('data-xfer-close="t1" data-xfer-complete="0"');
    expect(panel).toContain("Casevoya never sends a client’s records to another firm because that firm asks.");
    const dialogs = renderToStaticMarkup(createElement(FirmTransferDialogs, { data }));
    expect(dialogs).toContain('id="dlgXfer"');
    expect(dialogs).toContain('name="xfM" value="m1"');
    expect(dialogs).toContain('id="dlgXferRev"');
    expect(dialogs).toContain("Did the client authorise moving this matter to the receiving firm?");
    expect(dialogs).toContain('id="dlgXferClose"');
    const empty = renderToStaticMarkup(createElement(FirmTransfersPanel, { data: { ...data, transfers: [], matters: [] } }));
    expect(empty).toContain("No firm transfers recorded.");
    expect(empty).toMatch(/<button class="btn sm" data-dlg="dlgXfer" disabled=""/);
  });

  it("explains the database's refusals", () => {
    expect(transferError("step-up is required")).toMatchObject({ stepUp: true });
    expect(transferError("review the client's authority on every matter first")?.error).toMatch(/every matter/);
    expect(transferError("choose this firm's own matters")?.error).toMatch(/Sample matters/);
    expect(transferError("something else")).toBeNull();
  });
});
