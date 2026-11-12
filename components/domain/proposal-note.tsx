"use client";

/**
 * A proposal's note: the analyst's reason, its first lines and a click for
 * the rest. Where the card owns the click (the trade banner) the card says
 * whether the note is open; on its own the note takes the click. A run's
 * note lands on its proposal at the end of the run
 * (lib/proposals/auto-writeup.ts); until then the card shows one shimmering
 * line in its place and reads the reason again every few seconds, for up to
 * a quarter of an hour (a morning run's length).
 */

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

const POLL_MS = 8_000;
const MAX_POLLS = 120;

const CLAMP = { 1: "line-clamp-1", 2: "line-clamp-2", 4: "line-clamp-4", 5: "line-clamp-5" } as const;

export const WRITING_LABEL = "Writing a summary for this proposal";

export function ProposalNote({
  orderId,
  reason,
  writing,
  expanded,
  clamp = 2,
}: {
  orderId: string;
  reason: string | null;
  writing: boolean;
  /** When the card owns the click, it says whether the note is open; the note then takes no clicks of its own. */
  expanded?: boolean;
  /** How many lines show while closed (the banner asks for one, the page card for five). */
  clamp?: 1 | 2 | 4 | 5;
}) {
  const [text, setText] = useState(reason);
  const [busy, setBusy] = useState(writing);
  const [polls, setPolls] = useState(0);
  const [open, setOpen] = useState(false);

  // A refreshed sheet hands a newer reason (or that the write-up is done): take it.
  useEffect(() => setText(reason), [reason]);
  useEffect(() => {
    setBusy(writing);
    setPolls(0);
  }, [writing]);

  useEffect(() => {
    if (!busy || polls >= MAX_POLLS) return;
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/proposals/${orderId}`, { cache: "no-store" });
        if (r.ok) {
          const body = (await r.json()) as { rationale: string | null; writing: boolean };
          setText(body.rationale);
          setBusy(body.writing);
        }
      } catch {
        // A missed read is retried on the next tick.
      }
      setPolls((n) => n + 1);
    }, POLL_MS);
    return () => clearTimeout(t);
  }, [orderId, busy, polls]);

  if (busy && polls < MAX_POLLS) return <p className="text-sm shimmer-text">{WRITING_LABEL}</p>;
  const paragraphs = (text ?? "").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  if (paragraphs.length === 0) return null;
  return (
    <div
      className={cn("space-y-2 text-sm font-light text-foreground leading-relaxed", expanded === undefined && "cursor-pointer")}
      onClick={
        expanded === undefined
          ? (e) => {
              e.stopPropagation();
              setOpen((v) => !v);
            }
          : undefined
      }
      title={expanded === undefined ? (open ? "Collapse" : "Expand") : undefined}
    >
      {(expanded ?? open) ? paragraphs.map((p, i) => <p key={i}>{p}</p>) : <p className={CLAMP[clamp]}>{paragraphs.join(" ")}</p>}
    </div>
  );
}
