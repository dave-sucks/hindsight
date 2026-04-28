"use client";

/**
 * SegmentConfigSheet — segment analog of AnalystConfigSheet.
 *
 * One Sheet return. Always mounted (so the open transition fires when
 * `open` flips). Body content guarded on `segment` so a closed-Sheet
 * mount isn't required to render an empty form.
 *
 * Reads SegmentSummary off props (carried inline by getPodcastDetail —
 * no extra fetch). Domain monitors and search monitors live on the same
 * Monitor table the analyst surface uses, just split by Monitor.type.
 */

import { useTransition } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  SegmentConfigForm,
  type SegmentFormValues,
  type SegmentFormChangeHandler,
} from "@/components/podcasts/SegmentConfigForm";
import {
  updateSegment,
  addSegmentMonitor,
  removeSegmentMonitor,
  type SegmentSummary,
} from "@/lib/actions/podcast.actions";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  segment: SegmentSummary | null;
}

export function SegmentConfigSheet({ open, onOpenChange, segment }: Props) {
  const [, startTransition] = useTransition();

  const values: SegmentFormValues | null = segment
    ? {
        name: segment.name,
        description: segment.description,
        segmentPrompt: segment.segmentPrompt,
        targetSeconds: segment.targetSeconds,
        topics: segment.topics,
        excludeTopics: segment.excludeTopics,
        domainMonitors: segment.domainMonitors.map((d) => ({
          id: d.id,
          name: d.name,
          domain: d.domain,
        })),
        searchMonitors: segment.searchMonitors.map((s) => ({
          id: s.id,
          name: s.name,
          query: s.query,
        })),
      }
    : null;

  const handleChange: SegmentFormChangeHandler = (field, value) => {
    if (!segment) return;
    if (field === "domainMonitors" || field === "searchMonitors") return; // monitors mutate via add/remove
    startTransition(async () => {
      await updateSegment(
        segment.id,
        { [field]: value } as Parameters<typeof updateSegment>[1],
      );
    });
  };

  const handleAddDomain = async (input: { name: string; domain: string }) => {
    if (!segment) return;
    await addSegmentMonitor(segment.id, { type: "DOMAIN", ...input });
  };

  const handleAddSearch = async (input: { name?: string; query: string }) => {
    if (!segment) return;
    await addSegmentMonitor(segment.id, { type: "SEARCH", ...input });
  };

  const handleRemoveMonitor = async (monitorId: string) => {
    if (!segment) return;
    await removeSegmentMonitor(monitorId);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-[420px] sm:max-w-[420px] flex flex-col p-0"
      >
        <SheetHeader className="shrink-0 px-3 pt-3">
          <SheetTitle className="text-sm font-semibold">
            {segment?.name ?? "Configuration"}
          </SheetTitle>
          <SheetDescription className="text-xs">
            Edit settings directly or use the AI chat.
          </SheetDescription>
        </SheetHeader>

        {values && (
          <div className="flex-1 min-h-0">
            <SegmentConfigForm
              values={values}
              onChange={handleChange}
              onAddDomainMonitor={handleAddDomain}
              onAddSearchMonitor={handleAddSearch}
              onRemoveMonitor={handleRemoveMonitor}
            />
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
