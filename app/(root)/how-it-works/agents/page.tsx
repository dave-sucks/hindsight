import type { Metadata } from "next";
import { AgentsPage } from "@/components/docs/agents/agents-page";
import { AGENTS } from "@/lib/agent/engine/agents";
import { createResearchTools } from "@/lib/agent/tools";

export const metadata: Metadata = { title: "Agents · How it works · Hindsight" };

/** Every tool an agent can be given, by name, read from the tool set itself (as lib/docs/framework.ts does). */
function allTools(): string[] {
  const all = createResearchTools({ runId: "docs", userId: "u", accountId: "a", analystId: "an", runMode: "DOCS", runEnvironment: "PAPER" } as never) as Record<string, unknown>;
  return Object.keys(all).sort();
}

export default function DocsAgentsPage() {
  return <AgentsPage agents={AGENTS} tools={allTools()} />;
}
