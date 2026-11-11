"use client";

/**
 * A proposal's note: the analyst's reason. Where the card owns the click
 * (the trade banner) the note is hidden until the card says it is open —
 * the title row reads "Read reasoning" on hover; on its own it shows two
 * lines and a click for the rest. A run's note lands on its proposal at the end of the run
 * (lib/proposals/auto-writeup.ts); until then the card shows one shimmering
 * line in its place and reads the reason again every few seconds, for up to
 * a quarter of an hour (a morning run's length).
 *
 * Under the note, a sale's card shows the reviewers' notes on it (the stock
 * is off its analyst's list while the sale waits, so this is where they land):
 * read once from the same route.
 */

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { authorWords } from "@/lib/agent/shared-notes";

const POLL_MS = 8_000;
const MAX_POLLS = 120;

export const WRITING_LABEL = "Writing a summary for this proposal";

/** A reviewer's note on this sale (lib/agent/shared-notes.server.ts, saleNotes). */
export interface ReviewerNoteView {
  id: string;
  author: string;
  at: string;
  title: string;
  line: string | null;
}

/** "Market Reviewer, Tue 7:41 AM: Chip export rule widens. NVDA · on the waiting sale · condition 2: …" */
export function reviewerNoteText(n: ReviewerNoteView): string {
  const at = new Date(n.at).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
  return `${authorWords(n.author)}, ${at}: ${n.title}${n.line ? `. ${n.line}` : ""}`;
}

export function ProposalNote({
  orderId,
  reason,
  writing,
  expanded,
  clamp = 2,
  reviewerNotes,
  sale = false,
}: {
  orderId: string;
  reason: string | null;
  writing: boolean;
  /** Given by a caller that has them; for a sale, read once from the route otherwise. */
  reviewerNotes?: ReviewerNoteView[];
  /** A sale or a trim: only its card carries the reviewers' notes. */
  sale?: boolean;
  /** When the card owns the click, it says whether the note is open; the note then takes no clicks of its own. */
  expanded?: boolean;
  /** On its own: how many lines show before the click (the page card asks for five). */
  clamp?: 2 | 4 | 5;
}) {
  const [text, setText] = useState(reason);
  const [busy, setBusy] = useState(writing);
  const [polls, setPolls] = useState(0);
  const [open, setOpen] = useState(false);
  const [reviewer, setReviewer] = useState<ReviewerNoteView[]>(reviewerNotes ?? []);

  // The reviewers' notes on a sale: read once, unless the caller gave them or the write-up's polling brings them.
  useEffect(() => {
    if (!sale || reviewerNotes || writing) return;
    let live = true;
    fetch(`/api/proposals/${orderId}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { reviewerNotes?: ReviewerNoteView[] } | null) => live && body?.reviewerNotes && setReviewer(body.reviewerNotes))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [orderId, reviewerNotes, sale, writing]);

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
          const body = (await r.json()) as { rationale: string | null; writing: boolean; reviewerNotes?: ReviewerNoteView[] };
          setText(body.rationale);
          setBusy(body.writing);
          if (sale && !reviewerNotes && body.reviewerNotes) setReviewer(body.reviewerNotes);
        }
      } catch {
        // A missed read is retried on the next tick.
      }
      setPolls((n) => n + 1);
    }, POLL_MS);
    return () => clearTimeout(t);
  }, [orderId, busy, polls, sale, reviewerNotes]);

  if (busy && polls < MAX_POLLS) return <p className="text-sm shimmer-text">{WRITING_LABEL}</p>;
  // The card says it is closed: nothing, not a clamp.
  if (expanded === false) return null;

  const paragraphs = (text ?? "").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const notes = reviewer.length > 0 ? (
    <div className="space-y-1">
      {reviewer.map((n) => (
        <p key={n.id} className="text-xs text-muted-foreground leading-relaxed">{reviewerNoteText(n)}</p>
      ))}
    </div>
  ) : null;
  if (paragraphs.length === 0) return notes;
  return (
    <>
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
      {(expanded ?? open) ? paragraphs.map((p, i) => <p key={i}>{p}</p>) : <p className={clamp === 5 ? "line-clamp-5" : clamp === 4 ? "line-clamp-4" : "line-clamp-2"}>{paragraphs.join(" ")}</p>}
    </div>
    {notes}
    </>
  );
}
