/**
 * /how-it-works/agents — every agent as the engine runs it: its instructions
 * (its own text and the shared texts it uses), its context (the reads in its
 * first message), its message and its tools. Read from the agent records
 * (lib/agent/engine/agents), so it shows what an agent is sent. Read-only.
 */
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { CONTEXT, SHARED } from "@/lib/agent/engine/parts";
import { ownText, readsOf, sharedOf, type AgentRecord, type ContextId, type SharedId } from "@/lib/agent/engine/types";
import { DocsNav } from "../docs-nav";

const n = (x: number) => x.toLocaleString("en-US");

export function AgentsPage({ agents, tools }: { agents: readonly AgentRecord[]; tools: readonly string[] }) {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 pb-24 pt-6 sm:px-6">
      <DocsNav />
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Agents</h1>
        <p className="text-sm text-muted-foreground">
          An agent is its instructions, its context and its tools. Its instructions are its own text and the shared texts it uses. Its context is what it is handed when it starts: the facts in its first message, after a line with the date and the account. Then comes its message, the run&rsquo;s task, written by whoever starts it. This page is read from the records the agent engine builds each request from, so it shows what an agent is actually sent. It is read-only for now.
        </p>
      </div>
      {agents.map((a) => (
        <AgentCard key={a.id} record={a} tools={tools} />
      ))}
    </div>
  );
}

function AgentCard({ record, tools }: { record: AgentRecord; tools: readonly string[] }) {
  const own = ownText(record);
  const shared = new Set<SharedId>(sharedOf(record));
  const reads = new Set<ContextId>(readsOf(record));
  // Its first message in order: the date line, then each read and its message where the record lists it.
  const order = ["the date line", ...record.context.map((id) => (id === "message" ? "its message" : CONTEXT[id].title))].join(", ");
  return (
    <Card>
      <CardHeader>
        <CardTitle>{record.name}</CardTitle>
        <CardDescription>{record.does}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-6">
          <p className="text-sm text-muted-foreground">
            {record.runsWhen} Model {record.model}, {record.maxSteps === 1 ? "one call" : `up to ${record.maxSteps} steps`}
            {record.timeoutMs ? `, stopped after ${Math.floor(record.timeoutMs / 60_000)} min ${Math.round((record.timeoutMs % 60_000) / 1000)} s` : ""}.
          </p>
          <p className="text-sm text-muted-foreground">Hands back: {record.output}</p>

          <section className="flex flex-col gap-2">
            <h2 className="text-lg font-medium">Instructions</h2>
            <p className="text-sm text-muted-foreground">Its own text, the same on every run, and the shared texts it uses, in the order they are sent.{reads.has("the_stock") ? " The stock's situations end them, when it is in one." : ""}</p>
            <Collapsible>
              <CollapsibleTrigger render={<Button variant="ghost" size="sm" />}>Its own text · {n(own.length)} characters</CollapsibleTrigger>
              <CollapsibleContent>
                <p className="whitespace-pre-wrap break-words px-3 py-2 text-sm">{own}</p>
              </CollapsibleContent>
            </Collapsible>
            <Checklist items={(Object.keys(SHARED) as SharedId[]).map((id) => ({ id, ...SHARED[id], on: shared.has(id) }))} />
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-lg font-medium">Context</h2>
            <p className="text-sm text-muted-foreground">
              {record.conversation ? "On each message you send" : "In its first message"}, in order: {order}. The date line is the date and time in New York, and whether the account is paper or live.
            </p>
            <Checklist items={(Object.keys(CONTEXT) as ContextId[]).map((id) => ({ id, ...CONTEXT[id], on: reads.has(id) }))} />
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-lg font-medium">Message</h2>
            <p className="text-sm text-muted-foreground">{record.messageFrom}</p>
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

/** Every shared text or read an agent can be given: a checked one is given to this agent. */
function Checklist({ items }: { items: Array<{ id: string; title: string; about: string; source: string; on: boolean }> }) {
  return (
    <ul className="flex flex-col gap-3">
      {items.map((b) => (
        <li key={b.id} className="flex items-start gap-3">
          <Checkbox checked={b.on} disabled aria-label={`${b.title}${b.on ? " is given" : " is not given"}`} />
          <div className="flex min-w-0 flex-col">
            <span className="text-sm font-medium">{b.title}</span>
            <span className="text-sm text-muted-foreground">{b.about}</span>
            <span className="text-xs text-muted-foreground">{b.source}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}
