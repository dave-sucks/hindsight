/**
 * The checks: what's wrong with a condition, in one plain sentence, or null,
 * and which variables the {x} menu offers. The form shows the message under
 * the input. A check never changes the form, it only says what to fix. The
 * rules that belong to one measure live on its entry (`check`); these are
 * the ones every measure shares. docs/plans/TRIGGER_TYPES.md §3.2.
 *
 * Pure and client-safe.
 */

import { measureOf } from "./catalog";
import type { CheckContext } from "./measure";
import type { Condition, Direction, When } from "./types";
import { conditionsOf, isGroup } from "./types";
import { variableDef, type VariableDef } from "./variables";
import { capitalise } from "./words";
import { isLevel } from "./rules";

export type { CheckContext } from "./measure";

/**
 * The variables the {x} menu offers: the ones today's checker can read with
 * this condition's button, at this level. A menu never offers a variable that
 * would then refuse to save.
 */
export function variableOptions(c: Condition, ctx: CheckContext): readonly VariableDef[] {
  const vars = measureOf(c).variables;
  if (!vars) return [];
  return vars.options.filter((o) => {
    if (o.position && ctx.level === "THESIS" && !ctx.held) return false;
    const option: Condition = { ...c, variable: o.id, value: c.value ?? 1, settings: undefined };
    return measureOf(option).fits(option) && levelProblem(option, ctx) == null;
  });
}

/** A new button. A variable the new button can't take is dropped, and the line under the input asks for another. */
export function withDirection(c: Condition, is: Direction, ctx: CheckContext): Condition {
  const next: Condition = { ...c, is };
  if (next.variable && !variableOptions(next, ctx).some((o) => o.id === next.variable)) delete next.variable;
  return next;
}

export function conditionProblem(c: Condition, ctx: CheckContext): string | null {
  const m = measureOf(c);
  const def = m.value;
  const replaced = m.variables?.mode === "replace" && c.variable != null;

  if (!def.none && !replaced) {
    const v = c.value;
    if (v == null || !Number.isFinite(v)) return def.missing ?? "Enter a number.";
    if (v < 0 && !def.allowNegative) return "Use a positive number. The buttons set the direction.";
    if (def.integer && !Number.isInteger(v)) return "Use a whole number.";
    if (def.min != null && v < def.min) return `Use ${def.min} or more.`;
    if (def.max != null && v > def.max) return `Use ${def.max} or less.`;
  }
  if (m.variables?.required && !c.variable) return m.variables.required;
  if (c.variable && variableDef(c.variable).position && ctx.level === "THESIS" && !ctx.held) {
    return "Our entry and the high since we bought exist only once we own the stock.";
  }
  const own = m.check?.(c, ctx);
  if (own) return own;
  if (c.variable && m.variables && !variableOptions(c, ctx).some((o) => o.id === c.variable)) {
    const button = m.buttons?.find((b) => b.is === c.is)?.label ?? m.word ?? "this";
    return `${capitalise(variableDef(c.variable).chip)} doesn't work with ${button}. Pick another with the {x} button.`;
  }
  if (!m.fits(c)) return "This can't be saved yet.";
  return levelProblem(c, ctx);
}

/** The first problem in a trigger's condition(s), including the rules for two. */
export function whenProblem(w: When, ctx: CheckContext): string | null {
  if (isGroup(w)) {
    if (w.conditions.length !== 2 || w.conditions.some(isGroup)) return "A trigger built here takes one condition or two.";
    if (conditionsOf(w).some((c) => measureOf(c).timed)) return "A schedule stands alone. Add it as its own trigger.";
  }
  for (const c of conditionsOf(w)) {
    const problem = conditionProblem(c, ctx);
    if (problem) return problem;
  }
  return null;
}

/** At an analyst or the account a rule has to mean the same thing on every stock, so it can't hold a typed price. */
function levelProblem(w: When, ctx: CheckContext): string | null {
  if (ctx.level === "THESIS" || !conditionsOf(w).some(isLevel)) return null;
  return "That can't be a standing rule: it has to mean the same thing on every stock.";
}

/**
 * What the add paths refuse, at the server: a trigger built by hand is one
 * condition or two plain ones, a schedule stands alone, and a standing rule
 * can't hold a typed price. (The form's own checks above are the dialog's.)
 */
export function addProblem(w: When, level: CheckContext["level"]): string | null {
  if (isGroup(w)) {
    if (w.conditions.length !== 2) return "A trigger built by hand takes two conditions.";
    if (w.conditions.some(isGroup)) return "A condition can't itself be two conditions.";
    if (conditionsOf(w).some((c) => measureOf(c).timed)) return "A day count is a schedule, not a condition — add it as its own trigger.";
  }
  return levelProblem(w, { level, held: true });
}
