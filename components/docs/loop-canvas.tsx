"use client";

/**
 * The home page's picture of the loop: Discovery hands stocks to the Writer,
 * the Writer writes the thesis, three agents read it (on a schedule, on a
 * fire, when you ask), and what they decide comes out the other side. Every
 * node opens its page. The wires are measured from the nodes, so the drawing
 * holds at every width; on a phone it stacks and the wires drop away.
 */

import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ArrowUpRight, FileText, MessageCircle, PenLine, Search, Sun, Zap, type LucideIcon } from "lucide-react";
import { StockLogo } from "@/components/StockLogo";
import { cn } from "@/lib/utils";
import { Mono } from "./primitives";
import type { DocSlug } from "./registry";

type NodeId = "discovery" | "writer" | "thesis" | "morning" | "trigger" | "chat" | "decisions";

const AGENTS: readonly { id: NodeId; title: string; sub: string; icon: LucideIcon; doc: DocSlug; row: string; wire: string }[] = [
  { id: "morning", title: "Morning run", sub: "At 8 AM, each analyst reviews every stock that needs an answer.", icon: Sun, doc: "morning-runs", row: "lg:row-start-2", wire: "every morning" },
  { id: "trigger", title: "Trigger run", sub: "When a trigger fires, its analyst reviews that stock within minutes.", icon: Zap, doc: "trigger-runs", row: "lg:row-start-3", wire: "on a trigger" },
  { id: "chat", title: "Chat", sub: "Ask about any stock, change its plan or start research yourself.", icon: MessageCircle, doc: "chat", row: "lg:row-start-4", wire: "when you ask" },
];

const PLAN = ["Buy if near $401", "Sell if below $384", "Review every 30 days"] as const;

const DECISIONS: readonly { s: string; act: string; why: string }[] = [
  { s: "CRWD", act: "Buy", why: "Reached its buy level" },
  { s: "AVGO", act: "Add", why: "Up 7% on the report" },
  { s: "LLY", act: "Hold", why: "Review: nothing changed" },
  { s: "SHOP", act: "Sell", why: "Closed under its floor" },
];

interface Wire {
  key: string;
  d: string;
  head: string;
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
    const right = (y: number, x: number) => `M${x - 6} ${y - 4} L${x} ${y} L${x - 6} ${y + 4}Z`;
    const out: Wire[] = [];
    const disc = R("discovery");
    const writer = R("writer");
    const thesis = R("thesis");
    const decisions = R("decisions");
    if (!disc || !writer || !thesis || !decisions) return;

