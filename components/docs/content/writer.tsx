"use client";

import { ChatExample, DocRef, DocSection, P, ToolRef, Ul } from "../doc-text";
import { Code, DocBody, DocHeader, TechDetails } from "../primitives";
import { AgentTools } from "../tool-catalog";

export function WriterDoc() {
  return (
    <DocBody>
      <DocHeader lead="Deep research on one stock, in about four minutes." rest="The Writer pulls the numbers, reads the filings and the web, and writes the thesis.">
        It writes the case for and against, the one belief everything else rests on, and a plan made of triggers.
      </DocHeader>

      <ChatExample
        caption="The Writer researching CRWD for the PEAD Specialist."
        steps={[
          {
            kind: "tools",
            label: "Pulling $CRWD's 5-year financials (+6 more)",
            rows: [
              { text: "Financial statements, earnings track record, insider activity" },
              { text: "Peers, analyst coverage, recent filings, the live price" },
            ],
          },
          {
            kind: "tools",
            label: 'Searching the web for "CrowdStrike Q2 call guidance" (+3 more)',
            rows: [{ text: "The call, the guide raise, estimate revisions since the print" }],
          },
          {
            kind: "tools",
            label: "Writing the thesis on $CRWD",
            rows: [
              { ticker: "CRWD", action: "watch", text: "Post-earnings drift · buy $401 · floor $384 · target $480" },
              { text: "The reward is 2.4 times the risk" },
            ],
          },
        ]}
      />

      <DocSection title="What it does">
        <P>
          The Writer is the only agent that writes a whole thesis. It researches one stock in depth for one analyst, in that analyst&apos;s strategy, and saves
          the result as a new watch or a rewrite of an existing thesis. It runs on Claude Sonnet with Claude&apos;s own web search, because in a side-by-side
          test it wrote the most grounded notes and got fiscal years right where other models quoted a year-old quarter as current.
        </P>
      </DocSection>

      <DocSection title="Who sends it a stock">
        <P>
          Any agent can, with <ToolRef name="dispatch_thesis_research" />. Each request runs as its own run, five at a time, and the agent that asked can wait
          for the result with <ToolRef name="wait_for_thesis_refresh" />.
        </P>
        <Ul>
          <li>
            <strong><DocRef slug="discovery" /></strong> sends every new stock it wants to watch.
          </li>
          <li>
            <strong><DocRef slug="chat" /></strong> sends one when you ask to research a stock, or type <Code>/research</Code>.
          </li>
          <li>
            <strong><DocRef slug="morning-runs">A morning run</DocRef></strong> sends a stock whose research has gone stale, or needs re-planning.
          </li>
        </Ul>
      </DocSection>

      <DocSection title="How it researches">
        <P>
          Before the model starts, seven data sets are pulled in code, all at once: five years of statements, the earnings record, insider trades, peers,
          analyst coverage, recent filings and the price and chart. A source that fails is named as missing, never guessed. That data is the ground truth for
          every number in the note.
        </P>
        <P>
          Then one research call with up to four web searches fills in what data can&apos;t: the call, the guidance, what changed this week. Every paragraph
          carries its source, and a catalyst dated after today is written as expected, never as reported.
        </P>
      </DocSection>

      <DocSection title="What it writes">
        <P>A research note in nine sections, always the same ones:</P>
        <Ul>
          <li>Snapshot, recent catalysts, fundamentals and the latest earnings.</li>
          <li>Dated catalysts and events in the next one to three months.</li>
          <li>The bull case and the bear case, the bear case even on a buy.</li>
          <li>Analyst consensus, insiders and the chart.</li>
        </Ul>
        <P>Then the decision:</P>
        <Ul>
          <li>
            <strong>A direction:</strong> long, short, or pass. A pass is a real answer, saved so the stock isn&apos;t pitched again.
          </li>
          <li>
            <strong>A belief:</strong> one sentence that can be proven wrong, with an outcome, a timeframe and the reason.
          </li>
          <li>
            <strong>A setup and its plan:</strong> the buy, the floor and the target all come from the setup&apos;s rules and the chart, never a round number.
            The reward has to be at least twice the risk.
          </li>
          <li>
            <strong>The <DocRef slug="triggers">triggers</DocRef></strong> that carry the plan, and a wake-up if the stock isn&apos;t ready to price yet.
          </li>
        </Ul>
        <P>
          It never sizes the trade. The buy is sized later by the risk to its floor, so an honest, tight floor is what earns size.
        </P>
      </DocSection>

      <DocSection title="Checked before it's saved">
        <P>
          The decision goes through the same checks as every other save: the prices in the right order, the 2-to-1 reward, triggers that fit a stock we only
          watch. A problem goes back to the Writer to fix in the same run; the thesis is saved only when it passes.
        </P>
      </DocSection>

      <DocSection title="Tools">
        <P>The data tools run in code before it writes; web search and the save are its own.</P>
        <AgentTools agent="writer" />
      </DocSection>

      <TechDetails
        rows={[
          { label: "Runs as", value: <>Its own run, started by <Code>dispatch_thesis_research</Code> through <Code>app/thesis.write.requested</Code> (<Code>lib/inngest/functions/thesis-writer.ts</Code>).</> },
          { label: "Model", value: <><Code>claude-sonnet-4-6</Code> with Anthropic&apos;s web search, up to 4 searches and 8 steps.</> },
          { label: "Pipeline", value: <><Code>lib/agent/run-thesis-writer.ts</Code>; data in <Code>thesis-research/pull-data.ts</Code>; the decision&apos;s checks in <Code>thesis-research/decision.ts</Code>.</> },
          { label: "Saved through", value: <><Code>submit_thesis</Code>, then <Code>record_thesis</Code> or <Code>update_thesis</Code>, with the same checks as every other save.</> },
        ]}
      />
    </DocBody>
  );
}
