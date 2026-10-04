"use client";

/**
 * The trigger dialog: one form to add a trigger, change one, or read an
 * inherited analyst or account rule. The type is picked before it opens
 * (TriggerTypeButtons on the sheet). Inside, every type has the same parts:
 * tabs, a button group, one value input that takes a typed number or a
 * variable chip, and one setting. docs/plans/TRIGGER_TYPES.md §7.
 *
 * Until the cutover the server stores today's kinds, so the dialog builds a
 * condition and saves `toLegacy(condition)`.
 */

import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity,
  CalendarDays,
  DollarSign,
  FileText,
  Loader2,
  Repeat,
  SlidersHorizontal,
  Trash2,
  Variable,
  X,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { SendToAgentIcon } from "@/components/ui/send-to-agent-icon";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  TRIGGER_TYPES,
  allowedActions,
  canProposeDirectly,
  conditionProblem,
  conditionSentence,
  conditionsOf,
  fromLegacy,
  isGroup,
  isRetired,
  pillParts,
  tabOfCondition,
  toLegacy,
  triggerSentence,
  typeDef,
  typeOfCondition,
  variableDef,
  whenProblem,
  type Condition,
  type Params,
  type SettingDef,
  type TabDef,
  type TriggerType,
  type VariableDef,
  type VariableId,
  type When,
} from "@/lib/agent/triggers/condition";
import { levelBadgeLabel, levelScopeLabel } from "@/lib/agent/triggers/format";
import { flooredCooldownDays } from "@/lib/agent/triggers/state-cooldown";
import { watchedFloorOnClose, type TriggerAction, type TriggerPredicate } from "@/lib/agent/triggers/types";
import type { Trigger } from "@/lib/types/thesis-sheet";
import { cn } from "@/lib/utils";

export const TYPE_ICON: Record<TriggerType, typeof DollarSign> = {
  price: DollarSign,
  indicator: Activity,
  earnings: CalendarDays,
  filing: FileText,
  schedule: Repeat,
};

type Level = "THESIS" | "ANALYST" | "ACCOUNT";

// ── The five buttons under "Add trigger" ───────────────────────────────

/** Picking a type opens the dialog for it. The type never changes inside the dialog. */
export function TriggerTypeButtons({ onPick }: { onPick: (type: TriggerType) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Add trigger</span>
      {TRIGGER_TYPES.map((t) => {
        const Icon = TYPE_ICON[t.id];
        return (
          <Button key={t.id} variant="outline" size="sm" title={t.blurb} onClick={() => onPick(t.id)}>
            <Icon data-icon="inline-start" />
            {t.label}
          </Button>
        );
      })}
    </div>
  );
}

// ── The pill on the sheet ───────────────────────────────────────────────

/** The sentence, split into label and value, drawn the same way for every trigger. Opens the dialog. */
export function TriggerPill({ trigger, held, onOpen }: { trigger: Trigger; held: boolean; onOpen: () => void }) {
  // A watched stock's floor reads the close; the pill says what the check reads.
  const shown = watchedFloorOnClose(trigger, { status: held ? "HOLDING" : "WATCHING" }).predicate as TriggerPredicate;
  const w = fromLegacy(shown);
  const inherited = trigger.inherited ?? false;
  const { parts, joiner } = isRetired(w) ? { parts: [{ label: "a removed condition" }], joiner: "and" as const } : pillParts(w);
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "inline-flex h-7 cursor-pointer items-stretch overflow-hidden rounded-md border text-xs transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        inherited ? "border-dashed border-muted-foreground/40" : "border-border",
      )}
    >
      {parts.map((p, i) => (
        <Fragment key={i}>
          {i > 0 ? <span className="flex items-center border-l border-border px-1.5 text-muted-foreground">{joiner}</span> : null}
          <span className={cn("flex items-center gap-1 bg-muted/30 px-2 text-muted-foreground", i > 0 && "border-l border-border")}>
            {/* A schedule puts the agent on a clock: the same mark as Send to Agent. */}
            {!isRetired(w) && conditionsOf(w)[i]?.watch === "schedule" ? <SendToAgentIcon className="size-3" /> : null}
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
    </button>
  );
}

// ── The dialog ─────────────────────────────────────────────────────────

export interface TriggerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** add: a new trigger of `type`. edit: change `trigger`. view: read it (an inherited rule). */
  mode: "add" | "edit" | "view";
  type?: TriggerType;
  trigger?: Trigger | null;
  level: Level;
  /** We own the stock. Ignored at the analyst and account levels. */
  held: boolean;
  /** `/api/theses/:id/triggers` or `/api/levels/:level/:ownerId/triggers`. */
  endpointBase: string;
  analystId?: string | null;
  onChanged?: () => void;
}

