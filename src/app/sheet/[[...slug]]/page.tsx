import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { signInLocation } from "@/lib/auth/redirect";
import { isPortalRole, loadPortalAccess } from "@/modules/portal/load";

export const metadata: Metadata = {
  title: "Casevoya",
  robots: { index: false, follow: false },
};

/** Sheet URLs are not a public demo. Sample firms land in the sample portal; everyone else sees their own workspace. */
export default async function SheetPage({ params }: { params: Promise<{ slug?: string[] }> }) {
  const { slug } = await params;
  const path = slug?.length ? `/sheet/${slug.join("/")}` : "/sheet";
  const access = await loadPortalAccess();
  if (access.kind === "signed-out") redirect(signInLocation(path));
  if (access.kind === "sample" || (access.kind === "live" && isPortalRole(access.viewer.role))) redirect("/portal");
  redirect("/app");
}
