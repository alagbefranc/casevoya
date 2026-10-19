import type { Metadata } from "next";
import { SheetBody, queryFrom } from "@/components/sheet/body";

export const metadata: Metadata = {
  title: "Matter · Casevoya",
  robots: { index: false, follow: false },
};

export default function MatterPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <Body params={params} searchParams={searchParams} />;
}

async function Body({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  return <SheetBody page="matter" query={queryFrom(query)} matterId={id} />;
}
