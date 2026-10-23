-- Consultation agreement signing flow: the email template of the six-digit signing code (EX16).
-- An enum value in its own migration so later migrations can use it. Additive only.
alter type public.email_template add value if not exists 'signing_code';
