"use client";

/**
 * Real trigger pills on the docs pages: the thesis sheet's own TriggerPill,
 * read-only, fed an example trigger. Clicking one opens its real popover.
 */

import { TriggerPill } from "@/components/agent/triggers/TriggerPill";
import { actionLabel, type When } from "@/lib/agent/triggers/condition";
import type { TriggerAction } from "@/lib/agent/triggers/types";
import type { Trigger } from "@/lib/types/thesis-sheet";

export interface PillSpec {
  action: TriggerAction;
  when: When;
  why: string;
  level?: "THESIS" | "ANALYST" | "ACCOUNT";
}

function asTrigger(p: PillSpec, i: number): Trigger {
  const level = p.level ?? "THESIS";
  return {
    id: `docs-example-${i}`,
    predicate: p.when,
    action: p.action,
    rationale: p.why,
    level,
    inherited: level !== "THESIS",
  };
}

/** One pill, read-only. */
export function ExamplePill({ spec, index = 0, held = true }: { spec: PillSpec; index?: number; held?: boolean }) {
  return <TriggerPill trigger={asTrigger(spec, index)} level="THESIS" held={held} editable={false} endpointBase="" analystId={null} />;
}

/** A row the way the thesis sheet draws one: the action, then its pills. */
export function PillRow({ action, specs, held = true }: { action: TriggerAction; specs: readonly PillSpec[]; held?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
      <span className="w-16 shrink-0 whitespace-nowrap text-sm text-muted-foreground">{actionLabel(action, held)}</span>
      {specs.map((s, i) => (
        <ExamplePill key={i} spec={s} index={i} held={held} />
      ))}
    </div>
  );
}
