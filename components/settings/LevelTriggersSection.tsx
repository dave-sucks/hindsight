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

  // A settings page shows what is SET AT THAT LEVEL — nothing else.
  //
  // The merged, everything-in-force view belongs on the thesis sheet,
  // because that is where a ladder actually fires. Rendering it here too
  // meant the account page and the analyst tab both displayed the same
  // five app defaults, which reads as one rule existing at two levels at
  // once. It can't; a rung is stored in exactly one place.
  //
  // The one exception is the app defaults on the ACCOUNT page. Those are
  // account-scope constants — they apply to every analyst — so the
  // account page is their home and the only place they appear. The
  // analyst tab shows analyst rules and points at Settings for the rest.
  const appDefaults =
    level === "account"
      ? data.triggers.filter((t) => t.inherited && t.level === "DEFAULT")
      : [];

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
              ? "No account rules yet. Every holding runs on the app defaults below."
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

      {appDefaults.length > 0 ? (
        <div className="space-y-2">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            App defaults
          </span>
          <p className="text-xs text-muted-foreground">
            Built in, applied to every holding on the account. Add a rule of
            the same kind above to override one.
          </p>
          <TriggerGroups {...groupProps} triggers={appDefaults} editable={false} />
        </div>
      ) : null}
    </div>
  );
}
