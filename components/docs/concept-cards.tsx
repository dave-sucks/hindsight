"use client";

/**
 * The Guide's concepts as a bento of soft cards (Cursor's and Lightfield's
 * style): the words at the top, the picture below. A big picture starts at
 * the card's left padding and runs off its right and bottom edges.
 *
 *   Row one: theses across two columns (a miniature of the thesis sheet),
 *   then analysts (the roster).
 *   Row two, kept minimal: triggers as a live check feed, a proposal
 *   waiting for a yes, situations as a book of dots.
 *
 * Every ticker and number is an example.
 */

import { useEffect, useState, type ReactNode } from "react";
import { Area, AreaChart, YAxis } from "recharts";
import { ArrowRight, ArrowUpRight, Clock } from "lucide-react";
import { StockLogo } from "@/components/StockLogo";
import { Badge } from "@/components/ui/badge";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import { FlameIcon } from "@/components/ui/flame-icon";
import { cn } from "@/lib/utils";
import { Mono } from "./primitives";
import type { DocSlug } from "./registry";
import { PillRow } from "./trigger-bits";

const FADE_BOTTOM = { maskImage: "linear-gradient(to bottom, black 60%, transparent)", WebkitMaskImage: "linear-gradient(to bottom, black 60%, transparent)" };

// ── The big cells ──────────────────────────────────────────────────────────

/** A day's tape for the chart: a gentle climb with some noise, the same every render. */
const TAPE = Array.from({ length: 64 }, (_, i) => ({ i, v: 131.3 + i * 0.045 + Math.sin(i * 0.9) * 0.45 + Math.sin(i * 0.23) * 0.6 }));
const CHART: ChartConfig = { v: { label: "Price", color: "var(--positive)" } };

