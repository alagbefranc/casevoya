import type { Metadata } from "next";
import { Suspense } from "react";
import { SheetBody, queryFrom } from "@/components/sheet/body";
import { QuietSheet } from "@/components/sheet/live";
import { SheetScreen } from "@/components/sheet/screen";

export const metadata: Metadata = {
  title: "Book · Casevoya",
  robots: { index: false, follow: false },
};

export default function BookPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <Suspense fallback={<SheetScreen page="book" tone="public"><QuietSheet title="Book" copy="This form isn’t available." /></SheetScreen>}>
      <Body searchParams={searchParams} />
    </Suspense>
  );
}

async function Body({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <SheetBody page="book" query={queryFrom(await searchParams)} />;
}
