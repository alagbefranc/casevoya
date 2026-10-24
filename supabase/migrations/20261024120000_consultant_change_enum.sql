-- ORG-06 (#175): the email template of the consultant-change notice (EX17). An enum value in its
-- own migration so later migrations can use it. Additive only.
alter type public.email_template add value if not exists 'consultant_changed';
