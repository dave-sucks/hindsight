"use client";

/**
 * The Street, in two cards shared by the thesis sheet, the trade page and
 * the stock page (the owner's design, 2026-11-04):
 *
 *   • Analyst ratings — the verdict badge (Buy / Hold / Sell with the upside
 *     to the average target), one 60-tick bar of how the covering firms
 *     split Bearish / Neutral / Bullish, and the counts.
 *
 *   • Analyst targets — the 12-month targets on a line: Low at the left,
 *     High at the right, the Average as a tall tick, the Current price as a
 *     diamond and, when we hold the stock, our Entry as a hollow marker.
 *     Under it, the date of the targets and the EPS consensus with its
 *     revisions. The old "Price targets" card drew our own plan here; the
 *     plan is the triggers and the chart's lines, and the word "target"
 *     now means what the Street expects.
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

function impliedUpside(average: number | null | undefined, currentPrice: number | null): number | null {
  return average != null && currentPrice != null && currentPrice > 0 ? ((average - currentPrice) / currentPrice) * 100 : null;
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

export function AnalystRatingsCard({ coverage, currentPrice, className }: { coverage: Coverage; currentPrice: number | null; className?: string }) {
  const consensus = consensusOf(coverage);
  if (!consensus || consensus.total === 0) return null;
  const average = coverage?.priceTargets?.average ?? null;
  return (
    <Card className={className ?? "bg-muted/40 p-2 gap-3"}>
      <SectionLabel
        action={
          <AnalystVerdictBadge
            consensus={consensus}
            impliedUpsidePct={impliedUpside(average, currentPrice)}
            avgTarget={average}
            currentPrice={currentPrice}
          />
        }
      >
        Analyst ratings
      </SectionLabel>
      <ConsensusDistributionRow consensus={consensus} />
    </Card>
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
  /** Our fill price while we hold the stock; a hollow marker on the line. */
  entry?: number | null;
  className?: string;
}) {
  const t = coverage?.priceTargets ?? null;
  if (!t) return null;
  const points = [t.low, t.average, t.high, currentPrice, entry].filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const lo = Math.min(...points);
  const hi = Math.max(...points);
  const span = hi - lo || t.average * 0.1 || 1;
  // The same scale as every tick bar: three empty ticks of room at each edge.
  const COUNT = 60;
  const EDGE_PAD = 3;
  const usable = COUNT - EDGE_PAD * 2 - 1;
  const idxFor = (p: number) => Math.round(EDGE_PAD + ((p - lo) / span) * usable);
  const pctFor = (p: number) => Math.min(94, Math.max(6, (idxFor(p) / (COUNT - 1)) * 100));
  const lowIdx = t.low != null ? idxFor(t.low) : -1;
  const highIdx = t.high != null ? idxFor(t.high) : -1;
  const avgIdx = idxFor(t.average);
  const ticks: Tick[] = Array.from({ length: COUNT }, (_, i) => {
    if (i === lowIdx) return { color: "bg-negative", tall: true };
    if (i === highIdx) return { color: "bg-positive", tall: true };
    if (i === avgIdx) return { color: "bg-foreground", tall: true };
    return { color: "bg-muted-foreground/25" };
  });
  const floatAt = (pct: number): React.CSSProperties =>
    pct < 18 ? { left: `${pct}%`, transform: "translateX(-4px)" } : pct > 82 ? { right: `${100 - pct}%`, transform: "translateX(4px)" } : { left: `${pct}%`, transform: "translateX(-50%)" };
  const asOf = new Date(`${t.asOf}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const eps = coverage?.eps ? epsWords(coverage.eps.nextQuarter, coverage.eps.up, coverage.eps.down) : null;
  return (
    <Card className={className ?? "bg-muted/40 p-2 gap-3"}>
      <SectionLabel action={<span className="text-xs text-muted-foreground tabular-nums">Avg ${t.average.toFixed(2)}</span>}>
        Analyst targets
      </SectionLabel>
      <div className="space-y-2">
        {/* Two label bands above the line, so Entry and Current never collide: Entry on the upper, Current right above the bar. */}
        <div className="relative h-8 text-xs tabular-nums">
          {entry != null ? (
            <span className="absolute top-0 whitespace-nowrap text-muted-foreground" style={floatAt(pctFor(entry))}>
              Entry ${entry.toFixed(2)}
            </span>
          ) : null}
          {currentPrice != null ? (
            <span className="absolute bottom-0 whitespace-nowrap font-medium" style={floatAt(pctFor(currentPrice))}>
              ${currentPrice.toFixed(2)}
            </span>
          ) : null}
        </div>
        <div className="relative">
          <TickBar ticks={ticks} />
          {entry != null ? (
            <span
              aria-hidden
              className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-muted-foreground bg-background"
              style={{ left: `${pctFor(entry)}%` }}
            />
          ) : null}
          {currentPrice != null ? (
            <span
              aria-hidden
              className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 bg-foreground"
              style={{ left: `${pctFor(currentPrice)}%` }}
            />
          ) : null}
        </div>
        <div className="flex items-center justify-between text-xs tabular-nums">
          <span className="text-negative">{t.low != null ? `Low $${t.low.toFixed(2)}` : ""}</span>
          <span className="text-positive">{t.high != null ? `High $${t.high.toFixed(2)}` : ""}</span>
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

function AnalystVerdictBadge({
  consensus,
  impliedUpsidePct,
  avgTarget,
  currentPrice,
}: {
  consensus: { buy: number; hold: number; sell: number; total: number };
  impliedUpsidePct: number | null;
  avgTarget: number | null;
  currentPrice: number | null;
}) {
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
  const upsideSuffix =
    impliedUpsidePct != null
      ? ` ${impliedUpsidePct >= 0 ? "+" : ""}${impliedUpsidePct.toFixed(1)}%`
      : "";
  const tooltipBody =
    avgTarget != null && currentPrice != null
      ? `Consensus rating across ${total} covering firms. ${impliedUpsidePct != null ? `${impliedUpsidePct >= 0 ? "+" : ""}${impliedUpsidePct.toFixed(1)}%` : "—"} is the implied move from the current price ($${currentPrice.toFixed(2)}) to the average 12-month price target ($${avgTarget.toFixed(2)}).`
      : `Consensus rating across ${total} covering firms.`;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Badge variant={verdict.variant} className="font-normal cursor-help">
            {verdict.label}
            {upsideSuffix}
          </Badge>
        }
      />
      <TooltipContent>{tooltipBody}</TooltipContent>
    </Tooltip>
  );
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


/** The rating split as one 60-tick bar, the first bear tick and the last bull tick tall, then the counts. */
function ConsensusDistributionRow({ consensus }: { consensus: { buy: number; hold: number; sell: number; total: number } }) {
  const { buy, hold, sell } = consensus;
  const [sellSlots, holdSlots, buySlots] = allocateSlots([sell, hold, buy], 60);
  const lastBullIdx = sellSlots + holdSlots + buySlots - 1;
  const ticks: Tick[] = Array.from({ length: 60 }, (_, i) => {
    const isLeftmostBear = sell > 0 && i === 0;
    const isRightmostBull = buy > 0 && i === lastBullIdx;
    if (isLeftmostBear) return { color: "bg-negative", tall: true };
    if (isRightmostBull) return { color: "bg-positive", tall: true };
    const color = i < sellSlots ? "bg-negative/40" : i < sellSlots + holdSlots ? "bg-muted-foreground/25" : "bg-positive/40";
    return { color };
  });
  return (
    <div className="space-y-1.5">
      <TickBar ticks={ticks} />
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-negative" />
          {sell} Bearish
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-muted-foreground/40" />
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
