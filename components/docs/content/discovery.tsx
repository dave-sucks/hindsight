"use client";

import { CalendarDays, FlaskConical, Globe, ScanSearch, TrendingUp } from "lucide-react";
import { ChatMock, Tk } from "../chat-mock";
import { Code, DocBody, DocHeader, Section, Stage, Steps, TechDetails, Trio } from "../primitives";
import { AgentTools } from "../tool-catalog";

const SOURCES = [
  { icon: CalendarDays, t: "Earnings calendar", b: "Who reported in the last few days and by how much they beat, or who reports soon." },
  { icon: TrendingUp, t: "Market movers", b: "Today's gainers, losers and most active, with the 5-day, 1-month and 6-month move beside each." },
  { icon: ScanSearch, t: "Setup screens", b: "Computed candidate lists for post-earnings drift, episodic pivots, pullbacks, base breakouts and momentum leaders." },
  { icon: FlaskConical, t: "FDA catalysts", b: "Dated FDA decisions, taken from the companies' own 8-K filings." },
  { icon: Globe, t: "The web and X", b: "To check a story, find the call, and kill a false lead before it becomes a thesis." },
] as const;

export function DiscoveryDoc() {
  return (
    <DocBody>
      <DocHeader
        eyebrow="Agent · Discovery"
        lead="Find it before it's obvious."
        rest="Discovery screens earnings, today's movers, setups and the web for stocks that fit an analyst, checks each against its rules, and sends the best to the Writer."
      />

      <Stage label="Example">
        <ChatMock
          className="mx-auto max-w-2xl"
          title="PEAD Specialist · discovery"
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

      <Trio
        items={[
          { title: "Screens, not hunches", body: "The setup screens compute the numbers: the size of the beat, whether the gap held, the volume, the trend." },
          { title: "Your analyst's rules decide", body: "Its universe, its market-cap band, its exclusions and the setup's checklist decide what clears. Only names that clear go forward." },
          { title: "Every new stock has a plan", body: "Each one goes to the Writer and comes back with a buy trigger, a floor and a target." },
        ]}
      />

      <Section eyebrow="Where it looks" lead="Five places stocks come from.">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {SOURCES.map((s) => (
            <div key={s.t} className="flex flex-col gap-2 rounded-xl border bg-card p-4">
              <span className="grid size-8 place-items-center rounded-lg border bg-muted text-muted-foreground">
                <s.icon className="size-4" />
              </span>
              <p className="text-sm font-medium text-foreground">{s.t}</p>
              <p className="text-sm text-muted-foreground">{s.b}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section eyebrow="How it works" lead="Screen, check, write, wait." rest="A session isn't done until every stock it sent has a thesis or a stated reason it didn't.">
        <Steps
          items={[
            { title: "Screen", body: "Pull the candidates: the calendar, the movers, a setup screen, or names you paste in." },
            { title: "Check", body: "Each candidate against the analyst's rules and the setup's checklist. Watch wide before a report, buy narrow after it." },
            { title: "Write", body: "The best go to the Writer, which researches each and writes its thesis and plan." },
            { title: "Wait", body: "It waits for every Writer it started and ends with one table: stock, buy trigger, floor, target." },
          ]}
        />
      </Section>

      <Section eyebrow="The buy trigger" lead="A watch is only useful if it can be bought." rest="The buy isn't today's price. It's the level where the analyst's setup becomes true: a pullback to a rising average, a break above the last high, a close back above the 50-day. It fires only if the stock turns." />

      <Section eyebrow="When it runs" lead="When you ask." rest="Discovery has no schedule on purpose: you decide when the book needs new names. Ask in chat with an analyst selected, or start a discovery run." />

      <Section eyebrow="Tools" lead="What discovery can use." rest="Read from the code.">
        <AgentTools agent="discovery" />
      </Section>

      <TechDetails
        rows={[
          { label: "Mode", value: <><Code>discovery</Code> · <Code>gpt-5.4</Code> · up to 45 steps. In chat, the same tools are on the principal&apos;s list.</> },
          { label: "Started by", value: <>Chat, or the <Code>app/discovery.run.manual</Code> event (<Code>lib/inngest/functions/discovery-run.ts</Code>).</> },
          { label: "Screens", value: <><Code>run_screen</Code> over <Code>lib/discovery/screens.ts</Code>; setups in <Code>lib/agent/knowledge/setups.ts</Code>.</> },
          { label: "New stocks", value: <><Code>record_thesis</Code> for a researched pass; <Code>dispatch_thesis_research</Code> for a new thesis, then <Code>wait_for_thesis_refresh</Code>.</> },
          { label: "Playbook", value: <><Code>docs/DISCOVERY_PLAYBOOK.md</Code> · <Code>docs/prompts/DISCOVERY_SESSION.md</Code></> },
        ]}
      />
    </DocBody>
  );
}
