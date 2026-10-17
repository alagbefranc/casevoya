import type { Metadata } from "next";
import { Suspense } from "react";
import { previewStaffInvite } from "@/app/auth/port-actions";
import { AcceptStaffMarkup } from "@/components/port/markup/accept-staff";
import { PortScreen } from "@/components/port/screen";
import { faceFromStaffPreview, type InviteFace } from "@/lib/auth/invite-face";

export const metadata: Metadata = {
  title: "Join your team · Casevoya",
  robots: { index: false, follow: false },
};

function StaffInvite({ token, face }: { token?: string; face?: InviteFace }) {
  return (
    <PortScreen page="accept-staff" variant="au" token={token}>
      <AcceptStaffMarkup face={face} />
    </PortScreen>
  );
}

async function Token({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  const face = faceFromStaffPreview(token ? await previewStaffInvite(token) : null);
  return <StaffInvite token={token} face={face} />;
}

export default function AcceptStaffPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  return (
    <Suspense fallback={<StaffInvite />}>
      <Token searchParams={searchParams} />
    </Suspense>
  );
}
