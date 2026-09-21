"use client";

/**
 * SegmentConfigSheet — segment analog of AnalystConfigSheet.
 *
 * One Sheet return. Always mounted (so the open transition fires when
 * `open` flips). Body content guarded on `segment` so a closed-Sheet
 * mount isn't required to render an empty form.
 *
 * Reads SegmentSummary off props (carried inline by getPodcastDetail —
 * no extra fetch).
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
      }
    : null;

  const handleChange: SegmentFormChangeHandler = (field, value) => {
    if (!segment) return;
    startTransition(async () => {
      await updateSegment(
        segment.id,
        { [field]: value } as Parameters<typeof updateSegment>[1],
      );
    });
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
            />
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
