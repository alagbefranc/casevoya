-- Inbox replies and compose (staff email to a person on a matter). The delivery template for a
-- staff-written email, in its own migration so the next one can use it. Additive only.

alter type public.email_template add value if not exists 'staff_message';
