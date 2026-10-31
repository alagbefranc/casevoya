-- Card-required trial and billing mail (2026-11-01, approved by Francis 2026-10-30): the email
-- templates of the trial reminder (EM18c, "Your trial ends on <date>") and of a failed or
-- unconfirmed Casevoya subscription payment (EM18a, now wired). Enum values in their own migration
-- so later migrations can use them. Additive only.
alter type public.email_template add value if not exists 'trial_ending';
alter type public.email_template add value if not exists 'billing_payment_failed';
