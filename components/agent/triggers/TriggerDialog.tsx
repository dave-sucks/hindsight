"use client";

/**
 * Add trigger: a menu of the five types, then the dialog for the one picked.
 * Editing a trigger opens the same dialog, filled in. Every type fills the
 * same form (./TriggerFields). docs/plans/TRIGGER_TYPES.md §7.
 *
 * Until the cutover the server stores today's kinds, so the dialog builds a
 * condition and saves `toLegacy(condition)`.
 */

import { useEffect, useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  TRIGGER_TYPES,
  actionLabel,
  allowedActions,
  canProposeDirectly,
  measureOf,
  toLegacy,
  typeDef,
  whenProblem,
  type TriggerType,
} from "@/lib/agent/triggers/condition";
import type { TriggerAction } from "@/lib/agent/triggers/types";
import type { Trigger } from "@/lib/types/thesis-sheet";
import { ConditionFields, FieldLabel, OnFireSelect, TYPE_ICON, draftOf, useTriggerRequest, whenOf, type Draft, type Level } from "./TriggerFields";

interface AddProps {
  level: Level;
  /** We own the stock. Ignored at the analyst and account levels. */
  held: boolean;
  /** `/api/theses/:id/triggers` or `/api/levels/:level/:ownerId/triggers`. */
  endpointBase: string;
  onChanged?: () => void;
}

/** The menu of types. One for the first condition, and the same list for a second ("And also…"). */
function TypeMenu({
  label,
  types,
  onPick,
  variant = "outline",
}: {
  label: string;
  types: readonly TriggerType[];
  onPick: (t: TriggerType) => void;
  variant?: "outline" | "ghost";
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant={variant} size="sm" />}>
        <Plus data-icon="inline-start" />
        {label}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {types.map((t) => {
          const Icon = TYPE_ICON[t];
          return (
            <DropdownMenuItem key={t} onClick={() => onPick(t)}>
              <Icon />
              {typeDef(t).label}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** "Add trigger": pick a type, fill in its dialog. */
export function AddTrigger(props: AddProps) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<TriggerType>("price");
  return (
    <>
      <TypeMenu
        label="Add trigger"
        types={TRIGGER_TYPES.map((t) => t.id)}
        onPick={(t) => {
          setType(t);
          setOpen(true);
        }}
      />
      <TriggerDialog {...props} open={open} onOpenChange={setOpen} type={type} />
    </>
  );
}

function freshDraft(type: TriggerType, level: Level, held: boolean): Draft {
  const t = typeDef(type);
  const c = t.measures[0].fresh();
  const actions = allowedActions(c, { held, standing: level !== "THESIS" });
  const preferred: TriggerAction = t.trades ? (held || level !== "THESIS" ? "EXIT" : "ENTER") : "REVIEW";
  const action = actions.includes(preferred) ? preferred : actions[0];
  return { action, conditions: [c], match: "all", fireMode: action === "EXIT" ? "DIRECT" : "TACTICAL" };
}

/** The dialog: a new trigger of `type`, or `trigger` to change. */
export function TriggerDialog({
  open,
  onOpenChange,
  type,
  trigger,
  level,
  held,
  endpointBase,
  onChanged,
}: AddProps & { open: boolean; onOpenChange: (open: boolean) => void; type: TriggerType; trigger?: Trigger }) {
  const standing = level !== "THESIS";
  const ctx = { level, held };
  const sells = held || standing;
  const first = () => (trigger ? draftOf(trigger) : null) ?? freshDraft(type, level, held);
  const [draft, setDraft] = useState<Draft>(first);
  const { pending, err, setErr, send } = useTriggerRequest(() => {
    onChanged?.();
    onOpenChange(false);
  });

  // A fresh form each time it opens.
  useEffect(() => {
    if (!open) return;
    setDraft(first());
    setErr(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, type, trigger?.id]);

  const w = whenOf(draft);
  const actions = allowedActions(w, { held, standing });
  const action = actions.includes(draft.action) ? draft.action : (actions[0] ?? "REVIEW");
  const showOnFire = canProposeDirectly(w, action) && sells;
  const problem = whenProblem(w, ctx);
  const update = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const setCondition = (i: number, c: Draft["conditions"][number]) =>
    setDraft((d) => ({ ...d, conditions: d.conditions.map((x, j) => (j === i ? c : x)) }));

  function save() {
    const predicate = problem ? null : toLegacy(w);
    if (!predicate) return;
    const body = { action, predicate, fireMode: showOnFire ? draft.fireMode : undefined };
    if (trigger) void send("PATCH", `${endpointBase}/${trigger.id}`, { replace: body });
    else void send("POST", endpointBase, body);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{trigger ? "Edit trigger" : `Add ${typeDef(type).label.toLowerCase()} trigger`}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <FieldLabel>Action</FieldLabel>
            <Select
              value={action}
              onValueChange={(v) => typeof v === "string" && update({ action: v as TriggerAction, fireMode: v === "EXIT" ? "DIRECT" : "TACTICAL" })}
              disabled={pending}
            >
              <SelectTrigger width="full" aria-label="Action">
                <SelectValue>{actionLabel(action, sells)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {actions.map((a) => (
                  <SelectItem key={a} value={a}>
                    {actionLabel(a, sells)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <FieldLabel>Condition</FieldLabel>
            <ConditionFields condition={draft.conditions[0]} onChange={(c) => setCondition(0, c)} ctx={ctx} disabled={pending} />
          </div>

          {draft.conditions.length > 1 ? (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <Select value={draft.match} onValueChange={(v) => (v === "all" || v === "any") && update({ match: v })} disabled={pending}>
                    <SelectTrigger width="full" aria-label="Both or either">
                      <SelectValue>{draft.match === "all" ? "And: both must be true" : "Or: either one is enough"}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">And: both must be true</SelectItem>
                      <SelectItem value="any">Or: either one is enough</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button variant="ghost" size="sm" disabled={pending} onClick={() => update({ conditions: [draft.conditions[0]] })}>
                  Remove
                </Button>
              </div>
              <ConditionFields condition={draft.conditions[1]} onChange={(c) => setCondition(1, c)} ctx={ctx} disabled={pending} />
            </div>
          ) : measureOf(draft.conditions[0]).timed ? null : (
            // A schedule stands alone, so it is not offered as a second condition.
            <TypeMenu
              variant="ghost"
              label="And also…"
              types={TRIGGER_TYPES.filter((t) => !t.measures.every((m) => m.timed)).map((t) => t.id)}
              onPick={(t) => update({ conditions: [draft.conditions[0], typeDef(t).measures[0].fresh()] })}
            />
          )}

          {showOnFire ? <OnFireSelect value={draft.fireMode} onChange={(fireMode) => update({ fireMode })} disabled={pending} /> : null}
          {err ? <p className="text-xs text-destructive">{err}</p> : null}
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" disabled={pending} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" disabled={pending || problem != null} onClick={save}>
            {pending ? <Loader2 data-icon="inline-start" className="animate-spin" /> : null}
            {trigger ? "Save" : "Add"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
