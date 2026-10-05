"use client";

/**
 * A trigger on the sheet: the pill, and the popover it opens. The popover is
 * the same form as the Add trigger dialog (./TriggerFields) without the tabs:
 * the stock's own trigger can be changed or deleted there; an inherited
 * analyst or account rule reads the same, locked, with a link to where it
 * lives. docs/plans/TRIGGER_TYPES.md §7.
 */

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { Loader2, SlidersHorizontal, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SendToAgentIcon } from "@/components/ui/send-to-agent-icon";
import {
  canProposeDirectly,
  conditionsOf,
  fromLegacy,
  isGroup,
  isRetired,
  measureOf,
  pillParts,
  toLegacy,
  triggerSentence,
  whenProblem,
} from "@/lib/agent/triggers/condition";
import { levelBadgeLabel, levelScopeLabel } from "@/lib/agent/triggers/format";
import { flooredCooldownDays } from "@/lib/agent/triggers/state-cooldown";
import { watchedFloorOnClose, type TriggerPredicate } from "@/lib/agent/triggers/types";
import type { Trigger } from "@/lib/types/thesis-sheet";
import { cn } from "@/lib/utils";
import { ConditionFields, OnFireSelect, TYPE_ICON, actionLabel, draftOf, useTriggerRequest, whenOf, type Level } from "./TriggerFields";

export interface TriggerPillProps {
  trigger: Trigger;
  /** The level of the page the pill is on: the stock's sheet, an analyst, the account. */
  level: Level;
  held: boolean;
  /** The page lets this level's own triggers be changed. */
  editable: boolean;
  endpointBase: string;
  analystId?: string | null;
  onChanged?: () => void;
}

export function TriggerPill(props: TriggerPillProps) {
  const { trigger, held } = props;
  const [open, setOpen] = useState(false);
  // A watched stock's floor reads the close; the pill says what the check reads.
  const shown = watchedFloorOnClose(trigger, { status: held ? "HOLDING" : "WATCHING" }).predicate as TriggerPredicate;
  const w = fromLegacy(shown);
  const { parts, joiner } = isRetired(w) ? { parts: [{ label: "a removed condition" }], joiner: "and" as const } : pillParts(w);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            className={cn(
              "inline-flex h-7 cursor-pointer items-stretch overflow-hidden rounded-md border text-xs transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              trigger.inherited ? "border-dashed border-muted-foreground/40" : "border-border",
            )}
          />
        }
      >
        {parts.map((p, i) => (
          <Fragment key={i}>
            {i > 0 ? <span className="flex items-center border-l border-border px-1.5 text-muted-foreground">{joiner}</span> : null}
            <span className={cn("flex items-center gap-1 bg-muted/30 px-2 text-muted-foreground", i > 0 && "border-l border-border")}>
              {/* A schedule puts the agent on a clock: the same mark as Send to Agent. */}
              {!isRetired(w) && conditionsOf(w)[i] && measureOf(conditionsOf(w)[i]).timed ? <SendToAgentIcon className="size-3" /> : null}
              {p.label}
            </span>
            {p.value || p.chip ? (
              <span className="flex items-center border-l border-border px-2 text-foreground tabular-nums">
                {p.chip ? (
                  <Badge variant="variable" shape="rounded">
                    {p.chip}
                  </Badge>
                ) : (
                  p.value
                )}
              </span>
            ) : null}
          </Fragment>
        ))}
      </PopoverTrigger>
      <PopoverContent align="start" size="lg">
        <TriggerPopover {...props} onDone={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}

