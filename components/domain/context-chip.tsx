"use client";

/**
 * ContextChip — one part of what an agent is sent, as a small square badge
 * with a square dot in the part's color (the Framework page's colors,
 * components/docs/framework/swatch.ts, the same a run's Context panel uses).
 * ContextChips draws a row of them: the first few, then "+N", which opens
 * wherever the whole list is. The workflow diagram and the agent docs use it.
 */

import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { SWATCH, type PartId } from "@/components/docs/framework/swatch";
import { cn } from "@/lib/utils";

export function ContextChip({ part, children }: { part: PartId; children: ReactNode }) {
  const sw = SWATCH[part];
  return (
    <Badge variant="outline" shape="square">
      <span className={cn("size-2 shrink-0 rounded-[2px]", sw.className)} style={sw.style} aria-hidden />
      {children}
    </Badge>
  );
}

/** The first `shown` parts, then "+N" for the rest when there is somewhere to see them all. */
export function ContextChips({ parts, shown = parts.length, onMore, moreLabel }: { parts: ReadonlyArray<{ label: string; part: PartId }>; shown?: number; onMore?: () => void; moreLabel?: string }) {
  const rest = parts.length - shown;
  return (
    <span className="flex flex-wrap items-center gap-1">
      {parts.slice(0, shown).map((c) => (
        <ContextChip key={c.label} part={c.part}>
          {c.label}
        </ContextChip>
      ))}
      {rest > 0 && onMore ? (
        <Badge variant="outline" shape="square" render={<button type="button" onClick={onMore} aria-label={moreLabel} title={moreLabel} />}>
          +{rest}
        </Badge>
      ) : null}
    </span>
  );
}
