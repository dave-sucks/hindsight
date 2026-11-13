"use client";

/**
 * The workflow, as the code runs it. Row 1: the agents outside the loop
 * (Discovery, the Portfolio Digest, the Market Reviewer). Row 2: the Writer.
 * Row 3: a thesis, the three agents that answer it, and what they leave
 * (run-outputs.tsx), fed through one bus since any of them can leave any of
 * the four: notes, edits and trades land back on the stock, stale research
 * goes back to the Writer. An agent card's bar is what
 * wakes it, its schedule is its doc's "Starts", and its chips are what it is
 * sent (lib/docs/agent-context.ts, the list its doc shows). The two digests
 * have no arrow: the amber chip each writes is the chip on the agents below.
 * The wires are measured from the nodes; on a phone the cards stack and the
 * wires drop away. Every ticker and number is an example.
 */

import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { ContextChip, ContextChips } from "@/components/domain/context-chip";
import { StockLogo } from "@/components/StockLogo";
import { PriceChange } from "@/components/ui/price-change";
import { rowLabel } from "@/lib/agent/triggers/condition";
import { fireModeLabel } from "@/lib/agent/triggers/fire-mode";
import { AGENT_CONTEXT, CHIPS_SHOWN, MARKET_DIGEST, PORTFOLIO_DIGEST, type ContextAgent } from "@/lib/docs/agent-context";
import { factsOf, parseDoc } from "@/lib/docs/guide-parse";
import { RECENT_ITEMS } from "@/lib/thesis/activity-feed";
import { cn } from "@/lib/utils";
import { RunOutputs, type OutputId } from "./run-outputs";
import { Eyebrow, Mono } from "./primitives";
import { docBySlug, type DocSlug } from "./registry";
import { useGuideDoc } from "./tool-catalog";
import { ExamplePill, type PillSpec } from "./trigger-bits";

type NodeId = ContextAgent | OutputId | "thesis" | "outputs";
type Wake = "clock" | "trigger" | "asked";

const WAKE: Record<Wake, { bar: string; label: string }> = {
  clock: { bar: "bg-wake-clock", label: "Wakes on a clock" },
  trigger: { bar: "bg-wake-trigger", label: "Wakes on a trigger" },
  asked: { bar: "bg-wake-asked", label: "Wakes when asked" },
};

/** Each agent: its name, what wakes it, its place on the grid (columns 1, 3 and 5; 2 and 4 are the gaps), and what it writes for the others. */
const AGENTS: Record<ContextAgent, { name: string; wake: Wake; place: string; writes?: ReactNode }> = {
  discovery: { name: "Discovery", wake: "asked", place: "lg:col-start-1 lg:row-start-1 lg:mb-10" },
  "portfolio-digest": {
    name: "Portfolio Digest",
    wake: "clock",
    place: "lg:col-start-3 lg:row-start-1 lg:mb-10",
    writes: <>Writes the <ContextChip part={PORTFOLIO_DIGEST.part}>{PORTFOLIO_DIGEST.label}</ContextChip> for every agent that decides on stocks</>,
  },
  "market-reviewer": {
    name: "Market Reviewer",
    wake: "clock",
    place: "lg:col-start-5 lg:row-start-1 lg:mb-10",
    writes: <>Writes the <ContextChip part={MARKET_DIGEST.part}>{MARKET_DIGEST.label}</ContextChip> and notes on our stocks</>,
  },
  writer: { name: "The Writer", wake: "asked", place: "lg:col-start-1 lg:row-start-2 lg:mb-14" },
  "trigger-runs": { name: "Trigger run", wake: "trigger", place: "lg:col-start-3 lg:row-start-3 lg:self-center" },
  "morning-runs": { name: "Morning run", wake: "clock", place: "lg:col-start-3 lg:row-start-4 lg:self-center" },
  chat: { name: "Chat", wake: "asked", place: "lg:col-start-3 lg:row-start-5 lg:self-center" },
};

/** The three that answer a thesis, and what brings each to it. */
const ANSWERERS: ReadonlyArray<[ContextAgent, string]> = [
  ["trigger-runs", "a trigger fires"],
  ["morning-runs", "in a situation"],
  ["chat", "you ask"],
];

const TRIGGER: PillSpec = { action: "EXIT", when: { watch: "price", is: "below", value: 384 }, why: "Under the gap day's low, the drift has failed.", fireMode: "ASK_NOW" };

