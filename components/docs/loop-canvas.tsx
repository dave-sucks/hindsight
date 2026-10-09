"use client";

/**
 * The home page's picture of the loop, drawn as a workflow canvas: nodes on a
 * dotted grid, wires between them, and one fire that travels from a trigger to
 * your approval. Every node opens its page. The wires are measured from the
 * nodes, so the drawing holds at every width; on a phone it stacks.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowUpRight,
  Briefcase,
  Check,
  CheckCircle2,
  Clock,
  FileText,
  PenLine,
  Play,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  Sun,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { DocSlug } from "./registry";

type NodeId = "discovery" | "writer" | "thesis" | "morning" | "trigger" | "decide" | "proposal" | "update" | "approve" | "position";

interface NodeDef {
  id: NodeId;
  title: string;
  sub: string;
  icon: LucideIcon;
  tone?: "accent" | "positive" | "warning";
  tab?: { label: string; icon: LucideIcon };
  doc: DocSlug;
  /** Grid placement on the wide canvas (col / row) and the narrow one. */
  wide: string;
  narrow: string;
}

const NODES: readonly NodeDef[] = [
  { id: "discovery", title: "Discovery", sub: "When you ask. Screens earnings, movers and the web.", icon: Search, tab: { label: "Start", icon: Play }, doc: "discovery", wide: "lg:col-span-1 lg:col-start-1 lg:row-start-1", narrow: "col-span-2 row-start-1" },
  { id: "writer", title: "The Writer", sub: "Researches one stock and writes the case.", icon: PenLine, doc: "writer", wide: "lg:col-span-1 lg:col-start-2 lg:row-start-1", narrow: "col-span-2 row-start-2" },
  { id: "thesis", title: "Thesis", sub: "A belief, and the triggers that act on it.", icon: FileText, tone: "accent", doc: "theses", wide: "lg:col-span-1 lg:col-start-3 lg:row-start-1", narrow: "col-span-2 row-start-3" },
  { id: "morning", title: "Morning run", sub: "Weekdays, 8 AM ET", icon: Sun, tab: { label: "Schedule", icon: Clock }, doc: "morning-runs", wide: "lg:col-span-1 lg:col-start-1 lg:row-start-2", narrow: "col-start-1 row-start-4" },
  { id: "trigger", title: "Trigger fires", sub: "Checked every 5 minutes the market is open.", icon: Zap, tab: { label: "Trigger", icon: Zap }, doc: "trigger-runs", wide: "lg:col-span-1 lg:col-start-1 lg:row-start-3", narrow: "col-start-2 row-start-4" },
  { id: "decide", title: "The analyst decides", sub: "Sell, add, trim, hold, or redraw the plan.", icon: Sparkles, doc: "situations", wide: "lg:col-span-1 lg:col-start-2 lg:row-start-2 lg:row-span-2", narrow: "col-span-2 row-start-5" },
  { id: "proposal", title: "Proposal", sub: "Every trade, with its reason.", icon: Send, tone: "warning", doc: "approvals", wide: "lg:col-span-1 lg:col-start-3 lg:row-start-2", narrow: "col-start-1 row-start-6" },
  { id: "update", title: "Thesis updated", sub: "Plans and floors change in place.", icon: RefreshCw, doc: "theses", wide: "lg:col-span-1 lg:col-start-3 lg:row-start-3", narrow: "col-start-2 row-start-6" },
  { id: "approve", title: "You approve", sub: "Nothing fills without your yes.", icon: CheckCircle2, tone: "positive", doc: "approvals", wide: "lg:col-span-1 lg:col-start-4 lg:row-start-2", narrow: "col-span-2 row-start-7" },
  { id: "position", title: "Position", sub: "Its triggers keep watching it.", icon: Briefcase, doc: "triggers", wide: "lg:col-span-1 lg:col-start-4 lg:row-start-3", narrow: "col-span-2 row-start-8" },
];

