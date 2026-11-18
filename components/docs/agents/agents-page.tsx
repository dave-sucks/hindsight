/**
 * /how-it-works/agents — every agent as the engine runs it: its instructions
 * (its own and the shared ones it is given), the context it is given and the
 * tools it may call. Read from the
 * agent records (lib/agent/engine/agents), so it shows what an agent is sent.
 * A grid of cards; each opens a sheet with the agent's configuration
 * (./agent-grid.tsx). Read-only.
 *
 * A record's own text can be a function of the run, which cannot cross to the
 * browser, so the words are written here, on the server, into plain data.
 */
import { BLOCKS } from "@/lib/agent/engine/blocks";
import { isOwn, type AgentRecord, type BlockId, type Where } from "@/lib/agent/engine/types";
import { DocsNav } from "../docs-nav";
import { AgentGrid, type AgentView } from "./agent-grid";

export function AgentsPage({ agents, tools }: { agents: readonly AgentRecord[]; tools: readonly string[] }) {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 pb-24 pt-6 sm:px-6">
      <DocsNav />
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Agents</h1>
        <p className="text-sm text-muted-foreground">
          Every agent is its instructions (its own and the shared ones it is given), the context it is given and the tools it may call. This page is read from the records the agent engine builds each request from, so it shows what an agent is actually sent. Open an agent to see its configuration. It is read-only for now.
        </p>
      </div>
      <AgentGrid agents={agents.map((a) => viewOf(a, tools))} />
    </div>
  );
}

function viewOf(record: AgentRecord, tools: readonly string[]): AgentView {
  const parts = [
    ...record.instructions.map((p) => ({ p, where: "instructions" as const })),
    ...record.message.map((p) => ({ p, where: "message" as const })),
    ...(record.newest ?? []).map((p) => ({ p, where: "newest" as const })),
  ];
  const given = new Map<BlockId, Where>(parts.flatMap(({ p, where }) => (isOwn(p) ? [] : [[p.block, where] as const])));
  const sample = { now: new Date(), environment: "PAPER" as const, extra: record.example?.extra };
  return {
    id: record.id,
    name: record.name,
    does: record.does,
    runsWhen: record.runsWhen,
    output: record.output,
    model: record.model,
    maxSteps: record.maxSteps,
    timeoutMs: record.timeoutMs ?? null,
    says: record.example?.says ?? null,
    parts: parts.flatMap(({ p, where }): AgentView["parts"] => {
      if (!isOwn(p)) {
        const b = BLOCKS[p.block];
        return b.kind === "instruction" ? [{ kind: "shared", id: b.id, title: b.title, about: b.about, where }] : [];
      }
      const text = typeof p.text === "string" ? p.text : p.text(sample);
      return [{ kind: "own", key: p.own, title: p.title, where, perRun: typeof p.text !== "string", chars: text == null ? null : text.length, text }];
    }),
    unusedInstructions: Object.values(BLOCKS)
      .filter((b) => b.kind === "instruction" && !given.has(b.id))
      .map((b) => ({ id: b.id, title: b.title, about: b.about })),
    blocks: Object.values(BLOCKS)
      .filter((b) => b.kind === "context")
      .map((b) => ({ id: b.id, title: b.title, about: b.about, where: given.get(b.id) ?? null }))
      .sort((a, b) => Number(b.where != null) - Number(a.where != null)),
    tools: tools.map((t) => ({ name: t, on: record.tools.includes(t) })),
    providerTools: [...(record.providerTools ?? [])],
  };
}
