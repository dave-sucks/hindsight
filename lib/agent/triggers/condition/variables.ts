/**
 * Variables: what the {x} button inside the value input offers. A variable
 * stands in for a typed number ("below the 200-day average" instead of
 * "below $288.29"), or is what a % or a day count is measured from.
 *
 * One list, shared by every watch that offers it. The resolver that reads a
 * variable's number lives with the checker (PR 2); this module is the words.
 *
 * Pure and client-safe.
 */

import { FORM_NAMES, ITEM_NAMES } from "@/lib/market-data/sec-events";
import type { DateVariable, FilingVariable, PriceVariable, VariableId } from "./types";

export interface VariableDef {
  id: VariableId;
  /** The variable menu's row. */
  label: string;
  /** The variable menu's section. */
  group: string;
  /** The chip in the input and on the pill. */
  chip: string;
  /** In a sentence: "below {words}". */
  words: string;
}

export const PRICE_VARIABLES: readonly (VariableDef & { id: PriceVariable })[] = [
  { id: "prev_close", label: "Yesterday's close", group: "Recent closes", chip: "yesterday's close", words: "yesterday's close" },
  { id: "close_5d", label: "Close 5 days ago", group: "Recent closes", chip: "5 days ago", words: "the close 5 days ago" },
  { id: "close_20d", label: "Close 20 days ago", group: "Recent closes", chip: "20 days ago", words: "the close 20 days ago" },
  { id: "entry", label: "Our entry", group: "Our position", chip: "our entry", words: "our entry" },
  { id: "peak", label: "High since we bought", group: "Our position", chip: "high since we bought", words: "the high since we bought" },
  { id: "sma20", label: "20-day average", group: "Averages", chip: "20-day average", words: "the 20-day average" },
  { id: "sma50", label: "50-day average", group: "Averages", chip: "50-day average", words: "the 50-day average" },
  { id: "sma150", label: "150-day average", group: "Averages", chip: "150-day average", words: "the 150-day average" },
  { id: "sma200", label: "200-day average", group: "Averages", chip: "200-day average", words: "the 200-day average" },
  { id: "high20", label: "20-day high", group: "Highs and lows", chip: "20-day high", words: "the 20-day high" },
  { id: "low20", label: "20-day low", group: "Highs and lows", chip: "20-day low", words: "the 20-day low" },
  { id: "high52", label: "52-week high", group: "Highs and lows", chip: "52-week high", words: "the 52-week high" },
  { id: "low52", label: "52-week low", group: "Highs and lows", chip: "52-week low", words: "the 52-week low" },
];

export const DATE_VARIABLES: readonly (VariableDef & { id: DateVariable })[] = [
  { id: "buy", label: "The buy", group: "Dates", chip: "the buy", words: "the buy" },
  { id: "event", label: "The event date", group: "Dates", chip: "the event date", words: "the event date" },
];

/** Any filing of a tier, then every 8-K item and watched form the evaluator knows (lib/market-data/sec-events). */
export const FILING_VARIABLES: readonly (VariableDef & { id: FilingVariable })[] = [
  { id: "tier:MATERIAL", label: "Anything material", group: "Any filing", chip: "anything material", words: "something material with the SEC" },
  { id: "tier:RED", label: "A red flag", group: "Any filing", chip: "a red flag", words: "a red-flag filing with the SEC" },
  ...Object.entries(ITEM_NAMES)
    // Exhibits and the earnings release are not events a review waits on.
    .filter(([code]) => code !== "9.01" && code !== "2.02")
    .map(([code, name]) => ({
      id: `item:${code}` as FilingVariable,
      label: `${capitalise(name)} (8-K ${code})`,
      group: "8-K events",
      chip: `8-K ${code}`,
      words: `an 8-K ${code} (${name})`,
    })),
  ...Object.entries(FORM_NAMES).map(([form, name]) => ({
    id: `form:${form}` as FilingVariable,
    label: `${capitalise(name)} (${form})`,
    group: "Forms",
    chip: form,
    words: `a ${form} (${name})`,
  })),
];

const ALL: ReadonlyMap<string, VariableDef> = new Map(
  [...PRICE_VARIABLES, ...DATE_VARIABLES, ...FILING_VARIABLES].map((v) => [v.id, v]),
);

/** The definition for an id, or a plain fallback for one no list knows (an old form name). */
export function variableDef(id: VariableId): VariableDef {
  const known = ALL.get(id);
  if (known) return known;
  const code = id.includes(":") ? id.slice(id.indexOf(":") + 1) : id;
  return { id, label: code, group: "Other", chip: code, words: code };
}

export function isPriceVariable(id: VariableId | undefined): id is PriceVariable {
  return id != null && PRICE_VARIABLES.some((v) => v.id === id);
}

/** The position variables only exist once we own the stock. */
export function isPositionVariable(id: VariableId | undefined): boolean {
  return id === "entry" || id === "peak";
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
