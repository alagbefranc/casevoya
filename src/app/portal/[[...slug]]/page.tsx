import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { DemoPortal, PORTAL_SLUGS } from "@/components/portal/demo";
import { LivePortal } from "@/components/portal/live";
import { PortalScreen } from "@/components/portal/screen";
import { HomeMarkup } from "@/components/portal/markup/portal";
import { loadPortalDocuments } from "@/modules/documents/load";
import { loadPortalViewer } from "@/modules/portal/load";
import { payStateFromQuery } from "@/modules/portal/pay";

export const metadata: Metadata = {
  title: "Portal · Casevoya",
  robots: { index: false, follow: false },
};

const LIVE = new Set(["home", ...PORTAL_SLUGS]);

async function Body({
  params,
  searchParams,
}: {
  params: Promise<{ slug?: string[] }>;
  searchParams: Promise<{ state?: string | string[] }>;
}) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const page = slug?.[0] ?? "home";
  if (slug && slug.length > 1) notFound();
  if (page !== "home" && !LIVE.has(page)) notFound();
  const stateValue = Array.isArray(query.state) ? query.state[0] : query.state;
  const viewer = await loadPortalViewer();
  const documents = viewer && (page === "documents" || page === "upload") ? await loadPortalDocuments(viewer) : null;
  return (
    <PortalScreen page={page}>
      {viewer ? <LivePortal page={page} viewer={viewer} documents={documents} /> : <DemoPortal page={page} state={payStateFromQuery(stateValue)} />}
    </PortalScreen>
  );
}

export default function PortalPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug?: string[] }>;
  searchParams: Promise<{ state?: string | string[] }>;
}) {
  return (
    <Suspense fallback={<PortalScreen page="home"><HomeMarkup /></PortalScreen>}>
      <Body params={params} searchParams={searchParams} />
    </Suspense>
  );
}