/** The thesis sheet for a stock we only watch, drawn at the real panel's size and shown as a miniature: one column, top to bottom. */
function SheetMock() {
  return (
    <div className="flex w-[84rem] flex-col gap-6 rounded-3xl border bg-background p-10 shadow-sm">
      {/* The sheet's own badges, drawn at their size again inside the miniature. */}
      <div className="flex items-center gap-1.5" style={{ zoom: 1.8 }}>
        <Badge variant="secondary">
          <span className="agent-watch-dot size-1.5 shrink-0 rounded-full bg-foreground" />
          <span className="shimmer-text">Agent Watch</span>
        </Badge>
        <Badge variant="secondary">
          <FlameIcon className="size-3" />
          High Conviction
        </Badge>
      </div>
      <div className="flex items-center gap-4">
        <StockLogo ticker="ANET" size="lg" className="size-16 rounded-xl" />
        <span className="flex flex-col gap-0.5">
          <span className="text-4xl font-medium text-foreground">Arista Networks</span>
          <Mono className="text-xl text-muted-foreground">ANET · NYSE</Mono>
        </span>
      </div>
      <p className="flex items-baseline gap-4 text-4xl font-medium tabular-nums">
        <span className="text-foreground">$134.20</span>
        <span className="text-positive">+$2.86</span>
        <span className="text-positive">↗ 2.18%</span>
      </p>
      <p className="text-2xl leading-snug text-foreground">
        Watching Arista at $134.20. Its investor day on Nov 12 should raise its AI networking targets. I&apos;d rather buy the pullback to the 20-day average
        near $128 than chase the run-up, so the buy waits there.
      </p>
      <p className="text-xl text-muted-foreground">Catalyst Event PM · written Oct 12</p>
      <div className="flex flex-col gap-4 rounded-3xl border p-6">
        <div className="flex items-center justify-between">
          <span className="inline-flex rounded-2xl border p-1 text-xl">
            {["1D", "1W", "1M", "3M", "1Y"].map((r, i) => (
              <span key={r} className={cn("px-5 py-1.5", i === 0 ? "rounded-xl bg-muted text-foreground" : "text-muted-foreground")}>
                {r}
              </span>
            ))}
          </span>
          <span className="text-2xl text-positive tabular-nums">+$2.86 ↗ 2.18%</span>
        </div>
        <div className="h-[22rem]">
          <ChartContainer config={CHART} className="h-full w-full">
            <AreaChart data={TAPE} margin={{ top: 8, right: 0, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="docs-sheet-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--color-v)" stopOpacity={0.22} />
                  <stop offset="100%" stopColor="var(--color-v)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <YAxis hide domain={["dataMin - 2", "dataMax + 2"]} />
              <Area dataKey="v" type="monotone" stroke="var(--color-v)" strokeWidth={2.5} fill="url(#docs-sheet-fill)" isAnimationActive={false} />
            </AreaChart>
          </ChartContainer>
        </div>
      </div>
      {/* The sheet's own trigger pills, drawn at their size again inside the miniature. */}
      <div className="flex flex-col gap-3" style={{ zoom: 1.7 }}>
        <PillRow action="ENTER" held={false} specs={[{ action: "ENTER", when: { watch: "move", is: "near", value: 2, variable: "sma20" }, why: "Buy the pullback, not the run-up." }]} />
        <PillRow
          action="REVIEW"
          held={false}
          specs={[
            { action: "REVIEW", when: { watch: "from_date", is: "before", value: 3, variable: "event" }, why: "Three days before the investor day." },
            { action: "REVIEW", when: { watch: "repeat", value: 30 }, why: "A monthly look while it waits." },
          ]}
        />
      </div>
    </div>
  );
}

// ── The small cells ────────────────────────────────────────────────────────

/** Triggers: the five-minute check, as a feed. Most lines are quiet; one fires and goes to the analyst. */
const CHECKS = [
  { t: "10:35", s: "NVDA", l: "8 rules checked" },
  { t: "10:35", s: "AAPL", l: "5 rules checked" },
  { t: "10:40", s: "CRWD", l: "Fell 5% in a day", fired: true },
  { t: "10:40", s: "SHOP", l: "6 rules checked" },
  { t: "10:45", s: "AMD", l: "Reports in 7 days", fired: true },
  { t: "10:45", s: "CEG", l: "4 rules checked" },
  { t: "10:50", s: "MSFT", l: "7 rules checked" },
];

function TriggerFeed() {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setInterval(() => setN((x) => x + 1), 2200);
    return () => window.clearInterval(id);
  }, []);
  const rows = Array.from({ length: 5 }, (_, k) => CHECKS[(n + k) % CHECKS.length]);
  return (
    <ol className="flex w-full max-w-sm flex-col" style={FADE_BOTTOM}>
      {rows.map((r, k) => (
        <li key={`${n}-${k}`} className={cn("flex items-center gap-3 py-1.5 text-sm", k === 0 && "animate-in fade-in-0 slide-in-from-top-1 duration-500")}>
          <Mono className="w-10 text-xs text-muted-foreground tabular-nums">{r.t}</Mono>
          <span className={cn("size-1.5 shrink-0 rounded-full", r.fired ? "bg-blue-500" : "bg-muted-foreground/30")} />
          <span className={cn("w-12", r.fired ? "text-foreground" : "text-muted-foreground")}>{r.s}</span>
          <span className={cn("min-w-0 truncate", r.fired ? "text-foreground" : "text-muted-foreground/70")}>{r.l}</span>
          {r.fired ? (
            <span className="ml-auto inline-flex shrink-0 items-center gap-1 text-xs text-blue-500">
              To the analyst
              <ArrowUpRight className="size-3" />
            </span>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

/** Situations: a book of dots, a few lit. */
function Dots() {
  const lit = new Set([5, 14, 27]);
  return (
    <div className="grid grid-cols-8 gap-3">
      {Array.from({ length: 32 }, (_, i) => (
        <span key={i} className={cn("size-2 rounded-full", lit.has(i) ? "bg-blue-500" : "border border-muted-foreground/30")} />
      ))}
    </div>
  );
}

/** Approvals: one proposal, waiting. */
function Proposal() {
  return (
    <div className="flex items-center gap-3 rounded-full border bg-background py-1.5 pl-4 pr-1.5 text-sm shadow-sm">
      <span className="text-foreground">Buy 14 CRWD</span>
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Clock className="size-3" />
        23h
      </span>
      <span className="rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground">Approve</span>
    </div>
  );
}

/** Analysts: the roster, each with its style and the one rule its holdings inherit. */
function Roster() {
  const rows = [
    { n: "PEAD Specialist", s: "Post-earnings drift · sells 12% off the high", c: "bg-blue-500" },
    { n: "Secular Compounder", s: "Compounders · sells 25% off the high", c: "bg-violet-400" },
    { n: "Catalyst Event PM", s: "Dated events · looks 10 days before", c: "bg-sky-400" },
    { n: "Momentum Leader", s: "52-week highs · sells under the 50-day", c: "bg-emerald-400" },
    { n: "Pullback Buyer", s: "Rising averages · sells 8% off the high", c: "bg-amber-400" },
    { n: "Biotech Run-up", s: "FDA dates · sells the day before", c: "bg-rose-400" },
    { n: "Dividend Grower", s: "Rising payouts · sells on a dividend cut", c: "bg-teal-400" },
    { n: "Deep Value", s: "Cheap on cash flow · sells at fair value", c: "bg-orange-400" },
  ];
  return (
    <div className="flex w-[26rem] flex-col divide-y rounded-2xl border bg-background shadow-sm">
      {rows.map((r) => (
        <span key={r.n} className="flex items-center gap-3 px-4 py-3">
          <span className={cn("size-2 shrink-0 rounded-full", r.c)} />
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-medium text-foreground">{r.n}</span>
            <span className="truncate text-xs text-muted-foreground">{r.s}</span>
          </span>
        </span>
      ))}
    </div>
  );
}

const CELLS: ReadonlyArray<{ slug: DocSlug; title: string; line: string; art: ReactNode; span?: string; bleed?: boolean }> = [
  {
    slug: "theses",
    title: "Theses",
    line: "Every stock carries one: a belief we can be wrong about, the plan that acts on it, and the triggers that watch it.",
    // The sheet drawn at full size and shown smaller; zoom keeps its layout size honest, so nothing is cropped.
    art: (
      <div style={{ zoom: 0.6 }}>
        <SheetMock />
      </div>
    ),
    span: "lg:col-span-2",
    bleed: true,
  },
  { slug: "analysts", title: "Analysts", line: "A trading style with its own universe, sizing and sell rules. Every thesis belongs to one.", art: <Roster />, bleed: true },
  { slug: "triggers", title: "Triggers", line: "One sentence each, checked every five minutes. The one that comes true goes to the analyst.", art: <TriggerFeed /> },
  { slug: "approvals", title: "Approvals", line: "Analysts propose. You approve. A proposal expires after a day.", art: <Proposal /> },
  { slug: "situations", title: "Situations", line: "The sixteen reasons a stock needs an answer today.", art: <Dots /> },
];

export function ConceptCards({ onOpen }: { onOpen: (slug: DocSlug) => void }) {
  return (
    <div className="grid gap-3 lg:grid-cols-3">
      {CELLS.map((c) => (
        <div
          key={c.slug}
          className={cn(
            "group relative flex flex-col overflow-hidden rounded-xl border-4 border-transparent bg-muted/50 transition-colors hover:bg-muted/70 has-[button:focus-visible]:ring-2 has-[button:focus-visible]:ring-ring",
            c.bleed ? "h-[38rem]" : "h-80",
            c.span,
          )}
        >
          <button type="button" onClick={() => onOpen(c.slug)} className="absolute inset-0 z-10 focus-visible:outline-none" aria-label={`Open ${c.title}`} />
          <div className="flex flex-col gap-1 p-5">
            <span className="inline-flex items-center gap-1.5 text-base font-medium text-foreground">
              {c.title}
              <ArrowRight className="size-4 -translate-x-1 opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:opacity-100" />
            </span>
            <span className="max-w-md text-sm leading-6 text-muted-foreground">{c.line}</span>
          </div>
          {/* The picture: a big one sits at the left padding and runs off the right and bottom edges; a small one sits in the space left. */}
          <div className="pointer-events-none relative min-h-0 flex-1" aria-hidden>
            {c.bleed ? <div className="absolute left-5 top-1">{c.art}</div> : <div className="flex h-full items-center px-5 pb-5">{c.art}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}
