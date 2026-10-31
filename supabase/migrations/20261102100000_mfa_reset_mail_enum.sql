-- Lost two-step device (Francis, 2026-10-30): the email templates of a staff member's two-step reset
-- request (EX21, to the firm's other owners) and of its outcome (EX22, to the person who asked).
-- Enum values in their own migration so later migrations can use them. Additive only.
alter type public.email_template add value if not exists 'mfa_reset_requested';
alter type public.email_template add value if not exists 'mfa_reset_decided';
