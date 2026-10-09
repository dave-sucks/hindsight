"use client";

import { ArrowUp, Clock } from "lucide-react";
import { SITUATIONS } from "@/lib/agent/situations";
import { ChatMock, Tk } from "../chat-mock";
import { Code, DocBody, DocHeader, Section, Stage, Steps, TechDetails, Trio } from "../primitives";
import { AgentTools } from "../tool-catalog";

function capital(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function MorningRunsDoc() {
  return (
    <DocBody>
      <DocHeader
        eyebrow="Agent · Morning runs"
        lead="Your analysts, at 8 AM."
        rest="Every weekday morning, each analyst reads its whole book, answers every stock that needs it, and leaves the quiet ones alone."
      />

      <Stage label="Example run">
        <div className="mx-auto flex max-w-xl flex-col items-stretch">
          <div className="rounded-2xl border border-chart-2/40 bg-background p-3.5 shadow-sm ring-4 ring-chart-2/10">
            <p className="text-message text-foreground">Every weekday at 8 AM ET, review my book.</p>
            <div className="mt-3 flex items-center gap-1.5">
              <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
                <Clock className="size-3" />
                Schedule
              </span>
              <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">PEAD Specialist</span>
              <span className="ml-auto grid size-7 place-items-center rounded-full bg-chart-2 text-background">
                <ArrowUp className="size-3.5" />
              </span>
            </div>
          </div>
          <div className="mx-auto h-7 w-px bg-border" />
          <ChatMock
            title="Morning run · PEAD Specialist · Wed 8:00 AM"
            composer={false}
            steps={[
              {
                kind: "tools",
                label: "Reading thesis library (+2 more)",
                rows: [
                  { text: "11 stocks · 4 need an answer · 7 are quiet" },
                  { text: "SPY above its 50-day · the regime is risk-on" },
                ],
              },
              {
                kind: "text",
                text: (
                  <>
                    <Tk s="SHOP" c={-3.4} /> closed through its $96 floor on no company news. The drift has failed, so I&apos;m proposing the sale.
                  </>
                ),
              },
              {
                kind: "tools",
                label: "Closing $SHOP position (+2 more)",
                rows: [
                  { ticker: "SHOP", action: "sell", tag: "Proposal", text: "Sell 120 shares at about $95.12" },
                  { ticker: "AVGO", text: "Earnings review · held, floor raised to $1,610 to lock in the gain" },
                  { ticker: "ADBE", text: "Plan check · buy moved to $402, under the 20-day" },
                ],
              },
              {
                kind: "tools",
                label: "Recording the run summary",
                rows: [{ text: "1 proposal waiting for you · 2 plans changed · 7 stocks left alone" }],
              },
            ]}
          />
        </div>
      </Stage>

      <Trio
        items={[
          { title: "Reads the whole book", body: "Every stock it holds or watches, the account and the market, in one read at the start." },
          { title: "Answers what needs it", body: "A stock with a situation gets a decision. A quiet stock is left alone." },
          { title: "Proposes, never trades", body: "Buys, sales, adds and trims go to your queue with the reason. Edits land in Activity as they happen." },
        ]}
      />

      <Section eyebrow="How it works" lead="Wake, read, decide, report." rest="The same four beats every run.">
        <Steps
          items={[
            { title: "Wakes", body: "8 AM ET on each analyst's run days: every weekday by default. Market holidays are skipped. The Run button starts one any day." },
            { title: "Reads", body: "Its book, the account and the market. Each stock that needs an answer comes with the guidance for its situation." },
            { title: "Decides", body: "Sell, add, trim, hold, redraw the plan, or a review that says what it checked. It can send a stock to the Writer for fresh research." },
            { title: "Reports", body: "Trades go to your queue as proposals. One summary closes the run, and it has to match what the run actually did." },
          ]}
        />
      </Section>

      <Section eyebrow="Situations" lead="What puts a stock on the list." rest="Sixteen situations, worked out fresh each morning. A stock can be in several at once.">
        <div className="flex flex-wrap gap-1.5">
          {Object.values(SITUATIONS).map((s) => (
            <span key={s.name} className="rounded-full border bg-card px-2.5 py-1 text-sm text-muted-foreground">
              {capital(s.name)}
            </span>
          ))}
        </div>
      </Section>

      <Section eyebrow="Tools" lead="What the morning run can use." rest="Read from the code. Open one to see where it reads from.">
        <AgentTools agent="morning" />
      </Section>

      <TechDetails
        rows={[
          { label: "Schedule", value: <>Inngest <Code>morning-research.ts</Code>, cron <Code>0 8 * * 1-5</Code> ET, then each analyst&apos;s <Code>runDaysOfWeek</Code>; skipped when <Code>isTradingDay()</Code> is false. A manual run bypasses both.</> },
          { label: "Mode", value: <><Code>research-run</Code> · <Code>gpt-5.4</Code> · up to 65 steps · 800 s function limit</> },
          { label: "Prompt", value: <><Code>lib/agent/system-prompt.ts</Code>, built per analyst. Situation texts come from <Code>SITUATIONS</Code> in <Code>lib/agent/situations.ts</Code>, never from the prompt.</> },
          { label: "The read", value: <><Code>get_theses</Code> → <Code>loadWorkInputs</Code> → <Code>computeNeedsAction</Code> → <Code>situationsFor</Code>. Quiet stocks come back as short rows.</> },
          { label: "Close-out", value: <><Code>record_run_summary</Code>, then <Code>complete_run</Code>. A ranked sale on a held stock needs a sale or a sale proposal this run, checked against orders, not prose.</> },
          { label: "Cost", value: <>Measured Oct 7: about 880k–930k input tokens a run, 91% from the cache, about $0.47.</> },
        ]}
      />
    </DocBody>
  );
}
