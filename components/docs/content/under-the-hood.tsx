"use client";

import type { ReactNode } from "react";
import type { ToolSource } from "@/lib/docs/tools";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { DocRef, DocSection, P, Ul } from "../doc-text";
import { Code, DocBody, DocHeader, Stage, TechDetails } from "../primitives";
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


export function UnderTheHoodDoc() {
  return (
    <DocBody>
      <DocHeader lead="Under the hood." rest="Where the data comes from, when everything runs, and which model does what.">
        The parts underneath the agents, for when you want to know how something actually works.
      </DocHeader>

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

      <DocSection title="Everything runs on a clock">
        <P>Eastern time, on trading days unless it says otherwise.</P>
        <Ul>
          {CLOCK.map(([t, b]) => (
            <li key={t}>
              <strong>{t}:</strong> {b}
            </li>
          ))}
        </Ul>
      </DocSection>

      <DocSection title="Where the data comes from">
        <P>
          Live prices and every bar come from Alpaca, off the consolidated tape, with Finnhub behind it if a price can&apos;t be had. A live price is never
          cached, and every quote carries the time it printed, so a stale one is said out loud instead of passed off as now. Earnings, company numbers, news
          and insider trades come from Finnhub; filings straight from the SEC; the web from Perplexity and Claude&apos;s own search; X from Grok.
        </P>
        <P>
          Some data isn&apos;t on any plan we hold: analyst price targets, forward revenue and EPS estimates, an economic calendar and options chains. The tools
          say so when asked, and never guess.
        </P>
      </DocSection>

      <DocSection title="The right model for each job">
        <Ul>
          {MODELS.map(([who, model, why]) => (
            <li key={who}>
              <strong>{who}:</strong> {model}. {why}
            </li>
          ))}
        </Ul>
      </DocSection>

      <DocSection title="What an agent is told">
        <P>
          Every agent is a job and a list of tools, plus the parts every agent shares: the house rules (how to write, and that your word comes first), the
          analyst&apos;s brief, and the read of its stocks. What a stock needs arrives with the stock, through its{" "}
          <DocRef slug="situations">situations</DocRef>, never in a prompt. The Framework tab takes one request apart, piece by piece, with every size measured
          from the code.
        </P>
        <Link href="/docs/framework" className="inline-flex w-fit items-center gap-1 text-sm font-medium text-foreground underline-offset-4 hover:underline">
          Open the Framework
          <ArrowRight className="size-3.5" />
        </Link>
      </DocSection>

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
