"use client";

/**
 * PlaybookRenderer — for read_knowledge_library when it loads a
 * specific strategy archetype entry.
 *
 * The old `generic` UI collapsed playbooks into a one-line summary,
 * giving the user no idea what the agent actually pulled in. This
 * renders the full spec: tagline, edge, direction + hold badges,
 * signal types, research sources, risk profile, and a collapsible
 * peek at the prompt skeleton the agent will use when rewriting
 * the analystPrompt.
 *
 * Used in the Builder / Editor flow so the user can read the
 * playbook before the agent proposes a config change.
 */

import type { ToolResult } from "@/lib/agent/tool-result";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronRight, BookOpen, AlertTriangle } from "lucide-react";

interface Props {
  result: Extract<ToolResult, { ok: true }>;
  loading: boolean;
}

interface PlaybookData {
  topic?: string;
  mode?: string;
  found?: boolean;
  entry?: {
    id: string;
    name: string;
    tagline?: string;
    edge?: string;
    directionBias?: string;
    holdDurations?: string[];
    primarySignals?: string[];
    keySources?: string[];
    risk?: {
      minConfidence?: [number, number];
      positionSizeBand?: [number, number];
      maxOpenPositions?: number;
    };
    universeHints?: {
      sectors?: string[];
      industries?: string[];
      themes?: string[];
    };
    promptSkeleton?: string;
    watchOutFor?: string[];
  };
}

// Turn SCREAMING_SNAKE_CASE into "Title Case Words" for display.
function humanize(id: string): string {
  return id
    .toLowerCase()
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function formatRange(range?: [number, number], fmt?: (n: number) => string): string | null {
  if (!range || range.length !== 2) return null;
  const [lo, hi] = range;
  const f = fmt ?? ((n: number) => `${n}`);
  return lo === hi ? f(lo) : `${f(lo)}–${f(hi)}`;
}

const DIRECTION_LABEL: Record<string, string> = {
  LONG: "Long-biased",
  SHORT: "Short-biased",
  BOTH: "Long or short",
};

export function PlaybookRenderer({ result }: Props) {
  const data = (result.data ?? {}) as PlaybookData;
  const entry = data.entry;

  // Fallback — load failed or unknown entry
  if (!data.found || !entry) {
    return (
      <Card className="p-4 text-sm text-muted-foreground">
        {result.summary}
      </Card>
    );
  }

  const directionText = entry.directionBias
    ? (DIRECTION_LABEL[entry.directionBias] ?? entry.directionBias)
    : null;

  const confidence = formatRange(entry.risk?.minConfidence, (n) => `${n}%`);
  const size = formatRange(entry.risk?.positionSizeBand, (n) =>
    `$${n.toLocaleString("en-US")}`,
  );

  return (
    <Card className="p-6 space-y-4">
      {/* Header: icon + name + tagline */}
      <div className="flex items-start gap-3">
        <div className="mt-0.5 shrink-0 size-8 rounded-md bg-muted flex items-center justify-center">
          <BookOpen className="size-4 text-muted-foreground" />
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Strategy Playbook
          </div>
          <h3 className="text-lg font-medium">{entry.name}</h3>
          {entry.tagline && (
            <p className="text-sm text-muted-foreground">{entry.tagline}</p>
          )}
        </div>
      </div>

      {/* Direction + hold duration badges */}
      {(directionText || (entry.holdDurations && entry.holdDurations.length > 0)) && (
        <div className="flex flex-wrap gap-1.5">
          {directionText && <Badge variant="secondary">{directionText}</Badge>}
          {entry.holdDurations?.map((d) => (
            <Badge key={d} variant="secondary">
              {humanize(d)}
            </Badge>
          ))}
        </div>
      )}

      {/* Why it works */}
      {entry.edge && (
        <section className="space-y-1">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Why the edge exists
          </div>
          <p className="text-sm leading-relaxed">{entry.edge}</p>
        </section>
      )}

      {/* Two-column: signals + sources */}
      {((entry.primarySignals && entry.primarySignals.length > 0) ||
        (entry.keySources && entry.keySources.length > 0)) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {entry.primarySignals && entry.primarySignals.length > 0 && (
            <section className="space-y-1.5">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Signals that fire this
              </div>
              <div className="flex flex-wrap gap-1">
                {entry.primarySignals.map((s) => (
                  <Badge key={s} variant="outline">
                    {humanize(s)}
                  </Badge>
                ))}
              </div>
            </section>
          )}
          {entry.keySources && entry.keySources.length > 0 && (
            <section className="space-y-1.5">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Research sources it leans on
              </div>
              <div className="flex flex-wrap gap-1">
                {entry.keySources.map((s) => (
                  <Badge key={s} variant="outline">
                    {humanize(s)}
                  </Badge>
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {/* Risk profile */}
      {(confidence || size || entry.risk?.maxOpenPositions) && (
        <section className="space-y-1.5">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Suggested risk profile
          </div>
          <div className="flex flex-wrap gap-1.5">
            {confidence && (
              <Badge variant="secondary">Confidence {confidence}</Badge>
            )}
            {size && <Badge variant="secondary">Size {size}</Badge>}
            {entry.risk?.maxOpenPositions != null && (
              <Badge variant="secondary">
                Max {entry.risk.maxOpenPositions} open
              </Badge>
            )}
          </div>
        </section>
      )}

      {/* Prompt skeleton — collapsible peek */}
      {entry.promptSkeleton && (
        <Collapsible>
          <CollapsibleTrigger className="group flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground">
            <ChevronRight className="size-3 transition-transform group-data-[state=open]:rotate-90" />
            Prompt skeleton preview
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-2">
            <pre className="text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap font-sans">
              {entry.promptSkeleton}
            </pre>
          </CollapsibleContent>
        </Collapsible>
      )}

      {/* Watch out for — pitfalls */}
      {entry.watchOutFor && entry.watchOutFor.length > 0 && (
        <Collapsible>
          <CollapsibleTrigger className="group flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground">
            <ChevronRight className="size-3 transition-transform group-data-[state=open]:rotate-90" />
            <AlertTriangle className="size-3" />
            Watch out for
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-2">
            <ul className="space-y-1 text-sm text-muted-foreground list-disc pl-5">
              {entry.watchOutFor.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </CollapsibleContent>
        </Collapsible>
      )}
    </Card>
  );
}
