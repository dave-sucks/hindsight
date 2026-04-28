"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Redo2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { runSegment } from "@/lib/actions/podcast.actions";

/**
 * Single Run button used by both analyst and podcast-segment surfaces.
 * Pass `analystId` for analyst runs (hits /api/research/agent-run) or
 * `podcastSegmentId` for segment runs (calls runSegment server action).
 * `hasRunning` flips the label/icon to a Running… state to prevent
 * double-kicks.
 *
 * Sets `priority` to `secondary` when the button is in a podcast surface
 * just so we have one prop to flip if we ever want to differentiate
 * styling. For now the visual is identical — same component, same chrome.
 */
export function RunResearchButton({
  hasRunning,
  analystId,
  podcastSegmentId,
  size = "sm",
  variant = "outline",
  label,
}: {
  hasRunning: boolean;
  analystId?: string;
  podcastSegmentId?: string;
  size?: "sm" | "default";
  variant?: "default" | "outline" | "ghost" | "secondary";
  /** Override the default "Run" label — e.g. "Run segment". */
  label?: string;
}) {
  const [loading, setLoading] = useState(false);
  const [, startTransition] = useTransition();
  const router = useRouter();

  const handleClick = async () => {
    setLoading(true);
    try {
      if (podcastSegmentId) {
        // Segment run path — calls the server action that creates a
        // ResearchRun with podcastSegmentId set. Mirrors the analyst
        // /api/research/agent-run handler but bypasses HTTP.
        const result = await new Promise<{ runId: string }>((resolve, reject) => {
          startTransition(async () => {
            try {
              resolve(await runSegment(podcastSegmentId));
            } catch (err) {
              reject(err);
            }
          });
        });
        router.push(`/runs/${result.runId}`);
        return;
      }

      // Analyst path — unchanged.
      const res = await fetch("/api/research/agent-run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentConfigId: analystId }),
      });
      if (!res.ok) throw new Error("Failed to create run");
      const { runId } = (await res.json()) as { runId: string };
      router.push(`/runs/${runId}`);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to start research run",
      );
      setLoading(false);
    }
  };

  const disabled = loading || hasRunning;
  const labelText = label ?? "Run";

  return (
    <Button size={size} variant={variant} onClick={handleClick} disabled={disabled}>
      {loading || hasRunning ? (
        <Loader2 className="animate-spin" />
      ) : (
        <Redo2 />
      )}
      {loading
        ? "Starting run…"
        : hasRunning
          ? "Running…"
          : labelText}
    </Button>
  );
}
