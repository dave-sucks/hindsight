"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Mic, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { triggerEpisodeAudio, updatePodcastVoice } from "@/lib/actions/podcast.actions";
import { getElevenLabsVoices } from "@/lib/actions/api-keys.actions";
import { estimateCost } from "@/lib/podcast/elevenlabs";
import type { ElevenLabsVoice } from "@/lib/podcast/elevenlabs";

interface Props {
  episodeId: string;
  podcastId: string;
  podcastVoiceId: string | null;
  charCount: number;
  variant?: "generate" | "regenerate";
}

function formatCost(usd: number): string {
  if (usd < 0.01) return "<$0.01";
  return `~$${usd.toFixed(2)}`;
}

export function GenerateAudioButton({
  episodeId,
  podcastId,
  podcastVoiceId,
  charCount,
  variant = "generate",
}: Props) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const [voices, setVoices] = useState<ElevenLabsVoice[]>([]);
  const [voicesLoading, setVoicesLoading] = useState(true);
  const [voicesError, setVoicesError] = useState<string | null>(null);
  const [selectedVoiceId, setSelectedVoiceId] = useState<string>(podcastVoiceId ?? "");
  const [manualVoiceId, setManualVoiceId] = useState<string>(podcastVoiceId ?? "");

  useEffect(() => {
    getElevenLabsVoices().then(({ voices: v, error }) => {
      setVoices(v);
      setVoicesError(error ?? null);
      setVoicesLoading(false);
    });
  }, []);

  const estimatedCost = estimateCost(charCount);

  function handleGenerate() {
    startTransition(async () => {
      const result = await triggerEpisodeAudio(episodeId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(
        `Audio generation queued — ${formatCost(result.estimatedCostUsd)} estimated`,
      );
      router.refresh();
    });
  }

  function handleVoiceChange(voiceId: string | null) {
    if (!voiceId) return;
    setSelectedVoiceId(voiceId);
    startTransition(async () => {
      await updatePodcastVoice(podcastId, voiceId || null);
    });
  }

  function handleManualVoiceSave() {
    const id = manualVoiceId.trim();
    if (!id) return;
    setSelectedVoiceId(id);
    startTransition(async () => {
      await updatePodcastVoice(podcastId, id);
    });
  }

  if (variant === "regenerate") {
    return (
      <Button variant="ghost" size="sm" onClick={handleGenerate} disabled={isPending}>
        <RefreshCw className="h-3 w-3 mr-1" />
        {isPending ? "Queuing…" : "Re-generate"}
      </Button>
    );
  }

  const activeVoiceId = selectedVoiceId || podcastVoiceId || "";
  const hasVoice = !!activeVoiceId;

  return (
    <div className="flex items-center gap-2">
      {voicesLoading ? (
        <span className="text-xs text-muted-foreground">Loading voices…</span>
      ) : voices.length > 0 ? (
        <Select value={activeVoiceId} onValueChange={handleVoiceChange}>
          <SelectTrigger size="sm" variant="ghost" className="max-w-[160px]">
            <SelectValue placeholder="Pick a voice" />
          </SelectTrigger>
          <SelectContent>
            {voices.map((v) => (
              <SelectItem key={v.voice_id} value={v.voice_id}>
                {v.name}
                {v.category && (
                  <span className="text-muted-foreground ml-1 text-xs">{v.category}</span>
                )}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <div className="flex items-center gap-1.5">
          <Input
            size={28}
            value={manualVoiceId}
            onChange={(e) => setManualVoiceId(e.target.value)}
            onBlur={handleManualVoiceSave}
            onKeyDown={(e) => e.key === "Enter" && handleManualVoiceSave()}
            placeholder={voicesError ? `Error: ${voicesError}` : "Paste ElevenLabs voice ID"}
            className="h-8 text-xs w-64"
          />
        </div>
      )}
      <Button
        size="sm"
        onClick={handleGenerate}
        disabled={isPending || charCount === 0 || !hasVoice || voicesLoading}
        className="shrink-0"
      >
        <Mic className="h-3.5 w-3.5 mr-1.5" />
        {isPending
          ? "Queuing…"
          : `Generate audio${charCount > 0 ? ` (${formatCost(estimatedCost)})` : ""}`}
      </Button>
    </div>
  );
}
