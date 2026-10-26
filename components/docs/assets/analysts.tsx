"use client";

import { CalendarClock, Rocket, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { P, Ul } from "../doc-text";
import { DocAccordion, DocAccordions, DocFact, Stage } from "../primitives";
import { useDocsSetups } from "../tool-catalog";
import { PillRow } from "../trigger-bits";

const ANALYSTS = [
  {
    name: "PEAD Specialist",
    icon: Rocket,
    style: "Post-earnings drift, long only",
    body: "Buys the 30 to 60 days of drift after a clean beat and raise. Never the gap day, never into the next print.",
    rule: { action: "EXIT", when: { watch: "move", is: "below", value: 12, variable: "peak" }, why: "Its trail: 12% off the high.", level: "ANALYST" },
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

/** The playbook's entry setups, one accordion each: what it is, what it needs, how it fails, and its four levels. */
export function Playbook() {
  const setups = useDocsSetups().filter((s) => s.role === "ENTRY");
  if (setups.length === 0) return null;
  return (
    <DocAccordions>
      {setups.map((s) => (
        <DocAccordion key={s.id} title={s.name}>
          <P>{s.summary}</P>
          <DocFact label="What it needs">
            <Ul>
              {s.preconditions.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </Ul>
          </DocFact>
          <DocFact label="How it fails">
            <Ul>
              {s.failureSigns.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </Ul>
          </DocFact>
          <DocFact label="Entry">{s.entry}</DocFact>
          <DocFact label="Stop">{s.stop}</DocFact>
          <DocFact label="Target">{s.target}</DocFact>
          <DocFact label="Time">{s.time}</DocFact>
        </DocAccordion>
      ))}
    </DocAccordions>
  );
}

/** Three analysts side by side, each with its style and the one rule its holdings inherit. */
export function AnalystStyles() {
  return (
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
  );
}
