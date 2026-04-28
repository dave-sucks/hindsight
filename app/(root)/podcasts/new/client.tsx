"use client";

import { useCallback, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { AgentChat } from "@/components/agent/AgentChat";
import { PodcastConfigPreview } from "@/components/podcasts/PodcastConfigPreview";
import type { SuggestedPodcastConfig } from "@/lib/agent/tools/suggest-podcast-config";
import { createPodcastFromBuilder } from "@/lib/actions/podcast.actions";

/**
 * Podcast builder route — split layout mirrors /analysts/new.
 * Chat on the left calls suggest_podcast_config; this client receives
 * the proposal via onPodcastConfigSuggested and opens the side panel.
 *
 * See docs/PODCAST_PLAN.md.
 */
export function PodcastBuilderClient() {
  const router = useRouter();
  const [config, setConfig] = useState<SuggestedPodcastConfig | null>(null);
  const [isCreating, startCreating] = useTransition();

  const handlePodcastConfigSuggested = useCallback((raw: unknown) => {
    // Type comes back as `unknown` from AgentChat to avoid a UI->tools layer
    // dependency. The runtime shape matches SuggestedPodcastConfig because
    // suggest_podcast_config validated it via Zod before returning.
    setConfig(raw as SuggestedPodcastConfig);
  }, []);

  const handleConfirm = useCallback(
    (toCreate: SuggestedPodcastConfig) => {
      startCreating(async () => {
        try {
          const result = await createPodcastFromBuilder(toCreate);
          toast.success(`Podcast "${toCreate.podcast.name}" created`);
          router.push(`/podcasts/${result.id}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Unknown error";
          toast.error(`Failed to create podcast: ${msg}`);
        }
      });
    },
    [router],
  );

  const panelOpen = config !== null;

  return (
    <div className="relative h-[calc(100dvh-3rem)] overflow-hidden">
      <div className="absolute top-2 left-3 z-20">
        <Button variant="ghost" size="icon" render={<Link href="/podcasts" />}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
      </div>

      <div className="h-full flex">
        <div
          className="min-h-0 transition-all duration-500 ease-out"
          style={{ flex: panelOpen ? "0 0 55%" : "1 1 100%" }}
        >
          <AgentChat
            mode="podcast-builder"
            onPodcastConfigSuggested={handlePodcastConfigSuggested}
          />
        </div>

        <div
          className="min-h-0 transition-all duration-500 ease-out overflow-hidden"
          style={{
            flex: panelOpen ? "0 0 45%" : "0 0 0%",
            opacity: panelOpen ? 1 : 0,
          }}
        >
          <div className="h-full p-3 pl-0">
            {config && (
              <PodcastConfigPreview
                config={config}
                onConfigChange={setConfig}
                onConfirm={() => handleConfirm(config)}
                isCreating={isCreating}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
