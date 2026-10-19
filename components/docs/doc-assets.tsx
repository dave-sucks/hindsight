"use client";

/**
 * The pictures a guide doc can place with `<!-- asset: name arg -->`. The
 * markdown carries the words; these draw what words can't. The names are
 * GUIDE_ASSETS in lib/docs/guide-parse.ts; a marker that names none of them,
 * or a name no doc uses, fails lib/docs/guide.test.ts.
 */

import { SituationFlow } from "./assets/situations";
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
};

function AgentRequests() {
  const data = useFrameworkData();
  return data ? <RequestGrid data={data} linkBase="/how-it-works/framework" /> : null;
}
