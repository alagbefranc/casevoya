import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { revokeInvitation } from "./actions";
import { InviteForm } from "./invite-form";

const ERRORS: Record<string, string> = {
  code: "That authenticator code was not accepted.",
  revoke: "That invitation could not be revoked.",
};

async function Invitations({ searchParams }: { searchParams: PageProps<"/app/invitations">["searchParams"] }) {
  const params = await searchParams;
  const errorCode = typeof params.error === "string" ? params.error : "";
  const banner = ERRORS[errorCode];
  const revoked = params.revoked === "1";
  const notices = (
    <>
      {revoked ? <p role="status">Invitation revoked.</p> : null}
      {banner ? (
        <p role="alert" className="rounded-control bg-danger-bg px-4 py-3 text-danger">
          {banner}
        </p>
      ) : null}
    </>
  );
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) redirect("/sign-in?next=/app/invitations");

  const { data: memberships, error } = await supabase
    .from("memberships")
    .select("organization_id, organizations(display_name)")
    .eq("user_id", claims.claims.sub)
    .eq("role", "firm_owner")
    .eq("status", "active");

  if (error) {
    return (
      <div className="flex flex-col gap-4">
        {notices}
        <p role="alert">We couldn&apos;t load your firms. Try again.</p>
      </div>
    );
  }
  const organizations = (memberships ?? []).map((membership) => ({
    id: membership.organization_id,
    name: membership.organizations?.display_name ?? "Firm",
  }));
  if (!organizations.length) {
    return (
      <div className="flex flex-col gap-4">
        {notices}
        <p>Only a firm owner can invite staff.</p>
      </div>
    );
  }

  const { data: invitations } = await supabase
    .from("invitations")
    .select("id, email, role, expires_at, consumed_at, revoked_at")
    .is("consumed_at", null)
    .is("revoked_at", null)
    .order("created_at", { ascending: false });

  return (
    <div className="flex flex-col gap-8">
      {notices}
      <InviteForm organizations={organizations} />
      {invitations?.length ? (
        <ul className="flex flex-col gap-3">
          {invitations.map((invitation) => (
            <li key={invitation.id} className="rounded-panel border border-line bg-surface p-4">
              <p>
                <span className="font-semibold">{invitation.email}</span>{" "}
                <span className="text-ink-secondary">· {invitation.role.replaceAll("_", " ")}</span>
              </p>
              <form action={revokeInvitation} className="mt-3 flex flex-wrap items-end gap-3">
                <input type="hidden" name="invitationId" value={invitation.id} />
                <label className="flex flex-col gap-1">
                  <span className="text-sm font-semibold">Authenticator code</span>
                  <input
                    name="code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    required
                    pattern="[0-9]{6}"
                    className="h-11 rounded-control border border-line-strong bg-surface px-3"
                  />
                </label>
                <button type="submit" className="h-11 rounded-control border border-line-strong px-4">
                  Revoke
                </button>
              </form>
            </li>
          ))}
        </ul>
      ) : (
        <p>No open invitations.</p>
      )}
    </div>
  );
}

// Minimal placeholder. The Designer owns the finished staff-invite screen.
export default function InvitationsPage({ searchParams }: PageProps<"/app/invitations">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-12">
      <h1 className="text-2xl font-semibold">Staff invitations</h1>
      <Suspense fallback={<p>Loading…</p>}>
        <Invitations searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
