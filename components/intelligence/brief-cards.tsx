"use client";

import { useState } from "react";
import { BriefCard } from "@/components/intelligence/brief-card";
import { EmptyStateBg } from "@/components/domain/empty-state-bg";
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
      <div className="relative flex flex-col items-center justify-center overflow-hidden rounded-xl py-20 px-4">
        <div
          className="absolute inset-0"
          style={{
            maskImage: "linear-gradient(to right, transparent, black 15%, black 85%, transparent), linear-gradient(to bottom, transparent, black 15%, black 85%, transparent)",
            maskComposite: "intersect",
            WebkitMaskImage: "linear-gradient(to right, transparent, black 15%, black 85%, transparent), linear-gradient(to bottom, transparent, black 15%, black 85%, transparent)",
            WebkitMaskComposite: "source-in",
          }}
        >
          <EmptyStateBg />
        </div>
        <div className="relative z-10 flex flex-col items-center gap-2">
          <p className="text-base font-medium">No briefs yet</p>
          <p className="text-sm text-muted-foreground text-center max-w-sm">
            Morning briefs are generated at 7:45 AM for each analyst. Post-run standups are written after every research session.
          </p>
        </div>
      </div>
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