/** Its Activity, newest first, titled the way the sheet titles each line. */
const ACTIVITY: ReadonlyArray<{ title: string; rest: string; text: string; waiting?: boolean }> = [
  { title: "Market Reviewer's note", rest: "to CRWD · medium impact · neutral", text: "A peer's weak guide hit security stocks. Nothing in it touches CrowdStrike's renewals." },
  { title: "Proposed", rest: "buy 6 shares — awaiting your review", text: "The drift held through a weak tape for a third day. Adding at half the first buy's risk.", waiting: true },
  { title: "Scheduled review", rest: "· unchanged", text: "Nothing new since the beat, and the drift is intact. The plan stands; we hold." },
];

interface Wire {
  key: string;
  d: string;
  head?: string;
  dashed?: boolean;
  tag?: { x: number; y: number; text: string };
}

export function LoopCanvas({ onOpen }: { onOpen: (slug: DocSlug) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const nodes = useRef<Partial<Record<NodeId, HTMLElement | null>>>({});
  const [wires, setWires] = useState<Wire[]>([]);
  const at = (id: NodeId) => (el: HTMLElement | null) => {
    nodes.current[id] = el;
  };

  const draw = useCallback(() => {
    const c = box.current?.getBoundingClientRect();
    if (!c || window.matchMedia("(max-width: 1023px)").matches) {
      setWires([]);
      return;
    }
    const R = (id: NodeId) => {
      const b = nodes.current[id]?.getBoundingClientRect();
      if (!b) return null;
      return { l: b.left - c.left, r: b.right - c.left, t: b.top - c.top, b: b.bottom - c.top, cx: (b.left + b.right) / 2 - c.left, cy: (b.top + b.bottom) / 2 - c.top };
    };
    const right = (x: number, y: number) => `M${x - 6} ${y - 4} L${x} ${y} L${x - 6} ${y + 4}Z`;
    const down = (x: number, y: number) => `M${x - 4} ${y - 6} L${x} ${y} L${x + 4} ${y - 6}Z`;
    const up = (x: number, y: number) => `M${x - 4} ${y + 6} L${x} ${y} L${x + 4} ${y + 6}Z`;
    const [disc, writer, thesis, reviewer, outputs, note, edit, proposal, research] = (["discovery", "writer", "thesis", "market-reviewer", "outputs", "note", "edit", "proposal", "research"] as const).map(R);
    if (!disc || !writer || !thesis || !reviewer || !outputs || !note || !edit || !proposal || !research) return;
    const out: Wire[] = [];

    out.push({ key: "d>w", d: `M${disc.cx} ${disc.b} V${writer.t - 2}`, head: down(writer.cx, writer.t - 2), tag: { x: disc.cx, y: (disc.b + writer.t) / 2, text: "sends a stock" } });
    out.push({ key: "w>t", d: `M${writer.cx} ${writer.b} V${thesis.t - 2}`, head: down(thesis.cx, thesis.t - 2), tag: { x: writer.cx, y: (writer.b + thesis.t) / 2, text: "writes its thesis" } });
    // The Market Reviewer's notes: down its column, along the gap above row 3, into the thesis's right side.
    const lane = thesis.t - 18;
    const into = thesis.r - 32;
    out.push({ key: "mr>t", d: `M${reviewer.cx} ${reviewer.b} V${lane} H${into} V${thesis.t - 2}`, head: down(into, thesis.t - 2), tag: { x: (into + reviewer.cx) / 2, y: lane, text: "notes on its stocks" } });
    // The three that answer, into one bus between them and the outputs: any of them can leave any of the four.
    const bus = (note.l + Math.max(...ANSWERERS.map(([id]) => R(id)?.r ?? 0))) / 2;
    const ys: number[] = [];
    for (const [id, why] of ANSWERERS) {
      const a = R(id);
      if (!a) continue;
      ys.push(a.cy);
      out.push({ key: `t>${id}`, d: `M${thesis.r} ${a.cy} H${a.l - 2}`, head: right(a.l - 2, a.cy), tag: { x: (thesis.r + a.l) / 2, y: a.cy, text: why } });
      out.push({ key: `${id}>bus`, d: `M${a.r} ${a.cy} H${bus}` });
    }
    const cards = [note, edit, proposal, research];
    out.push({ key: "bus", d: `M${bus} ${Math.min(...ys, note.cy)} V${Math.max(...ys, research.cy)}` });
    cards.forEach((o, i) => out.push({ key: `bus>${i}`, d: `M${bus} ${o.cy} H${o.l - 2}`, head: right(o.l - 2, o.cy) }));
    // Notes, edits and trades back to the stock, down the right and along the bottom; stale research
    // further out and below that, up the left edge to the Writer (crossing the first once, on the right).
    const y1 = Math.max(thesis.b, outputs.b, R("chat")?.b ?? 0) + 30;
    const y2 = y1 + 34;
    const [x1, x2, gutter] = [note.r + 12, note.r + 26, writer.l - 18];
    [note, edit, proposal].forEach((o, i) => out.push({ key: `back${i}`, d: `M${o.r} ${o.cy} H${x1}` }));
    out.push({ key: "back", d: `M${x1} ${note.cy} V${y1} H${thesis.cx} V${thesis.b + 2}`, head: up(thesis.cx, thesis.b + 2), tag: { x: (x1 + thesis.cx) / 2, y: y1, text: "notes, edits and trades land back on the stock" } });
    out.push({ key: "r>w", dashed: true, d: `M${research.r} ${research.cy} H${x2} V${y2} H${gutter} V${writer.cy} H${writer.l - 2}`, head: right(writer.l - 2, writer.cy), tag: { x: (x1 + thesis.cx) / 2, y: y2, text: "stale research goes back to the Writer" } });
    setWires(out);
  }, []);

  useLayoutEffect(() => {
    draw();
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(el);
    return () => ro.disconnect();
  }, [draw]);

  return (
    // Narrower than the drawing's own width, the frame scrolls sideways inside itself; on a phone the cards stack.
    <div
      className="overflow-hidden rounded-2xl border bg-muted/40 lg:overflow-x-auto"
      style={{ backgroundImage: "radial-gradient(var(--border) 1px, transparent 1.3px)", backgroundSize: "18px 18px" }}
    >
      <div ref={box} className="relative px-4 py-8 sm:px-9 lg:min-w-[64rem] lg:pb-24">
        <svg className="pointer-events-none absolute inset-0 size-full overflow-visible" aria-hidden>
          {wires.map((w) => (
            <g key={w.key}>
              <path d={w.d} fill="none" strokeWidth={1.4} strokeDasharray={w.dashed ? "4 4" : undefined} className="stroke-foreground/30" />
              {w.head ? <path d={w.head} className="fill-foreground/30" /> : null}
              {w.tag ? (
                <g>
                  <rect x={w.tag.x - (w.tag.text.length * 6.2 + 14) / 2} y={w.tag.y - 9} width={w.tag.text.length * 6.2 + 14} height={18} rx={9} className="fill-background stroke-border" />
                  <text x={w.tag.x} y={w.tag.y + 3.5} textAnchor="middle" className="fill-muted-foreground text-xs">
                    {w.tag.text}
                  </text>
                </g>
              ) : null}
            </g>
          ))}
        </svg>

        <div className="relative flex flex-wrap items-center gap-x-5 gap-y-2 pb-6 text-xs text-muted-foreground">
          {Object.values(WAKE).map((w) => (
            <span key={w.label} className="inline-flex items-center gap-1.5">
              <span className={cn("h-3.5 w-1 rounded-full", w.bar)} aria-hidden />
              {w.label}
            </span>
          ))}
          <span>
            Chips: what each is sent, in the{" "}
            <Link href="/how-it-works/framework" className="underline underline-offset-4 hover:text-foreground">
              Framework&apos;s colors
            </Link>
          </span>
        </div>

        {/* Three columns with the gaps as tracks: room for the arrows' words after the first, the bus before the outputs. */}
        <div className="relative grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_7rem_minmax(0,1fr)_4rem_minmax(0,1fr)] lg:gap-x-0 lg:gap-y-6">
          {(["discovery", "portfolio-digest", "market-reviewer", "writer"] as const).map((id) => (
            <AgentCard key={id} id={id} ref={at(id)} onOpen={onOpen} />
          ))}
          <ThesisCard ref={at("thesis")} onOpen={onOpen} />
          {ANSWERERS.map(([id]) => (
            <AgentCard key={id} id={id} ref={at(id)} onOpen={onOpen} />
          ))}
          <div ref={at("outputs")} className="lg:col-start-5 lg:row-span-3 lg:row-start-3">
            <RunOutputs at={at} />
          </div>
        </div>
      </div>
    </div>
  );
}

/** An agent: the bar for what wakes it, its name and schedule, its summary (which opens its doc) and what it is sent. */
function AgentCard({ id, ref, onOpen }: { id: ContextAgent; ref: (el: HTMLElement | null) => void; onOpen: (slug: DocSlug) => void }) {
  const a = AGENTS[id];
  const source = useGuideDoc(id);
  const starts = useMemo(() => (source ? (factsOf(parseDoc(source)).Starts ?? "") : ""), [source]);
  return (
    <div ref={ref} className={cn("flex min-w-0 gap-3 rounded-xl border bg-background p-3.5 shadow-sm", a.place)}>
      <span className={cn("w-1 shrink-0 rounded-full", WAKE[a.wake].bar)} aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <button type="button" onClick={() => onOpen(id)} className="group flex flex-col gap-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <span className="flex flex-wrap items-baseline justify-between gap-x-3">
            <span className="text-sm font-medium text-foreground">{a.name}</span>
            <Mono className="text-xs text-muted-foreground">{starts}</Mono>
          </span>
          <span className="line-clamp-2 text-xs leading-snug text-muted-foreground transition-colors group-hover:text-foreground">{docBySlug(id)?.blurb}</span>
        </button>
        <ContextChips parts={AGENT_CONTEXT[id]} shown={CHIPS_SHOWN} onMore={() => onOpen(id)} moreLabel={`Everything ${a.name} is sent`} />
        {a.writes ? <p className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">{a.writes}</p> : null}
      </div>
    </div>
  );
}

/** One thesis, a smaller copy of the sheet: the stock, its belief, one trigger with its On fire, and its newest Activity. */
function ThesisCard({ ref, onOpen }: { ref: (el: HTMLElement | null) => void; onOpen: (slug: DocSlug) => void }) {
  return (
    <div ref={ref} className="flex min-w-0 flex-col gap-3 rounded-xl border bg-background p-4 shadow-sm lg:col-start-1 lg:row-span-3 lg:row-start-3 lg:self-stretch">
      <button type="button" onClick={() => onOpen("theses")} className="group flex items-center gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <StockLogo ticker="CRWD" size="md" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-foreground underline-offset-4 group-hover:underline">CrowdStrike</span>
          <span className="block text-xs text-muted-foreground">CRWD · Holding</span>
        </span>
        <span className="flex flex-col items-end gap-0.5">
          <span className="text-sm font-medium text-foreground tabular-nums">$418.20</span>
          <PriceChange dollarChange={-4.85} percentChange={-1.15} size="xs" />
        </span>
      </button>
      <p className="line-clamp-2 text-sm text-foreground">
        Security buyers are consolidating onto one platform, and CrowdStrike is winning that consolidation on renewals and module attach.
      </p>

      <div className="flex flex-col gap-2 border-t pt-3">
        <Eyebrow>Triggers</Eyebrow>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">{rowLabel(TRIGGER.action)}</span>
          <ExamplePill spec={TRIGGER} />
          <span className="text-xs text-muted-foreground">{fireModeLabel(TRIGGER.fireMode!, TRIGGER.action)}</span>
        </div>
      </div>

      <div className="flex flex-col gap-3 border-t pt-3">
        <Eyebrow>Activity</Eyebrow>
        <ol className="flex flex-col">
          {ACTIVITY.map((a, i) => (
            <li key={a.title} className="flex gap-3">
              <span className="flex flex-col items-center">
                <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", a.waiting ? "bg-amber-500" : "bg-foreground/15")} />
                {i < ACTIVITY.length - 1 ? <span className="mt-1 w-px flex-1 bg-foreground/15" /> : null}
              </span>
              <span className={cn("min-w-0 flex-1", i < ACTIVITY.length - 1 && "pb-3")}>
                <span className="block text-xs leading-snug text-foreground">
                  <span className="font-semibold">{a.title}</span> {a.rest}
                </span>
                <span className="line-clamp-2 pt-0.5 text-xs font-light leading-relaxed text-foreground">{a.text}</span>
              </span>
            </li>
          ))}
        </ol>
        <p className="text-xs text-muted-foreground">The next run on CRWD reads its newest {RECENT_ITEMS} lines first.</p>
      </div>
    </div>
  );
}
