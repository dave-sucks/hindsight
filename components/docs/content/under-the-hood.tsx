"use client";

import type { ReactNode } from "react";
import type { ToolSource } from "@/lib/docs/tools";
import { Code, DocBody, DocHeader, Mono, Section, Stage, TechDetails } from "../primitives";
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

const CLOCK: readonly [string, string][] = [
  ["6:25 AM", "Every market-data source is probed; an email goes out if one is empty or erroring."],
  ["6:30 AM", "The chart numbers for every stock on the book: averages, highs, RSI, strength, gaps, insider buys."],
  ["8:00 AM", "Morning runs, on each analyst's run days."],
  ["9:30 AM – 4:00 PM", "The trigger check, every five minutes. Holdings' highs are tracked hourly for the trails."],
  ["10:00 AM", "The morning digest: what the runs did, in one email."],
  ["4:20 PM", "The close pass: levels that read the closing price."],
  ["5:00 PM", "End-of-day snapshots of every position."],
  ["8:00 PM", "The portfolio digest the next morning's runs read."],
  ["Sundays", "Weekly scorecards: win rate, and how well conviction matched outcomes."],
];

const MODELS: readonly [string, string, string][] = [
  ["Morning runs, trigger runs, discovery", "GPT-5.4", "Up to 65, 15 and 45 steps a run, with the prompt cached between steps."],
  ["The Writer", "Claude Sonnet 4.6", "Won a side-by-side test on grounded research and getting fiscal years right."],
  ["Chat", "Claude Sonnet 4.6", "With thinking on, for the questions that need a careful answer."],
  ["Analyst builder", "GPT-4o", "Fast, because you're waiting on it in a conversation."],
];

const NOT_AVAILABLE = ["Analyst price targets", "Forward revenue and EPS estimates", "An economic calendar", "Options chains"];

export function UnderTheHoodDoc() {
  return (
    <DocBody>
      <DocHeader
        lead="Under the hood."
        rest="Where the data comes from, when everything runs, which model does what, and what the analysts actually read."
      />

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

      <Section eyebrow="The day" lead="Everything runs on a clock." rest="Eastern time, on trading days unless it says otherwise.">
        <ol className="flex flex-col">
          {CLOCK.map(([t, b]) => (
            <li key={t} className="grid gap-1 border-t py-3 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-4">
              <span className="text-xs font-medium text-foreground tabular-nums sm:pt-0.5">{t}</span>
              <span className="text-sm text-muted-foreground">{b}</span>
            </li>
          ))}
        </ol>
      </Section>

      <Section eyebrow="Models" lead="The right model for each job.">
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full min-w-[34rem] text-sm">
            <tbody className="divide-y">
              {MODELS.map(([who, model, why]) => (
                <tr key={who}>
                  <td className="px-4 py-3 text-foreground">{who}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-foreground">
                    <Mono>{model}</Mono>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{why}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section eyebrow="What an analyst is told" lead="Three layers of instructions, and one read." rest="The house rules every agent shares, the analyst's own brief, and the job for this run. What a stock needs arrives with the stock, never in the prompt.">
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            { t: "House rules", b: "How every agent writes and how your word is read. One file, shared by every door." },
            { t: "The analyst brief", b: "Its strategy, rules, sizing and universe." },
            { t: "The job", b: "The morning's review, one fired stock, or your question." },
          ].map((c) => (
            <div key={c.t} className="flex flex-col gap-1.5 rounded-xl border bg-card p-4">
              <p className="text-sm font-medium text-foreground">{c.t}</p>
              <p className="text-sm text-muted-foreground">{c.b}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section eyebrow="What we don't have" lead="Said plainly, never guessed." rest="No data plan we hold serves these. The tools report them as missing instead of making them up.">
        <div className="flex flex-wrap gap-1.5">
          {NOT_AVAILABLE.map((n) => (
            <span key={n} className="rounded-full border border-dashed px-3 py-1 text-sm text-muted-foreground">
              {n}
            </span>
          ))}
        </div>
      </Section>

      <TechDetails
        rows={[
          { label: "Jobs", value: <>Inngest functions in <Code>lib/inngest/functions/</Code>, served from <Code>app/api/inngest/route.ts</Code>.</> },
          { label: "Live price", value: <><Code>lib/market-data/live-quote.ts</Code>: Alpaca first, Finnhub behind it. Never cached.</> },
          { label: "Chart numbers", value: <><Code>indicator-snapshot.ts</Code> → <Code>TickerIndicators</Code>, from <Code>lib/market-data/price-structure.ts</Code>.</> },
          { label: "Prompts", value: <><Code>lib/agent/system-prompt.ts</Code> (morning), <Code>lib/agent/system-prompts/intraday-tactical.ts</Code> (trigger), <Code>buildPrincipalSystemPrompt</Code> in <Code>lib/agent/modes.ts</Code> (chat), <Code>lib/agent/house-rules.ts</Code>, <Code>lib/agent/voice.ts</Code>.</> },
          { label: "Plans", value: <><Code>docs/plans/AGENT_ARCHITECTURE.md</Code> · <Code>docs/PRINCIPLES.md</Code></> },
        ]}
      />
    </DocBody>
  );
}
