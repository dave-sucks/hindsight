"use client";

import { Check, Zap } from "lucide-react";
import { TickerBadge } from "@/components/ui/ticker-badge";
import { ChatMock, Tk } from "../chat-mock";
import { Code, DocBody, DocHeader, Section, Stage, Steps, TechDetails, Trio } from "../primitives";
import { AgentTools } from "../tool-catalog";
import { ExamplePill } from "../trigger-bits";

export function TriggerRunsDoc() {
  return (
    <DocBody>
      <DocHeader
        lead="When a stock moves, an analyst looks."
        rest="A trigger fires, and within minutes an analyst reads that one stock, checks what's true now, and proposes what to do."
      />

      <Stage label="Example run">
        <div className="mx-auto flex max-w-xl flex-col items-stretch">
          <div className="relative mt-4 rounded-2xl border bg-background p-3.5 shadow-sm">
            <span className="absolute -top-5 left-[-1px] inline-flex items-center gap-1 rounded-t-md bg-foreground px-2 pb-1 pt-0.5 text-xs font-medium text-background">
              <Zap className="size-2.5" />
              Trigger
            </span>
            <span className="absolute -top-2.5 right-3 inline-flex items-center gap-1 rounded-full border border-positive/25 bg-positive/10 px-2 py-px text-xs font-medium text-positive">
              <Check className="size-3" strokeWidth={3} />
              Triggered 10:40 AM
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <TickerBadge ticker="SHOP" />
              <span className="text-sm text-muted-foreground">Sell</span>
              <ExamplePill spec={{ action: "EXIT", when: { watch: "price", is: "below", value: 96 }, why: "Under the gap-day low, the drift has failed." }} />
            </div>
          </div>
          <div className="mx-auto h-7 w-px bg-border" />
          <ChatMock
            title="Trigger run · SHOP · 10:41 AM"
            composer={false}
            steps={[
              {
                kind: "tools",
                label: "Pulling $SHOP's snapshot (+1 more)",
                rows: [
                  { ticker: "SHOP", text: "$95.12 at 10:40 AM · 0.9% under the floor · volume 1.6× normal" },
                  { text: "No company news since the report; software is down 2.4% on the day" },
                ],
              },
              {
                kind: "text",
                text: (
                  <>
                    Selling <Tk s="SHOP" c={-3.4} /> at $95.12. The floor sat under the gap-day low, and it broke on heavy volume with nothing new on the business. The
                    drift has failed.
                  </>
                ),
              },
              {
                kind: "tools",
                label: "Closing $SHOP position",
                rows: [{ ticker: "SHOP", action: "sell", tag: "Proposal", text: "Sell 120 shares at about $95.12 · waiting for your approval" }],
              },
            ]}
          />
        </div>
      </Stage>

      <Trio
        items={[
          { title: "One stock, one decision", body: "It reads only the stock that fired, in full: the belief, the plan, the fire and anything you've said." },
          { title: "Fast, not hasty", body: "It checks the price is still past the line and what's new before it acts. A dip that has already recovered is a hold." },
          { title: "Fifteen steps at most", body: "A trigger run is short by design. Deep research goes to the Writer instead." },
        ]}
      />

      <Section eyebrow="How it works" lead="Fire, wake, check, decide.">
        <Steps
          items={[
            { title: "Fires", body: "The five-minute check finds a buy, add, trim or sale trigger true and writes the fire into Activity." },
            { title: "Wakes", body: "A trigger run starts on that stock within minutes, with the fire as its reason to look." },
            { title: "Checks", body: "The live price, the news, the chart, the thesis and your notes. Is the condition still true, and does it still matter?" },
            { title: "Decides", body: "A proposal, a redrawn line, or a hold with its reason. One note on the stock says which and why." },
          ]}
        />
      </Section>

      <Section eyebrow="What it can do" lead="Act, redraw, or hold, and say why.">
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            { t: "Act", b: "Propose the sale, the trim, the add or the buy. It reaches your queue, your email and your phone at once." },
            { t: "Redraw the line", b: "Move the trigger to a level the chart supports. After you decline a sale, the floor may come down at most 15%." },
            { t: "Hold, with a reason", b: "A sale it doesn't make keeps asking every day the price stays past the line, until someone answers it." },
          ].map((c) => (
            <div key={c.t} className="flex flex-col gap-1.5 rounded-xl border bg-card p-4">
              <p className="text-sm font-medium text-foreground">{c.t}</p>
              <p className="text-sm text-muted-foreground">{c.b}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section eyebrow="When it doesn't wake" lead="Not every fire needs a run.">
        <Trio
          items={[
            { title: "Reviews wait for the morning", body: "A review is a question, not an order. It waits for the analyst's next morning run, with the fire on the stock's list." },
            { title: "Some sales skip the agent", body: "A mechanical floor can be set to propose the sale straight away, with no run at all. It still waits for your approval." },
            { title: "Outside market hours", body: "The check runs 9:30 to 4:00 ET on trading days, plus a 4:20 PM pass for levels that read the close." },
          ]}
        />
      </Section>

      <Section eyebrow="Tools" lead="What a trigger run can use." rest="Read from the code.">
        <AgentTools agent="trigger" />
      </Section>

      <TechDetails
        rows={[
          { label: "Wake", value: <><Code>trigger-evaluator.ts</Code> emits <Code>app/thesis.trigger.fired</Code>; <Code>tactical-run.ts</Code> consumes it. A REVIEW fire is batched to the next daily run.</> },
          { label: "Mode", value: <><Code>tactical</Code> · <Code>gpt-5.4</Code> · up to 15 steps</> },
          { label: "Prompt", value: <><Code>lib/agent/system-prompts/intraday-tactical.ts</Code>, with the stock&apos;s situations and their texts from <Code>SITUATIONS</Code>.</> },
          { label: "Direct sales", value: <><Code>fireMode: DIRECT</Code> on a mechanical EXIT short-circuits past the agent to <Code>closeOpenPosition</Code>, which still goes through <Code>maybeAwaitApproval</Code>.</> },
          { label: "Closing save", value: <>The run ends with one <Code>update_thesis</Code>; its save takes only the fields a run answering one fire changes.</> },
        ]}
      />
    </DocBody>
  );
}
