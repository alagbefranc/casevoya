import type { Metadata } from "next";
import { Suspense } from "react";
import { AcceptClientMarkup } from "@/components/port/markup/accept-client";
import { PortScreen } from "@/components/port/screen";

export const metadata: Metadata = {
  title: "Your Northline portal · Casevoya (prototype)",
  robots: { index: false, follow: false },
};

function ClientInvite({ token }: { token?: string }) {
  return (
    <PortScreen page="accept-client" variant="wzb" token={token}>
      <AcceptClientMarkup />
    </PortScreen>
  );
}

async function Token({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return <ClientInvite token={token} />;
}

export default function AcceptClientPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  return (
    <Suspense fallback={<ClientInvite />}>
      <Token searchParams={searchParams} />
    </Suspense>
  );
}
