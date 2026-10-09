"use client";

import { ChatMock, Tk } from "../chat-mock";
import { AgentRef, DocSection, P, Prompts, ToolRef, Ul } from "../doc-text";
import { Code, DocBody, DocHeader, Stage, TechDetails } from "../primitives";
import { AgentTools } from "../tool-catalog";

export function DiscoveryDoc() {
  return (
    <DocBody>
      <DocHeader lead="Find it before it's obvious." rest="Discovery finds new stocks for an analyst to watch.">
        It looks where new names show up, like fresh earnings, today&apos;s movers and setup screens, checks each one against the analyst&apos;s rules, and sends the
        best to the Writer to research.
      </DocHeader>

      <Stage label="Example">
        <ChatMock
          className="mx-auto max-w-2xl"
          title="PEAD Specialist · discovery"
          composer={false}
          steps={[
            { kind: "user", text: "Find drift names off this week's reports." },
            {
              kind: "tools",
              label: "Pulling reported earnings outside your coverage (+1 more)",
              rows: [
                { text: "41 companies reported in the last 3 days · 9 beat by 5% or more" },
                { text: "Screening for Post-earnings drift: 6 held their gap, 3 fit the analyst's universe" },
              ],
            },
            {
              kind: "text",
              text: (
                <>
                  Three clear the rules. <Tk s="CRWD" c={6.8} /> and <Tk s="ADBE" c={4.1} /> beat, raised the year and held the gap on heavy volume. <Tk s="NKE" c={-2.2} /> beat
                  but guided down, which is no drift. Sending the two to the Writer.
                </>
              ),
            },
            {
              kind: "tools",
              label: "Dispatching $CRWD thesis-writer (+1 more)",
              rows: [
                { ticker: "CRWD", action: "watch", text: "Writing the thesis · buy trigger, floor and target required" },
                { ticker: "ADBE", action: "watch", text: "Writing the thesis · buy trigger, floor and target required" },
                { ticker: "NKE", text: "Passed: guidance went down. Recorded, so it isn't pitched again." },
              ],
            },
          ]}
        />
      </Stage>

      <DocSection title="What it does">
        <P>
          Discovery only looks at stocks the analyst doesn&apos;t already cover; its tools hide everything on the book. You can ask it to find names off this
          week&apos;s earnings, run one of the analyst&apos;s setup screens, look for dated catalysts, or check tickers you paste in.
        </P>
        <P>
          It doesn&apos;t manage the book (that&apos;s <AgentRef slug="morning-runs" />) and it never buys. New stocks land on the watchlist, and a buy happens only
          when a stock&apos;s buy trigger fires and you approve it.
        </P>
      </DocSection>

      <DocSection title="Starting it">
        <P>
          Discovery runs when you ask. Ask in <AgentRef slug="chat" /> with an analyst selected, or start a discovery run for one analyst. Try:
        </P>
        <Prompts items={["Find drift names off this week's reports.", "Run the pullback screen and research what's left.", "Any FDA decisions in the next 60 days that fit?"]} />
      </DocSection>

      <DocSection title="Where it looks">
        <Ul>
          <li>
            <strong>Setup screens:</strong> <ToolRef name="run_screen" /> gives a candidate list for one setup, numbers worked out, with every reject and its reason.
          </li>
          <li>
            <strong>Earnings:</strong> <ToolRef name="get_earnings_calendar" /> shows who just reported, biggest beats first, or who reports soon.
          </li>
          <li>
            <strong>Movers:</strong> <ToolRef name="get_market_movers" /> lists today&apos;s gainers, losers and most active outside the analyst&apos;s coverage.
          </li>
          <li>
            <strong>Catalysts and the web:</strong> <ToolRef name="get_catalyst_calendar" /> for dated FDA decisions; <ToolRef name="web_search" /> and{" "}
            <ToolRef name="twitter_search" /> to check a story.
          </li>
        </Ul>
      </DocSection>

      <DocSection title="How it decides">
        <P>
          It reads the whole pool first and drops what plainly doesn&apos;t fit. For the rest, <ToolRef name="get_theses" /> checks that no other analyst already
          covers the stock, and <ToolRef name="get_stock_data" /> gives the price, chart and news. Each stock is scored on trend, strength against the market, entry
          and how fresh its catalyst is; 4 out of 10 or better earns a deeper look.
        </P>
        <P>
          It works for one analyst and reads its strategy, rules, universe and record by setup first. A stock the analyst used to own, with a fresh catalyst, counts
          as a lead.
        </P>
      </DocSection>

      <DocSection title="What happens to each stock">
        <Ul>
          <li>
            <strong>Sent to the Writer:</strong> <ToolRef name="dispatch_thesis_research" /> starts <AgentRef slug="writer" />, which writes the thesis with its
            buy trigger, floor and target. Up to five per run.
          </li>
          <li>
            <strong>Kept on watch:</strong> strong but not ready, saved with <ToolRef name="record_thesis" /> and an optional wake-up, like a price or a date.
          </li>
          <li>
            <strong>Passed:</strong> recorded with what would change the verdict, so the next look starts from it.
          </li>
          <li>
            <strong>Skipped:</strong> dropped before research, a line in the summary.
          </li>
        </Ul>
        <P>
          The run ends with <ToolRef name="record_run_summary" />. Writers it started keep going and land as their own runs; in chat,{" "}
          <ToolRef name="wait_for_thesis_refresh" /> waits for them.
        </P>
      </DocSection>

      <DocSection title="Tools">
        <P>Everything discovery can call, read from the code.</P>
        <AgentTools agent="discovery" />
      </DocSection>

      <TechDetails
        rows={[
          { label: "Prompt", value: <><Code>lib/agent/system-prompts/discovery.ts</Code> (<Code>buildDiscoverySystemPrompt</Code>)</> },
          { label: "Mode", value: <><Code>discovery</Code> in <Code>lib/agent/modes.ts</Code>: <Code>gpt-5.4</Code>, up to 45 steps. The chat (<Code>principal</Code>) carries the same discovery tools.</> },
          { label: "Started by", value: <>Chat, or the <Code>app/discovery.run.manual</Code> event, which can carry an analyst and a focus. <Code>lib/inngest/functions/discovery-run.ts</Code> also lists a Sunday 9 AM cron; in practice discovery is run by hand.</> },
          { label: "Writer cap", value: <><Code>DISPATCH_CAP</Code> = 5 per run, enforced in <Code>dispatch_thesis_research</Code>.</> },
          { label: "Outcomes", value: <><Code>record_thesis</Code> with <Code>direction: PASS</Code> is a pass; with <Code>status: WATCHING</Code> as well, a watch without a plan. A new plan is always the Writer&apos;s.</> },
          { label: "Screens", value: <><Code>lib/discovery/screens.ts</Code>; setups in <Code>lib/agent/knowledge/setups.ts</Code>.</> },
          { label: "Playbook", value: <><Code>docs/DISCOVERY_PLAYBOOK.md</Code> · <Code>docs/prompts/DISCOVERY_SESSION.md</Code></> },
        ]}
      />
    </DocBody>
  );
}
