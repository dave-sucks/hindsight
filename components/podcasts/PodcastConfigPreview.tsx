"use client";

/**
 * PodcastConfigPreview — right-side panel for the podcast builder + editor.
 *
 * Mirror of AnalystConfigPanel. Same outer chrome (Silk header + name +
 * footer Confirm) and the same form-primitive vocabulary
 * (Section / FieldGroup / RowLabel / GHOST_INPUT). Three tabs:
 *
 *   • Brief — podcast-level description + host style.
 *   • Segments — one collapsible row per segment. Expanded = the SAME
 *     SegmentConfigForm used in the per-segment Settings sheet on the
 *     podcast detail page (Overview + Settings tabs, real Sources +
 *     Search Queries list rendering with favicon / search-icon rows).
 *     The proposal lives in memory here; mutations update the
 *     SuggestedPodcastConfig in place. The same callbacks shape that
 *     SegmentConfigSheet uses with server actions.
 *   • Settings — cadence + voice.
 *
 * Result: ONE component renders segment editing in both surfaces. No
 * custom chip/bullet rendering anymore — the analyst monitor visual
 * language is the only design that exists.
 */

import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { Check, ChevronDown, Plus, Trash2 } from "lucide-react";

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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  Section,
  FieldGroup,
  RowLabel,
  GHOST_INPUT,
} from "@/components/analysts/AnalystConfigForm";
import {
  SegmentConfigForm,
  type SegmentFormValues,
  type SegmentFormChangeHandler,
} from "@/components/podcasts/SegmentConfigForm";
import { cn } from "@/lib/utils";
import type { SuggestedPodcastConfig } from "@/lib/agent/tools/suggest-podcast-config";

const Silk = dynamic(() => import("@/components/Silk"), { ssr: false });

type ProposalSegment = SuggestedPodcastConfig["segments"][number];

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

  const updateSegment = (index: number, patch: Partial<ProposalSegment>) => {
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
          segmentPrompt:
            "Describe what this segment covers and the editorial angle.",
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
                  <div className="flex flex-col gap-2">
                    {config.segments.map((seg, i) => (
                      <SegmentRow
                        key={i}
                        index={i}
                        segment={seg}
                        onUpdate={(patch) => updateSegment(i, patch)}
                        onRemove={() => removeSegment(i)}
                        defaultOpen={i === 0}
                      />
                    ))}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={addSegment}
                    className="w-full mt-3"
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

// ─── Segment row ─────────────────────────────────────────────────────────────
//
// A collapsible card per segment. The header shows segment name + a duration
// chip and a remove button. Expanded content is the canonical
// SegmentConfigForm — same component the per-segment Settings sheet uses on
// /podcasts/[id]. Monitor add/remove in this surface mutates the proposal in
// place (no DB yet — that happens on Confirm). Field edits flow through the
// same SegmentFormChangeHandler shape SegmentConfigSheet uses for server
// actions.

function SegmentRow({
  index,
  segment,
  onUpdate,
  onRemove,
  defaultOpen,
}: {
  index: number;
  segment: ProposalSegment;
  onUpdate: (patch: Partial<ProposalSegment>) => void;
  onRemove: () => void;
  defaultOpen?: boolean;
}) {
  const minutes = Math.round((segment.targetSeconds || 0) / 60);

  // Adapt the proposal segment → SegmentFormValues. The proposal stores
  // monitors as { name, domain, reason } / { query, reason }. The form
  // expects { id, name, domain } / { id, name, query }. We use the array
  // index as a stable id within this proposal — sufficient for the in-
  // memory edit experience; real ids land on Confirm when the action
  // creates Monitor rows.
  const values: SegmentFormValues = {
    name: segment.name,
    description: segment.description ?? null,
    segmentPrompt: segment.segmentPrompt,
    targetSeconds: segment.targetSeconds,
    topics: segment.topics ?? [],
    excludeTopics: segment.excludeTopics ?? [],
    domainMonitors: (segment.domainMonitors ?? []).map((m, mi) => ({
      id: `domain-${mi}`,
      name: m.name,
      domain: m.domain,
    })),
    searchMonitors: (segment.searchQueries ?? []).map((q, qi) => ({
      id: `search-${qi}`,
      name: q.query,
      query: q.query,
    })),
  };

  const handleChange: SegmentFormChangeHandler = (field, value) => {
    switch (field) {
      case "name":
        onUpdate({ name: value as string });
        return;
      case "description":
        onUpdate({ description: (value as string | null) ?? "" });
        return;
      case "segmentPrompt":
        onUpdate({ segmentPrompt: value as string });
        return;
      case "targetSeconds":
        onUpdate({ targetSeconds: value as number });
        return;
      case "topics":
        onUpdate({ topics: value as string[] });
        return;
      case "excludeTopics":
        onUpdate({ excludeTopics: value as string[] });
        return;
      // Monitor mutations land via the dedicated add/remove callbacks below,
      // not through onChange.
      case "domainMonitors":
      case "searchMonitors":
        return;
    }
  };

  const handleAddDomain = ({ name, domain }: { name: string; domain: string }) => {
    onUpdate({
      domainMonitors: [
        ...(segment.domainMonitors ?? []),
        { name: name || domain, domain, reason: "" },
      ],
    });
  };

  const handleAddSearch = ({ query }: { name?: string; query: string }) => {
    onUpdate({
      searchQueries: [...(segment.searchQueries ?? []), { query, reason: "" }],
    });
  };

  const handleRemoveMonitor = (monitorId: string) => {
    if (monitorId.startsWith("domain-")) {
      const idx = Number(monitorId.slice("domain-".length));
      onUpdate({
        domainMonitors: (segment.domainMonitors ?? []).filter((_, i) => i !== idx),
      });
      return;
    }
    if (monitorId.startsWith("search-")) {
      const idx = Number(monitorId.slice("search-".length));
      onUpdate({
        searchQueries: (segment.searchQueries ?? []).filter((_, i) => i !== idx),
      });
      return;
    }
  };

  return (
    <Collapsible defaultOpen={defaultOpen} className="rounded-md border bg-background/40">
      <CollapsibleTrigger
        render={
          <div className="flex items-center gap-2 w-full px-3 py-2 cursor-pointer hover:bg-accent/30 group">
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground transition-transform group-data-[state=closed]:-rotate-90" />
            <span className="text-sm font-medium flex-1 truncate text-left">
              {segment.name || `Segment ${index + 1}`}
            </span>
            <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
              ~{minutes}m
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRemove();
              }}
              className="text-muted-foreground hover:text-destructive transition-colors p-1 -mr-1"
              aria-label="Remove segment"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        }
      />
      <CollapsibleContent>
        <div className="border-t">
          {/* Fixed-height container so the inner Tabs + ScrollArea behave
              like the per-segment Sheet does (and like the analyst form
              behaves inside the analyst sheet). 480px feels right for the
              right-rail panel — large enough to skim Sources + Queries
              without expanding the whole panel. */}
          <div className="h-[480px]">
            <SegmentConfigForm
              values={values}
              onChange={handleChange}
              onAddDomainMonitor={handleAddDomain}
              onAddSearchMonitor={handleAddSearch}
              onRemoveMonitor={handleRemoveMonitor}
              hideName
            />
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
