"use client";

/**
 * The Guide's concepts as a bento of cards: each one a small, abstracted
 * picture of the idea on a quiet panel, then its name and one line. Built
 * from the product's own pieces where it can (real trigger pills, the
 * proposal's words, the morning's clock) and faded at the edges, so it
 * reads as a hint of the screen, not the screen. A card opens its page.
 */

import type { ReactNode } from "react";
import { Check, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { Mono } from "./primitives";
import type { DocSlug } from "./registry";
import { PillRow } from "./trigger-bits";

const FADE = { maskImage: "linear-gradient(to bottom, black 55%, transparent)", WebkitMaskImage: "linear-gradient(to bottom, black 55%, transparent)" };

/** A thesis, abstracted: the stock, its belief, and the three levels of its plan. */
function ThesisArt() {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-3 rounded-xl border bg-background p-4 shadow-sm" style={FADE}>
      <div className="flex items-center gap-2">
        <span className="grid size-6 place-items-center rounded-md bg-muted text-xs font-semibold text-foreground">C</span>
        <span className="text-sm font-medium text-foreground">CRWD</span>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">Watching</span>
        <span className="ml-auto text-sm text-foreground tabular-nums">$418.20</span>
      </div>
      <p className="text-sm text-foreground">Drifts toward $480 over two months as estimates rise.</p>
      <div className="grid grid-cols-3 gap-2">
        {[
          ["Buy", "$401"],
          ["Floor", "$384"],
          ["Target", "$480"],
        ].map(([k, v]) => (
          <span key={k} className="flex flex-col gap-0.5 rounded-lg border px-2.5 py-1.5">
            <span className="text-xs text-muted-foreground">{k}</span>
            <span className="text-sm text-foreground tabular-nums">{v}</span>
          </span>
        ))}
      </div>
      <span className="h-2 w-4/5 rounded-full bg-muted" />
      <span className="h-2 w-3/5 rounded-full bg-muted" />
    </div>
  );
}

/** Triggers: the thesis sheet's own pills, and one that just fired. */
function TriggerArt() {
  return (
    <div className="flex w-full flex-col gap-3">
      <PillRow action="EXIT" specs={[{ action: "EXIT", when: { watch: "price", is: "below", value: 384 }, why: "The floor." }]} />
      <div className="relative">
        <PillRow action="ENTER" held={false} specs={[{ action: "ENTER", when: { watch: "move", is: "near", value: 2, variable: "sma20" }, why: "The buy." }]} />
        <span className="absolute -top-2.5 right-0 inline-flex items-center gap-1 rounded-full bg-positive/15 px-2 py-0.5 text-xs font-medium text-positive">
          <Check className="size-3" />
          Triggered
        </span>
      </div>
      <PillRow action="REVIEW" specs={[{ action: "REVIEW", when: { watch: "repeat", value: 30 }, why: "A fresh look." }]} />
    </div>
  );
}

/** Analysts: a short roster, each with its style. */
function AnalystArt() {
  const rows = [
    { n: "PEAD Specialist", s: "Post-earnings drift", c: "bg-blue-500" },
    { n: "Secular Compounder", s: "Long-term compounders", c: "bg-violet-400" },
    { n: "Catalyst Event PM", s: "Dated events", c: "bg-sky-400" },
  ];
  return (
    <div className="flex w-full flex-col gap-1.5" style={FADE}>
      {rows.map((r, i) => (
        <span key={r.n} className={cn("flex items-center gap-3 rounded-lg px-3 py-2", i === 0 ? "bg-background shadow-sm ring-1 ring-border" : "")}>
          <span className={cn("size-2 rounded-full", r.c)} />
          <span className="text-sm font-medium text-foreground">{r.n}</span>
          <span className="ml-auto text-xs text-muted-foreground">{r.s}</span>
        </span>
      ))}
    </div>
  );
}

/** Situations: a book of dots, a few lit, two of them named. */
function SituationArt() {
  const lit: Record<number, string> = { 9: "earnings", 22: "buy level reached", 31: "" };
  return (
    <div className="relative grid w-full max-w-md grid-cols-12 gap-x-2 gap-y-3">
      {Array.from({ length: 36 }, (_, i) => (
        <span key={i} className="relative grid place-items-center">
          <span className={cn("size-2.5 rounded-full border", i in lit ? "border-blue-500 bg-blue-500" : "border-muted-foreground/40")} />
          {lit[i] ? (
            <span className="absolute left-1/2 top-4 z-10 -translate-x-1/2 whitespace-nowrap rounded-md border bg-background px-1.5 py-0.5 text-xs text-foreground shadow-sm">{lit[i]}</span>
          ) : null}
        </span>
      ))}
    </div>
  );
}

