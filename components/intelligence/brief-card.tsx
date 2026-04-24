"use client";

import { Card } from "@/components/ui/card";
import { SourceAvatars } from "@/components/ui/source-avatars";
import { PerplexityLogo, FinnhubLogo, FmpLogo } from "@/components/intelligence/icons";
import { relativeTime } from "@/components/intelligence/types";
import type { UnifiedBrief } from "./brief-types";

// ── Brief Card ──────────────────────────────────────────────────────────────
// One card for both brief types. Used on /intelligence and analyst page.

function briefTitle(brief: UnifiedBrief): string {
  if (brief.type === "run") return `${brief.analystName} Daily Portfolio Briefing`;
  return `${brief.analystName} Research & Signals`;
}

function briefMeta(brief: UnifiedBrief): string | null {
  if (brief.type === "run" && brief.runBrief) {
    const snap = (brief.runBrief.portfolioSnapshot as Record<string, unknown>) ?? {};
    const pnl = snap.closedPnl as number | undefined;
    if (pnl != null) return `P&L ${pnl >= 0 ? "+" : ""}$${Math.abs(pnl).toFixed(2)}`;
  }
  return null;
}

export function BriefCard({
  brief,
  onClick,
}: {
  brief: UnifiedBrief;
  onClick: () => void;
}) {
  const title = briefTitle(brief);
  const meta = briefMeta(brief);

  return (
    <Card
      className="p-0 gap-0 cursor-pointer hover:bg-accent/50 transition-colors overflow-hidden shadow-none py-0"
      onClick={onClick}
    >
      {/* Section 1: badges row + title + preview */}
      <div className="p-3 flex flex-col gap-2 min-w-0">
        {/* Row 1: badges/meta left · timestamp right */}
        <div className="flex items-center justify-between gap-2 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            {brief.type === "intel" && brief.signalCount != null && (
              <SourceAvatars
                sources={[
                  { icon: <PerplexityLogo className="h-3 w-3" /> },
                  { icon: <FinnhubLogo className="h-3 w-3" /> },
                  { icon: <FmpLogo className="h-3 w-3" /> },
                ]}
                count={brief.signalCount}
                label={`${brief.signalCount} signals`}
              />
            )}
            {meta && (
              <span className="text-xs font-mono text-muted-foreground tabular-nums">
                {meta}
              </span>
            )}
          </div>
          <span className="text-xs font-mono text-muted-foreground tabular-nums shrink-0">
            {relativeTime(brief.date)}
          </span>
        </div>

        {/* Row 2: title */}
        <h2 className="text-sm font-medium text-foreground leading-tight truncate">
          {title}
        </h2>

        {/* Row 3: preview */}
        <p className="text-sm text-muted-foreground leading-relaxed line-clamp-3">
          {brief.preview}
        </p>
      </div>
    </Card>
  );
}
