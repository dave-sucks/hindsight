"use client";

/**
 * PodcastConfigPreviewRenderer — ui: "podcast-config-preview"
 *
 * Mirror of ConfigPreviewRenderer for the podcast builder. Shows a
 * compact summary card of the proposed Podcast + Segments inline in
 * chat, AND fires onPodcastConfigSuggested via ToolUICallbacks so
 * the parent (/podcasts/new client) opens the side panel with the
 * proposal. The actual create CTA lives in the side panel.
 *
 * This is the 6th renderer (vs CLAUDE.md's "5 renderer" guidance) —
 * deliberate exception, same structural role as ConfigPreviewRenderer
 * for analysts. Tagged in docs/PODCAST_FILES.md as PODCAST-NEW.
 */

import { useEffect, useRef } from "react";
import { Card } from "@/components/ui/card";
import { useToolUICallbacks } from "@/components/assistant-ui/tool-uis/tool-ui-shared";
import type { ToolResult } from "@/lib/agent/tool-result";

interface Props {
  result: Extract<ToolResult, { ok: true }>;
  loading: boolean;
}

interface PodcastFields {
  name: string;
  description: string;
  hostStyle?: string;
  cadence?: string;
}

interface SegmentFields {
  name: string;
  description?: string;
  segmentPrompt: string;
  targetSeconds: number;
  topics: string[];
  sources: string[];
  excludeTopics: string[];
}

interface PodcastConfigShape {
  podcast?: PodcastFields;
  segments?: SegmentFields[];
}

export function PodcastConfigPreviewRenderer({ result, loading }: Props) {
  const config = result.data as PodcastConfigShape | null;
  const { onPodcastConfigSuggested } = useToolUICallbacks();

  // Stable ref so the parent callback doesn't retrigger when its identity
  // changes between renders.
  const callbackRef = useRef(onPodcastConfigSuggested);
  callbackRef.current = onPodcastConfigSuggested;

  useEffect(() => {
    if (config && callbackRef.current) {
      callbackRef.current(config);
    }
  }, [config]);

  if (loading || !config?.podcast) return null;

  const segments = config.segments ?? [];
  const totalSeconds = segments.reduce((sum, s) => sum + (s.targetSeconds ?? 0), 0);
  const minutes = Math.round(totalSeconds / 60);

  return (
    <div className="my-2">
      <Card className="overflow-hidden p-0 gap-0">
        <div className="px-3 py-2 border-b flex items-center justify-between gap-2">
          <span className="text-sm font-semibold truncate">
            {config.podcast.name}
          </span>
          <span className="text-xs text-muted-foreground tabular-nums">
            {segments.length} segment{segments.length === 1 ? "" : "s"} · ~{minutes} min
          </span>
        </div>
        <div className="p-3 space-y-2">
          <p className="text-sm text-muted-foreground leading-relaxed line-clamp-2">
            {config.podcast.description}
          </p>
          {segments.length > 0 && (
            <ul className="space-y-1 pt-1">
              {segments.map((s, i) => (
                <li key={i} className="text-xs flex items-start gap-2">
                  <span className="text-muted-foreground tabular-nums w-10 shrink-0">
                    ~{Math.round(s.targetSeconds / 60)}m
                  </span>
                  <span className="font-medium">{s.name}</span>
                  {s.topics.length > 0 && (
                    <span className="text-muted-foreground truncate">
                      · {s.topics.slice(0, 3).join(", ")}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted-foreground/60 pt-1">
            Review the full podcast and segments in the panel.
          </p>
        </div>
      </Card>
    </div>
  );
}
