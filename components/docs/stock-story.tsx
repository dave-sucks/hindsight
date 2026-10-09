"use client";

/**
 * The Guide's opening: one stock's life across the agents, start to finish.
 * Discovery finds it, the Writer writes its thesis, a morning review leaves
 * it alone, its buy trigger fires and a buy is proposed, and you check a
 * headline in chat before saying yes. The list on the left is the agents,
 * closed to just their names; the open one says one sentence and links to
 * its page. The conversation on the right streams in with the chat's own
 * parts and moves on when it finishes. Every ticker and number is an example.
 */

import { useEffect, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ChatMock, Tk, type ChatStep } from "./chat-mock";
import { Mono } from "./primitives";
import type { DocSlug } from "./registry";

const STEP_MS = 1100;
const HOLD_MS = 3400;

const CHAPTERS: ReadonlyArray<{ name: string; doc: DocSlug; blurb: string; steps: readonly ChatStep[] }> = [
  {
    name: "Discovery",
    doc: "discovery",
    blurb: "You ask for new names. CRWD beat, raised its year and held the gap, so Discovery sends it to the Writer.",
    steps: [
      { kind: "user", text: "Find drift names off this week's reports." },
      {
        kind: "tools",
        label: "Pulling reported earnings outside your coverage (+1 more)",
        rows: [
          { text: "41 companies reported in the last 3 days · 9 beat by 5% or more" },
          { text: "Screening for Post-earnings drift: 3 held their gap and fit the analyst" },
        ],
      },
      { kind: "text", text: <><Tk s="CRWD" c={6.8} /> is the cleanest: beat by 9%, raised the year, held the gap on 3× volume. Sending it to the Writer.</> },
      { kind: "tools", label: "Dispatching $CRWD thesis-writer", rows: [{ ticker: "CRWD", action: "watch", text: "Writing the thesis · buy trigger, floor and target required" }] },
    ],
  },
  {
    name: "Thesis Writer",
    doc: "writer",
    blurb: "The Writer researches CRWD in depth and writes its thesis, with the plan: where to buy, the floor, the target.",
    steps: [
      {
        kind: "tools",
        label: "Researching $CRWD (+3 more)",
        rows: [
          { text: "Earnings: beat 8 of the last 8 · guidance raised twice this year" },
          { text: "Filings: the 10-Q and two insider sales, both planned" },
        ],
        sources: [
          { provider: "Finnhub", title: "CRWD earnings history", url: "https://finnhub.io" },
          { provider: "SEC", title: "CRWD 10-Q", url: "https://www.sec.gov" },
        ],
      },
      {
        kind: "tools",
        label: "Writing the thesis on $CRWD",
        rows: [
          { ticker: "CRWD", action: "watch", text: "Strategy: drifts toward $480 over two months as estimates rise" },
          { text: "Buy if within 2% of the 20-day average · about $401" },
          { text: "Sell if below $384 on the close · target $480" },
        ],
      },
      { kind: "text", text: <>On the watchlist. It buys only on a pullback to the 20-day, not at today&apos;s pop.</> },
    ],
  },
  {
    name: "Morning Review",
    doc: "morning-runs",
    blurb: "Every weekday the analyst reads its whole book. Nothing changed on CRWD, so it gets one line and waits.",
    steps: [
      { kind: "reasoning", text: "Reading the book before the open. Only stocks in a situation need a decision." },
      {
        kind: "tools",
        label: "Reading your book",
        rows: [
          { ticker: "NVDA", tag: "Listed", text: "Up 21% with a floor below cost · needs a decision" },
          { ticker: "CRWD", tag: "Quiet", text: "$418.20 · buy $401 · next review Oct 14" },
        ],
      },
      { kind: "text", text: <><Tk s="CRWD" c={-0.4} /> is quiet: still above its buy level, nothing new. It waits.</> },
    ],
  },
  {
    name: "Acting on Triggers",
    doc: "trigger-runs",
    blurb: "Three days later CRWD pulls back to its 20-day. The buy trigger fires and the analyst proposes the buy.",
    steps: [
      { kind: "tools", label: "Trigger fired on $CRWD", rows: [{ ticker: "CRWD", text: "Buy if within 2% of the 20-day average · $404.10 now" }] },
      { kind: "reasoning", text: "The pullback the plan waited for. The drift is intact and nothing in the news is against it." },
      { kind: "tools", label: "Proposing a buy of $CRWD", rows: [{ ticker: "CRWD", action: "buy", tag: "Proposal", text: "14 shares at about $404 · sent for your approval" }] },
      { kind: "text", text: <>Proposed. It waits in your queue until you say yes.</> },
    ],
  },
  {
    name: "Chat",
    doc: "chat",
    blurb: "Before approving, you ask about a headline. The analyst checks it against the thesis, and the decision is yours.",
    steps: [
      { kind: "user", text: "Saw a headline about a CrowdStrike outage. Does that change the buy?" },
      {
        kind: "tools",
        label: 'Searching the web for "CrowdStrike outage"',
        rows: [{ text: "A regional incident on one product, resolved in 40 minutes" }],
        sources: [{ provider: "Perplexity", title: "CrowdStrike status incident", url: "https://www.perplexity.ai" }],
      },
      { kind: "tools", label: "Reading $CRWD's thesis", rows: [{ ticker: "CRWD", text: "Would prove it wrong: a close under the gap day's low · not hit" }] },
      { kind: "text", text: <>It&apos;s minor and already fixed, and nothing the thesis rests on moved. The buy still fits. It&apos;s in your queue when you&apos;re ready.</> },
    ],
  },
];

