"use client";

import { Clock } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TRIGGER_TYPES, actionLabel } from "@/lib/agent/triggers/condition";
import { TRIGGER_TYPE_DOCS } from "@/lib/docs/trigger-examples";
import { cn } from "@/lib/utils";
import { Code, DocBody, DocHeader, Section, Stage, Steps, TechDetails, Trio } from "../primitives";
import { ExamplePill, PillRow } from "../trigger-bits";

const ACTIONS = [
  { label: "Buy", dot: "bg-positive", body: "Fires once, on the day the price crosses its level." },
  { label: "Add", dot: "bg-positive", body: "Asks whether to press a winner." },
  { label: "Trim", dot: "bg-amber-500", body: "Takes part of the position off." },
  { label: "Sell", dot: "bg-negative", body: "The floor, the trail, the time limit." },
  { label: "Review", dot: "bg-chart-2", body: "Wakes the analyst to look and decide." },
] as const;

function Word({ word, cap, tone }: { word: string; cap?: string; tone?: "sell" | "plain" }) {
  return (
    <span className="flex flex-col items-center gap-2">
      <span
        className={cn(
          "rounded-xl px-3 py-1.5 text-2xl font-medium tracking-tight sm:text-3xl",
          tone === "plain" ? "px-0.5 text-muted-foreground" : "border bg-background shadow-sm",
          tone === "sell" && "text-negative",
        )}
      >
        {word}
      </span>
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{cap ?? " "}</span>
    </span>
  );
}

