#!/usr/bin/env node
// Backfills the card brand and last 4 digits of card payments that succeeded before Casevoya
// stored them (for example the card payment behind PR-0001), and fills each one's receipt once.
//
// For each succeeded invoice payment without a card, it retrieves the PaymentIntent from Stripe
// TEST MODE on the firm's connected account (direct charge: `stripeAccount`), with latest_charge
// expanded, reads payment_method_details.card.brand and .last4 (nothing else), and calls
// public.record_invoice_payment_card as service_role. That records the card on the payment and,
// when its receipt has no card yet, fills the receipt once (app.fill_invoice_payment_receipt_card,
// the documented exception to receipts being append-only). Running it again changes nothing.
//
// Dry run by default (reads Stripe, writes nothing); pass --apply to write.
// Needs NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY and STRIPE_TEST_SECRET_KEY (sk_test_ or
// rk_test_ with PaymentIntents and Charges read on connected accounts). Prints no secrets and no
// card data beyond brand and last 4.
// Usage: node scripts/ops/backfill-receipt-card-details.mjs [--apply]
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

const env = process.env;
for (const name of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SECRET_KEY", "STRIPE_TEST_SECRET_KEY"]) {
  if (!env[name]) throw new Error(`${name} is not set.`);
}
const stripeKey = env.STRIPE_TEST_SECRET_KEY.trim();
if (!/^(sk|rk)_test_[A-Za-z0-9]{8,}$/.test(stripeKey)) throw new Error("STRIPE_TEST_SECRET_KEY must be a test-mode key (sk_test_ or rk_test_).");
const apply = process.argv.includes("--apply");

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const stripe = new Stripe(stripeKey, { maxNetworkRetries: 2, appInfo: { name: "Casevoya ops" } });

const BRAND = /^[a-z0-9_]{1,40}$/;
const LAST4 = /^[0-9]{4}$/;

/** Brand and last 4 of the PaymentIntent's latest charge, or null. */
function cardOf(intent) {
  const charge = intent && typeof intent.latest_charge === "object" ? intent.latest_charge : null;
  const card = charge?.payment_method_details?.card;
  const brand = typeof card?.brand === "string" ? card.brand.trim().toLowerCase() : "";
  const last4 = typeof card?.last4 === "string" ? card.last4.trim() : "";
  return BRAND.test(brand) && LAST4.test(last4) ? { brand, last4 } : null;
}

const COLUMNS = "id, payment_intent_id, connected_account_id, livemode";
// Succeeded payments without a card, and card receipts without one (their payment may already
// have it, e.g. a webhook-recovered payment whose second record call failed).
const { data: missing, error } = await supabase
  .from("invoice_payments")
  .select(COLUMNS)
  .eq("status", "succeeded")
  .is("card_brand", null)
  .order("succeeded_at", { ascending: true });
if (error) throw new Error(`invoice_payments: ${error.message}`);
const { data: receipts, error: receiptError } = await supabase
  .from("invoice_payment_receipts")
  .select("payment_id")
  .eq("source", "card")
  .is("card_brand", null);
if (receiptError) throw new Error(`invoice_payment_receipts: ${receiptError.message}`);
const extraIds = receipts.map((row) => row.payment_id).filter((id) => id && !missing.some((payment) => payment.id === id));
let extra = [];
if (extraIds.length) {
  const { data, error: extraError } = await supabase.from("invoice_payments").select(COLUMNS).in("id", extraIds);
  if (extraError) throw new Error(`invoice_payments: ${extraError.message}`);
  extra = data;
}
const payments = [...missing, ...extra];

const summary = { found: payments.length, recorded: 0, receiptsFilled: 0, noCard: 0, failed: 0 };
console.log(`${payments.length} succeeded card payment(s) without card details on the payment or its receipt. ${apply ? "Applying." : "Dry run (pass --apply to write)."}`);

for (const payment of payments) {
  const label = `${payment.payment_intent_id} on ${payment.connected_account_id}`;
  if (payment.livemode !== false) {
    console.log(`skip ${label}: not test mode`);
    continue;
  }
  let card = null;
  try {
    const intent = await stripe.paymentIntents.retrieve(payment.payment_intent_id, { expand: ["latest_charge"] }, { stripeAccount: payment.connected_account_id });
    if (intent.livemode) {
      console.log(`skip ${label}: Stripe says live mode`);
      continue;
    }
    card = cardOf(intent);
  } catch (lookupError) {
    summary.failed += 1;
    console.log(`fail ${label}: Stripe lookup (${lookupError?.code ?? lookupError?.type ?? "error"})`);
    continue;
  }
  if (!card) {
    summary.noCard += 1;
    console.log(`skip ${label}: no card on the latest charge`);
    continue;
  }
  if (!apply) {
    console.log(`would record ${label}: ${card.brand} ${card.last4}`);
    continue;
  }
  const { data, error: recordError } = await supabase.rpc("record_invoice_payment_card", {
    p_account_id: payment.connected_account_id,
    p_payment_intent_id: payment.payment_intent_id,
    p_card_brand: card.brand,
    p_card_last4: card.last4,
    p_livemode: false,
  });
  if (recordError) {
    summary.failed += 1;
    console.log(`fail ${label}: record_invoice_payment_card (${recordError.code ?? "error"})`);
    continue;
  }
  if (data?.outcome === "recorded") summary.recorded += 1;
  if (data?.receipt_filled === true) summary.receiptsFilled += 1;
  console.log(`${data?.outcome ?? "unknown"} ${label}: ${card.brand} ${card.last4}${data?.receipt_filled ? ", receipt filled" : ""}`);
}

console.log(JSON.stringify(summary));
if (summary.failed > 0) process.exitCode = 1;
