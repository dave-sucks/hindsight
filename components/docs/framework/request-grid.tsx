"use client";

/**
 * One request to the model, drawn as squares of 1,000 characters: the parts
 * every request carries, then the ones pulled in only when needed. Two
 * states: the Oct 2 request and the same request today, after the rebuild.
 * Hovering a line lights its squares; the toggles add the optional parts.
 */

import { useState, type CSSProperties } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUpRight } from "lucide-react";
import { ChipTabs } from "@/components/ui/chip-tabs";
import { Switch } from "@/components/ui/switch";
import { MEASURED_REQUEST, type FrameworkData } from "@/lib/docs/framework-content";
import { cn } from "@/lib/utils";
import { Mono } from "../primitives";

type PartId = "job" | "house" | "analyst" | "tools" | "read" | "instructions" | "guidance" | "named";

const STRIPES: CSSProperties = {
  backgroundImage: "repeating-linear-gradient(135deg, var(--muted-foreground) 0 1.5px, transparent 1.5px 4px)",
};

/** How each part's squares are drawn. */
const SWATCH: Record<PartId, { className: string; style?: CSSProperties }> = {
  job: { className: "bg-foreground/70" },
  instructions: { className: "bg-foreground/70" },
  house: { className: "bg-sky-400" },
  analyst: { className: "bg-violet-400" },
  tools: { className: "border border-muted-foreground/40 opacity-70", style: STRIPES },
  read: { className: "bg-blue-500" },
  guidance: { className: "border border-dashed border-sky-400 bg-sky-400/15" },
  named: { className: "border border-dashed border-blue-500 bg-blue-500/10" },
};

interface Part {
  id: PartId;
  label: string;
  body: string;
  chars: number;
  source: string;
  href?: string;
  hrefLabel?: string;
}

const fmt = (n: number) => n.toLocaleString("en-US");
const squares = (n: number) => Math.max(1, Math.round(n / 1000));

/** An example day: three flags up somewhere on the book. Their texts' real lengths. */
const EXAMPLE_FLAGS = ["PROTECTION", "REVIEW_DUE", "EARNINGS"];