/** The line under the open chapter, filling until the next one. */
function Progress({ ms }: { ms: number }) {
  const [full, setFull] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setFull(true));
    return () => cancelAnimationFrame(id);
  }, []);
  return (
    <span
      className="absolute -bottom-px left-0 h-px bg-foreground transition-[width] ease-linear motion-reduce:hidden"
      style={{ width: full ? "100%" : "0%", transitionDuration: `${ms}ms` }}
    />
  );
}

export function StockStory({ onOpen }: { onOpen: (slug: DocSlug) => void }) {
  const [i, setI] = useState(0);
  const c = CHAPTERS[i];
  const ms = c.steps.length * STEP_MS + HOLD_MS;

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setTimeout(() => setI((x) => (x + 1) % CHAPTERS.length), ms);
    return () => window.clearTimeout(id);
  }, [i, ms]);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,19rem)_minmax(0,1fr)]">
      <ol className="flex flex-col">
        {CHAPTERS.map((x, j) => {
          const open = j === i;
          return (
            <li key={x.name} className="relative border-b">
              <button
                type="button"
                onClick={() => setI(j)}
                aria-expanded={open}
                className={cn(
                  "flex w-full items-center justify-between gap-3 py-3.5 text-left text-base font-medium transition-colors",
                  open ? "text-foreground" : "text-muted-foreground/60 hover:text-foreground",
                )}
              >
                {x.name}
                <Mono className="text-xs font-normal tabular-nums">{String(j + 1).padStart(2, "0")}</Mono>
              </button>
              {open ? (
                <div className="flex flex-col items-start gap-3 pb-4">
                  <p className="text-sm leading-6 text-muted-foreground">{x.blurb}</p>
                  <Button variant="outline" size="sm" onClick={() => onOpen(x.doc)}>
                    How it works
                    <ArrowUpRight />
                  </Button>
                </div>
              ) : null}
              {open ? <Progress key={i} ms={ms} /> : null}
            </li>
          );
        })}
      </ol>
      <div
        className="flex min-h-[27rem] items-end rounded-2xl border bg-muted/40 p-4 sm:p-8"
        style={{ backgroundImage: "radial-gradient(var(--border) 1px, transparent 1.3px)", backgroundSize: "18px 18px" }}
      >
        <div className="flex w-full flex-col gap-3 rounded-xl border bg-background p-5 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{c.name}</p>
          <ChatMock key={i} title={c.name} steps={c.steps} play bare stepMs={STEP_MS} />
        </div>
      </div>
    </div>
  );
}
