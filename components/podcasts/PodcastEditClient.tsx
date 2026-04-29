"use client";

/**
 * PodcastEditClient — mirror of AnalystEditClient, but for podcasts.
 * Split layout: chat on the left, PodcastConfigPreview on the right
 * (revealed when the AI suggests changes via suggest_podcast_config).
 *
 * On confirm, applies the proposal via updatePodcastFromEditor and
 * navigates back to the podcast detail page.
 */

import { useCallback, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { AgentChat } from "@/components/agent/AgentChat";
import { PodcastConfigPreview } from "@/components/podcasts/PodcastConfigPreview";
import type { SuggestedPodcastConfig } from "@/lib/agent/tools/suggest-podcast-config";
import {
  updatePodcastFromEditor,
  type PodcastDetail,
} from "@/lib/actions/podcast.actions";

export function PodcastEditClient({
  detail,
  initialMessage,
}: {
  detail: PodcastDetail;
  initialMessage?: string;
}) {
  const router = useRouter();
  const [config, setConfig] = useState<SuggestedPodcastConfig | null>(null);
  const [isApplying, startApplying] = useTransition();

  // Build the currentConfig blob the route forwards into the editor prompt.
  // The route re-loads the canonical state from the DB anyway (so this is
  // not load-bearing for prompt accuracy), but we ship it for symmetry with
  // the analyst editor and for visibility on the wire.
  const currentConfig: Record<string, unknown> = {
    podcast: {
      id: detail.id,
      name: detail.name,
      description: detail.description,
      hostStyle: detail.hostStyle,
      cadence: detail.cadence,
    },
    segments: detail.segments.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      segmentPrompt: s.segmentPrompt,
      targetSeconds: s.targetSeconds,
      topics: s.topics,
      excludeTopics: s.excludeTopics,
      domainMonitors: s.domainMonitors.map((m) => ({
        name: m.name,
        domain: m.domain,
      })),
      searchMonitors: s.searchMonitors.map((m) => ({
        name: m.name,
        query: m.query,
      })),
    })),
  };

  const handlePodcastConfigSuggested = useCallback((raw: unknown) => {
    setConfig(raw as SuggestedPodcastConfig);
  }, []);

  const handleConfirm = useCallback(
    (toApply: SuggestedPodcastConfig) => {
      startApplying(async () => {
        try {
          await updatePodcastFromEditor(detail.id, toApply);
          toast.success("Podcast updated");
          router.push(`/podcasts/${detail.id}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Unknown error";
          toast.error(`Failed to apply changes: ${msg}`);
        }
      });
    },
    [detail.id, router],
  );

  const panelOpen = config !== null;

  return (
    <div className="relative h-[calc(100dvh-3rem)] overflow-hidden">
      <div className="absolute top-2 left-3 z-20">
        <Button variant="ghost" size="icon" render={<Link href={`/podcasts/${detail.id}`} />}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
      </div>

      <div className="h-full flex">
        <div
          className="min-h-0 transition-all duration-500 ease-out"
          style={{ flex: panelOpen ? "0 0 55%" : "1 1 100%" }}
        >
          <AgentChat
            mode="podcast-editor"
            podcastId={detail.id}
            currentConfig={currentConfig}
            initialPrompt={initialMessage}
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
                isCreating={isApplying}
                confirmLabel="Apply changes"
                confirmingLabel="Applying…"
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
