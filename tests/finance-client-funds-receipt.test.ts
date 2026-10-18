import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import {
  firmLine,
  heldIn,
  licenseeLine,
  longDate,
  RECEIPT_RULE,
  receiptFilename,
  receiptFromRpc,
  receiptRows,
  renderReceiptPdf,
  SAMPLE_NOTICE,
  type ClientFundReceipt,
} from "@/modules/finance/receipt-pdf";
import { pdfText } from "./helpers/pdf-text";

/** The client_fund_receipt RPC's JSON, synthetic values only. */
const RPC = {
  number: "RC-0001",
  issued_at: "2026-10-18T18:05:07.000Z",
  received_on: "2026-10-16",
  amount_cents: 180_800,
  currency: "CAD",
  method: "interac_e_transfer",
  reference: "REF-55102",
  client_name: "Zoé Synthétique",
  matter_label: "CA-2026-0001 · Synthetic matter",
  firm_legal_name: "Synthetic Legal Name Inc.",
  firm_display_name: "Synthetic Firm",
  firm_timezone: "America/Toronto",
  consultant_name: "Synthetic Consultant",
  consultant_licence: "RCIC R000001",
  account_label: "Client account",
  account_institution: "Synthetic Bank",
  account_last4: "4410",
  is_sample: false,
};

function receipt(overrides: Partial<typeof RPC> = {}): ClientFundReceipt {
  const parsed = receiptFromRpc({ ...RPC, ...overrides });
  if (!parsed) throw new Error("fixture did not parse");
  return parsed;
}

describe("receipt presenter (CICC Code s. 32(b))", () => {
  it("parses the RPC and refuses one missing what the receipt must show", () => {
    expect(receipt()).toMatchObject({ number: "RC-0001", amountCents: 180_800, clientName: "Zoé Synthétique", consultantLicence: "RCIC R000001", isSample: false });
    expect(receiptFromRpc({ ...RPC, amount_cents: 0 })).toBeNull();
    expect(receiptFromRpc({ ...RPC, number: "" })).toBeNull();
    expect(receiptFromRpc({ ...RPC, account_last4: null })).toBeNull();
    expect(receiptFromRpc(null)).toBeNull();
    expect(receiptFromRpc({ ...RPC, reference: null, consultant_licence: null, consultant_name: null })).toMatchObject({ reference: null, consultantLicence: null });
  });

  it("states the amount, date, client, matter, method, reference, account and firm with its licence", () => {
    const rows = Object.fromEntries(receiptRows(receipt()));
    expect(rows).toEqual({
      "Receipt number": "RC-0001",
      "Amount received": "CAD 1,808.00",
      "Date received": "16 October 2026",
      "Received from": "Zoé Synthétique",
      Matter: "CA-2026-0001 · Synthetic matter",
      Method: "Interac e-Transfer",
      Reference: "REF-55102",
      "Held in": "Held in the firm’s client account at Synthetic Bank ••• 4410 (Client account)",
      Firm: "Synthetic Legal Name Inc. (Synthetic Firm)",
      Licensee: "Synthetic Consultant, CICC licence RCIC R000001",
      Issued: "18 October 2026, 14:05:07 EDT",
    });
    expect(receiptRows(receipt()).map(([label]) => label)[0]).toBe("Receipt number");
  });

  it("invents nothing: no licence row without a licence on file, and the cash label loses its note", () => {
    const rows = Object.fromEntries(receiptRows(receipt({ consultant_name: null as unknown as string, consultant_licence: null as unknown as string, method: "cash", reference: null as unknown as string })));
    expect(rows).not.toHaveProperty("Licensee");
    expect(rows.Method).toBe("Cash");
    expect(rows.Reference).toBe("None given");
    expect(licenseeLine({ consultantName: "A", consultantLicence: null })).toBe("A");
    expect(licenseeLine({ consultantName: null, consultantLicence: "RCIC R1" })).toBe("CICC licence RCIC R1");
    expect(firmLine({ firmLegalName: "Same", firmDisplayName: "Same" })).toBe("Same");
    expect(heldIn({ accountLabel: "Trust", accountInstitution: "Bank", accountLast4: "0001" })).toBe("Held in the firm’s client account at Bank ••• 0001 (Trust)");
    expect(longDate("2026-02-01")).toBe("1 February 2026");
    expect(receiptFilename({ number: "RC-0012" })).toBe("receipt-rc-0012.pdf");
  });

  it("renders a one-page PDF with every row, the rule it is given under, and accents intact", async () => {
    const bytes = await renderReceiptPdf(receipt());
    expect(Buffer.from(bytes.subarray(0, 5)).toString("latin1")).toBe("%PDF-");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getTitle()).toBe("Receipt RC-0001");
    const text = pdfText(bytes);
    for (const value of ["RC-0001", "CAD 1,808.00", "16 October 2026", "Zoé Synthétique", "Synthetic Bank ••• 4410", "CICC licence RCIC R000001", "REF-55102"]) {
      expect(text).toContain(value);
    }
    expect(text.replace(/\s+/g, " ")).toContain(RECEIPT_RULE.slice(0, 40));
    expect(text).not.toContain(SAMPLE_NOTICE);
    // Same input, same bytes: dates come from the receipt, not the clock.
    expect(Buffer.from(await renderReceiptPdf(receipt())).equals(Buffer.from(bytes))).toBe(true);
  });

  it("marks a sample receipt as fictional", async () => {
    const text = pdfText(await renderReceiptPdf(receipt({ is_sample: true })));
    expect(text).toContain(SAMPLE_NOTICE);
  });
});
