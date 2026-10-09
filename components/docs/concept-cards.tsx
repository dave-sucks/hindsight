"use client";

/**
 * The Guide's concepts as a bento in Framer's style: one frame split by
 * hairlines, each cell a picture with its words inside it, no inner cards.
 *
 *   Theses and analysts, full width: a miniature of the thesis sheet with
 *   the chat floating over it, talking about the book.
 *   Then four small cells, kept minimal: triggers as a live check feed,
 *   situations as a book of dots, a proposal waiting for a yes, the clock.
 *
 * Every ticker and number is an example.
 */

import { useEffect, useState, type ReactNode } from "react";
import { Area, AreaChart } from "recharts";
import { ArrowRight, ArrowUpRight, Clock, Flag } from "lucide-react";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import { cn } from "@/lib/utils";
import { ChatMock, Tk } from "./chat-mock";
import { Mono } from "./primitives";
import type { DocSlug } from "./registry";
import { PillRow } from "./trigger-bits";

const FADE_BOTTOM = { maskImage: "linear-gradient(to bottom, black 60%, transparent)", WebkitMaskImage: "linear-gradient(to bottom, black 60%, transparent)" };

// ── The big cell: a thesis sheet with the chat over it ─────────────────────

/** A day's tape for the chart: a gentle climb with some noise, the same every render. */
const TAPE = Array.from({ length: 64 }, (_, i) => ({ i, v: 404 + i * 0.42 + Math.sin(i * 0.9) * 2.4 + Math.sin(i * 0.23) * 3 }));
const CHART: ChartConfig = { v: { label: "Price", color: "var(--positive)" } };

