"use client";

/**
 * The trigger form's parts, shared by the Add trigger dialog and the pill's
 * popover. A condition is the same fields for every type, drawn from the
 * catalog (lib/agent/triggers/condition/measures):
 *
 *   tabs · setting · [ Below ▾ | value: a number or a variable chip   {x} ]
 *   a line saying what to fix, while something is missing
 *
 * docs/plans/TRIGGER_TYPES.md §7.
 */

import { useEffect, useMemo, useState } from "react";
import { Activity, CalendarDays, DollarSign, FileText, Repeat, Variable, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ButtonGroup } from "@/components/ui/button-group";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  conditionProblem,
  conditionsOf,
  isGroup,
  shapeOf,
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
  const w = shapeOf(t.predicate);
  if (!w || (isGroup(w) && (w.conditions.length !== 2 || w.conditions.some(isGroup)))) return null;
  return {
    action: t.action as TriggerAction,
    conditions: conditionsOf(w),
    match: isGroup(w) ? w.match : "all",
    fireMode: t.fireMode ?? "TACTICAL",
  };
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
}: {
  condition: Condition;
  onChange: (c: Condition) => void;
  ctx: CheckContext;
  disabled: boolean;
}) {
  const m = measureOf(condition);
  const type = typeDef(m.type);
  const problem = disabled ? null : conditionProblem(condition, ctx);
  const choosesDirection = m.buttons != null && m.buttons.length > 1;
  return (
    <div className="space-y-2">
      {type.measures.length > 1 ? (
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
      {/* One control: the direction on the left, the value on the right. */}
      <ButtonGroup width="full">
        {choosesDirection && m.buttons ? (
          <Select
            value={condition.is ?? m.buttons[0].is}
            onValueChange={(v) => {
              const b = m.buttons?.find((x) => x.is === v);
              if (b) onChange(withDirection(condition, b.is, ctx));
            }}
            disabled={disabled}
          >
            <SelectTrigger aria-label="Direction">
              <SelectValue>{m.buttons.find((b) => b.is === condition.is)?.label}</SelectValue>
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false} align="start">
              {m.buttons.map((b) => (
                <SelectItem key={b.is} value={b.is}>
                  {b.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        <ValueInput condition={condition} onChange={onChange} ctx={ctx} disabled={disabled} />
      </ButtonGroup>
      {problem ? <p className="text-xs text-muted-foreground">{problem}</p> : null}
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

  // A measure with one choice says it as a word: "Every", "At least", "Files".
  const word = m.word;
  const replaced = vars?.mode === "replace" && condition.variable != null;
  const clear = disabled ? undefined : () => onChange(withVariable(condition, undefined));

  return (
    <InputGroup>
      {word ? (
        <InputGroupAddon>
          <InputGroupText>{word}</InputGroupText>
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
          <VariableSelect value={condition.variable} options={options} title={vars.title} onPick={(id) => onChange(withVariable(condition, id))} />
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

/** The {x} button inside the value input: a plain select of the variables this condition can take. */
function VariableSelect({
  value,
  options,
  title,
  onPick,
}: {
  value: VariableId | undefined;
  options: readonly VariableDef[];
  title: string;
  onPick: (id: VariableId) => void;
}) {
  const groups = useMemo(() => {
    const out = new Map<string, VariableDef[]>();
    for (const o of options) out.set(o.group, [...(out.get(o.group) ?? []), o]);
    return [...out];
  }, [options]);
  return (
    <Select
      value={value ?? null}
      onValueChange={(v) => {
        const picked = options.find((o) => o.id === v);
        if (picked) onPick(picked.id);
      }}
    >
      <SelectTrigger variant="ghost" size="sm" chevron={false} aria-label={title} title={title}>
        <Variable />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false} align="end" width="content">
        {groups.map(([group, items]) => (
          <SelectGroup key={group}>
            {groups.length > 1 ? <SelectLabel>{group}</SelectLabel> : null}
            {items.map((o) => (
              <SelectItem key={o.id} value={o.id}>
                {o.label}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}
