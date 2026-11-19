"use client";

/**
 * The Agents page's grid and the sheet behind each card (./agents-page.tsx
 * builds the data from the records). The sheet is laid out like the analyst's
 * Settings sheet, with its sections: the agent's instructions in one box, the
 * whole context and tool catalogs with its own ticked, when it runs and who
 * writes its message. Read-only: an agent is a code record, so every control
 * shows its state, disabled.
 */

import { useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Section } from "@/components/analysts/config-section";
import { cn } from "@/lib/utils";

/** One entry of a catalog (a context item or a tool): its title, what it is in a line, and where it lives. */
export interface CatalogRow {
  id: string;
  title: string;
  about: string;
  /** The small line under it: a context item's source file, a tool's name in code. */
  detail: string;
}

/** An agent record as plain data, its instructions already read. */
export interface AgentView {
  id: string;
  name: string;
  does: string;
  model: string;
  /** Its one document: the file, the files it imports, and its text as the engine sends it (or why it couldn't be read). */
  instructions: { file: string; imports: string[]; text: string } | { file: string; imports: string[]; error: string } | null;
  /** The context items it is given, by id. */
  context: string[];
  /** The tools it may call, by name, those given after its save included. */
  tools: string[];
  afterSave: string[];
  /** The model provider's own tools, named (its web search). */
  providerTools: string[];
  /** Its line in the schedule, for an agent that runs on a clock. */
  schedule: { when: string; per: "book" | "analyst"; marketDaysOnly: boolean; on: boolean } | null;
  /** When an event starts it, for the rest. */
  runsWhen: string | null;
  messageFrom: string;
}

const whenShort = (a: AgentView) => (a.schedule ? `${a.schedule.when}${a.schedule.on ? "" : " · Off"}` : (a.runsWhen ?? ""));

export function AgentGrid({ agents, context, tools }: { agents: AgentView[]; context: CatalogRow[]; tools: CatalogRow[] }) {
  const [shown, setShown] = useState<AgentView | null>(null);
  const [open, setOpen] = useState(false);
  if (!agents.length) return <p className="text-sm text-muted-foreground">No agents.</p>;
  return (
    <>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {agents.map((a) => (
          <li key={a.id} className="grid">
            <button
              type="button"
              onClick={() => {
                setShown(a);
                setOpen(true);
              }}
              className="grid rounded-xl text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <Card>
                <CardHeader>
                  <CardTitle>{a.name}</CardTitle>
                  <CardDescription>{a.does}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-col items-start gap-2">
                    <p className="text-xs text-muted-foreground">{whenShort(a)}</p>
                    <Badge variant="muted">{a.model}</Badge>
                  </div>
                </CardContent>
              </Card>
            </button>
          </li>
        ))}
      </ul>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" size="lg">
          {shown ? <AgentSheetBody agent={shown} context={context} tools={tools} /> : null}
        </SheetContent>
      </Sheet>
    </>
  );
}

function AgentSheetBody({ agent, context, tools }: { agent: AgentView; context: CatalogRow[]; tools: CatalogRow[] }) {
  const reads = new Set(agent.context);
  const given = new Set(agent.tools);
  const after = new Set(agent.afterSave);
  return (
    <>
      <SheetHeader>
        <SheetTitle>{agent.name}</SheetTitle>
        <SheetDescription>{agent.does}</SheetDescription>
        <Badge variant="muted">{agent.model}</Badge>
      </SheetHeader>

      <div className="flex flex-col">
        <Section label="Instructions">
          <Instructions agent={agent} />
        </Section>

        <Section label={`Context · ${reads.size} of ${context.length}`}>
          <Catalog rows={context} on={reads} />
        </Section>

        <Section label={`Tools · ${given.size} of ${tools.length}`}>
          {agent.providerTools.length ? <p className="text-sm text-muted-foreground">Also the model provider&rsquo;s own tool: {agent.providerTools.join(", ")}.</p> : null}
          <Catalog rows={tools} on={given} afterSave={after} mono />
        </Section>

        <Section label="When it runs">
          <When agent={agent} />
        </Section>

        <Section label="Its message">
          <p className="text-sm text-muted-foreground">Sent by: {agent.messageFrom}</p>
        </Section>
      </div>
    </>
  );
}

function Instructions({ agent }: { agent: AgentView }) {
  const doc = agent.instructions;
  if (!doc) return <p className="text-sm text-muted-foreground">This agent has no instructions file.</p>;
  return (
    <>
      <p className="break-words font-mono text-xs text-muted-foreground">
        {doc.file}
        {doc.imports.length ? ` · imports ${doc.imports.join(", ")}` : ""}
      </p>
      {"error" in doc ? (
        <Alert variant="destructive">
          <AlertTitle>Couldn&rsquo;t read its instructions</AlertTitle>
          <AlertDescription>{doc.error}</AlertDescription>
        </Alert>
      ) : (
        <Textarea sizing="rows" rows={22} readOnly value={doc.text} aria-label={`${agent.name}'s instructions`} />
      )}
    </>
  );
}

function When({ agent }: { agent: AgentView }) {
  const s = agent.schedule;
  if (!s) return <p className="text-sm text-muted-foreground">{agent.runsWhen || "Not set."}</p>;
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex flex-col">
        <span className="text-sm font-medium">{s.when}</span>
        <span className="text-sm text-muted-foreground">
          One run per {s.per === "book" ? "traded book" : "enabled analyst"}
          {s.marketDaysOnly ? ", on days the market is open" : ""}.
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className="text-sm text-muted-foreground">{s.on ? "On" : "Off"}</span>
        <Switch checked={s.on} disabled aria-label={`${agent.name}'s schedule is ${s.on ? "on" : "off"}`} />
      </div>
    </div>
  );
}

/** A whole catalog, this agent's entries ticked. */
function Catalog({ rows, on, afterSave, mono }: { rows: CatalogRow[]; on: Set<string>; afterSave?: Set<string>; mono?: boolean }) {
  return (
    <ul className="flex flex-col gap-3">
      {rows.map((r) => (
        <li key={r.id} className="flex items-start gap-3">
          <Checkbox checked={on.has(r.id)} disabled aria-label={`${r.title}${on.has(r.id) ? " is given" : " is not given"}`} />
          <div className="flex min-w-0 flex-col">
            <span className={on.has(r.id) ? "text-sm font-medium" : "text-sm text-muted-foreground"}>{r.title}</span>
            <span className="text-sm text-muted-foreground">{r.about}</span>
            <span className={cn("break-words text-xs text-muted-foreground", mono && "font-mono")}>
              {r.detail}
              {afterSave?.has(r.id) ? " · given after its save" : ""}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}
