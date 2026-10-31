import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { decideMfaReset } from "./actions";

const ERRORS: Record<string, string> = {
  input: "That request could not be read. Try again.",
  confirm: "Tick the box to say you confirmed it’s them before approving.",
  self: "You can’t approve your own reset request. Another owner, or Casevoya support, decides it.",
  decided: "That request was already decided.",
  expired: "That request expired after 24 hours. They can send a new one from the sign-in page.",
  decide: "That request could not be decided. Try again.",
};

const STATUS: Record<string, string> = { pending: "Waiting for you", approved: "Approved", denied: "Denied", expired: "Expired" };

function when(value: string | null) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

async function Resets({ searchParams }: { searchParams: PageProps<"/app/two-step-resets">["searchParams"] }) {
  const params = await searchParams;
  const error = typeof params.error === "string" ? ERRORS[params.error] : undefined;
  const done = params.done === "approved" || params.done === "denied" ? params.done : null;
  const warn = params.warn === "factors";

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) redirect("/sign-in?next=/app/two-step-resets");
  const { data: memberships } = await supabase
    .from("memberships")
    .select("organization_id, organizations(display_name)")
    .eq("user_id", claims.claims.sub)
    .eq("role", "firm_owner")
    .eq("status", "active");
  const firms = (memberships ?? []).map((m) => ({ id: m.organization_id, name: m.organizations?.display_name ?? "Firm" }));

  const lists = await Promise.all(
    firms.map(async (f) => ({ firm: f, rows: (await supabase.rpc("firm_mfa_resets", { p_org: f.id })).data ?? [] })),
  );

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Two-step resets</h1>
        <p className="text-ink-secondary">
          Staff who lost their two-step device ask here from the sign-in page. Confirm it’s really them, on a video call or in
          person, before you approve. Approving removes their two-step methods and signs them out; they sign in with their
          password and set up two-step again. Requests expire after 24 hours. Every decision is in your audit log.
        </p>
      </header>
      {done ? (
        <p role="status" className="rounded-control bg-surface px-4 py-3">
          {done === "approved" ? "Approved. We emailed them to sign in and set up two-step again." : "Denied. We emailed them that nothing changed."}
        </p>
      ) : null}
      {warn ? (
        <p role="alert" className="rounded-control bg-danger-bg px-4 py-3 text-danger">
          Approved, but their two-step methods could not all be removed yet. Their sessions were ended; contact Casevoya support.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="rounded-control bg-danger-bg px-4 py-3 text-danger">
          {error}
        </p>
      ) : null}
      {!firms.length ? <p>Only a firm owner can review two-step reset requests.</p> : null}
      {lists.map(({ firm, rows }) => (
        <section key={firm.id} className="flex flex-col gap-3" aria-label={firm.name}>
          {firms.length > 1 ? <h2 className="text-lg font-semibold">{firm.name}</h2> : null}
          {!rows.length ? <p className="text-ink-secondary">No reset requests.</p> : null}
          <ul className="flex flex-col gap-3">
            {rows.map((r) => (
              <li key={r.id} className="rounded-panel border border-line bg-surface p-4" data-reset={r.status}>
                <p>
                  <span className="font-semibold">{r.requester_name || r.requester_email || "A staff member"}</span>{" "}
                  <span className="text-ink-secondary">
                    · {r.requester_email} · {r.requester_role.replaceAll("_", " ")}
                  </span>
                </p>
                <p className="text-ink-secondary">
                  {STATUS[r.status] ?? r.status} · asked {when(r.created_at)}
                  {r.status === "pending" ? ` · expires ${when(r.expires_at)}` : r.decided_at ? ` · decided ${when(r.decided_at)}${r.decided_by_name ? ` by ${r.decided_by_name}` : ""}` : ""}
                </p>
                {r.reason ? <blockquote className="mt-2 border-l-2 border-line pl-3 whitespace-pre-wrap">{r.reason}</blockquote> : null}
                {r.status === "pending" && r.requester_user_id !== claims.claims.sub ? (
                  <form action={decideMfaReset} className="mt-3 flex flex-wrap items-center gap-3">
                    <input type="hidden" name="requestId" value={r.id} />
                    <label className="flex items-center gap-2">
                      <input type="checkbox" name="confirmed" />
                      I confirmed it’s them on a video call or in person
                    </label>
                    <button type="submit" name="decision" value="approve" className="h-11 rounded-control border border-line-strong px-4 font-semibold">
                      Approve reset
                    </button>
                    <button type="submit" name="decision" value="deny" className="h-11 rounded-control border border-line-strong px-4">
                      Deny
                    </button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export default function TwoStepResetsPage(props: { searchParams: PageProps<"/app/two-step-resets">["searchParams"] }) {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-10">
      <Suspense fallback={null}>
        <Resets searchParams={props.searchParams} />
      </Suspense>
    </main>
  );
}
