"use client";

/**
 * The pictures a guide doc can place with `<!-- asset: name arg -->`. The
 * markdown carries the words; these draw what words can't. The names are
 * GUIDE_ASSETS in lib/docs/guide-parse.ts; a marker that names none of them,
 * or a name no doc uses, fails lib/docs/guide.test.ts.
 */

import type { ComponentType } from "react";
import type { GuideAsset } from "@/lib/docs/guide-parse";
import type { DocsAgentId } from "@/lib/docs/tools";
import { AnalystStyles, Playbook } from "./assets/analysts";
import { ProposalExample } from "./assets/approvals";
import { SituationExplorer, SituationSizes } from "./assets/situations";
import { ThesisAnatomy, ThesisLifecycle } from "./assets/theses";
import { TriggerKinds, TriggerLogCard } from "./assets/triggers";
import { SystemLayers } from "./assets/under-the-hood";
import { ReadDemo } from "./framework/read-demo";
import { AgentTools } from "./tool-catalog";

export const ASSETS: Record<GuideAsset, ComponentType<{ arg?: string }>> = {
  /** The tools one agent can call, read from lib/agent/modes.ts. `tools morning` */
  tools: ({ arg }) => <AgentTools agent={arg as DocsAgentId} />,
  "read-demo": () => <ReadDemo />,
  "trigger-log": TriggerLogCard,
  "trigger-kinds": TriggerKinds,
  "thesis-anatomy": ThesisAnatomy,
  "thesis-lifecycle": ThesisLifecycle,
  "analyst-styles": AnalystStyles,
  playbook: Playbook,
  "situation-explorer": SituationExplorer,
  "situation-sizes": SituationSizes,
  proposal: ProposalExample,
  "system-layers": SystemLayers,
};
