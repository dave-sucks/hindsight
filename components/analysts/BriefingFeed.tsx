"use client";

import { useState } from "react";
import { BriefingCard } from "./BriefingCard";
import { FileText } from "lucide-react";
import type { AnalystBriefingItem } from "@/lib/actions/analyst.actions";

export function BriefingFeed({
  briefings,
}: {
  briefings: AnalystBriefingItem[];
}) {
  const [expandedId, setExpandedId] = useState<string | null>(
    briefings[0]?.id ?? null
  );

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
    <div className="space-y-4">
      {briefings.map((briefing) => (
        <div
          key={briefing.id}
          className="cursor-pointer"
          onClick={() =>
            setExpandedId(expandedId === briefing.id ? null : briefing.id)
          }
        >
          <BriefingCard
            briefing={briefing}
            expanded={expandedId === briefing.id}
          />
        </div>
      ))}
    </div>
  );
}
