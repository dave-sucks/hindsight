"use client";

/**
 * WritingThesesTable — the thesis-writers this message dispatched, in the
 * same row table ReadThesesTable uses for the theses a run read.
 *
 * It replaced two lines of plain text per ticker:
 *
 *   $IBRX (mint dispatched) — Worker spawned for Catalyst Event PM · child run cmuhp0lu…
 *   Watch progress at /runs/cmuhp0lum000204kx7g01962d. ETA ~3-4 min. Result
 *   lands as a Thesis with researchData + researchSections populated.
 *
 * — a raw run id you had to select and paste, an ETA, and two internal field
 * names. It also never changed: the writer takes three or four minutes and the
 * row said the same thing whether it was reading filings, finished, or dead.
 *
 * Now each row is a stock being written about: logo, ticker, a shimmering
 * "Writing" badge while the child run is going, and the state it reached when
 * it stops. The row is the link — to the child run while it writes, to the
 * thesis once there is one.
 */

import { useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { StockLogo } from "@/components/StockLogo";
import { useRunStatus } from "@/hooks/useRunStatus";
import type { DispatchedWriter } from "@/lib/chat/dispatched-writers";

/** What the row says while the writer works. Cycles so it reads as alive. */
const WORKING_PHASES = ["Researching", "Reading filings", "Writing the thesis"];

function phaseFor(runId: string, startedAt: number): string {
  // Deterministic per row, moves with the clock: no timer, no re-render loop.
  const minutes = Math.floor((Date.now() - startedAt) / 60_000);
  const offset = runId.charCodeAt(runId.length - 1) % WORKING_PHASES.length;
  return WORKING_PHASES[(minutes + offset) % WORKING_PHASES.length];
}

function WritingRow({ writer }: { writer: DispatchedWriter }) {
  const [startedAt] = useState(() => Date.now());
  const run = useRunStatus(writer.childRunId);

  // Until the first poll lands, the writer was just dispatched — it is working.
  const working = run == null || run.polling;
  const failed = run?.status === "FAILED";
  const thesisId = run?.thesisId ?? null;

  const href = thesisId
    ? `/stocks/${writer.ticker}`
    : `/runs/${writer.childRunId}`;

  return (
    <Link
      href={href}
      className="flex items-center gap-1.5 rounded-md p-2 hover:bg-muted/70 transition-colors"
    >
      <StockLogo ticker={writer.ticker} size="sm" />
      <span className="text-sm font-semibold font-brand shrink-0 mr-1">
        {writer.ticker}
      </span>
      <Badge variant="secondary" className="gap-1.5 font-normal">
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full shrink-0",
            working
              ? "bg-amber-500 animate-pulse"
              : failed
                ? "bg-negative"
                : "bg-positive",
          )}
        />
        <span className={cn(working && "shimmer-text")}>
          {working ? "Writing" : failed ? "Failed" : "Written"}
        </span>
      </Badge>
      <span className="flex-1 min-w-0 text-xs text-muted-foreground truncate">
        {working ? (
          <span className="shimmer-text">
            {phaseFor(writer.childRunId, startedAt)} for {writer.analystName}…
          </span>
        ) : failed ? (
          <>The writer stopped before it finished — open the run to see where.</>
        ) : (
          <>{writer.analystName} · open the thesis</>
        )}
      </span>
    </Link>
  );
}

export function WritingThesesTable({ writers }: { writers: DispatchedWriter[] }) {
  if (writers.length === 0) return null;
  return (
    <div className="not-prose w-full">
      <Card className="p-1 gap-1">
        {writers.map((w) => (
          <WritingRow key={w.childRunId} writer={w} />
        ))}
      </Card>
    </div>
  );
}
