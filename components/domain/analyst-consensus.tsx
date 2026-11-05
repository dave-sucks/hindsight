"use client";

/**
 * The Street, in two cards shared by the thesis sheet, the trade page and
 * the stock page (the owner's design, 2026-11-04, cleaned up 11-05):
 *
 *   • Analyst ratings — the verdict as a plain badge (Strong Buy / Buy /
 *     Hold / Sell), one filled bar of how the covering firms split (red,
 *     gray, green, sized to the counts; filled so it never reads as a
 *     price line), and the three counts under it: bearish left, neutral
 *     centre, bullish right.
 *
 *   • Analyst targets — the 12-month targets on a line of plain ticks with
 *     one spare tick past each end, running from the lowest of the Street's
 *     low, the price and our entry to the highest of them: Low (red) and
 *     High (green) as tall lines, the Average as a tall line, our Entry as a
 *     hollow white dot when we hold the stock, and the Current price as a
 *     filled white dot that pulses, each where it really is; the ticks
 *     between Entry and Current are tinted faint green when up and faint red
 *     when down. Every line and both dots name their price on hover; under
 *     the bar Low, Avg and High are a dot and muted words like the ratings
 *     key; Entry sits in the header (with its hollow dot) when we hold the
 *     stock, the current price is the filled dot and its hover. Under a
 *     divider that runs the card's full width, one sentence: when the row
 *     was pulled, then how many analysts raised (green chevron) and lowered
 *     (red chevron) their next-quarter EPS estimate in the last four weeks.
 *     The EPS consensus itself is on the Earnings card. The old "Price
 *     targets" card drew our own plan here; the plan is the triggers and
 *     the chart's lines, and the word "target" means what the Street expects.
 *
 * Data comes from getAnalystCoverageData (lib/actions/analyst-coverage) —
 * server-fetched and passed in; the cards never fetch.
 */

import { SectionLabel } from "@/components/domain/section-label";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { TickBar, type Tick } from "@/components/ui/gauge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { CitationSource } from "@/components/ai-elements/inline-citation";
import type { AnalystCoverageData } from "@/lib/actions/analyst-coverage";
import { cn } from "@/lib/utils";
import { HugeiconsIcon } from "@hugeicons/react";
import { ChevronDownIcon, ChevronUpIcon } from "@hugeicons/core-free-icons";
import { Separator } from "@/components/ui/separator";
import type { ResearchCitation } from "@/lib/types/thesis-sheet";

/**
 * A thesis's research citations as sources for the one SourceCitation pill.
 * A citation with neither a URL nor a domain ("Current", "Price levels" — the
 * writer naming our own price data) points nowhere a reader can go, so it's
 * dropped rather than drawn as a badge.
 */
export function researchCitationSources(
  citations: ResearchCitation[] | null | undefined,
): CitationSource[] {
  const out: CitationSource[] = [];
  const seen = new Set<string>();
  for (const c of citations ?? []) {
    let url: string | null = null;
    for (const raw of [c.url, c.domain]) {
      if (!raw) continue;
      try {
        url = new URL(raw.includes("://") ? raw : `https://${raw}`).toString();
        break;
      } catch {
        // not a URL — try the next field
      }
    }
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push({ url, title: c.title, provider: c.domain });
  }
  return out;
}

type Coverage = AnalystCoverageData | null;

function consensusOf(coverage: Coverage) {
  if (!coverage?.consensus) return null;
  const { buy, hold, sell } = coverage.consensus;
  return { buy, hold, sell, total: buy + hold + sell };
}

/** Both cards, in order. `entry` is our fill price when we hold the stock, drawn on the targets line. */
export function AnalystCards({ coverage, currentPrice, entry = null }: { coverage: Coverage; currentPrice: number | null; entry?: number | null }) {
  return (
    <>
      <AnalystRatingsCard coverage={coverage} currentPrice={currentPrice} />
      <AnalystTargetsCard coverage={coverage} currentPrice={currentPrice} entry={entry} />
    </>
  );
}

export function AnalystRatingsCard({ coverage, className }: { coverage: Coverage; currentPrice?: number | null; className?: string }) {
  const consensus = consensusOf(coverage);
  if (!consensus || consensus.total === 0) return null;
  return (
    <Card className={className ?? "bg-muted/40 p-3 gap-4"}>
      <SectionLabel action={<AnalystVerdictBadge consensus={consensus} />}>Analyst ratings</SectionLabel>
      <ConsensusDistributionRow consensus={consensus} />
    </Card>
  );
}

