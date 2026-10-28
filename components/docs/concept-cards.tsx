"use client";

/**
 * The Guide's concepts as a bento of soft cards (Cursor's and Lightfield's
 * style): the words at the top, the picture below. A big picture starts at
 * the card's left padding and runs off its right and bottom edges.
 *
 *   Row one: theses across two columns (a miniature of the thesis sheet),
 *   then one analyst talking through its month, as it would in chat.
 *   Row two: triggers as a running check log, a proposal being approved,
 *   and the morning's work list with each stock's situation.
 *
 * Every ticker and number is an example.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Area, ComposedChart, XAxis, YAxis } from "recharts";
import { ArrowRight, ChevronRight, Clock, MousePointer2 } from "lucide-react";
import { HugeiconsIcon } from "@hugeicons/react";
import { QuillWrite01Icon } from "@hugeicons/core-free-icons";
import { StockLogo } from "@/components/StockLogo";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { FlameIcon } from "@/components/ui/flame-icon";
import { THESIS_STATUS_DISPLAY } from "@/lib/thesis-status";
import { cn } from "@/lib/utils";
import { Mono } from "./primitives";
import type { DocSlug } from "./registry";
import { PillRow } from "./trigger-bits";
import { Tk } from "./chat-mock";

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
    const id = window.setInterval(() => setStep((s) => (s + 1) % MOMENTS.length), 9000);
    return () => window.clearInterval(id);
  }, []);
  const m = MOMENTS[step];
  const left = `${(m.at / (TAPE.length - 1)) * 100}%`;

  return (
    <div className="flex w-[84rem] flex-col gap-6 rounded-2xl border bg-background p-10 shadow-sm">
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
      <div className="flex flex-col gap-4 rounded-2xl border p-6">
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
          <ComposedChart id="docs-sheet-chart" width={CHART_W} height={CHART_H} data={TAPE} margin={{ top: 48, right: 0, bottom: 0, left: 0 }}>
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

// ── The analyst ────────────────────────────────────────────────────────────

/**
 * One analyst summing up its month in its own words: its result up top,
 * then what it holds and watches and what its style says it does next. The
 * summary writes itself in once, when the card first comes on screen.
 */
const DESK = {
  initials: "PS",
  color: "bg-blue-500",
  name: "PEAD Specialist",
  pnl: "+$2,305",
  up: true,
  message: [
    <>
      A good month, mostly thanks to <Tk s="CRWD" c={8.2} logo />, which has drifted higher every day since its beat. This morning I added to it, and raised{" "}
      <Tk s="ANET" logo />
      &apos;s target ahead of its investor day.
    </>,
    <ThesisEdits key="edits" />,
    <>
      I only buy after a report, never before one. <Tk s="AMD" logo /> reports Thursday after the close: if it beats estimates by more than 5% and holds the gap
      into Friday&apos;s open, I&apos;ll propose a buy.
    </>,
    <>
      Sold <Tk s="SHOP" logo /> at its target on Monday, up 11%. Next week I&apos;m watching <Tk s="SNOW" logo /> and <Tk s="MDB" logo /> into their reports.
    </>,
  ],
};

/** The run's own "edited theses" table, two rows of it: status, then what changed and why. */
function ThesisEdits() {
  const rows = [
    { s: "CRWD", status: "HOLDING" as const, did: "Added 46 shares.", why: "Bought at $401; the drift held the gap for a third day." },
    { s: "ANET", status: "WATCHING" as const, did: "Target to $152.", why: "The investor day should lift the AI networking numbers." },
  ];
  return (
    <span className="flex flex-col gap-1">
      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
        <HugeiconsIcon icon={QuillWrite01Icon} className="size-3.5 shrink-0" />
        Edited 2 theses
      </span>
      <span className="flex flex-col gap-1 rounded-lg border bg-card p-1">
        {rows.map((r) => {
          const st = THESIS_STATUS_DISPLAY[r.status];
          return (
            <span key={r.s} className="flex items-center gap-1.5 p-2">
              <StockLogo ticker={r.s} size="sm" />
              <span className="mr-1 shrink-0 font-brand text-sm font-semibold">{r.s}</span>
              <Badge variant="secondary">
                <span className={cn("size-1.5 shrink-0 rounded-full", st.dotClass)} />
                {st.label}
              </Badge>
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{r.did}</span> {r.why}
              </span>
            </span>
          );
        })}
      </span>
    </span>
  );
}

const FADE_OUT = { maskImage: "linear-gradient(to bottom, black calc(100% - 3rem), transparent)", WebkitMaskImage: "linear-gradient(to bottom, black calc(100% - 3rem), transparent)" };

