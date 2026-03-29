"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { BriefCard } from "@/components/intelligence/brief-card";
import { BriefDetailDialog } from "@/components/intelligence/brief-detail";
import { normalizeIntelBrief } from "@/components/intelligence/brief-types";
import type { UnifiedBrief } from "@/components/intelligence/brief-types";
import type { MorningBrief } from "./types";

// ── Brief Cards Grid ────────────────────────────────────────────────────────
// Used on /intelligence Briefs tab. Takes raw MorningBrief[], normalizes, renders.

interface BriefCardsProps {
  briefs: MorningBrief[];
}

export function BriefCards({ briefs }: BriefCardsProps) {
  const [selected, setSelected] = useState<UnifiedBrief | null>(null);

  if (briefs.length === 0) {
    return (
      <Card className="p-6">
        <div className="text-center space-y-1">
          <p className="text-sm text-muted-foreground">No morning briefs generated today</p>
          <p className="text-xs text-muted-foreground">
            Run the Morning Brief job from the pipeline trigger, or wait for the 7:45 AM cron
          </p>
        </div>
      </Card>
    );
  }

  const unified = briefs.map(normalizeIntelBrief);

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {unified.map((b) => (
          <BriefCard key={b.id} brief={b} onClick={() => setSelected(b)} />
        ))}
      </div>

      <BriefDetailDialog
        brief={selected}
        open={!!selected}
        onOpenChange={(open) => !open && setSelected(null)}
      />
    </>
  );
}
