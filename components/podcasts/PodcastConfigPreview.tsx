"use client";

/**
 * PodcastConfigPreview — side-panel for the podcast builder.
 *
 * Shows the suggested Podcast + Segments and lets the user edit
 * top-level fields and segment names/prompts/topics inline before
 * confirming. PoC scope: simple flat editor; richer per-segment
 * config tools live on /podcasts/[id]/segments/[segmentId] after
 * creation.
 *
 * See docs/PODCAST_PLAN.md.
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Loader2, Plus, X, Mic } from "lucide-react";
import type { SuggestedPodcastConfig } from "@/lib/agent/tools/suggest-podcast-config";

type Segment = SuggestedPodcastConfig["segments"][number];

interface Props {
  config: SuggestedPodcastConfig;
  onConfigChange: (next: SuggestedPodcastConfig) => void;
  onConfirm: () => void;
  isCreating: boolean;
}

export function PodcastConfigPreview({
  config,
  onConfigChange,
  onConfirm,
  isCreating,
}: Props) {
  const updatePodcast = <K extends keyof SuggestedPodcastConfig["podcast"]>(
    key: K,
    value: SuggestedPodcastConfig["podcast"][K],
  ) => {
    onConfigChange({
      ...config,
      podcast: { ...config.podcast, [key]: value },
    });
  };

  const updateSegment = (index: number, patch: Partial<Segment>) => {
    onConfigChange({
      ...config,
      segments: config.segments.map((s, i) => (i === index ? { ...s, ...patch } : s)),
    });
  };

  const removeSegment = (index: number) => {
    onConfigChange({
      ...config,
      segments: config.segments.filter((_, i) => i !== index),
    });
  };

  const addSegment = () => {
    onConfigChange({
      ...config,
      segments: [
        ...config.segments,
        {
          name: "New Segment",
          description: "",
          segmentPrompt: "Describe what this segment covers and the editorial angle.",
          targetSeconds: 180,
          topics: [],
          sources: [],
          excludeTopics: [],
        },
      ],
    });
  };

  const totalSeconds = config.segments.reduce((s, seg) => s + (seg.targetSeconds || 0), 0);
  const minutes = Math.round(totalSeconds / 60);

  return (
    <Card className="h-full flex flex-col p-0 gap-0">
      <CardHeader className="border-b px-4 py-3 shrink-0">
        <CardTitle className="text-base flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Mic className="h-4 w-4" />
            Podcast preview
          </span>
          <span className="text-xs font-normal text-muted-foreground tabular-nums">
            {config.segments.length} seg · ~{minutes} min
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-5">
        <section className="space-y-2">
          <Label htmlFor="podcast-name" className="text-xs uppercase tracking-wide">
            Show name
          </Label>
          <Input
            id="podcast-name"
            value={config.podcast.name}
            onChange={(e) => updatePodcast("name", e.target.value)}
          />

          <Label
            htmlFor="podcast-desc"
            className="text-xs uppercase tracking-wide pt-2"
          >
            Description
          </Label>
          <Textarea
            id="podcast-desc"
            value={config.podcast.description}
            onChange={(e) => updatePodcast("description", e.target.value)}
            rows={3}
          />

          <Label
            htmlFor="podcast-host"
            className="text-xs uppercase tracking-wide pt-2"
          >
            Host style
          </Label>
          <Input
            id="podcast-host"
            value={config.podcast.hostStyle ?? ""}
            placeholder="e.g. NPR-style measured with dry wit"
            onChange={(e) => updatePodcast("hostStyle", e.target.value)}
          />
        </section>

        <div className="border-t pt-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
              Segments
            </h3>
            <Button variant="ghost" size="sm" onClick={addSegment}>
              <Plus className="h-3.5 w-3.5" />
              Add
            </Button>
          </div>

          {config.segments.map((seg, i) => (
            <Card key={i} className="p-3 space-y-2 shadow-none">
              <div className="flex items-start gap-2">
                <div className="flex-1 space-y-2 min-w-0">
                  <Input
                    value={seg.name}
                    onChange={(e) => updateSegment(i, { name: e.target.value })}
                    className="font-medium"
                  />
                  <Textarea
                    value={seg.segmentPrompt}
                    onChange={(e) => updateSegment(i, { segmentPrompt: e.target.value })}
                    rows={3}
                    className="text-sm"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        Target seconds
                      </Label>
                      <Input
                        type="number"
                        value={seg.targetSeconds}
                        onChange={(e) =>
                          updateSegment(i, {
                            targetSeconds: Number(e.target.value) || 0,
                          })
                        }
                      />
                    </div>
                    <div>
                      <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        Topics (comma-sep)
                      </Label>
                      <Input
                        value={seg.topics.join(", ")}
                        onChange={(e) =>
                          updateSegment(i, {
                            topics: e.target.value
                              .split(",")
                              .map((t) => t.trim())
                              .filter(Boolean),
                          })
                        }
                      />
                    </div>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => removeSegment(i)}
                  className="text-muted-foreground"
                  aria-label="Remove segment"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      </CardContent>

      <div className="border-t px-4 py-3 shrink-0">
        <Button
          onClick={onConfirm}
          disabled={isCreating || config.segments.length === 0}
          className="w-full"
        >
          {isCreating && <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />}
          {isCreating ? "Creating…" : "Create podcast"}
        </Button>
      </div>
    </Card>
  );
}
