/**
 * Download links for invoice payment receipts (CICC Code s. 33(3)). Kept apart from the PDF code so
 * pages can link a receipt without loading pdf-lib. The route checks access in the database again.
 */
export function paymentReceiptHref(receiptId: string, organizationId: string): string {
  return `/api/invoices/receipts/${receiptId}?organizationId=${organizationId}`;
}

/** Download link for an issued invoice's PDF. The route reads the invoice through RLS. */
export function invoicePdfHref(invoiceId: string, organizationId: string): string {
  return `/api/invoices/pdf/${invoiceId}?organizationId=${organizationId}`;
}

/** Download link for an issued credit note's PDF. The route checks access in the database again. */
export function creditNoteHref(creditNoteId: string, organizationId: string): string {
  return `/api/invoices/credit-notes/${creditNoteId}?organizationId=${organizationId}`;
}

/** Download link for a client-account reconciliation's PDF report (FIN-12). The route reads it through RLS and audits the export. */
export function reconciliationPdfHref(reconciliationId: string, organizationId: string): string {
  return `/api/client-funds/reconciliations/${reconciliationId}?organizationId=${organizationId}`;
}
