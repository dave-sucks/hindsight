"use client";

import { BriefingCard } from "./BriefingCard";
import { FileText } from "lucide-react";
import type { AnalystBriefingItem } from "@/lib/actions/analyst.actions";

export function BriefingFeed({
  briefings,
}: {
  briefings: AnalystBriefingItem[];
}) {
  if (briefings.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 space-y-3">
        <FileText className="h-10 w-10 text-muted-foreground/30" />
        <p className="text-sm text-muted-foreground">No briefings yet</p>
        <p className="text-xs text-muted-foreground/70 max-w-sm text-center">
          Briefings are generated after each research run completes. Run your
          first research session to see your analyst&apos;s evolving analysis.
        </p>
      </div>
    );
  }

  return (
    <div>
      {briefings.map((briefing) => (
        <BriefingCard key={briefing.id} briefing={briefing} />
      ))}
    </div>
  );
}
