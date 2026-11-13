"use client";

/**
 * The pictures a guide doc can place with `<!-- asset: name arg -->`. The
 * markdown carries the words; these draw what words can't. The names are
 * GUIDE_ASSETS in lib/docs/guide-parse.ts; a marker that names none of them,
 * or a name no doc uses, fails lib/docs/guide.test.ts.
 */

import { SituationFlow } from "./assets/situations";
import { FireCanvas } from "./fire-canvas";
import type { ComponentType } from "react";
import type { GuideAsset } from "@/lib/docs/guide-parse";
import type { DocsAgentId } from "@/lib/docs/tools";
import { AnalystStyles, Playbook } from "./assets/analysts";
import { ThesisLifecycle } from "./assets/theses";
import { TriggerKinds } from "./assets/triggers";
import { SystemLayers } from "./assets/architecture";
import { ConceptHero } from "./concept-cards";
import { ReadDemo } from "./framework/read-demo";
import { RequestGrid } from "./framework/request-grid";
import { AgentTools, useFrameworkData } from "./tool-catalog";
import { ContextChip } from "@/components/domain/context-chip";
import { AGENT_CONTEXT, type ContextAgent } from "@/lib/docs/agent-context";

export const ASSETS: Record<GuideAsset, ComponentType<{ arg?: string }>> = {
  /** A concept's card from the docs home, as its doc's opening picture. `card theses` */
  card: ({ arg }) => <ConceptHero slug={arg ?? ""} />,
  /** The tools one agent can call, read from lib/agent/modes.ts. `tools morning` */
  tools: ({ arg }) => <AgentTools agent={arg as DocsAgentId} />,
  "read-demo": () => <ReadDemo />,
  "trigger-kinds": TriggerKinds,
  "thesis-lifecycle": ThesisLifecycle,
  "analyst-styles": AnalystStyles,
  playbook: Playbook,
  "system-layers": SystemLayers,
  /** One request to the model as squares, per agent: the Framework page's picture. */
  "request-grid": AgentRequests,
  /** A stock's facts into one function, out as its situations: what puts it on the work list. */
  "situation-flow": SituationFlow,
  /** A thesis's triggers to the agents their On fire reaches, what comes out, and the notes coming back. */
  "fire-loop": () => <FireCanvas />,
  /** Everything one agent is sent, part by part: the list its workflow card's chips come from. `context morning-runs` */
  context: ({ arg }) => <AgentContext agent={arg as ContextAgent} />,
};

function AgentContext({ agent }: { agent: ContextAgent }) {
  return (
    <ul className="flex flex-col divide-y border-y">
      {(AGENT_CONTEXT[agent] ?? []).map((c) => (
        <li key={c.label} className="flex flex-col items-start gap-1.5 py-3 sm:flex-row sm:items-baseline sm:gap-4">
          <span className="shrink-0 sm:w-44">
            <ContextChip part={c.part}>{c.label}</ContextChip>
          </span>
          <span className="text-sm text-muted-foreground">{c.about}</span>
        </li>
      ))}
    </ul>
  );
}

function AgentRequests() {
  const data = useFrameworkData();
  return data ? <RequestGrid data={data} linkBase="/how-it-works/framework" /> : null;
}
