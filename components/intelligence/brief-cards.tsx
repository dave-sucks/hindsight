"use client";

import { useState } from "react";
import { BriefCard } from "@/components/intelligence/brief-card";
import { FeatureCard, SkeletonLines } from "@/components/domain/feature-showcase";
import { FileText, Brain } from "lucide-react";
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
      <div className="py-8 space-y-4 max-w-md mx-auto">
        <div className="text-center space-y-1">
          <p className="text-sm font-medium">No briefs generated</p>
          <p className="text-xs text-muted-foreground">Run the Morning Brief job or wait for the 7:45 AM cron.</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FeatureCard icon={FileText} title="Morning Briefs" description="Market context, portfolio alerts, watchlist updates, and new opportunities.">
            <SkeletonLines count={3} />
          </FeatureCard>
          <FeatureCard icon={Brain} title="Post-Run Standups" description="Written by GPT-4o after each session — narrative, strategy notes, watch items.">
            <SkeletonLines count={3} />
          </FeatureCard>
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
