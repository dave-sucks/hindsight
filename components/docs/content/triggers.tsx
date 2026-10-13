"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TRIGGER_TYPES, actionLabel } from "@/lib/agent/triggers/condition";
import { TRIGGER_TYPE_DOCS } from "@/lib/docs/trigger-examples";
import { DocRef, DocSection, P, Ul } from "../doc-text";
import { Code, DocBody, DocFact, DocHeader, TechDetails } from "../primitives";
import { TriggerLog } from "../concept-cards";
import { ExamplePill, PillRow } from "../trigger-bits";


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
            <P>{t.blurb}</P>
            {t.examples.map((e, i) => (
              <div key={i} className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground">{actionLabel(e.action, true)}</span>
                  <ExamplePill spec={e} index={i} />
                </div>
                <P>{e.why}</P>
              </div>
            ))}
            <DocFact label="How it's checked">{t.checked}</DocFact>
          </div>
        </TabsContent>
      ))}
    </Tabs>
  );
}

export function TriggersDoc() {
  return (
    <DocBody>
      <DocHeader lead="Write the plan once. Triggers keep it." rest="Every trigger is one sentence: when to buy, add, trim, sell or look again.">
        The system checks each one all day and wakes the analyst the moment one comes true.
      </DocHeader>

      {/* The same live log as the Triggers card on the home page. */}
      <div className="h-72 rounded-lg bg-muted/50 p-5" aria-hidden>
        <TriggerLog />
      </div>

      <DocSection title="What a trigger is">
        <P>
          A trigger is a condition and an action, written as one sentence: &ldquo;Sell if below $40.80&rdquo;, &ldquo;Review 7 days before earnings&rdquo;.
          The same sentence appears everywhere: on the pill on the thesis sheet, in Activity, and in what the analyst reads. A{" "}
          <DocRef slug="theses">thesis</DocRef>&apos;s whole plan is its triggers, including its buy, its floor and its target.
        </P>
        <P>There are five actions:</P>
        <Ul>
          <li>
            <strong>Buy</strong> opens a position on a stock we watch.
          </li>
          <li>
            <strong>Add</strong> asks whether to press a winner.
          </li>
          <li>
            <strong>Trim</strong> takes part of a position off.
          </li>
          <li>
            <strong>Sell</strong> is the floor, the trail or the time limit.
          </li>
          <li>
            <strong>Review</strong> wakes the analyst to look and decide, without an order behind it.
          </li>
        </Ul>
      </DocSection>

      <DocSection title="Five kinds">
        <P>Price, chart, earnings, filings and time. Pick a kind to see real triggers and how each is checked; click a pill to open it.</P>
        <TypeTabs />
      </DocSection>

      <DocSection title="When they're checked">
        <P>
          Every five minutes while the market is open, plus a pass at 4:20 PM for levels that read the day&apos;s close. The chart numbers (averages, highs,
          volume, strength against the market) are worked out at 6:30 every morning, so every check that day reads the same numbers.
        </P>
      </DocSection>

      <DocSection title="When one fires">
        <P>
          The fire is written into the stock&apos;s Activity, with the price that fired it. A buy, add, trim or sale wakes a{" "}
          <DocRef slug="trigger-runs">trigger run</DocRef> within minutes; a review waits for the analyst&apos;s next{" "}
          <DocRef slug="morning-runs">morning run</DocRef>. Either way, a trigger never trades on its own: anything it leads to is a{" "}
          <DocRef slug="approvals">proposal</DocRef> you approve.
        </P>
      </DocSection>

      <DocSection title="Protection keeps asking. Buys don't chase.">
        <Ul>
          <li>
            <strong>Sales and reviews are standing orders.</strong> They ask every day their condition holds. Decline a sale and it asks again tomorrow, so a
            floor is never quietly forgotten.
          </li>
          <li>
            <strong>A buy fires once, on the cross.</strong> It fires on the day the price reaches its level, not every day it stays there. A level set after the
            close is measured from the price it was set at.
          </li>
        </Ul>
      </DocSection>

      <DocSection title="Rules come from three places">
        <P>
          A stock&apos;s triggers are its own, plus the ones it inherits from its <DocRef slug="analysts">analyst</DocRef> and from the account. The closest
          one wins: a trigger on the thesis beats the analyst&apos;s, which beats the account&apos;s.
        </P>
        {[
          {
            title: "1. Account rules",
            body: "Checks every holding gets.",
            specs: [
              { action: "REVIEW", when: { watch: "repeat", value: 7 }, why: "Every holding gets a weekly look.", level: "ACCOUNT" },
              { action: "REVIEW", when: { watch: "report", is: "before", value: 3 }, why: "A heads-up before every report.", level: "ACCOUNT" },
            ] as const,
          },
          {
            title: "2. Analyst rules",
            body: "The analyst's style. The Compounder's only automatic sale is 25% off the high.",
            specs: [
              { action: "EXIT", when: { watch: "move", is: "below", value: 25, variable: "peak" }, why: "The Compounder's only automatic sale.", level: "ANALYST" },
            ] as const,
          },
          {
            title: "3. This thesis",
            body: "Its own triggers, written for this stock. They beat the rules above.",
            specs: [
              { action: "EXIT", when: { watch: "price", is: "below", value: 384 }, why: "Under the gap-day low." },
              { action: "REVIEW", when: { watch: "price", is: "above", value: 480 }, why: "At the target: take it, or trail higher." },
            ] as const,
          },
        ].map((layer) => (
          <div key={layer.title} className="flex flex-col gap-2">
            <DocFact label={layer.title}>{layer.body}</DocFact>
            <div className="flex flex-col gap-1.5">
              {layer.specs.map((sp, i) => (
                <PillRow key={i} action={sp.action} specs={[sp]} />
              ))}
            </div>
          </div>
        ))}
        <P>
          A rule from above is drawn dashed. It&apos;s inherited, never copied onto the thesis, so changing an analyst&apos;s style changes it on every stock at
          once.
        </P>
      </DocSection>

      <DocSection title="Rest periods">
        <P>Each trigger knows when to stay quiet, so one condition doesn&apos;t ask fifty times a day.</P>
        <Ul>
          <li>A price level, a day&apos;s move, volume or RSI: at most once a day.</li>
          <li>The move from our entry: once a week, so a milestone isn&apos;t asked twice.</li>
          <li>A beat or a miss, or a heads-up before a report: once per report.</li>
          <li>A new filing: once per filing. Insider buying: once every 30 days.</li>
          <li>A review on a state, like being below the 200-day: at most once a week while it holds.</li>
          <li>The floor and the trail on a holding: every day until it&apos;s answered.</li>
        </Ul>
      </DocSection>

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
