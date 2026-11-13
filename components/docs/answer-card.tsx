"use client";

/**
 * The answer: what every run leaves on the stock it read, as the code has it.
 * A morning or trigger run can't finish without a line on each stock it
 * answers (complete_run's close-out), so the note is always there; its trade
 * tools take no reason, and the note becomes the proposal's reason
 * (putNotesOnRunProposals, lib/proposals/auto-writeup.ts). The workflow and
 * the trigger diagram draw this same card.
 */

import { cn } from "@/lib/utils";
import { Mono } from "./primitives";

const OUT: ReadonlyArray<{ what: string; when: string; text: string }> = [
  { what: "Note", when: "always", text: "The analyst's own words with a verdict: stronger, unchanged, weaker or broken. A hold is a note." },
  { what: "Plan change", when: "sometimes", text: "A level moved, or a trigger added or removed. Only you lower a floor." },
  { what: "Trade", when: "sometimes", text: "A buy, add, trim or sale. With approval on, it's a proposal that waits for you, and the run's note becomes its reason." },
  { what: "Fresh research", when: "sometimes", text: "The research is too old to act on, so the stock goes back to the Writer." },
];

export function AnswerCard({ ref, className }: { ref?: (el: HTMLElement | null) => void; className?: string }) {
  return (
    <div ref={ref} className={cn("flex min-w-0 flex-col rounded-xl border bg-background p-4 shadow-sm", className)}>
      <p className="text-sm font-medium text-foreground">The answer</p>
      <p className="pb-3 text-xs text-muted-foreground">What every run leaves on the stock it read.</p>
      {OUT.map((o) => (
        <div key={o.what} className="flex flex-col gap-0.5 border-t py-2.5">
          <div className="flex items-baseline justify-between gap-3">
            <Mono className="text-xs uppercase tracking-wide text-foreground">{o.what}</Mono>
            <span className="text-xs text-muted-foreground">{o.when}</span>
          </div>
          <p className="text-xs leading-snug text-muted-foreground">{o.text}</p>
        </div>
      ))}
      <p className="border-t pt-2.5 text-xs text-foreground">The note is the decision. A plan change, a trade or new research rides on it.</p>
      <p className="pt-1.5 text-xs text-muted-foreground">Chat is the exception: your word is the reason, and it can trade at once.</p>
    </div>
  );
}
