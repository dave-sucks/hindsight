"use client";

/**
 * The Street, in two cards shared by the thesis sheet, the trade page and
 * the stock page (the owner's design, 2026-11-04, cleaned up 11-05):
 *
 *   • Analyst ratings — the verdict as a plain badge (Strong Buy / Buy /
 *     Hold / Sell), one 60-tick bar of how the covering firms split, every
 *     tick the same height and a solid colour, and the three counts under
 *     it: bearish left, neutral centre, bullish right.
 *
 *   • Analyst targets — the 12-month targets on a line of plain ticks with
 *     one spare tick past each end: Low (red) and High (green) as tall lines
 *     at the ends, the Average as a tall line, our Entry as a blue line when
 *     we hold the stock, and the Current price as a pulsing dot. Every line
 *     and the dot name their price on hover; under the bar only Low and
 *     High are written, the Average sits in the header. Then the date of
 *     the targets and the EPS consensus with its revisions. The old "Price
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
import { epsWords } from "@/lib/market-data/street-consensus";
import { cn } from "@/lib/utils";
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
    <Card className={className ?? "bg-muted/40 p-2 gap-3"}>
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
  const low = t.low ?? t.average;
  const high = t.high ?? t.average;
  // The bar runs from the Street's low to its high; a price outside that range sits on the spare tick past the end.
  const span = high - low || t.average * 0.1 || 1;
  const usable = COUNT - EDGE_PAD * 2 - 1;
  const idxFor = (p: number) => Math.min(COUNT - 1, Math.max(0, Math.round(EDGE_PAD + ((p - low) / span) * usable)));
  const ticks: Tick[] = Array.from({ length: COUNT }, () => ({ color: "bg-muted-foreground/25" }));
  const asOf = new Date(`${t.asOf}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const eps = coverage?.eps ? epsWords(coverage.eps.nextQuarter, coverage.eps.up, coverage.eps.down) : null;
  return (
    <Card className={className ?? "bg-muted/40 p-2 gap-3"}>
      <SectionLabel action={<span className="text-xs text-muted-foreground tabular-nums">Avg {money(t.average)}</span>}>
        Analyst targets
      </SectionLabel>
      <div className="space-y-2">
        <div className="relative py-1">
          <TickBar ticks={ticks} />
          {t.low != null ? <PriceLine pct={pctOf(idxFor(t.low))} color="bg-negative" label={`Low ${money(t.low)}`} /> : null}
          <PriceLine pct={pctOf(idxFor(t.average))} color="bg-foreground" label={`Average ${money(t.average)}`} />
          {t.high != null ? <PriceLine pct={pctOf(idxFor(t.high))} color="bg-positive" label={`High ${money(t.high)}`} /> : null}
          {entry != null ? <PriceLine pct={pctOf(idxFor(entry))} color="bg-blue-500" label={`Entry ${money(entry)}`} /> : null}
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
        <div className="flex items-center justify-between text-xs tabular-nums">
          <span className="text-negative">{t.low != null ? `Low ${money(t.low)}` : ""}</span>
          <span className="text-positive">{t.high != null ? `High ${money(t.high)}` : ""}</span>
        </div>
      </div>
      <p className="text-xs text-muted-foreground tabular-nums">
        Targets as of {asOf}
        {t.numAnalysts != null ? ` · ${t.numAnalysts} analysts` : ""}
        {eps ? ` · ${eps}` : ""}
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
 * Largest-remainder (Hamilton) apportionment: distribute exactly `slots`
 * across the input buckets in proportion to their counts. Every bucket
 * with a non-zero count gets at least 1 slot (a tiny minority bucket
 * shouldn't disappear from the bar). Returns a same-length array of
 * integer slot counts that always sums to exactly `slots`.
 */
function allocateSlots(counts: number[], slots: number): number[] {
  const total = counts.reduce((s, c) => s + c, 0);
  if (total === 0) return counts.map(() => 0);
  const exact = counts.map((c) => (c / total) * slots);
  const out = exact.map(Math.floor);
  // Hand out remainders to whichever buckets have the largest fractional
  // shortfall, until the slots add up exactly.
  let remaining = slots - out.reduce((s, n) => s + n, 0);
  const byRemainder = exact
    .map((e, i) => ({ i, r: e - Math.floor(e) }))
    .sort((a, b) => b.r - a.r);
  for (const { i } of byRemainder) {
    if (remaining <= 0) break;
    out[i]++;
    remaining--;
  }
  // Minimum-1 nudge for non-zero buckets that rounded to 0. Steal from
  // the largest bucket so the sum stays exactly `slots`.
  for (let i = 0; i < counts.length; i++) {
    if (counts[i] > 0 && out[i] === 0) {
      let maxIdx = 0;
      for (let j = 1; j < out.length; j++) if (out[j] > out[maxIdx]) maxIdx = j;
      if (out[maxIdx] > 1) {
        out[maxIdx]--;
        out[i]++;
      }
    }
  }
  return out;
}


/** The rating split as one 60-tick bar, every tick the same height and a solid colour, then the counts: bearish left, neutral centre, bullish right. */
function ConsensusDistributionRow({ consensus }: { consensus: { buy: number; hold: number; sell: number; total: number } }) {
  const { buy, hold, sell } = consensus;
  const [sellSlots, holdSlots] = allocateSlots([sell, hold, buy], 60);
  const ticks: Tick[] = Array.from({ length: 60 }, (_, i) => ({
    color: i < sellSlots ? "bg-negative" : i < sellSlots + holdSlots ? "bg-muted-foreground" : "bg-positive",
  }));
  return (
    <div className="space-y-1.5">
      <TickBar ticks={ticks} />
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
