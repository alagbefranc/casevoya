-- Bug 2 (#215 live check 6): the email template of the refund correction (EX20, "Your refund
-- didn't go through"). An enum value in its own migration so later migrations can use it. Additive only.
alter type public.email_template add value if not exists 'refund_failed';
