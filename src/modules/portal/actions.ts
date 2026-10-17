"use server";

export type PortalPaymentIntentResult = {
  clientSecret: string | null;
  reason?: "not_implemented" | "advance_card_disabled" | "connect_required";
};

export async function createPortalPaymentIntent(input: {
  organizationId?: string;
  invoiceId?: string;
  amountCents: number;
  currency: string;
  description: string;
}): Promise<PortalPaymentIntentResult> {
  if (!input.invoiceId || !input.organizationId) return { clientSecret: null, reason: "not_implemented" };
  const { createInvoicePaymentIntent } = await import("@/modules/finance/actions");
  const result = await createInvoicePaymentIntent({ organizationId: input.organizationId, invoiceId: input.invoiceId });
  if (result.clientSecret) return { clientSecret: result.clientSecret };
  if (result.error && /bank transfer|advances/i.test(result.error)) return { clientSecret: null, reason: "advance_card_disabled" };
  if (result.error && /payout account/i.test(result.error)) return { clientSecret: null, reason: "connect_required" };
  return { clientSecret: null, reason: "not_implemented" };
}
