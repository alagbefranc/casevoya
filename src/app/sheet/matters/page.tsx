import type { Metadata } from "next";
import { Suspense } from "react";
import { SheetBody, queryFrom } from "@/components/sheet/body";
import { DemoSheet } from "@/components/sheet/demo";
import { SheetScreen } from "@/components/sheet/screen";

export const metadata: Metadata = {
  title: "Matters · Casevoya",
  robots: { index: false, follow: false },
};

export default function MattersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <Suspense fallback={<SheetScreen page="matters"><DemoSheet page="matters" query={{}} /></SheetScreen>}>
      <Body searchParams={searchParams} />
    </Suspense>
  );
}

async function Body({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <SheetBody page="matters" query={queryFrom(await searchParams)} />;
}
