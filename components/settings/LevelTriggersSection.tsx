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
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { Trigger } from "@/lib/types/thesis-sheet";

interface ReseedDiffResponse {
  setupName: string | null;
  known: boolean;
  toAdd: Array<{ id: string; text: string; rationale: string }>;
  present: Array<{ text: string }>;
  foreign: Array<{ text: string }>;
}

/**
 * Re-seed an analyst's rules from its signature setup's playbook template (DAV-280):
 * shows what would be added, what is already there, and what the template
 * doesn't know (kept), then adds only the missing ones.
 */
function ReseedDialog({ endpointBase, onChanged }: { endpointBase: string; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [diff, setDiff] = useState<ReseedDiffResponse | null>(null);
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setDiff(null);
    setErr(null);
    fetch(`${endpointBase}/reseed`)
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.text()) || `HTTP ${r.status}`);
        setDiff((await r.json()) as ReseedDiffResponse);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, [open, endpointBase]);
  async function apply() {
    setPending(true);
    setErr(null);
    try {
      const r = await fetch(`${endpointBase}/reseed`, { method: "POST" });
      if (!r.ok) {
        let msg = `HTTP ${r.status}`;
        try {
          const b = (await r.json()) as { error?: string };
          if (b?.error) msg = b.error;
        } catch {
          /* non-JSON */
        }
        throw new Error(msg);
      }
      setOpen(false);
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="ghost" size="sm">Re-seed from the playbook</Button>} />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Re-seed from the playbook</DialogTitle>
        </DialogHeader>
        {err ? <p className="text-xs text-destructive">{err}</p> : null}
        {!diff && !err ? <p className="text-xs text-muted-foreground">Reading the seat&apos;s rules…</p> : null}
        {diff && !diff.known ? (
          <p className="text-xs text-muted-foreground">{diff.setupName ? `The playbook has no seat rules for ${diff.setupName} yet. This analyst's rules are what you set here.` : "This analyst has no setups chosen, so there is no template to seed from. Choose its setups on the analyst page first."}</p>
        ) : null}
        {diff?.known ? (
          <div className="space-y-3 text-sm">
            <div>
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Would add</span>
              {diff.toAdd.length ? (
                <ul className="mt-1 list-disc pl-4">
                  {diff.toAdd.map((t) => (
                    <li key={t.id}>{t.text}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">Nothing — every playbook rule is already here.</p>
              )}
            </div>
            {diff.present.length ? (
              <div>
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Already set, kept as is</span>
                <ul className="mt-1 list-disc pl-4 text-muted-foreground">
                  {diff.present.map((t, i) => (
                    <li key={i}>{t.text}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {diff.foreign.length ? (
              <div>
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Yours, not in the playbook, kept</span>
                <ul className="mt-1 list-disc pl-4 text-muted-foreground">
                  {diff.foreign.map((t, i) => (
                    <li key={i}>{t.text}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={pending}>
                Cancel
              </Button>
              <Button size="sm" onClick={() => void apply()} disabled={pending || diff.toAdd.length === 0}>
                Add {diff.toAdd.length} rule{diff.toAdd.length === 1 ? "" : "s"}
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

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

  // Only this level's own rules render. The analyst tab's inherited rules
  // are the account's, edited one screen up; the account is the bottom of
  // the cascade and inherits nothing.
  const groupProps = {
    direction: null,
    held: true,
    endpointBase,
    onChanged: () => void load(),
  } as const;

  return (
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
            : "No rules for this analyst yet. Its theses run on the account rules — see Settings → Triggers."}
        </p>
      )}
      {editable ? (
        <div className="flex items-center gap-2">
          <AddTriggerDialog
            held
            endpointBase={endpointBase}
            allowAbsolutePrice={false}
            onChanged={() => void load()}
          />
          {level === "analyst" ? <ReseedDialog endpointBase={endpointBase} onChanged={() => void load()} /> : null}
        </div>
      ) : null}
    </div>
  );
}
