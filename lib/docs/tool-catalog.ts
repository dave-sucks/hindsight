/**
 * The tool catalog on /docs, built on the server. WHICH agent has a tool is
 * read from the code: each mode's `toolAllowlist` in lib/agent/modes.ts (plus
 * `suggest_config`, which the route adds for modes with `hasSuggestConfig`).
 * The Writer has no allowlist; its tools are WRITER_TOOLS in ./tools.ts. WHAT
 * a tool is, in plain words, is ./tools.ts.
 *
 * tool-catalog.test.ts fails when an agent gets a tool with no entry, or an
 * entry names a tool no agent has, so the page can't drift from the code.
 */

import { MODES, type AgentMode } from "@/lib/agent/modes";
import { SETUPS } from "@/lib/agent/knowledge/setups";
import { DOCS_AGENTS, TOOL_DOCS, WRITER_TOOLS, type CatalogTool, type DocsAgentId, type DocsSetup } from "./tools";

export { TOOL_DOCS } from "./tools";

/** Podcast modes are a separate feature and stay off the trading docs. */
const PODCAST_MODES: readonly AgentMode[] = ["podcast-builder", "podcast-segment-run", "podcast-editor"];

/** Every tool an agent is given, by agent, read from the modes. */
export function agentToolLists(): Record<DocsAgentId, Set<string>> {
  const out = {} as Record<DocsAgentId, Set<string>>;
  for (const agent of DOCS_AGENTS) {
    const tools = new Set<string>(agent.id === "writer" ? WRITER_TOOLS : []);
    for (const mode of agent.modes) {
      const cfg = MODES[mode];
      for (const t of cfg.toolAllowlist ?? []) tools.add(t);
      if (cfg.hasSuggestConfig) tools.add("suggest_config");
    }
    out[agent.id] = tools;
  }
  return out;
}

/** The tools no docs agent covers: the podcast feature's, kept off the page. */
export function podcastOnlyTools(): Set<string> {
  const lists = agentToolLists();
  const docs = new Set(Object.values(lists).flatMap((s) => [...s]));
  const out = new Set<string>();
  for (const mode of PODCAST_MODES) for (const t of MODES[mode].toolAllowlist ?? []) if (!docs.has(t)) out.add(t);
  return out;
}

/** The catalog as the page shows it: every documented tool with the agents that have it. */
export function buildToolCatalog(): CatalogTool[] {
  const lists = agentToolLists();
  return Object.entries(TOOL_DOCS).map(([code, doc]) => ({
    ...doc,
    code,
    agents: DOCS_AGENTS.filter((a) => lists[a.id].has(code)).map((a) => a.id),
  }));
}

/** The setups, text only, for the Analysts page. */
export function buildSetupList(): DocsSetup[] {
  return SETUPS.map((s) => ({
    id: s.id,
    name: s.name,
    role: s.role,
    summary: s.summary,
    preconditions: s.preconditions,
    entry: s.entry.text,
    stop: s.stop.text,
    target: s.target.text,
    time: s.time.text,
    failureSigns: s.failureSigns,
  }));
}
