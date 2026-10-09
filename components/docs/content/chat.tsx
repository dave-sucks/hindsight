"use client";

import { Tk } from "../chat-mock";
import { ChatExample, DocRef, DocSection, P, Prompts, ToolRef, Ul } from "../doc-text";
import { Code, DocBody, DocHeader, TechDetails } from "../primitives";
import { AgentTools } from "../tool-catalog";

export function ChatDoc() {
  return (
    <DocBody>
      <DocHeader lead="Ask anything. It sees the whole desk." rest="Talk to one analyst about its book, or to the whole account.">
        Chat reads the same theses, runs the same research, and can change a plan or propose a trade while you watch.
      </DocHeader>

      <ChatExample
        caption="Chat with the Secular Compounder selected."
        steps={[
          { kind: "user", text: "Why are we still holding AVGO after the report?" },
          {
            kind: "tools",
            label: "Reading $AVGO's thesis (+1 more)",
            rows: [
              { ticker: "AVGO", text: "Holding since June · up 18.4% · floor $1,610 · target $2,050" },
              { text: "Beat by 6%, raised AI revenue guidance; the stock fell 3% on the day" },
            ],
          },
          {
            kind: "text",
            text: <>The belief is intact. <Tk s="AVGO" c={-3.1} /> beat and raised; the drop was the sector selling, not the company. None of the things that would prove it wrong has happened.</>,
          },
          { kind: "user", text: "Good. Raise the floor to $1,650." },
          { kind: "tools", label: "Updating $AVGO's thesis", rows: [{ ticker: "AVGO", text: "Floor raised from $1,610 to $1,650" }] },
        ]}
      />

      <DocSection title="What it does">
        <P>
          Chat is the one agent you talk to directly. It can answer a question about any stock, run, trade or analyst, do research, change a plan, start{" "}
          <DocRef slug="discovery" /> or <DocRef slug="writer" />, and propose a trade. It runs on Claude Sonnet with thinking on.
        </P>
      </DocSection>

      <DocSection title="One analyst, or all of them">
        <P>
          With an analyst selected, chat works for that analyst: every edit and trade is made on its book, and it reads the analyst&apos;s strategy and rules
          first. With none selected, it looks across the whole account, and asks which analyst you mean before it writes anything.
        </P>
      </DocSection>

      <DocSection title="Try asking">
        <Prompts
          items={[
            "What's waiting on me?",
            "Why did the 8 AM run sell SHOP?",
            "How have my drift trades done this quarter?",
            "/research CRWD",
            "Raise CRWD's floor to $398.",
            "What would make you sell LLY?",
          ]}
        />
      </DocSection>

      <DocSection title="What it can reach">
        <Ul>
          <li>
            <strong>Your book:</strong> <ToolRef name="get_theses" /> and <ToolRef name="get_portfolio_context" /> for the stocks, positions and cash.
          </li>
          <li>
            <strong>The queue:</strong> <ToolRef name="list_proposals" /> reads what&apos;s waiting for you, with each reason and its time left. Chat can&apos;t
            approve or decline one; that&apos;s always your click.
          </li>
          <li>
            <strong>The record:</strong> <ToolRef name="list_runs" />, <ToolRef name="read_run" /> and <ToolRef name="read_trade_results" /> for what the
            analysts did and how their trades turned out.
          </li>
          <li>
            <strong>Research:</strong> the market data, filings, earnings, the web and X, the same as every other agent.
          </li>
          <li>
            <strong>New research:</strong> &ldquo;research CRWD&rdquo;, or <Code>/research</Code>, starts the Writer with{" "}
            <ToolRef name="dispatch_thesis_research" />, and <ToolRef name="wait_for_thesis_refresh" /> brings its thesis back into the conversation.
          </li>
        </Ul>
      </DocSection>

      <DocSection title="Changes and trades">
        <P>
          When your message is clear (&ldquo;raise the floor to $1,650&rdquo;, &ldquo;sell NVDA&rdquo;), chat says what it&apos;s doing in one sentence and does
          it. An edit goes through <ToolRef name="update_thesis" /> and lands in Activity like any other. A trade becomes a{" "}
          <DocRef slug="approvals">proposal</DocRef> like any analyst&apos;s; chat can name a size, which is used as given.
        </P>
      </DocSection>

      <DocSection title="Your notes">
        <P>
          The analysts never see this chat. What reaches them is a note on the stock&apos;s thesis, in your words: why you like or doubt it, what you&apos;re
          waiting for. Every review reads your newest notes first and answers them.
        </P>
        <Ul>
          <li>When research reaches a conclusion, chat asks before saving a note, with the draft on a question card.</li>
          <li>A note is information, not an order. A run weighs it and says so when it decides against it.</li>
          <li>A price or a condition is never just words in a note. &ldquo;Sell under $62&rdquo; becomes a trigger, and the note says why.</li>
        </Ul>
      </DocSection>

      <DocSection title="Tools">
        <P>Everything chat can call, read from the code.</P>
        <AgentTools agent="chat" />
      </DocSection>

      <TechDetails
        rows={[
          { label: "Mode", value: <><Code>principal</Code> in <Code>lib/agent/modes.ts</Code>: <Code>claude-sonnet-4-6</Code> with a 4,000-token thinking budget, up to 45 steps. The model can be switched in the chat.</> },
          { label: "Scope", value: <>With an analyst selected, the chat is a <Code>PRINCIPAL_CHAT</Code> run on that analyst, so its edits and trades are recorded like a morning run&apos;s.</> },
          { label: "Prompt", value: <><Code>buildPrincipalSystemPrompt</Code> in <Code>lib/agent/modes.ts</Code>, with the analyst brief and the house rules.</> },
          { label: "Notes", value: <><Code>write_note</Code>, only after a yes on <Code>ask_question</Code> or when you asked for one.</> },
          { label: "Route", value: <><Code>app/api/agent/[mode]/route.ts</Code></> },
        ]}
      />
    </DocBody>
  );
}