interface Draft {
  action: TriggerAction;
  conditions: Condition[];
  match: "all" | "any";
  fireMode: "TACTICAL" | "DIRECT";
}

function whenOf(d: Draft): When {
  return d.conditions.length === 1 ? d.conditions[0] : { match: d.match, conditions: d.conditions };
}

/** Can the dialog edit this stored shape? One condition, or two side by side. */
function editableShape(w: When): boolean {
  return !isGroup(w) || (w.conditions.length === 2 && !w.conditions.some(isGroup));
}

function firstDraft(props: TriggerDialogProps): Draft | null {
  const standing = props.level !== "THESIS";
  if (props.mode === "add") {
    const c = typeDef(props.type ?? "price").tabs[0].fresh();
    const actions = allowedActions(c, { held: props.held, standing });
    const preferred: TriggerAction = c.watch === "price" ? (props.held || standing ? "EXIT" : "ENTER") : "REVIEW";
    const action = actions.includes(preferred) ? preferred : actions[0];
    return { action, conditions: [c], match: "all", fireMode: action === "EXIT" ? "DIRECT" : "TACTICAL" };
  }
  if (!props.trigger) return null;
  const w = fromLegacy(props.trigger.predicate);
  if (isRetired(w) || !editableShape(w)) return null;
  return {
    action: props.trigger.action as TriggerAction,
    conditions: conditionsOf(w),
    match: isGroup(w) ? w.match : "all",
    fireMode: props.trigger.fireMode ?? "TACTICAL",
  };
}

function actionLabel(a: TriggerAction, sells: boolean): string {
  switch (a) {
    case "ENTER":
      return "Buy if";
    case "ADD":
      return "Add if";
    case "TRIM":
      return "Trim if";
    case "EXIT":
      return sells ? "Sell if" : "Take the plan down if";
    default:
      return "Review if";
  }
}

