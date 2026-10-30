"use client";

/**
 * One request to the model, drawn as squares of 1,000 characters. Every
 * agent gets the same parts: its job prompt, the house rules, the analyst
 * brief, its tool menu and the read, with situation guidance and a full row
 * added only when needed (drawn outlined). Picking an agent changes the
 * sizes, never the parts. Hovering a line lights its squares.
 */

import { useState, type CSSProperties } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUpRight } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DOOR_COPY, MEASURED_REQUEST, type FrameworkData, type FrameworkDoorId } from "@/lib/docs/framework-content";
import { cn } from "@/lib/utils";
import { Mono } from "../primitives";

type PartId = "job" | "house" | "analyst" | "tools" | "read" | "guidance" | "named";

/** How each part's squares are drawn. Solid parts ride on every request; outlined ones are added when needed. */
const SWATCH: Record<PartId, { className: string; style?: CSSProperties }> = {
  job: { className: "bg-foreground/70" },
  house: { className: "bg-sky-400" },
  analyst: { className: "bg-violet-400" },
  tools: { className: "bg-brand" },
  read: { className: "bg-blue-500" },
  guidance: { className: "border border-dashed border-muted-foreground bg-muted-foreground/35" },
  named: { className: "border border-dashed border-muted-foreground/50 bg-muted-foreground/10" },
};

interface Part {
  id: PartId;
  label: string;
  body: string;
  /** Characters; null when it varies too much to print one number. Squares still need a size. */
  chars: number | null;
  squares: number;
  source: string;
  href?: string;
  hrefLabel?: string;
}

const fmt = (n: number) => n.toLocaleString("en-US");
const squaresOf = (n: number) => Math.max(1, Math.round(n / 1000));

/** The agents to pick between, in the order a stock meets them. */
const AGENTS: ReadonlyArray<{ id: Exclude<FrameworkDoorId, "writer">; label: string }> = [
  { id: "morning", label: "Morning" },
  { id: "trigger", label: "Trigger" },
  { id: "chat", label: "Chat" },
];

/** How big the read is at each door. Only the morning's is measured; the rest are drawn at a typical size. */
const READ: Record<(typeof AGENTS)[number]["id"], { chars: number | null; squares: number; source: string }> = {
  morning: { chars: MEASURED_REQUEST.after.read, squares: squaresOf(MEASURED_REQUEST.after.read), source: "Measured on a real request" },
  trigger: { chars: null, squares: 7, source: "One stock's row, up to about 7,000" },
  chat: { chars: null, squares: 7, source: "Varies with the conversation" },
};

/** An example day: three flags up somewhere on the book. Their texts' real lengths. */
const EXAMPLE_FLAGS = ["PROTECTION", "REVIEW_DUE", "EARNINGS"];

