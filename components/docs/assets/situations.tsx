"use client";

/**
 * How a stock gets put up for an answer: its facts go into one function on
 * every read, and what comes out is its list of situations. A stock with
 * any is on the day's work list; one with none is a quiet line. The names
 * are the real ones from SITUATIONS. Wires are measured from the boxes; on a
 * phone it stacks and they drop away.
 */

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { StockLogo } from "@/components/StockLogo";
import { Mono } from "../primitives";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { FlagNotificationIcon } from "@/components/ui/flag-notification-icon";
import { SITUATIONS, type SituationCode } from "@/lib/agent/situations";

const INPUTS: readonly { title: string; sub: string }[] = [
  { title: "Its triggers", sub: "One fired, or one is true now" },
  { title: "Its review clock", sub: "It came round" },
  { title: "Its floor", sub: "Too far behind the gain, or too much to lose" },
  { title: "A note", sub: "Yours or a pinned one, not yet answered" },
  { title: "A recent sale", sub: "Sold in the last two weeks" },
];

const STOCKS: readonly { s: string; situations: readonly string[] }[] = [
  { s: "MU", situations: ["review due", "floor to fix"] },
  { s: "CRWD", situations: ["buy price reached"] },
  { s: "LLY", situations: [] },
];

export function SituationFlow() {
  const box = useRef<HTMLDivElement>(null);
  const inputs = useRef<(HTMLDivElement | null)[]>([]);
  const stocks = useRef<(HTMLDivElement | null)[]>([]);
  const core = useRef<HTMLDivElement>(null);
  const [paths, setPaths] = useState<{ d: string; head: string }[]>([]);

  const draw = useCallback(() => {
    const c = box.current?.getBoundingClientRect();
    const m = core.current?.getBoundingClientRect();
    if (!c || !m || window.matchMedia("(max-width: 767px)").matches) {
      setPaths([]);
      return;
    }
    const rel = (b: DOMRect) => ({ l: b.left - c.left, r: b.right - c.left, cy: (b.top + b.bottom) / 2 - c.top });
    const mid = rel(m);
    const out: { d: string; head: string }[] = [];
    const elbow = (x0: number, y0: number, x1: number, y1: number) => {
      const mx = (x0 + x1) / 2;
      return { d: `M${x0} ${y0} L${mx} ${y0} L${mx} ${y1} L${x1} ${y1}`, head: `M${x1 - 6} ${y1 - 4} L${x1} ${y1} L${x1 - 6} ${y1 + 4}Z` };
    };
    for (const el of inputs.current) {
      if (!el) continue;
      const a = rel(el.getBoundingClientRect());
      out.push(elbow(a.r, a.cy, mid.l - 2, mid.cy));
    }
    for (const el of stocks.current) {
      if (!el) continue;
      const b = rel(el.getBoundingClientRect());
      out.push(elbow(mid.r, mid.cy, b.l - 2, b.cy));
    }
    setPaths(out);
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
      className="relative overflow-hidden rounded-lg border bg-muted/40 p-4 sm:p-6"
      style={{ backgroundImage: "radial-gradient(var(--border) 1px, transparent 1.3px)", backgroundSize: "18px 18px" }}
    >
      <svg className="pointer-events-none absolute inset-0 size-full overflow-visible" aria-hidden>
        {paths.map((p, i) => (
          <g key={i}>
            <path d={p.d} fill="none" strokeWidth={1.2} className="stroke-foreground/25" />
            <path d={p.head} className="fill-foreground/25" />
          </g>
        ))}
      </svg>

      <div className="relative grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,1.1fr)] md:items-center md:gap-x-14">
        <div className="flex flex-col gap-2">
          <Mono className="pb-1 text-xs uppercase tracking-wide text-muted-foreground">A stock&apos;s facts</Mono>
          {INPUTS.map((x, i) => (
            <div
              key={x.title}
              ref={(el) => {
                inputs.current[i] = el;
              }}
              className="rounded-md border bg-background px-3 py-2"
            >
              <p className="text-xs font-medium text-foreground">{x.title}</p>
              <p className="text-xs text-muted-foreground">{x.sub}</p>
            </div>
          ))}
        </div>

        <div ref={core} className="rounded-md border bg-background px-3 py-3 text-center">
          <p className="text-sm font-medium text-foreground">Every read</p>
          <p className="mt-1 text-xs text-muted-foreground">Worked out fresh each time, never stored</p>
          <Mono className="mt-2 block text-xs text-muted-foreground">situationsFor()</Mono>
        </div>

        <div className="flex flex-col gap-2">
          <Mono className="pb-1 text-xs uppercase tracking-wide text-muted-foreground">Its situations</Mono>
          {STOCKS.map((x, i) => (
            <div
              key={x.s}
              ref={(el) => {
                stocks.current[i] = el;
              }}
              className="flex flex-col gap-2 rounded-md border bg-background px-3 py-2.5"
            >
              <div className="flex items-center gap-2">
                <StockLogo ticker={x.s} size="xs" />
                <span className="text-xs font-medium text-foreground">{x.s}</span>
                <Mono className="ml-auto text-xs uppercase tracking-wide text-muted-foreground">{x.situations.length ? "Work list" : "Quiet"}</Mono>
              </div>
              {x.situations.length ? (
                <div className="flex flex-wrap gap-1">
                  {x.situations.map((s) => (
                    <span key={s} className="rounded border px-1.5 py-px text-xs text-foreground">
                      {s}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">Nothing to answer: one line in the read</p>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * How one situation reads in each place it shows, above its text on the
 * Situations library page (`situation-named CODE`). Every place prints the
 * same wording (lib/agent/situations.ts `situationLabels`): the situation's
 * name, then what raised it on that stock. The examples are worded here; a
 * real one carries the stock's own trigger.
 */
const RAISED_BY: Record<SituationCode, string | null> = {
  PROMOTED_AWAITING: null,
  PROTECTIVE_SALE: "Sell if below $804",
  BUY_ARRIVES: "Buy if above $52.25 · only on the close",
  ADD_OR_WINNER: "Add if above 10% from yesterday's close",
  REPORT: "Review if within 5 days before earnings",
  FILING: "Review if it files something material with the SEC",
  NEWS: "Review if the Market Reviewer writes a high note on it",
  PROTECTION: "2.1% of the account below here",
  REVIEW_DUE: "Review every 30 days",
  SOLD_ONE_REVIEW: null,
};

function NamedRow({ where, children }: { where: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 py-2.5 sm:flex-row sm:items-baseline sm:gap-4">
      <span className="shrink-0 text-xs font-medium uppercase tracking-wide text-muted-foreground sm:w-56">{where}</span>
      <span className="min-w-0 text-sm text-foreground">{children}</span>
    </div>
  );
}

export function SituationNamed({ arg }: { arg?: string }) {
  const code = arg as SituationCode;
  const s = SITUATIONS[code];
  if (!s) return null;
  const raised = RAISED_BY[code];
  const said = raised ? `${s.name}: ${raised}` : s.name;
  const sold = code === "SOLD_ONE_REVIEW";
  return (
    <Card>
      <CardContent>
        <div className="flex flex-col divide-y">
          <NamedRow where="In the stock table">
            {sold ? <span className="text-muted-foreground">Not in it: a sold stock is neither held nor watched.</span> : <Badge variant="secondary">{said}</Badge>}
          </NamedRow>
          <NamedRow where="On the stock's page">
            {sold ? (
              <span className="text-muted-foreground">Nothing: the stock is sold, so it has no flag line.</span>
            ) : (
              <span className="flex items-center gap-1.5">
                <FlagNotificationIcon className="size-4 shrink-0" />
                <span>Flagged for review — {said}</span>
              </span>
            )}
          </NamedRow>
          <NamedRow where="On the stock's row, as an agent reads it">
            <Mono>{sold ? `sold_to_review: [{ ticker, sold_on, ask, situations: ["${code}"] }]` : `situations: ["${code} (${said})"]`}</Mono>
          </NamedRow>
          <NamedRow where="Its instructions arrive as">
            <Mono>{`guidance.${code}`}</Mono> in the morning run&apos;s list{sold ? "" : ", or with the fire in a trigger run"}
          </NamedRow>
        </div>
      </CardContent>
    </Card>
  );
}
