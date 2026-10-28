"use client";

/** Print the page (the receipt). A button, so it works without a link target. */
export function PrintButton({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <button type="button" className={className} onClick={() => window.print()}>
      {children}
    </button>
  );
}
