"use client";

/**
 * "In practice" on the Guide: a numbered list of everyday moments on the
 * left, and the conversation that moment produces on the right, streaming in
 * with the chat's own parts. It moves to the next moment when one finishes;
 * picking one plays it. Every ticker and number is an example.
 */

import { useEffect, useState } from "react";
import { ChatMock, Tk, type ChatStep } from "./chat-mock";
import { cn } from "@/lib/utils";
import { Mono } from "./primitives";

const STEP_MS = 1100;

const MOMENTS: ReadonlyArray<{ title: string; who: string; steps: readonly ChatStep[] }> = [
  {
    title: "Protect a winner",
    who: "Morning run",
    steps: [
      { kind: "reasoning", text: "NVDA is up 21% and its floor still sits under our entry." },
      {
        kind: "tools",
        label: "Checking live portfolio P&L and exit levels",
        rows: [{ ticker: "NVDA", text: "40 shares · $182.10 · up $1,284 (21.4%) · floor $148" }],
      },
      { kind: "text", text: <>A 21% gain with a floor below cost. Raising it so most of the gain stays ours.</> },
      {
        kind: "tools",
        label: "Updating thesis on $NVDA",
        rows: [{ text: "Updated trigger: Sell if 12% below the high since we bought" }],
      },
    ],
  },
  {
    title: "A trigger fires",
    who: "Trigger run",
    steps: [
      {
        kind: "tools",
        label: "Trigger fired on $CRWD",
        rows: [{ ticker: "CRWD", text: "Buy if within 2% of the 20-day average · $404.10 now" }],
      },
      { kind: "reasoning", text: "The plan's buy level, the drift intact, nothing in the news against it." },
      {
        kind: "tools",
        label: "Proposing a buy of $CRWD",
        rows: [{ ticker: "CRWD", action: "buy", tag: "Proposal", text: "14 shares at about $404 · sent for your approval" }],
      },
      { kind: "text", text: <>Proposed. It waits in your queue until you approve it.</> },
    ],
  },
  {
    title: "Earnings tonight",
    who: "Morning run",
    steps: [
      {
        kind: "tools",
        label: "Pulling upcoming earnings on your book",
        rows: [{ ticker: "AAPL", text: "Reports after the close · beat 7 of the last 8" }],
      },
      { kind: "reasoning", text: "Hold through the print or trim first? The plan says hold, with a floor." },
      { kind: "text", text: <><Tk s="AAPL" c={0.6} /> holds through the report. The floor at $214 stays; reviewing again tomorrow morning.</> },
      { kind: "tools", label: "Updating thesis on $AAPL", rows: [{ text: "New trigger: Review 1 day after the report" }] },
    ],
  },
  {
    title: "Find something new",
    who: "Discovery",
    steps: [
      {
        kind: "tools",
        label: "Pulling today's movers in your universe",
        rows: [
          { ticker: "ANET", text: "Up 5.2% on 2.4× volume after guidance" },
          { ticker: "CEG", text: "New 52-week high · power contracts" },
        ],
      },
      {
        kind: "tools",
        label: 'Searching the web for "Arista guidance raise"',
        rows: [{ text: "Raised the year on AI networking demand" }],
        sources: [{ provider: "Perplexity", title: "Arista raises guidance", url: "https://www.perplexity.ai" }],
      },
      {
        kind: "tools",
        label: "Adding to the watchlist",
        rows: [{ ticker: "ANET", action: "watch", text: "Watch: buy on a pullback to the 20-day" }],
      },
    ],
  },
  {
    title: "Ask why it sold",
    who: "Chat",
    steps: [
      { kind: "user", text: "Why did we sell MU?" },
      {
        kind: "tools",
        label: "Reading $MU's history",
        rows: [
          { ticker: "MU", text: "Sold 30 shares at $142.10 · you approved it at 10:12 AM" },
          { text: "The trail fired: 12% below the high since we bought" },
        ],
      },
      { kind: "text", text: <>The trail did its job. <Tk s="MU" c={-3.1} /> fell 12% from its high after the report, and the sale kept a 9% gain.</> },
    ],
  },
];

/** The line under the playing moment, filling until the next one. */
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

export function Scenarios() {
  const [i, setI] = useState(0);
  const m = MOMENTS[i];

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setTimeout(() => setI((x) => (x + 1) % MOMENTS.length), m.steps.length * STEP_MS + 3200);
    return () => window.clearTimeout(id);
  }, [i, m.steps.length]);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
      <ol className="flex flex-col">
        {MOMENTS.map((x, j) => (
          <li key={x.title}>
            <button
              type="button"
              onClick={() => setI(j)}
              className={cn(
                "relative flex w-full items-center justify-between gap-3 border-b py-4 text-left transition-colors",
                j === i ? "text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <span className="flex flex-col gap-0.5">
                <span className="text-base font-medium">{x.title}</span>
                <span className="text-xs text-muted-foreground">{x.who}</span>
              </span>
              <Mono className="text-xs tabular-nums">{String(j + 1).padStart(2, "0")}</Mono>
              {j === i ? <Progress key={i} ms={x.steps.length * STEP_MS + 3200} /> : null}
            </button>
          </li>
        ))}
      </ol>
      <div
        className="flex min-h-[26rem] items-end rounded-2xl border bg-muted/40 p-4 sm:p-8"
        style={{ backgroundImage: "radial-gradient(var(--border) 1px, transparent 1.3px)", backgroundSize: "18px 18px" }}
      >
        <div className="flex w-full flex-col gap-3 rounded-xl border bg-background p-5 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{m.who}</p>
          <ChatMock key={i} title={m.who} steps={m.steps} play bare stepMs={STEP_MS} />
        </div>
      </div>
    </div>
  );
}
