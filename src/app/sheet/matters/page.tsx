import type { Metadata } from "next";
import { Suspense } from "react";
import { SheetBody, queryFrom } from "@/components/sheet/body";
import { QuietSheet } from "@/components/sheet/live";
import { SheetScreen } from "@/components/sheet/screen";

export const metadata: Metadata = {
  title: "Matters · Casevoya",
  robots: { index: false, follow: false },
};

export default function MattersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <Suspense fallback={<SheetScreen page="matters"><QuietSheet title="Matters" copy="Your firm’s records load after sign-in." /></SheetScreen>}>
      <Body searchParams={searchParams} />
    </Suspense>
  );
}

async function Body({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <SheetBody page="matters" query={queryFrom(await searchParams)} />;
}