/** Mounted each time the popover opens, so it starts from the stored trigger. */
function TriggerPopover({ trigger, level, held, editable, endpointBase, analystId, onChanged, onDone }: TriggerPillProps & { onDone: () => void }) {
  const ctx = { level, held };
  const sells = held || level !== "THESIS";
  // An inherited rule is changed where it lives, so one edit can't silently
  // mean different things on different stocks.
  const canEdit = editable && !trigger.inherited;
  const initial = useMemo(() => draftOf(trigger), [trigger]);
  const [draft, setDraft] = useState(initial);
  const { pending, err, send } = useTriggerRequest(() => {
    onChanged?.();
    onDone();
  });
  const url = `${endpointBase}/${trigger.id}`;
  const first = draft ? draft.conditions[0] : null;
  const Icon = first ? TYPE_ICON[measureOf(first).type] : null;

  const header = (
    <div className="flex items-center gap-1.5">
      {Icon ? <Icon className="size-3.5 text-muted-foreground" /> : null}
      <span className="font-medium">{actionLabel(trigger.action, sells)}</span>
      {first ? <span className="text-muted-foreground">· {measureOf(first).label}</span> : null}
      {canEdit ? (
        <div className="ml-auto">
          <Button variant="ghost" size="icon-xs" aria-label="Delete trigger" disabled={pending} onClick={() => void send("DELETE", url)}>
            <Trash2 />
          </Button>
        </div>
      ) : null}
    </div>
  );

  if (!draft || !initial) {
    const stored = fromLegacy(trigger.predicate);
    return (
      <>
        {header}
        <p>
          {isRetired(stored) ? "A condition removed in August 2026. It never fires." : triggerSentence(trigger.action, stored, sells ? undefined : false)}
        </p>
        <TriggerFacts trigger={trigger} analystId={analystId} />
        {err ? <p className="text-xs text-destructive">{err}</p> : null}
      </>
    );
  }

  const w = whenOf(draft);
  const problem = whenProblem(w, ctx);
  const showOnFire = canProposeDirectly(w, draft.action) && sells;
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const setCondition = (i: number, c: (typeof draft.conditions)[number]) =>
    setDraft((d) => (d ? { ...d, conditions: d.conditions.map((x, j) => (j === i ? c : x)) } : d));

  function save() {
    const predicate = draft && !problem ? toLegacy(w) : null;
    if (!draft || !predicate) return;
    void send("PATCH", url, { replace: { action: draft.action, predicate, fireMode: showOnFire ? draft.fireMode : undefined } });
  }

  return (
    <>
      {header}
      {draft.conditions.map((c, i) => (
        <Fragment key={i}>
          {i > 0 ? (
            <p className="text-xs text-muted-foreground">
              {draft.match === "all" ? "and" : "or"} · {measureOf(c).label}
            </p>
          ) : null}
          <ConditionFields condition={c} onChange={(n) => setCondition(i, n)} ctx={ctx} disabled={!canEdit || pending} />
        </Fragment>
      ))}
      {showOnFire ? (
        <OnFireSelect value={draft.fireMode} onChange={(fireMode) => setDraft({ ...draft, fireMode })} disabled={!canEdit || pending} />
      ) : null}
      <TriggerFacts trigger={trigger} analystId={analystId} />
      {err ? <p className="text-xs text-destructive">{err}</p> : null}
      {dirty ? (
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" disabled={pending} onClick={() => setDraft(initial)}>
            Cancel
          </Button>
          <Button size="sm" disabled={pending || problem != null} onClick={save}>
            {pending ? <Loader2 data-icon="inline-start" className="animate-spin" /> : null}
            Save
          </Button>
        </div>
      ) : null}
    </>
  );
}

/** Why it's there, what it overrides, when it last fired, and where an inherited rule is edited. */
function TriggerFacts({ trigger, analystId }: { trigger: Trigger; analystId?: string | null }) {
  const overrides = trigger.overrides ? fromLegacy(trigger.overrides.predicate) : null;
  const cooldown = trigger.cooldownDays ? flooredCooldownDays(trigger, trigger.cooldownDays) : null;
  const stored = fromLegacy(trigger.predicate);
  const timed = !isRetired(stored) && !isGroup(stored) && measureOf(stored).timed;
  const facts = [
    trigger.rationale || null,
    overrides && !isRetired(overrides)
      ? `Overrides the ${trigger.overrides!.level === "ACCOUNT" ? "account" : "analyst"} rule: ${triggerSentence(trigger.action, overrides).toLowerCase()}`
      : null,
    [
      trigger.lastFiredAt ? `Fired ${fmtFiredAt(trigger.lastFiredAt)}.` : null,
      // A schedule's rate limit is its own interval, so saying it again would repeat the number above.
      cooldown && !timed
        ? cooldown === 1
          ? "Fires at most once a day."
          : `Fires at most once every ${cooldown} days.`
        : null,
    ]
      .filter(Boolean)
      .join(" ") || null,
  ].filter((f): f is string => !!f);
  const editHref =
    trigger.level === "ANALYST" && analystId ? `/analysts/${analystId}` : trigger.level === "ACCOUNT" ? "/settings/triggers" : null;
  return (
    <>
      {facts.map((f, i) => (
        <p key={i} className="text-xs text-muted-foreground">
          {f}
        </p>
      ))}
      {trigger.inherited ? (
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">{levelScopeLabel(trigger.level, null)}. A rule set on this stock overrides it.</p>
          {editHref ? (
            <Button variant="outline" size="sm" nativeButton={false} render={<Link href={editHref} />}>
              <SlidersHorizontal data-icon="inline-start" />
              Edit in {levelBadgeLabel(trigger.level)} settings
            </Button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

function fmtFiredAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
}
