"use client";

import type { ReactNode } from "react";
import type { ToolSource } from "@/lib/docs/tools";
import { Stage } from "../primitives";
import { SourceMark } from "../tool-catalog";

const LAYERS: readonly { tag: string; title: string; body: string; chips: ReactNode }[] = [
  {
    tag: "Market data",
    title: "Five vendors, read live",
    body: "Prices, bars, earnings, filings, the web and X.",
    chips: (["alpaca", "finnhub", "sec", "perplexity", "xai", "anthropic"] as ToolSource[]).map((s) => <SourceMark key={s} source={s} size="sm" />),
  },
  {
    tag: "Your book",
    title: "The record",
    body: "Theses, triggers, positions, orders and your notes, with every change in Activity.",
    chips: null,
  },
  {
    tag: "The read",
    title: "What each stock needs today",
    body: "Situations worked out from the facts, with the live price, the chart numbers and the guidance attached.",
    chips: null,
  },
  {
    tag: "The analysts",
    title: "One desk, five agents",
    body: "Morning runs, trigger runs, chat, discovery and the Writer, each with its own tools.",
    chips: null,
  },
  {
    tag: "You",
    title: "The only veto",
    body: "Every trade waits for your approval. Every edit is yours to change.",
    chips: null,
  },
];

/** The system in layers: the data, the record, the read, the analysts, and you. */
export function SystemLayers() {
  return (
    <Stage>
      <div className="mx-auto flex max-w-2xl flex-col items-stretch">
        {LAYERS.map((l, i) => (
          <div key={l.tag} className="flex flex-col items-stretch">
            {i > 0 ? <div className="mx-auto h-5 w-px bg-border" /> : null}
            <div
              className="grid gap-x-5 gap-y-2 rounded-2xl border bg-background p-4 shadow-sm sm:grid-cols-[8.5rem_minmax(0,1fr)]"
              style={{ marginInline: `${Math.max(0, 2 - Math.abs(2 - i)) * 0.75}rem` }}
            >
              <span className="pt-0.5 text-xs uppercase tracking-wide text-muted-foreground">{l.tag}</span>
              <div className="flex min-w-0 flex-col gap-1">
                <span className="text-sm font-medium text-foreground">{l.title}</span>
                <span className="text-sm text-muted-foreground">{l.body}</span>
                {l.chips ? <span className="mt-1.5 flex flex-wrap gap-1.5">{l.chips}</span> : null}
              </div>
            </div>
          </div>
        ))}
      </div>
    </Stage>
  );
}
