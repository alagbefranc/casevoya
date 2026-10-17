import type { Metadata } from "next";
import { Suspense } from "react";
import { AcceptFamilyMarkup } from "@/components/port/markup/accept-family";
import { PortScreen } from "@/components/port/screen";

export const metadata: Metadata = {
  title: "Olena’s invitation · Casevoya (prototype)",
  robots: { index: false, follow: false },
};

function FamilyInvite({ token }: { token?: string }) {
  return (
    <PortScreen page="accept-family" variant="wzb" token={token}>
      <AcceptFamilyMarkup />
    </PortScreen>
  );
}

async function Token({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return <FamilyInvite token={token} />;
}

export default function AcceptFamilyPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  return (
    <Suspense fallback={<FamilyInvite />}>
      <Token searchParams={searchParams} />
    </Suspense>
  );
}
