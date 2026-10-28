import { Suspense, type ReactNode } from "react";
import { IdleGuard } from "@/components/sheet/idle-guard";
import { SheetLoader } from "@/components/sheet/sheet-loader";
import { SheetNav } from "@/components/sheet/sheet-nav";

/**
 * Every staff (Sheet) page shares this layout. The branded loader is the fallback here, above the
 * pages, so it shows only on a first load (sign-in, refresh, a typed URL). A click between Sheet
 * pages is a client navigation that re-renders below this layout: the current page stays on
 * screen until the next one is ready, and SheetNav shows a thin progress bar meanwhile.
 */
export default function SheetLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <Suspense fallback={null}>
        <SheetNav />
      </Suspense>
      <Suspense fallback={<SheetLoader />}>{children}</Suspense>
      {/* SEC-01: idle sign-out for staff, with a warning two minutes before. */}
      <IdleGuard />
    </>
  );
}
