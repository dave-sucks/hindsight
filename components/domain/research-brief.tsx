"use client";

/**
 * The research brief on a proposal: the short read, then why it moved, what
 * Wall Street says, and X — every fact dated and cited with SourceCitation.
 * Polls until the brief lands (the build can outlast the email's 30s wait).
 */

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { SourceCitation, type CitationSource } from "@/components/ai-elements/inline-citation";
import {
  actionLine,
  failureLines,
  ratingsLine,
  socialLine,
  targetsLine,
  type BriefSource,
  type ResearchBriefView,
} from "@/lib/research/brief-types";

const POLL_MS = 10_000;
const MAX_POLLS = 18;

function citations(sources: BriefSource[], ids: number[]): CitationSource[] {
  return ids
    .map((id) => sources.find((s) => s.id === id))
    .filter((s): s is BriefSource => !!s && /^https?:\/\//.test(s.url))
    .map((s) => ({ url: s.url, title: s.title ?? undefined }));
}

const shortDate = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

function Fact({ text, date, cite }: { text: string; date: string | null; cite: CitationSource[] }) {
  return (
    <li className="text-sm text-muted-foreground leading-relaxed">
      {text}
      {date ? <span className="tabular-nums"> · {shortDate(date)}</span> : null}{" "}
      <SourceCitation sources={cite} />
    </li>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</p>
      <ul className="space-y-1">{children}</ul>
    </div>
  );
}

export function ResearchBrief({ orderId, initial }: { orderId: string; initial: ResearchBriefView | null }) {
  const [brief, setBrief] = useState<ResearchBriefView | null>(initial);
  const [polls, setPolls] = useState(0);
  const pending = !brief || brief.payload.social?.status === "loading";

  useEffect(() => {
    if (!pending || polls >= MAX_POLLS) return;
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
  }, [orderId, pending, polls]);

  if (!brief) {
    return (
      <p className="text-xs text-muted-foreground">
        {polls >= MAX_POLLS ? "Research brief not ready yet." : <span className="shimmer-text">Gathering research…</span>}
      </p>
    );
  }

  const b = brief.payload;
  const failed = failureLines(b);
  return (
    <div className="space-y-2 border-t pt-2">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Research brief</p>
      {b.synthesis ? <p className="text-sm leading-relaxed">{b.synthesis}</p> : null}
      <Collapsible>
        <CollapsibleTrigger render={<Button variant="link" size="xs" />}>Why it moved, Wall Street, X</CollapsibleTrigger>
        <CollapsibleContent>
          <div className="space-y-3 pt-2">
            <Section title="Why it moved">
              {b.whyItMoved.length === 0 ? (
                <li className="text-sm text-muted-foreground">No company news found for the recent move.</li>
              ) : (
                b.whyItMoved.map((c, i) => <Fact key={i} text={c.text} date={c.date} cite={citations(b.sources, c.sourceIds)} />)
              )}
            </Section>
            <Section title="Wall Street">
              {b.ratings ? (
                <li className="text-sm text-muted-foreground tabular-nums">
                  {ratingsLine(b.ratings)} · Finnhub, {b.ratings.period}
                </li>
              ) : null}
              {b.targets ? (
                <Fact text={`Price targets: ${targetsLine(b.targets)}`} date={b.targets.asOf} cite={citations(b.sources, b.targets.sourceIds)} />
              ) : null}
              {b.analystActions.map((a, i) => (
                <Fact key={i} text={actionLine(a)} date={a.date} cite={citations(b.sources, a.sourceIds)} />
              ))}
              {!b.ratings && !b.targets && b.analystActions.length === 0 ? (
                <li className="text-sm text-muted-foreground">No analyst ratings or targets found.</li>
              ) : null}
            </Section>
            {b.companyNews.length > 0 ? (
              <Section title="Company news">
                {b.companyNews.map((c, i) => <Fact key={i} text={c.text} date={c.date} cite={citations(b.sources, c.sourceIds)} />)}
              </Section>
            ) : null}
            {b.social ? (
              <Section title="On X">
                <li className="text-sm text-muted-foreground">{socialLine(b.social)}</li>
                {b.social.posts.map((p, i) => (
                  <li key={i} className="text-sm text-muted-foreground leading-relaxed">
                    @{p.handle}: {p.excerpt} <SourceCitation sources={[{ url: p.url, title: `@${p.handle} on X` }]} />
                  </li>
                ))}
              </Section>
            ) : null}
          </div>
        </CollapsibleContent>
      </Collapsible>
      {failed.length ? <p className="text-xs text-muted-foreground">{failed.join(" · ")}</p> : null}
    </div>
  );
}
