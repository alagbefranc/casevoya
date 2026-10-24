import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { CallScreen } from "@/components/video/call-screen";
import { signInLocation } from "@/lib/auth/redirect";
import { loadPortalAccess } from "@/modules/portal/load";
import { loadSheetAccess } from "@/modules/sheet/load";
import { CALL_REF } from "@/modules/video/present";
import { readCall, readGuestCall } from "@/modules/video/service";
import { isManageToken, managePath } from "@/modules/scheduling/manage-present";

export const metadata: Metadata = {
  title: "Video call · Casevoya",
  robots: { index: false, follow: false },
};

/**
 * The call page for one booking (`/call/<booking reference>`, BUILD-SPEC §7.4). The reference is
 * not a secret: nothing renders until the signed-in person is the booking's host, a firm owner
 * (Sheet, staff MFA) or the booking's own client (portal). Staff are checked first, then the portal.
 */
async function Body({ params, searchParams }: { params: Promise<{ ref: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { ref } = await params;
  const back = { href: "/portal/appointments", label: "Back to appointments" };
  if (!CALL_REF.test(ref)) return <CallScreen kind="refused" back={back} />;

  // CRM-03: a booker without a portal, with the token from their Manage your booking link.
  const raw = (await searchParams).t;
  const guestToken = Array.isArray(raw) ? raw[0] : raw;
  if (guestToken && isManageToken(guestToken)) {
    const view = await readGuestCall(ref, guestToken);
    const manage = { href: managePath(ref, guestToken), label: "Back to your booking" };
    if ("error" in view || !view.organizationId) return <CallScreen kind="refused" back={manage} />;
    return <CallScreen kind="call" organizationId={view.organizationId} callRef={ref} view={view} back={manage} guestToken={guestToken} />;
  }

  // Both lookups at once; the staff answer wins when the person is both.
  const [sheet, portal] = await Promise.all([loadSheetAccess(), loadPortalAccess()]);
  if (sheet.kind === "signed-out") redirect(signInLocation(`/call/${ref}`));
  const staffOrg = sheet.kind === "live" || sheet.kind === "sample" ? sheet.staff.organizationId : null;
  const portalOrg = portal.kind === "live" ? portal.viewer.organizationId : null;
  const staffBack = { href: "/sheet/consultations", label: "Back to consultations" };
  const [asStaff, asClient] = await Promise.all([
    staffOrg ? readCall(staffOrg, ref) : null,
    portalOrg && portalOrg !== staffOrg ? readCall(portalOrg, ref) : null,
  ]);
  if (staffOrg && asStaff && !("error" in asStaff)) return <CallScreen kind="call" organizationId={staffOrg} callRef={ref} view={asStaff} back={staffBack} />;
  if (portalOrg && asClient && !("error" in asClient)) return <CallScreen kind="call" organizationId={portalOrg} callRef={ref} view={asClient} back={back} />;
  return <CallScreen kind="refused" back={staffOrg ? staffBack : back} />;
}

export default function CallPage(props: { params: Promise<{ ref: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <Suspense fallback={null}>
      <Body {...props} />
    </Suspense>
  );
}
