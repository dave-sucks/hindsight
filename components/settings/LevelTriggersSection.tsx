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
 *   • Rules are grouped by horizon (DAV-250). A trade and a compounder
 *     inherit different sell rules from the same account; each group has
 *     its own Add button, which stamps that group's horizon on the rule.
 */

import { useCallback, useEffect, useState } from "react";
import {
  TriggerGroups,
  AddTriggerDialog,
} from "@/components/agent/sheets/ThesisTriggersSection";
import type { Trigger } from "@/lib/types/thesis-sheet";

/**
 * The groups rules are edited in. `horizons` is what a rule added from the
 * group is saved with; "Every horizon" saves none.
 */
const HORIZON_GROUPS: ReadonlyArray<{ key: string; label: string; horizons?: string[] }> = [
  { key: "", label: "Every horizon" },
  { key: "TRADE", label: "Trade", horizons: ["TRADE"] },
  { key: "TARGET", label: "Target", horizons: ["TARGET"] },
  { key: "CATALYST", label: "Catalyst", horizons: ["CATALYST"] },
  { key: "COMPOUNDER", label: "Compounder", horizons: ["COMPOUNDER"] },
];

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
  const scopeKey = (t: Trigger) => (t.horizons?.length ? [...t.horizons].sort().join(",") : "");
  // Every standard group always renders (so each has its Add button); a
  // rule saved for several horizons at once gets a group of its own.
  const extraKeys = Array.from(new Set(own.map(scopeKey))).filter(
    (k) => !HORIZON_GROUPS.some((g) => g.key === k),
  );
  const groups = [
    ...HORIZON_GROUPS,
    ...extraKeys.map((k) => ({
      key: k,
      label: k.split(",").map((h) => h.charAt(0) + h.slice(1).toLowerCase()).join(" + "),
      horizons: k.split(","),
    })),
  ];

  // Only this level's own rules render. The analyst tab's inherited rules
  // are the account's, edited one screen up; the account is the bottom of
  // the cascade and inherits nothing (the code defaults stopped being a
  // runtime level on 2026-08-16).
  const groupProps = {
    direction: null,
    held: true,
    endpointBase,
    onChanged: () => void load(),
  } as const;

  return (
    <div className="space-y-4">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {level === "account" ? "Set on this account" : "Set on this analyst"}
      </span>
      {own.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {level === "account"
            ? "No account rules. Nothing standing applies to your holdings — add a rule to protect every position."
            : "No rules for this analyst yet. Its theses run on the account rules — see Settings → Triggers."}
        </p>
      ) : null}
      {groups.map((g) => {
        const rules = own.filter((t) => scopeKey(t) === g.key);
        if (rules.length === 0 && !editable) return null;
        return (
          <div key={g.key || "every"} className="space-y-2">
            <span className="text-xs font-medium text-muted-foreground">{g.label}</span>
            {rules.length > 0 ? (
              <TriggerGroups {...groupProps} triggers={rules} editable={editable} />
            ) : null}
            {editable ? (
              <AddTriggerDialog
                held
                endpointBase={endpointBase}
                allowAbsolutePrice={false}
                horizons={g.horizons}
                onChanged={() => void load()}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
