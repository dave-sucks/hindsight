"use client";

/**
 * PodcastConfigPreview — mirror of AnalystConfigPanel for the podcast builder.
 *
 * Same Silk intro + outer rounded-xl + bordered shell + per-tab content
 * + bottom confirm CTA. Reuses Section / FieldGroup / RowLabel /
 * FreeTextChipsCombobox / GHOST_INPUT primitives so the form chrome is
 * byte-identical to the analyst surface.
 */

import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { Check, Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  Section,
  FieldGroup,
  RowLabel,
  GHOST_INPUT,
  FreeTextChipsCombobox,
} from "@/components/analysts/AnalystConfigForm";
import { cn } from "@/lib/utils";
import type { SuggestedPodcastConfig } from "@/lib/agent/tools/suggest-podcast-config";

const Silk = dynamic(() => import("@/components/Silk"), { ssr: false });

type Segment = SuggestedPodcastConfig["segments"][number];

interface Props {
  config: SuggestedPodcastConfig;
  onConfigChange: (next: SuggestedPodcastConfig) => void;
  onConfirm: () => void;
  isCreating: boolean;
  /** Override CTA labels for the editor flow ("Apply changes" / "Applying…"). */
  confirmLabel?: string;
  confirmingLabel?: string;
}

export function PodcastConfigPreview({
  config,
  onConfigChange,
  onConfirm,
  isCreating,
  confirmLabel = "Create podcast",
  confirmingLabel = "Creating…",
}: Props) {
  const [silkActive, setSilkActive] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setSilkActive(false), 2000);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    if (isCreating) setSilkActive(true);
  }, [isCreating]);

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
          excludeTopics: [],
          domainMonitors: [],
          searchQueries: [],
        },
      ],
    });
  };

  const totalSeconds = config.segments.reduce(
    (s, seg) => s + (seg.targetSeconds || 0),
    0,
  );
  const minutes = Math.round(totalSeconds / 60);

  return (
    <div className="flex flex-col h-full rounded-xl border bg-background shadow-2xl overflow-hidden relative">
      {/* Silk intro overlay — same as AnalystConfigPanel */}
      <div
        className="absolute inset-0 z-[5] transition-opacity duration-1000 ease-out pointer-events-none"
        style={{ opacity: silkActive ? 1 : 0 }}
      >
        <Silk speed={5} scale={0.85} color="#919191" noiseIntensity={1.5} rotation={0} />
      </div>

      {/* Header — silk avatar + editable name */}
      <div className="relative z-[6] shrink-0 p-3">
        <div className="flex items-center gap-3">
          <div className="size-12 rounded-full overflow-hidden shrink-0">
            <Silk speed={5} scale={0.85} color="#919191" noiseIntensity={1.5} rotation={0} />
          </div>
          <Input
            defaultValue={config.podcast.name}
            placeholder="Untitled Podcast"
            className="text-base font-brand font-semibold flex-1 min-w-0 border-transparent shadow-none focus-visible:border-input"
            onBlur={(e) => {
              const next = e.target.value.trim();
              if (next && next !== config.podcast.name) updatePodcast("name", next);
            }}
          />
        </div>
        <p className="text-[10px] text-muted-foreground mt-2 tabular-nums px-1">
          {config.segments.length} segment{config.segments.length === 1 ? "" : "s"} · ~{minutes} min total
        </p>
      </div>

      {/* Tabs */}
      <div className="relative z-[6] flex-1 min-h-0">
        <TooltipProvider>
          <Tabs defaultValue="brief" className="flex flex-col h-full min-h-0">
            <div className="px-3 pt-1 shrink-0">
              <TabsList>
                <TabsTrigger value="brief">Brief</TabsTrigger>
                <TabsTrigger value="segments">Segments</TabsTrigger>
                <TabsTrigger value="settings">Settings</TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="brief" className="flex-1 min-h-0 mt-0">
              <ScrollArea className="h-full">
                <div className="p-3 flex flex-col gap-4">
                  <FieldGroup
                    label="Description"
                    tooltip="One- or two-sentence show description."
                  >
                    <Textarea
                      defaultValue={config.podcast.description ?? ""}
                      placeholder="What this show is about, in one or two lines."
                      rows={3}
                      className="resize-y"
                      onBlur={(e) => {
                        const next = e.target.value.trim();
                        if (next !== (config.podcast.description ?? "")) {
                          updatePodcast("description", next);
                        }
                      }}
                    />
                  </FieldGroup>
                  <FieldGroup
                    label="Host style"
                    tooltip="The on-mic voice. Drives the script tone."
                  >
                    <Input
                      defaultValue={config.podcast.hostStyle ?? ""}
                      placeholder="e.g. NPR-style measured with dry wit"
                      onBlur={(e) => {
                        const next = e.target.value.trim();
                        if (next !== (config.podcast.hostStyle ?? "")) {
                          updatePodcast("hostStyle", next || undefined);
                        }
                      }}
                    />
                  </FieldGroup>
                </div>
              </ScrollArea>
            </TabsContent>

            <TabsContent value="segments" className="flex-1 min-h-0 mt-0">
              <ScrollArea className="h-full">
                <Section
                  label="Segments"
                  tooltip="Recurring beats inside every episode. Each runs as its own agent and produces its own transcript."
                >
                  {config.segments.map((seg, i) => (
                    <div
                      key={i}
                      className="rounded-md border p-3 space-y-2 mb-2 bg-background/40"
                    >
                      <div className="flex items-start gap-2">
                        <Input
                          value={seg.name}
                          onChange={(e) => updateSegment(i, { name: e.target.value })}
                          className="font-medium flex-1"
                          placeholder="Segment name"
                        />
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => removeSegment(i)}
                          aria-label="Remove segment"
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                      <FieldGroup label="Editorial brief">
                        <Textarea
                          value={seg.segmentPrompt}
                          onChange={(e) =>
                            updateSegment(i, { segmentPrompt: e.target.value })
                          }
                          rows={3}
                          className="text-xs resize-y"
                        />
                      </FieldGroup>
                      <div className="grid grid-cols-2 gap-3">
                        <FieldGroup label="Target seconds">
                          <Input
                            type="number"
                            value={seg.targetSeconds}
                            min={30}
                            max={1800}
                            step={30}
                            className={cn(GHOST_INPUT, "text-right tabular-nums")}
                            onChange={(e) =>
                              updateSegment(i, {
                                targetSeconds: Math.max(30, Number(e.target.value) || 30),
                              })
                            }
                          />
                        </FieldGroup>
                        <div className="flex items-end">
                          <span className="text-[10px] text-muted-foreground tabular-nums">
                            ~{Math.round(seg.targetSeconds / 60)} min
                          </span>
                        </div>
                      </div>
                      <FieldGroup label="Topics">
                        <FreeTextChipsCombobox
                          values={seg.topics}
                          placeholder="Add a topic"
                          onChange={(next) => updateSegment(i, { topics: next })}
                        />
                      </FieldGroup>

                      {/* Monitors preview — read-only here. Same Monitor
                          rows the analyst surface uses, persisted by
                          createPodcastFromBuilder as type=DOMAIN +
                          type=SEARCH scoped to the segment. */}
                      <div className="pt-1 space-y-1">
                        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          Sources ({seg.domainMonitors.length})
                        </p>
                        {seg.domainMonitors.length === 0 ? (
                          <p className="text-[11px] text-muted-foreground/60">
                            None proposed.
                          </p>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {seg.domainMonitors.map((m, mi) => (
                              <span
                                key={`${m.domain}-${mi}`}
                                className="inline-flex items-center gap-1 text-[11px] rounded-md bg-muted px-1.5 py-0.5"
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={`https://www.google.com/s2/favicons?domain=${m.domain}&sz=16`}
                                  alt=""
                                  width={10}
                                  height={10}
                                  className="size-2.5 rounded-sm"
                                />
                                {m.name || m.domain}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="space-y-1">
                        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          Search queries ({seg.searchQueries.length})
                        </p>
                        {seg.searchQueries.length === 0 ? (
                          <p className="text-[11px] text-muted-foreground/60">
                            None proposed.
                          </p>
                        ) : (
                          <ul className="space-y-0.5">
                            {seg.searchQueries.map((q, qi) => (
                              <li
                                key={qi}
                                className="text-[11px] text-muted-foreground truncate"
                              >
                                · {q.query}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  ))}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={addSegment}
                    className="w-full"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add segment
                  </Button>
                </Section>
              </ScrollArea>
            </TabsContent>

            <TabsContent value="settings" className="flex-1 min-h-0 mt-0">
              <ScrollArea className="h-full">
                <Section label="Schedule">
                  <div className="grid grid-cols-[1fr_auto] items-center gap-y-1 [&>*:nth-child(even)]:justify-self-end">
                    <RowLabel
                      label="Cadence"
                      tooltip="How often new episodes drop. You can run on demand regardless."
                    />
                    <Select
                      value={config.podcast.cadence ?? "ON_DEMAND"}
                      onValueChange={(val) =>
                        updatePodcast(
                          "cadence",
                          val as SuggestedPodcastConfig["podcast"]["cadence"],
                        )
                      }
                    >
                      <SelectTrigger size="sm" variant="ghost">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="DAILY">Daily</SelectItem>
                        <SelectItem value="WEEKLY">Weekly</SelectItem>
                        <SelectItem value="ON_DEMAND">On demand</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </Section>
                <Section
                  label="Voice"
                  tooltip="ElevenLabs voice for audio synthesis. Wired up in Phase 2."
                >
                  <FieldGroup label="Voice ID">
                    <Input
                      defaultValue=""
                      placeholder="Phase 2 — ElevenLabs voice id"
                      className={cn(GHOST_INPUT)}
                      disabled
                    />
                  </FieldGroup>
                </Section>
              </ScrollArea>
            </TabsContent>
          </Tabs>
        </TooltipProvider>
      </div>

      {/* Footer — confirm */}
      <div className="relative z-[6] shrink-0 border-t px-4 py-3 flex">
        <Button
          onClick={onConfirm}
          disabled={isCreating || config.segments.length === 0}
          className="w-full"
        >
          <Check className="h-4 w-4 mr-2" />
          {isCreating ? confirmingLabel : confirmLabel}
        </Button>
      </div>
    </div>
  );
}