export function RequestGrid({ data }: { data: FrameworkData }) {
  const [when, setWhen] = useState<"before" | "after">("after");
  const [hover, setHover] = useState<PartId | null>(null);
  const [flags, setFlags] = useState(false);
  const [named, setNamed] = useState(false);

  const morning = data.doors.find((d) => d.id === "morning");
  const job = (morning?.promptChars ?? 0) - (morning?.houseRules ? data.houseRulesChars : 0);
  const guidanceChars = data.situations.filter((s) => EXAMPLE_FLAGS.includes(s.code)).reduce((a, s) => a + s.chars, 0);
  const flagNames = data.situations.filter((s) => EXAMPLE_FLAGS.includes(s.code)).map((s) => s.name);

  const always: Part[] =
    when === "after"
      ? [
          { id: "job", label: "Job prompt", body: "What this door is for and what woke it: here, the morning's walk through the book.", chars: job, source: "measured" },
          { id: "house", label: "House rules", body: "The few sentences true for every analyst everywhere: your word first, and how to write.", chars: data.houseRulesChars, source: "measured" },
          { id: "analyst", label: "Analyst brief", body: "Who it works for: the strategy you wrote, word for word, its rule numbers, how full it is, its setups.", chars: MEASURED_REQUEST.after.analystBrief, source: "Measured on the Compounder" },
          { id: "tools", label: "Tool menu", body: `The ${morning?.tools.length ?? ""} tools it may call, each described in full on every request, used or not.`, chars: morning?.toolChars ?? 0, source: "measured", href: "/docs#tools", hrefLabel: "Catalog" },
          { id: "read", label: "The read", body: "Your book: every holding and watch, each at the size today needs.", chars: MEASURED_REQUEST.after.read, source: "Measured on a real request", href: "#read", hrefLabel: "Zoom in" },
        ]
      : [
          { id: "instructions", label: "Instructions", body: "The job, the analyst written out its own way at each door, and a lecture on every situation whether a stock was in it or not.", chars: MEASURED_REQUEST.before.instructions, source: "Oct 2 · a real request" },
          { id: "tools", label: "Tool menu", body: "Every tool, with descriptions that had grown for months.", chars: MEASURED_REQUEST.before.tools, source: "Oct 2" },
          { id: "read", label: "The read", body: "Every stock in full, every time: about 27,000 characters each.", chars: MEASURED_REQUEST.before.read, source: "Oct 2" },
        ];

  const extras: Array<Part & { on: boolean; set: (v: boolean) => void }> =
    when === "after"
      ? [
          { id: "guidance", label: "Situation guidance", body: `The instructions for each flag that is up, once per read. On this example day: ${flagNames.join(", ")}.`, chars: guidanceChars, source: "measured", href: "#situations", hrefLabel: "How", on: flags, set: setFlags },
          { id: "named", label: "A full row, by name", body: "When it asks for one stock by name: the research, the bull and bear cases, the history.", chars: 20_000, source: "about", on: named, set: setNamed },
        ]
      : [];

  const cells: PartId[] = [...always, ...extras.filter((e) => e.on)].flatMap((p) => Array<PartId>(squares(p.chars)).fill(p.id));
  const total = [...always, ...extras.filter((e) => e.on)].reduce((a, p) => a + p.chars, 0);
  const oct2 = MEASURED_REQUEST.before.instructions + MEASURED_REQUEST.before.tools + MEASURED_REQUEST.before.read;

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col">
        <div className="flex items-baseline justify-between gap-3 border-b pb-4">
          <span className="text-sm text-muted-foreground">One morning request</span>
          <span className="text-2xl font-medium tracking-tight text-foreground tabular-nums">{fmt(total)}</span>
        </div>
        <p className="pt-4 text-xs font-medium uppercase tracking-wide text-muted-foreground">Sent with every request</p>
        <ul className="flex flex-col">
          {always.map((p) => (
            <PartRow key={p.id} part={p} hover={hover} setHover={setHover} />
          ))}
        </ul>
        {extras.length ? (
          <>
            <p className="pt-6 text-xs font-medium uppercase tracking-wide text-muted-foreground">Pulled in when needed</p>
            <ul className="flex flex-col">
              {extras.map((p) => (
                <PartRow key={p.id} part={p} hover={hover} setHover={setHover} toggle={{ on: p.on, set: p.set }} />
              ))}
              <li className="flex flex-col gap-1 border-b border-dashed py-3">
                <span className="text-sm font-medium text-foreground">What its tools bring back</span>
                <span className="text-sm text-muted-foreground">
                  Every result joins the conversation and is sent again on each of a morning&apos;s ~{MEASURED_REQUEST.requestsPerMorning} requests. It grows as the run goes, so it isn&apos;t drawn.
                </span>
              </li>
            </ul>
          </>
        ) : null}
      </div>

      <div
        className="flex min-w-0 flex-col gap-5 self-start rounded-2xl border bg-muted/40 p-5 sm:p-6 lg:sticky lg:top-6"
        style={{ backgroundImage: "radial-gradient(var(--border) 1px, transparent 1.3px)", backgroundSize: "18px 18px" }}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <ChipTabs
            variant="tray"
            clearable={false}
            value={when}
            onChange={(v) => v && setWhen(v)}
            options={[
              { value: "before", label: MEASURED_REQUEST.before.date },
              { value: "after", label: "Today" },
            ]}
          />
          <Mono className="text-xs text-muted-foreground tabular-nums">
            {cells.length} squares · {when === "after" ? `${Math.round((1 - total / oct2) * 100)}% smaller than Oct 2` : "before the rebuild"}
          </Mono>
        </div>
        <div className="grid grid-cols-12 gap-1 sm:grid-cols-20 sm:gap-1.5" aria-hidden>
          {cells.map((id, i) => (
            <span
              key={`${when}-${i}`}
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
          Each square is 1,000 characters, about 250 tokens. Point at a line to find its squares.
        </p>
      </div>
    </div>
  );
}

function PartRow({
  part,
  hover,
  setHover,
  toggle,
}: {
  part: Part;
  hover: PartId | null;
  setHover: (id: PartId | null) => void;
  toggle?: { on: boolean; set: (v: boolean) => void };
}) {
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
        <span className="ml-auto flex items-center gap-2.5">
          <span className="text-sm text-foreground tabular-nums">
            {toggle ? "+" : ""}
            {part.source === "about" ? "~" : ""}
            {fmt(part.chars)}
          </span>
          {toggle ? <Switch checked={toggle.on} onCheckedChange={toggle.set} aria-label={`Add ${part.label}`} /> : null}
        </span>
      </div>
      <p className="pl-5 text-sm text-muted-foreground">{part.body}</p>
      <div className="flex items-center gap-3 pl-5 text-xs text-muted-foreground">
        <span>{part.source === "measured" ? "Measured from this deploy" : part.source === "about" ? "Varies with the stock" : part.source}</span>
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