/** The bar's columns: one spare tick past each end, Low and High on the first and last tick inside them. */
const COUNT = 60;
const EDGE_PAD = 1;
/** The centre of tick column `i`, as a % of the bar's width — the same column maths as the ticks, so a marker can't drift. */
const pctOf = (i: number) => ((i + 0.5) / COUNT) * 100;
const money = (n: number) => `$${n.toFixed(2)}`;

/** A tall line on the bar that names its price on hover. */
function PriceLine({ pct, color, label }: { pct: number; color: string; label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            aria-label={label}
            className={cn("absolute top-1/2 h-[22px] w-0.5 -translate-x-1/2 -translate-y-1/2 cursor-help rounded-full", color)}
            style={{ left: `${pct}%` }}
          />
        }
      />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function AnalystTargetsCard({
  coverage,
  currentPrice,
  entry = null,
  className,
}: {
  coverage: Coverage;
  currentPrice: number | null;
  /** Our fill price while we hold the stock; a blue line on the bar. */
  entry?: number | null;
  className?: string;
}) {
  const t = coverage?.priceTargets ?? null;
  if (!t) return null;
  // The bar runs from the lowest of the Street's low, the price and our entry to the highest of the Street's high,
  // the price and our entry, so every marker sits where it really is: a stock under every target shows how far under.
  const points = [t.low, t.average, t.high, currentPrice, entry].filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const lo = Math.min(...points);
  const hi = Math.max(...points);
  const span = hi - lo || t.average * 0.1 || 1;
  const usable = COUNT - EDGE_PAD * 2 - 1;
  const idxFor = (p: number) => Math.min(COUNT - 1, Math.max(0, Math.round(EDGE_PAD + ((p - lo) / span) * usable)));
  // The run from where we bought to where it is: a faint green between the two when up, faint red when down.
  const entryIdx = entry != null ? idxFor(entry) : null;
  const currentIdx = currentPrice != null ? idxFor(currentPrice) : null;
  const run = entryIdx != null && currentIdx != null && entryIdx !== currentIdx ? { lo: Math.min(entryIdx, currentIdx), hi: Math.max(entryIdx, currentIdx), color: currentPrice! >= entry! ? "bg-positive/40" : "bg-negative/40" } : null;
  const ticks: Tick[] = Array.from({ length: COUNT }, (_, i) => ({ color: run && i > run.lo && i < run.hi ? run.color : "bg-muted-foreground/25" }));
  const asOf = new Date(`${t.asOf}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const up = coverage?.eps?.up ?? null;
  const down = coverage?.eps?.down ?? null;
  return (
    <Card className={className ?? "bg-muted/40 p-3 gap-4"}>
      <SectionLabel
        action={
          entry != null ? (
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
              <span className="size-1.5 rounded-full border border-foreground" />
              Entry {money(entry)}
            </span>
          ) : null
        }
      >
        Analyst targets
      </SectionLabel>
      <div className="space-y-3">
        <div className="relative py-1">
          <TickBar ticks={ticks} />
          {t.low != null ? <PriceLine pct={pctOf(idxFor(t.low))} color="bg-negative" label={`Low ${money(t.low)}`} /> : null}
          <PriceLine pct={pctOf(idxFor(t.average))} color="bg-foreground" label={`Average ${money(t.average)}`} />
          {t.high != null ? <PriceLine pct={pctOf(idxFor(t.high))} color="bg-positive" label={`High ${money(t.high)}`} /> : null}
          {entry != null ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <span
                    aria-label={`Entry ${money(entry)}`}
                    className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 cursor-help rounded-full border-2 border-foreground bg-background"
                    style={{ left: `${pctOf(idxFor(entry))}%` }}
                  />
                }
              />
              <TooltipContent>Entry {money(entry)}</TooltipContent>
            </Tooltip>
          ) : null}
          {currentPrice != null ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <span
                    aria-label={`Current ${money(currentPrice)}`}
                    className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 cursor-help rounded-full"
                    style={{ left: `${pctOf(idxFor(currentPrice))}%` }}
                  >
                    <span aria-hidden className="absolute inset-0 animate-ping rounded-full bg-foreground/60" />
                    <span aria-hidden className="absolute inset-0 rounded-full bg-foreground ring-2 ring-background" />
                  </span>
                }
              />
              <TooltipContent>Current {money(currentPrice)}</TooltipContent>
            </Tooltip>
          ) : null}
        </div>
        {/* The same key as the ratings card: a coloured dot, muted words; Low left, the Average centre, High right. */}
        <div className="flex items-center justify-between text-xs text-muted-foreground tabular-nums">
          <span className="inline-flex items-center gap-1.5">
            {t.low != null ? <><span className="size-1.5 rounded-full bg-negative" />Low {money(t.low)}</> : null}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-foreground" />
            Avg {money(t.average)}
          </span>
          <span className="inline-flex items-center gap-1.5">
            {t.high != null ? <><span className="size-1.5 rounded-full bg-positive" />High {money(t.high)}</> : null}
          </span>
        </div>
      </div>
      {/* A divider the full width of the card, then one sentence: when the row was pulled, and the revisions. */}
      <div className="-mx-3">
        <Separator />
      </div>
      <p className="text-xs text-muted-foreground tabular-nums">
        Updated {asOf}.
        {/* The movement clause never breaks inside itself: one line when the card is wide, a second line whole when it is narrow. */}
        {up != null || down != null ? (
          <>
            {" "}
            <span className="whitespace-nowrap">
              Recent movement:{" "}
              {up != null ? (
                <span className="inline-flex items-center gap-0.5">
                  <HugeiconsIcon icon={ChevronUpIcon} className="size-3.5 text-positive" strokeWidth={2.5} />
                  {up} up
                </span>
              ) : null}
              {up != null && down != null ? ", " : ""}
              {down != null ? (
                <span className="inline-flex items-center gap-0.5">
                  <HugeiconsIcon icon={ChevronDownIcon} className="size-3.5 text-negative" strokeWidth={2.5} />
                  {down} down
                </span>
              ) : null}
              .
            </span>
          </>
        ) : null}
      </p>
    </Card>
  );
}

/** The verdict, as a plain badge: the word only. */
function AnalystVerdictBadge({ consensus }: { consensus: { buy: number; hold: number; sell: number; total: number } }) {
  const { buy, total } = consensus;
  const buyPct = total > 0 ? buy / total : 0;
  const verdict =
    buyPct >= 0.7
      ? { label: "Strong Buy", variant: "positive" as const }
      : buyPct >= 0.5
        ? { label: "Buy", variant: "positive" as const }
        : buyPct >= 0.3
          ? { label: "Hold", variant: "secondary" as const }
          : { label: "Sell", variant: "negative" as const };
  return <Badge variant={verdict.variant}>{verdict.label}</Badge>;
}



/**
 * The rating split as one filled bar, thinner than the tick bar, in three
 * solid parts sized to the counts (red, gray, green, a small gap between; a
 * count of zero still shows as a sliver), then
 * the counts: bearish left, neutral centre, bullish right. Filled, not
 * ticks, so it reads as a share of the firms and not as a price line like
 * the targets card under it.
 */
function ConsensusDistributionRow({ consensus }: { consensus: { buy: number; hold: number; sell: number; total: number } }) {
  const { buy, hold, sell, total } = consensus;
  const parts = [
    { n: sell, color: "bg-negative", label: "Bearish" },
    { n: hold, color: "bg-muted-foreground", label: "Neutral" },
    { n: buy, color: "bg-positive", label: "Bullish" },
  ];
  return (
    <div className="space-y-3">
      {/* A part with no firms still shows as a sliver, so every colour on the key has its place on the bar. */}
      <div className="flex h-2.5 w-full gap-1 overflow-hidden rounded-full" role="img" aria-label={`${sell} bearish, ${hold} neutral, ${buy} bullish of ${total}`}>
        {parts.map((p) => (
          <span key={p.label} className={cn("h-full min-w-1.5 rounded-sm", p.color)} style={{ flexGrow: p.n, flexBasis: 0 }} />
        ))}
      </div>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-negative" />
          {sell} Bearish
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-muted-foreground" />
          {hold} Neutral
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-positive" />
          {buy} Bullish
        </span>
      </div>
    </div>
  );
}
