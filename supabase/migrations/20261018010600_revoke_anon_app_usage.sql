-- Security L2: 20261017140800_portal_invitations granted usage on schema app to anon.
-- Every function anon can execute (preview_invitation, preview_portal_invitation,
-- decline_portal_invitation, report_portal_invitation_mismatch,
-- save_portal_invitation_draft) is SECURITY DEFINER and runs as its owner, so anon
-- never resolves app.* itself. No policy applies to anon. The usage grant is not
-- needed and is removed to shrink the surface if app is ever exposed.
-- Additive only.

revoke usage on schema app from anon;
