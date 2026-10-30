"use client";

/**
 * The trigger loop in one picture: a thesis with its triggers on the left,
 * each trigger's On fire choosing the agent it reaches (with the situation
 * that agent is sent), what comes out on the right, and every note coming
 * back to the thesis as Activity, which the next run reads first. Same
 * drawing as the workflow canvas (loop-canvas.tsx): the wires are measured
 * from the nodes, and on a phone it stacks and the wires drop away. With
 * `onOpen` every node opens its page; without it (a guide doc) it is a picture.
 */

import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ArrowUpRight, FileText, MessageCircle, PenLine, Sun, Zap, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { StockLogo } from "@/components/StockLogo";
import { cn } from "@/lib/utils";
import { Mono } from "./primitives";
import type { DocSlug } from "./registry";

type NodeId = "thesis" | "activity" | "t-sell" | "t-trim" | "t-earn" | "t-clock" | "trigger" | "writeup" | "morning" | "chat" | "out";

/** The thesis's triggers, each with its On fire and the agent that fire reaches. */
const TRIGGERS: readonly { id: NodeId; says: string; onFire: string; to: NodeId }[] = [
  { id: "t-sell", says: "Sell if below $384", onFire: "Send to Agent", to: "trigger" },
  { id: "t-trim", says: "Trim 30% if above $460", onFire: "Auto", to: "writeup" },
  { id: "t-earn", says: "Review if earnings beat", onFire: "Flag for Review", to: "morning" },
  { id: "t-clock", says: "Review every 30 days", onFire: "Flag for Review", to: "morning" },
];

/** The agents a fire can reach: what each does, the situation it is sent, and its wire to what comes out. */
const AGENTS: readonly { id: NodeId; title: string; sub: string; icon: LucideIcon; doc: DocSlug; situations: string[]; wire: string; row: string }[] = [
  { id: "trigger", title: "Trigger run", sub: "Reads the stock and decides: sell, trim, buy, hold or move a level.", icon: Zap, doc: "trigger-runs", situations: ["sale signal"], wire: "decides", row: "lg:row-start-1" },
  { id: "writeup", title: "Trigger run, write-up", sub: "The Auto trade is made the moment it fires. Then the analyst reads the stock, writes it up, and says if it would have done otherwise.", icon: PenLine, doc: "trigger-runs", situations: ["auto trade made"], wire: "writes up", row: "lg:row-start-2" },
  { id: "morning", title: "Morning run", sub: "At 8 AM it answers what was flagged and every review that came due.", icon: Sun, doc: "morning-runs", situations: ["earnings", "review due"], wire: "answers", row: "lg:row-start-3" },
  { id: "chat", title: "Chat", sub: "When you ask about the stock, change its plan or call for a trade.", icon: MessageCircle, doc: "chat", situations: [], wire: "your word", row: "lg:row-start-4" },
];

/** What the agents' work becomes. */
const OUTCOMES: readonly { what: string; why: string }[] = [
  { what: "Proposal", why: "A buy, add, trim or sale waiting for you. Its reason is the analyst's note." },
  { what: "Trade", why: "Sent at once when your approval switch is off." },
  { what: "Note", why: "Holding, a level moved, a review answered." },
];

/** The thesis's Activity: what came back, newest first. Invented, for the picture. */
const ACTIVITY: readonly { by: string; text: string }[] = [
  { by: "Trigger run", text: "CrowdStrike fell 6% after a peer's weak guide and broke the level we bought on. I've proposed the sale." },
  { by: "Write-up", text: "The beat sent it past $460 and your Auto-trim went in. I agree: worth banking some into a crowded rally." },
  { by: "Morning run", text: "The quarter beat on both lines and guidance rose. The plan stands." },
];

interface Wire {
  key: string;
  d: string;
  head: string;
  tag?: { x: number; y: number; text: string };
}

