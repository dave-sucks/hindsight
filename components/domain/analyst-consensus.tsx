"use client";

/**
 * AnalystConsensusWidget — THE Street-view widget, shared by every surface
 * that shows analyst consensus (thesis sheet, stock page sidebar). One bar,
 * one badge, one collapsible — extracted from ThesisSheet so no surface can
 * hand-roll its own variant again. One consolidated visual:
 *
 *   • Header badge: consensus rating (Buy / Hold / Sell) with the implied
 *     upside % to the consensus average target appended ("Buy +37.1%").
 *     Tooltip explains the math.
 *
 *   • Distribution bar: 60-tick proportional bar showing how the covering
 *     firms split across Bearish / Neutral / Bullish (red / grey / green).
 *     The lowest bear target ($ value, red text) sits above the leftmost
 *     red tick; the highest bull target ($, green text) above the
 *     rightmost green tick — so the bar reads as both "rating distribution"
 *     and "price target range" in a single visual. The average target
 *     anchors the bottom-right corner of the key row.
 *
 *   • Collapsible synthesis narrative (thesis sheet only) — the prose
 *     summary from the `analystConsensus` JSONB column.
 *
 * Data comes from getAnalystCoverageData (lib/actions/analyst-coverage) —
 * server-fetched and passed in; the widget itself never fetches.
 */

import { ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { TickBar, type Tick } from "@/components/ui/gauge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { AnalystCoverageData } from "@/lib/actions/analyst-coverage";
import type {
  ResearchCitation,
  ResearchTextSection,
} from "@/lib/types/thesis-sheet";

/** Inline source chip for research citations ("reuters.com" etc.). */
export function ResearchCitationChip({ citation }: { citation: ResearchCitation }) {
  const label = citation.domain ?? citation.title ?? "source";
  const inner = (
    <Badge variant="secondary" className="ml-1 align-baseline font-mono text-[10px]">
      {label}
    </Badge>
  );
  if (!citation.url) return inner;
  return (
    <a
      href={citation.url}
      target="_blank"
      rel="noopener noreferrer"
      className="no-underline"
    >
      {inner}
    </a>
  );
}

export function AnalystConsensusWidget({
  coverage,
  fallbackConsensus = null,
  narrative = null,
  currentPrice,
  className,
}: {
  /** Live analyst coverage from getAnalystCoverageData. */
  coverage: AnalystCoverageData | null;
  /** Legacy mint-time consensus shape — thesis sheet only. */
  fallbackConsensus?: { buy: number; hold: number; sell: number } | null;
  /** Prose synthesis behind a collapsible — thesis sheet only. */
  narrative?: ResearchTextSection | null;
  currentPrice: number | null;
  className?: string;
}) {
  // Source consensus: prefer live coverage; fall back to stored values from
  // mint time. Either may be null — render nothing in that case.
  const consensus = coverage?.consensus
    ? {
        buy: coverage.consensus.buy,
        hold: coverage.consensus.hold,
        sell: coverage.consensus.sell,
        total:
          coverage.consensus.buy +
          coverage.consensus.hold +
          coverage.consensus.sell,
      }
    : fallbackConsensus
      ? {
          buy: fallbackConsensus.buy,
          hold: fallbackConsensus.hold,
          sell: fallbackConsensus.sell,
          total:
            fallbackConsensus.buy +
            fallbackConsensus.hold +
            fallbackConsensus.sell,
        }
      : null;

  const priceTargets = coverage?.priceTargets ?? null;
  const impliedUpsidePct =
    priceTargets && currentPrice != null && currentPrice > 0
      ? ((priceTargets.average - currentPrice) / currentPrice) * 100
      : null;
  const hasAnyData =
    (consensus && consensus.total > 0) || priceTargets != null || narrative != null;
  if (!hasAnyData) return null;

  return (
    <Card className={className ?? "bg-muted/40 p-2 gap-4"}>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs font-mono uppercase tracking-wide text-muted-foreground">
          Analyst Consensus
        </p>
        {consensus ? (
          <AnalystVerdictBadge
            consensus={consensus}
            impliedUpsidePct={impliedUpsidePct}
            avgTarget={priceTargets?.average ?? null}
            currentPrice={currentPrice}
          />
        ) : null}
      </div>

      {consensus && consensus.total > 0 ? (
        <ConsensusDistributionRow
          consensus={consensus}
          priceTargets={priceTargets}
        />
      ) : null}

      {narrative ? <ConsensusNarrative narrative={narrative} /> : null}
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

function ConsensusDistributionRow({
  consensus,
  priceTargets,
}: {
  consensus: { buy: number; hold: number; sell: number; total: number };
  priceTargets: {
    low: number | null;
    average: number;
    median: number | null;
    high: number | null;
    numAnalysts: number | null;
  } | null;
}) {
  const { buy, hold, sell } = consensus;
  // Fixed-width 60-tick bar with segments sized by proportion of each
  // bucket. Prior approach (1 tick per analyst) looked anemic at 2 analysts
  // and bled together at 50+ — proportional renders identically at any
  // analyst count. Order across the bar: Sell (red) → Hold (grey) → Buy
  // (green), L→R.
  const [sellSlots, holdSlots, buySlots] = allocateSlots([sell, hold, buy], 60);

  // The leftmost-bear and rightmost-bull ticks get an extra-tall treatment
  // so they read as the range endpoints when paired with the low/high
  // price-target labels above the bar.
  const lastBullIdx = sellSlots + holdSlots + buySlots - 1;
  const ticks: Tick[] = Array.from({ length: 60 }, (_, i) => {
    const isLeftmostBear = sell > 0 && i === 0;
    const isRightmostBull = buy > 0 && i === lastBullIdx;
    const color =
      i < sellSlots
        ? "bg-negative"
        : i < sellSlots + holdSlots
          ? "bg-muted-foreground/40"
          : "bg-positive";
    return isLeftmostBear || isRightmostBull
      ? { color, heightPx: 22 }
      : { color, tall: true };
  });

  return (
    <div className="space-y-1.5">
      {/* Low/high price-target labels above the bar's endpoints. Red on the
          left = most bearish firm's 12-mo. target; green on the right =
          most bullish firm's target. The "Bear Target / Bull Target" prefix
          spells out what the $ value represents — without it the numbers
          looked like statistical aggregates of nothing in particular. */}
      {priceTargets && (priceTargets.low != null || priceTargets.high != null) ? (
        <div className="flex items-end justify-between text-xs tabular-nums">
          <span className="text-negative">
            {priceTargets.low != null
              ? `Bear Target $${priceTargets.low.toFixed(2)}`
              : ""}
          </span>
          <span className="text-positive">
            {priceTargets.high != null
              ? `Bull Target $${priceTargets.high.toFixed(2)}`
              : ""}
          </span>
        </div>
      ) : null}

      <TickBar ticks={ticks} />

      {/* Bottom row: distribution key on the left, average target on the
          right. Key order matches the bar L→R: Bearish (red) → Neutral
          (grey) → Bullish (green). Avg is the single "consensus number"
          — kept in muted text so it reads as label-weight, not a
          competing headline. */}
      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <div className="flex items-center gap-3">
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
        {priceTargets ? (
          <span className="tabular-nums">
            Avg ${priceTargets.average.toFixed(2)}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function ConsensusNarrative({
  narrative,
}: {
  narrative: ResearchTextSection;
}) {
  return (
    <Collapsible>
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors">
        <span>Synthesis</span>
        <ChevronDown className="size-3.5 transition-transform data-[panel-open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-2 text-sm leading-relaxed">
        <p className="whitespace-pre-wrap">
          {narrative.text}
          {narrative.citations && narrative.citations.length > 0 ? (
            <span className="ml-1 inline-flex flex-wrap gap-1">
              {narrative.citations.map((c, i) => (
                <ResearchCitationChip key={i} citation={c} />
              ))}
            </span>
          ) : null}
        </p>
      </CollapsibleContent>
    </Collapsible>
  );
}
