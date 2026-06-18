"use client";

/**
 * PortfolioDigestCard — renders the Daily Portfolio Digest narrative
 * (Feature A; see docs/plans/PORTFOLIO_DIGEST.md).
 *
 * Header = the digest's trading date + an "after close" tag. Body = the
 * markdown narrative rendered through DigestMarkdown, which turns the inline
 * reference tokens ([MU](thesis:…), [Analyst](analyst:…), [run](run:…)) into
 * the prose ticker chip / underlined links. Read-only, additive.
 */

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DigestMarkdown } from "@/components/ui/ticker-markdown";
import type { LatestDigest } from "@/lib/actions/digest.actions";

function formatDigestDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function PortfolioDigestCard({
  digest,
}: {
  digest: LatestDigest | null;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg font-medium">
          Daily Portfolio Digest
        </CardTitle>
        <CardDescription>
          {digest
            ? `${formatDigestDate(digest.date)} · after close`
            : "Generated after close"}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {digest ? (
          <DigestMarkdown>{digest.narrative}</DigestMarkdown>
        ) : (
          <p className="text-sm text-muted-foreground">
            No digest yet — generates after close.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
