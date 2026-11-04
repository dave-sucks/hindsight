"use client";

/**
 * A proposal's note: the analyst's reason, three lines, a click for the
 * rest. A run's note lands on its proposal at the end of the run
 * (lib/proposals/auto-writeup.ts); until then the card shows one shimmering
 * line in its place and reads the reason again every few seconds, for up to
 * a quarter of an hour (a morning run's length).
 */

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

const POLL_MS = 8_000;
const MAX_POLLS = 120;

export const WRITING_LABEL = "Writing a summary for this proposal";

export function ProposalNote({ orderId, reason, writing, expanded }: { orderId: string; reason: string | null; writing: boolean; /** When the card owns the click, it says whether the note is open; the note then takes no clicks of its own. */ expanded?: boolean }) {
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
      className={cn("space-y-2 text-xs font-light text-foreground leading-relaxed", expanded === undefined && "cursor-pointer")}
      onClick={expanded === undefined ? () => setOpen((v) => !v) : undefined}
      title={expanded === undefined ? (open ? "Collapse" : "Expand") : undefined}
    >
      {(expanded ?? open) ? paragraphs.map((p, i) => <p key={i}>{p}</p>) : <p className="line-clamp-2">{paragraphs.join(" ")}</p>}
    </div>
  );
}
