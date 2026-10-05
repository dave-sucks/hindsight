"use client";

/**
 * The trigger form's parts, shared by the Add trigger dialog and the pill's
 * popover. A condition is the same fields for every type, drawn from the
 * catalog (lib/agent/triggers/condition/catalog.ts):
 *
 *   tabs · setting · [ buttons ][ value: a number or a variable chip   {x} ]
 *   one line: what fires, or what to fix
 *
 * docs/plans/TRIGGER_TYPES.md §7.
 */

import { useEffect, useMemo, useState } from "react";
import { Activity, CalendarDays, DollarSign, FileText, Repeat, Variable, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  conditionProblem,
  conditionsOf,
  fireLine,
  fromLegacy,
  isGroup,
  isRetired,
  measureOf,
  settingDefs,
  settingOf,
  typeDef,
  variableDef,
  variableOptions,
  withDirection,
  withSetting,
  withVariable,
  type CheckContext,
  type Condition,
  type SettingDef,
  type TriggerType,
  type VariableDef,
  type VariableId,
  type When,
} from "@/lib/agent/triggers/condition";
import type { TriggerAction } from "@/lib/agent/triggers/types";
import type { Trigger } from "@/lib/types/thesis-sheet";

export type Level = CheckContext["level"];

export const TYPE_ICON: Record<TriggerType, typeof DollarSign> = {
  price: DollarSign,
  indicator: Activity,
  earnings: CalendarDays,
  filing: FileText,
  schedule: Repeat,
};

/** What the form edits: the action, one condition or two, and how a sale fires. */
export interface Draft {
  action: TriggerAction;
  conditions: Condition[];
  match: "all" | "any";
  fireMode: "TACTICAL" | "DIRECT";
}

export function whenOf(d: Draft): When {
  return d.conditions.length === 1 ? d.conditions[0] : { match: d.match, conditions: d.conditions };
}

/** A stored trigger as a draft, or null when the form can't show it (a removed kind, or more than two conditions). */
export function draftOf(t: Trigger): Draft | null {
  const w = fromLegacy(t.predicate);
  if (isRetired(w) || (isGroup(w) && (w.conditions.length !== 2 || w.conditions.some(isGroup)))) return null;
  return {
    action: t.action as TriggerAction,
    conditions: conditionsOf(w),
    match: isGroup(w) ? w.match : "all",
    fireMode: t.fireMode ?? "TACTICAL",
  };
}

export function actionLabel(a: TriggerAction | string, sells: boolean): string {
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

export function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{children}</span>;
}

