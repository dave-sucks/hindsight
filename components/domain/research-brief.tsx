"use client";

/**
 * A proposal's note: why it was proposed, then the research paragraph on the
 * company and the stock, as one block of plain prose. Three lines show; a
 * click opens the rest and the sources. Polls until the research lands (the
 * build can outlast the email's 30s wait).
 */

import { useEffect, useState } from "react";
import { SourceCitation } from "@/components/ai-elements/inline-citation";
import { briefLinks, type ResearchBriefView } from "@/lib/research/brief-types";

const POLL_MS = 10_000;
const MAX_POLLS = 18;

export function ProposalNote({ orderId, reason, initial }: { orderId: string; reason: string | null; initial: ResearchBriefView | null }) {
  const [brief, setBrief] = useState<ResearchBriefView | null>(initial);
  const [polls, setPolls] = useState(0);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (brief || polls >= MAX_POLLS) return;
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/research-briefs/${orderId}`, { cache: "no-store" });
        if (r.ok) {
          const body = (await r.json()) as { brief: ResearchBriefView | null };
          if (body.brief) setBrief(body.brief);
        }
      } catch {
        // A missed poll is retried on the next tick.
      }
      setPolls((n) => n + 1);
    }, POLL_MS);
    return () => clearTimeout(t);
  }, [orderId, brief, polls]);

  const research = brief?.payload.synthesis ?? null;
  const paragraphs = [reason?.trim() || null, research].filter((x): x is string => !!x);
  const links = brief ? briefLinks(brief.payload).map((s) => ({ url: s.url, title: s.title ?? undefined })) : [];
  if (paragraphs.length === 0) {
    return polls >= MAX_POLLS ? null : <p className="text-sm text-muted-foreground shimmer-text">Looking into the company…</p>;
  }

  return (
    <div
      className="space-y-2 cursor-pointer text-sm text-muted-foreground leading-relaxed transition-colors hover:text-foreground"
      onClick={() => setOpen((v) => !v)}
      title={open ? "Collapse" : "Expand"}
    >
      {open ? (
        <>
          {paragraphs.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
          {links.length ? <SourceCitation sources={links} /> : null}
        </>
      ) : (
        <p className="line-clamp-3">{paragraphs.join(" ")}</p>
      )}
    </div>
  );
}
