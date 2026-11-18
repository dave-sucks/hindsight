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
import { SECTION_LABEL, type FrameworkSection } from "@/lib/docs/framework-content";

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
  /** Every agent's request to the model as squares, a tab each: the Framework page's picture. */
  "request-grid": AgentRequests,
  /** A stock's facts into one function, out as its situations: what puts it on the work list. */
  "situation-flow": SituationFlow,
  /** A thesis's triggers to the agents their On fire reaches, what comes out, and the notes coming back. */
  "fire-loop": () => <FireCanvas />,
  /** Everything one agent is sent, part by part, read from its record (lib/agent/engine/agents). `context morning_run` */
  context: ({ arg }) => <AgentContext agent={arg ?? ""} />,
};

/** One agent's parts in its record's order, under its instructions, its context and its message, then its tools. */
function AgentContext({ agent }: { agent: string }) {
  const a = useFrameworkData()?.agents.find((x) => x.id === agent);
  if (!a) return null;
  const groups = (Object.keys(SECTION_LABEL) as FrameworkSection[]).map((section) => ({ section, parts: a.parts.filter((p) => p.section === section) })).filter((g) => g.parts.length);
  const tools = [a.tools.names.length ? `${a.tools.names.length} tool${a.tools.names.length === 1 ? "" : "s"}: ${a.tools.names.join(", ")}.` : "", a.tools.provider.length ? `The model provider's own: ${a.tools.provider.join(", ")}.` : ""].filter(Boolean).join(" ");
  return (
    <div className="flex flex-col gap-5">
      {groups.map((g) => (
        <div key={g.section} className="flex flex-col gap-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{SECTION_LABEL[g.section]}</p>
          <ul className="flex flex-col divide-y border-y">
            {g.parts.map((p) => (
              <li key={`${p.kind}:${p.id}`} className="flex flex-col items-start gap-1.5 py-3 sm:flex-row sm:items-baseline sm:gap-4">
                <span className="shrink-0 sm:w-44">
                  <ContextChip part={p.swatch}>{p.title}</ContextChip>
                </span>
                <span className="text-sm text-muted-foreground">{p.kind === "own" ? `Its own text: “${p.about}”` : p.about}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {tools ? (
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Its tools</p>
          <ul className="flex flex-col divide-y border-y">
            <li className="flex flex-col items-start gap-1.5 py-3 sm:flex-row sm:items-baseline sm:gap-4">
              <span className="shrink-0 sm:w-44">
                <ContextChip part="tools">Tool menu</ContextChip>
              </span>
              <span className="break-words text-sm text-muted-foreground">{tools}</span>
            </li>
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function AgentRequests() {
  const data = useFrameworkData();
  return data ? <RequestGrid data={data} /> : null;
}