export function FireCanvas({ onOpen }: { onOpen?: (slug: DocSlug) => void }) {
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
    const up = (x: number, y: number) => `M${x - 4} ${y + 6} L${x} ${y} L${x + 4} ${y + 6}Z`;
    const thesis = R("thesis");
    const out = R("out");
    if (!thesis || !out) return;
    const wiresOut: Wire[] = [];

    // Each trigger to the agent its On fire reaches: out of the card at the trigger's row, an elbow, into the agent.
    TRIGGERS.forEach((tr, i) => {
      const row = R(tr.id);
      const agent = R(tr.to);
      if (!row || !agent) return;
      const vx = thesis.r + 14 + i * 12;
      wiresOut.push({ key: `${tr.id}>${tr.to}`, d: `M${thesis.r} ${row.cy} H${vx} V${agent.cy} H${agent.l - 2}`, head: right(agent.cy, agent.l - 2) });
    });
    // You, to chat.
    const chat = R("chat");
    if (chat) wiresOut.push({ key: "you>chat", d: `M${thesis.r} ${chat.cy} H${chat.l - 2}`, head: right(chat.cy, chat.l - 2), tag: { x: (thesis.r + chat.l) / 2 + 10, y: chat.cy, text: "you ask" } });
    // Each agent to what comes out.
    for (const a of AGENTS) {
      const s = R(a.id);
      if (!s) continue;
      wiresOut.push({ key: `${a.id}>out`, d: `M${s.r} ${s.cy} L${out.l - 2} ${s.cy}`, head: right(s.cy, out.l - 2), tag: { x: (s.r + out.l) / 2, y: s.cy, text: a.wire } });
    }
    // Back to the thesis: under everything, into its Activity.
    const lowest = Math.max(thesis.b, out.b, chat?.b ?? 0);
    const yb = lowest + 30;
    wiresOut.push({
      key: "out>thesis",
      d: `M${out.cx} ${out.b} V${yb} H${thesis.cx} V${thesis.b + 2}`,
      head: up(thesis.cx, thesis.b + 2),
      tag: { x: (out.cx + thesis.cx) / 2, y: yb, text: "every note comes back to the stock's Activity" },
    });
    setWires(wiresOut);
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
      className="relative overflow-hidden rounded-2xl border bg-muted/40 px-4 py-8 sm:px-9 lg:pb-20"
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

      <div className="relative grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,0.9fr)] lg:grid-rows-[auto_auto_auto_auto] lg:items-center lg:gap-x-28 lg:gap-y-5">
        {/* The thesis: its triggers (each with its On fire) and its Activity, where every note comes back. */}
        <Card ref={at("thesis")} onOpen={onOpen ? () => onOpen("theses") : undefined} className="gap-3 p-4 lg:col-start-1 lg:row-span-4 lg:row-start-1 lg:self-stretch">
          <span className="flex items-center gap-2 text-sm font-medium text-foreground">
            <span className="grid size-6 shrink-0 place-items-center rounded-md border bg-muted text-muted-foreground">
              <FileText className="size-3.5" />
            </span>
            Thesis
            <span className="flex items-center gap-1.5 text-xs font-normal text-muted-foreground">
              <StockLogo ticker="CRWD" size="xs" />
              CRWD · Holding
            </span>
            {onOpen ? <ArrowUpRight className="ml-auto size-3.5 text-muted-foreground opacity-0 transition group-hover:opacity-100" /> : null}
          </span>
          <span className="text-xs leading-snug text-muted-foreground">Security software is consolidating onto one platform, and CrowdStrike is winning it.</span>

          <span className="flex flex-col gap-1.5 border-t pt-3">
            <Mono className="text-xs uppercase tracking-wide text-muted-foreground">Triggers · On fire</Mono>
            {TRIGGERS.map((tr) => (
              <span key={tr.id} ref={at(tr.id)} className="flex items-center justify-between gap-3 py-0.5">
                <span className="text-xs text-foreground">{tr.says}</span>
                <Mono className="shrink-0 text-xs text-muted-foreground">{tr.onFire}</Mono>
              </span>
            ))}
          </span>

          <span ref={at("activity")} className="flex flex-col gap-2 border-t pt-3">
            <Mono className="text-xs uppercase tracking-wide text-muted-foreground">Activity</Mono>
            {ACTIVITY.map((a) => (
              <span key={a.by} className="flex flex-col gap-0.5">
                <span className="text-xs font-medium text-foreground">{a.by}</span>
                <span className="text-xs leading-snug text-muted-foreground">{a.text}</span>
              </span>
            ))}
            <span className="text-xs text-muted-foreground">The next run on CRWD reads the last three first.</span>
          </span>
        </Card>

        {/* The agents a fire reaches, each with the situation it is sent. */}
        {AGENTS.map((a) => (
          <Card key={a.id} ref={at(a.id)} onOpen={onOpen ? () => onOpen(a.doc) : undefined} className={cn("gap-1 px-3.5 py-3 lg:col-start-2", a.row)}>
            <span className="flex items-center gap-2 text-sm font-medium text-foreground">
              <span className="grid size-6 shrink-0 place-items-center rounded-md border bg-muted text-muted-foreground">
                <a.icon className="size-3.5" />
              </span>
              <span className="min-w-0">{a.title}</span>
              {onOpen ? <ArrowUpRight className="ml-auto size-3.5 shrink-0 text-muted-foreground opacity-0 transition group-hover:opacity-100" /> : null}
            </span>
            <span className="pl-8 text-xs leading-snug text-muted-foreground">{a.sub}</span>
            {a.situations.length ? (
              <span className="flex flex-wrap items-center gap-1.5 pl-8 pt-1">
                {a.situations.map((s) => (
                  <Badge key={s} variant="outline">
                    {s}
                  </Badge>
                ))}
              </span>
            ) : null}
          </Card>
        ))}

        {/* What it becomes. */}
        <Card ref={at("out")} onOpen={onOpen ? () => onOpen("approvals") : undefined} className="gap-1 p-4 lg:col-start-3 lg:row-span-4 lg:row-start-1 lg:self-stretch lg:justify-center">
          <span className="flex items-center gap-2 pb-2 text-sm font-medium text-foreground">
            What comes out
            {onOpen ? <ArrowUpRight className="ml-auto size-3.5 text-muted-foreground opacity-0 transition group-hover:opacity-100" /> : null}
          </span>
          {OUTCOMES.map((o) => (
            <span key={o.what} className="flex flex-col gap-0.5 border-t py-2">
              <Mono className="text-xs uppercase tracking-wide text-foreground">{o.what}</Mono>
              <span className="text-xs leading-snug text-muted-foreground">{o.why}</span>
            </span>
          ))}
          <span className="border-t pt-2 text-xs text-muted-foreground">Every reason you read is an analyst&apos;s own words.</span>
        </Card>
      </div>
    </div>
  );
}

/** A node: a button that opens its page when there is one, a plain box when the picture sits in a doc. */
function Card({
  ref,
  onOpen,
  className,
  children,
}: {
  ref: (el: HTMLElement | null) => void;
  onOpen?: () => void;
  className?: string;
  children: ReactNode;
}) {
  const look = cn(
    "group relative flex min-w-0 flex-col rounded-xl border bg-background text-left shadow-sm",
    onOpen && "transition hover:border-foreground/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    className,
  );
  return onOpen ? (
    <button ref={ref} type="button" onClick={onOpen} className={look}>
      {children}
    </button>
  ) : (
    <div ref={ref} className={look}>
      {children}
    </div>
  );
}
