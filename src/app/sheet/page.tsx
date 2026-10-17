import type { Metadata } from "next";
import { Suspense } from "react";
import { SheetBody, queryFrom } from "@/components/sheet/body";
import { QuietSheet } from "@/components/sheet/live";
import { SheetScreen } from "@/components/sheet/screen";

export const metadata: Metadata = {
  title: "Home · Casevoya",
  robots: { index: false, follow: false },
};

export default function SheetHome({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <Suspense fallback={<SheetScreen page="index"><QuietSheet title="Casevoya" copy="Your firm’s records load after sign-in." /></SheetScreen>}>
      <Home searchParams={searchParams} />
    </Suspense>
  );
}

async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = queryFrom(await searchParams);
  return <SheetBody page="index" query={query} />;
}
