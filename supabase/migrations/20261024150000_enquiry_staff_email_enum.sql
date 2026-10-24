-- CRM-01 (#176): the email template of the new-enquiry staff notice (EX18). An enum value in its
-- own migration so later migrations can use it. Additive only.
alter type public.email_template add value if not exists 'enquiry_received';
