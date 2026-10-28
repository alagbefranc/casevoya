-- AI-01 (#183) Vo letter drafts: the new Vo run kind, in its own migration so the next one can use
-- it. Additive only.

-- A Vo run that writes a first draft of a letter on a matter (a submission cover letter, a letter
-- of explanation) from the matter's approved facts only. The draft is a matter letter
-- (public.matter_letters) that a licensed member must approve before it can be released.
alter type public.vo_run_kind add value if not exists 'letter_draft';
