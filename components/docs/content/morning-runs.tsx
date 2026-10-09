"use client";

import { Tk } from "../chat-mock";
import { ChatExample, DocRef, DocSection, P, ToolRef, Ul } from "../doc-text";
import { ReadDemo } from "../framework/read-demo";
import { Code, DocBody, DocHeader, TechDetails } from "../primitives";
import { AgentTools } from "../tool-catalog";

export function MorningRunsDoc() {
  return (
    <DocBody>
      <DocHeader lead="Your analysts, at 8 AM." rest="Every weekday morning, each analyst reads its whole book and answers the stocks that need it.">
        It decides on what changed, leaves the quiet stocks alone, and sends every trade to you as a proposal.
      </DocHeader>

      <ChatExample
        caption="A morning run for the PEAD Specialist."
        steps={[
          {
            kind: "tools",
            label: "Reading your book (+1 more)",
            rows: [
              { text: "11 stocks · 4 need an answer · 7 are quiet" },
              { text: "SPY above its 50-day · the market is risk-on" },
            ],
          },
          { kind: "text", text: <><Tk s="SHOP" c={-3.4} /> closed through its $96 floor on no company news. The drift has failed, so I&apos;m proposing the sale.</> },
          {
            kind: "tools",
            label: "Closing $SHOP position (+2 more)",
            rows: [
              { ticker: "SHOP", action: "sell", tag: "Proposal", text: "Sell 120 shares at about $95.12" },
              { ticker: "AVGO", text: "Earnings review · held, floor raised to $1,610 to keep most of the gain" },
              { ticker: "ADBE", text: "Plan check · buy moved to $402, under the 20-day" },
            ],
          },
          { kind: "tools", label: "Recording the run summary", rows: [{ text: "1 proposal waiting for you · 2 plans changed · 7 stocks left alone" }] },
        ]}
      />

      <DocSection title="What it does">
        <P>
          Each analyst runs on its own, for its own book. It reads every stock it holds or watches, takes one action on each stock that needs an answer, and
          leaves the rest alone. It never trades: buys, sales, adds and trims go to your queue as <DocRef slug="approvals">proposals</DocRef>, and every change
          to a thesis lands in Activity the moment it&apos;s made.
        </P>
      </DocSection>

      <DocSection title="When it runs">
        <P>
          At 8 AM Eastern on the analyst&apos;s run days, every weekday by default. Market holidays are skipped. The Run button on an analyst&apos;s page starts
          one on any day, and you can watch it stream in.
        </P>
      </DocSection>

      <DocSection title="What it reads">
        <P>
          The run opens with two reads. <ToolRef name="get_portfolio_context" /> gives live positions, cash, the account&apos;s open risk and the market&apos;s
          mood. <ToolRef name="get_theses" /> gives the book, with each stock at the size today needs:
        </P>
        <Ul>
          <li>
            <strong>A quiet stock</strong> is one line: the price, the plan, the next review.
          </li>
          <li>
            <strong>A stock in a <DocRef slug="situations">situation</DocRef></strong> gets a short row (position, plan, triggers, belief) and the instructions
            for that situation, once.
          </li>
          <li>
            <strong>A stock whose research needs re-planning</strong> gets the full row, research and all.
          </li>
        </Ul>
        <ReadDemo />
        <P>
          It also reads its analyst&apos;s brief: the strategy you wrote, word for word, its rules on direction and size, and how many slots are free.
        </P>
      </DocSection>

      <DocSection title="How it decides">
        <P>
          It works the list one stock at a time, saying which one it&apos;s picking up and why, and takes exactly one action on each. A single{" "}
          <ToolRef name="update_thesis" /> answers all of a stock&apos;s situations at once. Before a buy, a sale, an add or a trim it calls{" "}
          <ToolRef name="get_stock_data" /> for the news and a fresh quote.
        </P>
        <Ul>
          <li>
            <strong>Sell or trim:</strong> <ToolRef name="close_position" /> or <ToolRef name="manage_position" />, as a proposal with its reason.
          </li>
          <li>
            <strong>Buy or add:</strong> <ToolRef name="place_trade" /> or <ToolRef name="manage_position" />. The size is worked out by risk inside the
            analyst&apos;s band; the run never picks it.
          </li>
          <li>
            <strong>Redraw the plan or raise a floor:</strong> <ToolRef name="update_thesis" />, one trigger at a time.
          </li>
          <li>
            <strong>Get fresh research:</strong> <ToolRef name="dispatch_thesis_research" /> sends the stock to <DocRef slug="writer" />.
          </li>
          <li>
            <strong>Nothing to change:</strong> one sentence on what it checked and what would change its mind.
          </li>
        </Ul>
      </DocSection>

      <DocSection title="The market and cash">
        <P>The market&apos;s mood sets how hard it leans in:</P>
        <Ul>
          <li>
            <strong>Risk-on:</strong> full size.
          </li>
          <li>
            <strong>Cautious</strong> (the S&amp;P more than 1% under its 50-day): buys are half size, and breakouts wait.
          </li>
          <li>
            <strong>Risk-off</strong> (more than 1% under its 200-day): only event-driven and mean-reversion buys.
          </li>
        </Ul>
        <P>
          Idle cash is a decision too. With more than a quarter of the account in cash, a watched stock at its buy level and a risk-on market, the run either acts
          or says in its summary why it didn&apos;t.
        </P>
      </DocSection>

      <DocSection title="How it ends">
        <P>
          <ToolRef name="record_run_summary" /> lists what the run did, each stock it touched with a one-word action. <ToolRef name="complete_run" /> then
          checks the summary against the orders: a sale it names on a stock it holds needs a sale or a sale proposal from this run, or the run can&apos;t finish
          until it fixes one or the other.
        </P>
      </DocSection>

      <DocSection title="Tools">
        <P>Everything the morning run can call, read from the code.</P>
        <AgentTools agent="morning" />
      </DocSection>

      <TechDetails
        rows={[
          { label: "Schedule", value: <><Code>lib/inngest/functions/morning-research.ts</Code>, cron <Code>0 8 * * 1-5</Code> Eastern, then each analyst&apos;s <Code>runDaysOfWeek</Code>; skipped when <Code>isTradingDay()</Code> is false. A manual run skips both.</> },
          { label: "Mode", value: <><Code>research-run</Code> in <Code>lib/agent/modes.ts</Code>: <Code>gpt-5.4</Code>, up to 65 steps, an 800-second limit.</> },
          { label: "Prompt", value: <><Code>lib/agent/system-prompt.ts</Code>, with the analyst brief and the house rules. Situation texts come from <Code>SITUATIONS</Code> in <Code>lib/agent/situations.ts</Code>, never the prompt.</> },
          { label: "The read", value: <><Code>get_theses</Code> builds each row with <Code>lib/agent/row-for-model.ts</Code> at one of three sizes.</> },
          { label: "Close-out", value: <><Code>complete_run</Code> credits a sale from the <Code>Order</Code> table, not the run&apos;s words (<Code>lib/agent/summary-action-check.ts</Code>).</> },
        ]}
      />
    </DocBody>
  );
}
