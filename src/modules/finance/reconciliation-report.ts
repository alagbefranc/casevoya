/**
 * A client-account reconciliation as a PDF report (FIN-12), in the shared receipt layout
 * (`receipt-pdf.ts`): the adjusted bank balance as the headline, then the statement, the bank side's
 * outstanding items, the control ledger, the client ledgers' total, the ledger's outstanding items,
 * who prepared and signed it, and the validation notice. Pure apart from the drawing; the route reads
 * the reconciliation through RLS and audits the export.
 */
import { formatInZone, formatMoney } from "@/modules/agreements/pdf-text";
import { monthLabel } from "@/modules/finance/corrections-present";
import { longDate, renderReceiptLayout } from "@/modules/finance/receipt-pdf";

export type ReconReportItem = { label: string; date: string; cents: number };

export type ReconReport = {
  id: string;
  status: "pending_review" | "reconciled" | "exceptions" | "discarded";
  firmLegalName: string;
  firmDisplayName: string;
  firmTimezone: string;
  account: string;
  statementDate: string;
  periodStart: string;
  statementCents: number;
  depositsInTransit: ReconReportItem[];
  outstandingCheques: ReconReportItem[];
  ledgerCents: number;
  clientCents: number;
  clientCount: number;
  /** Deposits pending verification and approved transfers not yet sent, from the ledger. */
  ledgerItems: ReconReportItem[];
  preparedBy: string;
  preparedAt: string;
  preparerNote: string | null;
  signedBy: string | null;
  signedAt: string | null;
  ownerSelfSigned: boolean;
  reviewNotes: string | null;
  isSample: boolean;
};

export const RECON_REPORT_NOTICE =
  "Not yet validated for production financial use: the firm's accountant and practice reviewer must validate the chart of accounts and this report before the firm relies on it. Casevoya records what the firm enters; it holds no money and reads no bank feed.";

const MAX_LISTED = 12;

function sum(items: ReconReportItem[]): number {
  return items.reduce((total, item) => total + item.cents, 0);
}

/** Statement + deposits in transit - outstanding cheques. */
export function adjustedBalance(report: Pick<ReconReport, "statementCents" | "depositsInTransit" | "outstandingCheques">): number {
  return report.statementCents + sum(report.depositsInTransit) - sum(report.outstandingCheques);
}

function money(cents: number): string {
  return formatMoney(cents, "CAD") ?? "—";
}

function listed(items: ReconReportItem[]): string {
  if (!items.length) return "None";
  const shown = items.slice(0, MAX_LISTED).map((item) => `${longDate(item.date)}: ${item.label}, ${money(item.cents)}`);
  const more = items.length - shown.length;
  return `${shown.join("; ")}${more > 0 ? `; and ${more} more` : ""}`;
}

const STATUS: Record<ReconReport["status"], string> = {
  pending_review: "Waiting for review (draft, not signed)",
  reconciled: "Reconciled",
  exceptions: "Signed with exceptions",
  discarded: "Discarded",
};

/** The report's label / value rows, in order. Pure. */
export function reconciliationRows(report: ReconReport): [string, string][] {
  const adjusted = adjustedBalance(report);
  const difference = adjusted - report.ledgerCents;
  return [
    ["Month", monthLabel(report.statementDate)],
    ["Client account", report.account],
    ["Period", `${longDate(report.periodStart)} to ${longDate(report.statementDate)}`],
    ["Status", STATUS[report.status]],
    ["Statement closing balance", money(report.statementCents)],
    ["Deposits in transit", `${money(sum(report.depositsInTransit))} (${listed(report.depositsInTransit)})`],
    ["Outstanding cheques", `${money(sum(report.outstandingCheques))} (${listed(report.outstandingCheques)})`],
    ["Adjusted bank balance", money(adjusted)],
    ["Control ledger", money(report.ledgerCents)],
    ["Client ledgers, total", `${money(report.clientCents)} (${report.clientCount} ${report.clientCount === 1 ? "client" : "clients"})`],
    ["Difference", difference === 0 ? "None: the adjusted bank balance matches the control ledger" : `${money(difference)} (adjusted bank balance less control ledger)`],
    ["Ledger items outstanding", listed(report.ledgerItems)],
    ["Prepared", `${report.preparedBy}, ${formatInZone(report.preparedAt, report.firmTimezone)}${report.preparerNote ? `. Note: ${report.preparerNote}` : ""}`],
    [
      "Signed",
      report.signedBy && report.signedAt
        ? `${report.signedBy}${report.ownerSelfSigned ? " (firm owner, own preparation)" : ""}, ${formatInZone(report.signedAt, report.firmTimezone)}, after confirming with their authenticator`
        : "Not signed",
    ],
    ...(report.reviewNotes ? [["Review notes", report.reviewNotes] as [string, string]] : []),
  ];
}

export function reconciliationFilename(report: Pick<ReconReport, "statementDate" | "status">): string {
  return `reconciliation-${report.statementDate}${report.status === "pending_review" ? "-draft" : ""}.pdf`;
}

export async function renderReconciliationPdf(report: ReconReport): Promise<Uint8Array> {
  return renderReceiptLayout({
    number: report.id,
    issuedAt: report.signedAt ?? report.preparedAt,
    firmLegalName: report.firmLegalName,
    firmDisplayName: report.firmDisplayName,
    consultantName: null,
    consultantLicence: null,
    heading: "CLIENT ACCOUNT RECONCILIATION: ADJUSTED BANK BALANCE",
    amountCents: adjustedBalance(report),
    currency: "CAD",
    rows: reconciliationRows(report),
    notes: [RECON_REPORT_NOTICE],
    isSample: report.isSample,
    title: `Reconciliation ${monthLabel(report.statementDate)}`,
  });
}
