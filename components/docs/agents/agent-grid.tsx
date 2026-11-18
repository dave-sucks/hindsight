"use client";

/**
 * The Agents page's grid and the sheet behind each card. One card per agent
 * (what it decides, when it runs, its model and limits); the sheet is its
 * configuration: how it runs, its own instructions, the context blocks it is
 * given and its tools. Same shape as Settings → Playbook: the card carries
 * what you scan for, the sheet carries the rest. Read-only: agents are code
 * records, so every control shows its state disabled.
 */

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { InfoRow } from "@/components/ui/info-row";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import type { Where } from "@/lib/agent/engine/types";

type PartView =
  | { kind: "own"; key: string; title: string; where: Where; perRun: boolean; chars: number | null; text: string | null }
  | { kind: "shared"; id: string; title: string; about: string; where: Where };

/** An agent record as plain data: its words already written for the page, so it can cross to the browser. */
export interface AgentView {
  id: string;
  name: string;
  does: string;
  runsWhen: string;
  output: string;
  model: string;
  maxSteps: number;
  timeoutMs: number | null;
  /** The run its per-run words are shown for. */
  says: string | null;
  /** Its instructions in the order they are sent: its own parts and the shared instruction blocks it is given. */
  parts: PartView[];
  /** The shared instruction blocks it is not given. */
  unusedInstructions: { id: string; title: string; about: string }[];
  /** Every context block in the library; `where` is null when this agent is not given it. */
  blocks: { id: string; title: string; about: string; where: Where | null }[];
  /** Every tool an agent can be given. */
  tools: { name: string; on: boolean }[];
  providerTools: string[];
}

const PLACE: Record<Where, string> = { instructions: "In its instructions", message: "In its first message", newest: "On each new message you send" };

const n = (x: number) => x.toLocaleString("en-US");

function duration(ms: number): string {
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m && s ? `${m} min ${s} s` : m ? `${m} min` : `${s} s`;
}

const stepsLine = (a: AgentView) => (a.maxSteps === 1 ? "one call" : `up to ${n(a.maxSteps)} steps`);

const toolsOn = (a: AgentView) => a.tools.filter((t) => t.on).length + a.providerTools.length;
const blocksGiven = (a: AgentView) => a.blocks.filter((b) => b.where).length;

// ── Grid and card ────────────────────────────────────────────────────────────

