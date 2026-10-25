-- Vo lead follow-up drafts and call-notes summaries (PRD AI-01, AI-06; gap AI-01 criteria 2 to 4):
-- enum values in their own migration so the next one can use them. Additive only.

-- A run kind and a draft kind for each new task. Both are drafts a person reviews; neither is ever
-- sent or saved by Vo.
--   lead_follow_up  a follow-up message to a lead, from the lead's own enquiry and history. Staff
--                   edit it and send it themselves; Casevoya has no message to a lead.
--   call_summary    a summary of the notes a staff member pasted after a Casevoya video call,
--                   saved to the lead's or the matter's staff notes only when a person says so.
alter type public.vo_run_kind add value if not exists 'lead_follow_up';
alter type public.vo_run_kind add value if not exists 'call_summary';
alter type public.vo_draft_kind add value if not exists 'lead_follow_up';
alter type public.vo_draft_kind add value if not exists 'call_summary';
