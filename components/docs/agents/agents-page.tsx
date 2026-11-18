/**
 * /how-it-works/agents — every agent as the engine runs it: its instructions,
 * which context blocks it is given and which tools it may call. Read from the
 * agent records (lib/agent/engine/agents), so it shows what an agent is sent.
 * Read-only.
 */
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { BLOCKS } from "@/lib/agent/engine/blocks";
import { isOwn, type AgentRecord, type BlockId } from "@/lib/agent/engine/types";
import { DocsNav } from "../docs-nav";

const n = (x: number) => x.toLocaleString("en-US");

export function AgentsPage({ agents, tools }: { agents: readonly AgentRecord[]; tools: readonly string[] }) {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 pb-24 pt-6 sm:px-6">
      <DocsNav />
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Agents</h1>
        <p className="text-sm text-muted-foreground">
          Every agent is its instructions, the context blocks it is given and the tools it may call. This page is read from the records the agent engine builds each request from, so it shows what an agent is actually sent. It is read-only for now.
        </p>
      </div>
      {agents.map((a) => (
        <AgentCard key={a.id} record={a} tools={tools} />
      ))}
    </div>
  );
}

function AgentCard({ record, tools }: { record: AgentRecord; tools: readonly string[] }) {
  const parts = [...record.instructions.map((p) => ({ p, where: "instructions" as const })), ...record.message.map((p) => ({ p, where: "message" as const }))];
  const given = new Map<BlockId, "instructions" | "message">(parts.flatMap(({ p, where }) => (isOwn(p) ? [] : [[p.block, where] as const])));
  const own = parts.flatMap(({ p }) => (isOwn(p) ? [p] : []));
  const sample = { now: new Date(), environment: "PAPER" as const, extra: record.example?.extra };
  return (
    <Card>
      <CardHeader>
        <CardTitle>{record.name}</CardTitle>
        <CardDescription>{record.does}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-6">
          <p className="text-sm text-muted-foreground">
            {record.runsWhen} Model {record.model}, {record.maxSteps === 1 ? "one call" : `up to ${record.maxSteps} steps`}.
          </p>
          <p className="text-sm text-muted-foreground">Hands back: {record.output}</p>

          <section className="flex flex-col gap-2">
            <h2 className="text-lg font-medium">Instructions</h2>
            <p className="text-sm text-muted-foreground">Its own words, in the order they are sent. The context blocks go between them where the record places them.</p>
            <div className="flex flex-col gap-1">
              {record.example && <p className="text-sm text-muted-foreground">{record.example.says}</p>}
              {own.map((o) => {
                const text = typeof o.text === "string" ? o.text : o.text(sample);
                return (
                  <Collapsible key={o.own}>
                    <CollapsibleTrigger render={<Button variant="ghost" size="sm" />}>
                      {o.title} · {text == null ? "not in this example" : `${n(text.length)} characters`}
                      {typeof o.text === "string" ? "" : " (written for each run)"}
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <p className="whitespace-pre-wrap break-words px-3 py-2 text-sm">{text ?? "Sent only in some runs."}</p>
                    </CollapsibleContent>
                  </Collapsible>
                );
              })}
            </div>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-lg font-medium">Context</h2>
            <p className="text-sm text-muted-foreground">The block library. A checked block is given to this agent, every run.</p>
            <ul className="flex flex-col gap-3">
              {Object.values(BLOCKS).map((b) => {
                const where = given.get(b.id);
                return (
                  <li key={b.id} className="flex items-start gap-3">
                    <Checkbox checked={where != null} disabled aria-label={`${b.title}${where ? " is given" : " is not given"}`} />
                    <div className="flex min-w-0 flex-col">
                      <span className="text-sm font-medium">{b.title}</span>
                      <span className="text-sm text-muted-foreground">{b.about}</span>
                      <span className="text-xs text-muted-foreground">
                        {where === "instructions" ? "In its instructions" : where === "message" ? "In its first message" : "Not given"} · {b.source}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-lg font-medium">Tools</h2>
            <p className="text-sm text-muted-foreground">Every tool an agent can be given. A checked tool is on this agent&rsquo;s menu, every run.</p>
            {record.providerTools?.length ? <p className="text-sm text-muted-foreground">Also given the model provider&rsquo;s own tool: {record.providerTools.join(", ")}.</p> : null}
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {tools.map((t) => (
                <li key={t} className="flex items-center gap-2">
                  <Checkbox checked={record.tools.includes(t)} disabled aria-label={`${t}${record.tools.includes(t) ? " is on" : " is off"}`} />
                  <span className="font-mono text-sm">{t}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </CardContent>
    </Card>
  );
}
