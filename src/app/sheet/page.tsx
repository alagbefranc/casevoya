import type { Metadata } from "next";
import { SheetBody, queryFrom } from "@/components/sheet/body";

export const metadata: Metadata = {
  title: "Home · Casevoya",
  robots: { index: false, follow: false },
};

export default function SheetHome({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <Home searchParams={searchParams} />;
}

async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = queryFrom(await searchParams);
  return <SheetBody page="index" query={query} />;
}
