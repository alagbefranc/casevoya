import { Suspense } from "react";
import { sendMagicLink } from "./actions";

const ERRORS: Record<string, string> = {
  invalid_email: "Enter a valid email address.",
  send_failed: "We couldn't send the sign-in link. Try again.",
  link_invalid: "That sign-in link is invalid or has expired. Request a new one.",
};

async function SignInForm({ searchParams }: { searchParams: PageProps<"/sign-in">["searchParams"] }) {
  const params = await searchParams;
  const error = typeof params.error === "string" ? ERRORS[params.error] : undefined;
  const sent = params.sent === "1";
  const next = typeof params.next === "string" ? params.next : "/app";

  if (sent) {
    return <p role="status">Check your email for a sign-in link.</p>;
  }

  return (
    <form action={sendMagicLink} className="flex flex-col gap-4">
      {error ? (
        <p role="alert" className="rounded-control bg-danger-bg px-4 py-3 text-danger">
          {error}
        </p>
      ) : null}
      <input type="hidden" name="next" value={next} />
      <label className="flex flex-col gap-2">
        <span className="font-semibold">Email</span>
        <input
          type="email"
          name="email"
          required
          autoComplete="email"
          className="h-11 rounded-control border border-line-strong bg-surface px-3"
        />
      </label>
      <button
        type="submit"
        className="h-11 rounded-control bg-action px-5 font-semibold text-on-action hover:bg-action-hover"
      >
        Send sign-in link
      </button>
    </form>
  );
}

// Minimal placeholder; final UI comes from the Designer.
export default function SignInPage(props: PageProps<"/sign-in">) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-6 py-16">
      <h1 className="text-2xl font-semibold">Sign in to Casevoya</h1>
      <div className="rounded-panel bg-surface p-6">
        <Suspense fallback={<p>Loading…</p>}>
          <SignInForm searchParams={props.searchParams} />
        </Suspense>
      </div>
    </main>
  );
}
