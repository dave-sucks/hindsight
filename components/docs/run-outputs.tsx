"use client";

/**
 * What a run leaves on the stock it read: four outputs, each with where it
 * lands. The call itself (hold, buy, trim, sell) comes out as one or more of
 * them. From the tools: update_thesis writes the note and the edits, and a
 * morning or trigger run can't finish without a note on each stock it
 * answers (complete_run's close-out); place_trade, manage_position and
 * close_position write a proposal, or trade at once with approval off
 * (lib/proposals/maybe-await-approval.ts), and the run's note becomes its
 * reason (putNotesOnRunProposals); an approved buy or sale flips the thesis
 * (lib/proposals/thesis-flips.ts); dispatch_thesis_research sends the stock
 * to the Writer. The workflow and the trigger diagram draw this same stack.
 */

import { ArrowRight, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Eyebrow, Mono } from "./primitives";

export type OutputId = "note" | "edit" | "proposal" | "research";

const OUTPUTS: ReadonlyArray<{ id: OutputId; what: string; when: string; text: string; to: string }> = [
  { id: "note", what: "Note", when: "always", text: "The analyst's own words with a verdict: stronger, unchanged, weaker or broken. A hold is a note.", to: "The stock's Activity, which the next run reads first" },
  { id: "edit", what: "Edit", when: "sometimes", text: "A level moved, or a trigger added or removed. Only you lower a floor.", to: "The stock's Triggers, and a line in its Activity" },
  { id: "proposal", what: "Proposal", when: "sometimes", text: "A buy, add, trim or sale, with the run's note as its reason.", to: "The position: Watching to Holding, or sold" },
  { id: "research", what: "Research", when: "sometimes", text: "The research is too old to act on.", to: "The Writer, before anything else" },
];

/** The stack, under its caption. `at` hands each card's element to a diagram that draws wires to it. */
export function RunOutputs({ at, className }: { at?: (id: OutputId) => (el: HTMLElement | null) => void; className?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-2", className)}>
      <div className="flex flex-col gap-1">
        <Eyebrow>What a run leaves</Eyebrow>
        <p className="text-xs text-muted-foreground">One or more of these. The call itself, hold, buy, trim or sell, comes out as one of them.</p>
      </div>
      {OUTPUTS.map((o) => (
        <div key={o.id} ref={at?.(o.id)} className={cn("flex flex-col gap-1 rounded-xl border bg-background p-2.5 shadow-sm", o.id === "research" && "border-dashed")}>
          <div className="flex items-baseline justify-between gap-3">
            <Mono className="text-xs uppercase tracking-wide text-foreground">{o.what}</Mono>
            <span className="text-xs text-muted-foreground">{o.when}</span>
          </div>
          <p className="text-xs leading-snug text-muted-foreground">{o.text}</p>
          {/* Between a proposal and its trade stands you. */}
          {o.id === "proposal" ? (
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <ArrowRight className="size-3 shrink-0" />
              <Badge variant="secondary">
                <UserRound />
                You
              </Badge>
              approve or decline
              <ArrowRight className="size-3 shrink-0" />
              <Mono className="uppercase tracking-wide text-foreground">Trade</Mono>
            </div>
          ) : null}
          <p className="flex items-start gap-1.5 text-xs text-foreground">
            <ArrowRight className="mt-0.5 size-3 shrink-0" />
            {o.to}
          </p>
          {o.id === "proposal" ? <p className="pl-[1.125rem] text-xs text-muted-foreground">With approval off, it trades at once.</p> : null}
        </div>
      ))}
      <p className="text-xs text-muted-foreground">Chat is the exception: your word is the reason, and it can trade at once.</p>
    </div>
  );
}
