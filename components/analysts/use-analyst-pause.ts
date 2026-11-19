"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { setAnalystPaused } from "@/lib/actions/analyst.actions";

/** The Pause / Resume menu item's label and click, shared by the analyst cards and the analyst page. */
export function useAnalystPause(analyst: { id: string; name: string; enabled: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const pause = analyst.enabled;

  function toggle() {
    startTransition(async () => {
      try {
        await setAnalystPaused(analyst.id, pause);
        toast.success(`${analyst.name} ${pause ? "paused" : "resumed"}`);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Couldn't update the analyst");
      }
    });
  }

  return { label: pause ? "Pause analyst" : "Resume analyst", pause, pending, toggle };
}