type Route = "h" | "v" | "wrap";
const EDGES: readonly { from: NodeId; to: NodeId; route: Route; label?: string }[] = [
  { from: "discovery", to: "writer", route: "h" },
  { from: "writer", to: "thesis", route: "h" },
  { from: "thesis", to: "morning", route: "wrap" },
  { from: "thesis", to: "trigger", route: "wrap" },
  { from: "morning", to: "decide", route: "h" },
  { from: "trigger", to: "decide", route: "h" },
  { from: "decide", to: "proposal", route: "h", label: "a trade" },
  { from: "decide", to: "update", route: "h", label: "no trade" },
  { from: "proposal", to: "approve", route: "h" },
  { from: "approve", to: "position", route: "v" },
];

/** The fire's path: lit one beat at a time. */
const FIRE: readonly (NodeId | `${NodeId}>${NodeId}`)[][] = [
  ["trigger"],
  ["trigger>decide", "decide"],
  ["decide>proposal", "proposal"],
  ["proposal>approve", "approve"],
];

const TONE: Record<NonNullable<NodeDef["tone"]>, string> = {
  accent: "bg-chart-2/10 text-chart-2",
  positive: "bg-positive/10 text-positive",
  warning: "bg-amber-500/10 text-amber-500",
};

function rounded(pts: readonly [number, number][], r: number): string {
  let d = `M${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[i + 1];
    const l1 = Math.hypot(x1 - x0, y1 - y0);
    const l2 = Math.hypot(x2 - x1, y2 - y1);
    const rr = Math.min(r, l1 / 2, l2 / 2);
    if (rr < 0.5) {
      d += ` L${x1} ${y1}`;
      continue;
    }
    const ax = x1 - ((x1 - x0) / l1) * rr;
    const ay = y1 - ((y1 - y0) / l1) * rr;
    const bx = x1 + ((x2 - x1) / l2) * rr;
    const by = y1 + ((y2 - y1) / l2) * rr;
    d += ` L${ax} ${ay} Q${x1} ${y1} ${bx} ${by}`;
  }
  const z = pts[pts.length - 1];
  return `${d} L${z[0]} ${z[1]}`;
}

interface Wire {
  key: string;
  d: string;
  head: string;
  tag?: { x: number; y: number; text: string };
}

export function LoopCanvas({ onOpen }: { onOpen: (slug: DocSlug) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const nodes = useRef<Partial<Record<NodeId, HTMLButtonElement | null>>>({});
  const [wires, setWires] = useState<Wire[]>([]);
  const [lit, setLit] = useState<Set<string>>(new Set());
  const [fired, setFired] = useState(false);

  const draw = useCallback(() => {
    const c = box.current?.getBoundingClientRect();
    if (!c) return;
    const R = (id: NodeId) => {
      const b = nodes.current[id]?.getBoundingClientRect();
      if (!b) return null;
      return { l: b.left - c.left, r: b.right - c.left, t: b.top - c.top, b: b.bottom - c.top, cx: (b.left + b.right) / 2 - c.left, cy: (b.top + b.bottom) / 2 - c.top };
    };
    const narrow = window.matchMedia("(max-width: 1023px)").matches;
    const out: Wire[] = [];
    for (const e of EDGES) {
      const s = R(e.from);
      const t = R(e.to);
      const m = R("morning");
      if (!s || !t || !m) continue;
      let pts: [number, number][];
      let down = false;
      if (narrow || e.route === "v") {
        // A node with a tab on top takes its arrow above the tab.
        const top = t.t - (NODES.find((n) => n.id === e.to)?.tab ? 22 : 2);
        const my = (s.b + top) / 2;
        pts = [[s.cx, s.b], [s.cx, my], [t.cx, my], [t.cx, top]];
        down = true;
      } else if (e.route === "wrap") {
        const gy = (s.b + m.t) / 2;
        const lx = m.l - 18;
        pts = [[s.cx, s.b], [s.cx, gy], [lx, gy], [lx, t.cy], [t.l - 2, t.cy]];
      } else {
        const mx = (s.r + t.l) / 2;
        pts = [[s.r, s.cy], [mx, s.cy], [mx, t.cy], [t.l - 2, t.cy]];
      }
      const [zx, zy] = pts[pts.length - 1];
      const head = down
        ? `M${zx - 4} ${zy - 6} L${zx} ${zy} L${zx + 4} ${zy - 6}Z`
        : `M${zx - 6} ${zy - 4} L${zx} ${zy} L${zx - 6} ${zy + 4}Z`;
      const tag = e.label && !narrow ? { x: pts[1][0], y: (pts[1][1] + pts[2][1]) / 2, text: e.label } : undefined;
      out.push({ key: `${e.from}>${e.to}`, d: rounded(pts, 10), head, tag });
    }
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

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setFired(true);
      return;
    }
    let step = -1;
    const id = window.setInterval(() => {
      step += 1;
      if (step >= FIRE.length + 2) {
        step = -1;
        setLit(new Set());
        setFired(false);
        return;
      }
      if (step >= FIRE.length) return;
      if (step === 0) setFired(true);
      setLit((prev) => new Set([...prev, ...FIRE[step]]));
    }, 1100);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div
      ref={box}
      className="relative overflow-hidden rounded-2xl border bg-muted/40 px-4 pb-8 pt-12 sm:px-9"
      style={{ backgroundImage: "radial-gradient(var(--border) 1px, transparent 1.3px)", backgroundSize: "18px 18px" }}
    >
      <svg className="pointer-events-none absolute inset-0 size-full overflow-visible" aria-hidden>
        {wires.map((w) => (
          <g key={w.key}>
            <path d={w.d} fill="none" strokeWidth={1.4} className={cn("transition-colors duration-500", lit.has(w.key) ? "stroke-chart-2" : "stroke-foreground/30")} />
            <path d={w.head} className={cn("transition-colors duration-500", lit.has(w.key) ? "fill-chart-2" : "fill-foreground/30")} />
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
      <div className="relative grid grid-cols-2 gap-x-3.5 gap-y-10 lg:grid-cols-4 lg:items-center lg:gap-x-16 lg:gap-y-14">
        {NODES.map((n) => (
          <button
            key={n.id}
            ref={(el) => {
              nodes.current[n.id] = el;
            }}
            type="button"
            onClick={() => onOpen(n.doc)}
            className={cn(
              "group relative flex min-w-0 flex-col gap-1 rounded-xl border bg-background px-3.5 py-3 text-left shadow-sm transition duration-300 hover:-translate-y-px hover:border-foreground/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              n.narrow,
              n.wide,
              lit.has(n.id) && "border-chart-2/60 ring-4 ring-chart-2/10",
            )}
          >
            {n.tab ? (
              <span className="absolute -top-5 left-[-1px] inline-flex items-center gap-1 rounded-t-md bg-foreground px-2 pb-1 pt-0.5 text-xs font-medium text-background">
                <n.tab.icon className="size-2.5" />
                {n.tab.label}
              </span>
            ) : null}
            {n.id === "trigger" ? (
              <span
                className={cn(
                  "absolute -top-2.5 right-2 inline-flex items-center gap-1 rounded-full border border-positive/25 bg-positive/10 px-2 py-px text-xs font-medium text-positive transition duration-300",
                  fired ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0",
                )}
              >
                <Check className="size-3" strokeWidth={3} />
                Triggered
              </span>
            ) : null}
            <span className="flex items-center gap-2 text-sm font-medium text-foreground">
              <span className={cn("grid size-6 shrink-0 place-items-center rounded-md border bg-muted text-muted-foreground", n.tone && cn("border-transparent", TONE[n.tone]))}>
                <n.icon className="size-3.5" />
              </span>
              <span className="min-w-0">{n.title}</span>
              <ArrowUpRight className="ml-auto size-3.5 shrink-0 text-muted-foreground opacity-0 transition group-hover:opacity-100" />
            </span>
            <span className="text-xs leading-snug text-muted-foreground lg:pl-8">{n.sub}</span>
          </button>
        ))}
      </div>
      <Foot>
        <span>
          <b className="font-medium text-foreground">Three ways to wake an analyst:</b> you, a clock, or a trigger.
        </span>
        <span>Open any step to read how it works.</span>
      </Foot>
    </div>
  );
}

function Foot({ children }: { children: ReactNode }) {
  return <div className="relative mt-9 flex flex-wrap justify-between gap-x-5 gap-y-1 text-xs text-muted-foreground">{children}</div>;
}
