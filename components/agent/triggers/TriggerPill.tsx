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
  conditionsOf,
  shapeOf,
  isGroup,
  measureOf,
  pillParts,
  triggerLabel,
  triggerText,
  trimPctOf,
  firedSinceFalseClose,
  firesAgainWords,
  type PillPart,
} from "@/lib/agent/triggers/condition";
import { levelBadgeLabel, levelScopeLabel } from "@/lib/agent/triggers/format";
import { fireModeWords } from "@/lib/agent/triggers/fire-mode";
import type { Trigger } from "@/lib/types/thesis-sheet";
import { cn } from "@/lib/utils";
import { TriggerDialog } from "./TriggerDialog";
import { draftOf, useTriggerRequest, type Level } from "./TriggerFields";
import type { When } from "@/lib/agent/triggers/condition";

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
  /** The sheet has no Street row for the stock: a rule on a Street variable can't fire, and the popover says so. */
  streetMissing?: boolean;
}

/** What the pill and the popover show: the parts, and which parts are a clock. `short` is the pill's own. */
function readTrigger(trigger: Trigger, short = false) {
  const w = shapeOf(trigger.predicate);
  if (!w) return { parts: [{ label: "a removed condition" }] as PillPart[], timed: [false], w: null };
  return { parts: pillParts(w, short), timed: conditionsOf(w).map((c) => measureOf(c).timed === true), w };
}

export function TriggerPill(props: TriggerPillProps) {
  const { trigger, held, level } = props;
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const { parts, timed } = readTrigger(trigger, true);
  const draft = draftOf(trigger);
  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <button
              type="button"
              className={cn(
                "inline-flex max-w-full min-w-0 cursor-pointer overflow-hidden rounded-md border text-xs transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                trigger.inherited ? "border-dashed border-muted-foreground/40" : "border-border",
              )}
            />
          }
        >
          {/* One line when it fits. A combination that doesn't breaks between its conditions, never inside one:
              each condition is one unbroken unit that fills its row, and the pill clips the lines at a row's start and top. */}
          <span className="-ml-px -mt-px flex min-w-0 grow flex-wrap">
            {/* A trim's size leads, so the row reads "Trim 30% if above $150". */}
            {trigger.action === "TRIM" ? (
              <span className="flex h-[27px] grow items-center gap-1 border-l border-t border-border px-2 whitespace-nowrap text-foreground tabular-nums">
                {trimPctOf(trigger)}%<span className="text-muted-foreground">if</span>
              </span>
            ) : null}
            {parts.map((p, i) => (
              <span key={i} className="flex h-[27px] min-w-0 max-w-full grow items-stretch border-l border-t border-border whitespace-nowrap">
                {i > 0 ? <span className="flex items-center border-r border-border px-1.5 text-muted-foreground">and</span> : null}
                <span className="flex items-center gap-1 bg-muted/30 px-2 text-muted-foreground">
                  {/* A schedule puts the agent on a clock: the same mark as Send to Agent. */}
                  {timed[i] ? <SendToAgentIcon className="size-3" /> : null}
                  {p.label}
                </span>
                {p.value ? (
                  <span className="flex min-w-0 grow items-center border-l border-border px-2 text-foreground tabular-nums">
                    <span className="truncate">{p.value}</span>
                  </span>
                ) : null}
              </span>
            ))}
          </span>
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
  streetMissing,
  onEdit,
  onDone,
}: TriggerPillProps & { onEdit?: () => void; onDone: () => void }) {
  // An inherited rule is changed where it lives, so one edit can't mean different things on different stocks.
  const canEdit = editable && !trigger.inherited;
  const { parts, w } = readTrigger(trigger);
  const { pending, err, send } = useTriggerRequest(() => {
    onChanged?.();
    onDone();
  });
  const home =
    trigger.level === "ANALYST" && analystId ? `/analysts/${analystId}` : trigger.level === "ACCOUNT" ? "/settings/triggers" : null;
  const overrides = trigger.overrides ? shapeOf(trigger.overrides.predicate) : null;

  const readsStreet = w != null && conditionsOf(w).some((c) => c.variable?.startsWith("street_") === true);
  const facts = [
    readsStreet && streetMissing ? "No Street data: this can't fire until a Street row arrives" : null,
    trigger.lastFiredAt ? `Fired ${fmtFiredAt(trigger.lastFiredAt)}` : null,
    // Fired and still true at every close since: when it can fire again.
    firedSinceFalseClose(trigger) ? `fires again ${firesAgainWords(trigger)}` : null,
    fireModeWords(trigger),
  ].filter(Boolean);

  return (
    <>
      <div className="flex items-start gap-2">
        {/* The same two halves as the pill: the muted direction, then the value. */}
        <p className="min-w-0 flex-1 text-sm">
          <span className="text-muted-foreground">{triggerLabel(trigger)} </span>
          {parts.map((p, i) => (
            <Fragment key={i}>
              {i > 0 ? <span className="text-muted-foreground"> and </span> : null}
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
      {overrides ? (
        <p className="text-xs text-muted-foreground">
          Overrides the {trigger.overrides!.level === "ACCOUNT" ? "account" : "analyst"} rule: {triggerText(trigger.action, overrides)}
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
