import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Client home screen · Casevoya",
  robots: { index: false, follow: false },
};

export default function ClientHomeHelp() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-6 py-12">
      <h1 className="text-3xl font-light">Client home screen</h1>
      <p>Your home shows the next step, where the application stands, documents, messages and payments.</p>
      <Link href="/portal" className="text-action">Back to the portal</Link>
    </main>
  );
}
