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
  /** Server-computed from the caller's role — see the GET route. */
  canEdit: boolean;
  triggers: Trigger[];
}

export function LevelTriggersSection({
  level,
  ownerId,
}: {
  level: "account" | "analyst";
  /** accountId for the account level; the AgentConfig id for an analyst. */
  ownerId: string;
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

  const editable = data.canEdit;
  const own = data.triggers.filter((t) => !t.inherited);

  // Inherited rungs on a settings page: the analyst tab shows only its
  // own rules (its account rules live one screen up), and the account
  // page is the bottom of the cascade, so this is normally empty. Kept as
  // a group rather than dropped so an unseeded account — which falls back
  // to the code constants — still shows what its holdings are running on.
  const inherited = data.triggers.filter((t) => t.inherited);

  const groupProps = {
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
              ? "No account rules. Nothing standing applies to your holdings — add a rule to protect every position."
              : "No rules for this analyst yet. Its theses run on the account rules and app defaults — see Settings → Triggers."}
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

      {level === "account" && inherited.length > 0 ? (
        <div className="space-y-2">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Built-in fallback
          </span>
          <p className="text-xs text-muted-foreground">
            This account hasn&apos;t been set up with its own rules yet, so
            its holdings are running on the built-in minimums.
          </p>
          <TriggerGroups {...groupProps} triggers={inherited} editable={false} />
        </div>
      ) : null}
    </div>
  );
}
