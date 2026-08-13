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

  const ownCount = data.triggers.filter((t) => !t.inherited).length;

  return (
    <div className="space-y-3">
      <TriggerGroups
        triggers={data.triggers}
        // No thesis in scope. The pills only use this for the thesis-scoped
        // write endpoint, which the endpointBase below replaces.
        thesisId=""
        direction={null}
        editable={editable}
        held
        endpointBase={endpointBase}
        onChanged={() => void load()}
      />

      {ownCount === 0 ? (
        <p className="text-xs text-muted-foreground">
          {level === "account"
            ? "No account-wide rules yet — every rung above is an app default. Add one to override a default for every analyst."
            : "No rules for this analyst yet — every rung above comes from the account or the app defaults. Add one to override for this analyst only."}
        </p>
      ) : null}

      {editable ? (
        <AddTriggerDialog
          held
          endpointBase={endpointBase}
          allowAbsolutePrice={false}
          onChanged={() => void load()}
        />
      ) : null}
    </div>
  );
}
