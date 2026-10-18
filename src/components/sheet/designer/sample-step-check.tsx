"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast2 } from "@/components/port/kit";
import { recordSampleStep } from "@/modules/sheet/sample-actions";

/**
 * The Designer's "Mark … done" box on a sample step. Ticking it records the sample proof for
 * real; a recorded proof stays recorded (the database keeps them), so it cannot be unticked.
 */
export function SampleStepCheck({ step, done, label }: { step: string; done: boolean; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <input
      type={"checkbox"}
      defaultChecked={done}
      aria-label={label}
      onChange={async (event) => {
        const box = event.currentTarget;
        if (done || !box.checked) {
          box.checked = done;
          return;
        }
        if (busy) return;
        setBusy(true);
        const result = await recordSampleStep(step).catch(() => ({ error: "That step couldn’t be recorded. Try again." }));
        setBusy(false);
        if ("error" in result) {
          box.checked = false;
          toast2(result.error, { kind: "bad" });
          return;
        }
        toast2("Sample step done", { kind: "ok" });
        router.refresh();
      }}
    />
  );
}
