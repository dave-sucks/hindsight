"use client";

/**
 * The small product moments on the home page's agent cards: each agent at
 * work, drawn with the chat's own tool rows. Every ticker and number here is
 * an example, not anyone's position.
 */

import { ChatMock, type ChatStep } from "./chat-mock";
import type { DocSlug } from "./registry";

const ASSETS: Partial<Record<DocSlug, { title: string; steps: readonly ChatStep[] }>> = {
  discovery: {
    title: "Discovery · post-earnings drift",
    steps: [
      {
        kind: "tools",
        label: "Screening for Post-earnings drift (+2 more)",
        rows: [
          { text: "41 reported · 6 cleared the drift screen · 3 fit the analyst's rules" },
          { ticker: "CRWD", action: "watch", text: "beat 9.2%, raised the year, gap held · added to the watchlist" },
          { ticker: "ADBE", action: "watch", text: "beat 4.8%, guide up, 3.1× volume · added to the watchlist" },
          { ticker: "NKE", text: "beat, but guided down · passed" },
        ],
      },
    ],
  },
  writer: {
    title: "The Writer · CRWD",
    steps: [
      {
        kind: "tools",
        label: "Pulling $CRWD's 5-year financials (+6 more)",
        rows: [
          { text: "Financials, earnings, insiders, peers, coverage and filings pulled" },
          { text: "4 web searches: the call, guidance, estimate revisions" },
          { ticker: "CRWD", action: "watch", text: "Thesis written · buy near $412 · floor $384 · target $480" },
        ],
      },
    ],
  },
  "morning-runs": {
    title: "Morning run · Wed 8:00 AM",
    steps: [
      {
        kind: "tools",
        label: "Reading thesis library (+2 more)",
        rows: [
          { text: "11 stocks · 4 need an answer · 7 are quiet" },
          { ticker: "SHOP", action: "sell", text: "Sale fired below $96 · proposed selling 120 shares" },
          { ticker: "AVGO", text: "Earnings review · held, floor raised to $1,610" },
          { ticker: "ADBE", text: "Plan check · buy moved to $402, under the 20-day" },
        ],
      },
    ],
  },
  "trigger-runs": {
    title: "Trigger run · SHOP",
    steps: [
      {
        kind: "tools",
        label: "Pulling $SHOP's snapshot (+1 more)",
        rows: [
          { ticker: "SHOP", text: "$95.12 at 10:40 AM · 0.9% under the floor" },
          { text: "No company news; the sector is down 2.4% on the day" },
          { ticker: "SHOP", action: "sell", tag: "Proposal", text: "Sell 120 shares at about $95.12" },
        ],
      },
    ],
  },
  chat: {
    title: "What's waiting on me?",
    steps: [
      { kind: "user", text: "What's waiting on me?" },
      {
        kind: "tools",
        label: "Checking the approval queue",
        rows: [
          { ticker: "SHOP", action: "sell", text: "Sell 120 shares · expires tomorrow 10:40 AM" },
          { ticker: "LLY", action: "buy", text: "Buy 14 shares · expires today 3:05 PM" },
        ],
      },
    ],
  },
};

export function AgentAsset({ slug }: { slug: DocSlug }) {
  const a = ASSETS[slug];
  if (!a) return null;
  return <ChatMock title={a.title} steps={a.steps} composer={false} />;
}