function TypeTabs() {
  return (
    <Tabs defaultValue="price">
      <TabsList width="full">
        {TRIGGER_TYPES.map((t) => (
          <TabsTrigger key={t.id} value={t.id}>
            {t.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {TRIGGER_TYPE_DOCS.map((t) => (
        <TabsContent key={t.type} value={t.type}>
          <div className="flex flex-col gap-5 pt-5">
            <p className="text-sm text-muted-foreground">{t.blurb}</p>
            <Stage>
              <div className="flex flex-col divide-y">
                {t.examples.map((e, i) => (
                  <div key={i} className="flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:gap-4">
                    <div className="flex min-w-0 shrink-0 items-center gap-2 sm:w-[26rem]">
                      <span className="w-16 shrink-0 whitespace-nowrap text-sm text-muted-foreground">{actionLabel(e.action, true)}</span>
                      <ExamplePill spec={e} index={i} />
                    </div>
                    <p className="text-sm text-muted-foreground sm:pl-0">{e.why}</p>
                  </div>
                ))}
              </div>
            </Stage>
            <div className="flex gap-3 rounded-xl border bg-card p-4">
              <Clock className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div className="flex flex-col gap-1">
                <p className="text-sm font-medium text-foreground">How it&apos;s checked</p>
                <p className="text-sm text-muted-foreground">{t.checked}</p>
              </div>
            </div>
          </div>
        </TabsContent>
      ))}
    </Tabs>
  );
}

function FireBars({ days }: { days: readonly ("off" | "fire" | "buy")[] }) {
  return (
    <div className="flex flex-col gap-1.5" aria-hidden>
      <div className="flex h-9 items-end gap-1">
        {days.map((d, i) => (
          <span
            key={i}
            className={cn(
              "flex-1 rounded-sm",
              d === "off" ? "h-2/5 bg-foreground/10" : d === "fire" ? "h-full bg-negative" : "h-full bg-positive",
            )}
          />
        ))}
      </div>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>Mon</span>
        <span>Fri</span>
      </div>
    </div>
  );
}

export function TriggersDoc() {
  return (
    <DocBody>
      <DocHeader
        lead="Write the plan once. Triggers keep it."
        rest="Every trigger is one sentence: when to buy, add, trim, sell or look again. The system checks each one all day and wakes an analyst the moment one comes true."
      />

      <Stage>
        <div className="flex flex-col items-center gap-8 py-2">
          <div className="flex flex-wrap items-end justify-center gap-x-2 gap-y-3" aria-label="Sell if below $40.80, in its parts">
            <Word word="Sell" cap="Action" tone="sell" />
            <Word word="if" tone="plain" />
            <Word word="below" cap="Watch" />
            <Word word="$40.80" cap="Level" />
          </div>
          <div className="grid w-full max-w-2xl grid-cols-2 gap-2 sm:grid-cols-5">
            {ACTIONS.map((a) => (
              <div key={a.label} className="flex flex-col gap-1 rounded-lg border bg-background p-2.5">
                <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                  <span className={cn("size-1.5 rounded-full", a.dot)} />
                  {a.label}
                </span>
                <span className="text-xs leading-snug text-muted-foreground">{a.body}</span>
              </div>
            ))}
          </div>
        </div>
      </Stage>

      <Trio
        items={[
          { title: "Checked all day", body: "Every five minutes the market is open, plus a pass at 4:20 PM on the day's close." },
          { title: "Written in plain words", body: "The same sentence everywhere: on the pill, in Activity, and in what the analyst reads." },
          { title: "Never trades on its own", body: "A fire becomes a decision. Every trade becomes a proposal you approve." },
        ]}
      />

      <Section eyebrow="Five kinds" lead="Price, chart, earnings, filings, time." rest="Pick a kind to see real triggers and how each is checked. Click a pill to open it.">
        <TypeTabs />
      </Section>

      <Section eyebrow="When one fires" lead="From a match to a proposal in minutes." rest="Nothing is skipped and nothing trades without you.">
        <Steps
          items={[
            { title: "It matches", body: "The check finds the condition true and writes the fire into the stock's Activity." },
            { title: "An analyst wakes", body: "A buy, add, trim or sale wakes a trigger run within minutes. A review waits for the next morning run." },
            { title: "It decides", body: "The analyst reads the stock, the fire and your notes, then acts, holds, or redraws the plan." },
            { title: "You approve", body: "Any trade lands in your queue with its reason. Nothing fills until you say yes." },
          ]}
        />
      </Section>

      <Section eyebrow="Two ways to fire" lead="Protection keeps asking. Buys don't chase.">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-3 rounded-xl border bg-card p-5">
            <p className="text-sm font-medium text-foreground">Sales and reviews are standing orders</p>
            <FireBars days={["off", "fire", "fire", "fire", "off"]} />
            <p className="text-sm text-muted-foreground">
              They ask every day their condition holds. Decline a sale and it asks again tomorrow, so a floor is never quietly forgotten.
            </p>
          </div>
          <div className="flex flex-col gap-3 rounded-xl border bg-card p-5">
            <p className="text-sm font-medium text-foreground">A buy fires once, on the cross</p>
            <FireBars days={["off", "off", "buy", "off", "off"]} />
            <p className="text-sm text-muted-foreground">
              A buy fires on the day the price crosses its level, not every day it stays past it. A level set after the close is measured from the
              price it was set at.
            </p>
          </div>
        </div>
      </Section>

      <Section eyebrow="Three layers" lead="Rules come from three places." rest="The closest one wins.">
        <Stage>
          <div className="mx-auto flex max-w-2xl flex-col gap-3">
            {[
              {
                n: "1",
                title: "Account rules",
                body: "Checks every holding gets.",
                specs: [
                  { action: "REVIEW", when: { watch: "repeat", value: 7 }, why: "Every holding gets a weekly look.", level: "ACCOUNT" },
                  { action: "REVIEW", when: { watch: "report", is: "before", value: 3 }, why: "A heads-up before every report.", level: "ACCOUNT" },
                ] as const,
                tone: "opacity-80",
              },
              {
                n: "2",
                title: "Analyst rules",
                body: "The analyst's style. The Compounder's only automatic sale is 25% off the high.",
                specs: [
                  { action: "EXIT", when: { watch: "move", is: "below", value: 25, variable: "peak" }, why: "The Compounder's only automatic sale.", level: "ANALYST" },
                ] as const,
                tone: "opacity-90",
              },
              {
                n: "3",
                title: "This thesis",
                body: "Its own triggers, written for this stock. They beat the rules above.",
                specs: [
                  { action: "EXIT", when: { watch: "price", is: "below", value: 384 }, why: "Under the gap-day low." },
                  { action: "REVIEW", when: { watch: "price", is: "above", value: 480 }, why: "At the target: take it, or trail higher." },
                ] as const,
                tone: "border-chart-2/40",
              },
            ].map((layer) => (
              <div key={layer.n} className={cn("flex flex-col gap-3 rounded-xl border bg-background p-4 shadow-sm", layer.tone)}>
                <div className="flex items-baseline gap-3">
                  <span className="text-xs text-muted-foreground tabular-nums">{layer.n}</span>
                  <span className="text-sm font-medium text-foreground">{layer.title}</span>
                  <span className="text-sm text-muted-foreground">{layer.body}</span>
                </div>
                <div className="flex flex-col gap-1.5 pl-6">
                  {layer.specs.map((s, i) => (
                    <PillRow key={i} action={s.action} specs={[s]} />
                  ))}
                </div>
              </div>
            ))}
          </div>
          <p className="mx-auto mt-5 max-w-xl text-center text-sm text-muted-foreground">
            A rule from above is drawn dashed. It&apos;s inherited, never copied onto the thesis, so changing an analyst&apos;s style changes it on every stock at
            once.
          </p>
        </Stage>
      </Section>

      <Section eyebrow="Rest periods" lead="Each trigger knows when to stay quiet." rest="So one condition doesn't ask fifty times a day.">
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <tbody className="divide-y">
              {[
                ["A price level, a day's move, volume, RSI", "At most once a day"],
                ["The move from our entry", "Once a week, so a milestone isn't asked twice"],
                ["A beat or a miss, a report heads-up", "Once per report"],
                ["A new filing", "Once per filing"],
                ["Insider buying", "Once every 30 days"],
                ["A review on a state, like below the 200-day", "At most once a week while it holds"],
                ["The floor and the trail on a holding", "Every day until it's answered"],
              ].map(([what, rest]) => (
                <tr key={what}>
                  <td className="px-4 py-2.5 text-foreground">{what}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{rest}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <TechDetails
        rows={[
          { label: "Shape", value: <><Code>{"{ watch, is?, value?, variable?, settings? }"}</Code>, or <Code>{"{ match, conditions }"}</Code> for two or more. Stored on the thesis, the analyst or the account.</> },
          { label: "Catalog", value: <>One entry per measure in <Code>lib/agent/triggers/condition/measures/</Code>, grouped into the five types by <Code>catalog.ts</Code>. Words from <Code>describe.ts</Code>.</> },
          { label: "Check", value: <><Code>trigger-evaluator.ts</Code>: every 5 minutes in market hours, plus a close pass 16:20–16:34 ET. Chart measures read the 06:30 <Code>TickerIndicators</Code> snapshot.</> },
          { label: "Fire semantics", value: <><Code>shouldFire</Code> in <Code>lib/agent/triggers/evaluate.ts</Code>: ENTER on the crossing; protective and review rungs re-fire while true.</> },
          { label: "Fire modes", value: <><Code>TACTICAL</Code> wakes a trigger run; <Code>DIRECT</Code> proposes a mechanical sale without the agent. Both go through approval.</> },
          { label: "Write path", value: <><Code>applyTriggerOps</Code> in <Code>lib/agent/triggers/ops.ts</Code>, shared by <Code>update_thesis</Code> and the trigger editor.</> },
          { label: "Reference", value: <><Code>docs/TRIGGERS.md</Code> · <Code>docs/plans/TRIGGER_MODEL.md</Code> · <Code>docs/plans/TRIGGER_TYPES.md</Code></> },
        ]}
      />
    </DocBody>
  );
}
