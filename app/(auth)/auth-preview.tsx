"use client";

/**
 * The panel beside the sign-in form: a morning run streaming in over a
 * flowing shader gradient, drawn the way the run page draws one, with no
 * window around it. It's the chat's own parts (the Reasoning block, the tool
 * rows, the source chips) through ChatMock's bare mode, so it can't drift
 * from the product. A short run told plainly: read the portfolio, the
 * earnings, the movers, a stock's chart and news and the web; then write a
 * plan, set triggers, protect a gain and propose a buy. Every ticker and
 * number is an example.
 */

import type { CSSProperties } from "react";
import { ShaderGradient } from "@/components/ui/shader-gradient";
import { ChatMock, Tk, type ChatStep } from "@/components/docs/chat-mock";

const SCRIPT: readonly ChatStep[] = [
  { kind: "reasoning", text: "Portfolio first, then the market, then anything new worth watching." },
  { kind: "text", text: "Morning. Reading your portfolio before the open." },
  {
    kind: "tools",
    label: "Checking live portfolio P&L and exit levels",
    rows: [
      { ticker: "NVDA", text: "40 shares · $182.10 · up $1,284 (21.4%) · worth $7,284" },
      { ticker: "AAPL", text: "25 shares · $231.40 · up $310 (5.7%) · worth $5,785" },
    ],
  },
  {
    kind: "tools",
    label: "Pulling upcoming earnings on your book (+1 more)",
    rows: [
      { text: "AAPL reports in 4 days" },
      { ticker: "CRWD", text: "Today's top gainer in your universe · up 6.8% on 3.1× normal volume" },
    ],
  },
  {
    kind: "tools",
    label: "Pulling $CRWD's snapshot (+1 more)",
    rows: [
      { ticker: "CRWD", text: "$418.20 · above its 50-day · beat by 9.2% and raised the year" },
      { text: "News: four analysts raised their targets after the call" },
    ],
    sources: [
      { provider: "Alpaca", title: "CRWD chart and price", url: "https://docs.alpaca.markets" },
      { provider: "Finnhub", title: "CRWD earnings and news", url: "https://finnhub.io" },
    ],
  },
  {
    kind: "tools",
    label: 'Searching the web for "CrowdStrike guidance"',
    rows: [{ text: "Guided above the Street for next year, with margins still expanding" }],
    sources: [{ provider: "Perplexity", title: "CrowdStrike raises guidance", url: "https://www.perplexity.ai" }],
  },
  {
    kind: "text",
    text: (
      <>
        <Tk s="CRWD" c={6.8} /> is a clean beat and raise. Adding it to the watchlist with a plan, not chasing today&apos;s pop.
      </>
    ),
  },
  {
    kind: "tools",
    label: "Updating thesis on $CRWD",
    rows: [
      { ticker: "CRWD", action: "watch", text: "Strategy: drifts toward $480 over the next two months as estimates rise" },
      { text: "New trigger: Buy if within 2% of the 20-day average" },
      { text: "New trigger: Sell if below $384 · only on the close" },
    ],
  },
  {
    kind: "text",
    text: (
      <>
        <Tk s="NVDA" c={2.3} /> is up 21% since we bought. Protecting most of that gain.
      </>
    ),
  },
  {
    kind: "tools",
    label: "Updating thesis on $NVDA",
    rows: [
      { text: "Updated trigger: Sell if 12% below the high since we bought" },
      { text: "New trigger: Review 4 days before earnings" },
    ],
  },
  {
    kind: "text",
    text: (
      <>
        <Tk s="AAPL" c={-1.4} /> pulled back to its 50-day, which is where the plan adds.
      </>
    ),
  },
  {
    kind: "tools",
    label: "Adding to the $AAPL position",
    rows: [{ ticker: "AAPL", action: "buy", tag: "Proposal", text: "Buy 10 more shares at about $231 · sent for your approval" }],
  },
];

const GLASS = {
  "--foreground": "oklch(1 0 0 / 0.92)",
  "--muted-foreground": "oklch(1 0 0 / 0.55)",
  "--secondary": "oklch(1 0 0 / 0.08)",
  "--secondary-foreground": "oklch(1 0 0 / 0.8)",
  "--muted": "oklch(1 0 0 / 0.08)",
  "--accent": "oklch(1 0 0 / 0.12)",
  "--border": "oklch(1 0 0 / 0.12)",
} as CSSProperties;

export function AuthPreview() {
  return (
    <div className="dark absolute inset-0 overflow-hidden bg-background">
      <div className="absolute inset-0">
        <ShaderGradient />
      </div>
      {/* A soft wash so the run reads over the brightest part of the light. */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-black/20" />
      {/* Inside the panel the neutral tokens become white at low opacity, so the
          chips, borders and muted text take on the color behind them. The
          price greens and reds are left alone. */}
      <div className="relative flex size-full items-center justify-center px-10 py-12 xl:px-16 [&_img]:ring-1 [&_img]:ring-white/15" style={GLASS}>
        {/* The run grows from the bottom of a centered window; older lines fade out at its top. */}
        <div
          className="flex h-[min(42rem,85%)] w-full max-w-xl flex-col justify-end overflow-hidden"
          style={{
            maskImage: "linear-gradient(to bottom, transparent, black 25%)",
            WebkitMaskImage: "linear-gradient(to bottom, transparent, black 25%)",
          }}
        >
          <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">Morning run · 8:00 AM</p>
          <ChatMock title="Morning run" steps={SCRIPT} play bare stepMs={1300} />
        </div>
      </div>
    </div>
  );
}
