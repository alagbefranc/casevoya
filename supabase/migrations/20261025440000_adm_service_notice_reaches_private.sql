-- ADM-04 follow-up (swe review of #235): app.service_notice_reaches(uuid, uuid) answered "does
-- this notice reach this firm?" for any notice id and firm id a signed-in user passed. It is only
-- called inside security-definer functions (app.can_read_service_notice, which the
-- service_notices select policy uses, and public.dismiss_service_notice), which run as their
-- owner, so signed-in users don't need to execute it directly. Additive: privileges only.

revoke execute on function app.service_notice_reaches(uuid, uuid) from authenticated;