/** The thesis sheet, drawn at full size and shown as a miniature. */
function SheetMock() {
  return (
    <div className="flex w-[40rem] flex-col gap-5 rounded-2xl border bg-background p-7 shadow-sm">
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-sm text-foreground">
          <span className="size-1.5 rounded-full bg-blue-500" />
          Holding
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-sm text-foreground">High conviction</span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-2.5 py-1 text-sm text-amber-500">
          <Flag className="size-3.5" />
          Floor to fix
        </span>
      </div>
      <div className="flex items-center gap-3">
        <span className="grid size-12 place-items-center rounded-xl bg-red-500 text-lg font-bold text-white">C</span>
        <span className="flex flex-col">
          <span className="text-2xl font-medium text-foreground">CrowdStrike</span>
          <Mono className="text-sm text-muted-foreground">CRWD · NASDAQ</Mono>
        </span>
      </div>
      <p className="flex items-baseline gap-3 text-3xl font-medium tabular-nums">
        <span className="text-foreground">$431.80</span>
        <span className="text-positive">+$6.12</span>
        <span className="text-positive">↗ 1.44%</span>
      </p>
      <div className="flex items-center justify-between rounded-xl border px-4 py-3 text-base">
        <span className="flex flex-col gap-0.5">
          <span className="text-foreground">Bought 14 shares at $404.10, now trading at $431.80</span>
          <span className="text-sm text-muted-foreground">Opened Oct 5 · 4d held · View trade →</span>
        </span>
        <span className="text-positive tabular-nums">+$387.80 ↗ 6.85%</span>
      </div>
      <p className="text-xl leading-snug text-foreground">Drifts toward $480 over two months as estimates rise; the beat and raise held its gap on heavy volume.</p>
      <p className="text-sm text-muted-foreground">PEAD Specialist · written Oct 5</p>
      <div className="h-36 rounded-xl border p-3">
        <ChartContainer config={CHART} className="h-full w-full">
          <AreaChart data={TAPE} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="docs-sheet-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--color-v)" stopOpacity={0.25} />
                <stop offset="100%" stopColor="var(--color-v)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <Area dataKey="v" type="monotone" stroke="var(--color-v)" strokeWidth={1.5} fill="url(#docs-sheet-fill)" isAnimationActive={false} />
          </AreaChart>
        </ChartContainer>
      </div>
      <div className="flex flex-col gap-2">
        <PillRow action="EXIT" specs={[{ action: "EXIT", when: { watch: "price", is: "below", value: 384 }, why: "The floor." }]} />
        <PillRow action="REVIEW" specs={[{ action: "REVIEW", when: { watch: "report", is: "before", value: 7 }, why: "A week before the print." }]} />
      </div>
    </div>
  );
}

function BookCell({ onOpen }: { onOpen: (slug: DocSlug) => void }) {
  return (
    <div className="relative flex min-h-[40rem] flex-col overflow-hidden bg-background lg:col-span-3">
      {/* The sheet, as a miniature, sitting in the cell. */}
      <div className="pointer-events-none absolute left-6 top-8 origin-top-left scale-[0.62] sm:left-10 lg:left-16" style={FADE_BOTTOM} aria-hidden>
        <SheetMock />
      </div>
      {/* The chat, floating over it. */}
      <div className="pointer-events-none absolute right-6 top-10 hidden w-[22rem] flex-col gap-1 rounded-2xl border bg-popover/95 p-4 shadow-xl backdrop-blur-sm md:flex lg:right-16" aria-hidden>
        <ChatMock
          bare
          title="Chat"
          steps={[
            { kind: "user", text: "What am I holding, and does anything need me today?" },
            {
              kind: "tools",
              label: "Reading your book",
              rows: [
                { ticker: "AAPL", tag: "Quiet", text: "25 shares · up 5.7%" },
                { ticker: "NVDA", tag: "Quiet", text: "40 shares · up 21.4%" },
                { ticker: "CRWD", tag: "Floor to fix", text: "14 shares · up 6.9% · floor under cost" },
              ],
            },
            { kind: "text", text: <>Six holdings, five quiet. <Tk s="CRWD" c={1.44} /> is up 7% with its floor still under what we paid; I&apos;d raise it to $410.</> },
          ]}
        />
      </div>
      <div className="relative mt-auto flex flex-col gap-3 bg-gradient-to-t from-background via-background to-transparent p-6 pt-24 sm:p-10 sm:pt-24">
        <p className="max-w-md text-base leading-7">
          <span className="font-medium text-foreground">Theses and analysts.</span>{" "}
          <span className="text-muted-foreground">
            Every stock carries a thesis: a belief, a plan and the triggers that act on it. Every thesis belongs to an analyst, a trading style with its own rules.
          </span>
        </p>
        <span className="flex gap-5">
          <CellLink onClick={() => onOpen("theses")}>Theses</CellLink>
          <CellLink onClick={() => onOpen("analysts")}>Analysts</CellLink>
        </span>
      </div>
    </div>
  );
}

function CellLink({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex items-center gap-1 text-sm font-medium text-foreground underline-offset-4 hover:underline">
      {children}
      <ArrowRight className="size-3.5" />
    </button>
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

/** Under the hood: the morning's clock. */
function Morning() {
  return (
    <ol className="flex flex-col gap-2 text-sm" style={FADE_BOTTOM}>
      {[
        ["06:25", "Sources checked"],
        ["06:30", "Chart numbers"],
        ["08:00", "Morning runs"],
        ["16:20", "Close pass"],
      ].map(([t, l], i) => (
        <li key={t} className="flex items-center gap-3">
          <Mono className="text-xs text-muted-foreground tabular-nums">{t}</Mono>
          <span className={i === 2 ? "text-foreground" : "text-muted-foreground"}>{l}</span>
        </li>
      ))}
    </ol>
  );
}

const SMALL: ReadonlyArray<{ slug: DocSlug; title: string; line: string; art: ReactNode; span: string }> = [
  { slug: "triggers", title: "Triggers", line: "One sentence each, checked every five minutes. The one that comes true goes to the analyst.", art: <TriggerFeed />, span: "lg:col-span-2" },
  { slug: "situations", title: "Situations", line: "The sixteen reasons a stock needs an answer today.", art: <Dots />, span: "" },
  { slug: "approvals", title: "Approvals", line: "Analysts propose. You approve. A proposal expires after a day.", art: <Proposal />, span: "" },
  { slug: "under-the-hood", title: "Under the hood", line: "Data sources, schedules, models and the prompts themselves.", art: <Morning />, span: "lg:col-span-2" },
];

export function ConceptCards({ onOpen }: { onOpen: (slug: DocSlug) => void }) {
  return (
    // One frame; the 1px gaps over the border color are the hairlines between cells.
    <div className="grid gap-px overflow-hidden rounded-2xl border bg-border lg:grid-cols-3">
      <BookCell onOpen={onOpen} />
      {SMALL.map((c) => (
        <div key={c.slug} className={cn("group relative flex min-h-80 flex-col bg-background has-[button:focus-visible]:ring-2 has-[button:focus-visible]:ring-inset has-[button:focus-visible]:ring-ring", c.span)}>
          <button type="button" onClick={() => onOpen(c.slug)} className="absolute inset-0 z-10 focus-visible:outline-none" aria-label={`Open ${c.title}`} />
          <div className="pointer-events-none flex flex-1 items-center justify-center px-6 pt-8" aria-hidden>
            {c.art}
          </div>
          <p className="p-6 text-sm leading-6 sm:px-8">
            <span className="inline-flex items-center gap-1 font-medium text-foreground">
              {c.title}
              <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
            </span>{" "}
            <span className="text-muted-foreground">{c.line}</span>
          </p>
        </div>
      ))}
    </div>
  );
}
