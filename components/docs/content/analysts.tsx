"use client";

import { useState } from "react";
import { CalendarClock, Gauge, Rocket, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { ChatMock } from "../chat-mock";
import { Anatomy, Code, DocBody, DocHeader, Section, Stage, TechDetails } from "../primitives";
import { useDocsSetups } from "../tool-catalog";
import { PillRow } from "../trigger-bits";

const ANALYSTS = [
  {
    name: "PEAD Specialist",
    icon: Rocket,
    style: "Post-earnings drift, long only",
    body: "Buys the 30 to 60 days of drift after a clean beat and raise. Never the gap day, never into the next print.",
    rule: { action: "EXIT", when: { watch: "move", is: "below", value: 12, variable: "peak", settings: { startOnceUpPct: 10 } }, why: "Its trail: 12% off the high, once up 10%.", level: "ANALYST" },
    pos: "sm:mr-24",
  },
  {
    name: "Secular Compounder",
    icon: ShieldCheck,
    style: "Long-term compounders",
    body: "Owns great businesses for years and adds on weakness. Lets winners run.",
    rule: { action: "EXIT", when: { watch: "move", is: "below", value: 25, variable: "peak" }, why: "Its only automatic sale.", level: "ANALYST" },
    pos: "sm:mx-12",
  },
  {
    name: "Catalyst Event PM",
    icon: CalendarClock,
    style: "Dated events",
    body: "FDA decisions, deals, product launches. Every review is tied to the event date.",
    rule: { action: "REVIEW", when: { watch: "from_date", is: "before", value: 10, variable: "event" }, why: "Ten days before every event.", level: "ANALYST" },
    pos: "sm:ml-24",
  },
] as const;

function Playbook() {
  const setups = useDocsSetups().filter((s) => s.role === "ENTRY");
  const [id, setId] = useState(setups[0]?.id ?? "");
  const s = setups.find((x) => x.id === id) ?? setups[0];
  if (!s) return null;
  return (
    <div className="grid overflow-hidden rounded-2xl border bg-background md:grid-cols-[14rem_minmax(0,1fr)]">
      <div className="flex gap-1 overflow-x-auto border-b p-2 md:flex-col md:overflow-visible md:border-b-0 md:border-r">
        {setups.map((x) => (
          <button
            key={x.id}
            type="button"
            onClick={() => setId(x.id)}
            className={cn(
              "shrink-0 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors",
              x.id === s.id ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {x.name}
          </button>
        ))}
      </div>
      <div className="flex min-w-0 flex-col gap-4 p-5">
        <div className="flex flex-col gap-1">
          <p className="text-base font-medium text-foreground">{s.name}</p>
          <p className="text-sm text-muted-foreground">{s.summary}</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">What it needs</p>
            <ul className="flex list-disc flex-col gap-1 pl-4 text-sm text-foreground">
              {s.preconditions.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
          <div className="flex flex-col gap-1.5">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">How it fails</p>
            <ul className="flex list-disc flex-col gap-1 pl-4 text-sm text-foreground">
              {s.failureSigns.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
        </div>
        <dl className="grid gap-x-4 gap-y-2 border-t pt-4 text-sm sm:grid-cols-[6rem_minmax(0,1fr)]">
          {[
            ["Entry", s.entry],
            ["Stop", s.stop],
            ["Target", s.target],
            ["Time", s.time],
          ].map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="text-foreground">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

export function AnalystsDoc() {
  return (
    <DocBody>
      <DocHeader
        eyebrow="Concept"
        lead="Hire an analyst for every style."
        rest="An analyst is a trading style with its own universe, sizing and sell rules. You build one by talking to it, and it works your book three mornings a week."
      />

      <Stage label="Your analysts">
        <div className="flex flex-col gap-3 py-1">
          {ANALYSTS.map((a) => (
            <div key={a.name} className={cn("flex flex-col gap-3 rounded-2xl border bg-background p-4 shadow-sm", a.pos)}>
              <span className="flex items-center gap-2.5">
                <span className="grid size-8 place-items-center rounded-lg bg-muted text-foreground">
                  <a.icon className="size-4" />
                </span>
                <span className="flex flex-col">
                  <span className="text-sm font-medium text-foreground">{a.name}</span>
                  <span className="text-xs text-muted-foreground">{a.style}</span>
                </span>
              </span>
              <p className="text-sm text-muted-foreground">{a.body}</p>
              <div className="border-t pt-3">
                <PillRow action={a.rule.action} specs={[a.rule]} />
              </div>
            </div>
          ))}
        </div>
      </Stage>

      <Section eyebrow="Anatomy" lead="What makes an analyst." rest="Each part is a setting you can read and change on its page.">
        <Anatomy
          items={[
            { title: "Strategy", body: "Its edge in its own words: what it buys, what it filters out, what it never does." },
            { title: "Universe", body: "Markets, sectors, industries, themes and a market-cap band. The exclusion list always wins." },
            { title: "Setups", body: "The kinds of trade it takes, each with a checklist for the buy, the stop, the target and the time limit." },
            { title: "Sizing", body: "Three numbers: the smallest trade, the largest, and the most it will hold in one stock." },
            { title: "Sell rules", body: "Its Triggers tab: the rules every one of its holdings inherits, like a trail off the high." },
            { title: "Run days", body: "Which mornings it reviews its book. A market holiday is never a run day." },
          ]}
        />
      </Section>

      <Section eyebrow="Sizing" lead="It never picks a size." rest="Every buy is sized by risk: the dollars at risk over the distance to the floor, scaled by conviction, then held inside the analyst's band. An add risks half of the first buy.">
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            { t: "Smallest trade", b: "A normal buy. Below this, it isn't worth the slot." },
            { t: "Largest trade", b: "A high-conviction buy. The ceiling for one order." },
            { t: "Most in one stock", b: "Where adding to a winner stops." },
          ].map((c) => (
            <div key={c.t} className="flex flex-col gap-1.5 rounded-xl border bg-card p-4">
              <Gauge className="size-4 text-muted-foreground" />
              <p className="text-sm font-medium text-foreground">{c.t}</p>
              <p className="text-sm text-muted-foreground">{c.b}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section eyebrow="The playbook" lead="Setups are written down." rest="Every analyst trades from the same playbook of setups; each picks the ones that fit its style. Pick one to read it.">
        <Playbook />
      </Section>

      <Section eyebrow="Built by conversation" lead="Describe the style. It builds the analyst." rest="The builder interviews you with question cards, checks the idea against today's market, and proposes the whole setup side by side for you to accept.">
        <Stage label="Example">
          <ChatMock
            className="mx-auto max-w-2xl"
            title="New analyst"
            steps={[
              { kind: "user", text: "I want an analyst that buys biotech run-ups into FDA decisions." },
              {
                kind: "tools",
                label: "Pulling FDA decisions in the next 70 days, firm-wide",
                rows: [{ text: "23 dated decisions · 9 above a $1B market cap · 4 already run 30%+" }],
              },
              {
                kind: "text",
                text: (
                  <div className="flex flex-col gap-3">
                    <span>Enough supply to work with. How close to the decision should it sell?</span>
                    <span className="flex flex-wrap gap-1.5">
                      {["The day before", "A week before", "Hold through it"].map((o) => (
                        <span key={o} className="rounded-full border px-3 py-1 text-sm text-foreground">
                          {o}
                        </span>
                      ))}
                    </span>
                  </div>
                ),
              },
            ]}
          />
        </Stage>
      </Section>

      <TechDetails
        rows={[
          { label: "Stored as", value: <><Code>AgentConfig</Code>: <Code>analystPrompt</Code>, the universe fields, <Code>exclusionList</Code>, <Code>minPositionSize</Code> / <Code>maxPositionSize</Code> / <Code>maxPositionTotal</Code>, <Code>runDaysOfWeek</Code>, <Code>triggers</Code>.</> },
          { label: "Sizing", value: <><Code>lib/agent/position-sizing.ts</Code> (<Code>sizeByRisk</Code>), shared by the trade tools and the Settings screen.</> },
          { label: "Setups", value: <><Code>lib/agent/knowledge/setups.ts</Code></> },
          { label: "Sell rules", value: <>Resolved thesis → analyst → account by <Code>lib/agent/triggers/levels</Code>; most specific wins.</> },
          { label: "Builder", value: <><Code>builder</Code> and <Code>editor</Code> modes, <Code>gpt-4o</Code>, with <Code>ask_question</Code> and <Code>suggest_config</Code>.</> },
        ]}
      />
    </DocBody>
  );
}
