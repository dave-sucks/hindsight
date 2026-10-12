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
import { Area, ComposedChart, XAxis, YAxis } from "recharts";
import { ArrowRight, ArrowUpRight, Clock } from "lucide-react";
import { StockLogo } from "@/components/StockLogo";
import { Badge } from "@/components/ui/badge";
import { FlameIcon } from "@/components/ui/flame-icon";
import { cn } from "@/lib/utils";
import { Mono } from "./primitives";
import type { DocSlug } from "./registry";
import { PillRow } from "./trigger-bits";

const FADE_BOTTOM = { maskImage: "linear-gradient(to bottom, black 60%, transparent)", WebkitMaskImage: "linear-gradient(to bottom, black 60%, transparent)" };

// ── The big cells ──────────────────────────────────────────────────────────

/** A day's tape for the chart: a gentle climb with some noise, the same every render. */
/** A seeded random, so the made-up tape is the same on every render and on the server. */
function seeded(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Twenty trading days, Sep 14 to Oct 9, six points a day. Example numbers only. */
const DAYS = ["Sep 14", "Sep 15", "Sep 16", "Sep 17", "Sep 18", "Sep 21", "Sep 22", "Sep 23", "Sep 24", "Sep 25", "Sep 28", "Sep 29", "Sep 30", "Oct 1", "Oct 2", "Oct 5", "Oct 6", "Oct 7", "Oct 8", "Oct 9"];
const PER_DAY = 6;

/**
 * A made-up month for the example stock: it runs up to where we start
 * watching, pulls back to the 20-day where we buy, then runs to the target
 * where we sell. The path goes through those anchors, with seeded noise on top.
 */
const ANCHORS: ReadonlyArray<[index: number, price: number]> = [
  [0, 125.6],
  [26, 134.2],
  [52, 128.4],
  [84, 140.9],
  [100, 145.8],
  [119, 143.6],
];
const TAPE = (() => {
  const rand = seeded(11);
  const n = DAYS.length * PER_DAY;
  return Array.from({ length: n }, (_, i) => {
    const k = ANCHORS.findIndex(([at]) => at >= i);
    const [i1, p1] = ANCHORS[Math.max(0, k)];
    const [i0, p0] = ANCHORS[Math.max(0, k - 1)];
    const base = i1 === i0 ? p1 : p0 + ((p1 - p0) * (i - i0)) / (i1 - i0);
    const pinned = ANCHORS.some(([at]) => at === i);
    return { i, v: Number((base + (pinned ? 0 : (rand() - 0.5) * 1.6)).toFixed(2)), day: DAYS[Math.floor(i / PER_DAY)] };
  });
})();
/** The chart's box inside the 84rem sheet: the sheet less its padding, the chart card's padding and border. */
const CHART_W = 1214;
const CHART_H = 352;
const AXIS_TICK = { fontSize: 18, fill: "var(--muted-foreground)" };

/** The thesis's life in three moments, each a point on the chart and a state of the sheet. */
const MOMENTS = [
  {
    at: 26,
    marker: "Watching",
    status: { label: "Agent Watch", dot: "bg-foreground", shimmer: true },
    price: "$134.20",
    change: "+$2.86 ↗ 2.18%",
    up: true,
    summary:
      "Watching Arista at $134.20. Its investor day on Nov 12 should raise its AI networking targets. I'd rather buy the pullback to the 20-day average near $128 than chase the run-up, so the buy waits there.",
    written: "Sep 18",
  },
  {
    at: 52,
    marker: "Bought",
    status: { label: "Holding", dot: "bg-blue-500", shimmer: false },
    price: "$128.40",
    change: "−$1.12 ↘ 0.86%",
    up: false,
    summary:
      "Bought 40 shares of Arista at $128.40, on the pullback to the 20-day. The floor is $122, under the last swing low, and the target is $146, ahead of the November investor day.",
    written: "Sep 24",
  },
  {
    at: 100,
    marker: "Sold",
    status: { label: "Sold", dot: "bg-muted-foreground", shimmer: false },
    price: "$145.80",
    change: "+$3.40 ↗ 2.39%",
    up: true,
    summary:
      "Sold Arista at $145.80, at the target, up 13.6% on the trade. The run-up has priced in most of what the investor day should bring, so I took the gain rather than hold through it.",
    written: "Oct 6",
  },
] as const;

/** The thesis sheet for one stock, drawn at the real panel's size and shown as a miniature, stepping from watching to bought to sold. */
function SheetMock() {
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setInterval(() => setStep((s) => (s + 1) % MOMENTS.length), 5000);
    return () => window.clearInterval(id);
  }, []);
  const m = MOMENTS[step];
  const left = `${(m.at / (TAPE.length - 1)) * 100}%`;

  return (
    <div className="flex w-[84rem] flex-col gap-6 rounded-3xl border bg-background p-10 shadow-sm">
      {/* The sheet's own badges, drawn at their size again inside the miniature. */}
      <div className="flex items-center gap-1.5" style={{ zoom: 1.8 }}>
        <Badge variant="secondary">
          <span className={cn("size-1.5 shrink-0 rounded-full transition-colors duration-500", m.status.dot, m.status.shimmer && "agent-watch-dot")} />
          <span className={cn(m.status.shimmer && "shimmer-text")}>{m.status.label}</span>
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
        <span className="text-foreground">{m.price}</span>
        <span className={m.up ? "text-positive" : "text-negative"}>{m.change}</span>
      </p>
      <p key={step} className="min-h-[6.5rem] text-2xl leading-snug text-foreground animate-in fade-in-0 duration-700">
        {m.summary}
      </p>
      <p className="text-xl text-muted-foreground">Catalyst Event PM · written {m.written}</p>
      <div className="flex flex-col gap-4 rounded-3xl border p-6">
        <div className="flex items-center justify-between">
          <span className="inline-flex rounded-2xl border p-1 text-xl">
            {["1D", "1W", "1M", "3M", "1Y"].map((r) => (
              <span key={r} className={cn("px-5 py-1.5", r === "1M" ? "rounded-xl bg-muted text-foreground" : "text-muted-foreground")}>
                {r}
              </span>
            ))}
          </span>
          <span className="text-2xl text-positive tabular-nums">+$18.00 ↗ 14.33%</span>
        </div>
        {/* Mono, so the axis labels read like the real chart's. */}
        <Mono className="relative block">
          {/* A fixed size, not a measured one: the sheet is a fixed width, and a measured chart inside a zoomed
              miniature comes out a different width in different browsers. */}
          <ComposedChart width={CHART_W} height={CHART_H} data={TAPE} margin={{ top: 48, right: 0, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="docs-sheet-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--positive)" stopOpacity={0.16} />
                <stop offset="100%" stopColor="var(--positive)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="day" interval={PER_DAY * 4 - 1} tickLine={false} axisLine={false} tick={AXIS_TICK} tickMargin={10} />
            <YAxis orientation="left" mirror tickLine={false} axisLine={false} tick={AXIS_TICK} tickCount={4} domain={["dataMin - 2", "dataMax + 1"]} tickFormatter={(x: number) => x.toFixed(0)} />
            <Area dataKey="v" type="linear" stroke="var(--positive)" strokeWidth={2.5} fill="url(#docs-sheet-fill)" isAnimationActive={false} />
          </ComposedChart>
          {/* The moment we're on: a dashed line and its badge, sliding along the chart. */}
          <span className="pointer-events-none absolute bottom-10 top-0 border-l-2 border-dashed border-muted-foreground/60 transition-[left] duration-700 ease-out" style={{ left }} />
          <span
            className="pointer-events-none absolute top-0 -translate-x-1/2 rounded-full border bg-background px-4 py-1 text-xl text-foreground shadow-sm transition-[left] duration-700 ease-out"
            style={{ left }}
          >
            {m.marker}
          </span>
        </Mono>
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
            "group relative flex flex-col overflow-hidden rounded-xl border border-transparent bg-muted/50 transition-colors hover:bg-muted/70 has-[button:focus-visible]:ring-2 has-[button:focus-visible]:ring-ring",
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
            <span className="text-sm leading-6 text-muted-foreground">{c.line}</span>
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