    out.push({ key: "d>w", d: `M${disc.r} ${disc.cy} L${writer.l - 2} ${writer.cy}`, head: right(writer.cy, writer.l - 2) });
    out.push({ key: "w>t", d: `M${writer.cx} ${writer.b} L${thesis.cx} ${thesis.t - 2}`, head: `M${thesis.cx - 4} ${thesis.t - 8} L${thesis.cx} ${thesis.t - 2} L${thesis.cx + 4} ${thesis.t - 8}Z`, tag: { x: thesis.cx, y: (writer.b + thesis.t) / 2, text: "writes" } });
    for (const a of AGENTS) {
      const s = R(a.id);
      if (!s) continue;
      out.push({ key: `${a.id}>t`, d: `M${s.r} ${s.cy} L${thesis.l - 2} ${s.cy}`, head: right(s.cy, thesis.l - 2), tag: { x: (s.r + thesis.l) / 2, y: s.cy, text: a.wire } });
    }
    out.push({ key: "t>d", d: `M${thesis.r} ${thesis.cy} L${decisions.l - 2} ${thesis.cy}`, head: right(thesis.cy, decisions.l - 2), tag: { x: (thesis.r + decisions.l) / 2, y: thesis.cy, text: "decides" } });
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
    <div
      ref={box}
      className="relative overflow-hidden rounded-2xl border bg-muted/40 px-4 py-8 sm:px-9"
      style={{ backgroundImage: "radial-gradient(var(--border) 1px, transparent 1.3px)", backgroundSize: "18px 18px" }}
    >
      <svg className="pointer-events-none absolute inset-0 size-full overflow-visible" aria-hidden>
        {wires.map((w) => (
          <g key={w.key}>
            <path d={w.d} fill="none" strokeWidth={1.4} className="stroke-foreground/30" />
            <path d={w.head} className="fill-foreground/30" />
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

      <div className="relative grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)_minmax(0,1fr)] lg:grid-rows-[auto_auto_auto_auto] lg:items-center lg:gap-x-28 lg:gap-y-6">
        <Node ref={at("discovery")} className="lg:col-start-1 lg:row-start-1 lg:mb-6" icon={Search} title="Discovery" sub="Screens earnings, movers and the web for stocks that fit an analyst." onOpen={() => onOpen("discovery")} />
        <Node ref={at("writer")} className="lg:col-start-2 lg:row-start-1 lg:mb-6" icon={PenLine} title="The Writer" sub="Researches each one in depth and writes its thesis and plan." onOpen={() => onOpen("writer")} />

        {AGENTS.map((a) => (
          <Node key={a.id} ref={at(a.id)} className={cn("lg:col-start-1", a.row)} icon={a.icon} title={a.title} sub={a.sub} onOpen={() => onOpen(a.doc)} />
        ))}

        <button
          ref={at("thesis")}
          type="button"
          onClick={() => onOpen("theses")}
          className="group relative flex flex-col gap-3 rounded-xl border bg-background p-4 text-left shadow-sm transition hover:border-foreground/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:col-start-2 lg:row-span-3 lg:row-start-2 lg:self-stretch lg:justify-center"
        >
          <span className="flex items-center gap-2 text-sm font-medium text-foreground">
            <span className="grid size-6 shrink-0 place-items-center rounded-md border bg-muted text-muted-foreground">
              <FileText className="size-3.5" />
            </span>
            Thesis
            <ArrowUpRight className="ml-auto size-3.5 text-muted-foreground opacity-0 transition group-hover:opacity-100" />
          </span>
          <span className="text-xs leading-snug text-muted-foreground">One stock: a belief we can be wrong about, and the plan that acts on it.</span>
          <span className="flex flex-col gap-1.5 border-t pt-3">
            {PLAN.map((p) => (
              <span key={p} className="text-xs text-foreground">
                {p}
              </span>
            ))}
          </span>
        </button>

        <button
          ref={at("decisions")}
          type="button"
          onClick={() => onOpen("approvals")}
          className="group relative flex flex-col gap-1 rounded-xl border bg-background p-4 text-left shadow-sm transition hover:border-foreground/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:col-start-3 lg:row-span-3 lg:row-start-2 lg:self-stretch lg:justify-center"
        >
          <span className="flex items-center gap-2 pb-2 text-sm font-medium text-foreground">
            What comes out
            <ArrowUpRight className="ml-auto size-3.5 text-muted-foreground opacity-0 transition group-hover:opacity-100" />
          </span>
          {DECISIONS.map((d) => (
            <span key={d.s} className="flex items-center gap-2.5 border-t py-2">
              <StockLogo ticker={d.s} size="xs" />
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-medium text-foreground">{d.s}</span>
                <span className="block text-xs text-muted-foreground">{d.why}</span>
              </span>
              <Mono className="text-xs uppercase tracking-wide text-muted-foreground">{d.act}</Mono>
            </span>
          ))}
          <span className="border-t pt-2 text-xs text-muted-foreground">Every trade is a proposal, with its reason.</span>
        </button>
      </div>

    </div>
  );
}

function Node({
  ref,
  className,
  icon: Icon,
  title,
  sub,
  onOpen,
}: {
  ref: (el: HTMLElement | null) => void;
  className?: string;
  icon: LucideIcon;
  title: string;
  sub: ReactNode;
  onOpen: () => void;
}) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onOpen}
      className={cn(
        "group relative flex min-w-0 flex-col gap-1 rounded-xl border bg-background px-3.5 py-3 text-left shadow-sm transition hover:border-foreground/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      <span className="flex items-center gap-2 text-sm font-medium text-foreground">
        <span className="grid size-6 shrink-0 place-items-center rounded-md border bg-muted text-muted-foreground">
          <Icon className="size-3.5" />
        </span>
        <span className="min-w-0">{title}</span>
        <ArrowUpRight className="ml-auto size-3.5 shrink-0 text-muted-foreground opacity-0 transition group-hover:opacity-100" />
      </span>
      <span className="pl-8 text-xs leading-snug text-muted-foreground">{sub}</span>
    </button>
  );
}
