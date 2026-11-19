import type { Metadata } from "next";
import { AgentsPage, type BuiltTool } from "@/components/docs/agents/agents-page";
import { AGENTS } from "@/lib/agent/engine/agents";
import { createResearchTools } from "@/lib/agent/tools";
import { podcastOnlyTools } from "@/lib/docs/tool-catalog";

export const metadata: Metadata = { title: "Agents · How it works · Hindsight" };

/** Every tool an agent can be given, read from the tool set itself (as lib/docs/framework.ts does); the podcast feature's stay off, as on the tool catalog. */
function allTools(): Record<string, BuiltTool> {
  const all = createResearchTools({ runId: "docs", userId: "u", accountId: "a", analystId: "an", runMode: "DOCS", runEnvironment: "PAPER" } as never) as unknown as Record<string, BuiltTool>;
  const podcast = podcastOnlyTools();
  return Object.fromEntries(Object.entries(all).filter(([name]) => !podcast.has(name)));
}

export default function DocsAgentsPage() {
  return <AgentsPage agents={AGENTS} tools={allTools()} />;
}