export function TriggerDialog(props: TriggerDialogProps) {
  const { open, onOpenChange, mode, trigger, level, held, endpointBase, analystId, onChanged } = props;
  const standing = level !== "THESIS";
  const [draft, setDraft] = useState<Draft | null>(() => firstDraft(props));
  const [adding, setAdding] = useState(false);
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // A fresh draft each time the dialog opens on something new.
  useEffect(() => {
    if (!open) return;
    setDraft(firstDraft(props));
    setAdding(false);
    setErr(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, props.type, trigger?.id]);

  const readOnly = mode === "view";
  const ctx = { level, held };
  const w = draft ? whenOf(draft) : null;
  const actions = w ? allowedActions(w, { held, standing }) : [];
  const action = draft && actions.includes(draft.action) ? draft.action : (actions[0] ?? "REVIEW");
  const showOnFire = w != null && canProposeDirectly(w, action) && (standing || held);
  const problem = w ? whenProblem(w, ctx) : null;
  const type = w ? typeOfCondition(conditionsOf(w)[0]) : (props.type ?? "price");
  const typeLabel = typeDef(type).label;
  const sells = held || standing;

  const update = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const setCondition = (i: number, c: Condition) =>
    setDraft((d) => (d ? { ...d, conditions: d.conditions.map((x, j) => (j === i ? c : x)) } : d));

  async function send(method: "POST" | "PATCH" | "DELETE", url: string, body?: unknown) {
    setPending(true);
    setErr(null);
    try {
      const res = await fetch(url, {
        method,
        ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}),
      });
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try {
          const text = await res.text();
          try {
            msg = (JSON.parse(text) as { error?: string }).error ?? text ?? msg;
          } catch {
            msg = text || msg;
          }
        } catch {
          /* no body */
        }
        throw new Error(msg);
      }
      setPending(false);
      onChanged?.();
      onOpenChange(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setPending(false);
    }
  }

  function save() {
    if (!draft || !w || problem) return;
    const predicate = toLegacy(w);
    if (!predicate) return;
    const body = { action, predicate, fireMode: showOnFire ? draft.fireMode : undefined };
    if (mode === "add") void send("POST", endpointBase, body);
    else if (trigger) void send("PATCH", `${endpointBase}/${trigger.id}`, { replace: body });
  }

  const title = mode === "add" ? "Add trigger" : mode === "edit" ? "Edit trigger" : standing || trigger?.inherited ? "Standing rule" : "Trigger";
  const editHref =
    trigger?.level === "ANALYST" && analystId ? `/analysts/${analystId}` : trigger?.level === "ACCOUNT" ? "/settings/triggers" : null;
  const storedSentence = trigger
    ? (() => {
        const sw = fromLegacy(trigger.predicate);
        return isRetired(sw)
          ? "A condition removed in August 2026. It never fires."
          : triggerSentence(trigger.action, sw, standing ? undefined : held);
      })()
    : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {typeLabel} · {typeDef(type).blurb}
          </DialogDescription>
        </DialogHeader>

        {trigger?.inherited ? (
          <div className="space-y-2 rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
            <p>{levelScopeLabel(trigger.level, null)}. A rule set on this stock overrides it.</p>
            {editHref ? (
              <Button variant="outline" size="sm" render={<Link href={editHref} />}>
                <SlidersHorizontal data-icon="inline-start" />
                Edit in {levelBadgeLabel(trigger.level)} settings
              </Button>
            ) : null}
          </div>
        ) : null}

        {draft && w ? (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Action</span>
              <div>
                <Select
                  value={action}
                  onValueChange={(v) => typeof v === "string" && update({ action: v as TriggerAction, fireMode: v === "EXIT" ? "DIRECT" : "TACTICAL" })}
                  disabled={readOnly || pending}
                >
                  <SelectTrigger aria-label="Action">
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
            </div>

            <div className="space-y-2">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Condition</span>
              <ConditionEditor condition={draft.conditions[0]} onChange={(c) => setCondition(0, c)} disabled={readOnly || pending} ctx={ctx} />

              {draft.conditions.length > 1 ? (
                <>
                  <div className="flex items-center gap-2 pt-1 text-xs text-muted-foreground">
                    <span>Match</span>
                    <ButtonGroup>
                      {(["all", "any"] as const).map((m) => (
                        <Button
                          key={m}
                          variant={draft.match === m ? "secondary" : "outline"}
                          size="xs"
                          aria-pressed={draft.match === m}
                          disabled={readOnly || pending}
                          onClick={() => update({ match: m })}
                        >
                          {m}
                        </Button>
                      ))}
                    </ButtonGroup>
                    <span>of these</span>
                  </div>
                  <div className="space-y-2 border-t border-dashed pt-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        And also · {typeDef(typeOfCondition(draft.conditions[1])).label}
                      </span>
                      {readOnly ? null : (
                        <Button variant="ghost" size="xs" disabled={pending} onClick={() => update({ conditions: [draft.conditions[0]] })}>
                          Remove
                        </Button>
                      )}
                    </div>
                    <ConditionEditor condition={draft.conditions[1]} onChange={(c) => setCondition(1, c)} disabled={readOnly || pending} ctx={ctx} />
                  </div>
                </>
              ) : readOnly || draft.conditions[0].watch === "schedule" ? null : adding ? (
                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  <span className="text-xs text-muted-foreground">And also:</span>
                  {TRIGGER_TYPES.filter((t) => t.id !== "schedule").map((t) => {
                    const Icon = TYPE_ICON[t.id];
                    return (
                      <Button
                        key={t.id}
                        variant="outline"
                        size="xs"
                        onClick={() => {
                          update({ conditions: [draft.conditions[0], t.tabs[0].fresh()] });
                          setAdding(false);
                        }}
                      >
                        <Icon data-icon="inline-start" />
                        {t.label}
                      </Button>
                    );
                  })}
                </div>
              ) : (
                <Button variant="ghost" size="sm" onClick={() => setAdding(true)} disabled={pending}>
                  + And also…
                </Button>
              )}
            </div>

            {showOnFire ? (
              <div className="space-y-1.5">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">On fire</span>
                <div>
                  <Select
                    value={draft.fireMode}
                    onValueChange={(v) => (v === "TACTICAL" || v === "DIRECT") && update({ fireMode: v })}
                    disabled={readOnly || pending}
                  >
                    <SelectTrigger aria-label="On fire">
                      <SelectValue>{draft.fireMode === "DIRECT" ? "Propose the sale right away" : "Ask the analyst first"}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="TACTICAL">Ask the analyst first</SelectItem>
                      <SelectItem value="DIRECT">Propose the sale right away</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <p className="text-xs text-muted-foreground">Either way it is a proposal you approve.</p>
              </div>
            ) : null}

            <p className="text-sm text-muted-foreground">
              {action === "ENTER"
                ? "A buy fires once, when the condition turns true, and waits if the quote is stale."
                : "Asks every day it stays true. Declining a proposal means “not today”."}
            </p>
            <p className="text-sm font-medium">{problem ? "Finish the condition to finish the sentence." : triggerSentence(action, w, sells ? undefined : false)}</p>
          </div>
        ) : (
          <p className="text-sm">{storedSentence}</p>
        )}

        {trigger ? <TriggerFacts trigger={trigger} /> : null}
        {err ? <p className="text-xs text-destructive">{err}</p> : null}

        <DialogFooter>
          {mode === "edit" && trigger ? (
            <Button variant="destructive" size="sm" disabled={pending} onClick={() => void send("DELETE", `${endpointBase}/${trigger.id}`)}>
              <Trash2 data-icon="inline-start" />
              Delete
            </Button>
          ) : null}
          <Button variant="ghost" size="sm" disabled={pending} onClick={() => onOpenChange(false)}>
            {readOnly || !draft ? "Close" : "Cancel"}
          </Button>
          {readOnly || !draft ? null : (
            <Button size="sm" disabled={pending || problem != null} onClick={save}>
              {pending ? <Loader2 data-icon="inline-start" className="animate-spin" /> : null}
              {mode === "add" ? "Add" : "Save"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** What the analyst wrote, what it overrides, when it last fired. */
function TriggerFacts({ trigger }: { trigger: Trigger }) {
  const overrides = trigger.overrides ? fromLegacy(trigger.overrides.predicate) : null;
  const cooldown = trigger.cooldownDays ? flooredCooldownDays(trigger, trigger.cooldownDays) : null;
  const isClock = trigger.predicate.kind === "REVIEW_CADENCE";
  const facts = [
    trigger.rationale ? trigger.rationale : null,
    overrides && !isRetired(overrides)
      ? `Overrides the ${trigger.overrides!.level === "ACCOUNT" ? "account" : "analyst"} rule: ${triggerSentence(trigger.action, overrides).toLowerCase()}`
      : null,
    trigger.lastFiredAt ? `Fired ${fmtFiredAt(trigger.lastFiredAt)}.` : null,
    cooldown && !isClock ? (cooldown === 1 ? "Fires at most once a day." : `Fires at most once every ${cooldown} days.`) : null,
  ].filter((f): f is string => !!f);
  if (facts.length === 0) return null;
  return (
    <div className="space-y-1 text-xs text-muted-foreground">
      {facts.map((f, i) => (
        <p key={i}>{f}</p>
      ))}
    </div>
  );
}

function fmtFiredAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
}

// ── One condition: tabs · buttons · value · setting ─────────────────────

function ConditionEditor({
  condition,
  onChange,
  disabled,
  ctx,
}: {
  condition: Condition;
  onChange: (c: Condition) => void;
  disabled: boolean;
  ctx: { level: Level; held: boolean };
}) {
  const tab = tabOfCondition(condition);
  const type = typeDef(typeOfCondition(condition));
  const problem = conditionProblem(condition, ctx);
  const setting = tab.setting && (!tab.setting.when || tab.setting.when(condition)) ? tab.setting : null;
  return (
    <div className="space-y-2">
      {type.tabs.length > 1 ? (
        <Tabs
          value={tab.id}
          onValueChange={(id) => {
            const next = type.tabs.find((t) => t.id === id);
            if (next && next.id !== tab.id) onChange(next.fresh());
          }}
        >
          <TabsList>
            {type.tabs.map((t) => (
              <TabsTrigger key={t.id} value={t.id} disabled={disabled}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <ButtonGroup>
          {tab.buttons.map((b) => (
            <Button
              key={b.is}
              variant={condition.is === b.is ? "secondary" : "outline"}
              size="sm"
              aria-pressed={condition.is === b.is}
              disabled={disabled}
              onClick={() => onChange({ ...condition, is: b.is })}
            >
              {b.label}
            </Button>
          ))}
        </ButtonGroup>
        <div className="min-w-0 flex-1 basis-52">
          <ValueInput condition={condition} tab={tab} onChange={onChange} disabled={disabled} />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{problem ?? `${capitalise(conditionSentence(condition))}.`}</p>
      {setting ? <SettingSelect condition={condition} setting={setting} onChange={onChange} disabled={disabled} /> : null}
    </div>
  );
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function settingValue(c: Condition, key: keyof Params): string {
  const p = c.params ?? {};
  switch (key) {
    case "onClose":
      return String(p.onClose === true);
    case "period":
      return String(p.period ?? 14);
    case "window":
      return p.window ?? "3M";
    case "fromDay":
      return String(p.fromDay ?? 0);
    case "days":
      return String(p.days ?? 30);
    case "every":
      return p.every ?? "days";
    default:
      return "";
  }
}

function withSetting(c: Condition, key: keyof Params, v: string): Condition {
  const params: Params = { ...(c.params ?? {}) };
  if (key === "onClose") {
    if (v === "true") params.onClose = true;
    else delete params.onClose;
  } else if (key === "period") params.period = v === "2" ? 2 : 14;
  else if (key === "window") params.window = v as Params["window"];
  else if (key === "fromDay") params.fromDay = Number(v);
  else if (key === "days") params.days = Number(v);
  else if (key === "every") params.every = v as Params["every"];
  return { ...c, params };
}

function SettingSelect({
  condition,
  setting,
  onChange,
  disabled,
}: {
  condition: Condition;
  setting: SettingDef;
  onChange: (c: Condition) => void;
  disabled: boolean;
}) {
  const value = settingValue(condition, setting.key);
  return (
    <div>
      <Select value={value} onValueChange={(v) => typeof v === "string" && onChange(withSetting(condition, setting.key, v))} disabled={disabled}>
        <SelectTrigger aria-label="When it is checked">
          <SelectValue>{setting.options.find((o) => o.value === value)?.label ?? value}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {setting.options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

// ── The value input: a typed number, or a variable chip ─────────────────

function ValueInput({
  condition,
  tab,
  onChange,
  disabled,
}: {
  condition: Condition;
  tab: TabDef;
  onChange: (c: Condition) => void;
  disabled: boolean;
}) {
  const v = tab.value;
  const [text, setText] = useState(condition.value != null ? String(condition.value) : "");
  // Follow a value changed from outside (a tab switch, a reopened dialog) without fighting typing.
  useEffect(() => {
    const typed = text.trim() === "" ? undefined : Number(text);
    if (typed !== condition.value) setText(condition.value != null ? String(condition.value) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [condition.value]);

  const variables = tab.variables;
  const replaced = variables?.mode === "replace" && condition.variable != null;
  const pick = (id: VariableId) => onChange({ ...condition, variable: id });
  const clear = () => onChange({ ...condition, variable: undefined });

  return (
    <InputGroup>
      {v.prefix && !replaced ? (
        <InputGroupAddon>
          <InputGroupText>{v.prefix}</InputGroupText>
        </InputGroupAddon>
      ) : null}
      {replaced && condition.variable ? (
        <InputGroupAddon>
          <VariableChip id={condition.variable} onRemove={disabled ? undefined : clear} />
        </InputGroupAddon>
      ) : null}
      {v.none && !condition.variable ? (
        <InputGroupAddon>
          <InputGroupText>{v.placeholder}</InputGroupText>
        </InputGroupAddon>
      ) : null}
      {!v.none && !replaced ? (
        <InputGroupInput
          type="number"
          inputMode="decimal"
          step={v.integer ? 1 : "any"}
          min={v.allowNegative ? undefined : (v.min ?? 0)}
          max={v.max}
          value={text}
          placeholder={v.placeholder}
          aria-label="Value"
          disabled={disabled}
          onChange={(e) => {
            setText(e.target.value);
            const n = e.target.value.trim() === "" ? undefined : Number(e.target.value);
            onChange({ ...condition, value: n != null && Number.isFinite(n) ? n : undefined });
          }}
        />
      ) : (
        // Keeps the addons where they belong when there is no number to type.
        <span className="flex-1" />
      )}
      {v.unitPicker ? (
        <InputGroupAddon align="inline-end">
          <Select
            value={condition.params?.every ?? "days"}
            onValueChange={(u) => typeof u === "string" && onChange(withSetting(condition, "every", u))}
            disabled={disabled}
          >
            <SelectTrigger size="sm" variant="ghost" aria-label="Unit">
              <SelectValue>{condition.params?.every ?? "days"}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {(["days", "weeks", "months"] as const).map((u) => (
                <SelectItem key={u} value={u}>
                  {u}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </InputGroupAddon>
      ) : null}
      {v.suffix && !replaced ? (
        <InputGroupAddon align="inline-end">
          <InputGroupText>{v.suffix}</InputGroupText>
        </InputGroupAddon>
      ) : null}
      {variables?.mode === "from" ? (
        <InputGroupAddon align="inline-end">
          <InputGroupText>{variables.word ? variables.word(condition) : "from"}</InputGroupText>
          {condition.variable ? <VariableChip id={condition.variable} onRemove={disabled ? undefined : clear} /> : null}
        </InputGroupAddon>
      ) : null}
      {variables && !disabled ? (
        <InputGroupAddon align="inline-end">
          <VariableMenu options={variables.options} title={variables.title} onPick={pick} />
        </InputGroupAddon>
      ) : null}
    </InputGroup>
  );
}

function VariableChip({ id, onRemove }: { id: VariableId; onRemove?: () => void }) {
  const def = variableDef(id);
  return (
    <Badge variant="variable" shape="rounded">
      <Variable data-icon="inline-start" />
      {def.chip}
      {onRemove ? (
        <button type="button" aria-label={`Remove ${def.chip}`} onClick={onRemove} className="ml-0.5 inline-flex rounded-sm hover:opacity-70">
          <X className="size-3" />
        </button>
      ) : null}
    </Badge>
  );
}

/** The {x} button inside the value input: a short list of variables, grouped, searchable. */
function VariableMenu({ options, title, onPick }: { options: readonly VariableDef[]; title: string; onPick: (id: VariableId) => void }) {
  const [open, setOpen] = useState(false);
  const groups = useMemo(() => {
    const out = new Map<string, VariableDef[]>();
    for (const o of options) out.set(o.group, [...(out.get(o.group) ?? []), o]);
    return [...out];
  }, [options]);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<InputGroupButton size="icon-xs" aria-label={title} title={title} />}>
        <Variable />
      </PopoverTrigger>
      <PopoverContent align="end">
        <Command>
          <CommandInput placeholder={title} />
          <CommandList>
            <CommandEmpty>Nothing matches.</CommandEmpty>
            {groups.map(([group, items]) => (
              <CommandGroup key={group} heading={group}>
                {items.map((o) => (
                  <CommandItem
                    key={o.id}
                    value={o.label}
                    onSelect={() => {
                      onPick(o.id);
                      setOpen(false);
                    }}
                  >
                    {o.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
