"use client";

import { ChatMock, Tk } from "../chat-mock";
import { Code, DocBody, DocHeader, Section, Stage, TechDetails, Trio } from "../primitives";
import { AgentTools } from "../tool-catalog";

const ASKS = [
  "What's waiting on me?",
  "Why did the 8 AM run sell SHOP?",
  "How have my drift trades done this quarter?",
  "Find drift names off this week's reports.",
  "Raise CRWD's floor to $398.",
  "What would make you sell LLY?",
  "Which stocks have stale research?",
  "Write up why I'm holding AVGO through earnings.",
];

export function ChatDoc() {
  return (
    <DocBody>
      <DocHeader
        eyebrow="Agent · Chat"
        lead="Ask anything. It sees the whole desk."
        rest="Talk to one analyst about its book, or to the whole account. It reads the same theses, runs the same research, and can change a plan or propose a trade while you watch."
      />

      <Stage label="Example">
        <ChatMock
          className="mx-auto max-w-2xl"
          title="Secular Compounder"
          steps={[
            { kind: "user", text: "Why are we still holding AVGO after the report?" },
            {
              kind: "tools",
              label: "Reading thesis on $AVGO (+1 more)",
              rows: [
                { ticker: "AVGO", text: "Holding since June · up 18.4% · floor $1,610 · target $2,050" },
                { text: "Beat by 6%, raised AI revenue guidance; the stock fell 3% on the day" },
              ],
            },
            {
              kind: "text",
              text: (
                <>
                  The belief is intact. <Tk s="AVGO" c={-3.1} /> beat and raised; the drop was the whole sector selling, not the company. None of the three things that
                  would prove it wrong has happened, and the floor locks in about 9% of the gain.
                </>
              ),
            },
            { kind: "user", text: "Good. Raise the floor to $1,650, and note that I want to hold through the next print." },
            {
              kind: "tools",
              label: "Updating thesis 7a2c91e0 (+1 more)",
              rows: [
                { ticker: "AVGO", text: "Floor raised from $1,610 to $1,650" },
                { text: "Your note saved: hold through the next report unless the guide is cut" },
              ],
            },
          ]}
        />
      </Stage>

      <Trio
        items={[
          { title: "One analyst, or all of them", body: "Pick an analyst to talk about its book, or none to look across the whole account." },
          { title: "The same tools, and more", body: "Research, your book, the run history, trade results, the Writer, edits and trades, all in one place." },
          { title: "It asks before saving your words", body: "A note goes on a stock only after you say yes on the question card." },
        ]}
      />

      <Section eyebrow="Try asking" lead="Questions, changes and research." rest="Anything you'd ask an analyst sitting next to you.">
        <div className="flex flex-wrap gap-2">
          {ASKS.map((a) => (
            <span key={a} className="rounded-2xl bg-muted px-3.5 py-2 text-sm text-foreground">
              {a}
            </span>
          ))}
        </div>
      </Section>

      <Section eyebrow="Your words" lead="What you say travels with the stock.">
        <Trio
          items={[
            { title: "Notes are read first", body: "Every review reads your newest notes before anything else and answers them." },
            { title: "Information, not orders", body: "A note is weighed, not obeyed. When a run goes against it, it says so and why." },
            { title: "Your edits win", body: "A change you make by hand while a run is working stands over the run's copy." },
          ]}
        />
      </Section>

      <Section eyebrow="Tools" lead="What chat can use." rest="Read from the code.">
        <AgentTools agent="chat" />
      </Section>

      <TechDetails
        rows={[
          { label: "Mode", value: <><Code>principal</Code> · <Code>claude-sonnet-4-6</Code> with thinking on · up to 45 steps</> },
          { label: "Scope", value: <>With an analyst selected, the chat is a <Code>PRINCIPAL_CHAT</Code> run on that analyst, so edits and trades are recorded the same way as a morning run&apos;s.</> },
          { label: "Prompt", value: <><Code>buildPrincipalSystemPrompt</Code> in <Code>lib/agent/modes.ts</Code>, with the shared house rules.</> },
          { label: "Route", value: <><Code>app/api/agent/[mode]/route.ts</Code></> },
        ]}
      />
    </DocBody>
  );
}