/** POST / PATCH / DELETE against the trigger routes, with the server's refusal as the error. */
export function useTriggerRequest(onDone: () => void) {
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function send(method: "POST" | "PATCH" | "DELETE", url: string, body?: unknown) {
    setPending(true);
    setErr(null);
    try {
      const res = await fetch(url, {
        method,
        ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        let msg = text || `HTTP ${res.status}`;
        try {
          msg = (JSON.parse(text) as { error?: string }).error ?? msg;
        } catch {
          /* plain text */
        }
        throw new Error(msg);
      }
      setPending(false);
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setPending(false);
    }
  }
  return { pending, err, setErr, send };
}

/** How a sale fires. Shown only for a sale nothing needs judging on. */
export function OnFireSelect({
  value,
  onChange,
  disabled,
}: {
  value: Draft["fireMode"];
  onChange: (v: Draft["fireMode"]) => void;
  disabled: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <FieldLabel>On fire</FieldLabel>
      <Select value={value} onValueChange={(v) => (v === "TACTICAL" || v === "DIRECT") && onChange(v)} disabled={disabled}>
        <SelectTrigger width="full" aria-label="On fire">
          <SelectValue>{value === "DIRECT" ? "Propose the sale right away" : "Ask the analyst first"}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="TACTICAL">Ask the analyst first</SelectItem>
          <SelectItem value="DIRECT">Propose the sale right away</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

// ── One condition ───────────────────────────────────────────────────────

export function ConditionFields({
  condition,
  onChange,
  ctx,
  disabled,
  tabs = false,
}: {
  condition: Condition;
  onChange: (c: Condition) => void;
  ctx: CheckContext;
  disabled: boolean;
  /** The dialog shows the type's tabs; the popover keeps the one the trigger has. */
  tabs?: boolean;
}) {
  const m = measureOf(condition);
  const type = typeDef(m.type);
  // A read-only rule says what it does; only a form being filled in says what to fix.
  const problem = disabled ? null : conditionProblem(condition, ctx);
  return (
    <div className="space-y-2">
      {tabs && type.measures.length > 1 ? (
        <Tabs
          value={m.id}
          onValueChange={(id) => {
            const next = type.measures.find((t) => t.id === id);
            if (next && next.id !== m.id) onChange(next.fresh());
          }}
        >
          <TabsList width="full">
            {type.measures.map((t) => (
              <TabsTrigger key={t.id} value={t.id} disabled={disabled}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      ) : null}
      {settingDefs(condition)
        .filter((s) => s.options)
        .map((s) => (
          <SettingSelect key={s.key} condition={condition} setting={s} onChange={onChange} disabled={disabled} />
        ))}
      {/* The buttons on the left, the input on the right; the input drops below them when the box is too narrow. */}
      <div className="flex flex-wrap gap-2">
        {m.buttons && m.buttons.length > 1 ? (
          <ButtonGroup>
            {m.buttons.map((b) => (
              <Button
                key={b.is}
                variant={condition.is === b.is ? "secondary" : "outline"}
                aria-pressed={condition.is === b.is}
                disabled={disabled}
                onClick={() => onChange(withDirection(condition, b.is, ctx))}
              >
                {b.label}
              </Button>
            ))}
          </ButtonGroup>
        ) : null}
        <div className="min-w-fit flex-1">
          <ValueInput condition={condition} onChange={onChange} ctx={ctx} disabled={disabled} />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{problem ?? fireLine(condition)}</p>
    </div>
  );
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
  const options = setting.options ?? [];
  const value = String(settingOf(condition, setting.key));
  return (
    <Select
      value={value}
      onValueChange={(v) => {
        const picked = options.find((o) => String(o.value) === v);
        if (picked) onChange(withSetting(condition, setting.key, picked.value));
      }}
      disabled={disabled}
    >
      <SelectTrigger width="full" aria-label={setting.label}>
        <SelectValue>{options.find((o) => String(o.value) === value)?.label ?? value}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={String(o.value)} value={String(o.value)}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ── The value input: a typed number, or a variable chip ─────────────────

function ValueInput({
  condition,
  onChange,
  ctx,
  disabled,
}: {
  condition: Condition;
  onChange: (c: Condition) => void;
  ctx: CheckContext;
  disabled: boolean;
}) {
  const m = measureOf(condition);
  const v = m.value;
  const vars = m.variables;
  const options = disabled ? [] : variableOptions(condition, ctx);
  const [text, setText] = useState(condition.value != null ? String(condition.value) : "");
  // Follow a value changed from outside (a tab switch, a reset) without fighting typing.
  useEffect(() => {
    const typed = text.trim() === "" ? undefined : Number(text);
    if (typed !== condition.value) setText(condition.value != null ? String(condition.value) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [condition.value]);

  const replaced = vars?.mode === "replace" && condition.variable != null;
  const clear = disabled ? undefined : () => onChange(withVariable(condition, undefined));

  return (
    <InputGroup>
      {/* A measure with one choice says it as a word: "Every", "At least", "Files". */}
      {m.word ? (
        <InputGroupAddon>
          <InputGroupText>{m.word}</InputGroupText>
        </InputGroupAddon>
      ) : null}
      {v.prefix && !replaced ? (
        <InputGroupAddon>
          <InputGroupText>{v.prefix}</InputGroupText>
        </InputGroupAddon>
      ) : null}
      {replaced && condition.variable ? (
        <InputGroupAddon>
          <VariableChip id={condition.variable} onRemove={clear} />
        </InputGroupAddon>
      ) : null}
      {v.none || replaced ? (
        // No number to type: the chip is the value.
        <span className="min-w-0 flex-1 truncate px-2 text-sm text-muted-foreground">{replaced ? null : v.placeholder}</span>
      ) : (
        // Text, not type="number": a number input won't shrink, and its arrows nudge a price by 1.
        <InputGroupInput
          type="text"
          inputMode={v.integer ? "numeric" : "decimal"}
          size={6}
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
      )}
      {v.suffix && !replaced ? (
        <InputGroupAddon align="inline-end">
          <InputGroupText>{v.suffix}</InputGroupText>
        </InputGroupAddon>
      ) : null}
      {vars?.mode === "from" && condition.variable ? (
        <InputGroupAddon align="inline-end">
          <InputGroupText>{vars.word ? vars.word(condition) : "from"}</InputGroupText>
          <VariableChip id={condition.variable} onRemove={clear} />
        </InputGroupAddon>
      ) : null}
      {vars && options.length > 0 ? (
        <InputGroupAddon align="inline-end">
          <VariableMenu options={options} title={vars.title} onPick={(id) => onChange(withVariable(condition, id))} />
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

/** The {x} button inside the value input: the variables this condition can take, grouped, searchable. */
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
          {options.length > 8 ? <CommandInput placeholder={title} /> : null}
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
