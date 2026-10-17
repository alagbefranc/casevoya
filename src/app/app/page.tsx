import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/sign-in/actions";

async function Workspaces() {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) redirect("/sign-in?next=/app");

  // RLS returns only this user's memberships (and co-members for staff).
  const { data: memberships, error } = await supabase
    .from("memberships")
    .select("id, role, status, organization_id, organizations(display_name)")
    .eq("user_id", claims.claims.sub)
    .order("created_at");

  if (error) return <p role="alert">We couldn&apos;t load your workspaces. Try again.</p>;
  if (!memberships?.length) {
    return <p>You don&apos;t belong to a firm workspace yet.</p>;
  }
  return (
    <ul className="flex flex-col gap-2">
      {memberships.map((m) => (
        <li key={m.id} className="rounded-panel bg-surface p-4">
          <span className="font-semibold">{m.organizations?.display_name}</span>{" "}
          <span className="text-ink-secondary">
            · {m.role.replaceAll("_", " ")} · {m.status}
          </span>
        </li>
      ))}
    </ul>
  );
}

// Minimal authenticated shell placeholder. Real firm/client shells come from the Designer.
export default function AppHome() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-12">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Your workspaces</h1>
        <form action={signOut}>
          <button type="submit" className="h-11 rounded-control border border-line-strong px-4">
            Sign out
          </button>
        </form>
      </div>
      <Suspense fallback={<p>Loading workspaces…</p>}>
        <Workspaces />
      </Suspense>
    </main>
  );
}
