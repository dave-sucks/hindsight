"use client";

/**
 * GenerateAudioButton — triggers ElevenLabs TTS for an episode.
 *
 * Shows the estimated cost ($X.XX) before the user clicks. On click, calls
 * triggerEpisodeAudio server action which sets status=ASSEMBLING and dispatches
 * the Inngest job. Reloads the page so the ASSEMBLING status is reflected.
 *
 * Cost is shown inline on the button so the user sees it without a modal.
 * Per the handoff: "Don't auto-generate; require explicit user click."
 *
 * Tagged PODCAST-NEW in docs/PODCAST_FILES.md (Session 2).
 */

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Mic, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { triggerEpisodeAudio } from "@/lib/actions/podcast.actions";
import { estimateCost } from "@/lib/podcast/elevenlabs";

interface Props {
  episodeId: string;
  charCount: number;
  variant?: "generate" | "regenerate";
}

function formatCost(usd: number): string {
  if (usd < 0.01) return "<$0.01";
  return `~$${usd.toFixed(2)}`;
}

export function GenerateAudioButton({
  episodeId,
  charCount,
  variant = "generate",
}: Props) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const estimatedCost = estimateCost(charCount);

  function handleClick() {
    startTransition(async () => {
      const result = await triggerEpisodeAudio(episodeId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(
        `Audio generation queued — ${formatCost(result.estimatedCostUsd)} estimated`,
      );
      // Refresh to show ASSEMBLING status
      router.refresh();
    });
  }

  if (variant === "regenerate") {
    return (
      <Button
        variant="ghost"
        size="sm"
        onClick={handleClick}
        disabled={isPending}
      >
        <RefreshCw className="h-3 w-3 mr-1" />
        {isPending ? "Queuing…" : "Re-generate"}
      </Button>
    );
  }

  return (
    <Button
      size="sm"
      onClick={handleClick}
      disabled={isPending || charCount === 0}
      className="shrink-0"
    >
      <Mic className="h-3.5 w-3.5 mr-1.5" />
      {isPending
        ? "Queuing…"
        : `Generate audio ${charCount > 0 ? `(${formatCost(estimatedCost)})` : ""}`}
    </Button>
  );
}
