"use client";

import type { SourceChipData } from "@/components/chat/SourceChip";
import { InlineCitationBadge } from "@/components/ai-elements/inline-citation";
import { Fragment } from "react";

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
        return (
          <InlineCitationBadge
            key={i}
            index={seg.index}
            title={source.title}
            url={source.url}
            snippet={source.excerpt}
            provider={source.provider}
          />
        );
      })}
    </span>
  );
}
