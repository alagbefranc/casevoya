"use client";

import { useRef, useState, type ReactNode } from "react";
import { usePort } from "./use-port";
import { usePortActions } from "./wire";

export function PortScreen({
  page,
  variant,
  token,
  initialStep,
  children,
}: {
  page: string;
  variant: "au" | "wzb";
  token?: string;
  /** Server-chosen step. Wins over `?step=` so a loaded screen is not left blank. */
  initialStep?: number;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Only the first render's step counts. An action that sets a cookie makes Next re-render the
  // route, and the server's step then (verified two-step → "Enter your code") must not move the
  // person off the step they are on.
  const [firstStep] = useState(initialStep);
  const onAction = usePortActions(page, token);
  usePort(ref, page, onAction, firstStep);
  return (
    <div
      ref={ref}
      className={variant === "au" ? "shell-au" : "shell-wzb"}
      data-page={page}
      data-initial-step={firstStep != null ? String(firstStep) : undefined}
    >
      {children}
    </div>
  );
}
