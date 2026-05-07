"use client";

/**
 * PodcastConfigSheet — podcast-level settings sheet.
 *
 * Mirror of AnalystConfigSheet but for podcast-level metadata
 * (name, description, host style, cadence, voice). Reuses the same
 * Section/FieldGroup/RowLabel primitives so the visual language is
 * identical across the analyst surface and the podcast surface.
 *
 * Session 2: Voice section now renders a real ElevenLabs voice picker.
 * Voices are fetched once on sheet open and cached in component state.
 */

import { useEffect, useState, useTransition } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  Section,
  FieldGroup,
  RowLabel,
} from "@/components/analysts/AnalystConfigForm";
import {
  updatePodcastBasics,
  updatePodcastVoice,
  type PodcastDetail,
} from "@/lib/actions/podcast.actions";
import { getElevenLabsVoices } from "@/lib/actions/api-keys.actions";
import type { ElevenLabsVoice } from "@/lib/podcast/elevenlabs";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  detail: PodcastDetail;
}

export function PodcastConfigSheet({ open, onOpenChange, detail }: Props) {
  const [, startTransition] = useTransition();
  const [voices, setVoices] = useState<ElevenLabsVoice[]>([]);
  const [voicesLoaded, setVoicesLoaded] = useState(false);

  // Fetch voices once when the sheet first opens. Cached in component state
  // so navigating away and back doesn't re-fetch.
  useEffect(() => {
    if (!open || voicesLoaded) return;
    getElevenLabsVoices().then(({ voices: v }) => {
      setVoices(v);
      setVoicesLoaded(true);
    });
  }, [open, voicesLoaded]);

  const save = (patch: Parameters<typeof updatePodcastBasics>[1]) => {
    startTransition(async () => {
      await updatePodcastBasics(detail.id, patch);
    });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-[420px] sm:max-w-[420px] flex flex-col p-0"
      >
        <SheetHeader className="shrink-0 px-3 pt-3">
          <SheetTitle className="text-sm font-semibold">Configuration</SheetTitle>
          <SheetDescription className="text-xs">
            Show-level settings. Per-segment editing is on the segment card.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 min-h-0">
          <TooltipProvider>
            <ScrollArea className="h-full">
              <Section label="Show">
                <FieldGroup label="Name">
                  <Input
                    defaultValue={detail.name}
                    placeholder="Untitled podcast"
                    onBlur={(e) => {
                      const next = e.target.value.trim();
                      if (next && next !== detail.name) save({ name: next });
                    }}
                  />
                </FieldGroup>

                <FieldGroup
                  label="Description"
                  tooltip="One- or two-sentence show description. Shown on the podcast list."
                >
                  <Textarea
                    defaultValue={detail.description ?? ""}
                    placeholder="What this show is about, in one or two lines."
                    rows={3}
                    className="resize-y"
                    onBlur={(e) => {
                      const next = e.target.value.trim();
                      if (next !== (detail.description ?? "")) {
                        save({ description: next || null });
                      }
                    }}
                  />
                </FieldGroup>

                <FieldGroup
                  label="Host style"
                  tooltip="The on-mic voice. Drives the script tone."
                >
                  <Input
                    defaultValue={detail.hostStyle ?? ""}
                    placeholder="e.g. NPR-style measured with dry wit"
                    onBlur={(e) => {
                      const next = e.target.value.trim();
                      if (next !== (detail.hostStyle ?? "")) {
                        save({ hostStyle: next || null });
                      }
                    }}
                  />
                </FieldGroup>
              </Section>

              <Section label="Schedule">
                <div className="grid grid-cols-[1fr_auto] items-center gap-y-1 [&>*:nth-child(even)]:justify-self-end">
                  <RowLabel
                    label="Cadence"
                    tooltip="How often new episodes drop. Informational — you can run on demand regardless."
                  />
                  <Select
                    value={detail.cadence ?? "ON_DEMAND"}
                    onValueChange={(val) => save({ cadence: String(val) })}
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
                tooltip="ElevenLabs voice used for audio synthesis. Add your ElevenLabs API key in Settings to see available voices."
              >
                <div className="grid grid-cols-[1fr_auto] items-center gap-y-1 [&>*:nth-child(even)]:justify-self-end">
                  <RowLabel label="Voice" />
                  {voices.length === 0 ? (
                    <span className="text-xs text-muted-foreground">
                      {voicesLoaded
                        ? "No voices — add ElevenLabs key in Settings"
                        : open
                          ? "Loading…"
                          : "—"}
                    </span>
                  ) : (
                    <Select
                      value={detail.voiceId ?? ""}
                      onValueChange={(val) => {
                        startTransition(async () => {
                          await updatePodcastVoice(detail.id, val || null);
                        });
                      }}
                    >
                      <SelectTrigger size="sm" variant="ghost" className="max-w-[180px]">
                        <SelectValue placeholder="Pick a voice" />
                      </SelectTrigger>
                      <SelectContent>
                        {voices.map((v) => (
                          <SelectItem key={v.voice_id} value={v.voice_id}>
                            {v.name}
                            {v.category ? (
                              <span className="text-muted-foreground ml-1 text-xs">
                                {v.category}
                              </span>
                            ) : null}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              </Section>
            </ScrollArea>
          </TooltipProvider>
        </div>
      </SheetContent>
    </Sheet>
  );
}
