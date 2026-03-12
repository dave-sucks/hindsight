"use client";

import type { SourceChipData } from "@/components/chat/SourceChip";
import { Badge } from "@/components/ui/badge";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { cn } from "@/lib/utils";
import { ExternalLink } from "lucide-react";
import { Fragment } from "react";

// ─── Provider colors ─────────────────────────────────────────────────────────

const PROVIDER_COLORS: Record<string, string> = {
  finnhub: "bg-blue-500",
  reddit: "bg-orange-500",
  options: "bg-purple-500",
  earnings: "bg-amber-500",
  technical: "bg-cyan-500",
  stocktwits: "bg-green-500",
  fmp: "bg-indigo-500",
};

function providerDotColor(provider: string): string {
  const key = provider.toLowerCase().replace(/[^a-z]/g, "");
  for (const [k, v] of Object.entries(PROVIDER_COLORS)) {
    if (key.includes(k)) return v;
  }
  return "bg-muted-foreground/50";
}

// ─── Parser ──────────────────────────────────────────────────────────────────

export type Segment =
  | { type: "text"; value: string }
  | { type: "citation"; index: number };

export function parseMarkers(text: string): Segment[] {
  const pattern = /\[(\d+)\]/g;
  const segments: Segment[] = [];
  let lastEnd = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastEnd) {
      segments.push({ type: "text", value: text.slice(lastEnd, match.index) });
    }
    segments.push({ type: "citation", index: parseInt(match[1], 10) });
    lastEnd = match.index + match[0].length;
  }

  if (lastEnd < text.length) {
    segments.push({ type: "text", value: text.slice(lastEnd) });
  }

  return segments;
}

// ─── Citation badge with hover popover ───────────────────────────────────────

export function CitationBadge({
  index,
  source,
}: {
  index: number;
  source: SourceChipData;
}) {
  const dotColor = providerDotColor(source.provider);

  return (
    <HoverCard openDelay={100}>
      <HoverCardTrigger
        render={
          <Badge
            variant="secondary"
            className="cursor-pointer rounded-full px-1.5 py-0 text-[10px] font-medium tabular-nums align-super ml-0.5"
          />
        }
      >
        {index}
      </HoverCardTrigger>
      <HoverCardContent side="top" className="w-72 space-y-2">
        <div className="flex items-center gap-2">
          <span className={cn("h-2 w-2 rounded-full shrink-0", dotColor)} />
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            {source.provider}
          </span>
        </div>
        <p className="text-sm font-medium">{source.title}</p>
        {source.excerpt && (
          <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3">
            {source.excerpt}
          </p>
        )}
        {source.url && (
          <a
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            <ExternalLink className="h-3 w-3" />
            View source
          </a>
        )}
      </HoverCardContent>
    </HoverCard>
  );
}

// ─── CitedText ───────────────────────────────────────────────────────────────
// Renders text with inline [N] citation markers as hover popovers.
// Falls back to plain text when no markers are present.

export function CitedText({
  text,
  sources = [],
  className,
}: {
  text: string;
  sources?: SourceChipData[];
  className?: string;
}) {
  const segments = parseMarkers(text);

  // No citations found — render plain text
  if (segments.length === 1 && segments[0].type === "text") {
    return <span className={className}>{text}</span>;
  }

  return (
    <span className={className}>
      {segments.map((seg, i) => {
        if (seg.type === "text") {
          return <Fragment key={i}>{seg.value}</Fragment>;
        }
        const sourceIdx = seg.index - 1; // 1-based → 0-based
        const source = sources[sourceIdx];
        if (!source) {
          return (
            <sup key={i} className="text-muted-foreground">
              [{seg.index}]
            </sup>
          );
        }
        return <CitationBadge key={i} index={seg.index} source={source} />;
      })}
    </span>
  );
}
