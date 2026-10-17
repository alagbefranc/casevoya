import Link from "next/link";

// Placeholder shell. The Designer's HTML will be converted into the real marketing pages.
export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-[1200px] flex-1 flex-col justify-center gap-6 px-6 py-20">
      <p className="text-sm text-ink-secondary">Development build · fictional data only</p>
      <h1 className="text-4xl font-semibold leading-tight">Casevoya</h1>
      <p className="max-w-prose text-base text-ink-secondary">
        Clear next steps, accountable casework and traceable records for licensed Canadian
        immigration consultancies.
      </p>
      <div>
        <Link
          href="/app"
          className="inline-flex h-11 items-center rounded-control bg-action px-5 font-semibold text-on-action hover:bg-action-hover active:bg-action-active"
        >
          Open workspace
        </Link>
      </div>
    </main>
  );
}