/** Approvals: a proposal waiting for a yes. */
function ApprovalArt() {
  return (
    <div className="flex w-full max-w-xs flex-col gap-3 rounded-xl border bg-background p-4 shadow-sm">
      <span className="text-xs text-muted-foreground">Trigger run · CRWD</span>
      <span className="text-sm text-foreground">
        Buy <span className="font-medium">14 shares</span> of CRWD at about $404
      </span>
      <span className="flex items-center gap-2">
        <span className="rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground">Approve</span>
        <span className="rounded-md border px-2.5 py-1 text-xs text-foreground">Decline</span>
        <span className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground">
          <Clock className="size-3" />
          23h
        </span>
      </span>
    </div>
  );
}

/** Under the hood: the day's clock. */
function ClockArt() {
  const rows = [
    ["06:25", "Every data source checked"],
    ["06:30", "Chart numbers for every trigger"],
    ["08:00", "Morning runs"],
    ["9:30–4", "Triggers checked every 5 minutes"],
    ["16:20", "The close pass"],
  ];
  return (
    <ol className="flex w-full max-w-sm flex-col" style={FADE}>
      {rows.map(([t, l], i) => (
        <li key={t} className="flex items-center gap-3 border-l py-1.5 pl-4">
          <span className={cn("-ml-[1.3rem] size-2 rounded-full", i === 2 ? "bg-foreground" : "bg-muted-foreground/40")} />
          <Mono className="w-14 text-xs text-muted-foreground tabular-nums">{t}</Mono>
          <span className={cn("text-sm", i === 2 ? "text-foreground" : "text-muted-foreground")}>{l}</span>
        </li>
      ))}
    </ol>
  );
}

const CARDS: ReadonlyArray<{ slug: DocSlug; title: string; line: string; art: ReactNode; span: string }> = [
  { slug: "theses", title: "Theses", line: "A belief we can be wrong about, and the plan that acts on it.", art: <ThesisArt />, span: "lg:col-span-4" },
  { slug: "triggers", title: "Triggers", line: "One sentence each: sell below, buy near, look again in 30 days.", art: <TriggerArt />, span: "lg:col-span-2" },
  { slug: "analysts", title: "Analysts", line: "A trading style with its own universe, sizing and sell rules.", art: <AnalystArt />, span: "lg:col-span-2" },
  { slug: "situations", title: "Situations", line: "The sixteen reasons a stock needs an answer today, worked out on every read.", art: <SituationArt />, span: "lg:col-span-4" },
  { slug: "approvals", title: "Approvals", line: "Analysts propose. You approve. A proposal expires after a day.", art: <ApprovalArt />, span: "lg:col-span-3" },
  { slug: "under-the-hood", title: "Under the hood", line: "Data sources, schedules, models and the prompts themselves.", art: <ClockArt />, span: "lg:col-span-3" },
];

export function ConceptCards({ onOpen }: { onOpen: (slug: DocSlug) => void }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
      {CARDS.map((c) => (
        <div
          key={c.slug}
          className={cn(
            "group relative flex min-w-0 flex-col overflow-hidden rounded-2xl border bg-card transition-colors hover:border-foreground/20 has-[button:focus-visible]:ring-2 has-[button:focus-visible]:ring-ring",
            c.span,
          )}
        >
          {/* The whole card opens the page; a layered button, so the art's own controls aren't nested in it. */}
          <button type="button" onClick={() => onOpen(c.slug)} className="absolute inset-0 z-20 focus-visible:outline-none" aria-label={`Open ${c.title}`} />
          <div className="pointer-events-none flex h-56 items-center justify-center overflow-hidden bg-muted/40 px-6 py-6">{c.art}</div>
          <p className="p-5 text-sm leading-6">
            <span className="font-medium text-foreground">{c.title}</span> <span className="text-muted-foreground">{c.line}</span>
          </p>
        </div>
      ))}
    </div>
  );
}
