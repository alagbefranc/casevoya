-- Casevoya SaaS subscription billing (T042; PRD §3 pricing, ADM-02, SEC-10, FIN-01): enum values.
-- Enum values live in their own migration so the next one can use them.
--
-- subscription_status gains the states ADM-02 names after a plan is chosen:
--   past_due    a renewal payment failed; 7-day grace (product_settings subscription.grace)
--   restricted  the grace ran out: new real client invites, staff invites and real matters pause;
--               reads and exports stay open
--   archived    90 days after cancellation (SEC-10 export window) the state is marked archived;
--               nothing is deleted
-- subscription_plan: the PRD plans. enterprise has no checkout ("Contact Casevoya").
-- billing_interval: monthly, or annual at annual_months × monthly.

alter type public.subscription_status add value if not exists 'past_due';
alter type public.subscription_status add value if not exists 'restricted';
alter type public.subscription_status add value if not exists 'archived';

create type public.subscription_plan as enum ('solo', 'practice', 'firm', 'enterprise');
create type public.billing_interval as enum ('month', 'year');
