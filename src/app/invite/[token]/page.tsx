import { Suspense } from "react";
import { isInvitationToken } from "@/lib/auth/invitations";
import { createClient } from "@/lib/supabase/server";
import { acceptInvitation } from "./actions";

const ERRORS: Record<string, string> = {
  mfa: "Confirm your authenticator app, then accept the invitation.",
  rejected: "This invitation cannot be accepted. It may be expired, already used, or issued to a different email.",
};

async function InviteFlow({
  token,
  searchParams,
}: {
  token: string;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!isInvitationToken(token)) {
    return <p role="alert">That invitation link is not valid.</p>;
  }

  const params = await searchParams;
  const errorCode = typeof params.error === "string" ? params.error : "";
  const error = ERRORS[errorCode];
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) {
    const next = encodeURIComponent(`/invite/${token}`);
    return (
      <div className="flex flex-col gap-4">
        <p>Sign in with the email address this invitation was sent to. The link works once.</p>
        <a href={`/sign-in?next=${next}`} className="inline-flex h-11 items-center font-semibold text-action">
          Sign in
        </a>
      </div>
    );
  }

  const { data: level } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (level?.currentLevel !== "aal2") {
    const next = encodeURIComponent(`/invite/${token}`);
    return (
      <div className="flex flex-col gap-4">
        {error ? (
          <p role="alert" className="rounded-control bg-danger-bg px-4 py-3 text-danger">
            {error}
          </p>
        ) : null}
        <p>Staff invitations need an authenticator app before they can be accepted.</p>
        <a href={`/mfa?next=${next}`} className="inline-flex h-11 items-center font-semibold text-action">
          Set up authenticator
        </a>
      </div>
    );
  }

  return (
    <form action={acceptInvitation} className="flex flex-col gap-4">
      {error ? (
        <p role="alert" className="rounded-control bg-danger-bg px-4 py-3 text-danger">
          {error}
        </p>
      ) : null}
      <input type="hidden" name="token" value={token} />
      <p>Accepting adds you to the firm with the role on the invitation. The link works once.</p>
      <button type="submit" className="h-11 rounded-control bg-action px-5 font-semibold text-on-action">
        Accept invitation
      </button>
    </form>
  );
}

// Minimal placeholder. The Designer owns the finished invitation screen.
export default function InvitePage({ params, searchParams }: PageProps<"/invite/[token]">) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-6 py-16">
      <h1 className="text-2xl font-semibold">Invitation</h1>
      <div className="rounded-panel bg-surface p-6">
        <Suspense fallback={<p>Loading…</p>}>
          <InviteGate params={params} searchParams={searchParams} />
        </Suspense>
      </div>
    </main>
  );
}

async function InviteGate({
  params,
  searchParams,
}: {
  params: PageProps<"/invite/[token]">["params"];
  searchParams: PageProps<"/invite/[token]">["searchParams"];
}) {
  const { token } = await params;
  return <InviteFlow token={token} searchParams={searchParams} />;
}
