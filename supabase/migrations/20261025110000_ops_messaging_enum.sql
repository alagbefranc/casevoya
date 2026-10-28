-- OPS-04 (#179): the email template of the announcement notice (EX19). An enum value in its own
-- migration so later migrations can use it. Additive only.
alter type public.email_template add value if not exists 'announcement';
