"use client";

/**
 * SegmentConfigSheet — segment analog of AnalystConfigSheet.
 *
 * Same Sheet wrapper, same width, same header copy, same per-field save
 * pattern. Pipes form changes straight into updateSegment / addSegmentMonitor /
 * removeSegmentMonitor server actions.
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
  type SegmentDetail,
} from "@/lib/actions/podcast.actions";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  detail: SegmentDetail;
}

export function SegmentConfigSheet({ open, onOpenChange, detail }: Props) {
  const [, startTransition] = useTransition();

  const values: SegmentFormValues = {
    name: detail.name,
    description: detail.description,
    segmentPrompt: detail.segmentPrompt,
    targetSeconds: detail.targetSeconds,
    topics: detail.topics,
    sources: detail.sources,
    excludeTopics: detail.excludeTopics,
    monitors: detail.monitors.map((m) => {
      const cfg = (m.config as { query?: string } | null) ?? {};
      return { id: m.id, name: m.name, query: cfg.query ?? "" };
    }),
  };

  const handleChange: SegmentFormChangeHandler = (field, value) => {
    if (field === "monitors") return; // monitors mutate via addSegmentMonitor / removeSegmentMonitor
    startTransition(async () => {
      // updateSegment accepts a partial patch — pass a single-key object.
      await updateSegment(detail.id, { [field]: value } as Parameters<typeof updateSegment>[1]);
    });
  };

  const handleAddMonitor = async (input: { name: string; query: string }) => {
    await addSegmentMonitor(detail.id, input);
  };

  const handleRemoveMonitor = async (monitorId: string) => {
    await removeSegmentMonitor(monitorId);
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
            Edit settings directly or use the AI chat.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 min-h-0">
          <SegmentConfigForm
            values={values}
            onChange={handleChange}
            onAddMonitor={handleAddMonitor}
            onRemoveMonitor={handleRemoveMonitor}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
