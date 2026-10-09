"use client";

import { useState } from "react";
import { CalendarClock, Rocket, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { ChatExample, DocRef, DocSection, P, Ul } from "../doc-text";
import { Code, DocBody, DocHeader, Stage, TechDetails } from "../primitives";
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
      <DocHeader lead="Hire an analyst for every style." rest="An analyst is a trading style with its own universe, sizing and sell rules.">
        You build one by describing it, and it works its book every weekday morning.
      </DocHeader>

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

      <DocSection title="What an analyst is">
        <P>
          Each analyst is one way of trading, run by the agents. It has its own book of <DocRef slug="theses">theses</DocRef>, its own watchlist and its own
          money rules, and every agent that works on one of its stocks reads it first. You can run several side by side: one buying post-earnings drift, one
          owning long-term compounders, one trading dated events.
        </P>
      </DocSection>

      <DocSection title="What makes one">
        <Ul>
          <li>
            <strong>Strategy:</strong> its edge in your words: what it buys, what it filters out, what it never does. Every agent reads it word for word.
          </li>
          <li>
            <strong>Universe:</strong> the markets, sectors, industries, themes and market-cap band it looks in. Its exclusion list always wins.
          </li>
          <li>
            <strong>Setups:</strong> the kinds of trade it takes, chosen from the playbook below.
          </li>
          <li>
            <strong>Sizing:</strong> the smallest trade, the largest, and the most it will hold in one stock.
          </li>
          <li>
            <strong>Sell rules:</strong> its own <DocRef slug="triggers">triggers</DocRef>, inherited by every stock it holds, like a trail 12% off the high.
          </li>
          <li>
            <strong>Run days:</strong> which mornings it reviews its book. Every weekday by default.
          </li>
        </Ul>
      </DocSection>

      <DocSection title="What every agent reads about it">
        <P>
          Whichever agent is working (a <DocRef slug="morning-runs">morning run</DocRef>, a <DocRef slug="trigger-runs">trigger run</DocRef>,{" "}
          <DocRef slug="chat" /> on this analyst, <DocRef slug="discovery" /> or <DocRef slug="writer" />), it reads the same brief: the analyst&apos;s name, its
          strategy word for word, its rule numbers, how many slots are free, and one line per setup it has chosen. It&apos;s written once, so no two agents
          can describe the same analyst differently.
        </P>
      </DocSection>

      <DocSection title="It never picks a size">
        <P>
          Every buy is sized by risk: the dollars at risk divided by the distance to the floor, scaled by conviction, then held inside the analyst&apos;s band. An
          add risks half of the first buy. A tight, honest floor is what earns a bigger position.
        </P>
        <Ul>
          <li>
            <strong>Smallest trade:</strong> a normal buy. Below this, it isn&apos;t worth the slot.
          </li>
          <li>
            <strong>Largest trade:</strong> a high-conviction buy, and the ceiling for one order.
          </li>
          <li>
            <strong>Most in one stock:</strong> where adding to a winner stops.
          </li>
        </Ul>
      </DocSection>

      <DocSection title="The playbook">
        <P>
          Every analyst trades from the same playbook of setups, each with its checklist for the buy, the floor, the target and the time limit. An analyst picks
          the ones that fit its style. Pick one to read it.
        </P>
        <Playbook />
      </DocSection>

      <DocSection title="Built by conversation">
        <P>
          Describe the style and the builder interviews you with question cards, checks the idea against today&apos;s market, and proposes the whole analyst
          side by side for you to accept. The editor on an analyst&apos;s page changes one the same way.
        </P>
        <ChatExample
          caption="Building a new analyst."
          steps={[
            { kind: "user", text: "I want an analyst that buys biotech run-ups into FDA decisions." },
            { kind: "tools", label: "Pulling FDA decisions in the next 70 days, firm-wide", rows: [{ text: "23 dated decisions · 9 above a $1B market cap · 4 already run 30%+" }] },
            { kind: "text", text: "Enough supply to work with. How close to the decision should it sell: the day before, a week before, or hold through it?" },
          ]}
        />
      </DocSection>

      <TechDetails
        rows={[
          { label: "Stored as", value: <><Code>AgentConfig</Code>: <Code>analystPrompt</Code>, the universe fields, <Code>exclusionList</Code>, <Code>minPositionSize</Code> / <Code>maxPositionSize</Code> / <Code>maxPositionTotal</Code>, <Code>runDaysOfWeek</Code>, <Code>triggers</Code>.</> },
          { label: "The brief", value: <><Code>analystBrief</Code> in <Code>lib/agent/analyst-brief.ts</Code>, the one text every door puts in its prompt.</> },
          { label: "Sizing", value: <><Code>sizeByRisk</Code> in <Code>lib/agent/position-sizing.ts</Code>, shared by the trade tools and the Settings screen.</> },
          { label: "Setups", value: <><Code>lib/agent/knowledge/setups.ts</Code></> },
          { label: "Sell rules", value: <>Resolved thesis → analyst → account; the most specific wins. Inherited, never copied onto a thesis.</> },
          { label: "Builder", value: <><Code>builder</Code> and <Code>editor</Code> modes, <Code>gpt-4o</Code>, with <Code>ask_question</Code> and <Code>suggest_config</Code>.</> },
        ]}
      />
    </DocBody>
  );
}
