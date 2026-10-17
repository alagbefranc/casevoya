import type { Metadata } from "next";
import { Suspense } from "react";
import { AcceptSponsorMarkup } from "@/components/port/markup/accept-sponsor";
import { PortScreen } from "@/components/port/screen";

export const metadata: Metadata = {
  title: "Rafael’s invitation · Casevoya (prototype)",
  robots: { index: false, follow: false },
};

function SponsorInvite({ token }: { token?: string }) {
  return (
    <PortScreen page="accept-sponsor" variant="wzb" token={token}>
      <AcceptSponsorMarkup />
    </PortScreen>
  );
}

async function Token({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return <SponsorInvite token={token} />;
}

export default function AcceptSponsorPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  return (
    <Suspense fallback={<SponsorInvite />}>
      <Token searchParams={searchParams} />
    </Suspense>
  );
}
