"use client";

/**
 * A trigger on the sheet: the pill, and the popover it opens. Both read the
 * trigger the way the form is built, direction · value ("below · $868").
 * The popover is the read version: the trigger, the analyst's note, one line
 * of facts, and its actions (Edit opens the Add trigger dialog filled in;
 * Delete; or, for an inherited rule, a link to where it lives).
 * docs/plans/TRIGGER_TYPES.md §7.
 */

import { Fragment, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SendToAgentIcon } from "@/components/ui/send-to-agent-icon";
import {
  actionLabel,
  canProposeDirectly,
  conditionsOf,
  fromLegacy,
  isGroup,
  isRetired,
  measureOf,
  pillParts,
  triggerText,
  type PillPart,
} from "@/lib/agent/triggers/condition";
import { levelBadgeLabel, levelScopeLabel } from "@/lib/agent/triggers/format";
import { flooredCooldownDays } from "@/lib/agent/triggers/state-cooldown";
import { watchedFloorOnClose, type TriggerAction, type TriggerPredicate } from "@/lib/agent/triggers/types";
import type { Trigger } from "@/lib/types/thesis-sheet";
import { cn } from "@/lib/utils";
import { TriggerDialog } from "./TriggerDialog";
import { draftOf, useTriggerRequest, type Level } from "./TriggerFields";

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

/** What the pill and the popover show: the parts, the joiner, and which parts are a clock. */
function readTrigger(trigger: Trigger, held: boolean) {
  // A watched stock's floor reads the close; the pill says what the check reads.
  const shown = watchedFloorOnClose(trigger, { status: held ? "HOLDING" : "WATCHING" }).predicate as TriggerPredicate;
  const w = fromLegacy(shown);
  if (isRetired(w)) return { parts: [{ label: "a removed condition" }] as PillPart[], joiner: "and" as const, timed: [false], w: null };
  return { ...pillParts(w), timed: conditionsOf(w).map((c) => measureOf(c).timed === true), w };
}

export function TriggerPill(props: TriggerPillProps) {
  const { trigger, held, level } = props;
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const { parts, joiner, timed } = readTrigger(trigger, held);
  const draft = draftOf(trigger);
  return (
    <>
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
                {timed[i] ? <SendToAgentIcon className="size-3" /> : null}
                {p.label}
              </span>
              {p.value ? <span className="flex items-center border-l border-border px-2 text-foreground tabular-nums">{p.value}</span> : null}
            </Fragment>
          ))}
        </PopoverTrigger>
        <PopoverContent align="start" size="lg">
          <TriggerCard
            {...props}
            onEdit={
              draft
                ? () => {
                    setOpen(false);
                    setEditing(true);
                  }
                : undefined
            }
            onDone={() => setOpen(false)}
          />
        </PopoverContent>
      </Popover>
      {editing && draft ? (
        <TriggerDialog
          open
          onOpenChange={setEditing}
          type={measureOf(draft.conditions[0]).type}
          trigger={trigger}
          level={level}
          held={held}
          endpointBase={props.endpointBase}
          onChanged={props.onChanged}
        />
      ) : null}
    </>
  );
}

/** The read version: the trigger as the pill says it, why, and what happened. */
function TriggerCard({
  trigger,
  level,
  held,
  editable,
  endpointBase,
  analystId,
  onChanged,
  onEdit,
  onDone,
}: TriggerPillProps & { onEdit?: () => void; onDone: () => void }) {
  const sells = held || level !== "THESIS";
  // An inherited rule is changed where it lives, so one edit can't mean different things on different stocks.
  const canEdit = editable && !trigger.inherited;
  const { parts, joiner, w } = readTrigger(trigger, held);
  const { pending, err, send } = useTriggerRequest(() => {
    onChanged?.();
    onDone();
  });
  const home =
    trigger.level === "ANALYST" && analystId ? `/analysts/${analystId}` : trigger.level === "ACCOUNT" ? "/settings/triggers" : null;
  const overrides = trigger.overrides ? fromLegacy(trigger.overrides.predicate) : null;
  const cooldown = trigger.cooldownDays ? flooredCooldownDays(trigger, trigger.cooldownDays) : null;
  const timed = w != null && !isGroup(w) && measureOf(w).timed === true;
  const facts = [
    trigger.lastFiredAt ? `Fired ${fmtFiredAt(trigger.lastFiredAt)}` : null,
    // A schedule's rate limit is its own interval, so saying it again would repeat the number.
    cooldown && !timed ? (cooldown === 1 ? "At most once a day" : `At most once every ${cooldown} days`) : null,
    w && canProposeDirectly(w, trigger.action as TriggerAction) && sells && trigger.fireMode === "DIRECT" ? "Proposes the sale right away" : null,
  ].filter(Boolean);

  return (
    <>
      <div className="flex items-start gap-2">
        {/* The same two halves as the pill: the muted direction, then the value. */}
        <p className="min-w-0 flex-1 text-sm">
          <span className="text-muted-foreground">{actionLabel(trigger.action, sells)} </span>
          {parts.map((p, i) => (
            <Fragment key={i}>
              {i > 0 ? <span className="text-muted-foreground"> {joiner} </span> : null}
              <span className="text-muted-foreground">{p.label} </span>
              <span className="font-medium tabular-nums">{p.value}</span>
            </Fragment>
          ))}
        </p>
        {canEdit ? (
          <div className="flex shrink-0 items-center">
            {onEdit ? (
              <Button variant="ghost" size="icon-xs" aria-label="Edit trigger" disabled={pending} onClick={onEdit}>
                <Pencil />
              </Button>
            ) : null}
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Delete trigger"
              disabled={pending}
              onClick={() => void send("DELETE", `${endpointBase}/${trigger.id}`)}
            >
              <Trash2 />
            </Button>
          </div>
        ) : trigger.inherited && home ? (
          <Button
            variant="ghost"
            size="xs"
            nativeButton={false}
            render={<Link href={home} title={`${levelScopeLabel(trigger.level, null)}. A rule added on this stock overrides it.`} />}
          >
            {levelBadgeLabel(trigger.level)} rule
            <ArrowUpRight data-icon="inline-end" />
          </Button>
        ) : trigger.inherited ? (
          <span className="shrink-0 text-xs text-muted-foreground">{levelBadgeLabel(trigger.level)} rule</span>
        ) : null}
      </div>
      {w == null ? <p className="text-xs text-muted-foreground">A condition removed in August 2026. It never fires.</p> : null}
      {trigger.rationale ? <p className="text-xs text-muted-foreground">{trigger.rationale}</p> : null}
      {overrides && !isRetired(overrides) ? (
        <p className="text-xs text-muted-foreground">
          Overrides the {trigger.overrides!.level === "ACCOUNT" ? "account" : "analyst"} rule: {triggerText(trigger.action, overrides, sells)}
        </p>
      ) : null}
      {facts.length ? <p className="text-xs text-muted-foreground">{facts.join(" · ")}</p> : null}
      {err ? <p className="text-xs text-destructive">{err}</p> : null}
    </>
  );
}

function fmtFiredAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
}
