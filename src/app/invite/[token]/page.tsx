import type { Metadata } from "next";
import { Suspense } from "react";
import { AcceptStaffMarkup } from "@/components/port/markup/accept-staff";
import { PortScreen } from "@/components/port/screen";

export const metadata: Metadata = {
  title: "Join your team · Casevoya (prototype)",
  robots: { index: false, follow: false },
};

function StaffInvite({ token }: { token?: string }) {
  return (
    <PortScreen page="accept-staff" variant="au" token={token}>
      <AcceptStaffMarkup />
    </PortScreen>
  );
}

async function InviteToken({ params }: { params: PageProps<"/invite/[token]">["params"] }) {
  const { token } = await params;
  return <StaffInvite token={token} />;
}

export default function InvitePage({ params }: PageProps<"/invite/[token]">) {
  return (
    <Suspense fallback={<StaffInvite />}>
      <InviteToken params={params} />
    </Suspense>
  );
}
