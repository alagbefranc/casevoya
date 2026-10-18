import { Suspense } from "react";
import { redirect } from "next/navigation";
import { homeRoute } from "@/lib/auth/home-route";

async function Route() {
  const home = await homeRoute();
  redirect(home === "/sign-in" ? "/sign-in?next=/app" : home);
  return null;
}

/** The default after sign-in. Sends each person to their own workspace; never a dead end. */
export default function AppHome() {
  return (
    <Suspense fallback={null}>
      <Route />
    </Suspense>
  );
}