function AnalystDesk() {
  const d = DESK;
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(0);
  // The answer writes itself in once, the first time the card is on screen, then stays.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return setShown(d.message.length);
    let timer = 0;
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return;
        io.disconnect();
        timer = window.setInterval(() => setShown((n) => (n >= d.message.length ? (window.clearInterval(timer), n) : n + 1)), 1200);
      },
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      window.clearInterval(timer);
    };
  }, [d]);
  return (
    <div ref={ref} className="flex h-full w-[calc(100%+2.5rem)] flex-col gap-4 rounded-xl border bg-background p-5 pb-8 pr-[3.75rem] shadow-sm">
      <div className="flex items-center gap-3">
        <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg text-xs font-medium text-white", d.color)}>{d.initials}</span>
        <span className="text-sm font-medium text-foreground">{d.name}</span>
        <span className="ml-auto text-sm tabular-nums">
          <span className={cn("font-medium", d.up ? "text-positive" : "text-negative")}>{d.pnl}</span>
          <span className="text-muted-foreground"> this month</span>
        </span>
      </div>
      {/* A longer summary fades out at the card's bottom edge. */}
      <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-hidden text-sm leading-relaxed text-foreground" style={FADE_OUT}>
        {d.message.map((p, k) => (
          <div key={k} className={cn("transition-opacity duration-700", k < shown ? "opacity-100" : "opacity-0")}>
            {p}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── The small cells ────────────────────────────────────────────────────────

/**
 * Triggers: the five-minute check as a slow log. Each line is a trigger that
 * just came true; some only get noted, some wake the analyst or start a sale.
 */
const CHECKS: ReadonlyArray<{ s: string; l: string; act?: string }> = [
  { s: "CRWD", l: "Closed below the $384 floor", act: "Selling position" },
  { s: "NVDA", l: "Fell 5% in a day", act: "Agent reviewing" },
  { s: "SHOP", l: "Crossed above its 50-day average" },
  { s: "AVGO", l: "Up 30% from our entry", act: "Trimming position" },
  { s: "MU", l: "Volume three times its average", act: "Agent reviewing" },
  { s: "LLY", l: "RSI under 30" },
  { s: "ANET", l: "Pulled back to its 20-day average", act: "Proposing a buy" },
  { s: "CEG", l: "Gapped up 6% at the open" },
];

export function TriggerLog() {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setInterval(() => setN((x) => x + 1), 11000);
    return () => window.clearInterval(id);
  }, []);
  const rows = Array.from({ length: 5 }, (_, k) => CHECKS[(n + CHECKS.length * 4 - k) % CHECKS.length]);
  return (
    // Fills its card, the rows spread from top to bottom.
    <ol className="ml-1 flex h-full w-full flex-col justify-between border-l">
      <li className="relative flex items-center py-1.5 pl-4 text-xs text-muted-foreground">
        <span className="absolute -left-[4.5px] size-2 animate-pulse rounded-full bg-foreground" />
        Listening for triggers
      </li>
      {rows.map((r, k) => (
        <li
          key={`${n}-${k}`}
          className={cn("relative flex items-center gap-2.5 py-1.5 pl-4 text-xs", k === 0 && "animate-in fade-in-0 slide-in-from-top-2 duration-700")}
          style={k > 2 ? { filter: `blur(${(k - 2) * 0.8}px)`, opacity: 1 - (k - 2) * 0.3 } : undefined}
        >
          <span className={cn("absolute -left-[3.5px] size-1.5 rounded-full", r.act ? "bg-foreground" : "bg-muted-foreground/40")} />
          <StockLogo ticker={r.s} size="xs" />
          <span className={cn("truncate", r.act ? "text-foreground" : "text-muted-foreground")}>{r.l}</span>
          {r.act ? <span className="ml-auto shrink-0 text-muted-foreground">{r.act}</span> : null}
        </li>
      ))}
    </ol>
  );
}

/** Approvals: a proposal waiting, the cursor resting on Approve. Still, on purpose: not every card moves. */
function ApprovalCard() {
  return (
    <div className="relative w-full rounded-xl border bg-background p-4 shadow-sm">
      <div className="flex items-center gap-2.5">
        <StockLogo ticker="CRWD" size="sm" />
        <span className="text-sm font-medium text-foreground">Sell 14 CRWD</span>
        <span className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground">
          <Clock className="size-3" />
          23h left
        </span>
      </div>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">Closed under the $384 floor. The drift after the beat is over, so the PEAD Specialist wants out.</p>
      <div className="mt-3 flex items-center gap-2">
        <span className={cn(buttonVariants({ variant: "outline", size: "sm" }), "flex-1")}>Decline</span>
        <span className={cn(buttonVariants({ size: "sm" }), "flex-1")}>Approve</span>
      </div>
      <MousePointer2 className="absolute bottom-3 right-16 size-4 fill-foreground text-background" />
    </div>
  );
}

/** Situations: the morning's work list, each stock with the reason it needs an answer today. */
const WORK = [
  { s: "CRWD", tag: "sale signal", l: "Closed under the $384 floor." },
  { s: "AMD", tag: "earnings", l: "Reports Thursday after the close." },
  { s: "NVDA", tag: "floor to fix", l: "Up 31%, with the floor still at our entry." },
  { s: "SNOW", tag: "review due", l: "Thirty days since the last look." },
  { s: "ANET", tag: "buy level reached", l: "Pulled back to the 20-day average." },
  { s: "LLY", tag: "your word unanswered", l: "Your note on Monday asked about the 50-day." },
];

function WorkList() {
  return (
    <div className="flex w-[calc(100%+2.5rem)] flex-col gap-3 rounded-xl border bg-background p-4 pr-[3.5rem] shadow-sm">
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        Morning run · 8:02 AM
        <ChevronRight className="size-3" />
      </span>
      <span className="text-sm font-medium text-foreground">Six stocks need an answer today</span>
      <ul className="flex flex-col gap-2.5">
        {WORK.map((w) => (
          <li key={w.s} className="flex items-start gap-2.5 text-xs">
            <StockLogo ticker={w.s} size="xs" />
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="flex items-center gap-1.5">
                <span className="font-medium text-foreground">{w.s}</span>
                <Badge variant="muted">{w.tag}</Badge>
              </span>
              <span className="text-muted-foreground">{w.l}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const CELLS: ReadonlyArray<{ slug: DocSlug; title: string; line: string; art: ReactNode; span?: string; big?: boolean; fit: "bleed" | "fill" | "inset" | "center" }> = [
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
    big: true,
    fit: "bleed",
  },
  { slug: "analysts", title: "Analysts", line: "A trading style with its own universe, sizing and sell rules. Every thesis belongs to one.", art: <AnalystDesk />, big: true, fit: "fill" },
  { slug: "triggers", title: "Triggers", line: "One sentence each, checked every five minutes. The one that comes true goes to the analyst.", art: <TriggerLog />, fit: "inset" },
  { slug: "approvals", title: "Approvals", line: "Analysts propose. You approve. A proposal expires after a day.", art: <ApprovalCard />, fit: "center" },
  { slug: "situations", title: "Situations", line: "The seventeen reasons a stock needs an answer today.", art: <WorkList />, fit: "bleed" },
];

export function ConceptCards({ onOpen }: { onOpen: (slug: DocSlug) => void }) {
  return (
    <div className="grid gap-3 lg:grid-cols-3">
      {CELLS.map((c) => (
        <div key={c.slug} className={cn("relative flex flex-col overflow-hidden rounded-lg border border-transparent bg-muted/50", c.big ? "h-[38rem]" : "h-96", c.span)}>
          <div className="flex flex-col items-start gap-1 p-5">
            {/* Only the title opens the doc. */}
            <button
              type="button"
              onClick={() => onOpen(c.slug)}
              className="group inline-flex items-center gap-1.5 rounded-sm text-base font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {c.title}
              <ArrowRight className="size-4 -translate-x-1 opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:translate-x-0 group-focus-visible:opacity-100" />
            </button>
            <span className="text-sm leading-6 text-muted-foreground">{c.line}</span>
          </div>
          <ArtFrame cell={c} />
        </div>
      ))}
    </div>
  );
}

type Cell = (typeof CELLS)[number];

/** The picture: a big one sits at the left padding and runs off the right and bottom edges; a small one sits in the space left. */
function ArtFrame({ cell: c, top = "top-1" }: { cell: Cell; top?: string }) {
  return (
    <div className="pointer-events-none relative min-h-0 flex-1" aria-hidden>
      {c.fit === "bleed" ? (
        <div className={cn("absolute left-5 right-0", top)}>{c.art}</div>
      ) : c.fit === "inset" ? (
        <div className={cn("absolute bottom-5 left-5 right-5", top)}>{c.art}</div>
      ) : c.fit === "fill" ? (
        // Runs a little past the bottom edge, so the card's own bottom never shows.
        <div className={cn("absolute -bottom-6 left-5 right-0", top)}>{c.art}</div>
      ) : (
        <div className="mx-auto flex h-full w-full max-w-md items-center px-5 pb-5">{c.art}</div>
      )}
    </div>
  );
}

/** A concept's card picture without its words, as the opening picture of its doc. */
export function ConceptHero({ slug }: { slug: string }) {
  const c = CELLS.find((x) => x.slug === slug);
  if (!c) return null;
  // A doc is wider than the home page's card, so the sheet is drawn larger to still run off the edge.
  const cell = slug === "theses" ? { ...c, art: <div style={{ zoom: 0.75 }}><SheetMock /></div> } : c;
  return (
    <div className={cn("relative flex flex-col overflow-hidden rounded-lg bg-muted/50", c.big ? "h-[30rem]" : "h-80")}>
      <ArtFrame cell={cell} top="top-5" />
    </div>
  );
}
