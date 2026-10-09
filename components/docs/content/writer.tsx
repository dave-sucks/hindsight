"use client";

import { FileText } from "lucide-react";
import { ChatMock } from "../chat-mock";
import { Code, DocBody, DocHeader, Section, Stage, Steps, TechDetails, Trio } from "../primitives";
import { AgentTools } from "../tool-catalog";

const SECTIONS = ["Snapshot", "Recent catalysts", "Fundamentals", "Latest earnings", "Catalysts and events", "Bull case", "Bear case", "Analyst consensus", "Insiders and technicals"];

const DECISION: readonly [string, string][] = [
  ["Direction", "Long"],
  ["Setup", "Post-earnings drift"],
  ["Buy", "near $412"],
  ["Floor", "$384"],
  ["Target", "$480"],
  ["Conviction", "High"],
];

export function WriterDoc() {
  return (
    <DocBody>
      <DocHeader
        eyebrow="Agent · The Writer"
        lead="Deep research on one stock, in about four minutes."
        rest="The Writer pulls the numbers, reads the filings and the web, and writes the thesis: the case for and against, the belief, and a plan made of triggers."
      />

      <Stage label="Example">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
          <ChatMock
            title="The Writer · CRWD"
            composer={false}
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
                rows: [
                  { text: "The call transcript, the guide raise, estimate revisions since the print" },
                  { text: "A competitor's report the same week, for context" },
                ],
              },
              { kind: "text", text: "Note written in nine sections. Submitting the decision for checks." },
            ]}
          />
          <div className="flex min-w-0 flex-col overflow-hidden rounded-2xl border bg-background shadow-sm">
            <div className="flex items-center gap-2 border-b px-4 py-2.5 text-sm">
              <FileText className="size-4 text-muted-foreground" />
              <span className="font-medium text-foreground">CRWD thesis</span>
              <span className="ml-auto text-xs text-muted-foreground">written today</span>
            </div>
            <div className="flex flex-col gap-4 p-4">
              <div className="flex flex-col gap-1.5">
                <span className="text-xs uppercase tracking-wide text-muted-foreground">The note</span>
                <ul className="grid grid-cols-2 gap-x-3 gap-y-1">
                  {SECTIONS.map((s) => (
                    <li key={s} className="flex items-center gap-1.5 text-sm text-foreground">
                      <span className="size-1 rounded-full bg-muted-foreground" />
                      {s}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="text-xs uppercase tracking-wide text-muted-foreground">The decision</span>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 rounded-xl border bg-muted/40 p-3">
                  {DECISION.map(([k, v]) => (
                    <div key={k} className="flex flex-col">
                      <dt className="text-xs text-muted-foreground">{k}</dt>
                      <dd className="text-sm font-medium text-foreground tabular-nums">{v}</dd>
                    </div>
                  ))}
                </dl>
              </div>
              <p className="text-xs text-positive">Checked: the reward to the target is 2.4 times the risk to the floor.</p>
            </div>
          </div>
        </div>
      </Stage>

      <Trio
        items={[
          { title: "Pulls before it writes", body: "Seven data sets in parallel: statements, earnings, insiders, peers, coverage, filings and the price." },
          { title: "Writes with its sources", body: "A nine-part note, every claim tagged with where it came from, then a short decision." },
          { title: "Checked before it's saved", body: "The reward must be at least twice the risk, the prices in the right order, the triggers right for the position." },
        ]}
      />

      <Section eyebrow="How it works" lead="Pull, research, write, check.">
        <Steps
          items={[
            { title: "Pull", body: "The data tools run in code, all at once, before the model starts. A source that fails is named, not guessed." },
            { title: "Research", body: "One research call with Claude's own web search: the call, the guidance, what changed since the print." },
            { title: "Write", body: "The note in nine sections, then the decision: direction, setup, buy, floor, target, conviction and triggers." },
            { title: "Check", body: "The decision is checked; a problem goes back to the Writer to fix in the same run, then the thesis is saved." },
          ]}
        />
      </Section>

      <Section eyebrow="Who calls it" lead="Any agent can send it a stock.">
        <Trio
          items={[
            { title: "Discovery and chat", body: "Every new stock is written by the Writer, so it arrives with a full case and a plan." },
            { title: "Morning runs", body: "A stock whose research is older than the analyst's limit is sent back for a rewrite." },
            { title: "Trigger runs", body: "A run that needs fresh research mid-decision can ask for it and wait for the result." },
          ]}
        />
      </Section>

      <Section
        eyebrow="Why Claude"
        lead="The most careful writer won."
        rest="In a side-by-side test, Claude with its own web search wrote the most grounded notes, with the most citations, and got fiscal years right where other models quoted a year-old quarter as current."
      />

      <Section eyebrow="Tools" lead="What the Writer uses." rest="The data tools run in code before it writes; the web search and the final submit are its own.">
        <AgentTools agent="writer" />
      </Section>

      <TechDetails
        rows={[
          { label: "Runs as", value: <>Its own run, started by <Code>dispatch_thesis_research</Code> through <Code>app/thesis.write.requested</Code> (<Code>lib/inngest/functions/thesis-writer.ts</Code>, five at a time).</> },
          { label: "Model", value: <><Code>claude-sonnet-4-6</Code> with Anthropic&apos;s web search, up to 4 searches and 8 steps.</> },
          { label: "Pipeline", value: <><Code>lib/agent/run-thesis-writer.ts</Code>; data pulls in <Code>thesis-research/pull-data.ts</Code>; checks in <Code>thesis-research/decision.ts</Code>; sections parsed by <Code>parse-sections.ts</Code>.</> },
          { label: "Saved through", value: <><Code>record_thesis</Code> / <Code>update_thesis</Code>, with the same checks every other writer passes.</> },
        ]}
      />
    </DocBody>
  );
}
