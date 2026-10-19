-- Quote builder, Agreement editor and Compare versions (AGR-01, AGR-02, AGR-04): enum values in
-- their own migration, because Postgres cannot use a new enum label in the transaction that
-- creates it. The tables and functions follow in 20261020140100.

-- A quote line's category. Government fees are never invented: a government_fee line carries a
-- dated reference entered by staff (quote_lines.source_note, entered_by, entered_on).
create type public.quote_line_category as enum (
  'professional_fee',
  'tax',
  'disbursement',
  'government_fee'
);

-- How a quote instalment is paid: money before the work is done is an advance held in the client
-- account (FIN-03, FIN-07); otherwise it is invoiced after delivery.
create type public.quote_paid_as as enum (
  'advance',
  'invoice_after_delivery'
);

-- Where a clause's wording comes from: the approved template's text, or an edit made in the
-- Agreement editor.
create type public.agreement_clause_source as enum (
  'template',
  'edited'
);
