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
          Discovery only looks at stocks the analyst doesn&apos;t already cover. The tools it reads from hide every stock the analyst holds or watches, so a run spends
          its time on names that are new. You can ask it to:
        </P>
        <Ul>
          <li>Find names off this week&apos;s earnings reports</li>
          <li>Run one of the analyst&apos;s setup screens and research what clears it</li>
          <li>Look for dated catalysts, like FDA decisions, in a window</li>
          <li>Check a list of tickers you paste in</li>
        </Ul>
        <P>
          It doesn&apos;t manage stocks already on the book. That&apos;s <AgentRef slug="morning-runs" />. And it never buys: every stock it adds lands on the watchlist, and
          a buy only happens later, when that stock&apos;s buy trigger fires and you approve the proposal.
        </P>
      </DocSection>

      <DocSection title="Starting it">
        <P>
          Discovery runs when you ask for it. Open <AgentRef slug="chat" /> with an analyst selected and ask for new names, or start a discovery run for one analyst.
          A run can carry a focus, like &ldquo;this week&apos;s earnings&rdquo;, which decides where it looks first. The chat has the same discovery tools, so a
          conversation can do the whole job and show you the plans as they land.
        </P>
        <P>Try asking:</P>
        <Prompts
          items={[
            "Find drift names off this week's reports.",
            "Run the pullback screen and research what's left.",
            "Any FDA decisions in the next 60 days that fit this analyst?",
            "Look at SMMT, IOT and SRRK. Worth a watch?",
          ]}
        />
      </DocSection>

      <DocSection title="Where it looks">
        <P>
          <strong>Setup screens.</strong> <ToolRef name="run_screen" /> returns a candidate list for one of the analyst&apos;s setups with the numbers already worked
          out: the size of the beat and the reaction for post-earnings drift, the gap for an episodic pivot, the distance to a rising average for a pullback. Every
          stock that failed the screen comes back with its reason.
        </P>
        <P>
          <strong>Earnings.</strong> <ToolRef name="get_earnings_calendar" /> shows who just reported, against the estimate, biggest beats first, or who reports soon.
          When you ask for discovery off a report window, this is where it starts.
        </P>
        <P>
          <strong>Movers.</strong> <ToolRef name="get_market_movers" /> lists today&apos;s gainers, losers and most active stocks outside the analyst&apos;s coverage:
          how a stock nobody covers shows up on price and volume.
        </P>
        <P>
          <strong>Catalysts and the web.</strong> <ToolRef name="get_catalyst_calendar" /> reads dated FDA decisions from the companies&apos; own filings.{" "}
          <ToolRef name="web_search" /> and <ToolRef name="twitter_search" /> check a story before it becomes a thesis.
        </P>
      </DocSection>

      <DocSection title="How it decides">
        <P>
          Discovery reads the whole pool before researching anything, and says in a sentence or two what caught its eye on each name and what it would need to
          check. Names that plainly don&apos;t fit (outside the universe, a penny stock off the movers list) are dropped right there.
        </P>
        <P>
          For the rest, the research is deliberately cheap. <ToolRef name="get_theses" /> checks whether another analyst on the account already covers the stock in the
          same direction; if one does, it moves on. <ToolRef name="get_stock_data" /> gives the live price, the chart and the week&apos;s news. Each stock is then scored
          on four things: the trend, its strength against the market, the quality of the entry, and how fresh its catalyst is. A score of 4 out of 10 or better is
          worth a deeper look.
        </P>
        <P>
          Off an earnings report, the order of weight is: both lines beat and guidance went up, first. An earnings beat with a revenue miss is discounted, because the
          beat came from cost. A beat where the stock fell means the market wanted more, so it reads the call before trusting the number.
        </P>
      </DocSection>

      <DocSection title="What happens to each stock">
        <P>Every stock it researched ends one of four ways, and the run&apos;s summary lists each one with where it went.</P>
        <Ul>
          <li>
            <strong>Sent to the Writer.</strong> <ToolRef name="dispatch_thesis_research" /> starts <AgentRef slug="writer" /> on the stock, up to five per run.
            The Writer does the deep research and writes the thesis with its buy trigger, floor and target.
          </li>
          <li>
            <strong>Kept on watch.</strong> Strong, but out of slots this run or not ready yet. <ToolRef name="record_thesis" /> puts it on the watchlist without a
            plan, with a wake-up condition if one makes sense, like a price level or a date before its report.
          </li>
          <li>
            <strong>Passed.</strong> Researched and declined. The pass is recorded with what would change the verdict, so the next discovery that meets the stock reads
            &ldquo;we already looked, and here&apos;s why not.&rdquo;
          </li>
          <li>
            <strong>Skipped.</strong> Dropped before research. No record, just a line in the summary.
          </li>
        </Ul>
        <P>
          A run ends with <ToolRef name="record_run_summary" /> and <ToolRef name="complete_run" />. The Writers it started keep working after it finishes; each one
          lands as its own run. In chat, <ToolRef name="wait_for_thesis_refresh" /> waits for them so you see the finished plans in the conversation.
        </P>
      </DocSection>

      <DocSection title="What it knows about the analyst">
        <P>
          Discovery works for one analyst at a time, and reads it before it starts: the strategy you wrote, word for word, its rules on direction and size, and its
          universe of sectors, industries, themes, market cap and exclusions. The universe is for judgment; the tools have already hidden what&apos;s covered.
        </P>
        <P>
          It also reads the analyst&apos;s book, including stocks it used to own. A past holding with a fresh catalyst is a lead, not a used-up name. And it reads the
          analyst&apos;s record by setup, so the patterns that have paid are the ones it looks for first.
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