export function AgentGrid({ agents }: { agents: AgentView[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const open = agents.find((a) => a.id === openId) ?? null;
  return (
    <>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {agents.map((a) => (
          <li key={a.id} className="grid">
            <AgentCard agent={a} onOpen={() => setOpenId(a.id)} />
          </li>
        ))}
      </ul>
      {open ? <AgentSheet key={open.id} agent={open} onClose={() => setOpenId(null)} /> : null}
    </>
  );
}

function AgentCard({ agent, onOpen }: { agent: AgentView; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="group/agent grid rounded-xl text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
      <Card>
        <CardHeader>
          <CardTitle>{agent.name}</CardTitle>
          <CardDescription>{agent.does}</CardDescription>
          <CardAction>
            <ChevronRight className="size-4 text-muted-foreground transition-transform group-hover/agent:translate-x-0.5 group-hover/agent:text-foreground" />
          </CardAction>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3">
            <Separator />
            <p className="text-sm text-muted-foreground">{agent.runsWhen}</p>
            <p className="text-xs text-muted-foreground tabular-nums">
              {[agent.model, stepsLine(agent), agent.timeoutMs ? duration(agent.timeoutMs) : null].filter(Boolean).join(" · ")}
            </p>
            <div className="flex flex-wrap gap-1.5">
              <Badge variant="muted">
                <span className="tabular-nums">{blocksGiven(agent)}</span> context {blocksGiven(agent) === 1 ? "block" : "blocks"} given
              </Badge>
              <Badge variant="muted">
                <span className="tabular-nums">{toolsOn(agent)}</span> {toolsOn(agent) === 1 ? "tool" : "tools"} on
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>
    </button>
  );
}

// ── Sheet ────────────────────────────────────────────────────────────────────

function AgentSheet({ agent, onClose }: { agent: AgentView; onClose: () => void }) {
  const given = agent.blocks.filter((b) => b.where);
  const rest = agent.blocks.filter((b) => !b.where);
  const on = agent.tools.filter((t) => t.on);
  const off = agent.tools.filter((t) => !t.on);
  return (
    <Sheet open onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" size="lg" floating>
        <SheetHeader>
          <SheetTitle>{agent.name}</SheetTitle>
          <SheetDescription>{agent.does}</SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-6 px-4 pb-6">
          <Section label="How it runs">
            <div>
              <InfoRow label="Model" value={agent.model} mono />
              <InfoRow label="Steps" value={agent.maxSteps === 1 ? "One call" : `Up to ${n(agent.maxSteps)}`} mono />
              <InfoRow label="Time limit" value={agent.timeoutMs ? duration(agent.timeoutMs) : "Not set"} mono />
            </div>
            <Fact label="Runs when" text={agent.runsWhen} />
            <Fact label="Hands back" text={agent.output} />
          </Section>

          <Separator />

          <Section label="Instructions" count={`${agent.parts.length} part${agent.parts.length === 1 ? "" : "s"}`}>
            <p className="text-xs text-muted-foreground">Its own words and the shared instructions it is given, in the order they are sent. The context goes between them where the record places it.</p>
            {agent.says ? <p className="text-xs text-muted-foreground">{agent.says}</p> : null}
            <div className="flex flex-col gap-2">
              {agent.parts.map((p) =>
                p.kind === "own" ? <InstructionPart key={`${p.where}-${p.key}`} part={p} /> : <SharedInstruction key={`${p.where}-${p.id}`} part={p} />,
              )}
            </div>
            {agent.unusedInstructions.length > 0 ? (
              <>
                <p className="pt-2 text-xs text-muted-foreground">Shared instructions it isn&rsquo;t given</p>
                <ul className="flex flex-col">
                  {agent.unusedInstructions.map((b) => (
                    <li key={b.id} className="flex flex-col gap-0.5 border-b border-border py-2">
                      <span className="text-sm font-medium">{b.title}</span>
                      <span className="text-xs text-muted-foreground">{b.about}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </Section>

          <Separator />

          <Section label="Context" count={`${given.length} of ${agent.blocks.length} given`}>
            <p className="text-xs text-muted-foreground">The facts of the moment. A switched-on block is given to this agent, every run.</p>
            <BlockList blocks={given} />
            {rest.length > 0 ? (
              <>
                {given.length > 0 ? <p className="pt-2 text-xs text-muted-foreground">Not given</p> : null}
                <BlockList blocks={rest} />
              </>
            ) : null}
          </Section>

          <Separator />

          <Section label="Tools" count={`${toolsOn(agent)} on`}>
            <p className="text-xs text-muted-foreground">Every tool an agent can be given. A checked tool is on this agent&rsquo;s menu, every run.</p>
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {agent.providerTools.map((t) => (
                <ToolRow key={`provider-${t}`} name={t} on note="The model provider's own" />
              ))}
              {on.map((t) => (
                <ToolRow key={t.name} name={t.name} on />
              ))}
            </ul>
            {off.length > 0 ? (
              <>
                {toolsOn(agent) > 0 ? <p className="pt-2 text-xs text-muted-foreground">Not on its menu</p> : null}
                <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {off.map((t) => (
                    <ToolRow key={t.name} name={t.name} on={false} />
                  ))}
                </ul>
              </>
            ) : null}
          </Section>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Section({ label, count, children }: { label: string; count?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</h3>
        {count ? <span className="text-xs text-muted-foreground tabular-nums">{count}</span> : null}
      </div>
      {children}
    </section>
  );
}

function Fact({ label, text }: { label: string; text: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm">{text}</p>
    </div>
  );
}

/** A shared instruction the agent is given: on a bordered row like its own parts, with no text to open. */
function SharedInstruction({ part }: { part: Extract<PartView, { kind: "shared" }> }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border px-3 py-2">
      <span className="flex items-center gap-2">
        <span className="text-sm font-medium">{part.title}</span>
        <Badge variant="muted">Shared</Badge>
      </span>
      <span className="text-xs text-muted-foreground">{part.about}</span>
      <span className="text-xs text-muted-foreground">{PLACE[part.where]}</span>
    </div>
  );
}

/** One of the agent's own parts: its title and size on a bordered row, its text when opened. */
function InstructionPart({ part }: { part: Extract<PartView, { kind: "own" }> }) {
  return (
    <div className="rounded-lg border border-border">
      <Collapsible>
        <CollapsibleTrigger
          render={<button type="button" className="group/part flex w-full items-center gap-2 px-3 py-2 text-left text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50" />}
        >
          <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[panel-open]/part:rotate-90" />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="font-medium">{part.title}</span>
            <span className="text-xs text-muted-foreground">
              {PLACE[part.where]}
              {part.perRun ? " · written for each run" : ""}
            </span>
          </span>
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{part.chars == null ? "not in this example" : `${n(part.chars)} characters`}</span>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="max-h-80 overflow-y-auto whitespace-pre-wrap break-words border-t border-border px-3 py-2 font-mono text-xs leading-relaxed">{part.text ?? "Sent only in some runs."}</div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

function BlockList({ blocks }: { blocks: AgentView["blocks"] }) {
  return (
    <ul className="flex flex-col">
      {blocks.map((b) => (
        <li key={b.id} className="flex items-start justify-between gap-3 border-b border-border py-2">
          <div className="flex min-w-0 flex-col items-start gap-1">
            <span className="text-sm font-medium">{b.title}</span>
            <span className="text-xs text-muted-foreground">{b.about}</span>
            {b.where ? <Badge variant="muted">{PLACE[b.where]}</Badge> : null}
          </div>
          <Switch size="sm" checked={b.where != null} disabled aria-label={`${b.title}${b.where ? " is given" : " is not given"}`} />
        </li>
      ))}
    </ul>
  );
}

function ToolRow({ name, on, note }: { name: string; on: boolean; note?: string }) {
  return (
    <li className="flex items-center gap-2">
      <Checkbox checked={on} disabled aria-label={`${name}${on ? " is on" : " is off"}`} />
      <span className="min-w-0 break-words font-mono text-sm">{name}</span>
      {note ? <span className="text-xs text-muted-foreground">{note}</span> : null}
    </li>
  );
}
