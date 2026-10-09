"use client";

import { Tk } from "../chat-mock";
import { ChatExample, DocRef, DocSection, P, ToolRef, Ul } from "../doc-text";
import { Code, DocBody, DocHeader, TechDetails } from "../primitives";
import { AgentTools } from "../tool-catalog";

export function TriggerRunsDoc() {
  return (
    <DocBody>
      <DocHeader lead="When a stock moves, an analyst looks." rest="A trigger fires, and within minutes its analyst reads that one stock and decides.">
        It checks what&apos;s true now, then proposes the trade, redraws the line, or holds and says why.
      </DocHeader>

      <ChatExample
        caption="A sale trigger fires on SHOP during the day."
        steps={[
          { kind: "tools", label: "Trigger fired on $SHOP", rows: [{ ticker: "SHOP", text: "Sell if below $96 · $95.12 at 10:40 AM" }] },
          {
            kind: "tools",
            label: "Pulling $SHOP's snapshot (+1 more)",
            rows: [
              { ticker: "SHOP", text: "$95.12 · 0.9% under the floor · volume 1.6× normal" },
              { text: "No company news since the report; software is down 2.4% on the day" },
            ],
          },
          { kind: "text", text: <>Selling <Tk s="SHOP" c={-3.4} /> at $95.12. The floor sat under the gap-day low and broke on heavy volume with nothing new on the business. The drift has failed.</> },
          { kind: "tools", label: "Closing $SHOP position", rows: [{ ticker: "SHOP", action: "sell", tag: "Proposal", text: "Sell 120 shares at about $95.12 · waiting for your approval" }] },
        ]}
      />

      <DocSection title="What it does">
        <P>
          A trigger run is the analyst&apos;s short, focused look at one stock, started by one of its <DocRef slug="triggers">triggers</DocRef>. It reads only
          that stock, checks whether the fire still holds, and makes one decision. It has fifteen steps at most; deep research goes to{" "}
          <DocRef slug="writer" /> instead.
        </P>
      </DocSection>

      <DocSection title="What wakes it">
        <P>
          Every five minutes while the market is open, plus a pass at 4:20 PM for levels that read the close, every trigger on every stock is checked. When a buy,
          add, trim or sale trigger comes true, the fire is written into Activity and a trigger run starts on that stock.
        </P>
        <Ul>
          <li>
            <strong>Reviews wait for the morning.</strong> A review is a question, not an order, so it goes on the stock&apos;s list for the next{" "}
            <DocRef slug="morning-runs" />. The one exception: a worrying new filing on a stock we hold wakes a run the same day.
          </li>
          <li>
            <strong>Some sales skip the run.</strong> A floor can be set to propose its sale straight away, with no analyst at all. It still waits for your
            approval.
          </li>
          <li>
            <strong>A buy fires on the crossing.</strong> It fires the moment the price reaches its level, not every day it stays there. A sale keeps asking every
            day its condition holds.
          </li>
        </Ul>
      </DocSection>

      <DocSection title="What it reads">
        <P>
          The stock&apos;s row, the same one <ToolRef name="get_theses" /> gives every agent: the position, the plan, every trigger with its id, the belief and
          what would prove it wrong, and anything you&apos;ve said. The trigger that fired comes with the words you wrote when you set it, and each{" "}
          <DocRef slug="situations">situation</DocRef> the stock is in brings its instructions. Then <ToolRef name="get_stock_data" /> gives the live price and
          the news.
        </P>
        <P>
          A give-back is measured from the highest price since the buy, kept over the whole holding. The run can&apos;t call a fire false by reading a lower high
          off a short chart; declining a sale takes new evidence about the business.
        </P>
      </DocSection>

      <DocSection title="What it can do">
        <Ul>
          <li>
            <strong>Act:</strong> propose the sale with <ToolRef name="close_position" />, the trim or add with <ToolRef name="manage_position" />, or the buy with{" "}
            <ToolRef name="place_trade" />. It reaches your queue, your email and your phone at once.
          </li>
          <li>
            <strong>Redraw the line:</strong> move the trigger to a level the chart supports. After you&apos;ve declined a sale, a floor may come down at most
            15%, and nothing else may be loosened.
          </li>
          <li>
            <strong>Hold, with a reason:</strong> &ldquo;Not acting yet&rdquo; and why. A sale it doesn&apos;t make asks again every day the price stays past the
            line.
          </li>
        </Ul>
        <P>
          Whatever it decides, it then brings the stock&apos;s other triggers up to date: after an add the floor goes up, and after a level is blown through
          it&apos;s reset off the new chart, not a round number.
        </P>
      </DocSection>

      <DocSection title="How it ends">
        <P>
          At most one trade, then exactly one <ToolRef name="update_thesis" /> saying what it did and why, linked to the trigger that fired, and{" "}
          <ToolRef name="complete_run" />. If you declined this same trade earlier, the note answers you by name.
        </P>
      </DocSection>

      <DocSection title="Tools">
        <P>Everything a trigger run can call, read from the code.</P>
        <AgentTools agent="trigger" />
      </DocSection>

      <TechDetails
        rows={[
          { label: "Wake", value: <><Code>lib/inngest/functions/trigger-evaluator.ts</Code> sends <Code>app/thesis.trigger.fired</Code>; <Code>tactical-run.ts</Code> starts the run. A review writes its fire and waits, unless a same-day filing calls for a look.</> },
          { label: "Mode", value: <><Code>tactical</Code> in <Code>lib/agent/modes.ts</Code>: <Code>gpt-5.4</Code>, up to 15 steps.</> },
          { label: "Prompt", value: <><Code>lib/agent/system-prompts/intraday-tactical.ts</Code>, with the analyst brief, the house rules and the stock&apos;s row from <Code>row-for-model.ts</Code>.</> },
          { label: "Fire rules", value: <><Code>shouldFire</Code> in <Code>lib/agent/triggers/evaluate.ts</Code>: a buy fires on its crossing, a protective rule every day it holds.</> },
          { label: "Direct sales", value: <><Code>fireMode: DIRECT</Code> on a sale skips the run and goes to <Code>closeOpenPosition</Code>, which still waits for approval.</> },
        ]}
      />
    </DocBody>
  );
}
