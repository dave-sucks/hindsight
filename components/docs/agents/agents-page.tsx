/**
 * /how-it-works/agents — every agent as the engine runs it, read from its
 * record (lib/agent/engine/agents): a card each, opening a sheet with its
 * instructions (its one document, imports inlined, as the engine sends it),
 * the context and tools it is given out of all there are, when it runs and
 * who writes its message (./agent-grid.tsx). Read-only.
 *
 * The instruction files are read here, on the server, so the grid gets
 * plain data.
 */
import { CONTEXT } from "@/lib/agent/engine/parts";
import { importsOf, instructionText } from "@/lib/agent/engine/instructions";
import { cronInWords, SCHEDULE } from "@/lib/agent/engine/schedule";
import { ownFile, providerToolNames, readsOf, type AgentRecord, type ContextId } from "@/lib/agent/engine/types";
import { TOOL_DOCS } from "@/lib/docs/tools";
import { DocsNav } from "../docs-nav";
import { AgentGrid, type AgentView, type CatalogRow } from "./agent-grid";

/** A tool as the tool set builds it: what the model reads. */
export type BuiltTool = { description?: string };

/** The first sentence of a tool's own description, for a tool the docs don't describe. */
const firstSentence = (s: string) => s.split(/(?<=\.)\s/)[0];

export function AgentsPage({ agents, tools }: { agents: readonly AgentRecord[]; tools: Readonly<Record<string, BuiltTool>> }) {
  const context: CatalogRow[] = (Object.keys(CONTEXT) as ContextId[]).map((id) => ({ id, title: CONTEXT[id].title, about: CONTEXT[id].about, detail: CONTEXT[id].source }));
  // Every tool an agent can be given: the tool set, and a record's own (the Writer's submit_thesis). In the tool catalog's order (by kind), the rest after it.
  const all = new Set([...Object.keys(tools), ...agents.flatMap((a) => [...a.tools, ...(a.afterSave ?? [])])]);
  const names = [...Object.keys(TOOL_DOCS).filter((name) => all.has(name)), ...[...all].filter((name) => !TOOL_DOCS[name]).sort()];
  const toolRows: CatalogRow[] = names.map((name) => ({
    id: name,
    title: TOOL_DOCS[name]?.name ?? name,
    about: TOOL_DOCS[name]?.summary ?? firstSentence(tools[name]?.description ?? ""),
    detail: name,
  }));
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 pb-24 pt-6 sm:px-6">
      <DocsNav />
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Agents</h1>
        <p className="text-sm text-muted-foreground">Every agent, read from its record in lib/agent/engine/agents. Open one to see its instructions, its context and tools, and when it runs.</p>
      </div>
      <AgentGrid agents={agents.map(viewOf)} context={context} tools={toolRows} />
    </div>
  );
}

function viewOf(record: AgentRecord): AgentView {
  const file = ownFile(record);
  let instructions: AgentView["instructions"] = null;
  if (file) {
    try {
      instructions = { file: `lib/agent/engine/agents/${file}`, imports: importsOf(file), text: instructionText(file) };
    } catch (e) {
      instructions = { file: `lib/agent/engine/agents/${file}`, imports: [], error: e instanceof Error ? e.message : String(e) };
    }
  }
  const line = SCHEDULE.find((s) => s.agent === record.id);
  return {
    id: record.id,
    name: record.name,
    does: record.does,
    model: record.model,
    instructions,
    context: readsOf(record),
    tools: [...record.tools, ...(record.afterSave ?? [])],
    afterSave: [...(record.afterSave ?? [])],
    providerTools: providerToolNames(record),
    schedule: line ? { when: cronInWords(line.cron), per: line.per, marketDaysOnly: line.marketDaysOnly, on: line.on } : null,
    runsWhen: record.runsWhen ?? null,
    messageFrom: record.messageFrom,
  };
}