/** `linkBase` puts the page in front of the in-page links when the picture sits outside the Framework page. */
export function RequestGrid({ data, linkBase = "" }: { data: FrameworkData; linkBase?: string }) {
  const [agent, setAgent] = useState<(typeof AGENTS)[number]["id"]>("morning");
  const [hover, setHover] = useState<PartId | null>(null);

  const door = data.doors.find((d) => d.id === agent);
  const job = (door?.promptChars ?? 0) - (door?.houseRules ? data.houseRulesChars : 0);
  const flags = data.situations.filter((s) => EXAMPLE_FLAGS.includes(s.code));
  const guidanceChars = flags.reduce((a, s) => a + s.chars, 0);
  const read = READ[agent];

  const always: Part[] = [
    { id: "job", label: "Job prompt", body: DOOR_COPY[agent].job, chars: job, squares: squaresOf(job), source: "Measured from this deploy" },
    { id: "house", label: "House rules", body: "The few sentences true for every analyst everywhere: your word first, and how to write.", chars: data.houseRulesChars, squares: squaresOf(data.houseRulesChars), source: "Measured from this deploy" },
    { id: "analyst", label: "Analyst brief", body: "Who it works for: the strategy you wrote, word for word, its rule numbers, how full it is, its setups.", chars: MEASURED_REQUEST.after.analystBrief, squares: squaresOf(MEASURED_REQUEST.after.analystBrief), source: "Measured on the Compounder" },
    { id: "tools", label: "Tool menu", body: `The ${door?.tools.length ?? ""} tools it may call, each described in full on every request, used or not.`, chars: door?.toolChars ?? 0, squares: squaresOf(door?.toolChars ?? 0), source: "Measured from this deploy", href: "/how-it-works#tools", hrefLabel: "Catalog" },
    { id: "read", label: "The read", body: DOOR_COPY[agent].read, chars: read.chars, squares: read.squares, source: read.source, href: `${linkBase}#read`, hrefLabel: "Zoom in" },
  ];
  const whenNeeded: Part[] = [
    { id: "guidance", label: "Situation guidance", body: `The instructions for each flag that is up, once per read. On this example day: ${flags.map((s) => s.name).join(", ")}.`, chars: guidanceChars, squares: squaresOf(guidanceChars), source: "Measured from this deploy", href: `${linkBase}#situations`, hrefLabel: "How" },
    { id: "named", label: "A full row, by name", body: "When it asks for one stock by name: the research, the bull and bear cases, the history.", chars: null, squares: 20, source: "About 20,000, varies with the stock" },
  ];

  const parts = [...always, ...whenNeeded];
  const cells: PartId[] = parts.flatMap((p) => Array<PartId>(p.squares).fill(p.id));

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <div className="flex min-w-0 flex-col">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">On every request</p>
        <ul className="flex flex-col">
          {always.map((p) => (
            <PartRow key={p.id} part={p} hover={hover} setHover={setHover} />
          ))}
        </ul>
        <p className="pt-6 text-xs font-medium uppercase tracking-wide text-muted-foreground">Added when needed</p>
        <ul className="flex flex-col">
          {whenNeeded.map((p) => (
            <PartRow key={p.id} part={p} hover={hover} setHover={setHover} />
          ))}
          <li className="flex flex-col gap-1 border-b border-dashed py-3">
            <span className="text-sm font-medium text-foreground">What its tools bring back</span>
            <span className="text-sm text-muted-foreground">
              Every result joins the conversation and is sent again on each request after it. It grows as the run goes, so it isn&apos;t drawn.
            </span>
          </li>
        </ul>
      </div>

      <div
        className="flex min-w-0 flex-col gap-5 self-start rounded-2xl border bg-muted/40 p-5 sm:p-6 lg:sticky lg:top-6"
        style={{ backgroundImage: "radial-gradient(var(--border) 1px, transparent 1.3px)", backgroundSize: "18px 18px" }}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Tabs value={agent} onValueChange={(v) => setAgent(v as typeof agent)}>
            <TabsList size="sm">
              {AGENTS.map((a) => (
                <TabsTrigger key={a.id} value={a.id}>{a.label}</TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <Mono className="text-xs text-muted-foreground tabular-nums">{cells.length} squares</Mono>
        </div>
        <div className="grid grid-cols-12 gap-1 sm:grid-cols-16 sm:gap-1.5" aria-hidden>
          {cells.map((id, i) => (
            <span
              key={`${agent}-${i}`}
              className={cn(
                "aspect-square rounded-sm transition-opacity duration-300 animate-in fade-in-0 zoom-in-50",
                SWATCH[id].className,
                hover && hover !== id && "opacity-15",
              )}
              style={{ ...SWATCH[id].style, animationDelay: `${Math.min(i * 4, 900)}ms`, animationFillMode: "backwards" }}
            />
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Each square is 1,000 characters, about 250 tokens. Solid squares ride on every request; outlined ones are added when needed. Point at a line to find
          its squares.
        </p>
      </div>
    </div>
  );
}

function PartRow({ part, hover, setHover }: { part: Part; hover: PartId | null; setHover: (id: PartId | null) => void }) {
  const sw = SWATCH[part.id];
  return (
    <li
      className={cn("flex flex-col gap-1 border-b py-3 transition-opacity", hover && hover !== part.id && "opacity-50")}
      onMouseEnter={() => setHover(part.id)}
      onMouseLeave={() => setHover(null)}
    >
      <div className="flex items-center gap-2.5">
        <span className={cn("size-2.5 shrink-0 rounded-[3px]", sw.className)} style={sw.style} />
        <span className="text-sm font-medium text-foreground">{part.label}</span>
        <span className="ml-auto text-sm text-foreground tabular-nums">{part.chars != null ? fmt(part.chars) : "Varies"}</span>
      </div>
      <p className="pl-5 text-sm text-muted-foreground">{part.body}</p>
      <div className="flex items-center gap-3 pl-5 text-xs text-muted-foreground">
        <span>{part.source}</span>
        {part.href ? (
          part.href.startsWith("#") ? (
            <a href={part.href} className="inline-flex items-center gap-0.5 hover:text-foreground">
              {part.hrefLabel}
              <ArrowDown className="size-3" />
            </a>
          ) : (
            <Link href={part.href} className="inline-flex items-center gap-0.5 hover:text-foreground">
              {part.hrefLabel}
              <ArrowUpRight className="size-3" />
            </Link>
          )
        ) : null}
      </div>
    </li>
  );
}
