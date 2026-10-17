import { Suspense } from "react";
import { redirect } from "next/navigation";
import { safeNext } from "@/lib/auth/redirect";
import { createClient } from "@/lib/supabase/server";
import { redeemRecoveryCode, verifyTotp } from "./actions";
import { EnrollPanel } from "./enroll-panel";
import { PasskeyButton } from "./passkey-button";

const ERRORS: Record<string, string> = {
  invalid_code: "Enter the 6-digit code from your authenticator app.",
  verify_failed: "That code was not accepted. Try again.",
  invalid_recovery: "Enter a recovery code.",
  recovery_failed: "That recovery code was not accepted.",
};

async function MfaFlow({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const next = safeNext(typeof params.next === "string" ? params.next : "/app");
  const errorCode = typeof params.error === "string" ? params.error : "";
  const error = ERRORS[errorCode];

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) redirect(`/sign-in?next=${encodeURIComponent(`/mfa?next=${encodeURIComponent(next)}`)}`);

  const { data: level } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const { data: satisfied, error: satisfiedError } = await supabase.rpc("session_mfa_satisfied");
  if (level?.currentLevel === "aal2" || (!satisfiedError && satisfied === true)) {
    return (
      <div className="flex flex-col gap-4">
        <p role="status">This session is confirmed for staff access.</p>
        <a href={next} className="inline-flex h-11 items-center font-semibold text-action">
          Continue
        </a>
      </div>
    );
  }

  const { data: factors } = await supabase.auth.mfa.listFactors();
  const totp = factors?.all.filter((factor) => factor.factor_type === "totp") ?? [];
  const verified = totp.find((factor) => factor.status === "verified");
  const pending = totp.find((factor) => factor.status === "unverified");
  const factorId = verified?.id ?? pending?.id;

  return (
    <div className="flex flex-col gap-4">
      {error ? (
        <p role="alert" className="rounded-control bg-danger-bg px-4 py-3 text-danger">
          {error}
        </p>
      ) : null}
      <p>Staff sign-in needs an authenticator app. Client accounts are not required to set one up.</p>
      {factorId ? (
        <form action={verifyTotp} className="flex flex-col gap-4">
          <input type="hidden" name="next" value={next} />
          <input type="hidden" name="factorId" value={factorId} />
          <label className="flex flex-col gap-2">
            <span className="font-semibold">Authenticator code</span>
            <input
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              pattern="[0-9]{6}"
              className="h-11 rounded-control border border-line-strong bg-surface px-3"
            />
          </label>
          <button type="submit" className="h-11 rounded-control bg-action px-5 font-semibold text-on-action">
            Confirm code
          </button>
        </form>
      ) : (
        <EnrollPanel next={next} />
      )}
      <form action={redeemRecoveryCode} className="flex flex-col gap-4 border-t border-line-strong pt-4">
        <input type="hidden" name="next" value={next} />
        <label className="flex flex-col gap-2">
          <span className="font-semibold">Recovery code</span>
          <input
            name="code"
            autoComplete="off"
            spellCheck={false}
            className="h-11 rounded-control border border-line-strong bg-surface px-3"
          />
        </label>
        <button type="submit" className="h-11 rounded-control border border-line-strong bg-surface px-5 font-semibold">
          Use a recovery code
        </button>
      </form>
      <PasskeyButton next={next} />
    </div>
  );
}

// Minimal placeholder. The Designer owns the finished authenticator screens.
export default function MfaPage({ searchParams }: PageProps<"/mfa">) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-6 py-16">
      <h1 className="text-2xl font-semibold">Authenticator app</h1>
      <div className="rounded-panel bg-surface p-6">
        <Suspense fallback={<p>Loading…</p>}>
          <MfaFlow searchParams={searchParams} />
        </Suspense>
      </div>
    </main>
  );
}
