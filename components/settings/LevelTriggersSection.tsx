"use client";

/**
 * LevelTriggersSection — the standing trigger ladder at the ACCOUNT or
 * ANALYST level.
 *
 * Deliberately NOT a new trigger UI. It renders the exact `TriggerGroups`
 * + `AddTriggerDialog` the thesis sheet uses, pointed at
 * `/api/levels/:level/:ownerId/triggers` instead of the thesis routes.
 * Same pill, same popover, same Add dialog, same dashed treatment for
 * anything inherited from below — a rung looks and edits identically
 * wherever it lives, which is the whole point of the cascade.
 *
 * What differs from the thesis view, and why:
 *   • No "$ Price" criterion. An absolute dollar level is meaningless
 *     applied across every ticker (`addLevelTrigger` refuses it too).
 *   • `held` is forced true. There is no position in scope here; the flag
 *     means "offer the position-scoped criteria", and "every holding
 *     trails 6%" is the most valuable thing a standing rule can say.
 */

import { useCallback, useEffect, useState } from "react";
import {
  TriggerGroups,
  AddTriggerDialog,
} from "@/components/agent/sheets/ThesisTriggersSection";
import type { Trigger } from "@/lib/types/thesis-sheet";

interface LevelTriggersResponse {
  level: "ACCOUNT" | "ANALYST";
  ownerId: string;
  ownerLabel: string;
  triggers: Trigger[];
}

export function LevelTriggersSection({
  level,
  ownerId,
  editable = true,
}: {
  level: "account" | "analyst";
  /** accountId for the account level; the AgentConfig id for an analyst. */
  ownerId: string;
  editable?: boolean;
}) {
  const [data, setData] = useState<LevelTriggersResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const endpointBase = `/api/levels/${level}/${ownerId}/triggers`;

  const load = useCallback(async () => {
    try {
      const res = await fetch(endpointBase);
      if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
      setData((await res.json()) as LevelTriggersResponse);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [endpointBase]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) {
    return (
      <p className="text-xs text-muted-foreground">
        Couldn&apos;t load triggers: {error}
      </p>
    );
  }
  if (!data) {
    return <p className="text-xs text-muted-foreground">Loading triggers…</p>;
  }

  const own = data.triggers.filter((t) => !t.inherited);
  // Inherited rungs are split BY SOURCE LEVEL rather than shown as one
  // dashed pile. On the thesis sheet a single dashed treatment is right —
  // there, "not from here" is the whole message. On a settings page it
  // isn't: the account page and the analyst tab both show the same five
  // app defaults, and with no origin label they read as the same rules
  // duplicated across two screens instead of one set of defaults
  // inherited by both.
  const inheritedByLevel: Array<{ level: string; heading: string; items: Trigger[] }> = [
    {
      level: "ACCOUNT",
      heading: "From your account rules",
      items: data.triggers.filter((t) => t.inherited && t.level === "ACCOUNT"),
    },
    {
      level: "DEFAULT",
      heading: "From the app defaults",
      items: data.triggers.filter((t) => t.inherited && t.level === "DEFAULT"),
    },
  ].filter((g) => g.items.length > 0);

  const groupProps = {
    thesisId: "",
    direction: null,
    held: true,
    endpointBase,
    onChanged: () => void load(),
  } as const;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {level === "account" ? "Set on this account" : "Set on this analyst"}
        </span>
        {own.length > 0 ? (
          <TriggerGroups {...groupProps} triggers={own} editable={editable} />
        ) : (
          <p className="text-xs text-muted-foreground">
            {level === "account"
              ? "Nothing set here yet — everything below is an app default. Add a rule of the same kind to override one."
              : "Nothing set here yet — everything below comes from the account or the app defaults. Add a rule of the same kind to override one for this analyst only."}
          </p>
        )}
        {editable ? (
          <AddTriggerDialog
            held
            endpointBase={endpointBase}
            allowAbsolutePrice={false}
            onChanged={() => void load()}
          />
        ) : null}
      </div>

      {inheritedByLevel.map((g) => (
        <div key={g.level} className="space-y-2">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {g.heading}
          </span>
          {/* editable=false: these are owned elsewhere. The pills render
              dashed and their popovers explain where to change them. */}
          <TriggerGroups {...groupProps} triggers={g.items} editable={false} />
        </div>
      ))}
    </div>
  );
}
